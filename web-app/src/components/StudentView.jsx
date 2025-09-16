
import { useState, useEffect, useRef } from 'react';
import { ref, uploadBytes } from 'firebase/storage';
import { storage, db, auth } from '../firebase-config';
import { signOut } from 'firebase/auth';
import { collection, onSnapshot, doc, query, where, orderBy, limit } from 'firebase/firestore';
import Notification from './Notification';

const StudentView = ({ user }) => {
  const [isSharing, setIsSharing] = useState(false);
  const [stream, setStream] = useState(null);
  const [userClasses, setUserClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [notification, setNotification] = useState('');
  const [frameRate, setFrameRate] = useState(5); // Default framerate
  const intervalRef = useRef(null); 
  const videoRef = useRef(null);
  const lastMessageTimestampRef = useRef(null);

  const handleCloseNotification = () => {
    setNotification('');
  };

  useEffect(() => {
    if (!user || !user.email) return;

    const classesQuery = query(collection(db, 'classes'), where('students', 'array-contains', user.email));
    const unsubscribe = onSnapshot(classesQuery, (snapshot) => {
      const classes = snapshot.docs.map(doc => doc.id);
      setUserClasses(classes);
      if (classes.length === 1) {
        setSelectedClass(classes[0]);
      } else {
        if (selectedClass && !classes.includes(selectedClass)) {
            setSelectedClass(null);
        }
      }
    });

    return () => unsubscribe();
  }, [user, selectedClass]);

  useEffect(() => {
    if (!selectedClass) return;

    const classRef = doc(db, "classes", selectedClass);
    const unsubscribe = onSnapshot(classRef, (docSnap) => {
      if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.frameRate) {
              setFrameRate(data.frameRate);
          }
      }
    });

    return () => unsubscribe();
  }, [selectedClass]);

  useEffect(() => {
    if (!selectedClass) return;

    const messagesRef = collection(db, 'classes', selectedClass, 'messages');
    const q = query(
      messagesRef,
      orderBy('timestamp', 'desc'),
      limit(1)
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      if (querySnapshot.empty) return;
      const messageDoc = querySnapshot.docs[0];
      const message = messageDoc.data();
      const messageTimestamp = message.timestamp.toDate();

      if (lastMessageTimestampRef.current?.getTime() !== messageTimestamp.getTime()) {
        setNotification(message.message);
        lastMessageTimestampRef.current = messageTimestamp;
      }
    });

    return () => unsubscribe();
  }, [selectedClass]);

  const captureAndUpload = (videoElement, classId) => {
    if (!videoElement || videoElement.videoWidth === 0 || videoElement.videoHeight === 0) return;
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
  };

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (isSharing && videoRef.current && selectedClass) {
      videoRef.current.onloadedmetadata = () => {
        intervalRef.current = setInterval(() => {
          captureAndUpload(videoRef.current, selectedClass);
        }, frameRate * 1000);
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isSharing, frameRate, selectedClass]);

  const startSharing = async () => {
    if (!selectedClass) {
        alert("Please select a class before sharing.");
        return;
    }
    try {
      const displayMedia = await navigator.mediaDevices.getDisplayMedia({ video: true });
      setStream(displayMedia);
      
      if (videoRef.current) {
        videoRef.current.srcObject = displayMedia;
      }

      setIsSharing(true);

      displayMedia.getVideoTracks()[0].onended = () => {
          stopSharing();
      };

    } catch (error) {
      console.error("Error starting screen sharing:", error);
      setIsSharing(false);
    }
  };

  const stopSharing = () => {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    if(intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
    }
    setIsSharing(false);
    setStream(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const handleLogout = () => {
    if (isSharing) {
        stopSharing();
    }
    signOut(auth);
  };

  return (
    <div>
      <Notification message={notification} onClose={handleCloseNotification} />
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
      <video ref={videoRef} autoPlay muted style={{ width: '100%', maxWidth: '600px', display: isSharing ? 'block' : 'none', marginTop: '20px' }} />
    </div>
  );
};

export default StudentView;
