import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../firebase-config';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';

// Refactored Imports
import { useClassSchedule } from '../hooks/useClassSchedule';
import DateRangeFilter from './DateRangeFilter';

// Component Imports
import MonitorView from './MonitorView';
import IrregularitiesView from './IrregularitiesView';
import ProgressView from './ProgressView';
import SessionReviewView from './SessionReviewView';
import MessagesView from './MessagesView';
import VideoLibrary from './VideoLibrary';
import VideoAnalysisJobs from './VideoAnalysisJobs';
import DataManagementView from './DataManagementView';
import AttendanceView from './AttendanceView';
import PerformanceAnalyticsView from './PerformanceAnalyticsView';
import AiCostReportView from './AiCostReportView';
import ClassManagement from './ClassManagement';

import './ClassView.css';

const ClassView = ({ user }) => {
  const { classId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL-synced tab state
  const mainTab = searchParams.get('tab') || 'monitor';
  const subTab = searchParams.get('sub') || (mainTab === 'video' ? 'library' : mainTab === 'analytics' ? 'irregularities' : '');

  const [classInfo, setClassInfo] = useState(null);
  const [teacherClasses, setTeacherClasses] = useState([]);
  const [filterField, setFilterField] = useState('startTime');

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

  // Fetch current class details
  useEffect(() => {
    if (!classId) return;
    const classRef = doc(db, 'classes', classId);
    const unsubscribe = onSnapshot(classRef, (snap) => {
      if (snap.exists()) {
        setClassInfo({ id: snap.id, ...snap.data() });
      } else {
        setClassInfo(null);
      }
    });
    return () => unsubscribe();
  }, [classId]);

  // Fetch teacher's enrolled classes for the quick switcher
  useEffect(() => {
    if (!user) return;
    const profileRef = doc(db, 'teacherProfiles', user.uid);
    getDoc(profileRef).then(async (snap) => {
      if (snap.exists()) {
        const classIds = snap.data().classes || [];
        const snaps = await Promise.all(classIds.map(id => getDoc(doc(db, 'classes', id))));
        const list = snaps.map(s => ({ id: s.id, name: s.data()?.name || s.id }));
        list.sort((a, b) => (a.id || '').localeCompare(b.id || ''));
        setTeacherClasses(list);
      }
    }).catch(err => console.error('Error fetching teacher classes:', err));
  }, [user]);

  // Tab change handlers
  const setTab = (newMainTab, defaultSub = '') => {
    const params = { tab: newMainTab };
    if (newMainTab === 'video') {
      params.sub = defaultSub || 'library';
    } else if (newMainTab === 'analytics') {
      params.sub = defaultSub || 'irregularities';
    }
    setSearchParams(params);
  };

  const setSub = (newSubTab) => {
    setSearchParams({ tab: mainTab, sub: newSubTab });
  };

  const handleClassSwitch = (e) => {
    const targetClassId = e.target.value;
    if (targetClassId && targetClassId !== classId) {
      navigate(`/class/${targetClassId}?tab=${mainTab}${subTab ? `&sub=${subTab}` : ''}`);
    }
  };

  const renderContent = () => {
    const props = { user, classId, startTime, endTime, lessons, selectedLesson, timezone, handleLessonChange, filterField };
    switch (mainTab) {
      case 'monitor':
        return <MonitorView {...props} />;
      case 'video':
        switch (subTab) {
          case 'library': return <VideoLibrary {...props} />;
          case 'review': return <SessionReviewView {...props} />;
          case 'jobs': return <VideoAnalysisJobs {...props} />;
          default: return <VideoLibrary {...props} />;
        }
      case 'analytics':
        switch (subTab) {
          case 'irregularities': return <IrregularitiesView {...props} />;
          case 'progress': return <ProgressView {...props} />;
          case 'attendance': return <AttendanceView {...props} />;
          case 'performance': return <PerformanceAnalyticsView {...props} />;
          case 'ai-cost': return (
            <AiCostReportView
              classId={classId}
              className={classInfo?.name || classId}
              classQuota={classInfo?.aiQuota || 10}
              students={Object.entries(classInfo?.students || {}).map(([uid, email]) => ({ uid, email }))}
            />
          );
          default: return <IrregularitiesView {...props} />;
        }
      case 'messages':
        return <MessagesView user={user} classId={classId} />;
      case 'data':
        return <DataManagementView {...props} />;
      case 'settings':
        return <ClassManagement user={user} embeddedClassId={classId} />;
      default:
        return <MonitorView {...props} />;
    }
  };

  const showDateFilter = ['video', 'analytics', 'data'].includes(mainTab);

  return (
    <div className="class-view">
      {/* Class Hub Context Banner */}
      <div className="class-hub-header">
        <div className="class-hub-title-area">
          <div className="class-hub-icon">🏫</div>
          <div>
            <h1 className="class-hub-title">
              {classInfo?.name || classId}
              <span className="class-hub-code-pill">{classId}</span>
            </h1>
            <small style={{ color: '#64748b' }}>
              {classInfo?.students ? `${Object.keys(classInfo.students).length} enrolled students` : 'Active Classroom Hub'}
            </small>
          </div>
        </div>

        {teacherClasses.length > 1 && (
          <div className="class-switcher-wrapper">
            <label htmlFor="class-switcher" className="class-switcher-label">Switch Class:</label>
            <select
              id="class-switcher"
              value={classId}
              onChange={handleClassSwitch}
              className="class-switcher-select"
            >
              {teacherClasses.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name ? `${c.name} (${c.id})` : c.id}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Primary Workflow Tabs */}
      <nav className="tab-nav" aria-label="Classroom Sections">
        <button
          className={`tab-button ${mainTab === 'monitor' ? 'active' : ''}`}
          onClick={() => setTab('monitor')}
        >
          <span>📡</span> Live Monitor
        </button>

        <button
          className={`tab-button ${mainTab === 'video' ? 'active' : ''}`}
          onClick={() => setTab('video', 'library')}
        >
          <span>🎬</span> Recordings & Sessions
        </button>

        <button
          className={`tab-button ${mainTab === 'analytics' ? 'active' : ''}`}
          onClick={() => setTab('analytics', 'irregularities')}
        >
          <span>📊</span> AI Analytics & Insights
        </button>

        <button
          className={`tab-button ${mainTab === 'messages' ? 'active' : ''}`}
          onClick={() => setTab('messages')}
        >
          <span>💬</span> Live Alerts & Messages
        </button>

        <button
          className={`tab-button ${mainTab === 'data' ? 'active' : ''}`}
          onClick={() => setTab('data')}
        >
          <span>🗄️</span> Data & Archives
        </button>

        <button
          className={`tab-button ${mainTab === 'settings' ? 'active' : ''}`}
          onClick={() => setTab('settings')}
        >
          <span>⚙️</span> Class Settings & Roster
        </button>
      </nav>

      {/* Secondary Sub-Tabs for Video Module */}
      {mainTab === 'video' && (
        <nav className="sub-tab-nav" aria-label="Video Sub-sections">
          <button
            className={`tab-button ${subTab === 'library' ? 'active' : ''}`}
            onClick={() => setSub('library')}
          >
            <span>📁</span> Video Library
          </button>
          <button
            className={`tab-button ${subTab === 'review' ? 'active' : ''}`}
            onClick={() => setSub('review')}
          >
            <span>⏱️</span> Timeline Session Review
          </button>
          <button
            className={`tab-button ${subTab === 'jobs' ? 'active' : ''}`}
            onClick={() => setSub('jobs')}
          >
            <span>🤖</span> AI Video Analysis Jobs
          </button>
        </nav>
      )}

      {/* Secondary Sub-Tabs for Analytics Module */}
      {mainTab === 'analytics' && (
        <nav className="sub-tab-nav" aria-label="Analytics Sub-sections">
          <button
            className={`tab-button ${subTab === 'irregularities' ? 'active' : ''}`}
            onClick={() => setSub('irregularities')}
          >
            <span>⚠️</span> Irregularities
          </button>
          <button
            className={`tab-button ${subTab === 'progress' ? 'active' : ''}`}
            onClick={() => setSub('progress')}
          >
            <span>📈</span> Progress Summary
          </button>
          <button
            className={`tab-button ${subTab === 'attendance' ? 'active' : ''}`}
            onClick={() => setSub('attendance')}
          >
            <span>📅</span> Attendance
          </button>
          <button
            className={`tab-button ${subTab === 'performance' ? 'active' : ''}`}
            onClick={() => setSub('performance')}
          >
            <span>🎯</span> Performance Metrics
          </button>
          <button
            className={`tab-button ${subTab === 'ai-cost' ? 'active' : ''}`}
            onClick={() => setSub('ai-cost')}
          >
            <span>💰</span> AI Cost Report
          </button>
        </nav>
      )}

      {/* Shared Date Range Filter */}
      {showDateFilter && (
        <div className="shared-date-filter-container">
          <DateRangeFilter
            lessons={lessons}
            selectedLesson={selectedLesson}
            onLessonChange={handleLessonChange}
            startTime={startTime}
            endTime={endTime}
            onStartTimeChange={setStartTime}
            onEndTimeChange={setEndTime}
            timezone={timezone}
            filterField={filterField}
            onFilterFieldChange={setFilterField}
            showFilterField={mainTab === 'video' || mainTab === 'data'}
            filterFieldOptions={[
              { value: 'startTime', label: 'Lesson Start Time' },
              { value: 'createdAt', label: 'Job Creation Time' },
            ]}
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