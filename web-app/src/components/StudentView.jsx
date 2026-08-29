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

  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isWebcamSharing, setIsWebcamSharing] = useState(false);
  const isSharing = isScreenSharing || isWebcamSharing;

  // Schedule-driven class state
  const { currentActiveClassId } = useStudentClassSchedule(user);
  const activeClass = currentActiveClassId;
  const [frameRate, setFrameRate] = useState(15);
  const [imageQuality, setImageQuality] = useState(0.5);
  const [maxImageSize, setMaxImageSize] = useState(0.1 * 1024 * 1024);
  const [captureMode, setCaptureMode] = useState('dual');
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureStartedAt, setCaptureStartedAt] = useState(null);
  const [retentionDays, setRetentionDays] = useState(30);
  const [recentIrregularities, setRecentIrregularities] = useState([]);
  const [directMessages, setDirectMessages] = useState([]);
  const [classMessages, setClassMessages] = useState([]);

  // Multi-camera selection
  const [availableWebcams, setAvailableWebcams] = useState([]);
  const [selectedWebcamId, setSelectedWebcamId] = useState('');

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
  const screenVideoRef = useRef(null);
  const webcamVideoRef = useRef(null);
  const screenStreamRef = useRef(null);
  const webcamStreamRef = useRef(null);
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

  const updateCaptureStatus = useCallback(async (activeStreams, classId) => {
    const targetClass = classId || activeClass;
    if (!targetClass || !user || !user.uid) return;
    const statusRef = doc(db, "classes", targetClass, "status", user.uid);
    try {
      await setDoc(statusRef, {
        isSharing: activeStreams.length > 0,
        activeStreams: activeStreams,
        email: user.email,
        name: user.displayName || user.email,
        timestamp: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error("Firestore: Error updating capture status: ", error);
    }
  }, [activeClass, user]);

  const stopScreen = useCallback(async () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = null;
    }
    setIsScreenSharing(false);
    const activeStreams = isWebcamSharing ? ['webcam'] : [];
    await updateCaptureStatus(activeStreams);
    showSystemNotification("Screen sharing has stopped.");
  }, [isWebcamSharing, updateCaptureStatus, showSystemNotification]);

  const stopWebcam = useCallback(async () => {
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(track => track.stop());
      webcamStreamRef.current = null;
    }
    if (webcamVideoRef.current) {
      webcamVideoRef.current.srcObject = null;
    }
    setIsWebcamSharing(false);
    const activeStreams = isScreenSharing ? ['screen'] : [];
    await updateCaptureStatus(activeStreams);
    showSystemNotification("Webcam stream has stopped.");
  }, [isScreenSharing, updateCaptureStatus, showSystemNotification]);

  const stopAllStreams = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(track => track.stop());
      webcamStreamRef.current = null;
    }
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
    if (webcamVideoRef.current) webcamVideoRef.current.srcObject = null;
    setIsScreenSharing(false);
    setIsWebcamSharing(false);
    await updateCaptureStatus([]);
  }, [updateCaptureStatus]);

  const refreshWebcams = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices
        .filter(device => device.kind === 'videoinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${index + 1}`
        }));
      setAvailableWebcams(videoDevices);
      if (videoDevices.length > 0) {
        setSelectedWebcamId(prev => {
          if (prev && videoDevices.some(d => d.deviceId === prev)) return prev;
          return videoDevices[0].deviceId;
        });
      }
    } catch (err) {
      console.error("Error enumerating video devices:", err);
    }
  }, []);

  useEffect(() => {
    refreshWebcams();
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', refreshWebcams);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', refreshWebcams);
      };
    }
  }, [refreshWebcams]);

  const startWebcam = useCallback(async (targetDeviceId) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Webcam is not supported by your browser.");
      return;
    }

    // Stop existing webcam track if any
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(track => track.stop());
      webcamStreamRef.current = null;
    }

    const deviceIdToUse = targetDeviceId || selectedWebcamId;
    const constraints = {
      video: deviceIdToUse ? { deviceId: { exact: deviceIdToUse } } : true
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = stream;
      }
      webcamStreamRef.current = stream;
      setIsWebcamSharing(true);
      if (deviceIdToUse) setSelectedWebcamId(deviceIdToUse);

      // Re-enumerate to get human-readable labels now that camera permission is granted
      refreshWebcams();

      const activeStreams = ['webcam', ...(isScreenSharing ? ['screen'] : [])];
      await updateCaptureStatus(activeStreams);

      stream.getVideoTracks()[0].onended = () => {
        stopWebcam();
      };
    } catch (err) {
      console.error("Error starting webcam:", err);
      alert("Could not start webcam. Please grant camera permission.");
    }
  }, [selectedWebcamId, isScreenSharing, updateCaptureStatus, stopWebcam, refreshWebcams]);

  const handleWebcamChange = (e) => {
    const newDeviceId = e.target.value;
    setSelectedWebcamId(newDeviceId);
    if (isWebcamSharing) {
      startWebcam(newDeviceId);
    }
  };

  const startScreen = useCallback(async () => {
    if ('Notification' in window && window.Notification.permission !== 'granted') {
      try {
        await window.Notification.requestPermission();
      } catch (err) {
        console.error('Error requesting notification permission:', err);
      }
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      alert("Screen sharing is not supported by your browser. Please use Chrome, Firefox, or Edge.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream;
      }
      screenStreamRef.current = stream;
      setIsScreenSharing(true);
      const activeStreams = ['screen', ...(isWebcamSharing ? ['webcam'] : [])];
      await updateCaptureStatus(activeStreams, activeClass);
      showSystemNotification("Screen recording has started.");

      if (captureMode === 'dual' && !isWebcamSharing) {
        await startWebcam();
      }

      stream.getVideoTracks()[0].onended = () => {
        stopScreen();
      };
    } catch (error) {
      console.error("Error starting screen sharing:", error);
      setIsScreenSharing(false);
      alert("Could not start screen sharing. Please grant permission.");
    }
  }, [activeClass, captureMode, isWebcamSharing, showSystemNotification, startWebcam, stopScreen, updateCaptureStatus]);

  const captureVideoElement = useCallback((videoElement, channelName, targetClass) => {
    if (!user || !user.uid || !videoElement || videoElement.readyState < 2 || videoElement.videoWidth === 0) {
      return;
    }

    const MAX_CAPTURE_WIDTH = 1920;
    let targetWidth = videoElement.videoWidth;
    let targetHeight = videoElement.videoHeight;
    if (targetWidth > MAX_CAPTURE_WIDTH) {
      targetHeight = Math.round((targetHeight * MAX_CAPTURE_WIDTH) / targetWidth);
      targetWidth = MAX_CAPTURE_WIDTH;
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, targetWidth, targetHeight);

    // Screen solid color verification
    if (channelName === 'screen' && canvas.width > 1 && canvas.height > 1) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const isSolid = () => {
        const r = data[0], g = data[1], b = data[2];
        const points = [
          0,
          (canvas.width - 1) * 4,
          (canvas.height - 1) * canvas.width * 4,
          ((canvas.height - 1) * canvas.width + (canvas.width - 1)) * 4,
          (Math.floor(canvas.height / 2) * canvas.width + Math.floor(canvas.width / 2)) * 4
        ];
        for (const pt of points) {
          if (pt < data.length && (data[pt] !== r || data[pt+1] !== g || data[pt+2] !== b)) {
            return false;
          }
        }
        return true;
      };

      if (isSolid()) {
        console.warn("Screen capture appears to be a solid black frame.");
        return;
      }
    }

    const MAX_SIZE_BYTES = maxImageSize;

    const attemptUpload = (currentCanvas, quality) => {
      currentCanvas.toBlob(async (blob) => {
        if (!blob) return;

        if (blob.size > MAX_SIZE_BYTES) {
          if (quality > 0.2) {
            attemptUpload(currentCanvas, quality - 0.1);
          } else {
            const scale = Math.sqrt(MAX_SIZE_BYTES / blob.size) * 0.9;
            const newCanvas = document.createElement('canvas');
            newCanvas.width = currentCanvas.width * scale;
            newCanvas.height = currentCanvas.height * scale;
            const newCtx = newCanvas.getContext('2d');
            newCtx.drawImage(currentCanvas, 0, 0, newCanvas.width, newCanvas.height);
            attemptUpload(newCanvas, 0.9);
          }
        } else {
          const timestamp = Date.now();
          const screenshotRef = ref(storage, `screenshots/${targetClass}/${user.uid}/${channelName}_${timestamp}.jpg`);
          try {
            await uploadBytes(screenshotRef, blob);
            const expireAtDate = new Date(Date.now() + (retentionDays || 30) * 24 * 60 * 60 * 1000);
            await addDoc(collection(db, 'screenshots'), {
              classId: targetClass,
              studentUid: user.uid,
              email: user.email.toLowerCase(),
              channel: channelName,
              imagePath: screenshotRef.fullPath,
              size: blob.size,
              timestamp: serverTimestamp(),
              expireAt: expireAtDate,
              deleted: false,
              ipAddress: ipAddress,
            });

            const statusRef = doc(db, "classes", targetClass, "status", user.uid);
            const statusUpdate = {
              timestamp: serverTimestamp(),
              email: user.email.toLowerCase()
            };
            if (channelName === 'screen') {
              statusUpdate.latestScreenPath = screenshotRef.fullPath;
              statusUpdate.latestImagePath = screenshotRef.fullPath; // Backwards compatibility
            } else {
              statusUpdate.latestWebcamPath = screenshotRef.fullPath;
            }
            await setDoc(statusRef, statusUpdate, { merge: true });
          } catch (err) {
            console.error(`Error uploading ${channelName} snapshot:`, err);
          }
        }
      }, 'image/jpeg', quality);
    };

    attemptUpload(canvas, imageQuality);
  }, [user, maxImageSize, imageQuality, retentionDays, ipAddress]);

  const captureAndUploadAllChannels = useCallback((targetClass) => {
    if (!targetClass) return;
    if (isScreenSharing && screenVideoRef.current) {
      captureVideoElement(screenVideoRef.current, 'screen', targetClass);
    }
    if (isWebcamSharing && webcamVideoRef.current) {
      captureVideoElement(webcamVideoRef.current, 'webcam', targetClass);
    }
  }, [isScreenSharing, isWebcamSharing, captureVideoElement]);

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
      setDoc(statusRef, statusData, { merge: true })
        .catch(err => console.error("Firestore: Error setting session ID:", err));

      const unsubscribe = onSnapshot(statusRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.sessionId && data.sessionId !== sessionIdRef.current) {
            alert("Another session has started. You will be logged out.");
            stopAllStreams();
            signOut(auth);
          }
        }
      }, (error) => {
        console.error(`Firestore: Error subscribing to status for ${user.uid}:`, error);
      });

      return () => unsubscribe();
    }
  }, [user, activeClass, ipAddress, stopAllStreams]);

  useEffect(() => {
    if (!activeClass) return;

    const classRef = doc(db, "classes", activeClass);
    const unsubscribe = onSnapshot(classRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setFrameRate(prev => (data.frameRate !== undefined && data.frameRate !== prev ? data.frameRate : (prev || 15)));
        setImageQuality(prev => (data.imageQuality !== undefined && data.imageQuality !== prev ? data.imageQuality : (prev || 0.5)));
        setMaxImageSize(prev => (data.maxImageSize !== undefined && data.maxImageSize !== prev ? data.maxImageSize : (prev || 0.1 * 1024 * 1024)));
        setCaptureMode(prev => (data.captureMode && data.captureMode !== prev ? data.captureMode : (prev || 'dual')));
        setIsCapturing(prev => (data.isCapturing !== undefined && data.isCapturing !== prev ? data.isCapturing : (prev || false)));
        setCaptureStartedAt(prev => {
          if (!data.captureStartedAt) return null;
          const prevMs = prev?.toMillis ? prev.toMillis() : (prev?.seconds ? prev.seconds * 1000 : null);
          const newMs = data.captureStartedAt.toMillis ? data.captureStartedAt.toMillis() : (data.captureStartedAt.seconds ? data.captureStartedAt.seconds * 1000 : null);
          return prevMs === newMs ? prev : data.captureStartedAt;
        });
        setRetentionDays(prev => (data.retentionDays !== undefined && data.retentionDays !== prev ? data.retentionDays : (prev || 30)));
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
    const q = query(studentMessagesRef, orderBy('timestamp', 'desc'), limit(10));
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

  // Handle notifications & warnings
  useEffect(() => {
    const allAlerts = [
      ...directMessages.map(m => ({ text: m.message, timestamp: m.timestamp, id: m.id })),
      ...classMessages.map(m => ({ text: `📢 ${m.message}`, timestamp: m.timestamp, id: m.id })),
      ...recentIrregularities.map(ir => ({ text: `⚠️ Warning: ${ir.title || 'Irregularity Detected'}${ir.message ? ` — ${ir.message}` : ''}`, timestamp: ir.timestamp, id: ir.id }))
    ];

    allAlerts.sort((a, b) => {
      const timeA = a.timestamp?.toMillis ? a.timestamp.toMillis() : (a.timestamp?.seconds ? a.timestamp.seconds * 1000 : 0);
      const timeB = b.timestamp?.toMillis ? b.timestamp.toMillis() : (b.timestamp?.seconds ? b.timestamp.seconds * 1000 : 0);
      return timeB - timeA;
    });

    if (allAlerts.length > 0) {
      const latestAlert = allAlerts[0];
      if (latestAlert.timestamp) {
        const alertTimestamp = latestAlert.timestamp.toDate ? latestAlert.timestamp.toDate() : new Date(latestAlert.timestamp.seconds * 1000);
        const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);

        if (
          lastMessageTimestampRef.current?.getTime() !== alertTimestamp.getTime() &&
          alertTimestamp > oneHourAgo
        ) {
          setNotification(latestAlert.text);
          setTimeout(() => showSystemNotification(latestAlert.text), 0);
          lastMessageTimestampRef.current = alertTimestamp;
        }
      }
    }
  }, [directMessages, classMessages, recentIrregularities, showSystemNotification]);

  useEffect(() => {
    if (!user || !user.uid) return;

    const irregularitiesRef = collection(db, "irregularities");
    const q = query(
      irregularitiesRef,
      where("studentUid", "==", user.uid),
      orderBy("timestamp", "desc"),
      limit(10)
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

  const captureAndUploadAllChannelsRef = useRef(captureAndUploadAllChannels);
  useEffect(() => {
    captureAndUploadAllChannelsRef.current = captureAndUploadAllChannels;
  }, [captureAndUploadAllChannels]);

  const lastCaptureTimeRef = useRef(0);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (isSharing && isCapturing && activeClass) {
      const now = Date.now();
      const startTime = captureStartedAt ? (captureStartedAt.toMillis ? captureStartedAt.toMillis() : (captureStartedAt.toDate ? captureStartedAt.toDate().getTime() : now)) : now;
      const twoAndAHalfHours = 2.5 * 60 * 60 * 1000;

      if (now - startTime < twoAndAHalfHours) {
        const intervalMs = Math.max(1, (frameRate || 15)) * 1000;

        // Perform capture if enough time has passed since last capture or on first run
        if (now - lastCaptureTimeRef.current >= intervalMs) {
          lastCaptureTimeRef.current = now;
          captureAndUploadAllChannelsRef.current(activeClass);
        }

        intervalRef.current = setInterval(() => {
          lastCaptureTimeRef.current = Date.now();
          captureAndUploadAllChannelsRef.current(activeClass);
        }, intervalMs);
      } else if (isCapturing && user?.uid) {
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
        intervalRef.current = null;
      }
    };
  }, [isSharing, isCapturing, frameRate, activeClass, captureStartedAt, user?.uid]);

  return (
    <div className="student-view-container">
      <Banner message={notification} onClose={handleCloseNotification} />
      <div className="student-view-content">
        <div className="student-view-main">
            <div className="student-view-controls">
              <div>
                {activeClass ? (
                    <p>Class: <strong>{activeClass}</strong></p>
                ) : (
                    <p>No active class.</p>
                )}
              </div>

              <div className="stream-controls-group">
                {isScreenSharing ? (
                  <button onClick={stopScreen} className="student-view-button active">
                    ⏹️ Stop Screen
                  </button>
                ) : (
                  <button onClick={startScreen} className="student-view-button">
                    🖥️ Share Screen
                  </button>
                )}

                <div className="webcam-controls-container">
                  {isWebcamSharing ? (
                    <button onClick={stopWebcam} className="student-view-button active">
                      ⏹️ Stop Webcam
                    </button>
                  ) : (
                    <button onClick={() => startWebcam()} className="student-view-button">
                      📷 Start Webcam
                    </button>
                  )}

                  {availableWebcams.length > 1 && (
                    <select
                      value={selectedWebcamId}
                      onChange={handleWebcamChange}
                      className="webcam-select-dropdown"
                      aria-label="Select Webcam"
                      title="Select Webcam"
                    >
                      {availableWebcams.map((cam, index) => (
                        <option key={cam.deviceId || index} value={cam.deviceId}>
                          📷 {cam.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>

            {isCapturing && isSharing && (
              <p className="recording-indicator">
                🔴 Live invigilation active: Capturing every {frameRate}s (Quality optimized).
              </p>
            )}
            
            <div className="video-previews-container">
              <div className="video-preview-wrapper" style={{ display: isScreenSharing ? 'block' : 'none' }}>
                <span className="video-preview-tag">🖥️ Screen</span>
                <video ref={screenVideoRef} autoPlay muted playsInline className="video-preview" />
              </div>
              <div className="video-preview-wrapper" style={{ display: isWebcamSharing ? 'block' : 'none' }}>
                <span className="video-preview-tag">📷 Webcam</span>
                <video ref={webcamVideoRef} autoPlay muted playsInline className="video-preview" />
              </div>
              {!isSharing && (
                <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--color-text-muted, #64748b)', gridColumn: '1 / -1' }}>
                  <p style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>Streams Inactive</p>
                  <p style={{ margin: '0.4rem 0 0', fontSize: '0.85rem' }}>Click "Share Screen" or "Start Webcam" above to begin streaming to your instructor.</p>
                </div>
              )}
            </div>
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