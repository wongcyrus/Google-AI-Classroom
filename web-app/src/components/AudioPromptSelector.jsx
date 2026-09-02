import { useState, useMemo } from 'react';
import { useAudioPrompts } from '../hooks/useAudioPrompts';

const AudioPromptSelector = ({ user, selectedPrompt, onSelectPrompt, promptText, onTextChange, applyToFilter = null }) => {
  const prompts = useAudioPrompts(user, applyToFilter);
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
        <label><input type="radio" value="all" name="audioPromptFilter" checked={promptFilter === 'all'} onChange={(e) => setPromptFilter(e.target.value)} /> All</label>
        <label><input type="radio" value="public" name="audioPromptFilter" checked={promptFilter === 'public'} onChange={(e) => setPromptFilter(e.target.value)} /> Public</label>
        <label><input type="radio" value="private" name="audioPromptFilter" checked={promptFilter === 'private'} onChange={(e) => setPromptFilter(e.target.value)} /> Private</label>
        <label><input type="radio" value="shared" name="audioPromptFilter" checked={promptFilter === 'shared'} onChange={(e) => setPromptFilter(e.target.value)} /> Shared</label>
      </div>
      <select 
        value={selectedPrompt ? selectedPrompt.id : ''} 
        onChange={(e) => {
          const prompt = prompts.find(p => p.id === e.target.value);
          onSelectPrompt(prompt);
        }}
        style={{ width: '100%', marginBottom: '10px', boxSizing: 'border-box' }}
      >
        <option value="">-- Select a voice/audio prompt --</option>
        {filteredPrompts.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      
      <textarea
          value={promptText}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder="Select an audio prompt or enter custom instructions here..."
          rows={10}
          style={{ width: '100%', flexGrow: 1, boxSizing: 'border-box', marginTop: '10px', fontFamily: 'monospace', fontSize: '0.85rem' }}
      />
    </div>
  );
};

export default AudioPromptSelector;
