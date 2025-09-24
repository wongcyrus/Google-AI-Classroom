import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase-config';
import './MailboxView.css'; // Reuse styles for now

const AttachmentLink = ({ attachment }) => {
    const [url, setUrl] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (attachment && attachment.key) {
            const storageRef = ref(storage, attachment.key);
            getDownloadURL(storageRef)
                .then((downloadUrl) => {
                    setUrl(downloadUrl);
                })
                .catch((err) => {
                    console.error("Error getting download URL:", err);
                    setError("Could not get download URL.");
                });
        }
    }, [attachment]);

    if (error) {
        return <span>{attachment.name}: {error}</span>;
    }

    if (!url) {
        return <span>{attachment.name}: Loading link...</span>;
    }

    return (
        <a href={url} target="_blank" rel="noopener noreferrer">
            {attachment.name}
        </a>
    );
};

const EmailDetailView = () => {
    const { emailId } = useParams();
    const [email, setEmail] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchEmail = async () => {
            if (!emailId) return;
            setLoading(true);
            const emailRef = doc(db, 'mails', emailId);
            const docSnap = await getDoc(emailRef);

            if (docSnap.exists()) {
                const emailData = { id: docSnap.id, ...docSnap.data() };
                setEmail(emailData);
                if (!emailData.read) {
                    await updateDoc(emailRef, { read: true });
                }
            } else {
                console.log("No such document!");
            }
            setLoading(false);
        };

        fetchEmail();
    }, [emailId]);

    if (loading) {
        return <div>Loading email...</div>;
    }

    if (!email) {
        return <div>Email not found.</div>;
    }

    return (
        <div className="email-detail-view">
            <Link to="/mailbox">Back to Mailbox</Link>
            <h2>{email.title}</h2>
            <div className="email-meta">
                <p><strong>To:</strong> {email.to}</p>
                <p><strong>Date:</strong> {email.createdAt && new Date(email.createdAt.seconds * 1000).toLocaleString()}</p>
                <p><strong>Subject:</strong> {email.message?.subject}</p>
            </div>
            <hr />
            <div className="email-body" dangerouslySetInnerHTML={{ __html: email.message?.html }}></div>
            <hr />
            {email.attachments && email.attachments.length > 0 && (
                <div className="email-attachments">
                    <h4>Attachments</h4>
                    {email.attachments.map((att, index) => (
                        <div key={index}>
                            <AttachmentLink attachment={att} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default EmailDetailView;
