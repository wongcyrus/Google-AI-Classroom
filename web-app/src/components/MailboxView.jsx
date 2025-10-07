import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { auth, db } from '../firebase-config';
import './SharedViews.css';


const MailboxView = () => {
    const [emails, setEmails] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const currentUser = auth.currentUser;
        if (!currentUser) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setLoading(false);
            return;
        }

        const emailsCollection = collection(db, 'mails');
        const q = query(
            emailsCollection,
            where('to', '==', currentUser.email),
            orderBy('createdAt', 'desc')
        );

        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const emailsData = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setEmails(emailsData);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching emails: ", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    if (loading) {
        return <div>Loading emails...</div>;
    }

    return (
        <div className="view-container">

            <div className="view-header">
                <h2>Mailbox</h2>
            </div>
            <div className="email-list">
                {emails.length === 0 ? (
                    <p>You have no mail.</p>
                ) : (
                    emails.map(email => (
                        <Link to={`/mailbox/${email.id}`} key={email.id} className={`email-item ${!email.read ? 'unread' : ''}`}>
                            <div className="email-status-icon">
                                {!email.read ? '●' : '○'}
                            </div>
                            <div className="email-details">
                                <div className="email-title">{email.title}</div>
                                <div className="email-date">
                                    {email.createdAt && new Date(email.createdAt.seconds * 1000).toLocaleString()}
                                </div>
                            </div>
                        </Link>
                    ))
                )}
            </div>
        </div>
    );
};

export default MailboxView;
