
import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { db, storage } from '../firebase-config';
import { collection, query, where, onSnapshot, orderBy, limit, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import StudentScreen from './StudentScreen';

const MonitorView = () => {
  const { classId } = useParams();
  const [students, setStudents] = useState([]);
  const [screenshots, setScreenshots] = useState({});
  const [message, setMessage] = useState('');
  const [frameRate, setFrameRate] = useState(5);
  const [isCapturing, setIsCapturing] = useState(false);

  useEffect(() => {
    if (!classId) return;

    const classRef = doc(db, "classes", classId);
    const unsubscribeClass = onSnapshot(classRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            setFrameRate(data.frameRate || 5);
            setIsCapturing(data.isCapturing || false);
        }
    });

    const statusQuery = query(collection(db, 'classes', classId, 'status'));
    const unsubscribeStatus = onSnapshot(statusQuery, (snapshot) => {
      const studentList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStudents(studentList);
    });

    return () => {
        unsubscribeClass();
        unsubscribeStatus();
    }
  }, [classId]);

  useEffect(() => {
    if (students.length === 0) return;

    const unsubscribes = students.map(student => {
      const screenshotsQuery = query(
        collection(db, 'screenshots'),
        where('classId', '==', classId),
        where('studentId', '==', student.id),
        orderBy('timestamp', 'desc'),
        limit(1)
      );

      return onSnapshot(screenshotsQuery, async (snapshot) => {
        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          const imagePath = doc.data().imagePath;
          try {
            const url = await getDownloadURL(ref(storage, imagePath));
            setScreenshots(prev => ({ ...prev, [student.id]: url }));
          } catch (error) {
            console.error("Error getting download URL: ", error);
          }
        }
      });
    });

    return () => unsubscribes.forEach(unsub => unsub());

  }, [students, classId]);

  const handleSendMessage = async () => {
    if (!classId || !message.trim()) return;
    const messagesRef = collection(db, 'classes', classId, 'messages');
    await addDoc(messagesRef, {
      message,
      timestamp: serverTimestamp(),
    });
    setMessage('');
  };

  const handleFrameRateChange = async (e) => {
    const newRate = parseInt(e.target.value, 10);
    setFrameRate(newRate);
    if (classId) {
      const classRef = doc(db, 'classes', classId);
      await updateDoc(classRef, { frameRate: newRate });
    }
  };

  const toggleCapture = async () => {
    if (!classId) return;
    const classRef = doc(db, 'classes', classId);
    const newIsCapturing = !isCapturing;
    await updateDoc(classRef, { 
      isCapturing: newIsCapturing,
      captureStartedAt: newIsCapturing ? serverTimestamp() : null 
    });
    setIsCapturing(newIsCapturing);
  };

  return (
    <div className="monitor-view">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1>Monitoring Class: {classId}</h1>
        <Link to="/teacher">
            <button>Back to Main View</button>
        </Link>
      </div>
      
      <div>
        <h3>Class Controls</h3>
        <div>
          <input 
            type="text" 
            value={message} 
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Broadcast a message"
          />
          <button onClick={handleSendMessage}>Send</button>
        </div>
        <div style={{ margin: '10px 0' }}>
          <label>
            Frame Rate (seconds): {frameRate}
            <input 
              type="range" 
              min="1" 
              max="60" 
              value={frameRate} 
              onChange={handleFrameRateChange} 
            />
          </label>
        </div>
        <div>
          <button onClick={toggleCapture}>
            {isCapturing ? 'Stop Capture' : 'Start Capture'}
          </button>
        </div>
      </div>

      <hr />

      <div className="students-container">
        {students.map(student => (
          <StudentScreen
            key={student.id}
            student={student}
            isSharing={student.isSharing}
            screenshotUrl={screenshots[student.id]}
          />
        ))}
      </div>
    </div>
  );
};

export default MonitorView;
