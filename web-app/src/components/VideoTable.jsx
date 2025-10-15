
import React from 'react';

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

const VideoTable = ({ videos, selectedVideos, onSelectVideo, onPlayVideo, onDownloadVideo, onSelectAll }) => {
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
            <th>Download</th>
          </tr>
        </thead>
        <tbody>
          {videos.map(video => (
            <tr key={video.id}>
              <td>
                <input
                  type="checkbox"
                  checked={selectedVideos.has(video.id)}
                  onChange={() => onSelectVideo(video)}
                />
              </td>
              <td>
                <button onClick={() => onPlayVideo(video)} style={{background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', padding: 0, lineHeight: 1}}>
                  ▶️
                </button>
              </td>
              <td>{video.studentEmail}</td>
              <td>{video.startTime?.toDate().toLocaleString() || 'N/A'}</td>
              <td>{video.endTime?.toDate().toLocaleString() || 'N/A'}</td>
              <td>{formatDuration(video.duration)}</td>
              <td>{formatSize(video.size)}</td>
              <td>{video.createdAt?.toDate().toLocaleString() || 'N/A'}</td>
              <td>
                {video.videoPath ? (
                  <button onClick={() => onDownloadVideo(video)}>
                    Download
                  </button>
                ) : (
                  <span>Path Not Found</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default VideoTable;
