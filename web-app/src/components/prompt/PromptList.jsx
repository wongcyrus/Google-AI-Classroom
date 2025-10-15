
import React from 'react';
import { auth } from '../../firebase-config';

const PromptList = ({ 
    prompts, 
    activeTab, 
    setActiveTab, 
    searchTerm, 
    setSearchTerm, 
    selectedPrompt, 
    onSelectPrompt, 
    onClearForm 
}) => {

  const filteredPrompts = prompts
    .filter(p => p.category === activeTab)
    .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="prompt-list-column">
        <div className="tabs">
            <button onClick={() => setActiveTab('images')} className={activeTab === 'images' ? 'active' : ''}>Image Prompts</button>
            <button onClick={() => setActiveTab('videos')} className={activeTab === 'videos' ? 'active' : ''}>Video Prompts</button>
        </div>
        <input 
            type="text" 
            placeholder="Search prompts..." 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)} 
            className="search-box"
        />
        <h3>Saved Prompts</h3>
        <button onClick={onClearForm} className="new-prompt-btn">+ New Prompt</button>
        <ul>
            {filteredPrompts.map(prompt => (
            <li key={prompt.id} onClick={() => onSelectPrompt(prompt)} className={selectedPrompt?.id === prompt.id ? 'selected' : ''}>
                {prompt.name}
                {prompt.accessLevel === 'public' && <span className="prompt-badge public">Public</span>}
                {prompt.accessLevel === 'shared' && <span className="prompt-badge shared">Shared</span>}
                {prompt.owner === auth.currentUser?.uid && prompt.accessLevel === 'private' && <span className="prompt-badge private">Private</span>}
            </li>
            ))}
        </ul>
    </div>
  );
};

export default PromptList;
