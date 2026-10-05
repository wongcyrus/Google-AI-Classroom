import { useState, useMemo } from 'react';
import { useTranslationPrompts } from '../hooks/useTranslationPrompts';
import { getDropdownPlaceholderForSelector, getPlaceholderTextForSelector } from '../constants/promptRegistry';
import PromptViewModal from './PromptViewModal';

const TranslationPromptSelector = ({
  user,
  selectedPrompt,
  onSelectPrompt,
  promptText,
  onTextChange,
  applyToFilter = 'Lecture Subtitle Translation',
  readOnly = true,
}) => {
  const prompts = useTranslationPrompts(user, applyToFilter);
  const [promptFilter, setPromptFilter] = useState('all');
  const [copied, setCopied] = useState(false);
  const [showFullReviewModal, setShowFullReviewModal] = useState(false);
  const [isExpandedHeight, setIsExpandedHeight] = useState(false);

  const filteredPrompts = useMemo(() => {
    if (!user) {
      return [];
    }
    const { uid } = user;
    let newFilteredPrompts = [];
    if (promptFilter === 'all') {
      newFilteredPrompts = prompts;
    } else if (promptFilter === 'public') {
      newFilteredPrompts = prompts.filter((p) => p.accessLevel === 'public');
    } else if (promptFilter === 'private') {
      newFilteredPrompts = prompts.filter((p) => p.owner === uid && p.accessLevel === 'private');
    } else if (promptFilter === 'shared') {
      newFilteredPrompts = prompts.filter((p) => p.accessLevel === 'shared');
    }
    return newFilteredPrompts;
  }, [prompts, promptFilter, user]);

  const selectedPromptId = useMemo(() => {
    if (!selectedPrompt) return '';
    if (selectedPrompt.id && prompts.some((p) => p.id === selectedPrompt.id)) return selectedPrompt.id;
    if (selectedPrompt.originalId && prompts.some((p) => p.id === selectedPrompt.originalId)) return selectedPrompt.originalId;
    const match = prompts.find((p) => p.name === selectedPrompt.name);
    if (match) return match.id;
    return selectedPrompt.id || selectedPrompt.originalId || '';
  }, [selectedPrompt, prompts]);

  const detectedPlaceholders = useMemo(() => {
    if (!promptText || typeof promptText !== 'string') return [];
    const matches = promptText.match(/\{\{[^}]+\}\}/g);
    return matches ? Array.from(new Set(matches)) : [];
  }, [promptText]);

  const handleCopy = () => {
    if (!promptText) return;
    try {
      navigator.clipboard?.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Failed to copy prompt text:', err);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: '10px' }}>
        <label>
          <input
            type="radio"
            value="all"
            name="transPromptFilter"
            checked={promptFilter === 'all'}
            onChange={(e) => setPromptFilter(e.target.value)}
          />{' '}
          All
        </label>
        <label>
          <input
            type="radio"
            value="public"
            name="transPromptFilter"
            checked={promptFilter === 'public'}
            onChange={(e) => setPromptFilter(e.target.value)}
          />{' '}
          Public
        </label>
        <label>
          <input
            type="radio"
            value="private"
            name="transPromptFilter"
            checked={promptFilter === 'private'}
            onChange={(e) => setPromptFilter(e.target.value)}
          />{' '}
          Private
        </label>
        <label>
          <input
            type="radio"
            value="shared"
            name="transPromptFilter"
            checked={promptFilter === 'shared'}
            onChange={(e) => setPromptFilter(e.target.value)}
          />{' '}
          Shared
        </label>
      </div>
      <select
        value={selectedPromptId}
        onChange={(e) => {
          const prompt = prompts.find((p) => p.id === e.target.value);
          onSelectPrompt(prompt);
        }}
        style={{ width: '100%', marginBottom: '6px', boxSizing: 'border-box' }}
      >
        <option value="">{getDropdownPlaceholderForSelector('translations', applyToFilter)}</option>
        {filteredPrompts.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {/* Dynamic Placeholder Variable Badges */}
      {detectedPlaceholders.length > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px',
          alignItems: 'center',
          marginBottom: '6px',
          padding: '4px 8px',
          background: '#f0fdf4',
          borderRadius: '5px',
          border: '1px solid #bbf7d0',
          fontSize: '0.72rem'
        }}>
          <span style={{ color: '#166534', fontWeight: 600 }}>Variables:</span>
          {detectedPlaceholders.map(tag => (
            <code key={tag} style={{
              background: '#dcfce7',
              color: '#15803d',
              padding: '1px 5px',
              borderRadius: '3px',
              fontFamily: 'monospace'
            }}>
              {tag}
            </code>
          ))}
        </div>
      )}

      {/* Notice & Review Toolbar */}
      {readOnly ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 6px 0', fontSize: '0.74rem', color: '#64748b', flexWrap: 'wrap', gap: '6px' }}>
          <div>
            <span>🔒 <strong>Template Preview (Read-Only)</strong></span>
            <span style={{ marginLeft: '8px' }}>Customized prompts must be created in Prompt Management</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              onClick={() => setIsExpandedHeight(prev => !prev)}
              style={{
                padding: '2px 7px',
                fontSize: '0.72rem',
                backgroundColor: '#f1f5f9',
                border: '1px solid #cbd5e1',
                borderRadius: '4px',
                cursor: 'pointer',
                color: '#475569'
              }}
            >
              {isExpandedHeight ? '↕️ Compact Box' : '↕️ Taller Box'}
            </button>
            <button
              type="button"
              onClick={() => setShowFullReviewModal(true)}
              disabled={!promptText}
              style={{
                padding: '2px 8px',
                fontSize: '0.72rem',
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '4px',
                cursor: promptText ? 'pointer' : 'not-allowed',
                color: '#1d4ed8',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              ⛶ Expand / Full Review
            </button>
          </div>
        </div>
      ) : (
        <div style={{ margin: '4px 0 6px 0', fontSize: '0.74rem', color: '#0369a1' }}>
          💡 <em>You can customize the prompt instructions below for this specific job.</em>
        </div>
      )}

      <textarea
        value={promptText}
        onChange={(e) => onTextChange && onTextChange(e.target.value)}
        readOnly={readOnly}
        placeholder={getPlaceholderTextForSelector('translations', applyToFilter)}
        rows={isExpandedHeight ? 16 : 9}
        style={{
          width: '100%',
          flexGrow: 1,
          minHeight: isExpandedHeight ? '300px' : '150px',
          boxSizing: 'border-box',
          marginTop: '2px',
          fontFamily: 'monospace',
          fontSize: '0.84rem',
          lineHeight: 1.5,
          resize: 'vertical',
          backgroundColor: readOnly ? '#f8fafc' : '#ffffff',
          color: readOnly ? '#334155' : 'inherit',
          cursor: readOnly ? 'default' : 'text',
          border: '1px solid #cbd5e1',
          borderRadius: '6px',
          padding: '8px 10px'
        }}
      />

      {readOnly && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!promptText}
            style={{
              padding: '3px 8px',
              fontSize: '0.75rem',
              backgroundColor: '#f1f5f9',
              border: '1px solid #cbd5e1',
              borderRadius: '4px',
              cursor: promptText ? 'pointer' : 'not-allowed',
              color: '#334155',
            }}
          >
            {copied ? '✓ Copied!' : '📋 Copy Prompt Text'}
          </button>
          <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
            ✏️ Manage custom prompts in <strong>Prompt Management</strong>
          </span>
        </div>
      )}

      {/* Fullscreen Prompt Inspection & Review Modal */}
      {showFullReviewModal && (
        <PromptViewModal
          show={showFullReviewModal}
          onClose={() => setShowFullReviewModal(false)}
          promptName={selectedPrompt?.name || 'Multilingual Subtitle Translation Prompt'}
          category="translations"
          accessLevel={selectedPrompt?.accessLevel || 'public'}
          promptText={promptText}
          placeholders={detectedPlaceholders}
        />
      )}
    </div>
  );
};

export default TranslationPromptSelector;
