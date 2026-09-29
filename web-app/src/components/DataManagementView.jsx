import React, { useState, useEffect } from 'react';
import { db, storage, functions } from '../firebase-config';
import { doc, deleteDoc, getDoc, onSnapshot } from 'firebase/firestore';
import { ref, deleteObject, getDownloadURL } from 'firebase/storage';
import './SharedViews.css';

import { httpsCallable } from 'firebase/functions';
import usePaginatedQuery from '../hooks/useCollectionQuery';

const formatBytes = (bytes = 0) => {
  if (bytes === 0 || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
};

const toLocalISOString = (date) => {
  if (!date) return '';
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  const h = date.getHours().toString().padStart(2, '0');
  const min = date.getMinutes().toString().padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
};

const DataManagementView = ({ classId, startTime, endTime, filterField, timezone }) => {
  const [selectedZipJobs, setSelectedZipJobs] = useState(new Set());
  const [storageData, setStorageData] = useState(null);
  const [classQuotaBytes, setClassQuotaBytes] = useState(5 * 1024 * 1024 * 1024); // 5GB default
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalculateMessage, setRecalculateMessage] = useState('');

  // Granular deletion targets
  const [targets, setTargets] = useState({
    screenshots: true,
    audio: true,
    videos: false,
    lectureRecordings: false,
  });

  // Scope preset state: defaults to 'lesson' to respect parent lesson boundaries
  const [scopePreset, setScopePreset] = useState('lesson');
  const [customStart, setCustomStart] = useState(startTime || '');
  const [customEnd, setCustomEnd] = useState(endTime || '');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletionStatus, setDeletionStatus] = useState(null);

  // Subscribe to storage usage metadata
  useEffect(() => {
    if (!classId) return;
    const storageDocRef = doc(db, 'classes', classId, 'metadata', 'storage');
    const unsub = onSnapshot(storageDocRef, (snap) => {
      if (snap.exists && snap.exists()) {
        setStorageData(snap.data());
      } else {
        setStorageData(null);
      }
    }, (err) => {
      console.warn('Could not subscribe to storage metadata:', err);
    });

    // Also fetch class storageQuota
    const classDocRef = doc(db, 'classes', classId);
    getDoc(classDocRef).then((snap) => {
      if (snap.exists && snap.exists()) {
        const cData = snap.data();
        if (cData.storageQuota) {
          setClassQuotaBytes(cData.storageQuota);
        }
      }
    }).catch((err) => console.warn('Could not fetch class quota:', err));

    return () => unsub();
  }, [classId]);

  // Keep customStart/customEnd synced if parent props change
  useEffect(() => {
    if (startTime) setCustomStart(startTime);
    if (endTime) setCustomEnd(endTime);
  }, [startTime, endTime]);

  const { 
    data: zipJobs, 
    loading: loadingJobs, 
    page, 
    isLastPage, 
    fetchNextPage, 
    fetchPrevPage, 
    refetch 
  } = usePaginatedQuery('zipJobs', {
    classId,
    startTime,
    endTime,
    filterField: filterField,
    orderByField: filterField
  });

  // Calculate effective date bounds based on selected scope preset
  const getEffectiveDates = () => {
    const now = new Date();
    if (scopePreset === 'lesson') {
      return { start: startTime || customStart, end: endTime || customEnd };
    }
    if (scopePreset === '14days') {
      const past = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      return { start: toLocalISOString(past), end: toLocalISOString(now) };
    }
    if (scopePreset === '30days') {
      const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { start: toLocalISOString(past), end: toLocalISOString(now) };
    }
    if (scopePreset === '90days') {
      const past = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      return { start: toLocalISOString(past), end: toLocalISOString(now) };
    }
    return { start: customStart, end: customEnd };
  };

  const handleSelectZipJob = (jobId) => {
    setSelectedZipJobs(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(jobId)) {
        newSelection.delete(jobId);
      } else {
        newSelection.add(jobId);
      }
      return newSelection;
    });
  };

  const handleSelectAllZipJobs = (e) => {
    if (e.target.checked) {
      const allJobIds = new Set(zipJobs.map(job => job.id));
      setSelectedZipJobs(allJobIds);
    } else {
      setSelectedZipJobs(new Set());
    }
  };

  const deleteZipJob = async (jobId) => {
    const jobDocRef = doc(db, 'zipJobs', jobId);
    const jobDocSnap = await getDoc(jobDocRef);

    if (jobDocSnap.exists && jobDocSnap.exists()) {
      const jobData = jobDocSnap.data();
      if (jobData.zipPath) {
        const storageRef = ref(storage, jobData.zipPath);
        await deleteObject(storageRef);
      }
    }
    await deleteDoc(jobDocRef);
  };

  const handleDeleteSelectedZipJobs = async () => {
    if (selectedZipJobs.size === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedZipJobs.size} selected jobs? This will also delete their associated zip files.`)) {
      return;
    }

    const errors = [];
    for (const jobId of selectedZipJobs) {
      try {
        await deleteZipJob(jobId);
      } catch (error) {
        console.error(`Failed to delete job ${jobId}`, error);
        errors.push(jobId);
      }
    }

    setSelectedZipJobs(new Set());
    if (errors.length > 0) {
      alert(`Failed to delete ${errors.length} jobs. See console for details.`);
    } else {
      alert(`Successfully deleted ${selectedZipJobs.size} jobs.`);
    }
    refetch();
  };

  // Recalculate Storage Function
  const handleRecalculateStorage = async () => {
    if (!classId) return;
    setIsRecalculating(true);
    setRecalculateMessage('');
    try {
      const recalculateFn = httpsCallable(functions, 'recalculateStorageUsage');
      const res = await recalculateFn({ classId });
      setRecalculateMessage(res.data?.message || 'Storage synchronized successfully.');
    } catch (err) {
      console.error('Error recalculating storage:', err);
      setRecalculateMessage(`Failed to recalculate: ${err.message}`);
    } finally {
      setIsRecalculating(false);
    }
  };

  // Main Deletion Handler
  const handleDeleteData = async () => {
    const { start: activeStart, end: activeEnd } = getEffectiveDates();

    if (!activeStart || !activeEnd) {
      alert('Please select a start and end date.');
      return;
    }

    const anyTargetSelected = targets.screenshots || targets.audio || targets.videos || targets.lectureRecordings;
    if (!anyTargetSelected) {
      alert('Please select at least one data type to delete.');
      return;
    }

    const targetNames = [];
    if (targets.screenshots) targetNames.push('Screenshots');
    if (targets.audio) targetNames.push('Audio');
    if (targets.videos) targetNames.push('Student Videos');
    if (targets.lectureRecordings) targetNames.push('Lecture Recordings');

    const confirmation = window.confirm(
      `Are you sure you want to delete student session telemetry (${targetNames.join(', ')}) in this date range?\n\nThis permanently purges media files from Cloud Storage to free up class quota and cannot be undone.`
    );
    if (!confirmation) return;

    const deleteFunction = httpsCallable(functions, 'deleteScreenshotsByDateRange');

    setIsDeleting(true);
    setDeletionStatus(null);

    try {
      alert("Starting the deletion process. This may take some time. You can close this window.");
      const result = await deleteFunction({
        classId,
        startDate: activeStart,
        endDate: activeEnd,
        timezone: timezone || 'UTC',
        targets,
      });

      setDeletionStatus({
        type: 'success',
        message: result.data?.message || 'Telemetry successfully purged.',
      });
      alert(result.data.message);
    } catch (error) {
      console.error("Error calling delete function: ", error);
      setDeletionStatus({
        type: 'error',
        message: error.message,
      });
      alert(`An error occurred: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDownloadZip = async (zipPath) => {
    try {
      const zipRef = ref(storage, zipPath);
      const downloadUrl = await getDownloadURL(zipRef);
      window.open(downloadUrl, '_blank');
    } catch (error) {
      console.error("Error getting download URL: ", error);
      alert(`Failed to get download link: ${error.message}`);
    }
  };

  // Compute breakdown percentages
  const totalUsage = storageData?.storageUsage || 0;
  const usageShots = storageData?.storageUsageScreenShots || 0;
  const usageAudio = storageData?.storageUsageAudio || 0;
  const usageVideos = storageData?.storageUsageVideos || 0;
  const usageRecordings = storageData?.storageUsageRecordings || 0;
  const usageZips = storageData?.storageUsageZips || 0;

  const quotaPercent = Math.min(100, (totalUsage / (classQuotaBytes || 1)) * 100).toFixed(1);
  const pShots = totalUsage > 0 ? ((usageShots / totalUsage) * 100).toFixed(1) : 0;
  const pAudio = totalUsage > 0 ? ((usageAudio / totalUsage) * 100).toFixed(1) : 0;
  const pVideos = totalUsage > 0 ? ((usageVideos / totalUsage) * 100).toFixed(1) : 0;
  const pRecordings = totalUsage > 0 ? ((usageRecordings / totalUsage) * 100).toFixed(1) : 0;
  const pZips = totalUsage > 0 ? ((usageZips / totalUsage) * 100).toFixed(1) : 0;

  return (
    <div className="view-container">
      <div className="view-header">
        <h2>Data Management</h2>
      </div>

      {/* 1. Storage Consumption & Breakdown Dashboard */}
      <div className="data-mgmt-card">
        <div className="data-mgmt-header">
          <h3>📊 Cloud Storage Quota & Usage</h3>
          <button
            className="scope-preset-btn"
            onClick={handleRecalculateStorage}
            disabled={isRecalculating}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span className={isRecalculating ? 'spin' : ''}>🔄</span>
            {isRecalculating ? 'Auditing Storage...' : 'Recalculate Storage'}
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#475569', marginBottom: '4px' }}>
          <span><strong>Total Allocated:</strong> {formatBytes(totalUsage)} / {formatBytes(classQuotaBytes)} ({quotaPercent}%)</span>
          <span>{formatBytes(Math.max(0, classQuotaBytes - totalUsage))} remaining</span>
        </div>

        {/* Visual Stacked Progress Bar */}
        <div className="storage-progress-container" role="progressbar" aria-valuenow={quotaPercent} aria-valuemin="0" aria-valuemax="100">
          <div className="storage-segment screenshots" style={{ width: `${pShots}%` }} title={`Screenshots: ${formatBytes(usageShots)}`} />
          <div className="storage-segment audio" style={{ width: `${pAudio}%` }} title={`Audio: ${formatBytes(usageAudio)}`} />
          <div className="storage-segment videos" style={{ width: `${pVideos}%` }} title={`Student Videos: ${formatBytes(usageVideos)}`} />
          <div className="storage-segment recordings" style={{ width: `${pRecordings}%` }} title={`Lecture Recordings: ${formatBytes(usageRecordings)}`} />
          <div className="storage-segment zips" style={{ width: `${pZips}%` }} title={`ZIP Archives: ${formatBytes(usageZips)}`} />
        </div>

        {/* Legend Grid */}
        <div className="storage-legend-grid">
          <div className="storage-legend-item">
            <span className="legend-dot" style={{ background: '#3b82f6' }}></span>
            <span>📸 Screenshots: <strong>{formatBytes(usageShots)}</strong></span>
          </div>
          <div className="storage-legend-item">
            <span className="legend-dot" style={{ background: '#10b981' }}></span>
            <span>🎙️ Audio: <strong>{formatBytes(usageAudio)}</strong></span>
          </div>
          <div className="storage-legend-item">
            <span className="legend-dot" style={{ background: '#8b5cf6' }}></span>
            <span>🎥 Videos: <strong>{formatBytes(usageVideos)}</strong></span>
          </div>
          <div className="storage-legend-item">
            <span className="legend-dot" style={{ background: '#f59e0b' }}></span>
            <span>🎬 Recordings: <strong>{formatBytes(usageRecordings)}</strong></span>
          </div>
          <div className="storage-legend-item">
            <span className="legend-dot" style={{ background: '#06b6d4' }}></span>
            <span>📦 ZIPs: <strong>{formatBytes(usageZips)}</strong></span>
          </div>
        </div>

        {recalculateMessage && (
          <div style={{ marginTop: '10px', fontSize: '0.85rem', color: recalculateMessage.includes('Failed') ? '#dc2626' : '#16a34a' }}>
            ℹ️ {recalculateMessage}
          </div>
        )}
      </div>

      {/* 2. Selective & Granular Deletion Panel */}
      <div className="data-mgmt-card">
        <div className="data-mgmt-header">
          <h3>🗑️ Selective Telemetry Purge</h3>
        </div>
        <p style={{ margin: '0 0 1rem 0', fontSize: '0.88rem', color: '#64748b' }}>
          Selectively delete heavy binary assets from Cloud Storage to reclaim class quota while preserving all student records and analytics.
        </p>

        <div className="purge-controls-grid">
          {/* Target Types Selector */}
          <div className="purge-options-box">
            <strong style={{ fontSize: '0.9rem', color: '#1e293b' }}>1. Select Data Types to Purge:</strong>
            <div className="scope-preset-buttons" style={{ marginTop: '8px' }}>
              <button
                type="button"
                role="switch"
                aria-checked={targets.screenshots}
                className={`scope-preset-btn ${targets.screenshots ? 'active' : ''}`}
                onClick={() => setTargets(prev => ({ ...prev, screenshots: !prev.screenshots }))}
              >
                📸 Screenshots {targets.screenshots ? '✓' : '+'}
              </button>

              <button
                type="button"
                role="switch"
                aria-checked={targets.audio}
                className={`scope-preset-btn ${targets.audio ? 'active' : ''}`}
                onClick={() => setTargets(prev => ({ ...prev, audio: !prev.audio }))}
              >
                🎙️ Audio {targets.audio ? '✓' : '+'}
              </button>

              <button
                type="button"
                role="switch"
                aria-checked={targets.videos}
                className={`scope-preset-btn ${targets.videos ? 'active' : ''}`}
                onClick={() => setTargets(prev => ({ ...prev, videos: !prev.videos }))}
              >
                🎥 Student Videos {targets.videos ? '✓' : '+'}
              </button>

              <button
                type="button"
                role="switch"
                aria-checked={targets.lectureRecordings}
                className={`scope-preset-btn ${targets.lectureRecordings ? 'active' : ''}`}
                onClick={() => setTargets(prev => ({ ...prev, lectureRecordings: !prev.lectureRecordings }))}
              >
                🎬 Recordings {targets.lectureRecordings ? '✓' : '+'}
              </button>
            </div>
          </div>

          {/* Date Range Scope Selector */}
          <div className="purge-options-box">
            <strong style={{ fontSize: '0.9rem', color: '#1e293b' }}>2. Select Date Range / Scope:</strong>
            <div className="scope-preset-buttons">
              <button
                type="button"
                className={`scope-preset-btn ${scopePreset === 'lesson' ? 'active' : ''}`}
                onClick={() => setScopePreset('lesson')}
              >
                Current Lesson
              </button>
              <button
                type="button"
                className={`scope-preset-btn ${scopePreset === '14days' ? 'active' : ''}`}
                onClick={() => setScopePreset('14days')}
              >
                Older than 14 Days
              </button>
              <button
                type="button"
                className={`scope-preset-btn ${scopePreset === '30days' ? 'active' : ''}`}
                onClick={() => setScopePreset('30days')}
              >
                Older than 30 Days
              </button>
              <button
                type="button"
                className={`scope-preset-btn ${scopePreset === '90days' ? 'active' : ''}`}
                onClick={() => setScopePreset('90days')}
              >
                Older than 90 Days
              </button>
              <button
                type="button"
                className={`scope-preset-btn ${scopePreset === 'custom' ? 'active' : ''}`}
                onClick={() => setScopePreset('custom')}
              >
                Custom Range
              </button>
            </div>

            {scopePreset === 'custom' && (
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '10px', flexWrap: 'wrap' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', marginBottom: '2px' }}>Start Date/Time:</label>
                  <input
                    type="datetime-local"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', marginBottom: '2px' }}>End Date/Time:</label>
                  <input
                    type="datetime-local"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Analytics Safety Guarantee Banner */}
        <div className="data-callout-info">
          <span>🛡️</span>
          <div>
            <strong>Data Integrity Guarantee:</strong> Purging session telemetry removes large storage blobs (.jpg, .webm, .mp4) to reclaim quota. Student attendance records, activity milestone progress, task submissions, grades, and irregularity reports are preserved permanently in Firestore.
          </div>
        </div>

        <div className="actions-container" style={{ marginTop: '1.25rem', marginBottom: 0 }}>
          <button
            onClick={handleDeleteData}
            disabled={isDeleting}
            style={{
              backgroundColor: '#dc2626',
              color: '#ffffff',
              border: 'none',
              padding: '0.6rem 1.25rem',
              borderRadius: '8px',
              fontWeight: 600,
              cursor: isDeleting ? 'not-allowed' : 'pointer',
              opacity: isDeleting ? 0.7 : 1,
            }}
          >
            {isDeleting ? 'Purging Telemetry...' : 'Delete Session Data (Images & Audio) in Range'}
          </button>
        </div>

        {deletionStatus && (
          <div style={{ marginTop: '10px', fontSize: '0.9rem', color: deletionStatus.type === 'error' ? '#dc2626' : '#16a34a' }}>
            {deletionStatus.type === 'error' ? '❌' : '✅'} {deletionStatus.message}
          </div>
        )}
      </div>

      <hr style={{ margin: '20px 0' }} />

      {/* 3. Video Archives (ZIP Jobs) Table */}
      <div>
        <h3>Video Archives (ZIP Jobs)</h3>
        <div className="actions-container" style={{ marginBottom: '10px' }}>
            <button onClick={handleDeleteSelectedZipJobs} disabled={selectedZipJobs.size === 0}>
                Delete Selected ({selectedZipJobs.size})
            </button>
        </div>
        <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" onChange={handleSelectAllZipJobs} /></th>
                  <th>Requested At</th>
                  <th>Status</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {loadingJobs && zipJobs.length === 0 ? (
                    <tr><td colSpan="4">Loading...</td></tr>
                ) : zipJobs.length > 0 ? (
                    zipJobs.map(job => (
                    <tr key={job.id}>
                        <td>
                            <input
                                type="checkbox"
                                checked={selectedZipJobs.has(job.id)}
                                onChange={() => handleSelectZipJob(job.id)}
                            />
                        </td>
                        <td>
                          {job.createdAt?.toDate
                            ? job.createdAt.toDate().toLocaleString()
                            : job.createdAt
                            ? new Date(job.createdAt).toLocaleString()
                            : 'N/A'}
                        </td>
                        <td>{job.status}</td>
                        <td>
                        {job.status === 'completed' && job.zipPath ? (
                            <button onClick={() => handleDownloadZip(job.zipPath)}>Download</button>
                        ) : (
                            <span>{job.status === 'failed' ? `Failed: ${job.error}` : 'Processing...'}</span>
                        )}
                        </td>
                    </tr>
                    ))
                ) : (
                    <tr><td colSpan="4">No video archive jobs found for this class.</td></tr>
                )}
              </tbody>
            </table>
        </div>
        <div className="pagination-controls">
            <button onClick={fetchPrevPage} disabled={page <= 1 || loadingJobs}>
            Previous
            </button>
            <span>Page {page}</span>
            <button onClick={fetchNextPage} disabled={isLastPage || loadingJobs}>
            Next
            </button>
        </div>
      </div>
    </div>
  );
};

export default DataManagementView;
