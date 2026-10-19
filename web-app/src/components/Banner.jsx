import React from 'react';
import { renderTextWithLinks } from '../utils/linkify';

const bannerStyle = {
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

const bannerLinkStyle = {
  color: '#ffffff',
  textDecoration: 'underline',
  fontWeight: 600,
  wordBreak: 'break-all'
};

const closeButtonStyle = {
  marginLeft: '20px',
  backgroundColor: 'transparent',
  border: 'none',
  color: 'white',
  fontSize: '1.5em',
  cursor: 'pointer'
};

const Banner = ({ message, onClose }) => {
  if (!message) return null;

  return (
    <div style={bannerStyle}>
      <span>{renderTextWithLinks(message, { style: bannerLinkStyle })}</span>
      <button onClick={onClose} style={closeButtonStyle}>&times;</button>
    </div>
  );
};

export default Banner;
