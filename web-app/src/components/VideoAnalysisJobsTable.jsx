
import React from 'react';

const VideoAnalysisJobsTable = ({ jobs, selectedJob, onSelectJob, onDeleteJob }) => {
  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Job ID</th>
            <th>Model</th>
            <th>Created At</th>
            <th>Status</th>
            <th>Prompt</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map(job => (
            <tr key={job.id} onClick={() => onSelectJob(job)} style={{ cursor: 'pointer', backgroundColor: selectedJob?.id === job.id ? '#eef' : 'transparent' }}>
              <td>{job.id}</td>
              <td><span style={{ fontSize: '0.85em', padding: '2px 6px', background: '#e0f2fe', borderRadius: '4px', color: '#0369a1', fontWeight: 600 }}>{job.modelUsed || job.model || 'gemini-3.5-flash-lite'}</span></td>
              <td>{job.createdAt?.toDate().toLocaleString() || 'N/A'}</td>
              <td>{job.status}</td>
              <td style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{job.prompt}</td>
              <td>
                <button onClick={(e) => {
                  e.stopPropagation();
                  onDeleteJob(job.id, job.aiJobIds);
                }}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default VideoAnalysisJobsTable;
