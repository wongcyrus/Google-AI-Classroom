
import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, deleteDoc, writeBatch, updateDoc, query, where, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase-config';
import { signOut } from 'firebase/auth';
import StudentScreen from './StudentScreen';
import ClassManagement from './ClassManagement';
import { Link, Navigate } from 'react-router-dom';

const TeacherView = ({ user }) => {
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [classList, setClassList] = useState([]);
  const [studentStatuses, setStudentStatuses] = useState([]);
  const [message, setMessage] = useState('');
  const [frameRate, setFrameRate] = useState(5);
  const [isCapturing, setIsCapturing] = useState(false);
  const [role, setRole] = useState(null);

  useEffect(() => {
    const checkRole = async () => {
        if (user) {
            const idTokenResult = await user.getIdTokenResult(true);
            setRole(idTokenResult.claims.role);
        }
    };
    checkRole();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const classesRef = collection(db, "classes");
    const q = query(classesRef, where("teachers", "array-contains", user.email));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const classesData = [];
      querySnapshot.forEach((doc) => {
        classesData.push({ id: doc.id, ...doc.data() });
      });
      setClasses(classesData);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!selectedClass) {
      setClassList([]);
      setStudentStatuses([]);
      return;
    }

    const classRef = doc(db, "classes", selectedClass);
    const unsubscribeClass = onSnapshot(classRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setClassList(data.students || []);
        setFrameRate(data.frameRate || 5);
        setIsCapturing(data.isCapturing || false);
      } else {
        setClassList([]);
      }
    });

    const statusRef = collection(db, 'classes', selectedClass, 'status');
    const unsubscribeStatus = onSnapshot(statusRef, (querySnapshot) => {
        const statuses = [];
        querySnapshot.forEach((doc) => {
            statuses.push({ id: doc.id, ...doc.data() });
        });
        setStudentStatuses(statuses);
    });

    return () => {
        unsubscribeClass();
        unsubscribeStatus();
    };
  }, [selectedClass]);

  const handleLogout = () => {
    signOut(auth);
  };

  const handleDeleteClass = async () => {
    if (!selectedClass) {
      alert("Please select a class to delete.");
      return;
    }

    if (window.confirm(`Are you sure you want to delete the class "${selectedClass}"? This action cannot be undone.`)) {
      try {
        const classRef = doc(db, "classes", selectedClass);
        await deleteDoc(classRef);
        
        // Note: The cleanup of the student's class subcollection is removed for now
        // to prevent crashes and will be addressed in a future update.

        setSelectedClass(null); // Reset selection
        console.log("Class deleted successfully.");

      } catch (error) {
        console.error("Error deleting class: ", error);
        alert("Error deleting class: " + error.message);
      }
    }
  };

  const handleSendMessage = async () => {
    if (!selectedClass || !message.trim()) return;
    const messagesRef = collection(db, 'classes', selectedClass, 'messages');
    await addDoc(messagesRef, {
      message,
      timestamp: serverTimestamp(),
    });
    setMessage('');
  };

  const handleFrameRateChange = async (e) => {
    const newRate = parseInt(e.target.value, 10);
    setFrameRate(newRate);
    if (selectedClass) {
      const classRef = doc(db, 'classes', selectedClass);
      await updateDoc(classRef, { frameRate: newRate });
    }
  };

  const toggleCapture = async () => {
    if (!selectedClass) return;
    const classRef = doc(db, 'classes', selectedClass);
    const newIsCapturing = !isCapturing;
    await updateDoc(classRef, { 
      isCapturing: newIsCapturing,
      captureStartedAt: newIsCapturing ? serverTimestamp() : null 
    });
    setIsCapturing(newIsCapturing);
  };

  const getStudentStatus = (email) => {
    return studentStatuses.find(s => s.email === email);
  }

  // This is the added security check
  if (role && role !== 'teacher') {
    return <Navigate to="/login" />;
  }

  return (
    <div>
      <h1>Teacher View</h1>
      <ClassManagement user={user} />
      <hr />
      <div>
        <h3>Select a Class to View</h3>
        <select onChange={(e) => setSelectedClass(e.target.value)} value={selectedClass || ''}>
          <option value="" disabled>Select a class</option>
          {classes.map(c => (
            <option key={c.id} value={c.id}>{c.id}</option>
          ))}
        </select>
        {selectedClass && (
          <>
            <button onClick={handleDeleteClass} style={{ marginLeft: '10px' }}>Delete Class</button>
            <Link to={`/monitor/${selectedClass}`}>
                <button style={{ marginLeft: '10px' }}>Monitor</button>
            </Link>
          </>
        )}
      </div>
      {selectedClass && (
        <div>
          <hr />
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
      )}
      <hr />
      <div className="student-screens">
        {selectedClass && classList.map(studentEmail => {
            const student = { email: studentEmail, id: getStudentStatus(studentEmail)?.id || studentEmail };
            const status = getStudentStatus(studentEmail);
            return (
                <StudentScreen 
                    key={student.id} 
                    student={student} 
                    classId={selectedClass}
                    isSharing={status?.isSharing || false}
                />
            );
        })}
      </div>
      <button onClick={handleLogout}>Logout</button>
    </div>
  );
};

export default TeacherView;
