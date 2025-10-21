import { useState, useMemo } from 'react';
import { useVideoPrompts } from '../hooks/useVideoPrompts';

const VideoPromptSelector = ({ user, selectedPrompt, onSelectPrompt, promptText, onTextChange }) => {
  const prompts = useVideoPrompts(user);
  const [promptFilter, setPromptFilter] = useState('all');

  const filteredPrompts = useMemo(() => {
    if (!user) {
      return [];
    }
    const { uid } = user;
    let newFilteredPrompts = [];
    if (promptFilter === 'all') {
      newFilteredPrompts = prompts;
    } else if (promptFilter === 'public') {
      newFilteredPrompts = prompts.filter(p => p.accessLevel === 'public');
    } else if (promptFilter === 'private') {
      newFilteredPrompts = prompts.filter(p => p.owner === uid && p.accessLevel === 'private');
    } else if (promptFilter === 'shared') {
      newFilteredPrompts = prompts.filter(p => p.accessLevel === 'shared');
    }
    return newFilteredPrompts;
  }, [prompts, promptFilter, user]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: '10px' }}>
        <label><input type="radio" value="all" name="promptFilter" checked={promptFilter === 'all'} onChange={(e) => setPromptFilter(e.target.value)} /> All</label>
        <label><input type="radio" value="public" name="promptFilter" checked={promptFilter === 'public'} onChange={(e) => setPromptFilter(e.target.value)} /> Public</label>
        <label><input type="radio" value="private" name="promptFilter" checked={promptFilter === 'private'} onChange={(e) => setPromptFilter(e.target.value)} /> Private</label>
        <label><input type="radio" value="shared" name="promptFilter" checked={promptFilter === 'shared'} onChange={(e) => setPromptFilter(e.target.value)} /> Shared</label>
      </div>
      <select 
        value={selectedPrompt ? selectedPrompt.id : ''} 
        onChange={(e) => {
          const prompt = prompts.find(p => p.id === e.target.value);
          onSelectPrompt(prompt);
        }}
        style={{ width: '100%', marginBottom: '10px', boxSizing: 'border-box' }}
      >
        <option value="">-- Select a prompt --</option>
        {filteredPrompts.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      
      <textarea
          value={promptText}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder="Select a prompt or enter text here..."
          style={{ width: '100%', flexGrow: 1, boxSizing: 'border-box', marginTop: '10px' }}
      />
    </div>
  );
};

export default VideoPromptSelector;
