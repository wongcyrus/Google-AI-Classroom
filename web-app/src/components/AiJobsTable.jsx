
import React from 'react';

const AiJobsTable = ({ aiJobs, onPlayVideo }) => {
  return (
    <div className="table-container">
        <table>
            <thead>
                <tr>
                    <th>Play</th>
                    <th>Student</th>
                    <th>Status</th>
                    <th>Result</th>
                    <th>Created At</th>
                </tr>
            </thead>
            <tbody>
                {aiJobs.map(job => (
                    <tr key={job.id}>
                        <td>
                            <button onClick={() => onPlayVideo({ videoPath: job.mediaPaths && job.mediaPaths[0] })} style={{background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', padding: 0, lineHeight: 1}}>
                                ▶️
                            </button>
                        </td>
                        <td>{job.studentEmail}</td>
                        <td>{job.status}</td>
                        <td>
                            {job.status === 'failed' ? (
                                <pre style={{ color: 'red', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{job.errorDetails}</pre>
                            ) : (
                                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{typeof job.result === 'object' ? JSON.stringify(job.result, null, 2) : job.result}</pre>
                            )}
                        </td>
                        <td>{job.timestamp?.toDate().toLocaleString() || 'N/A'}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
  );
};

export default AiJobsTable;
