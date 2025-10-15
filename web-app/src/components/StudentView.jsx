import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ref, uploadBytes } from 'firebase/storage';
import { storage, db, auth } from '../firebase-config';
import { signOut } from 'firebase/auth';
import { collection, onSnapshot, doc, query, where, orderBy, limit, addDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import Banner from './Banner';
import { v4 as uuidv4 } from 'uuid';
import './StudentView.css';

import { useStudentClassSchedule } from '../hooks/useStudentClassSchedule';

import Sidebar from './student/Sidebar';

const StudentView = ({ user }) => {
  // State
  const [ipAddress, setIpAddress] = useState(null);
  const [notification, setNotification] = useState('');

  const [isSharing, setIsSharing] = useState(false);

  // Schedule-driven class state
  const { currentActiveClassId } = useStudentClassSchedule(user);
  const activeClass = currentActiveClassId;
  const [frameRate, setFrameRate] = useState(5);
  const [imageQuality, setImageQuality] = useState(0.5);
  const [maxImageSize, setMaxImageSize] = useState(1024 * 1024);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureStartedAt, setCaptureStartedAt] = useState(null);
  const [recentIrregularities, setRecentIrregularities] = useState([]);
  const [directMessages, setDirectMessages] = useState([]);
  const [classMessages, setClassMessages] = useState([]);

  // Custom Properties State
  const [classProperties, setClassProperties] = useState(null);
  const [myProperties, setMyProperties] = useState(null);

  const recentMessages = useMemo(() => {
    const alertTitles = new Set(recentIrregularities.map(ir => ir.title));
    const filteredMessagesForUI = [...directMessages, ...classMessages]
      .filter(msg => !alertTitles.has(msg.message));

    filteredMessagesForUI.sort((a, b) => {
      const timeA = a.timestamp?.toMillis() || 0;
      const timeB = b.timestamp?.toMillis() || 0;
      return timeB - timeA;
    });

    return filteredMessagesForUI.slice(0, 5);
  }, [directMessages, classMessages, recentIrregularities]);

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

  const updateSharingStatus = useCallback(async (sharingStatus, classId) => {
    const targetClass = classId || activeClass;
    if (!targetClass || !user || !user.uid) return;
    const statusRef = doc(db, "classes", targetClass, "status", user.uid);
    console.log(`Firestore: Updating sharing status for ${user.uid} in ${targetClass} to ${sharingStatus}`);
    try {
      await setDoc(statusRef, {
        isSharing: sharingStatus,
        email: user.email,
        name: user.displayName || user.email,
        timestamp: serverTimestamp()
      }, { merge: true });
      console.log(`Firestore: Successfully updated sharing status.`);
    } catch (error) {
      console.error("Firestore: Error updating sharing status: ", error);
    }
  }, [activeClass, user]);

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
    
    const { width, height } = canvas;
    if (width > 1 && height > 1) {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        
        const isSolidColor = () => {
            const firstPixelR = data[0];
            const firstPixelG = data[1];
            const firstPixelB = data[2];

            // Check a few strategic pixels to see if they are the same
            const pointsToCheck = [
                0, // top-left
                (width - 1) * 4, // top-right
                (height - 1) * width * 4, // bottom-left
                ((height - 1) * width + (width - 1)) * 4, // bottom-right
                (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4 // center
            ];

            for (const i of pointsToCheck) {
                if (i < data.length && (data[i] !== firstPixelR || data[i+1] !== firstPixelG || data[i+2] !== firstPixelB)) {
                    return false;
                }
            }
            return true;
        };

        if (isSolidColor()) {
            console.error("Screen capture appears to be a solid color. This might be an issue with the browser or screen sharing permissions.");
            stopSharing();
            alert("Screen sharing has been stopped because the output appears to be a solid color (e.g., a black screen). This can happen with older browsers or if the wrong screen was selected. Please try again with a newer browser.");
            return;
        }
    }

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
            console.log(`Firestore: Adding doc to screenshots collection`);
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
            console.log('Firestore: Successfully added screenshot metadata.');
            const statusRef = doc(db, "classes", classId, "status", user.uid);
            console.log(`Firestore: Updating student status timestamp in ${classId}`);
            await setDoc(statusRef, { timestamp: serverTimestamp() }, { merge: true });
            console.log('Firestore: Successfully updated student status.');
          } catch (err) {
            console.error("Firestore: Error during screenshot upload process: ", err);
          }
        }
      }, 'image/jpeg', quality);
    };

    attemptUpload(canvas, imageQuality);
  }, [imageQuality, user, maxImageSize, ipAddress, stopSharing]);

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

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        alert("Screen sharing is not supported by your browser. Please use a modern browser like Chrome, Firefox, or Edge.");
        return;
      }
      const displayMedia = await navigator.mediaDevices.getDisplayMedia({ video: true });


      if (videoRef.current) {
        videoRef.current.srcObject = displayMedia;
      }

      setIsSharing(true);
      await updateSharingStatus(true, activeClass);

      showSystemNotification("Screen recording has started.");

      displayMedia.getVideoTracks()[0].onended = () => {
        stopSharing();
      };
    } catch (error) {
      console.error("Error starting screen sharing:", error);
      setIsSharing(false);
      alert("Could not start screen sharing. Please ensure you grant permission and are using a modern browser. If the problem persists, try restarting your browser.");
    }
  }, [activeClass, showSystemNotification, stopSharing, updateSharingStatus]);

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
    if (user && activeClass) {
      const newSessionId = uuidv4();
      sessionIdRef.current = newSessionId;
      const statusRef = doc(db, "classes", activeClass, "status", user.uid);
      const statusData = { sessionId: newSessionId };
      if (ipAddress) {
        statusData.ipAddress = ipAddress;
      }
      console.log(`Firestore: Setting session ID for ${user.uid} in ${activeClass}`);
      setDoc(statusRef, statusData, { merge: true })
        .then(() => console.log("Firestore: Session ID set successfully."))
        .catch(err => console.error("Firestore: Error setting session ID:", err));

      console.log(`Firestore: Subscribing to status for ${user.uid} in ${activeClass}`);
      const unsubscribe = onSnapshot(statusRef, (docSnap) => {
        console.log("Firestore: Received status snapshot.");
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.sessionId && data.sessionId !== sessionIdRef.current) {
            alert("Another session has started. You will be logged out.");
            stopSharing();
            signOut(auth);
          }
        }
      }, (error) => {
        console.error(`Firestore: Error subscribing to status for ${user.uid}:`, error);
      });

      return () => unsubscribe();
    }
  }, [user, activeClass, ipAddress, stopSharing]);



  useEffect(() => {
    if (!activeClass) return;

    const classRef = doc(db, "classes", activeClass);
    console.log(`Firestore: Subscribing to class document ${activeClass}`);
    const unsubscribe = onSnapshot(classRef, (docSnap) => {
      console.log("Firestore: Received class document snapshot.");
      if (docSnap.exists()) {
        const data = docSnap.data();
        setFrameRate(data.frameRate || 5);
        setImageQuality(data.imageQuality || 0.5);
        setMaxImageSize(data.maxImageSize || 1024 * 1024);
        setIsCapturing(data.isCapturing || false);
        setCaptureStartedAt(data.captureStartedAt || null);
      }
    }, (error) => {
      console.error(`Firestore: Error subscribing to class document ${activeClass}:`, error);
    });

    return () => unsubscribe();
  }, [activeClass]);

  // Listen for Custom Properties
  useEffect(() => {
    if (!activeClass || !user?.uid) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setClassProperties(null);
         
        setMyProperties(null);
        return;
    }

    const classPropsRef = doc(db, 'classes', activeClass, 'classProperties', 'config');
    console.log(`Firestore: Subscribing to class properties for ${activeClass}`);
    const unsubClassProps = onSnapshot(classPropsRef, (docSnap) => {
        console.log("Firestore: Received class properties snapshot.");
        setClassProperties(docSnap.exists() ? docSnap.data() : null);
    }, (error) => {
        console.error(`Firestore: Error subscribing to class properties for ${activeClass}:`, error);
    });

    const studentPropsRef = doc(db, 'classes', activeClass, 'studentProperties', user.uid);
    console.log(`Firestore: Subscribing to student properties for ${user.uid} in ${activeClass}`);
    const unsubStudentProps = onSnapshot(studentPropsRef, (docSnap) => {
        console.log("Firestore: Received student properties snapshot.");
        setMyProperties(docSnap.exists() ? docSnap.data() : null);
    }, (error) => {
        console.error(`Firestore: Error subscribing to student properties for ${user.uid}:`, error);
    });

    return () => {
        unsubClassProps();
        unsubStudentProps();
    };
  }, [activeClass, user]);

  // Listen for class-wide messages
  useEffect(() => {
    if (!activeClass) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setClassMessages([]);
      return;
    }

    const messagesRef = collection(db, 'classes', activeClass, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'desc'), limit(5));
    console.log(`Firestore: Subscribing to class messages for ${activeClass}`);
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      console.log("Firestore: Received class messages snapshot.");
      const messagesData = querySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, type: 'class' }));
      setClassMessages(messagesData);
    }, (error) => {
      console.error(`Firestore: Error subscribing to class messages for ${activeClass}:`, error);
    });

    return () => unsubscribe();
  }, [activeClass]);

  // Listen for direct student messages
  useEffect(() => {
    if (!user || !user.uid) return;

    const studentMessagesRef = collection(db, 'students', user.uid, 'messages');
    const q = query(studentMessagesRef, limit(5));
    console.log(`Firestore: Subscribing to direct messages for ${user.uid}`);
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      console.log("Firestore: Received direct messages snapshot.");
      const messagesData = querySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, type: 'direct' }));
      setDirectMessages(messagesData);
    }, (error) => {
      console.error(`Firestore: Error subscribing to direct messages for ${user.uid}:`, error);
    });

    return () => unsubscribe();
  }, [user]);

  // Handle notifications
  useEffect(() => {
    const allMessages = [...directMessages, ...classMessages];
    allMessages.sort((a, b) => {
      const timeA = a.timestamp?.toMillis() || 0;
      const timeB = b.timestamp?.toMillis() || 0;
      return timeB - timeA;
    });

    if (allMessages.length > 0) {
      const latestMessage = allMessages[0];
      if (latestMessage.timestamp) {
        const messageTimestamp = latestMessage.timestamp.toDate();
        const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);

        if (
          lastMessageTimestampRef.current?.getTime() !== messageTimestamp.getTime() &&
          messageTimestamp > oneHourAgo
        ) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
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
    console.log(`Firestore: Subscribing to irregularities for ${user.uid}`);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log("Firestore: Received irregularities snapshot.");
      const irregularitiesData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      setRecentIrregularities(irregularitiesData);
    }, (error) => {
      console.error(`Firestore: Error subscribing to irregularities for ${user.uid}:`, error);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (isSharing && isCapturing && videoRef.current && activeClass) {
      const now = Date.now();
      const startTime = captureStartedAt ? captureStartedAt.toDate().getTime() : now;
      const twoAndAHalfHours = 2.5 * 60 * 60 * 1000;

      if (now - startTime < twoAndAHalfHours) {
        intervalRef.current = setInterval(() => {
          captureAndUpload(videoRef.current, activeClass);
        }, frameRate * 1000);
      } else if (isCapturing) {
        const statusRef = doc(db, "classes", activeClass, "status", user.uid);
        console.log(`Firestore: Capture time expired, updating status for ${user.uid}`);
        setDoc(statusRef, { 
            isCapturing: false,
            reason: "Capture time limit reached."
        }, { merge: true })
          .then(() => {
            console.log("Firestore: Successfully updated student status to isCapturing: false.");
          })
          .catch(err => {
            console.error("Firestore: Failed to update student status after capture time expired.", err);
          });
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isSharing, isCapturing, frameRate, activeClass, captureStartedAt, captureAndUpload, user.uid]);

  return (
    <div className="student-view-container">
      <Banner message={notification} onClose={handleCloseNotification} />
      <div className="student-view-content">
        <div className="student-view-main">
            <div className="student-view-controls">
            {activeClass ? (
                <p>Class: <strong>{activeClass}</strong></p>
            ) : (
                <p>No active class.</p>
            )}

            {isSharing ? (
                <button onClick={stopSharing} className="student-view-button stop">Stop Sharing</button>
                ) : (
                <button onClick={startSharing} className="student-view-button">Share Screen</button>
            )}
            </div>

            {isCapturing && isSharing && <p className="recording-indicator">Your screen is being recorded, and please don't do anything sensitive!</p>}
            
            <video ref={videoRef} autoPlay muted className="video-preview" style={{ display: isSharing ? 'block' : 'none' }} />
        </div>
        <Sidebar 
          classProperties={classProperties} 
          myProperties={myProperties} 
          recentIrregularities={recentIrregularities} 
          ipAddress={ipAddress} 
          recentMessages={recentMessages} 
        />
      </div>
    </div>
  );
};

export default StudentView;