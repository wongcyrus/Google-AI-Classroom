
import React from 'react';
import { formatAiCost } from '../utils/formatters';
import { exportToCsv, exportToJson } from '../utils/exportUtils';

const AiJobsTable = ({ aiJobs, onPlayVideo, onInspectResult }) => {
  const handleExportSingleJob = (job, format) => {
    const studentTag = job.studentEmail ? job.studentEmail.replace(/[^a-zA-Z0-9]/g, '_') : 'Student';
    const rawResult = job.result;
    const isObj = typeof rawResult === 'object' && rawResult !== null;
    const resultStr = isObj ? JSON.stringify(rawResult, null, 2) : String(rawResult || '');

    if (format === 'csv') {
      const headers = ['Property', 'Value'];
      const rows = [
        ['AI Job ID', job.id || ''],
        ['Student Email', job.studentEmail || ''],
        ['Student UID', job.studentUid || ''],
        ['Model', job.modelUsed || 'gemini-3.5-flash-lite'],
        ['Status', job.status || ''],
        ['Cost (USD)', job.cost != null ? Number(job.cost).toFixed(4) : '0.0000'],
        ['Created At', job.timestamp?.toDate ? job.timestamp.toDate().toISOString() : String(job.timestamp || 'N/A')],
        ['Video Path', (job.mediaPaths && job.mediaPaths[0]) || job.videoPath || job.path || ''],
        ['Findings', resultStr],
        ['Error Details', job.errorDetails || '']
      ];
      exportToCsv(headers, rows, `Job_${job.id || 'Result'}_${studentTag}.csv`);
    } else if (format === 'json') {
      const payload = {
        id: job.id,
        studentEmail: job.studentEmail,
        studentUid: job.studentUid,
        modelUsed: job.modelUsed,
        cost: job.cost,
        status: job.status,
        timestamp: job.timestamp?.toDate ? job.timestamp.toDate().toISOString() : job.timestamp,
        result: rawResult,
        errorDetails: job.errorDetails,
        videoPath: (job.mediaPaths && job.mediaPaths[0]) || job.videoPath || job.path || null
      };
      exportToJson(payload, `Job_${job.id || 'Result'}_${studentTag}.json`);
    }
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

  const renderResult = (job) => {
    if (job.status === 'failed') {
      const errorText = job.errorDetails || 'Failed';
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#dc2626', fontSize: '0.82rem', fontFamily: 'monospace' }}>
            {errorText.length > 70 ? `${errorText.substring(0, 70)}...` : errorText}
          </span>
          {onInspectResult && (
            <button
              onClick={() => onInspectResult(job)}
              style={{ padding: '2px 6px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #fecaca', background: '#fee2e2', color: '#991b1b', cursor: 'pointer' }}
            >
              Details
            </button>
          )}
        </div>
      );
    }

    const raw = job.result;
    const isObj = typeof raw === 'object' && raw !== null;
    const str = isObj ? JSON.stringify(raw) : String(raw || '');

    if (str.length <= 90 && !str.includes('\n')) {
      return <span style={{ fontSize: '0.85rem', color: '#334155' }}>{str}</span>;
    }

    const preview = str.substring(0, 75) + '...';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '0.82rem', color: '#475569', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {preview}
        </span>
        {onInspectResult && (
          <button
            onClick={() => onInspectResult(job)}
            style={{ padding: '2px 8px', fontSize: '0.75rem', fontWeight: 600, borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#334155', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            🔍 View
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="table-container">
        <table>
            <thead>
                <tr>
                    <th style={{ width: '50px' }}>Play</th>
                    <th>Student</th>
                    <th>Model</th>
                    <th>Cost</th>
                    <th>Status</th>
                    <th>Result</th>
                    <th>Created At</th>
                    <th style={{ width: '160px' }}>Actions</th>
                </tr>
            </thead>
            <tbody>
                {aiJobs.map(job => (
                    <tr key={job.id}>
                        <td>
                            <button 
                                onClick={() => onPlayVideo({ videoPath: (job.mediaPaths && job.mediaPaths[0]) || job.videoPath || job.path })} 
                                title="Play Video"
                                style={{background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', padding: 0, lineHeight: 1}}
                            >
                                ▶️
                            </button>
                        </td>
                        <td style={{ fontWeight: 500 }}>{job.studentEmail}</td>
                        <td><span style={{ fontSize: '0.82em', padding: '2px 6px', background: '#e0f2fe', borderRadius: '4px', color: '#0369a1', fontWeight: 600 }}>{job.modelUsed || 'gemini-3.5-flash-lite'}</span></td>
                        <td><span style={{ fontWeight: 600, color: '#475569' }}>{formatAiCost(job.cost)}</span></td>
                        <td>{getStatusBadge(job.status)}</td>
                        <td>{renderResult(job)}</td>
                        <td style={{ fontSize: '0.85rem', color: '#64748b', whiteSpace: 'nowrap' }}>{job.timestamp?.toDate ? job.timestamp.toDate().toLocaleString() : (job.timestamp || 'N/A')}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                            {onInspectResult && (
                                <button
                                    onClick={() => onInspectResult(job)}
                                    title="Inspect complete analysis findings"
                                    style={{
                                        padding: '3px 8px',
                                        fontSize: '0.78rem',
                                        fontWeight: 600,
                                        borderRadius: '4px',
                                        border: '1px solid #cbd5e1',
                                        background: '#ffffff',
                                        color: '#0f172a',
                                        cursor: 'pointer',
                                        marginRight: '6px'
                                    }}
                                >
                                    View
                                </button>
                            )}
                            <button
                                onClick={() => handleExportSingleJob(job, 'csv')}
                                title="Export student findings to CSV"
                                style={{
                                    padding: '3px 8px',
                                    fontSize: '0.78rem',
                                    fontWeight: 600,
                                    borderRadius: '4px',
                                    border: '1px solid #cbd5e1',
                                    background: '#ffffff',
                                    color: '#0f172a',
                                    cursor: 'pointer',
                                    marginRight: '6px'
                                }}
                            >
                                CSV
                            </button>
                            <button
                                onClick={() => handleExportSingleJob(job, 'json')}
                                title="Export student findings to JSON"
                                style={{
                                    padding: '3px 8px',
                                    fontSize: '0.78rem',
                                    fontWeight: 600,
                                    borderRadius: '4px',
                                    border: '1px solid #cbd5e1',
                                    background: '#ffffff',
                                    color: '#0f172a',
                                    cursor: 'pointer'
                                }}
                            >
                                JSON
                            </button>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
  );
};

export default AiJobsTable;
