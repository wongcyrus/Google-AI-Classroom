
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase-config';
import StudentScreen from './StudentScreen';

const MonitorView = () => {
  const { classId } = useParams();
  const [classData, setClassData] = useState(null);
  const [students, setStudents] = useState([]);
  const [fullStudents, setFullStudents] = useState([]);
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [frameRate, setFrameRate] = useState(5);

  useEffect(() => {
    if (!classId) return;

    const classRef = doc(db, "classes", classId);
    const unsubscribe = onSnapshot(classRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setClassData(data);
        setStudents(data.students || []);
        setFrameRate(data.frameRate || 5);
      } else {
        console.log("No such document!");
      }
    });

    return () => unsubscribe();
  }, [classId]);

  useEffect(() => {
    if (students.length === 0) {
        setFullStudents([]);
        return;
    }

    const fetchStudents = async () => {
        const studentsRef = collection(db, 'students');
        const q = query(studentsRef, where('email', 'in', students));
        const querySnapshot = await getDocs(q);
        const studentData = [];
        querySnapshot.forEach((doc) => {
            studentData.push({ id: doc.id, ...doc.data() });
        });
        setFullStudents(studentData);
    };

    fetchStudents();
  }, [students]);

  const handleSendMessage = async () => {
    if (!classId || !broadcastMessage) {
      alert("Please enter a message.");
      return;
    }
    try {
      const messagesRef = collection(db, 'classes', classId, 'messages');
      await addDoc(messagesRef, {
        message: broadcastMessage,
        timestamp: serverTimestamp(),
      });
      setBroadcastMessage('');
      console.log("Broadcast message sent.");
    } catch (error) {
      console.error("Error sending broadcast message: ", error);
      alert("Error sending broadcast message: " + error.message);
    }
  };

  const handleFrameRateChange = async (e) => {
    const newFrameRate = parseInt(e.target.value, 10);
    setFrameRate(newFrameRate);
    try {
      const classRef = doc(db, "classes", classId);
      await updateDoc(classRef, { frameRate: newFrameRate });
    } catch (error) {
      console.error("Error updating frame rate: ", error);
      alert("Error updating frame rate: " + error.message);
    }
  };

  return (
    <div>
      <Link to="/teacher">Back to Teacher View</Link>
      <h1>Monitoring Class: {classId}</h1>
      
      <div>
        <h3>Broadcast Message</h3>
        <input 
          type="text" 
          value={broadcastMessage}
          onChange={(e) => setBroadcastMessage(e.target.value)}
          placeholder="Send a message to the whole class"
        />
        <button onClick={handleSendMessage}>Send</button>
      </div>

      <hr />

      <div>
        <h3>Screen Capture Framerate</h3>
        <label>Delay (seconds): {frameRate}</label>
        <input 
          type="range" 
          min="1" 
          max="60" 
          value={frameRate}
          onChange={handleFrameRateChange}
        />
      </div>

      <hr />

      <h2>Student Screens</h2>
      <div className="student-screens">
        {fullStudents.map(student => (
          <StudentScreen key={student.id} student={student} classId={classId} />
        ))}
      </div>
    </div>
  );
};

export default MonitorView;
