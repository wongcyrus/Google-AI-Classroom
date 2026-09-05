import React, { useState } from 'react';
import Modal from './Modal';
import { formatAiCost } from '../utils/formatters';
import { exportToJson, exportToText, exportToCsv } from '../utils/exportUtils';

const JobResultModal = ({ show, onClose, job }) => {
  const [copied, setCopied] = useState(false);

  if (!job) return null;

  const rawResult = job.result;
  const isObject = typeof rawResult === 'object' && rawResult !== null;
  const jsonString = isObject ? JSON.stringify(rawResult, null, 2) : String(rawResult || '');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Failed to copy to clipboard', err);
    }
  };

  const handleDownloadJson = () => {
    const studentTag = job.studentEmail ? job.studentEmail.replace(/[^a-zA-Z0-9]/g, '_') : 'Student';
    const filename = `Job_${job.id || 'Result'}_${studentTag}.json`;
    exportToJson(isObject ? rawResult : { result: rawResult }, filename);
  };

  const handleDownloadText = () => {
    const studentTag = job.studentEmail ? job.studentEmail.replace(/[^a-zA-Z0-9]/g, '_') : 'Student';
    const filename = `Job_${job.id || 'Result'}_${studentTag}_Report.txt`;
    exportToText(jsonString, filename);
  };

  const handleDownloadCsv = () => {
    const studentTag = job.studentEmail ? job.studentEmail.replace(/[^a-zA-Z0-9]/g, '_') : 'Student';
    const filename = `Job_${job.id || 'Result'}_${studentTag}.csv`;
    const headers = ['Property', 'Value'];
    const rows = [
      ['AI Job ID', job.id || ''],
      ['Student Email', job.studentEmail || ''],
      ['Student UID', job.studentUid || ''],
      ['Model Used', job.modelUsed || job.model || 'gemini-3.5-flash-lite'],
      ['Status', job.status || ''],
      ['Cost (USD)', job.cost != null ? Number(job.cost).toFixed(4) : '0.0000'],
      ['Created At', job.timestamp?.toDate ? job.timestamp.toDate().toISOString() : String(job.timestamp || 'N/A')],
      ['Video Path', (job.mediaPaths && job.mediaPaths[0]) || job.videoPath || job.path || ''],
      ['Findings', jsonString],
      ['Error Details', job.errorDetails || '']
    ];
    exportToCsv(headers, rows, filename);
  };

  const handleDownloadMarkdown = () => {
    const studentTag = job.studentEmail ? job.studentEmail.replace(/[^a-zA-Z0-9]/g, '_') : 'Student';
    const filename = `Job_${job.id || 'Result'}_${studentTag}_Analysis.md`;
    exportToText(typeof rawResult === 'string' ? rawResult : jsonString, filename);
  };

  return (
    <Modal
      show={show}
      onClose={onClose}
      title={`Analysis Result: ${job.studentEmail || 'Student'}`}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '14px' }}>
        {/* Metadata Header */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          background: 'var(--color-surface-subtle, #f8fafc)',
          padding: '10px 14px',
          borderRadius: '8px',
          border: '1px solid var(--color-border, #e2e8f0)',
          fontSize: '0.88rem'
        }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <span><strong>Student:</strong> {job.studentEmail}</span>
            <span><strong>Model:</strong> {job.modelUsed || 'gemini-3.5-flash-lite'}</span>
            <span><strong>Cost:</strong> {formatAiCost(job.cost)}</span>
          </div>
          <div>
            <span style={{
              padding: '3px 8px',
              borderRadius: '9999px',
              fontSize: '0.78rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              backgroundColor: job.status === 'completed' ? '#dcfce7' : job.status === 'failed' ? '#fee2e2' : '#e0f2fe',
              color: job.status === 'completed' ? '#166534' : job.status === 'failed' ? '#991b1b' : '#0369a1',
            }}>
              {job.status}
            </span>
          </div>
        </div>

        {/* Content Body */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {job.status === 'failed' ? (
            <div style={{
              padding: '12px',
              borderRadius: '8px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              fontSize: '0.9rem',
              overflowY: 'auto'
            }}>
              <strong style={{ display: 'block', marginBottom: '6px' }}>Error Details:</strong>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                {job.errorDetails || 'Unknown error occurred during video analysis.'}
              </pre>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-main, #334155)' }}>
                  Analysis Output (JSON):
                </span>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={handleDownloadCsv}
                    title="Download structured findings CSV"
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.8rem',
                      borderRadius: '6px',
                      border: '1px solid var(--color-border, #cbd5e1)',
                      background: '#ffffff',
                      color: '#0f172a',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    📥 CSV
                  </button>
                  <button
                    onClick={handleDownloadJson}
                    title="Download raw JSON file"
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.8rem',
                      borderRadius: '6px',
                      border: '1px solid var(--color-border, #cbd5e1)',
                      background: '#ffffff',
                      color: '#0f172a',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    📥 JSON
                  </button>
                  <button
                    onClick={handleDownloadMarkdown}
                    title="Download findings as Markdown"
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.8rem',
                      borderRadius: '6px',
                      border: '1px solid var(--color-border, #cbd5e1)',
                      background: '#ffffff',
                      color: '#0f172a',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    📝 Markdown
                  </button>
                  <button
                    onClick={handleDownloadText}
                    title="Download plain text report"
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.8rem',
                      borderRadius: '6px',
                      border: '1px solid var(--color-border, #cbd5e1)',
                      background: '#ffffff',
                      color: '#0f172a',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    📄 Text Report
                  </button>
                  <button
                    onClick={handleCopy}
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.8rem',
                      borderRadius: '6px',
                      border: '1px solid var(--color-border, #cbd5e1)',
                      background: '#ffffff',
                      color: '#0f172a',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    {copied ? '✓ Copied!' : '📋 Copy'}
                  </button>
                </div>
              </div>
              <pre style={{
                flex: 1,
                margin: 0,
                padding: '12px',
                borderRadius: '8px',
                backgroundColor: '#0f172a',
                color: '#f8fafc',
                fontSize: '0.82rem',
                fontFamily: 'monospace',
                overflow: 'auto',
                lineHeight: 1.5,
              }}>
                {jsonString}
              </pre>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default JobResultModal;
