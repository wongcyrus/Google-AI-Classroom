import React, { useState } from 'react';
import MDEditor from '@uiw/react-md-editor';
import { auth } from '../../firebase-config';

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

        <div className="editor-container" data-color-mode="light">
          <MDEditor
              value={promptText}
              onChange={setPromptText}
              preview={isReadOnly ? 'preview' : 'edit'}
              hideToolbar={isReadOnly}
              textareaProps={{ readOnly: isReadOnly }}
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
                        {activeTab === 'images' && (
                            <>
                                <label>
                                <input 
                                    type="checkbox" 
                                    value="Per Image" 
                                    checked={applyTo.includes('Per Image')} 
                                    onChange={handleApplyToChange} 
                                    disabled={isReadOnly}
                                />
                                Per Image
                                </label>
                                <label>
                                <input 
                                    type="checkbox" 
                                    value="All Images" 
                                    checked={applyTo.includes('All Images')} 
                                    onChange={handleApplyToChange} 
                                    disabled={isReadOnly}
                                />
                                All Images
                                </label>
                            </>
                        )}
                        {activeTab === 'videos' && (
                            <span> Per Video</span>
                        )}
                        {activeTab === 'audios' && (
                            <>
                                <label>
                                <input 
                                    type="checkbox" 
                                    value="Live Audio Invigilation" 
                                    checked={applyTo.includes('Live Audio Invigilation')} 
                                    onChange={handleApplyToChange} 
                                    disabled={isReadOnly}
                                />
                                Live Audio Invigilation
                                </label>
                                <label>
                                <input 
                                    type="checkbox" 
                                    value="Session Audio Summary" 
                                    checked={applyTo.includes('Session Audio Summary')} 
                                    onChange={handleApplyToChange} 
                                    disabled={isReadOnly}
                                />
                                Session Audio Summary
                                </label>
                                <label>
                                <input 
                                    type="checkbox" 
                                    value="On-Device Gemma Voice Intent" 
                                    checked={applyTo.includes('On-Device Gemma Voice Intent')} 
                                    onChange={handleApplyToChange} 
                                    disabled={isReadOnly}
                                />
                                On-Device Gemma Voice Intent
                                </label>
                                <label>
                                <input 
                                    type="checkbox" 
                                    value="Live Subtitles & Translation" 
                                    checked={applyTo.includes('Live Subtitles & Translation')} 
                                    onChange={handleApplyToChange} 
                                    disabled={isReadOnly}
                                />
                                Live Subtitles & Translation
                                </label>
                            </>
                        )}
                        {activeTab === 'translations' && (
                            <>
                                <label>
                                <input 
                                    type="checkbox" 
                                    value="Live Subtitles & Translation" 
                                    checked={applyTo.includes('Live Subtitles & Translation')} 
                                    onChange={handleApplyToChange} 
                                    disabled={isReadOnly}
                                />
                                Live Subtitles & Translation
                                </label>
                                <label>
                                <input 
                                    type="checkbox" 
                                    value="Code-Switching Lectures" 
                                    checked={applyTo.includes('Code-Switching Lectures')} 
                                    onChange={handleApplyToChange} 
                                    disabled={isReadOnly}
                                />
                                Cantonese-English Code-Switching
                                </label>
                                <label>
                                <input 
                                    type="checkbox" 
                                    value="Technical Discipline Glossary" 
                                    checked={applyTo.includes('Technical Discipline Glossary')} 
                                    onChange={handleApplyToChange} 
                                    disabled={isReadOnly}
                                />
                                Technical Discipline Glossary
                                </label>
                            </>
                        )}
                        {activeTab === 'rubrics' && (
                            <>
                                <label>
                                <input 
                                    type="checkbox" 
                                    value="Lab Rubric Milestones" 
                                    checked={applyTo.includes('Lab Rubric Milestones')} 
                                    onChange={handleApplyToChange} 
                                    disabled={isReadOnly}
                                />
                                Lab Rubric Milestones
                                </label>
                                <label>
                                <input 
                                    type="checkbox" 
                                    value="Task Milestones Extraction" 
                                    checked={applyTo.includes('Task Milestones Extraction')} 
                                    onChange={handleApplyToChange} 
                                    disabled={isReadOnly}
                                />
                                Task Milestones Extraction
                                </label>
                            </>
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
