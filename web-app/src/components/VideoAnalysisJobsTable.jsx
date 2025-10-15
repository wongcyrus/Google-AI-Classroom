
import React from 'react';

const VideoAnalysisJobsTable = ({ jobs, selectedJob, onSelectJob, onDeleteJob }) => {
  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Requester</th>
            <th>Created At</th>
            <th>Status</th>
            <th>Prompt</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map(job => (
            <tr key={job.id} onClick={() => onSelectJob(job)} style={{ cursor: 'pointer', backgroundColor: selectedJob?.id === job.id ? '#eef' : 'transparent' }}>
              <td>{job.requester}</td>
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
