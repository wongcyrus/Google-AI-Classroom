import { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase-config';
import { collection, query, where, orderBy, limit, getDocs, startAfter, endBefore, limitToLast } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import './SharedViews.css';
import DateRangeFilter from './DateRangeFilter';
import { useClassSchedule } from '../hooks/useClassSchedule';

const PAGE_SIZE = 10;

const NotificationsView = ({ user }) => {
  const { classId } = useParams();
  const [messages, setMessages] = useState([]);
  
  const {
    lessons,
    selectedLesson,
    startTime,
    endTime,
    setStartTime,
    setEndTime,
    handleLessonChange,
  } = useClassSchedule(classId);

  const [firstDoc, setFirstDoc] = useState(null);
  const [lastDoc, setLastDoc] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [isLastPage, setIsLastPage] = useState(false);


  const fetchMessages = useCallback(async (direction = 'initial') => {
    if (!user || !user.uid) return;
    setLoading(true);

    const messagesRef = collection(db, "teachers", user.uid, "messages");
    let q = query(messagesRef, where("classId", "==", classId), where("timestamp", ">=", new Date(startTime)), where("timestamp", "<=", new Date(endTime)), orderBy("timestamp", "desc"));

    if (direction === 'initial') {
        setPage(1);
        setIsLastPage(false);
    }

    switch (direction) {
      case 'next':
        q = query(q, startAfter(lastDoc), limit(PAGE_SIZE));
        break;
      case 'prev':
        q = query(q, endBefore(firstDoc), limitToLast(PAGE_SIZE));
        break;
      default: // initial
        q = query(q, limit(PAGE_SIZE));
        break;
    }

    try {
      const querySnapshot = await getDocs(q);
      const newMessages = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      if (newMessages.length > 0) {
        if (direction === 'prev') newMessages.reverse();
        setMessages(newMessages);
        setFirstDoc(querySnapshot.docs[0]);
        setLastDoc(querySnapshot.docs[querySnapshot.docs.length - 1]);
        setIsLastPage(querySnapshot.docs.length < PAGE_SIZE);
      } else {
        if (direction === 'initial') setMessages([]);
        setIsLastPage(true);
      }
    } catch (error) {
      console.error("Error fetching messages: ", error);
    }

    setLoading(false);
  }, [user, classId, startTime, endTime, lastDoc, firstDoc]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchMessages('initial');
  }, [fetchMessages]);

  const handleNext = () => {
    if (!isLastPage) {
        setPage(p => p + 1);
        fetchMessages('next');
    }
  };

  const handlePrev = () => {
      if (page > 1) {
          setPage(p => p - 1);
          fetchMessages('prev');
      }
  };

  return (
    <div className="view-container">
        <div className="view-header">
            <h2>Notifications</h2>
        </div>
        <DateRangeFilter 
            startTime={startTime}
            endTime={endTime}
            onStartTimeChange={setStartTime}
            onEndTimeChange={setEndTime}
            loading={loading}
            lessons={lessons}
            selectedLesson={selectedLesson}
            onLessonChange={handleLessonChange}
        />
        <div className="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Timestamp</th>
                        <th>Message</th>
                    </tr>
                </thead>
                <tbody>
                    {loading ? (
                        <tr><td colSpan="2">Loading...</td></tr>
                    ) : messages.length > 0 ? (
                        messages.map(msg => (
                            <tr key={msg.id}>
                                <td>{new Date(msg.timestamp?.toDate()).toLocaleString()}</td>
                                <td>{msg.message}</td>
                            </tr>
                        ))
                    ) : (
                        <tr><td colSpan="2">No notifications match the current filter.</td></tr>
                    )}
                </tbody>
            </table>
        </div>
        <div className="pagination-controls">
            <button onClick={handlePrev} disabled={loading || page <= 1}>
            Previous
            </button>
            <span>Page {page}</span>
            <button onClick={handleNext} disabled={loading || isLastPage}>
            Next
            </button>
        </div>
    </div>
  );
};

export default NotificationsView;
