import { useState, useEffect, useMemo } from 'react';
import { onSnapshot, getDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase-config';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import Modal from './Modal';
import './TeacherView.css';
import { formatBytes, formatAiCost } from '../utils/formatters';

const TeacherView = ({ user }) => {
  const [classes, setClasses] = useState([]);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newClassId, setNewClassId] = useState('');
  const [newClassName, setNewClassName] = useState('');
  const [createError, setCreateError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const checkRole = async () => {
      if (user) {
        let idTokenResult = await user.getIdTokenResult();
        if (!idTokenResult.claims.role) {
          idTokenResult = await user.getIdTokenResult(true);
        }
        setRole(idTokenResult.claims.role);
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
    let totalStudents = 0;
    let totalStorageUsed = 0;
    let totalStorageQuota = 0;
    let totalAiUsed = 0;
    let totalAiQuota = 0;

    classes.forEach(c => {
      const studentCount = c.students ? Object.keys(c.students).length : (c.studentEmails?.length || 0);
      totalStudents += studentCount;
      totalStorageUsed += (c.storageUsage || 0);
      totalStorageQuota += (c.storageQuota || 0);
      totalAiUsed += (c.aiUsedQuota || 0);
      totalAiQuota += (c.aiQuota || 10);
    });

    return {
      totalClasses: classes.length,
      totalStudents,
      totalStorageUsed,
      totalStorageQuota,
      totalAiUsed,
      totalAiQuota
    };
  }, [classes]);

  // Filtered classes by search term
  const filteredClasses = useMemo(() => {
    if (!searchTerm.trim()) return classes;
    const term = searchTerm.toLowerCase();
    return classes.filter(c =>
      (c.id && c.id.toLowerCase().includes(term)) ||
      (c.name && c.name.toLowerCase().includes(term))
    );
  }, [classes, searchTerm]);

  const handleCreateClass = async (e) => {
    e.preventDefault();
    const cleanId = newClassId.trim().toLowerCase();
    if (!cleanId) {
      setCreateError('Class ID is required.');
      return;
    }
    if (cleanId.length < 3) {
      setCreateError('Class ID must be at least 3 characters.');
      return;
    }
    if (cleanId.includes('/')) {
      setCreateError('Class ID cannot contain slashes.');
      return;
    }

    setIsCreating(true);
    setCreateError('');

    try {
      const classRef = doc(db, 'classes', cleanId);
      const existingSnap = await getDoc(classRef);
      if (existingSnap.exists()) {
        setCreateError(`Class with ID "${cleanId}" already exists.`);
        setIsCreating(false);
        return;
      }

      const defaultQuotaBytes = 5 * 1024 * 1024 * 1024; // 5 GB
      await setDoc(classRef, {
        name: newClassName.trim() || cleanId,
        teacherEmails: [user.email.toLowerCase()],
        studentEmails: [],
        storageQuota: defaultQuotaBytes,
        storageUsage: 0,
        aiQuota: 10,
        aiUsedQuota: 0,
        automaticCapture: false,
        automaticCombine: false,
      });

      setShowCreateModal(false);
      setNewClassId('');
      setNewClassName('');
      navigate(`/class/${cleanId}?tab=settings`);
    } catch (err) {
      console.error('Error creating class:', err);
      setCreateError(err.message || 'Failed to create class.');
    } finally {
      setIsCreating(false);
    }
  };

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
          <button className="create-class-btn" onClick={() => setShowCreateModal(true)}>
            <span>+ Create New Class</span>
          </button>
        </div>
      </div>

      {/* KPI Overview Grid */}
      <div className="dashboard-kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon blue">🏫</div>
          <div className="kpi-content">
            <span className="kpi-label">Active Classes</span>
            <span className="kpi-value">{stats.totalClasses}</span>
            <span className="kpi-subtext">Total courses enrolled</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon emerald">👥</div>
          <div className="kpi-content">
            <span className="kpi-label">Total Students</span>
            <span className="kpi-value">{stats.totalStudents}</span>
            <span className="kpi-subtext">Enrolled across all classes</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon amber">💾</div>
          <div className="kpi-content">
            <span className="kpi-label">Storage Usage</span>
            <span className="kpi-value">{formatBytes(stats.totalStorageUsed)}</span>
            <span className="kpi-subtext">
              {stats.totalStorageQuota > 0 ? `of ${formatBytes(stats.totalStorageQuota)} allotted` : 'Total used'}
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
        <h2>Your Classes ({filteredClasses.length})</h2>
        <div className="classes-search-box">
          <span className="search-icon-placeholder">🔍</span>
          <input
            type="text"
            placeholder="Search classes by name or code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
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

            return (
              <div key={c.id} className="class-card">
                <div className="class-card-header">
                  <div>
                    <h3 className="class-card-title">{c.name || c.id}</h3>
                    <small style={{ color: '#64748b', fontSize: '0.8rem' }}>ID: {c.id}</small>
                  </div>
                  <span className="student-count-badge">
                    👥 {studentCount} student{studentCount === 1 ? '' : 's'}
                  </span>
                </div>

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
                      <span>{formatBytes(usage)} / {formatBytes(quota)}</span>
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
      ) : (
        <div className="empty-dashboard-state">
          <div className="empty-state-icon">🏫</div>
          <h3>{searchTerm ? 'No matching classes found' : 'No classes enrolled yet'}</h3>
          <p>
            {searchTerm
              ? `We couldn't find any classes matching "${searchTerm}". Try clearing your search.`
              : 'Create your first classroom to begin monitoring sessions, generating AI analytics, and managing recordings.'}
          </p>
          {searchTerm ? (
            <button className="secondary-btn" onClick={() => setSearchTerm('')}>Clear Search</button>
          ) : (
            <button className="create-class-btn" onClick={() => setShowCreateModal(true)}>
              + Create Your First Class
            </button>
          )}
        </div>
      )}

      {/* Quick Create Class Modal */}
      <Modal show={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create New Class">
        <form onSubmit={handleCreateClass} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '0.5rem 0' }}>
          <div>
            <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
              Class ID / Course Code <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. it114115-2026-s1"
              value={newClassId}
              onChange={(e) => setNewClassId(e.target.value.toLowerCase())}
              style={{ width: '100%' }}
              required
            />
            <small style={{ color: '#64748b', fontSize: '0.75rem' }}>Letters, numbers, and hyphens only. Lowercase.</small>
          </div>

          <div>
            <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
              Class Display Name
            </label>
            <input
              type="text"
              placeholder="e.g. Cloud Architecture Practical Lab"
              value={newClassName}
              onChange={(e) => setNewClassName(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          {createError && (
            <div style={{ padding: '0.75rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#ef4444', borderRadius: '6px', fontSize: '0.85rem' }}>
              {createError}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="button" className="secondary-btn" onClick={() => setShowCreateModal(false)}>
              Cancel
            </button>
            <button type="submit" disabled={isCreating}>
              {isCreating ? 'Creating...' : 'Create & Configure'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default TeacherView;

