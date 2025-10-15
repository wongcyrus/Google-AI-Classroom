
import React from 'react';

const VideoPlayerModal = ({ show, onClose, videoUrl, loading }) => {
  if (!show) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
      backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex',
      justifyContent: 'center', alignItems: 'center', zIndex: 1050
    }} onClick={onClose}>
      <div style={{
        position: 'relative', padding: '20px', background: 'white',
        borderRadius: '8px', maxWidth: '90vw', maxHeight: '90vh'
      }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{
          position: 'absolute', top: '10px', right: '10px',
          background: 'transparent', border: 'none', fontSize: '1.5rem', cursor: 'pointer'
        }}>
          &times;
        </button>
        {loading ? (
          <p>Loading video...</p>
        ) : (
          <video controls autoPlay src={videoUrl} style={{ maxWidth: '100%', maxHeight: '80vh' }}>
            Your browser does not support the video tag.
          </video>
        )}
      </div>
    </div>
  );
};

export default VideoPlayerModal;
