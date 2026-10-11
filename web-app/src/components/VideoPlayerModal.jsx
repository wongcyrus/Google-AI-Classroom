
import React from 'react';

const VideoPlayerModal = ({ show, onClose, videoUrl, loading, video }) => {
  if (!show) return null;

  const durationSec = typeof video?.duration === 'number' ? video.duration : null;
  const captureInterval = typeof video?.captureInterval === 'number' ? video.captureInterval : 15;
  const estimatedActiveMinutes = durationSec ? Math.max(1, Math.round((durationSec * captureInterval) / 60)) : null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
      backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex',
      justifyContent: 'center', alignItems: 'center', zIndex: 1050
    }} onClick={onClose}>
      <div style={{
        position: 'relative', padding: '20px', background: 'white',
        borderRadius: '8px', maxWidth: '90vw', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column'
      }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{
          position: 'absolute', top: '10px', right: '10px',
          background: 'transparent', border: 'none', fontSize: '1.5rem', cursor: 'pointer', zIndex: 10
        }}>
          &times;
        </button>

        {estimatedActiveMinutes !== null && (
          <div style={{
            marginBottom: '12px', padding: '8px 12px', background: '#eff6ff',
            borderRadius: '6px', border: '1px solid #bfdbfe', fontSize: '0.85rem', color: '#1e40af',
            display: 'flex', alignItems: 'center', gap: '8px'
          }}>
            <span>⏩</span>
            <span>
              <strong>Time-Lapse Screencast:</strong> Encoded at 1 frame/sec (~{captureInterval}s screen time per frame). 
              Video playback duration: <strong>{durationSec}s</strong> represents ~<strong>{estimatedActiveMinutes} minutes</strong> of active lab screen share.
            </span>
          </div>
        )}

        {loading ? (
          <p>Loading video...</p>
        ) : (
          <video controls autoPlay src={videoUrl} style={{ maxWidth: '100%', maxHeight: '75vh', borderRadius: '4px' }}>
            Your browser does not support the video tag.
          </video>
        )}
      </div>
    </div>
  );
};

export default VideoPlayerModal;
