import React, { useState, useEffect } from 'react';
import './PromptManagement.css';
import { db } from '../firebase-config';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';

const PromptManagement = ({ onClose }) => {
  const [prompts, setPrompts] = useState([]);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [name, setName] = useState('');
  const [promptText, setPromptText] = useState('');
  const [applyTo, setApplyTo] = useState([]);

  const promptsCollectionRef = collection(db, 'prompts');

  useEffect(() => {
    const unsubscribe = onSnapshot(promptsCollectionRef, (snapshot) => {
      const promptsData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      setPrompts(promptsData);
    });
    return () => unsubscribe();
  }, []);

  const handleSelectPrompt = (prompt) => {
    setSelectedPrompt(prompt);
    setName(prompt.name);
    setPromptText(prompt.promptText);
    setApplyTo(prompt.applyTo || []);
  };

  const handleApplyToChange = (e) => {
    const { value, checked } = e.target;
    if (checked) {
      setApplyTo(prev => [...prev, value]);
    } else {
      setApplyTo(prev => prev.filter(item => item !== value));
    }
  };

  const clearForm = () => {
    setSelectedPrompt(null);
    setName('');
    setPromptText('');
    setApplyTo([]);
  };

  const handleSave = async () => {
    if (!name || !promptText || applyTo.length === 0) {
      alert('Please fill in all fields and select at least one application type.');
      return;
    }

    const promptData = { 
      name, 
      promptText, 
      applyTo, 
      lastUpdated: serverTimestamp() 
    };

    try {
      if (selectedPrompt) {
        const promptDoc = doc(db, 'prompts', selectedPrompt.id);
        await updateDoc(promptDoc, promptData);
        alert('Prompt updated successfully!');
      } else {
        await addDoc(promptsCollectionRef, { ...promptData, createdAt: serverTimestamp() });
        alert('Prompt saved successfully!');
      }
      clearForm();
    } catch (error) {
      console.error("Error saving prompt: ", error);
      alert(`Error saving prompt: ${error.message}`);
    }
  };

  const handleDelete = async () => {
    if (!selectedPrompt) return;
    if (!window.confirm(`Are you sure you want to delete "${selectedPrompt.name}"?`)) return;

    const promptDoc = doc(db, 'prompts', selectedPrompt.id);
    await deleteDoc(promptDoc);
    clearForm();
  };

  const handleDuplicate = () => {
    if (!selectedPrompt) return;
    setSelectedPrompt(null); // Switch to create mode
    setName(`${name} - Copy`);
    // The rest of the form state (promptText, applyTo) remains, creating a duplicate
  };

  return (
    <div className="prompt-management-modal">
      <div className="prompt-management-content">
        <div className="prompt-list-column">
          <h3>Saved Prompts</h3>
          <button onClick={clearForm} className="new-prompt-btn">+ New Prompt</button>
          <ul>
            {prompts.map(prompt => (
              <li key={prompt.id} onClick={() => handleSelectPrompt(prompt)} className={selectedPrompt?.id === prompt.id ? 'selected' : ''}>
                {prompt.name}
              </li>
            ))}
          </ul>
        </div>
        <div className="prompt-form-column">
          <h3>{selectedPrompt ? 'Edit Prompt' : 'Create Prompt'}</h3>
          <input 
            type="text" 
            placeholder="Prompt Name" 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
          />
          <textarea 
            placeholder="Enter prompt text..." 
            value={promptText} 
            onChange={(e) => setPromptText(e.target.value)}
          />
          <div className="apply-to-group">
            <label>Apply to:</label>
            <label>
              <input 
                type="checkbox" 
                value="Per Image" 
                checked={applyTo.includes('Per Image')} 
                onChange={handleApplyToChange} 
              />
              Per Image
            </label>
            <label>
              <input 
                type="checkbox" 
                value="All Images" 
                checked={applyTo.includes('All Images')} 
                onChange={handleApplyToChange} 
              />
              All Images
            </label>
          </div>
          <div className="form-actions">
            <button onClick={handleSave}>{selectedPrompt ? 'Save Changes' : 'Save Prompt'}</button>
            {selectedPrompt && <button onClick={handleDuplicate} className="secondary-btn">Duplicate</button>}
            {selectedPrompt && <button onClick={handleDelete} className="delete-btn">Delete</button>}
          </div>
        </div>
        <button onClick={onClose} className="close-btn">X</button>
      </div>
    </div>
  );
};

export default PromptManagement;
