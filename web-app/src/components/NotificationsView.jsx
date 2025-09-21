import { useState, useEffect } from 'react';
import { db } from '../firebase-config';
import { collection, doc, onSnapshot, query, where, orderBy, limit, getDocs, startAfter, endBefore, limitToLast } from 'firebase/firestore';

const PAGE_SIZE = 10;

const NotificationsView = ({ classId }) => {
  const [messages, setMessages] = useState([]);
  const [teacherEmail, setTeacherEmail] = useState(null);
  
  const [startTime, setStartTime] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() - 2);
    return d;
  });
  const [endTime, setEndTime] = useState(new Date());

  const [firstDoc, setFirstDoc] = useState(null);
  const [lastDoc, setLastDoc] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // Effect to get the teacher's email
  useEffect(() => {
    const classRef = doc(db, "classes", classId);
    const unsubscribe = onSnapshot(classRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setTeacherEmail(data.teacher || (data.teachers && data.teachers[0]));
      }
    });
    return () => unsubscribe();
  }, [classId]);

  const fetchMessages = async (direction = 'initial') => {
    if (!teacherEmail) return;
    setLoading(true);

    const messagesRef = collection(db, "teachers", teacherEmail, "messages");
    let q = query(messagesRef, where("classId", "==", classId), where("timestamp", ">=", startTime), where("timestamp", "<=", endTime), orderBy("timestamp", "desc"));

    switch (direction) {
      case 'next':
        q = query(q, startAfter(lastDoc), limit(PAGE_SIZE));
        break;
      case 'prev':
        q = query(q, endBefore(firstDoc), limitToLast(PAGE_SIZE));
        break;
      default:
        q = query(q, limit(PAGE_SIZE));
        break;
    }

    try {
      const querySnapshot = await getDocs(q);
      const newMessages = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      if (newMessages.length > 0) {
        setMessages(newMessages);
        setFirstDoc(querySnapshot.docs[0]);
        setLastDoc(querySnapshot.docs[querySnapshot.docs.length - 1]);
        if (direction === 'next') setPage(p => p + 1);
        if (direction === 'prev') setPage(p => p - 1);
      } else {
        // Handle no more documents in the requested direction
        if (direction === 'next') alert("No more notifications.");
        if (direction === 'prev') alert("This is the first page.");
      }
    } catch (error) {
      console.error("Error fetching messages: ", error);
    }

    setLoading(false);
  };

  // Effect to fetch messages for display in the UI
  useEffect(() => {
    setPage(1);
    setFirstDoc(null);
    setLastDoc(null);
    fetchMessages('initial');
  }, [teacherEmail, classId, startTime, endTime]);

  return (
    <div>
      <h2>Notifications</h2>
      <div className="filters">
        <label htmlFor="start-time">Show since: </label>
        <input
          type="datetime-local"
          id="start-time"
          value={(() => {
            const d = new Date(startTime);
            const year = d.getFullYear();
            const month = (d.getMonth() + 1).toString().padStart(2, '0');
            const day = d.getDate().toString().padStart(2, '0');
            const hours = d.getHours().toString().padStart(2, '0');
            const minutes = d.getMinutes().toString().padStart(2, '0');
            return `${year}-${month}-${day}T${hours}:${minutes}`;
          })()}
          onChange={e => setStartTime(new Date(e.target.value))}
        />
        <label htmlFor="end-time"> until: </label>
        <input
          type="datetime-local"
          id="end-time"
          value={(() => {
            const d = new Date(endTime);
            const year = d.getFullYear();
            const month = (d.getMonth() + 1).toString().padStart(2, '0');
            const day = d.getDate().toString().padStart(2, '0');
            const hours = d.getHours().toString().padStart(2, '0');
            const minutes = d.getMinutes().toString().padStart(2, '0');
            return `${year}-${month}-${day}T${hours}:${minutes}`;
          })()}
          onChange={e => setEndTime(new Date(e.target.value))}
        />
      </div>
      <hr />
      {messages.length === 0 ? (
        <p>No notifications match the current filter.</p>
      ) : (
        <ul className="progress-list">
          {messages.map(msg => (
            <li key={msg.id} className="progress-item">
              <strong>{new Date(msg.timestamp?.toDate()).toLocaleString()}:</strong> {msg.message}
            </li>
          ))}
        </ul>
      )}
      <div className="pagination-controls">
        <button onClick={() => fetchMessages('prev')} disabled={loading || page <= 1}>
          Previous
        </button>
        <span style={{ margin: '0 10px' }}>Page {page}</span>
        <button onClick={() => fetchMessages('next')} disabled={loading || messages.length < PAGE_SIZE}>
          Next
        </button>
      </div>
    </div>
  );
};

export default NotificationsView;