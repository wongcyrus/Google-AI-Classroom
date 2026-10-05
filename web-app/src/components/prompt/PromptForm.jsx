import React, { useState } from 'react';
import MDEditor from '@uiw/react-md-editor';
import { auth } from '../../firebase-config';
import {
  getPromptTypesByCategory,
  getPlaceholdersForPrompt,
  getOutputSchemaForPrompt,
  getPromptTypeByApplyTo,
  getPlaceholderTextForSelector,
} from '../../constants/promptRegistry';

const PromptForm = ({
  selectedPrompt,
  name,
  setName,
  promptText,
  setPromptText,
  applyTo,
  handleApplyToChange,
  accessLevel,
  setAccessLevel,
  sharedWithUsers,
  emailInput,
  setEmailInput,
  handleAddEmail,
  handleRemoveUser,
  handleSave,
  handleDuplicate,
  handleDelete,
  activeTab,
  handleOptimize,
  handleUndo,
  isOptimizing,
  originalPromptText,
  isZenMode = false,
  setIsZenMode,
  isSidebarCollapsed = false,
  onToggleSidebar,
}) => {
  const currentUid = auth.currentUser?.uid;
  const isSystem = Boolean(
    selectedPrompt && (
      selectedPrompt.isSystem || 
      selectedPrompt.owner === 'system' || 
      (selectedPrompt.accessLevel === 'public' && (!selectedPrompt.owner || selectedPrompt.owner === 'system'))
    )
  );

  const isOwner = Boolean(
    selectedPrompt && (
      !selectedPrompt.owner || 
      (currentUid && selectedPrompt.owner === currentUid)
    ) && !isSystem
  );

  const isSharedEditor = Boolean(
    selectedPrompt && 
    currentUid && 
    selectedPrompt.accessLevel === 'shared' && 
    selectedPrompt.sharedWith?.includes(currentUid)
  );

  const canEdit = !selectedPrompt || isOwner || isSharedEditor;
  const isReadOnly = selectedPrompt && !canEdit;
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(true);
  const [showSchemaGuide, setShowSchemaGuide] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const categoryPromptTypes = getPromptTypesByCategory(activeTab);
  const effectiveApplyToList = applyTo.length > 0 ? applyTo : [categoryPromptTypes[0]?.applyTo].filter(Boolean);
  const availablePlaceholders = getPlaceholdersForPrompt(effectiveApplyToList);
  const activeSchema = getOutputSchemaForPrompt(effectiveApplyToList);
  const activePromptType = getPromptTypeByApplyTo(effectiveApplyToList[0]);
  const editorPlaceholder = getPlaceholderTextForSelector(activeTab, effectiveApplyToList[0]);

  const handleInsertPlaceholder = (tag) => {
    if (isReadOnly) return;
    setPromptText((prev) => {
      const current = prev || '';
      if (!current.trim()) return tag;
      return `${current}\n${tag}`;
    });
  };

  const handleCopySnippet = (snippet) => {
    if (!snippet) return;
    try {
      navigator.clipboard?.writeText(snippet);
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 2000);
    } catch (err) {
      console.warn('Failed to copy schema snippet:', err);
    }
  };

  return (
    <div className={`prompt-form-column ${isZenMode ? 'zen-active' : ''}`}>
        <div className="form-header-toolbar">
            <div className="form-title-row">
                <h3>{selectedPrompt ? 'Edit Prompt' : 'Create Prompt'}</h3>
                {isSidebarCollapsed && onToggleSidebar && (
                    <button type="button" onClick={onToggleSidebar} className="btn-uncollapse-sidebar" title="Show saved prompts sidebar">
                        ▶ Show Prompts
                    </button>
                )}
                {isSystem && (
                  <p className="public-prompt-notice system-notice">
                    🔒 This is a public prompt and cannot be edited. To personalize this prompt for your class, click "Make a Copy to Personalize".
                  </p>
                )}
                {isReadOnly && !isSystem && (
                  <p className="public-prompt-notice community-notice">
                    🌐 Community Prompt by {selectedPrompt.ownerEmail || 'another instructor'} (Read-Only). To personalize this prompt for your class, click "Make a Copy to Personalize".
                  </p>
                )}
                {canEdit && selectedPrompt && selectedPrompt.accessLevel === 'public' && (
                  <p className="public-prompt-notice author-notice">
                    🌐 Public Prompt (Owned by you — visible to all instructors).
                  </p>
                )}
            </div>
            <div className="form-name-action-bar">
                <input 
                    type="text" 
                    placeholder="Prompt Name" 
                    value={name} 
                    onChange={(e) => setName(e.target.value)} 
                    disabled={isReadOnly}
                    className="prompt-name-input"
                />
                <div className="form-actions">
                    {canEdit && <button type="button" onClick={handleSave}>{selectedPrompt ? 'Save Changes' : 'Save Prompt'}</button>}
                    {selectedPrompt && (
                        <button 
                            type="button" 
                            onClick={handleDuplicate} 
                            className={isReadOnly ? "copy-template-btn" : "secondary-btn"}
                            title={isReadOnly ? "Clone this template to your private library to customize" : "Duplicate prompt"}
                        >
                            {isReadOnly ? '📋 Make a Copy to Personalize' : 'Duplicate'}
                        </button>
                    )}
                    {selectedPrompt && isOwner && <button type="button" onClick={handleDelete} className="delete-btn">Delete</button>}
                    <button 
                        type="button" 
                        onClick={handleOptimize} 
                        disabled={isOptimizing || isReadOnly}
                        title={isReadOnly ? "Make a copy first to customize and optimize with AI" : "Optimize prompt with Gemini"}
                    >
                        {isOptimizing ? 'Optimizing...' : 'Optimize'}
                    </button>
                    <button type="button" onClick={handleUndo} disabled={!originalPromptText || isReadOnly} className="secondary-btn">Undo</button>
                    {setIsZenMode && (
                        <button type="button" onClick={() => setIsZenMode(prev => !prev)} className="zen-btn" title="Toggle Fullscreen Zen Mode">
                            {isZenMode ? '✕ Exit Zen' : '⛶ Zen Mode'}
                        </button>
                    )}
                </div>
            </div>
        </div>

        {/* Centralized Prompt Metadata, Model Specs, and Placeholder Chips Toolbar */}
        <div className="prompt-meta-toolbar">
          <div className="meta-left">
            {activePromptType?.recommendedModel && (
              <span className="model-chip" title="Recommended Gemini Model for this prompt type">
                🤖 {activePromptType.recommendedModel}
              </span>
            )}
            {activePromptType?.pairedRole && (
              <span className="paired-role-badge" title="Paired 2-Stage Pipeline Role">
                🔗 {activePromptType.pairedRole}
              </span>
            )}
            {availablePlaceholders.length > 0 && (
              <div className="placeholders-strip">
                <span className="placeholders-label">📌 Insert Placeholders:</span>
                <div className="placeholders-list">
                  {availablePlaceholders.map((ph) => {
                    const isPresent = Boolean(promptText && promptText.includes(ph.tag));
                    return (
                      <button
                        key={ph.tag}
                        type="button"
                        className={`placeholder-chip ${ph.required ? 'required' : ''} ${isPresent ? 'is-present' : (ph.required ? 'is-missing' : '')}`}
                        onClick={() => handleInsertPlaceholder(ph.tag)}
                        disabled={isReadOnly}
                        title={`${ph.label}${ph.required ? ' (Required)' : ''}: ${ph.desc} - ${isPresent ? 'Present in prompt' : 'Click to insert into prompt'}`}
                      >
                        <span className="chip-status-icon">{isPresent ? '✓' : (ph.required ? '!' : '+')}</span>
                        <code>{ph.tag}</code>
                        {ph.required && <span className="chip-req-star" title="Required placeholder">*</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          {activeSchema && (
            <div className="meta-right">
              <button
                type="button"
                className={`schema-guide-toggle-btn ${showSchemaGuide ? 'active' : ''}`}
                onClick={() => setShowSchemaGuide((prev) => !prev)}
                title="View required output format and schema"
              >
                📋 {showSchemaGuide ? 'Hide Schema' : 'View Expected Schema'}
              </button>
            </div>
          )}
        </div>

        {/* Missing Required Placeholders Warning Banner */}
        {(() => {
          const missingRequired = availablePlaceholders.filter((ph) => ph.required && !(promptText && promptText.includes(ph.tag)));
          if (missingRequired.length === 0 || isReadOnly) return null;
          return (
            <div
              className="placeholder-validation-warning"
              style={{
                margin: '0 0 8px 0',
                padding: '6px 12px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '6px',
                fontSize: '0.78rem',
                color: '#991b1b',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>⚠️</span>
              <span>
                <strong>Missing required placeholder{missingRequired.length > 1 ? 's' : ''}:</strong>{' '}
                <span className="missing-tags-label" style={{ fontWeight: 600 }}>
                  {missingRequired.map((ph) => `${ph.label} (${ph.tag})`).join(', ')}
                </span>{' '}
                (Click the chip{missingRequired.length > 1 ? 's' : ''} above to insert before saving).
              </span>
            </div>
          );
        })()}

        {showSchemaGuide && activeSchema && (
          <div className="schema-inspector-panel">
            <div className="schema-inspector-header">
              <div className="schema-header-info">
                <span className="schema-badge">Format: {activeSchema.format}</span>
                <span className="schema-description">{activeSchema.description}</span>
              </div>
              <button
                type="button"
                className="copy-schema-btn"
                onClick={() => handleCopySnippet(activeSchema.snippet)}
              >
                {copiedSnippet ? '✓ Copied!' : '📋 Copy JSON Snippet'}
              </button>
            </div>
            <pre className="schema-code-block">
              <code>{activeSchema.snippet}</code>
            </pre>
          </div>
        )}

        <div className="editor-container" data-color-mode="light">
          <MDEditor
              value={promptText}
              onChange={setPromptText}
              preview={isReadOnly ? 'preview' : 'edit'}
              hideToolbar={isReadOnly}
              textareaProps={{ 
                readOnly: isReadOnly,
                placeholder: editorPlaceholder
              }}
              height="100%"
          />
        </div>

        <div className={`scope-settings-panel ${isSettingsExpanded ? 'expanded' : 'collapsed'}`}>
            <button 
                type="button" 
                className="scope-settings-toggle"
                onClick={() => setIsSettingsExpanded(prev => !prev)}
                aria-expanded={isSettingsExpanded}
            >
                <span className="toggle-title-group">
                    <span>{isSettingsExpanded ? '▼' : '▶'}</span>
                    <span>⚙️ Scope & Permissions</span>
                </span>
                <span className="toggle-summary">
                    {accessLevel.toUpperCase()} • {applyTo && applyTo.length > 0 ? applyTo.join(', ') : 'Default scope'}
                </span>
            </button>

            {isSettingsExpanded && (
                <div className="scope-settings-body">
                    <div className="apply-to-group">
                        <label>Apply to:</label>
                        {activeTab === 'videos' ? (
                            <span> Per Video</span>
                        ) : (
                            categoryPromptTypes.map((pt) => (
                                <label key={pt.applyTo} title={pt.description}>
                                    <input 
                                        type="checkbox" 
                                        value={pt.applyTo} 
                                        checked={applyTo.includes(pt.applyTo)} 
                                        onChange={handleApplyToChange} 
                                        disabled={isReadOnly}
                                    />
                                    {pt.label}
                                </label>
                            ))
                        )}
                    </div>

                    {!isReadOnly && (
                      <div className="access-level-group">
                        <label>Access Level:</label>
                        <label title="Visible only to you">
                          <input type="radio" value="private" checked={accessLevel === 'private'} onChange={() => setAccessLevel('private')} />
                          Private
                        </label>
                        <label title="Share with specific colleagues by email">
                          <input type="radio" value="shared" checked={accessLevel === 'shared'} onChange={() => setAccessLevel('shared')} />
                          Shared
                        </label>
                        <label title="Share with all instructors across the institution">
                          <input type="radio" value="public" checked={accessLevel === 'public'} onChange={() => setAccessLevel('public')} />
                          Public
                        </label>
                      </div>
                    )}

                    {isReadOnly && (
                      <div className="access-level-group">
                        <label>Access Level:</label>
                        <span className={`prompt-badge ${isSystem ? 'system' : selectedPrompt.accessLevel}`}>
                          {isSystem ? 'System Template' : (selectedPrompt.accessLevel === 'public' ? 'Public' : 'Shared')}
                        </span>
                      </div>
                    )}

                    {accessLevel === 'shared' && !isReadOnly && (
                      <div className="shared-with-group">
                        <label>Share with (email):</label>
                        <div className="email-input-group">
                          <input type="email" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} placeholder="teacher@example.com" />
                          <button type="button" onClick={handleAddEmail}>Add</button>
                        </div>
                        <ul className="shared-with-list">
                          {sharedWithUsers.map(user => (
                            <li key={user.uid}>
                              {user.email}
                              <button type="button" onClick={() => handleRemoveUser(user.uid)}>Remove</button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                </div>
            )}
        </div>
    </div>
  );
};

export default PromptForm;
