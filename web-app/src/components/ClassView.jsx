import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { db } from '../firebase-config';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import MonitorView from './MonitorView';
import IrregularitiesView from './IrregularitiesView';
import ProgressView from './ProgressView';
import PlaybackView from './PlaybackView';
import NotificationsView from './NotificationsView';
import './ClassView.css';

const ClassView = ({ user }) => {
  const { classId } = useParams();
  const [activeTab, setActiveTab] = useState('monitor');
  const [teacherEmail, setTeacherEmail] = useState(null);

  // Helper function to show notifications via Service Worker
  const showSystemNotification = (message, tag) => {
    if (!('serviceWorker' in navigator) || Notification.permission !== 'granted') return;
    navigator.serviceWorker.ready.then((registration) => {
      registration.active.postMessage({
        type: 'show-notification',
        title: 'New Message for Teacher',
        body: message,
        tag: tag
      });
    });
  };

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

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

  // Dedicated listener for OS notifications that runs for the lifetime of the ClassView
  useEffect(() => {
    if (!teacherEmail) {
      return;
    }

    const messagesRef = collection(db, "teachers", teacherEmail, "messages");
    // Query for messages that arrived in the last 15 seconds to avoid showing old ones on initial load.
    const q = query(messagesRef, where("timestamp", ">", new Date(Date.now() - 15000)));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      querySnapshot.docChanges().forEach((change) => {
        if (change.type === 'added' && !change.doc.metadata.hasPendingWrites) {
          const messageData = change.doc.data();
          if (messageData.classId === classId) {
            showSystemNotification(messageData.message, change.doc.id);
          }
        }
      });
    });

    return () => unsubscribe();
  }, [teacherEmail, classId]);


  const renderContent = () => {
    switch (activeTab) {
      case 'monitor':
        return <MonitorView user={user} classId={classId} />;
      case 'progress':
        return <ProgressView classId={classId} />;
      case 'irregularities':
        return <IrregularitiesView classId={classId} />;
      case 'playback':
        return <PlaybackView user={user} classId={classId} />;
      case 'notifications':
        return <NotificationsView classId={classId} />;
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
            <button className={`tab-button ${activeTab === 'playback' ? 'active' : ''}`} onClick={() => setActiveTab('playback')}>
            Playback
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