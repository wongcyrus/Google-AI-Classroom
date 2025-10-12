import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '../firebase-config';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

// Refactored Imports
import { useClassSchedule } from '../hooks/useClassSchedule';
import DateRangeFilter from './DateRangeFilter';

// Component Imports
import MonitorView from './MonitorView';
import IrregularitiesView from './IrregularitiesView';
import ProgressView from './ProgressView';
import PlaybackView from './PlaybackView';
import NotificationsView from './NotificationsView';
import VideoLibrary from './VideoLibrary';
import VideoAnalysisJobs from './VideoAnalysisJobs';
import DataManagementView from './DataManagementView';
import PerformanceAnalyticsView from './PerformanceAnalyticsView';

import './ClassView.css';

const ClassView = ({ user }) => {
  const { classId } = useParams();
  const [mainTab, setMainTab] = useState('monitor');
  const [videoSubTab, setVideoSubTab] = useState('library');
  const [analyticsSubTab, setAnalyticsSubTab] = useState('irregularities');
  const [moreSubTab, setMoreSubTab] = useState('data');

  // Centralized schedule and date range management
  const {
    lessons,
    selectedLesson,
    startTime,
    endTime,
    setStartTime,
    setEndTime,
    handleLessonChange,
    timezone,
  } = useClassSchedule(classId);

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

  // Dedicated listener for OS notifications
  useEffect(() => {
    if (!user || !user.uid) return;
    const messagesRef = collection(db, "teachers", user.uid, "messages");
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
  }, [user, classId]);

  const renderContent = () => {
    const props = { user, classId, startTime, endTime, lessons, selectedLesson, timezone, handleLessonChange };
    switch (mainTab) {
      case 'monitor':
        return <MonitorView {...props} />;
      case 'video':
        switch (videoSubTab) {
          case 'library': return <VideoLibrary {...props} />;
          case 'playback': return <PlaybackView {...props} />;
          case 'jobs': return <VideoAnalysisJobs {...props} />;
          default: return null;
        }
      case 'analytics':
        switch (analyticsSubTab) {
          case 'performance': return <PerformanceAnalyticsView {...props} />;
          case 'progress': return <ProgressView {...props} />;
          case 'irregularities': return <IrregularitiesView {...props} />;
          default: return null;
        }
      case 'more':
        switch (moreSubTab) {
          case 'data': return <DataManagementView {...props} />;
          case 'notifications': return <NotificationsView user={user} classId={classId} />;
          default: return null;
        }
    }
  };

  return (
    <div className="class-view">
        <div className="tab-nav">
            <button className={`tab-button ${mainTab === 'monitor' ? 'active' : ''}`} onClick={() => setMainTab('monitor')}>Monitor</button>
            <button className={`tab-button ${mainTab === 'video' ? 'active' : ''}`} onClick={() => setMainTab('video')}>Video</button>
            <button className={`tab-button ${mainTab === 'analytics' ? 'active' : ''}`} onClick={() => setMainTab('analytics')}>Analytics</button>
            <button className={`tab-button ${mainTab === 'more' ? 'active' : ''}`} onClick={() => setMainTab('more')}>More</button>
        </div>

        <div className="sub-tab-nav">
        {mainTab === 'video' && (
          <>
            <button className={`tab-button ${videoSubTab === 'library' ? 'active' : ''}`} onClick={() => setVideoSubTab('library')}>Video Library</button>
            <button className={`tab-button ${videoSubTab === 'playback' ? 'active' : ''}`} onClick={() => setVideoSubTab('playback')}>Playback</button>
            <button className={`tab-button ${videoSubTab === 'jobs' ? 'active' : ''}`} onClick={() => setVideoSubTab('jobs')}>Video Analysis Jobs</button>
          </>
        )}
        {mainTab === 'analytics' && (
          <>
            <button className={`tab-button ${analyticsSubTab === 'performance' ? 'active' : ''}`} onClick={() => setAnalyticsSubTab('performance')}>Performance</button>
            <button className={`tab-button ${analyticsSubTab === 'progress' ? 'active' : ''}`} onClick={() => setAnalyticsSubTab('progress')}>Progress</button>
            <button className={`tab-button ${analyticsSubTab === 'irregularities' ? 'active' : ''}`} onClick={() => setAnalyticsSubTab('irregularities')}>Irregularities</button>
          </>
        )}
        {mainTab === 'more' && (
          <>
            <button className={`tab-button ${moreSubTab === 'data' ? 'active' : ''}`} onClick={() => setMoreSubTab('data')}>Data Management</button>
            <button className={`tab-button ${moreSubTab === 'notifications' ? 'active' : ''}`} onClick={() => setMoreSubTab('notifications')}>Notifications</button>
          </>
        )}
        </div>

        {mainTab !== 'monitor' && (
          <div className="shared-date-filter-container" style={{ padding: '10px 20px', borderBottom: '1px solid #ccc' }}>
            <DateRangeFilter
              lessons={lessons}
              selectedLesson={selectedLesson}
              onLessonChange={handleLessonChange}
              startTime={startTime}
              endTime={endTime}
              onStartTimeChange={setStartTime}
              onEndTimeChange={setEndTime}
              timezone={timezone}
            />
          </div>
        )}

        <div className="tab-content">
            {renderContent()}
        </div>
    </div>
  );
};

export default ClassView;