
import { useState, useEffect } from 'react';
import { ref, uploadBytes } from 'firebase/storage';
import { storage, db, auth } from '../firebase-config';
import { signOut } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';

const StudentView = ({ user }) => {
  const [isSharing, setIsSharing] = useState(false);
  const [stream, setStream] = useState(null);
  const [intervalId, setIntervalId] = useState(null);
  const [userClasses, setUserClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);

  useEffect(() => {
      if (!user) return;
      const classesRef = collection(db, `students/${user.uid}/classes`);
      const unsubscribe = onSnapshot(classesRef, (querySnapshot) => {
          const classes = [];
          querySnapshot.forEach(doc => {
              classes.push(doc.id);
          });
          setUserClasses(classes);
          if(classes.length === 1) {
              setSelectedClass(classes[0]);
          }
      });

      return () => unsubscribe();

  }, [user]);

  const captureAndUpload = (videoElement, classId) => {
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
        if (!blob) return;
        const screenshotRef = ref(storage, `screenshots/${classId}/${user.uid}/screenshot.jpg`);
        uploadBytes(screenshotRef, blob).catch(err => console.error(err));
    }, 'image/jpeg');
  }

  const startSharing = async () => {
    try {
      const displayMedia = await navigator.mediaDevices.getDisplayMedia();
      setStream(displayMedia);
      setIsSharing(true);
      const video = document.createElement('video');
      video.srcObject = displayMedia;
      video.play();
      const id = setInterval(() => captureAndUpload(video, selectedClass), 5000);
      setIntervalId(id);
    } catch (error) {
      console.error(error);
    }
  };

  const stopSharing = () => {
    stream.getTracks().forEach(track => track.stop());
    setIsSharing(false);
    clearInterval(intervalId);
    setIntervalId(null);
    setStream(null);
  };

  const handleLogout = () => {
    signOut(auth);
  };

  return (
    <div>
      <h1>Student View</h1>
      {userClasses.length > 1 && (
          <select onChange={(e) => setSelectedClass(e.target.value)} value={selectedClass || ''}>
              <option value="" disabled>Select a class</option>
              {userClasses.map(c => (
                  <option key={c} value={c}>{c}</option>
              ))}
          </select>
      )}
      {selectedClass && (
          isSharing ? (
            <button onClick={stopSharing}>Stop Sharing</button>
          ) : (
            <button onClick={startSharing}>Start Sharing</button>
          )
      )}
      <button onClick={handleLogout}>Logout</button>
    </div>
  );
};

export default StudentView;
