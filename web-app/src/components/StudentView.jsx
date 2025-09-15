
import { useRef, useState } from 'react';
import { ref, uploadString } from 'firebase/storage';
import { storage, auth } from '../firebase-config';
import { signOut } from 'firebase/auth';

const StudentView = ({ user }) => {
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [screenshotInterval, setScreenshotInterval] = useState(null);

  const handleScreenShare = async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      videoRef.current.srcObject = screenStream;
      setStream(screenStream);

      const interval = setInterval(() => {
        captureScreenshot(screenStream);
      }, 5000); // Capture every 5 seconds
      setScreenshotInterval(interval);
    } catch (err) {
      console.error("Error: " + err);
    }
  };

  const stopScreenShare = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setStream(null);
    }
    if (screenshotInterval) {
      clearInterval(screenshotInterval);
      setScreenshotInterval(null);
    }
  };

  const captureScreenshot = (screenStream) => {
    const video = document.createElement('video');
    video.srcObject = screenStream;
    video.play();
    video.onloadeddata = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg');
      
      const screenshotRef = ref(storage, `screenshots/${user.uid}/screenshot.jpg`);
      uploadString(screenshotRef, dataUrl, 'data_url').then(() => {
        console.log('Screenshot uploaded');
      });
      video.remove();
    };
  };

  const handleLogout = () => {
    signOut(auth);
  };

  return (
    <div>
      <h1>Welcome, {user.email}</h1>
      <div className="card">
        <video ref={videoRef} autoPlay style={{ width: '100%',
        height: 'auto',
        border: '1px solid black' }}></video>
        <br/>
        <button onClick={handleScreenShare}>Share Screen</button>
        <button onClick={stopScreenShare}>Stop Sharing</button>
      </div>
      <button onClick={handleLogout}>Logout</button>
    </div>
  )
}

export default StudentView;
