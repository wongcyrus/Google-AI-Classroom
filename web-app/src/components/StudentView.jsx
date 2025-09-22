import { useState, useEffect, useRef, useCallback } from 'react';
import { ref, uploadString } from 'firebase/storage';
import { storage, db, auth } from '../firebase-config';
import { signOut } from 'firebase/auth';
import { collection, onSnapshot, doc, query, where, orderBy, limit, addDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import Banner from './Banner';
import { v4 as uuidv4 } from 'uuid';
import './StudentView.css';

const StudentView = ({ user }) => {
  // State
  const [ipAddress, setIpAddress] = useState(null);
  const [notification, setNotification] = useState('');
  const [stream, setStream] = useState(null);
  const [isSharing, setIsSharing] = useState(false);
  const [userClasses, setUserClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [frameRate, setFrameRate] = useState(5);
  const [imageQuality, setImageQuality] = useState(0.5);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureStartedAt, setCaptureStartedAt] = useState(null);

  // Refs
  const intervalRef = useRef(null);
  const videoRef = useRef(null);
  const sessionIdRef = useRef(null);
  const lastClassMessageTimestampRef = useRef(null);
  const lastStudentMessageTimestampRef = useRef(null);

  // Callbacks
  const handleCloseNotification = () => {
    setNotification('');
  };

  const showSystemNotification = useCallback((message) => {
    if (!('serviceWorker' in navigator)) return;

    if (window.Notification.permission === 'granted') {
      navigator.serviceWorker.ready.then((registration) => {
        registration.active.postMessage({
          type: 'show-notification',
          title: 'New Message',
          body: message,
        });
      });
    }
  }, []);

  const updateSharingStatus = useCallback(async (sharingStatus) => {
    if (!selectedClass) return;
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
  }, [selectedClass, user]);

  const stopSharing = useCallback(async () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsSharing(false);
    setStream(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    await updateSharingStatus(false);

    showSystemNotification("Screen recording has stopped.");
  }, [stream, updateSharingStatus, showSystemNotification]);

  const captureAndUpload = useCallback(async (videoElement, classId) => {
    if (!videoElement || videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
      console.log('Capture skipped: video element not ready.');
      return;
    }
    console.log('Capturing screenshot...');
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', imageQuality);
    console.log('Screenshot captured.');

    const screenshotRef = ref(storage, `screenshots/${classId}/${user.uid}/${Date.now()}.jpg`);
    try {
      console.log('Uploading screenshot...');
      await uploadString(screenshotRef, dataUrl, 'data_url');
      console.log('Screenshot uploaded successfully.');

      console.log('Adding screenshot metadata to Firestore...');
      const screenshotsColRef = collection(db, 'screenshots');
      await addDoc(screenshotsColRef, {
        classId,
        studentId: user.uid,
        email: user.email.toLowerCase(),
        imagePath: screenshotRef.fullPath,
        timestamp: serverTimestamp(),
      });
      console.log('Screenshot metadata added to Firestore.');

      console.log('Updating student status with last upload timestamp...');
      const statusRef = doc(db, "classes", classId, "status", user.uid);
      await setDoc(statusRef, { lastUploadTimestamp: serverTimestamp() }, { merge: true });
      console.log('Student status updated.');
    } catch (err) {
      console.error("Error uploading screenshot: ", err);
    }
  }, [imageQuality, user]);

  const startSharing = useCallback(async () => {
    if ('Notification' in window && window.Notification.permission !== 'granted') {
      try {
        const permission = await window.Notification.requestPermission();
        if (permission === 'granted') {
          showSystemNotification('Notifications have been enabled!');
        } else {
          alert('You have disabled notifications. Please enable them in your browser settings to receive important messages.');
        }
      } catch (error) {
        console.error('Error requesting notification permission:', error);
      }
    }

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

      showSystemNotification("Screen recording has started.");

      displayMedia.getVideoTracks()[0].onended = () => {
        stopSharing();
      };
    } catch (error) {
      console.error("Error starting screen sharing:", error);
      setIsSharing(false);
    }
  }, [selectedClass, showSystemNotification, stopSharing, updateSharingStatus]);

  // Effects
  useEffect(() => {
    fetch('https://api.ipify.org?format=json')
      .then(response => response.json())
      .then(data => setIpAddress(data.ip))
      .catch(error => console.error('Error fetching IP address:', error));
  }, []);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js')
        .then((registration) => {
          console.log('Service Worker registered with scope:', registration.scope);
        })
        .catch((error) => {
          console.error('Service Worker registration failed:', error);
        });
    }
  }, []);

  useEffect(() => {
    if (user && selectedClass) {
      const newSessionId = uuidv4();
      sessionIdRef.current = newSessionId;
      const statusRef = doc(db, "classes", selectedClass, "status", user.uid);
      const statusData = { sessionId: newSessionId };
      if (ipAddress) {
        statusData.ipAddress = ipAddress;
      }
      setDoc(statusRef, statusData, { merge: true });

      const unsubscribe = onSnapshot(statusRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.sessionId && data.sessionId !== sessionIdRef.current) {
            alert("Another session has started. You will be logged out.");
            stopSharing();
            signOut(auth);
          }
        }
      });

      return () => unsubscribe();
    }
  }, [user, selectedClass, ipAddress, stopSharing]);

  useEffect(() => {
    if (!user || !user.email) return;

    const classesQuery = query(collection(db, 'classes'), where('students', 'array-contains', user.email));
    const unsubscribe = onSnapshot(classesQuery, (snapshot) => {
      const classes = snapshot.docs.map(doc => doc.id);
      setUserClasses(classes);
      if (classes.length === 1) {
        setSelectedClass(classes[0]);
      } else if (selectedClass && !classes.includes(selectedClass)) {
        setSelectedClass(null);
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
        setImageQuality(data.imageQuality || 0.5);
        setIsCapturing(data.isCapturing || false);
        setCaptureStartedAt(data.captureStartedAt || null);
      }
    });

    return () => unsubscribe();
  }, [selectedClass]);

  useEffect(() => {
    if (!selectedClass) return;

    const messagesRef = collection(db, 'classes', selectedClass, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'desc'), limit(1));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      if (querySnapshot.empty) return;
      const messageDoc = querySnapshot.docs[0];
      const message = messageDoc.data();
      if (!message.timestamp) return;
      const messageTimestamp = message.timestamp.toDate();

      if (lastClassMessageTimestampRef.current?.getTime() !== messageTimestamp.getTime()) {
        setNotification(message.message);
        setTimeout(() => showSystemNotification(message.message), 0);
        lastClassMessageTimestampRef.current = messageTimestamp;
      }
    });

    return () => unsubscribe();
  }, [selectedClass, showSystemNotification]);

  useEffect(() => {
    if (!user || !user.email) return;

    const studentMessagesRef = collection(db, 'students', user.email, 'messages');
    const q = query(studentMessagesRef, orderBy('timestamp', 'desc'), limit(1));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      if (querySnapshot.empty) return;
      const messageDoc = querySnapshot.docs[0];
      const message = messageDoc.data();
      if (!message.timestamp) return;
      const messageTimestamp = message.timestamp.toDate();

      if (lastStudentMessageTimestampRef.current?.getTime() !== messageTimestamp.getTime()) {
        setNotification(message.message);
        setTimeout(() => showSystemNotification(message.message), 0);
        lastStudentMessageTimestampRef.current = messageTimestamp;
      }
    });

    return () => unsubscribe();
  }, [user, showSystemNotification]);

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
        intervalRef.current = setInterval(() => {
          captureAndUpload(videoRef.current, selectedClass);
        }, frameRate * 1000);
      } else if (isCapturing) {
        const classRef = doc(db, "classes", selectedClass);
        setDoc(classRef, { isCapturing: false }, { merge: true });
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isSharing, isCapturing, frameRate, selectedClass, captureStartedAt, captureAndUpload]);

  return (
    <div className="student-view-container">
      <Banner message={notification} onClose={handleCloseNotification} />
      <div className="student-view-content">
        <div className="student-view-controls">
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
              <button onClick={stopSharing} className="student-view-button stop">Stop Sharing</button>
            ) : (
              <button onClick={startSharing} className="student-view-button">Share Screen</button>
            )
          )}
        </div>

        {isCapturing && isSharing && <p className="recording-indicator">Your screen is being recorded, and please don't do anything sensitives!</p>}
        
        <video ref={videoRef} autoPlay muted className="video-preview" style={{ display: isSharing ? 'block' : 'none' }} />
      </div>
    </div>
  );
};

export default StudentView;