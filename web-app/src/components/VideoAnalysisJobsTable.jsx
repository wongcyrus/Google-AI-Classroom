import React from 'react';

const VideoAnalysisJobsTable = ({ jobs, selectedJob, onSelectJob, onDeleteJob, onViewPrompt }) => {
  const getStatusBadge = (status) => {
    let bg = '#f1f5f9';
    let color = '#475569';
    if (status === 'completed') {
      bg = '#dcfce7';
      color = '#166534';
    } else if (status === 'failed') {
      bg = '#fee2e2';
      color = '#991b1b';
    } else if (status === 'partial_failure') {
      bg = '#fef3c7';
      color = '#92400e';
    } else if (status === 'processing' || status === 'running') {
      bg = '#e0f2fe';
      color = '#0369a1';
    }
    return (
      <span style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '9999px',
        fontSize: '0.78rem',
        fontWeight: 600,
        backgroundColor: bg,
        color: color,
        textTransform: 'capitalize'
      }}>
        {status}
      </span>
    );
  };

  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Job ID</th>
            <th>Model</th>
            <th>Created At</th>
            <th>Videos</th>
            <th>Status</th>
            <th style={{ width: '380px' }}>Prompt</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map(job => {
            const videoCount = job.videos?.length || job.aiJobIds?.length || 0;
            const promptText = job.prompt || '';

            return (
              <tr 
                key={job.id}
                onClick={() => onSelectJob(job)} 
                style={{ 
                  cursor: 'pointer', 
                  backgroundColor: selectedJob?.id === job.id ? '#f1f5f9' : 'transparent',
                  transition: 'background-color 0.15s ease'
                }}
              >
                <td style={{ fontFamily: 'monospace', fontWeight: 600, color: '#3b82f6', whiteSpace: 'nowrap' }}>
                  {job.id}
                </td>
                <td>
                  <span style={{ fontSize: '0.82em', padding: '2px 6px', background: '#e0f2fe', borderRadius: '4px', color: '#0369a1', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {job.modelUsed || job.model || 'gemini-3.5-flash-lite'}
                  </span>
                </td>
                <td style={{ fontSize: '0.85rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                  {job.createdAt?.toDate ? job.createdAt.toDate().toLocaleString() : 'N/A'}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155' }}>
                    {videoCount > 0 ? `${videoCount} videos` : '—'}
                  </span>
                </td>
                <td>{getStatusBadge(job.status)}</td>
                <td 
                  onClick={(e) => {
                    if (onViewPrompt) {
                      e.stopPropagation();
                      onViewPrompt(job);
                    }
                  }}
                  style={{
                    maxWidth: '380px',
                    cursor: onViewPrompt ? 'pointer' : 'default',
                    padding: '8px 10px',
                    verticalAlign: 'top',
                  }}
                  title="Click to view full prompt in modal"
                >
                  <div style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    fontSize: '0.84rem',
                    color: '#334155',
                    lineHeight: 1.4,
                  }}>
                    {promptText || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Default rubric</span>}
                  </div>
                  {promptText && (
                    <div style={{ marginTop: '4px' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onViewPrompt) onViewPrompt(job);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          fontSize: '0.74rem',
                          color: '#4f46e5',
                          fontWeight: 600,
                          cursor: 'pointer',
                          textDecoration: 'underline'
                        }}
                      >
                        🔍 Modal
                      </button>
                    </div>
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

export default VideoAnalysisJobsTable;
