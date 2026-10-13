
import React from 'react';
import StudentBadge from './common/StudentBadge';

const formatDuration = (seconds) => {
  if (!seconds) return 'N/A';
  return new Date(seconds * 1000).toISOString().substr(11, 8);
};

const formatSize = (bytes) => {
  if (!bytes) return 'N/A';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

export const parseToDate = (val) => {
  if (!val) return null;
  if (typeof val.toDate === 'function') {
    try {
      return val.toDate();
    } catch {
      return null;
    }
  }
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : val;
  }
  if (typeof val === 'object' && typeof val._seconds === 'number') {
    return new Date(val._seconds * 1000);
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

export const formatSessionTime = (startTime, endTime, createdAt) => {
  const start = parseToDate(startTime);
  const end = parseToDate(endTime);
  const created = parseToDate(createdAt);

  if (!start && !end && !created) return <span style={{ color: '#94a3b8' }}>N/A</span>;

  const dateObj = start || created || end;
  const dateStr = dateObj ? dateObj.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }) : '';

  const timeOptions = { hour: '2-digit', minute: '2-digit' };
  const startTimeStr = start ? start.toLocaleTimeString(undefined, timeOptions) : '';
  const endTimeStr = end ? end.toLocaleTimeString(undefined, timeOptions) : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '125px' }}>
      <span style={{ fontWeight: 600, color: '#1e293b' }}>
        {dateStr}
      </span>
      {(startTimeStr || endTimeStr) && (
        <span style={{ fontSize: '0.78rem', color: '#475569' }}>
          {startTimeStr}{endTimeStr ? ` – ${endTimeStr}` : ''}
        </span>
      )}
      {created && (
        <span style={{ fontSize: '0.72rem', color: '#94a3b8' }} title={`Compiled at: ${created.toLocaleString()}`}>
          Compiled: {created.toLocaleTimeString(undefined, timeOptions)}
        </span>
      )}
    </div>
  );
};

export const formatDate = (val) => {
  if (!val) return 'N/A';
  if (typeof val.toDate === 'function') {
    try {
      return val.toDate().toLocaleString();
    } catch {
      return 'N/A';
    }
  }
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? 'N/A' : val.toLocaleString();
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? 'N/A' : d.toLocaleString();
};

const VideoTable = ({ videos, selectedVideos, onSelectVideo, onPlayVideo, onDownloadVideo, onSelectAll, downloadingVideos, studentProfiles = {}, onErrorClick }) => {
  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th><input type="checkbox" onChange={onSelectAll} /></th>
            <th>Play / Status</th>
            <th>Student</th>
            <th>Session Time</th>
            <th>Duration</th>
            <th>Size</th>
            <th>Google Drive</th>
            <th>Download</th>
          </tr>
        </thead>
        <tbody>
          {videos.map(video => {
            const isDownloading = downloadingVideos?.has(video.id);
            const status = video.status || 'completed';
            const isFailed = status === 'failed';
            const isProcessing = status === 'processing' || status === 'pending';

            return (
              <tr key={video.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedVideos.has(video.id)}
                    onChange={() => onSelectVideo(video)}
                  />
                </td>
                <td>
                  {isFailed ? (
                    <button
                      type="button"
                      onClick={() => onErrorClick && onErrorClick(video)}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '6px',
                        backgroundColor: '#fef2f2',
                        color: '#dc2626',
                        border: '1px solid #fecaca',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '0.75rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                      title="Click to view failure details & logs"
                    >
                      ⚠️ Failed
                    </button>
                  ) : isProcessing ? (
                    <span
                      style={{
                        padding: '4px 8px',
                        borderRadius: '6px',
                        backgroundColor: '#fef9c3',
                        color: '#854d0e',
                        border: '1px solid #fef08a',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                      title="Video screencast is currently compiling..."
                    >
                      ⏳ {status === 'processing' ? 'Compiling' : 'Pending'}
                    </span>
                  ) : (
                    <button 
                      onClick={() => onPlayVideo(video)} 
                      style={{background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', padding: 0, lineHeight: 1}}
                      title="Play video"
                    >
                      ▶️
                    </button>
                  )}
                </td>
                <td>
                  <StudentBadge
                    student={{
                      email: video.studentEmail || video.studentUid || '',
                      ...(studentProfiles[(video.studentEmail || video.studentUid || '').toLowerCase()] || {})
                    }}
                    showEmail={true}
                    size="sm"
                  />
                </td>
                <td>{formatSessionTime(video.startTime, video.endTime, video.createdAt)}</td>
                <td>{isFailed ? <span style={{ color: '#ef4444' }}>Failed</span> : isProcessing ? <span style={{ color: '#eab308' }}>In Progress</span> : formatDuration(video.duration)}</td>
                <td>{isFailed || isProcessing ? '—' : formatSize(video.size)}</td>
                <td>
                  {video.driveWebViewLink ? (
                    <a
                      href={video.driveWebViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '0.8rem',
                        color: '#2563eb',
                        textDecoration: 'none',
                        fontWeight: 600,
                        backgroundColor: '#eff6ff',
                        padding: '3px 8px',
                        borderRadius: '6px',
                        border: '1px solid #bfdbfe',
                      }}
                      title={`Stored in: ${video.driveFolderPath || 'Google Drive'}`}
                    >
                      📁 Drive ↗
                    </a>
                  ) : isFailed || isProcessing ? (
                    <span style={{ fontSize: '0.78rem', color: '#cbd5e1' }}>—</span>
                  ) : (
                    <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Not backed up</span>
                  )}
                </td>
                <td>
                  {video.videoPath ? (
                    <button 
                      onClick={() => onDownloadVideo(video)}
                      disabled={isDownloading}
                      title={isDownloading ? 'Downloading video...' : 'Download video'}
                      style={{
                        cursor: isDownloading ? 'wait' : 'pointer',
                        opacity: isDownloading ? 0.7 : 1,
                      }}
                    >
                      {isDownloading ? 'Downloading...' : 'Download'}
                    </button>
                  ) : (
                    <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{isFailed ? 'Compilation Failed' : isProcessing ? 'Pending' : 'Path Not Found'}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default VideoTable;
