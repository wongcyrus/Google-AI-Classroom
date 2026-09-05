import React, { useState } from 'react';
import Modal from './Modal';

const PromptViewModal = ({ show, onClose, job }) => {
  const [copied, setCopied] = useState(false);

  if (!job) return null;

  const promptText = job.prompt || 'No prompt specified.';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Failed to copy prompt to clipboard', err);
    }
  };

  return (
    <Modal
      show={show}
      onClose={onClose}
      title="Video Analysis Prompt"
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
          fontSize: '0.88rem',
          flexWrap: 'wrap',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
            <span><strong>Job ID:</strong> <span style={{ fontFamily: 'monospace', color: '#2563eb' }}>{job.id}</span></span>
            <span><strong>Model:</strong> {job.modelUsed || job.model || 'gemini-3.5-flash-lite'}</span>
            {job.createdAt && (
              <span><strong>Created:</strong> {job.createdAt?.toDate ? job.createdAt.toDate().toLocaleString() : 'N/A'}</span>
            )}
          </div>
          <button
            onClick={handleCopy}
            style={{
              padding: '5px 12px',
              fontSize: '0.82rem',
              borderRadius: '6px',
              border: '1px solid var(--color-border, #cbd5e1)',
              background: '#ffffff',
              color: '#0f172a',
              cursor: 'pointer',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            {copied ? '✓ Copied!' : '📋 Copy Prompt'}
          </button>
        </div>

        {/* Prompt Content */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <pre style={{
            flex: 1,
            margin: 0,
            padding: '14px',
            borderRadius: '8px',
            backgroundColor: '#0f172a',
            color: '#f8fafc',
            fontSize: '0.86rem',
            fontFamily: 'monospace',
            overflow: 'auto',
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}>
            {promptText}
          </pre>
        </div>
      </div>
    </Modal>
  );
};

export default PromptViewModal;
