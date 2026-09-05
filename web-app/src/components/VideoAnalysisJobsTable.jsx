import React, { useState } from 'react';

const VideoAnalysisJobsTable = ({ jobs, selectedJob, onSelectJob, onDeleteJob, onViewPrompt }) => {
  const [expandedJobIds, setExpandedJobIds] = useState(new Set());

  const toggleExpand = (jobId) => {
    setExpandedJobIds(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

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
            <th style={{ width: '320px' }}>Prompt</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map(job => {
            const videoCount = job.videos?.length || job.aiJobIds?.length || 0;
            const isExpanded = expandedJobIds.has(job.id);
            const promptText = job.prompt || '';

            return (
              <React.Fragment key={job.id}>
                <tr 
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
                      maxWidth: '320px',
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
                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(job.id);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          fontSize: '0.74rem',
                          color: '#2563eb',
                          fontWeight: 600,
                          cursor: 'pointer',
                          textDecoration: 'underline'
                        }}
                      >
                        {isExpanded ? '🔼 Collapse' : '👁️ Expand inline'}
                      </button>
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
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onViewPrompt) onViewPrompt(job);
                      }}
                      style={{
                        marginRight: '6px',
                        padding: '4px 8px',
                        fontSize: '0.8rem',
                        borderRadius: '4px',
                        border: '1px solid #cbd5e1',
                        background: '#f8fafc',
                        color: '#1e293b',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                      title="View full prompt in Level 1 modal"
                    >
                      📜 View Prompt
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectJob(job);
                      }}
                      style={{
                        marginRight: '6px',
                        padding: '4px 8px',
                        fontSize: '0.8rem',
                        borderRadius: '4px',
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        color: '#0f172a',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      View Details →
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteJob(job.id, job.aiJobIds);
                      }}
                      style={{
                        padding: '4px 8px',
                        fontSize: '0.8rem',
                        borderRadius: '4px',
                        border: '1px solid #fecaca',
                        background: '#fee2e2',
                        color: '#991b1b',
                        cursor: 'pointer'
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>

                {/* Inline Prompt Expansion in Level 1 */}
                {isExpanded && (
                  <tr style={{ backgroundColor: '#f8fafc' }}>
                    <td colSpan={7} style={{ padding: '12px 18px', borderBottom: '2px solid #cbd5e1' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#334155' }}>
                          📝 Prompt for Job <span style={{ fontFamily: 'monospace', color: '#2563eb' }}>{job.id}</span>
                        </span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onViewPrompt) onViewPrompt(job);
                            }}
                            style={{
                              padding: '3px 8px',
                              fontSize: '0.78rem',
                              borderRadius: '4px',
                              border: '1px solid #cbd5e1',
                              background: '#ffffff',
                              color: '#0f172a',
                              fontWeight: 600,
                              cursor: 'pointer'
                            }}
                          >
                            🔍 Open in Modal
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpand(job.id);
                            }}
                            style={{
                              padding: '3px 8px',
                              fontSize: '0.78rem',
                              borderRadius: '4px',
                              border: '1px solid #cbd5e1',
                              background: '#ffffff',
                              color: '#0f172a',
                              fontWeight: 600,
                              cursor: 'pointer'
                            }}
                          >
                            ✕ Close
                          </button>
                        </div>
                      </div>
                      <pre style={{
                        margin: 0,
                        padding: '12px',
                        backgroundColor: '#0f172a',
                        color: '#f8fafc',
                        borderRadius: '6px',
                        fontSize: '0.82rem',
                        fontFamily: 'monospace',
                        maxHeight: '260px',
                        overflowY: 'auto',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        lineHeight: 1.5,
                      }}>
                        {promptText || 'No custom prompt specified (using default rubric).'}
                      </pre>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default VideoAnalysisJobsTable;
