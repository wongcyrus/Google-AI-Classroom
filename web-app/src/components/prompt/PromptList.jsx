import React from 'react';
import { auth } from '../../firebase-config';
import { PROMPT_CATEGORIES } from '../../constants/promptRegistry';

const PromptList = ({ 
    prompts, 
    activeTab, 
    setActiveTab, 
    searchTerm, 
    setSearchTerm, 
    selectedPrompt, 
    onSelectPrompt, 
    onClearForm,
    isCollapsed = false,
    onToggleCollapse,
    categoryCounts = {},
}) => {

  const filteredPrompts = prompts
    .filter(p => {
      if (activeTab === 'translations') {
        return p.category === 'translations' || p.applyTo?.includes('Live Subtitles & Translation') || p.applyTo?.includes('Lecture Subtitle Translation') || p.applyTo?.includes('Lecture Subtitles & Chapters');
      }
      if (activeTab === 'rubrics') {
        return p.category === 'rubrics' || p.applyTo?.includes('Lab Rubric Milestones') || p.applyTo?.includes('Task Milestones Extraction');
      }
      return p.category === activeTab;
    })
    .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className={`prompt-list-column ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="tabs">
          {PROMPT_CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setActiveTab(cat.key)}
              className={activeTab === cat.key ? 'active' : ''}
              aria-label={cat.label}
              title={cat.desc}
            >
              {cat.label}
              {categoryCounts[cat.key] > 0 && (
                <span className="tab-count-badge" aria-hidden="true">
                  {categoryCounts[cat.key]}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="search-box-wrapper">
            <input 
                type="text" 
                placeholder="Search prompts..." 
                value={searchTerm} 
                onChange={(e) => setSearchTerm(e.target.value)} 
                className="search-box"
            />
            {searchTerm && (
                <button type="button" className="clear-search-btn" onClick={() => setSearchTerm('')} title="Clear search">✕</button>
            )}
        </div>
        <div className="prompt-list-header">
            <h3>Saved Prompts</h3>
            {onToggleCollapse && (
                <button 
                    type="button" 
                    className="sidebar-toggle-btn"
                    onClick={onToggleCollapse} 
                    title="Collapse prompt list to maximize editor screen"
                >
                    ◀ Hide
                </button>
            )}
        </div>
        <button onClick={onClearForm} className="new-prompt-btn">+ New Prompt</button>
        <ul>
            {filteredPrompts.map(prompt => (
            <li key={prompt.id} onClick={() => onSelectPrompt(prompt)} className={selectedPrompt?.id === prompt.id ? 'selected' : ''}>
                <div className="prompt-item-header">
                    <span className="prompt-item-name">{prompt.name}</span>
                    {prompt.accessLevel === 'public' && <span className="prompt-badge public">Public</span>}
                    {prompt.accessLevel === 'shared' && <span className="prompt-badge shared">Shared</span>}
                    {prompt.owner === auth.currentUser?.uid && prompt.accessLevel === 'private' && <span className="prompt-badge private">Private</span>}
                </div>
                {prompt.applyTo && prompt.applyTo.length > 0 && (
                    <div className="prompt-item-scopes">
                        {prompt.applyTo.map(scope => (
                            <span key={scope} className="scope-tag">{scope}</span>
                        ))}
                    </div>
                )}
            </li>
            ))}
        </ul>
    </div>
  );
};

export default PromptList;
