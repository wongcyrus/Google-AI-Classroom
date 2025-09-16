import React, { useState } from 'react';
import './IndividualStudentView.css';
import { db } from '../firebase-config';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

const IndividualStudentView = ({ student, screenshotUrl, onClose }) => {
  const [message, setMessage] = useState('');

  if (!student) {
    return null;
  }

  const handleSendMessage = async () => {
    if (!message.trim()) return;

    try {
      const studentMessagesRef = collection(db, 'students', student.email, 'messages');
      await addDoc(studentMessagesRef, {
        message,
        timestamp: serverTimestamp(),
      });
      setMessage('');
    } catch (error) {
      console.error('Error sending message: ', error);
    }
  };

  return (
    <div className="individual-student-view-overlay" onClick={onClose}>
      <div className="individual-student-view-content" onClick={(e) => e.stopPropagation()}>
        <div className="individual-student-view-header">
          <h2>{student.email}</h2>
          <div className="message-sender">
            <input 
              type="text" 
              value={message} 
              onChange={(e) => setMessage(e.target.value)} 
              placeholder="Type a message..." 
            />
            <button onClick={handleSendMessage}>Send</button>
          </div>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="individual-student-view-body">
          {screenshotUrl ? (
            <img src={screenshotUrl} alt={`Screenshot of ${student.email}`} />
          ) : (
            <p>No screenshot available.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default IndividualStudentView;
