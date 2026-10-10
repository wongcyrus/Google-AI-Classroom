import React, { useState, useEffect } from 'react';
import { db, storage, functions } from '../firebase-config';
import { doc, deleteDoc, getDoc, onSnapshot } from 'firebase/firestore';
import { ref, deleteObject, getDownloadURL } from 'firebase/storage';
import './SharedViews.css';

import { httpsCallable } from 'firebase/functions';
import usePaginatedQuery from '../hooks/useCollectionQuery';
import useCloudPricing from '../hooks/useCloudPricing';
import { formatBytes, formatStorageCost } from '../utils/formatters';

const toLocalISOString = (date) => {
  if (!date) return '';
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  const h = date.getHours().toString().padStart(2, '0');
  const min = date.getMinutes().toString().padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
};

const DataManagementView = ({ 
  classId, 
  startTime, 
  endTime, 
  filterField, 
  timezone,
  onStartTimeChange,
  onEndTimeChange,
}) => {
  const [selectedZipJobs, setSelectedZipJobs] = useState(new Set());
  const [storageData, setStorageData] = useState(null);
  const [classQuotaBytes, setClassQuotaBytes] = useState(5 * 1024 * 1024 * 1024); // 5GB default
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalculateMessage, setRecalculateMessage] = useState('');
  const { storageRatePerGibMonth, storageRegion, storageDescription } = useCloudPricing();

  // Granular deletion targets
  const [targets, setTargets] = useState({
    screenshots: true,
    audio: true,
    videos: false,
    lectureRecordings: false,
    irregularities: false,
    bingoRecords: false,
  });

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
    if (!startTime || !endTime) {
      alert('Please select a start and end date using the date filter at the top of the page.');
      return;
    }

    const anyTargetSelected = targets.screenshots || targets.audio || targets.videos || targets.lectureRecordings || targets.irregularities || targets.bingoRecords;
    if (!anyTargetSelected) {
      alert('Please select at least one data type to delete.');
      return;
    }

    const targetNames = [];
    if (targets.screenshots) targetNames.push('Screenshots');
    if (targets.audio) targetNames.push('Audio');
    if (targets.videos) targetNames.push('Student Videos');
    if (targets.lectureRecordings) targetNames.push('Lecture Recordings');
    if (targets.irregularities) targetNames.push('Irregularities & Evidences');
    if (targets.bingoRecords) targetNames.push('Activity & Bingo Records');

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
        startDate: startTime,
        endDate: endTime,
        timezone: timezone || 'UTC',
        targets,
      });

      setDeletionStatus({
        type: 'success',
        message: result.data?.message || 'Telemetry successfully purged.',
      });
      alert(result.data.message);
      // Auto-recalculate storage to update UI immediately
      handleRecalculateStorage();
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

  // Compute breakdown percentages safely
  const totalUsage = Math.max(0, Number(storageData?.storageUsage) || 0);
  const usageShots = Math.max(0, Number(storageData?.storageUsageScreenShots) || 0);
  const usageAudio = Math.max(0, Number(storageData?.storageUsageAudio) || 0);
  const usageVideos = Math.max(0, Number(storageData?.storageUsageVideos) || 0);
  const usageRecordings = Math.max(0, Number(storageData?.storageUsageRecordings) || 0);
  const usageZips = Math.max(0, Number(storageData?.storageUsageZips) || 0);
  const usageIrregularities = Math.max(0, Number(storageData?.storageUsageIrregularities) || 0);

  const effectiveQuota = Number(classQuotaBytes) > 0 ? Number(classQuotaBytes) : (5 * 1024 * 1024 * 1024);
  const quotaPercent = Math.min(100, Math.max(0, (totalUsage / effectiveQuota) * 100)).toFixed(1);

  // Each segment's width is its proportion OF THE TOTAL CLASS QUOTA (so stacked segments fill up to quotaPercent% of the full bar)
  const pShots = Math.min(100, Math.max(0, (usageShots / effectiveQuota) * 100));
  const pAudio = Math.min(100, Math.max(0, (usageAudio / effectiveQuota) * 100));
  const pVideos = Math.min(100, Math.max(0, (usageVideos / effectiveQuota) * 100));
  const pRecordings = Math.min(100, Math.max(0, (usageRecordings / effectiveQuota) * 100));
  const pZips = Math.min(100, Math.max(0, (usageZips / effectiveQuota) * 100));
  const pIrregularities = Math.min(100, Math.max(0, (usageIrregularities / effectiveQuota) * 100));

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

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', fontSize: '0.9rem', color: '#475569', marginBottom: '6px' }}>
          <div>
            <span><strong>Total Allocated:</strong> {formatBytes(totalUsage)} / {formatBytes(classQuotaBytes)} ({quotaPercent}%)</span>
            <span style={{ marginLeft: '8px', color: '#0284c7', fontWeight: 600 }}>
              • Est. Cost: ~{formatStorageCost(totalUsage, storageRatePerGibMonth)}/mo
            </span>
            <span style={{ marginLeft: '4px', color: '#64748b', fontSize: '0.82rem' }}>
              (Quota Cap: ~{formatStorageCost(classQuotaBytes, storageRatePerGibMonth)}/mo)
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.78rem', background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px', color: '#475569', border: '1px solid #e2e8f0' }} title={`Synced from Cloud Billing Catalog API (${storageDescription})`}>
              🏷️ Rate: ${storageRatePerGibMonth}/GB-mo ({storageRegion})
            </span>
            <span>{formatBytes(Math.max(0, classQuotaBytes - totalUsage))} remaining</span>
          </div>
        </div>

        {/* Visual Stacked Progress Bar */}
        <div className="storage-progress-container" role="progressbar" aria-valuenow={quotaPercent} aria-valuemin="0" aria-valuemax="100">
          <div className="storage-segment screenshots" style={{ width: `${pShots}%` }} title={`Screenshots: ${formatBytes(usageShots)} (~${formatStorageCost(usageShots, storageRatePerGibMonth)}/mo)`} />
          <div className="storage-segment audio" style={{ width: `${pAudio}%` }} title={`Audio: ${formatBytes(usageAudio)} (~${formatStorageCost(usageAudio, storageRatePerGibMonth)}/mo)`} />
          <div className="storage-segment videos" style={{ width: `${pVideos}%` }} title={`Student Videos: ${formatBytes(usageVideos)} (~${formatStorageCost(usageVideos, storageRatePerGibMonth)}/mo)`} />
          <div className="storage-segment recordings" style={{ width: `${pRecordings}%` }} title={`Lecture Recordings: ${formatBytes(usageRecordings)} (~${formatStorageCost(usageRecordings, storageRatePerGibMonth)}/mo)`} />
          <div className="storage-segment zips" style={{ width: `${pZips}%` }} title={`ZIP Archives: ${formatBytes(usageZips)} (~${formatStorageCost(usageZips, storageRatePerGibMonth)}/mo)`} />
          <div className="storage-segment irregularities" style={{ width: `${pIrregularities}%` }} title={`Irregularities: ${formatBytes(usageIrregularities)} (~${formatStorageCost(usageIrregularities, storageRatePerGibMonth)}/mo)`} />
        </div>

        {/* Legend Grid */}
        <div className="storage-legend-grid">
          <div className="storage-legend-item">
            <span className="legend-dot" style={{ background: '#3b82f6' }}></span>
            <span>📸 Screenshots: <strong>{formatBytes(usageShots)}</strong> <small style={{ color: '#64748b' }}>(~{formatStorageCost(usageShots, storageRatePerGibMonth)}/mo)</small></span>
          </div>
          <div className="storage-legend-item">
            <span className="legend-dot" style={{ background: '#10b981' }}></span>
            <span>🎙️ Audio: <strong>{formatBytes(usageAudio)}</strong> <small style={{ color: '#64748b' }}>(~{formatStorageCost(usageAudio, storageRatePerGibMonth)}/mo)</small></span>
          </div>
          <div className="storage-legend-item">
            <span className="legend-dot" style={{ background: '#8b5cf6' }}></span>
            <span>🎥 Videos: <strong>{formatBytes(usageVideos)}</strong> <small style={{ color: '#64748b' }}>(~{formatStorageCost(usageVideos, storageRatePerGibMonth)}/mo)</small></span>
          </div>
          <div className="storage-legend-item">
            <span className="legend-dot" style={{ background: '#f59e0b' }}></span>
            <span>🎬 Recordings: <strong>{formatBytes(usageRecordings)}</strong> <small style={{ color: '#64748b' }}>(~{formatStorageCost(usageRecordings, storageRatePerGibMonth)}/mo)</small></span>
          </div>
          <div className="storage-legend-item">
            <span className="legend-dot" style={{ background: '#06b6d4' }}></span>
            <span>📦 ZIPs: <strong>{formatBytes(usageZips)}</strong> <small style={{ color: '#64748b' }}>(~{formatStorageCost(usageZips, storageRatePerGibMonth)}/mo)</small></span>
          </div>
          <div className="storage-legend-item">
            <span className="legend-dot" style={{ background: '#ef4444' }}></span>
            <span>⚠️ Irregularities: <strong>{formatBytes(usageIrregularities)}</strong> <small style={{ color: '#64748b' }}>(~{formatStorageCost(usageIrregularities, storageRatePerGibMonth)}/mo)</small></span>
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

              <button
                type="button"
                role="switch"
                aria-checked={targets.irregularities}
                className={`scope-preset-btn ${targets.irregularities ? 'active' : ''}`}
                onClick={() => setTargets(prev => ({ ...prev, irregularities: !prev.irregularities }))}
              >
                ⚠️ Irregularities {targets.irregularities ? '✓' : '+'}
              </button>

              <button
                type="button"
                role="switch"
                aria-checked={targets.bingoRecords}
                className={`scope-preset-btn ${targets.bingoRecords ? 'active' : ''}`}
                onClick={() => setTargets(prev => ({ ...prev, bingoRecords: !prev.bingoRecords }))}
              >
                🎲 Activity & Bingo Logs {targets.bingoRecords ? '✓' : '+'}
              </button>
            </div>
          </div>

          {/* Active Date Range Indicator from Top Filter */}
          <div className="purge-options-box">
            <strong style={{ fontSize: '0.9rem', color: '#1e293b' }}>2. Active Purge Range:</strong>
            <p style={{ margin: '4px 0 8px 0', fontSize: '0.8rem', color: '#64748b' }}>
              Controlled by the common date range & lesson filter at the top of the classroom hub.
            </p>
            <div style={{ marginTop: '8px', fontSize: '0.88rem', color: '#334155', lineHeight: 1.6 }}>
              {startTime && endTime ? (
                <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                  <div>📅 <strong>From:</strong> {new Date(startTime).toLocaleString()}</div>
                  <div>📅 <strong>To:</strong> &nbsp;&nbsp;&nbsp;&nbsp;{new Date(endTime).toLocaleString()}</div>
                </div>
              ) : (
                <div style={{ color: '#dc2626', background: '#fef2f2', padding: '8px 12px', borderRadius: '6px', border: '1px solid #fecaca' }}>
                  ⚠️ No date range selected. Please pick a lesson or adjust the date filter at the top of the page.
                </div>
              )}
            </div>

            {onStartTimeChange && onEndTimeChange && (
              <div style={{ marginTop: '12px' }}>
                <button
                  type="button"
                  className="scope-preset-btn"
                  onClick={() => {
                    onStartTimeChange('2020-01-01T00:00');
                    const now = new Date();
                    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                    onEndTimeChange(toLocalISOString(tomorrow));
                  }}
                  title="Expands the top date filter to cover all historical records"
                  style={{ fontSize: '0.82rem' }}
                >
                  ⚡ Set Top Filter to All Time (Entire History)
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Analytics Safety Guarantee Banner */}
        <div className="data-callout-info">
          <span>🛡️</span>
          <div>
            <strong>Data Integrity & Audit Guarantee:</strong> Purging media permanently removes heavy binary files (.jpg, .webm, .mp4) from Cloud Storage to reclaim class quota. Student attendance records, activity milestone progress, task submissions, and grades are permanently preserved. Irregularities and Bingo logs are only removed if explicitly selected above.
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
