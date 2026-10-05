import React, { useState, useMemo } from 'react';
import Modal from './Modal';

const PromptViewModal = ({
  show,
  onClose,
  job,
  title,
  promptName,
  category,
  accessLevel,
  promptText: directPromptText,
  prompt: directPrompt,
  placeholders,
}) => {
  const [copied, setCopied] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [fontSize, setFontSize] = useState(13);

  const promptText = directPromptText !== undefined
    ? directPromptText
    : (directPrompt !== undefined
      ? directPrompt
      : (job ? (job.prompt || 'No prompt specified.') : 'No prompt specified.'));

  const detectedPlaceholders = useMemo(() => {
    if (placeholders && Array.isArray(placeholders)) return placeholders;
    if (!promptText || typeof promptText !== 'string') return [];
    const matches = promptText.match(/\{\{[^}]+\}\}/g);
    return matches ? Array.from(new Set(matches)) : [];
  }, [placeholders, promptText]);

  const wordCount = useMemo(() => {
    if (!promptText || typeof promptText !== 'string') return 0;
    return promptText.trim().split(/\s+/).filter(Boolean).length;
  }, [promptText]);

  // If neither job nor direct prompt is provided, return null
  if (!job && directPromptText === undefined && directPrompt === undefined) {
    return null;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Failed to copy prompt to clipboard', err);
    }
  };

  const charCount = promptText ? promptText.length : 0;
  const estimatedTokens = Math.round(charCount / 4);

  const modalTitle = title || (promptName ? `🔍 Prompt Review: ${promptName}` : (job ? 'Video Analysis Prompt' : '🔍 Prompt Template Review'));

  return (
    <Modal show={show} onClose={onClose} title={modalTitle}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '12px' }}>
        {/* Metadata Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--color-surface-subtle, #f8fafc)',
          padding: '10px 14px',
          borderRadius: '8px',
          border: '1px solid var(--color-border, #e2e8f0)',
          fontSize: '0.84rem',
          flexWrap: 'wrap',
          gap: '8px'
        }}>
          {job ? (
            <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span><strong>Job ID:</strong> <span style={{ fontFamily: 'monospace', color: '#2563eb' }}>{job.id}</span></span>
              <span><strong>Model:</strong> {job.modelUsed || job.model || 'gemini-3.5-flash-lite'}</span>
              {job.createdAt && (
                <span><strong>Created:</strong> {job.createdAt?.toDate ? job.createdAt.toDate().toLocaleString() : 'N/A'}</span>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              {promptName && <span style={{ fontWeight: 700, color: '#1e293b' }}>{promptName}</span>}
              {category && (
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '12px',
                  backgroundColor: '#e0e7ff',
                  color: '#4338ca',
                  fontWeight: 600,
                  fontSize: '0.74rem',
                  textTransform: 'capitalize'
                }}>
                  🏷️ {category}
                </span>
              )}
              {accessLevel && (
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '12px',
                  backgroundColor: '#f1f5f9',
                  color: '#475569',
                  fontWeight: 500,
                  fontSize: '0.74rem',
                  textTransform: 'capitalize'
                }}>
                  🔒 {accessLevel}
                </span>
              )}
              <span style={{ color: '#64748b' }}>📝 {wordCount} words</span>
              <span style={{ color: '#64748b' }}>🔤 {charCount} chars</span>
              <span style={{ color: '#059669', fontWeight: 600 }}>⚡ ~{estimatedTokens} tokens</span>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: '#ffffff', borderRadius: '4px', border: '1px solid #cbd5e1', padding: '1px 4px' }}>
              <button
                type="button"
                onClick={() => setFontSize(prev => Math.max(11, prev - 1))}
                title="Decrease font size"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', padding: '2px 4px', color: '#475569' }}
              >
                A-
              </button>
              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>{fontSize}px</span>
              <button
                type="button"
                onClick={() => setFontSize(prev => Math.min(18, prev + 1))}
                title="Increase font size"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', padding: '2px 4px', color: '#475569' }}
              >
                A+
              </button>
            </div>
            <button
              onClick={handleCopy}
              type="button"
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
        </div>

        {/* Dynamic Placeholders Banner */}
        {detectedPlaceholders.length > 0 && (
          <div style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '6px',
            padding: '8px 12px',
            fontSize: '0.78rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap'
          }}>
            <span style={{ fontWeight: 600, color: '#166534' }}>🧩 Dynamic Variables ({detectedPlaceholders.length}):</span>
            {detectedPlaceholders.map(tag => (
              <code key={tag} style={{
                background: '#dcfce7',
                color: '#15803d',
                padding: '2px 6px',
                borderRadius: '4px',
                fontWeight: 600,
                fontSize: '0.76rem',
                fontFamily: 'monospace'
              }}>
                {tag}
              </code>
            ))}
            <span style={{ color: '#15803d', fontSize: '0.72rem' }}>
              (These variables are automatically resolved with student &amp; class context at runtime)
            </span>
          </div>
        )}

        {/* Search Bar for Long Prompts */}
        {promptText.length > 300 && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="🔍 Search text within prompt..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                flex: 1,
                padding: '6px 10px',
                fontSize: '0.82rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                boxSizing: 'border-box'
              }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  cursor: 'pointer',
                  fontSize: '0.82rem',
                  padding: '4px'
                }}
              >
                Clear
              </button>
            )}
          </div>
        )}

        {/* Prompt Content */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <pre style={{
            flex: 1,
            margin: 0,
            padding: '16px',
            borderRadius: '8px',
            backgroundColor: '#0f172a',
            color: '#f8fafc',
            fontSize: `${fontSize}px`,
            fontFamily: 'monospace',
            overflow: 'auto',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)'
          }}>
            {promptText}
          </pre>
        </div>

        {/* Guidance Footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.75rem',
          color: '#64748b',
          paddingTop: '4px'
        }}>
          <span>🔒 Read-only view for review &amp; verification.</span>
          <span>✏️ To customize or test this prompt template, open <strong>Prompt Management</strong> in the navigation.</span>
        </div>
      </div>
    </Modal>
  );
};

export default PromptViewModal;
