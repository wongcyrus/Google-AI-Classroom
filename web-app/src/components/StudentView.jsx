import { useState, useEffect, useRef, useCallback } from 'react';
import { ref, uploadBytes } from 'firebase/storage';
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

  const [isSharing, setIsSharing] = useState(false);
  const [userClasses, setUserClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [frameRate, setFrameRate] = useState(5);
  const [imageQuality, setImageQuality] = useState(0.5);
  const [maxImageSize, setMaxImageSize] = useState(1024 * 1024);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureStartedAt, setCaptureStartedAt] = useState(null);
  const [recentIrregularities, setRecentIrregularities] = useState([]);
  const [directMessages, setDirectMessages] = useState([]);
  const [classMessages, setClassMessages] = useState([]);
  const [recentMessages, setRecentMessages] = useState([]);

  // Refs
  const intervalRef = useRef(null);
  const videoRef = useRef(null);
  const sessionIdRef = useRef(null);
  const lastMessageTimestampRef = useRef(null);

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
    if (!selectedClass || !user || !user.uid) return;
    try {
      const statusRef = doc(db, "classes", selectedClass, "status", user.uid);
      await setDoc(statusRef, {
        isSharing: sharingStatus,
        email: user.email,
        name: user.displayName || user.email,
        timestamp: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error("Error updating sharing status: ", error);
    }
  }, [selectedClass, user?.uid, user?.email, user?.displayName]);

  const stopSharing = useCallback(async () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsSharing(false);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    await updateSharingStatus(false);

    showSystemNotification("Screen recording has stopped.");
  }, [updateSharingStatus, showSystemNotification]);

  const captureAndUpload = useCallback((videoElement, classId) => {
    if (!user || !user.uid) {
      console.error('Capture skipped: user not available.');
      return;
    }
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
    
    const MAX_SIZE_BYTES = maxImageSize;

    // Function to attempt upload, resizing if necessary
    const attemptUpload = (currentCanvas, quality) => {
      currentCanvas.toBlob(async (blob) => {
        if (!blob) {
          console.error("Canvas toBlob returned null.");
          return;
        }

        if (blob.size > MAX_SIZE_BYTES) {
          if (quality > 0.2) {
            // If size is too large, first try reducing quality
            console.log(`Image size is too large (${(blob.size / MAX_SIZE_BYTES).toFixed(2)}MB). Reducing quality.`);
            attemptUpload(currentCanvas, quality - 0.1);
          } else {
            // If quality is already low, resize the image dimensions
            console.log(`Image size is still too large (${(blob.size / MAX_SIZE_BYTES).toFixed(2)}MB). Resizing image.`);
            const scale = Math.sqrt(MAX_SIZE_BYTES / blob.size) * 0.9;
            const newWidth = currentCanvas.width * scale;
            const newHeight = currentCanvas.height * scale;
            const newCanvas = document.createElement('canvas');
            newCanvas.width = newWidth;
            newCanvas.height = newHeight;
            const newCtx = newCanvas.getContext('2d');
            newCtx.drawImage(currentCanvas, 0, 0, newWidth, newHeight);
            attemptUpload(newCanvas, 0.9); // try with high quality on resized image
          }
        } else {
          // If size is acceptable, upload
          const screenshotRef = ref(storage, `screenshots/${classId}/${user.uid}/${Date.now()}.jpg`);
          try {
            console.log(`Uploading screenshot... Size: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
            await uploadBytes(screenshotRef, blob);
            console.log('Screenshot uploaded successfully.');
            const screenshotsColRef = collection(db, 'screenshots');
            await addDoc(screenshotsColRef, {
              classId,
              studentUid: user.uid,
              email: user.email.toLowerCase(),
              imagePath: screenshotRef.fullPath,
              size: blob.size,
              timestamp: serverTimestamp(),
              deleted: false,
              ipAddress: ipAddress,
            });
            console.log('Screenshot metadata added to Firestore.');
            const statusRef = doc(db, "classes", classId, "status", user.uid);
            await setDoc(statusRef, { timestamp: serverTimestamp() }, { merge: true });
            console.log('Student status updated.');
          } catch (err) {
            console.error("Error uploading screenshot: ", err);
          }
        }
      }, 'image/jpeg', quality);
    };

    attemptUpload(canvas, imageQuality);
  }, [imageQuality, user, maxImageSize, ipAddress]);

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
  }, [user?.uid, selectedClass, ipAddress, stopSharing]);

  useEffect(() => {
    if (!user || !user.uid) return;

    const userDocRef = doc(db, 'studentProfiles', user.uid);
    const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const userData = docSnap.data();
        const classes = userData.classes || [];
        setUserClasses(classes);
        if (classes.length === 1) {
          setSelectedClass(classes[0]);
        } else if (selectedClass && !classes.includes(selectedClass)) {
          setSelectedClass(null); // Deselect if no longer in the list
        }
      } else {
        // This case might happen for a new user who hasn't been added to any class yet
        setUserClasses([]);
        setSelectedClass(null);
      }
    });

    return () => unsubscribe();
  }, [user?.uid, selectedClass]);

  useEffect(() => {
    if (!selectedClass) return;

    const classRef = doc(db, "classes", selectedClass);
    const unsubscribe = onSnapshot(classRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setFrameRate(data.frameRate || 5);
        setImageQuality(data.imageQuality || 0.5);
        setMaxImageSize(data.maxImageSize || 1024 * 1024);
        setIsCapturing(data.isCapturing || false);
        setCaptureStartedAt(data.captureStartedAt || null);
      }
    });

    return () => unsubscribe();
  }, [selectedClass]);

  // Listen for class-wide messages
  useEffect(() => {
    if (!selectedClass) {
      setClassMessages([]);
      return;
    }

    const messagesRef = collection(db, 'classes', selectedClass, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'desc'), limit(5));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const messagesData = querySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, type: 'class' }));
      setClassMessages(messagesData);
    });

    return () => unsubscribe();
  }, [selectedClass]);

  // Listen for direct student messages
  useEffect(() => {
    if (!user || !user.uid) return;

    const studentMessagesRef = collection(db, 'students', user.uid, 'messages');
    // Temporarily remove orderBy to check for indexing issues
    const q = query(studentMessagesRef, limit(5));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const messagesData = querySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, type: 'direct' }));
      setDirectMessages(messagesData);
    });

    return () => unsubscribe();
  }, [user?.uid]);

  // Merge messages and handle notifications
  useEffect(() => {
    const allMessages = [...directMessages, ...classMessages];
    
    allMessages.sort((a, b) => {
        const timeA = a.timestamp?.toMillis() || 0;
        const timeB = b.timestamp?.toMillis() || 0;
        return timeB - timeA;
    });
    
    const latestMessages = allMessages.slice(0, 5);
    setRecentMessages(latestMessages);

    if (latestMessages.length > 0) {
        const latestMessage = latestMessages[0];
        if (latestMessage.timestamp) {
            const messageTimestamp = latestMessage.timestamp.toDate();
            if (lastMessageTimestampRef.current?.getTime() !== messageTimestamp.getTime()) {
                setNotification(latestMessage.message);
                setTimeout(() => showSystemNotification(latestMessage.message), 0);
                lastMessageTimestampRef.current = messageTimestamp;
            }
        }
    }
  }, [directMessages, classMessages, showSystemNotification]);

  useEffect(() => {
    if (!user || !user.uid) return;

    const irregularitiesRef = collection(db, "irregularities");
    const q = query(
      irregularitiesRef,
      where("studentUid", "==", user.uid),
      orderBy("timestamp", "desc"),
      limit(5)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const irregularitiesData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      setRecentIrregularities(irregularitiesData);
    });

    return () => unsubscribe();
  }, [user?.uid]);

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
        // The capture session time has expired for this student.
        // Update the student's own status document instead of the class document.
        const statusRef = doc(db, "classes", selectedClass, "status", user.uid);
        setDoc(statusRef, { 
            isCapturing: false,
            reason: "Capture time limit reached."
        }, { merge: true })
          .then(() => {
            console.log("Student capture time expired, updated student status to isCapturing: false.");
          })
          .catch(err => {
            console.error("Failed to update student status after capture time expired.", err);
          });
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
        <div className="student-view-main">
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

            {isCapturing && isSharing && <p className="recording-indicator">Your screen is being recorded, and please don't do anything sensitive!</p>}
            
            <video ref={videoRef} autoPlay muted className="video-preview" style={{ display: isSharing ? 'block' : 'none' }} />
        </div>
        <div className="student-view-sidebar">
            <div className="alerts-widget">
                <h2>My Recent Alerts</h2>
                <div className="alert-list">
                    {recentIrregularities.length > 0 ? (
                        recentIrregularities.map(item => (
                            <div key={item.id} className="alert-item">
                                <p className="alert-title">{item.title}</p>
                                <span className="alert-time">{item.timestamp ? item.timestamp.toDate().toLocaleString() : ''}</span>
                            </div>
                        ))
                    ) : (
                        <p>You have no recent alerts.</p>
                    )}
                </div>
                <p style={{
                    padding: '0 15px 15px',
                    margin: 0,
                    fontSize: '0.9rem',
                    color: '#555',
                    borderTop: '1px solid #e0e0e0',
                    paddingTop: '15px',
                    marginTop: '15px'
                }}>
                    IP Address: {ipAddress || 'Fetching...'}
                </p>
            </div>
            <div className="messages-widget">
                <h2>My Recent Messages</h2>
                <div className="message-list">
                    {recentMessages.length > 0 ? (
                        recentMessages.map(item => (
                            <div key={item.id} className="message-item">
                                <p className="message-text">{item.message}</p>
                                <span className="message-time">{item.timestamp ? item.timestamp.toDate().toLocaleString() : ''}</span>
                            </div>
                        ))
                    ) : (
                        <p>You have no recent messages.</p>
                    )}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default StudentView;