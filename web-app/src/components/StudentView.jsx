
import { useState, useEffect, useRef } from 'react';
import { ref, uploadString } from 'firebase/storage';
import { storage, db, auth } from '../firebase-config';
import { signOut } from 'firebase/auth';
import { collection, onSnapshot, doc, query, where, orderBy, limit, addDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import Notification from './Notification';

const StudentView = ({ user }) => {
  const [isSharing, setIsSharing] = useState(false);
  const [stream, setStream] = useState(null);
  const [userClasses, setUserClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [notification, setNotification] = useState('');
  const [frameRate, setFrameRate] = useState(5); 
  const intervalRef = useRef(null); 
  const videoRef = useRef(null);
  const lastMessageTimestampRef = useRef(null);

  // State for capture control from teacher
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureStartedAt, setCaptureStartedAt] = useState(null);

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
          setFrameRate(data.frameRate || 5);
          setIsCapturing(data.isCapturing || false);
          setCaptureStartedAt(data.captureStartedAt || null);
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

  const captureAndUpload = async (videoElement, classId) => {
    if (!videoElement || videoElement.videoWidth === 0 || videoElement.videoHeight === 0) return;
    console.log("Capturing and uploading screenshot...");
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg');

    const screenshotRef = ref(storage, `screenshots/${classId}/${user.uid}/${Date.now()}.jpg`);
    try {
      await uploadString(screenshotRef, dataUrl, 'data_url');
      const screenshotsColRef = collection(db, 'screenshots');
      await addDoc(screenshotsColRef, {
          classId,
          studentId: user.uid,
          imagePath: screenshotRef.fullPath,
          timestamp: serverTimestamp(),
      });

      const statusRef = doc(db, "classes", classId, "status", user.uid);
      await setDoc(statusRef, { lastUploadTimestamp: serverTimestamp() }, { merge: true });

      console.log("Screenshot uploaded successfully.");
    } catch(err) {
      console.error("Error uploading screenshot: ", err);
    }
  };

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (isSharing && isCapturing && videoRef.current && selectedClass) {
      const now = Date.now();
      const startTime = captureStartedAt ? captureStartedAt.toDate().getTime() : now;
      const twoAndAHalfHours = 2.5 * 60 * 60 * 1000;

      if (now - startTime < twoAndAHalfHours) {
        console.log(`Setting up capture interval every ${frameRate} seconds.`);
        intervalRef.current = setInterval(() => {
          captureAndUpload(videoRef.current, selectedClass);
        }, frameRate * 1000);
      } else {
          if(isCapturing) {
              const classRef = doc(db, "classes", selectedClass);
              setDoc(classRef, { isCapturing: false }, { merge: true });
          }
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isSharing, isCapturing, frameRate, selectedClass, captureStartedAt]);

  const updateSharingStatus = async (sharingStatus) => {
      if(!selectedClass) return;
      try {
        const statusRef = doc(db, "classes", selectedClass, "status", user.uid);
        await setDoc(statusRef, {
            isSharing: sharingStatus,
            email: user.email,
            name: user.displayName || user.email
        }, { merge: true });
      } catch (error) {
          console.error("Error updating sharing status: ", error);
      }
  }

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
      await updateSharingStatus(true);

      displayMedia.getVideoTracks()[0].onended = () => {
          stopSharing();
      };

    } catch (error) {
      console.error("Error starting screen sharing:", error);
      setIsSharing(false);
    }
  };

  const stopSharing = async () => {
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
    await updateSharingStatus(false);
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
          ))}\
        </select>
      )}

      {selectedClass && (
        isSharing ? (
          <button onClick={stopSharing}>Stop Sharing</button>
        ) : (
          <button onClick={startSharing}>Share Screen</button>
        )
      )}

      <button onClick={handleLogout}>Logout</button>

      {isCapturing && isSharing && <p style={{color: 'red'}}>Your screen is being recorded, and please don't do anything sensitives!</p>}
      
      <video ref={videoRef} autoPlay muted style={{ width: '100%', maxWidth: '600px', display: isSharing ? 'block' : 'none', marginTop: '20px' }} />
    </div>
  );
};

export default StudentView;
