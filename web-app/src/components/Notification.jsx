
import React from 'react';

const notificationStyle = {
  position: 'fixed',
  top: '20px',
  left: '50%',
  transform: 'translateX(-50%)',
  backgroundColor: '#4CAF50',
  color: 'white',
  padding: '16px',
  borderRadius: '8px',
  zIndex: 1000,
  boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
  fontSize: '1.2em',
  display: 'flex',
  alignItems: 'center'
};

const closeButtonStyle = {
  marginLeft: '20px',
  backgroundColor: 'transparent',
  border: 'none',
  color: 'white',
  fontSize: '1.5em',
  cursor: 'pointer'
};

const Notification = ({ message, onClose }) => {
  if (!message) return null;

  return (
    <div style={notificationStyle}>
      {message}
      <button onClick={onClose} style={closeButtonStyle}>&times;</button>
    </div>
  );
};

export default Notification;
