import { useState, useEffect, useMemo } from 'react';
import { onSnapshot, getDoc, doc } from 'firebase/firestore';
import { db } from '../firebase-config';
import { Link, Navigate } from 'react-router-dom';
import './TeacherView.css';
import { formatBytes, formatAiCost, formatStorageCost } from '../utils/formatters';
import { deriveRoleFromEmail } from '../utils/domainConfig';
import {
  getClassScheduleStatus,
  extractClassTags,
  filterAndSortClasses,
} from '../utils/classRankingUtils';

const TeacherView = ({ user }) => {
  const [classes, setClasses] = useState([]);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [scheduleFilter, setScheduleFilter] = useState('today'); // 'today' (default) | 'live' | 'all'
  const [sortOption, setSortOption] = useState('smart'); // 'smart' | 'name'
  const [currentTime, setCurrentTime] = useState(() => new Date());

  // Periodically refresh current time every 60s to keep live status accurate
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const checkRole = async () => {
      if (user) {
        let idTokenResult = await user.getIdTokenResult();
        if (!idTokenResult.claims.role) {
          idTokenResult = await user.getIdTokenResult(true);
        }
        setRole(idTokenResult.claims.role || deriveRoleFromEmail(user.email));
      }
    };
    checkRole();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const userProfileRef = doc(db, "teacherProfiles", user.uid);
    const unsubscribeProfile = onSnapshot(userProfileRef, async (profileSnap) => {
      if (profileSnap.exists()) {
        const profileData = profileSnap.data();
        const classIds = profileData.classes || [];

        if (classIds.length === 0) {
          setClasses([]);
          setLoading(false);
          return;
        }

        const classPromises = classIds.map(id => getDoc(doc(db, "classes", id)));
        const classSnaps = await Promise.all(classPromises);

        const classesData = classSnaps.map(snap => ({ id: snap.id, ...snap.data() }));
        classesData.sort((a, b) => a.id.localeCompare(b.id));

        const updatedClasses = await Promise.all(classesData.map(async c => {
          const storageRef = doc(db, "classes", c.id, "metadata", "storage");
          const aiMetaRef = doc(db, "classes", c.id, "metadata", "ai");
          const [storageSnap, aiMetaSnap] = await Promise.all([
            getDoc(storageRef),
            getDoc(aiMetaRef)
          ]);

          let mergedData = { ...c };
          if (storageSnap.exists()) {
            mergedData = { ...mergedData, ...storageSnap.data() };
          }
          if (aiMetaSnap.exists()) {
            mergedData = { ...mergedData, ...aiMetaSnap.data() };
          }
          return mergedData;
        }));

        setClasses(updatedClasses);
      } else {
        setClasses([]);
      }
      setLoading(false);
    });

    return () => unsubscribeProfile();
  }, [user]);

  // Aggregate stats calculations
  const stats = useMemo(() => {
    let totalStorageUsed = 0;
    let totalStorageQuota = 0;
    let totalAiUsed = 0;
    let totalAiQuota = 0;
    let totalEnrollments = 0;
    const uniqueStudents = new Set();

    classes.forEach(c => {
      const classStudents = new Set();

      // Collect from studentEmails array
      if (Array.isArray(c.studentEmails)) {
        c.studentEmails.forEach(email => {
          if (email && typeof email === 'string') {
            const clean = email.trim().toLowerCase();
            if (clean) {
              classStudents.add(clean);
              uniqueStudents.add(clean);
            }
          }
        });
      }

      // Collect from students object map
      if (c.students && typeof c.students === 'object') {
        Object.entries(c.students).forEach(([uid, val]) => {
          let identifier = null;
          if (typeof val === 'string' && val.includes('@')) {
            identifier = val.trim().toLowerCase();
          } else if (val && typeof val === 'object' && val.email) {
            identifier = val.email.trim().toLowerCase();
          } else if (uid) {
            identifier = uid;
          }
          if (identifier) {
            classStudents.add(identifier);
            uniqueStudents.add(identifier);
          }
        });
      }

      const count = classStudents.size > 0
        ? classStudents.size
        : (c.students ? Object.keys(c.students).length : (c.studentEmails?.length || 0));

      totalEnrollments += count;
      totalStorageUsed += (c.storageUsage || 0);
      totalStorageQuota += (c.storageQuota || 0);
      totalAiUsed += (c.aiUsedQuota || 0);
      totalAiQuota += (c.aiQuota || 10);
    });

    return {
      totalClasses: classes.length,
      totalStudents: uniqueStudents.size,
      totalEnrollments,
      totalStorageUsed,
      totalStorageQuota,
      totalAiUsed,
      totalAiQuota
    };
  }, [classes]);

  // Extract unique custom & smart tags across all classes
  const availableTags = useMemo(() => {
    return extractClassTags(classes, currentTime);
  }, [classes, currentTime]);

  // Compute live and today counts for quick filter buttons
  const { liveCount, todayCount } = useMemo(() => {
    let live = 0;
    let today = 0;
    classes.forEach(c => {
      const status = getClassScheduleStatus(c, currentTime);
      if (status.tier === 1) live++;
      if (status.tier === 1 || status.tier === 2 || status.tier === 3) today++;
    });
    return { liveCount: live, todayCount: today };
  }, [classes, currentTime]);

  // Composable filtered and sorted classes
  const filteredClasses = useMemo(() => {
    return filterAndSortClasses(classes, {
      searchTerm,
      selectedTags,
      scheduleFilter,
      sortOption,
      now: currentTime,
    });
  }, [classes, searchTerm, selectedTags, scheduleFilter, sortOption, currentTime]);

  const toggleTag = (tag) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const clearAllFilters = () => {
    setSearchTerm('');
    setSelectedTags([]);
    setScheduleFilter('all');
    setSortOption('smart');
  };

  const hasActiveFilters = Boolean(
    searchTerm.trim() ||
    selectedTags.length > 0 ||
    scheduleFilter !== 'all' ||
    sortOption !== 'smart'
  );



  if (role && role !== 'teacher') {
    return <Navigate to="/login" />;
  }

  if (loading) {
    return (
      <div className="teacher-dashboard" style={{ textAlign: 'center', padding: '4rem 1rem' }}>
        <p style={{ color: '#64748b' }}>Loading teacher workspace...</p>
      </div>
    );
  }

  return (
    <div className="teacher-dashboard">
      {/* Hero Section */}
      <div className="dashboard-hero">
        <div className="dashboard-hero-title">
          <h1>Teacher Command Center</h1>
          <p>Welcome back, {user?.email}. Manage your live sessions, analytics, and classroom resources.</p>
        </div>
        <div className="dashboard-hero-actions">
          <Link to="/class-management" className="create-class-btn">
            <span>+ Create New Class</span>
          </Link>
        </div>
      </div>

      {/* KPI Overview Grid */}
      <div className="dashboard-kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon blue">🏫</div>
          <div className="kpi-content">
            <span className="kpi-label">Active Classes</span>
            <span className="kpi-value">{stats.totalClasses}</span>
            <span className="kpi-subtext">Total courses managed</span>
          </div>
        </div>

        <div
          className="kpi-card"
          title={`${stats.totalStudents} unique student${stats.totalStudents === 1 ? '' : 's'} (${stats.totalEnrollments} total course enrollments)`}
        >
          <div className="kpi-icon emerald">👥</div>
          <div className="kpi-content">
            <span className="kpi-label">Total Students</span>
            <span className="kpi-value">{stats.totalStudents}</span>
            <span className="kpi-subtext">
              {stats.totalStudents === 0
                ? 'No students enrolled'
                : stats.totalEnrollments !== stats.totalStudents
                  ? `${stats.totalEnrollments} enrollments across ${stats.totalClasses} classes`
                  : 'Enrolled across all classes'}
            </span>
          </div>
        </div>

        <div className="kpi-card" title={`Estimated Monthly Storage Cost: ~${formatStorageCost(stats.totalStorageUsed)}`}>
          <div className="kpi-icon amber">💾</div>
          <div className="kpi-content">
            <span className="kpi-label">Storage Usage</span>
            <span className="kpi-value">{formatBytes(stats.totalStorageUsed)}</span>
            <span className="kpi-subtext">
              {stats.totalStorageQuota > 0 ? `of ${formatBytes(stats.totalStorageQuota)} (~${formatStorageCost(stats.totalStorageUsed)}/mo)` : `Total used (~${formatStorageCost(stats.totalStorageUsed)}/mo)`}
            </span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon purple">🤖</div>
          <div className="kpi-content">
            <span className="kpi-label">AI Budget Used</span>
            <span className="kpi-value">{formatAiCost(stats.totalAiUsed)}</span>
            <span className="kpi-subtext">of ${stats.totalAiQuota.toFixed(2)} total budget</span>
          </div>
        </div>
      </div>

      {/* Classes Management Section */}
      <div className="classes-section-header">
        <div>
          <h2>Your Classes ({filteredClasses.length}{filteredClasses.length !== classes.length ? ` of ${classes.length}` : ''})</h2>
          <p className="classes-section-subtitle">
            Ranked by scheduled lesson status. Today's live and upcoming classes automatically appear first.
          </p>
        </div>
      </div>

      {/* Composable Filter Bar */}
      <div className="classes-filter-section">
        <div className="classes-filter-controls">
          {/* Search Box */}
          <div className="classes-search-box">
            <span className="search-icon-placeholder">🔍</span>
            <input
              type="text"
              placeholder="Search classes by name or code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Search classes"
            />
            {searchTerm && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={() => setSearchTerm('')}
                aria-label="Clear input"
              >
                ✕
              </button>
            )}
          </div>

          {/* Schedule Quick Toggles */}
          <div className="schedule-filter-toggles" role="group" aria-label="Schedule Filter">
            <button
              type="button"
              className={`filter-toggle-btn ${scheduleFilter === 'all' ? 'active' : ''}`}
              onClick={() => setScheduleFilter('all')}
            >
              All ({classes.length})
            </button>
            <button
              type="button"
              className={`filter-toggle-btn live ${scheduleFilter === 'live' ? 'active' : ''}`}
              onClick={() => setScheduleFilter(scheduleFilter === 'live' ? 'all' : 'live')}
              title="Show currently active classes"
            >
              🟢 Live Now ({liveCount})
            </button>
            <button
              type="button"
              className={`filter-toggle-btn today ${scheduleFilter === 'today' ? 'active' : ''}`}
              onClick={() => setScheduleFilter(scheduleFilter === 'today' ? 'all' : 'today')}
              title="Show classes scheduled today"
            >
              📅 Today ({todayCount})
            </button>
          </div>

          {/* Sort Order Selector */}
          <div className="sort-order-selector">
            <label htmlFor="class-sort-select">Sort:</label>
            <select
              id="class-sort-select"
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value)}
              className="sort-select-input"
            >
              <option value="smart">⚡ Smart Schedule (Active First)</option>
              <option value="name">🔤 Name (A - Z)</option>
            </select>
          </div>
        </div>

        {/* Tag Pills Filter Bar */}
        {availableTags.length > 0 && (
          <div className="tag-filter-bar">
            <span className="tag-filter-label">🏷️ Filter Tags:</span>
            <div className="tag-pills-container">
              {availableTags.map(({ tag, count, isSmart }) => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`filter-tag-pill ${isSelected ? 'active' : ''} ${isSmart ? 'smart-tag' : ''}`}
                    onClick={() => toggleTag(tag)}
                    title={isSelected ? `Remove ${tag} filter` : `Filter by ${tag}`}
                  >
                    <span>{tag}</span>
                    <span className="tag-count-badge">{count}</span>
                  </button>
                );
              })}
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                className="clear-all-filters-btn"
                onClick={clearAllFilters}
                title="Clear all active search, tag, and schedule filters"
              >
                ✕ Clear Filters
              </button>
            )}
          </div>
        )}

        {hasActiveFilters && (
          <div className="active-filter-summary">
            Showing <strong>{filteredClasses.length}</strong> of <strong>{classes.length}</strong> classes
            {searchTerm && <span> matching "<em>{searchTerm}</em>"</span>}
            {selectedTags.length > 0 && <span> with tags: <strong>{selectedTags.join(', ')}</strong></span>}
            {scheduleFilter !== 'all' && <span> ({scheduleFilter === 'live' ? 'Live Now Only' : 'Today\'s Classes Only'})</span>}
          </div>
        )}
      </div>

      {filteredClasses.length > 0 ? (
        <div className="class-card-list">
          {filteredClasses.map(c => {
            const usage = c.storageUsage || 0;
            const quota = c.storageQuota || (5 * 1024 * 1024 * 1024);
            const storagePercent = quota > 0 ? Math.min(100, (usage / quota) * 100) : 0;

            const aiUsed = c.aiUsedQuota || 0;
            const aiQuota = c.aiQuota || 10;
            const aiPercent = aiQuota > 0 ? Math.min(100, (aiUsed / aiQuota) * 100) : 0;

            const studentCount = c.students ? Object.keys(c.students).length : (c.studentEmails?.length || 0);
            const scheduleStatus = c._scheduleStatus || getClassScheduleStatus(c, currentTime);
            const isLive = scheduleStatus.tier === 1;
            const isSoon = scheduleStatus.tier === 2;

            return (
              <div
                key={c.id}
                className={`class-card ${isLive ? 'is-live-now' : isSoon ? 'is-starting-soon' : ''}`}
              >
                {/* Schedule Status Banner */}
                {scheduleStatus.badge && (
                  <div className={`class-schedule-status-banner tier-${scheduleStatus.tier}`}>
                    <span className="status-badge-text">{scheduleStatus.badge}</span>
                    {scheduleStatus.activeLesson?.title && (
                      <span className="lesson-subtext">· {scheduleStatus.activeLesson.title}</span>
                    )}
                    {scheduleStatus.nextLesson?.title && (
                      <span className="lesson-subtext">· {scheduleStatus.nextLesson.title}</span>
                    )}
                  </div>
                )}

                <div className="class-card-header">
                  <div>
                    <h3 className="class-card-title">{c.name || c.id}</h3>
                    <small style={{ color: '#64748b', fontSize: '0.8rem' }}>ID: {c.id}</small>
                  </div>
                  <span className="student-count-badge">
                    👥 {studentCount} student{studentCount === 1 ? '' : 's'}
                  </span>
                </div>

                {/* Custom Tags Pill List */}
                {Array.isArray(c.tags) && c.tags.length > 0 && (
                  <div className="card-tags-list">
                    {c.tags.map(t => (
                      <span
                        key={t}
                        className={`card-tag-pill ${selectedTags.includes(t) ? 'active' : ''}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleTag(t);
                        }}
                        title={`Filter by tag #${t}`}
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}

                <div className="class-schedule-preview">
                  <span>📅</span>
                  <span>
                    {c.schedule?.startDate && c.schedule?.endDate
                      ? `${c.schedule.startDate} ~ ${c.schedule.endDate}`
                      : 'Schedule not configured'}
                  </span>
                </div>

                {/* Resource Metrics */}
                <div className="class-resources">
                  <div>
                    <div className="meter-header">
                      <span>Storage Quota</span>
                      <span>{formatBytes(usage)} / {formatBytes(quota)} <small style={{ color: '#64748b' }}>(~{formatStorageCost(usage)}/mo)</small></span>
                    </div>
                    <div className="meter-track">
                      <div className="meter-fill storage" style={{ width: `${storagePercent}%` }} />
                    </div>
                    <div className="meter-breakdown">
                      <span>Screens: {formatBytes(c.storageUsageScreenShots || 0)}</span>
                      <span>Vids: {formatBytes(c.storageUsageVideos || 0)}</span>
                    </div>
                  </div>

                  <div>
                    <div className="meter-header">
                      <span>AI Budget</span>
                      <span>{formatAiCost(aiUsed)} / ${aiQuota.toFixed(2)}</span>
                    </div>
                    <div className="meter-track">
                      <div className="meter-fill ai" style={{ width: `${aiPercent}%` }} />
                    </div>
                  </div>
                </div>

                {/* Quick Action Shortcuts */}
                <div className="class-action-shortcuts">
                  <Link to={`/class/${c.id}?tab=monitor`} className="shortcut-link">
                    <span>📡</span> Live Monitor
                  </Link>
                  <Link to={`/class/${c.id}?tab=tasks`} className="shortcut-link" title="Practical Tasks & Homework">
                    <span>📋</span> Tasks
                  </Link>
                  <Link to={`/class/${c.id}?tab=video`} className="shortcut-link">
                    <span>🎬</span> Recordings
                  </Link>
                  <Link to={`/class/${c.id}?tab=analytics`} className="shortcut-link">
                    <span>📊</span> Analytics
                  </Link>
                  <Link to={`/class/${c.id}?tab=settings`} className="shortcut-link">
                    <span>⚙️</span> Settings
                  </Link>
                </div>

                <Link to={`/class/${c.id}`} className="open-workspace-btn">
                  <span>Open Class Workspace →</span>
                </Link>
              </div>
            );
          })}
        </div>
      ) : classes.length === 0 ? (
        <div className="empty-dashboard-state">
          <div className="empty-state-icon">🏫</div>
          <h3>No classes enrolled yet</h3>
          <p>Create your first classroom to begin monitoring sessions, generating AI analytics, and managing recordings.</p>
          <Link to="/class-management" className="create-class-btn">
            + Create Your First Class
          </Link>
        </div>
      ) : searchTerm ? (
        <div className="empty-dashboard-state">
          <div className="empty-state-icon">🔍</div>
          <h3>No matching classes found</h3>
          <p>We couldn't find any classes matching "{searchTerm}". Try clearing your search.</p>
          <button className="secondary-btn" onClick={() => setSearchTerm('')}>Clear Search</button>
        </div>
      ) : scheduleFilter === 'today' ? (
        <div className="empty-dashboard-state">
          <div className="empty-state-icon">📅</div>
          <h3>No classes scheduled for today</h3>
          <p>
            You have {classes.length} {classes.length === 1 ? 'course' : 'courses'} in total, but none are scheduled for today.
          </p>
          <button className="secondary-btn" onClick={() => setScheduleFilter('all')}>
            View All Classes ({classes.length})
          </button>
        </div>
      ) : (
        <div className="empty-dashboard-state">
          <div className="empty-state-icon">🏷️</div>
          <h3>No classes match current filter</h3>
          <p>No classes match your active filter criteria.</p>
          <button className="secondary-btn" onClick={clearAllFilters}>
            Clear Filters
          </button>
        </div>
      )}
    </div>
  );
};

export default TeacherView;

