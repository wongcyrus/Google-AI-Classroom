import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { db } from '../firebase-config';
import { collection, doc, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import MonitorView from './MonitorView';
import IrregularitiesView from './IrregularitiesView';
import ProgressView from './ProgressView';
import './ClassView.css';

const ClassView = ({ setTitle }) => {
  const { classId } = useParams();
  const [activeTab, setActiveTab] = useState('monitor');
  const [messages, setMessages] = useState([]);
  const [teacherEmail, setTeacherEmail] = useState(null);
  const isInitialMessagesLoad = useRef(true);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    setTitle(`Class: ${classId}`);
    const classRef = doc(db, "classes", classId);

    const unsubscribeClass = onSnapshot(classRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const teacher = data.teacher || (data.teachers && data.teachers[0]);
        setTeacherEmail(teacher);
      }
    });

    setMessages([]);
    isInitialMessagesLoad.current = true;

    return () => unsubscribeClass();
  }, [classId, setTitle]);

  useEffect(() => {
    if (!teacherEmail) return;

    const messagesRef = collection(db, "teachers", teacherEmail, "messages");
    const q = query(messagesRef, where("classId", "==", classId), orderBy("timestamp", "asc"));

    const unsubscribeMessages = onSnapshot(q, (querySnapshot) => {
      const newMessages = [];
      querySnapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const messageData = { id: change.doc.id, ...change.doc.data() };
          newMessages.push(messageData);

          if (!isInitialMessagesLoad.current && Notification.permission === 'granted') {
            new Notification('New Message for Teacher', {
              body: messageData.message,
              tag: messageData.id,
            });
          }
        }
      });

      if (newMessages.length > 0) {
        setMessages(prev => [...newMessages, ...prev].sort((a, b) => b.timestamp.toDate() - a.timestamp.toDate()));
      }

      if (isInitialMessagesLoad.current) {
        isInitialMessagesLoad.current = false;
      }
    });

    return () => unsubscribeMessages();
  }, [teacherEmail, classId]);

  const renderContent = () => {
    switch (activeTab) {
      case 'monitor':
        return <MonitorView setTitle={setTitle} classId={classId} />;
      case 'progress':
        return <ProgressView classId={classId} setTitle={setTitle} />;
      case 'irregularities':
        return <IrregularitiesView />;
      case 'notifications':
        return (
            <div>
              <h2>Notifications</h2>
              {messages.length === 0 ? (
                <p>No new notifications for this class.</p>
              ) : (
                <ul>
                  {messages.map(msg => (
                    <li key={msg.id}>
                      <strong>{new Date(msg.timestamp?.toDate()).toLocaleString()}:</strong> {msg.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="class-view">
        <Link to="/teacher">Back to Dashboard</Link>
        <div className="tab-nav">
            <button className={`tab-button ${activeTab === 'monitor' ? 'active' : ''}`} onClick={() => setActiveTab('monitor')}>
            Monitor
            </button>
            <button className={`tab-button ${activeTab === 'progress' ? 'active' : ''}`} onClick={() => setActiveTab('progress')}>
            Progress
            </button>
            <button className={`tab-button ${activeTab === 'irregularities' ? 'active' : ''}`} onClick={() => setActiveTab('irregularities')}>
            Irregularities
            </button>
            <button className={`tab-button ${activeTab === 'notifications' ? 'active' : ''}`} onClick={() => setActiveTab('notifications')}>
            Notifications
            </button>
        </div>

        <div className="tab-content">
            {renderContent()}
        </div>
    </div>
  );
};

export default ClassView;
