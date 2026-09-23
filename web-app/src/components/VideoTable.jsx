
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

const VideoTable = ({ videos, selectedVideos, onSelectVideo, onPlayVideo, onDownloadVideo, onSelectAll, downloadingVideos, studentProfiles = {} }) => {
  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th><input type="checkbox" onChange={onSelectAll} /></th>
            <th>Play</th>
            <th>Student</th>
            <th>Start Time</th>
            <th>End Time</th>
            <th>Duration</th>
            <th>Size</th>
            <th>Created At</th>
            <th>Google Drive</th>
            <th>Download</th>
          </tr>
        </thead>
        <tbody>
          {videos.map(video => {
            const isDownloading = downloadingVideos?.has(video.id);
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
                  <button 
                    onClick={() => onPlayVideo(video)} 
                    style={{background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', padding: 0, lineHeight: 1}}
                    title="Play video"
                  >
                    ▶️
                  </button>
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
                <td>{formatDate(video.startTime)}</td>
                <td>{formatDate(video.endTime)}</td>
                <td>{formatDuration(video.duration)}</td>
                <td>{formatSize(video.size)}</td>
                <td>{formatDate(video.createdAt)}</td>
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
                    <span>Path Not Found</span>
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
