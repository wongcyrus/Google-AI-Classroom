import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../firebase-config';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';

// Refactored Imports
import { useClassSchedule } from '../hooks/useClassSchedule';
import { compareClassesBySchedule, getClassScheduleStatus, isDemoClass } from '../utils/classRankingUtils';
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
import BingoResultsView from './BingoResultsView';
import LectureRecordingsView from './LectureRecordingsView';
import TasksManagementView from './tasks/TasksManagementView';

import './ClassView.css';

const ClassView = ({ user }) => {
  const { classId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL-synced tab state
  const mainTab = searchParams.get('tab') || 'monitor';
  const subTab = searchParams.get('sub') || (mainTab === 'video' ? 'recordings' : mainTab === 'analytics' ? 'irregularities' : '');
  const isLiveMode = mainTab === 'monitor' || mainTab === 'messages';

  const [classInfo, setClassInfo] = useState(null);
  const [teacherClasses, setTeacherClasses] = useState([]);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [dismissedLiveClassId, setDismissedLiveClassId] = useState(null);
  const [filterField, setFilterField] = useState('startTime');
  const [broadcastState, setBroadcastState] = useState(null);

  // Periodically refresh current time every 30s to detect lesson slot transitions
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

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
        const classIds = [...new Set(snap.data().classes || [])];
        const snaps = await Promise.all(classIds.map(id => getDoc(doc(db, 'classes', id))));
        const list = snaps.map(s => {
          const cData = s.data() || {};
          const status = getClassScheduleStatus({ id: s.id, ...cData }, currentTime);
          return {
            id: s.id,
            name: cData.name || s.id,
            schedule: cData.schedule,
            scheduleHistory: cData.scheduleHistory,
            _scheduleStatus: status,
          };
        });
        list.sort((a, b) => compareClassesBySchedule(a, b, currentTime));
        setTeacherClasses(list);
      }
    }).catch(err => console.error('Error fetching teacher classes:', err));
  }, [user, currentTime]);

  // Alert when current open class is NOT live, but another enrolled class IS actively Live Now (excluding demo classes)
  const liveClassWarning = useMemo(() => {
    if (!classId || teacherClasses.length <= 1) return null;
    const currentClass = teacherClasses.find((c) => c.id === classId);
    const isCurrentLive = currentClass?._scheduleStatus?.tier === 1;
    if (isCurrentLive) return null;

    const liveOtherClass = teacherClasses.find(
      (c) => c.id !== classId && c._scheduleStatus?.tier === 1 && !isDemoClass(c)
    );
    if (liveOtherClass && liveOtherClass.id !== dismissedLiveClassId) {
      return liveOtherClass;
    }
    return null;
  }, [classId, teacherClasses, dismissedLiveClassId]);

  const handleSwitchToClass = (targetClassId) => {
    if (targetClassId && targetClassId !== classId) {
      navigate(`/class/${targetClassId}?tab=${mainTab}${subTab ? `&sub=${subTab}` : ''}`);
    }
  };

  // Sync body class for monitor tab to prevent outer viewport double scrolling
  useEffect(() => {
    if (mainTab === 'monitor') {
      document.body.classList.add('is-monitor-active');
      return () => {
        document.body.classList.remove('is-monitor-active');
      };
    } else {
      document.body.classList.remove('is-monitor-active');
    }
  }, [mainTab]);

  // Tab change handlers
  const setTab = (newMainTab, defaultSub = '') => {
    const params = { tab: newMainTab };
    if (newMainTab === 'video') {
      params.sub = defaultSub || 'recordings';
    } else if (newMainTab === 'analytics') {
      params.sub = defaultSub || 'irregularities';
    }
    setSearchParams(params);
  };

  const handleOpenBroadcastStudio = () => {
    if (mainTab !== 'monitor') {
      setTab('monitor');
    }
    if (broadcastState?.openStudio) {
      broadcastState.openStudio();
    }
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

  const renderOtherContent = () => {
    const props = { 
      user, 
      classId, 
      startTime, 
      endTime, 
      lessons, 
      selectedLesson, 
      timezone, 
      handleLessonChange, 
      filterField,
      onStartTimeChange: setStartTime,
      onEndTimeChange: setEndTime,
    };
    switch (mainTab) {
      case 'video':
        switch (subTab) {
          case 'recordings': return <LectureRecordingsView classId={classId} user={user} lessons={lessons} selectedLesson={selectedLesson} timezone={timezone} className={classInfo?.name || classId} />;
          case 'library': return <VideoLibrary {...props} lessons={lessons} />;
          case 'review': return <SessionReviewView {...props} />;
          case 'jobs': return <VideoAnalysisJobs {...props} />;
          default: return <LectureRecordingsView classId={classId} user={user} lessons={lessons} selectedLesson={selectedLesson} timezone={timezone} className={classInfo?.name || classId} />;
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
          case 'bingo': return (
            <BingoResultsView
              {...props}
              className={classInfo?.name || classId}
            />
          );
          default: return <IrregularitiesView {...props} />;
        }
      case 'tasks':
        return (
          <TasksManagementView
            classId={classId}
            className={classInfo?.name || classId}
            classSchedule={classInfo?.schedule}
            lessons={lessons}
            enrolledStudents={Object.values(classInfo?.students || {})}
            studentProfiles={classInfo?.studentProfiles || {}}
          />
        );
      case 'messages':
        return <MessagesView user={user} classId={classId} />;
      case 'data':
        return <DataManagementView {...props} />;
      case 'settings':
        return <ClassManagement user={user} embeddedClassId={classId} />;
      default:
        return null;
    }
  };

  const isRecordingsTab = mainTab === 'video' && (!subTab || subTab === 'recordings' || subTab === 'default');
  const showDateFilter = ['video', 'analytics', 'data'].includes(mainTab) && !isRecordingsTab;

  return (
    <div className={`class-view ${mainTab === 'monitor' ? 'is-monitor-tab' : ''}`}>
      {/* Class Hub Context Banner (Compact) */}
      <div className="class-hub-header">
        <div className="class-hub-title-area">
          <div className="class-hub-icon">🏫</div>
          <div className="class-hub-title-group">
            <h1 className="class-hub-title">
              {classInfo?.name || classId}
              <span className="class-hub-code-pill">{classId}</span>
            </h1>
            <span className="class-hub-student-badge">
              {classInfo?.students ? `${Object.keys(classInfo.students).length} enrolled students` : 'Active Classroom Hub'}
            </span>
          </div>
        </div>

        <div className="class-hub-right-actions">
          {broadcastState?.isBroadcasting ? (
            <div className="broadcast-live-group">
              <button
                type="button"
                className="broadcast-launcher-btn is-broadcasting"
                onClick={handleOpenBroadcastStudio}
                title="Live Broadcast Active - Click to open studio controls"
                aria-label="Open Broadcast Studio"
              >
                <span className="live-dot-broadcast">●</span>
                <span>Live ({broadcastState.viewersCount ?? 0})</span>
              </button>
              <button
                type="button"
                className="broadcast-stop-btn"
                onClick={() => broadcastState?.stopBroadcast?.()}
                title="Stop Live Broadcast"
                aria-label="Stop Broadcast"
              >
                <span>⏹ Stop</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="broadcast-launcher-btn"
              onClick={handleOpenBroadcastStudio}
              title="Open Broadcast Studio to configure and broadcast Screen and Voice (Live Subtitles) to class"
              aria-label="Broadcast Screen & Voice"
            >
              <span>🎙️🖥️</span>
              <span>Broadcast</span>
            </button>
          )}

          <button
            type="button"
            className="student-preview-launcher-btn"
            onClick={() => {
              window.open(
                `/preview/student/${classId}`,
                `StudentPreview_${classId}`,
                'width=1280,height=800,menubar=no,toolbar=no,location=no,status=no,resizable=yes'
              );
            }}
            title="Open student view in a separate window to check broadcast and student settings"
          >
            <span>🧪</span>
            <span>Preview as Student ↗</span>
          </button>

          {teacherClasses.length > 1 && (
            <div className="class-switcher-wrapper">
              <label htmlFor="class-switcher" className="class-switcher-label">Switch Class:</label>
              <select
                id="class-switcher"
                value={classId}
                onChange={handleClassSwitch}
                className="class-switcher-select"
              >
                {teacherClasses.map((c, idx) => {
                  let prefix = '';
                  if (c._scheduleStatus?.tier === 1) prefix = '🟢 [Live Now] ';
                  else if (c._scheduleStatus?.tier === 2) prefix = `⏳ [In ${c._scheduleStatus.minutesUntilStart}m] `;
                  else if (c._scheduleStatus?.tier === 3) prefix = '📅 [Today] ';

                  return (
                    <option key={`${c.id}-${idx}`} value={c.id}>
                      {prefix}{c.name ? `${c.name} (${c.id})` : c.id}
                    </option>
                  );
                })}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Unified Compact Navigation Ribbon (Mode Switcher + Tabs in ONE Row) */}
      <div className="class-hub-nav-bar" role="region" aria-label="Classroom Navigation">
        {/* Mode Selector Segment */}
        <div className="class-hub-mode-selector" role="region" aria-label="Classroom Mode Selector">
          <button
            type="button"
            className={`hub-mode-btn ${isLiveMode ? 'active live' : ''}`}
            onClick={() => {
              if (!isLiveMode) setTab('monitor');
            }}
          >
            <span className="live-indicator-dot"></span>
            <span>🔴 Live Classroom</span>
          </button>

          <button
            type="button"
            className={`hub-mode-btn ${!isLiveMode ? 'active offline' : ''}`}
            onClick={() => {
              if (isLiveMode) setTab('tasks');
            }}
          >
            <span>📁 Coursework & Management</span>
          </button>
        </div>

        <div className="nav-bar-divider" />

        {/* Primary Workflow Tabs for Active Mode */}
        <nav className={`tab-nav ${isLiveMode ? 'live-tab-nav' : 'offline-tab-nav'}`} aria-label="Classroom Sections">
          {isLiveMode ? (
            <>
              <button
                className={`tab-button ${mainTab === 'monitor' ? 'active' : ''}`}
                onClick={() => setTab('monitor')}
              >
                <span>📡</span> Live Screen Monitor
              </button>

              <button
                className={`tab-button ${mainTab === 'messages' ? 'active' : ''}`}
                onClick={() => setTab('messages')}
              >
                <span>💬</span> Live Alerts & Messages
              </button>
            </>
          ) : (
          <>
            <button
              className={`tab-button ${mainTab === 'tasks' ? 'active' : ''}`}
              onClick={() => setTab('tasks')}
            >
              <span>📋</span> Practical Tasks & Homework
            </button>

            <button
              className={`tab-button ${mainTab === 'video' ? 'active' : ''}`}
              onClick={() => setTab('video', 'recordings')}
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
          </>
        )}
      </nav>
      </div>

      {/* Live Timetable Transition Warning Banner */}
      {liveClassWarning && (
        <div className="live-class-alert-banner" role="alert">
          <div className="live-class-alert-content">
            <span className="live-class-alert-icon">⚠️</span>
            <div className="live-class-alert-text">
              <strong>Timetable Alert:</strong> You are currently in <em>{classInfo?.name || classId}</em> ({classId}).
              Your scheduled timetable class right now ({liveClassWarning._scheduleStatus?.timeStr || 'Live Now'}) is <strong>{liveClassWarning.name || liveClassWarning.id}</strong>.
            </div>
          </div>
          <div className="live-class-alert-actions">
            <button
              type="button"
              className="switch-live-class-btn"
              onClick={() => handleSwitchToClass(liveClassWarning.id)}
            >
              👉 Switch to {liveClassWarning.name || liveClassWarning.id}
            </button>
            <button
              type="button"
              className="dismiss-live-class-btn"
              onClick={() => setDismissedLiveClassId(liveClassWarning.id)}
              aria-label="Dismiss warning"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Secondary Sub-Tabs for Video Module */}
      {mainTab === 'video' && (
        <nav className="sub-tab-nav" aria-label="Video Sub-sections">
          <button
            className={`tab-button ${subTab === 'recordings' || (!subTab || subTab === 'default') ? 'active' : ''}`}
            onClick={() => setSub('recordings')}
          >
            <span>🎥</span> Teacher Lecture Recordings
          </button>
          <button
            className={`tab-button ${subTab === 'library' ? 'active' : ''}`}
            onClick={() => setSub('library')}
          >
            <span>👥</span> Student Recordings
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
            className={`tab-button ${subTab === 'bingo' ? 'active' : ''}`}
            onClick={() => setSub('bingo')}
          >
            <span>🎲</span> Bingo Presence Report
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
        {/* Keep MonitorView mounted so live AI vision loops & WebRTC connections stay active when navigating between tabs */}
        <div 
          className="monitor-tab-wrapper"
          style={{ display: mainTab === 'monitor' ? 'flex' : 'none' }}
        >
          <MonitorView 
            key={classId}
            user={user} 
            classId={classId} 
            className={classInfo?.name || classInfo?.className || ''}
            startTime={startTime} 
            endTime={endTime} 
            lessons={lessons} 
            selectedLesson={selectedLesson} 
            timezone={timezone} 
            handleLessonChange={handleLessonChange} 
            filterField={filterField} 
            onBroadcastStateChange={setBroadcastState}
            activeLiveClass={liveClassWarning}
            onSwitchClass={handleSwitchToClass}
          />
        </div>
        {mainTab !== 'monitor' && (
          <div className="other-tab-content">
            {renderOtherContent()}
          </div>
        )}
      </div>
    </div>
  );
};

export default ClassView;