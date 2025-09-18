import { useState, useEffect, useRef } from 'react';
import { ref, uploadString } from 'firebase/storage';
import { storage, db, auth } from '../firebase-config';
import { signOut } from 'firebase/auth';
import { collection, onSnapshot, doc, query, where, orderBy, limit, addDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import Banner from './Banner';
import { v4 as uuidv4 } from 'uuid';

const StudentView = ({ user, setTitle }) => {
  const [isSharing, setIsSharing] = useState(false);
  const [stream, setStream] = useState(null);
  const [userClasses, setUserClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [notification, setNotification] = useState('');
  const [frameRate, setFrameRate] = useState(5); 
  const [imageQuality, setImageQuality] = useState(0.5);
  const intervalRef = useRef(null); 
  const videoRef = useRef(null);
  const lastClassMessageTimestampRef = useRef(null);

  const sessionIdRef = useRef(null);
  const [ipAddress, setIpAddress] = useState(null);

  // State for capture control from teacher
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureStartedAt, setCaptureStartedAt] = useState(null);

  useEffect(() => {
    setTitle('Student Dashboard');
  }, [setTitle]);

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
  }, [user, selectedClass, ipAddress]);

  const handleCloseNotification = () => {
    setNotification('');
  };

  const showSystemNotification = (message) => {
    console.log('Attempting to show system notification via Service Worker...');
    if (!('serviceWorker' in navigator)) {
      console.error('This browser does not support service workers.');
      return;
    }

    if (window.Notification.permission === 'granted') {
        navigator.serviceWorker.ready.then((registration) => {
            registration.active.postMessage({
                type: 'show-notification',
                title: 'New Message',
                body: message,
            });
            console.log('Message sent to service worker to show notification.');
        }).catch(error => {
            console.error('Service worker not ready:', error);
        });
    } else {
      console.log(`Notification permission is ${window.Notification.permission}. Not showing notification.`);
    }
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
    const q = query(
      messagesRef,
      orderBy('timestamp', 'desc'),
      limit(1)
    );

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
  }, [selectedClass]);

  useEffect(() => {
    if (!user || !user.email || !selectedClass) return;

    const studentMessagesRef = collection(db, 'students', user.email, 'messages');
    const q = query(
      studentMessagesRef,
      orderBy('timestamp', 'desc'),
      limit(1)
    );

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
  }, [user, selectedClass]);



  const captureAndUpload = async (videoElement, classId) => {
    if (!videoElement || videoElement.videoWidth === 0 || videoElement.videoHeight === 0) return;
    console.log("Capturing and uploading screenshot...");
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', imageQuality);
    console.log('Image size (MB):', dataUrl.length / (1024 * 1024));

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
    if ('Notification' in window && window.Notification.permission !== 'granted') {
        try {
            const permission = await window.Notification.requestPermission();
            if (permission === 'granted') {
                console.log('Notification permission granted.');
                showSystemNotification('Notifications have been enabled!');
            } else {
                console.log('Notification permission was denied.');
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

    showSystemNotification("Screen recording has stopped.");
  };

  const handleLogout = () => {
    if (isSharing) {
        stopSharing();
    }
    signOut(auth);
  };

  return (
    <div>
      <Banner message={notification} onClose={handleCloseNotification} />
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