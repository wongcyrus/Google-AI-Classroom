
import React from 'react';
import MDEditor from '@uiw/react-md-editor';

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
    originalPromptText
}) => {

  const isPublic = selectedPrompt?.accessLevel === 'public';

  return (
    <div className="prompt-form-column">
        <h3>{selectedPrompt ? 'Edit Prompt' : 'Create Prompt'}</h3>
        {isPublic && <p className="public-prompt-notice">This is a public prompt and cannot be edited.</p>}
        <input 
            type="text" 
            placeholder="Prompt Name" 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
            disabled={isPublic}
        />
        <div className="editor-container" data-color-mode="light">
          <MDEditor
              value={promptText}
              onChange={setPromptText}
              preview={isPublic ? 'preview' : 'edit'}
          />
        </div>
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
                        disabled={isPublic}
                    />
                    Per Image
                    </label>
                    <label>
                    <input 
                        type="checkbox" 
                        value="All Images" 
                        checked={applyTo.includes('All Images')} 
                        onChange={handleApplyToChange} 
                        disabled={isPublic}
                    />
                    All Images
                    </label>
                </>
            )}
            {activeTab === 'videos' && (
                <span> Per Video</span>
            )}
        </div>

        {!isPublic && (
          <div className="access-level-group">
            <label>Access Level:</label>
            <label>
              <input type="radio" value="private" checked={accessLevel === 'private'} onChange={() => setAccessLevel('private')} />
              Private
            </label>
            <label>
              <input type="radio" value="shared" checked={accessLevel === 'shared'} onChange={() => setAccessLevel('shared')} />
              Shared
            </label>
          </div>
        )}

        {accessLevel === 'shared' && !isPublic && (
          <div className="shared-with-group">
            <label>Share with (email):</label>
            <div className="email-input-group">
              <input type="email" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} placeholder="teacher@example.com" />
              <button onClick={handleAddEmail}>Add</button>
            </div>
            <ul className="shared-with-list">
              {sharedWithUsers.map(user => (
                <li key={user.uid}>
                  {user.email}
                  <button onClick={() => handleRemoveUser(user.uid)}>Remove</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="form-actions">
            {!isPublic && <button onClick={handleSave}>{selectedPrompt ? 'Save Changes' : 'Save Prompt'}</button>}
            {selectedPrompt && <button onClick={handleDuplicate} className="secondary-btn">Duplicate</button>}
            {selectedPrompt && !isPublic && <button onClick={handleDelete} className="delete-btn">Delete</button>}
            <button onClick={handleOptimize} disabled={isOptimizing}>{isOptimizing ? 'Optimizing...' : 'Optimize'}</button>
            <button onClick={handleUndo} disabled={!originalPromptText} className="secondary-btn">Undo</button>
        </div>
    </div>
  );
};

export default PromptForm;
