import React, { useState, useEffect } from 'react';
import './SharedViews.css';
import './PromptManagement.css';
import { db } from '../firebase-config';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';

const promptsCollectionRef = collection(db, 'prompts');

const PromptManagement = () => {
  const [prompts, setPrompts] = useState([]);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [name, setName] = useState('');
  const [promptText, setPromptText] = useState('');
  const [applyTo, setApplyTo] = useState([]);
  const [activeTab, setActiveTab] = useState('images'); // 'images' or 'videos'

  const [searchTerm, setSearchTerm] = useState('');

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
    let promptData;
    if (activeTab === 'videos') {
        if (!name || !promptText) {
            alert('Please fill in all fields.');
            return;
        }
        promptData = { 
          name, 
          promptText, 
          applyTo: ['Per Video'], 
          category: activeTab,
          lastUpdated: serverTimestamp() 
        };
    } else {
        if (!name || !promptText || applyTo.length === 0) {
          alert('Please fill in all fields and select at least one application type.');
          return;
        }
        promptData = { 
          name, 
          promptText, 
          applyTo, 
          category: activeTab,
          lastUpdated: serverTimestamp() 
        };
    }

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
  };

  const filteredPrompts = prompts
    .filter(p => p.category === activeTab)
    .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="view-container">
        <div className="view-header">
            <h2>Manage Prompts</h2>
        </div>
        <div className="prompt-management-content">
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
            <button onClick={clearForm} className="new-prompt-btn">+ New Prompt</button>
            <ul>
                {filteredPrompts.map(prompt => (
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
                {activeTab === 'images' && (
                    <>
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
                    </>
                )}
                {activeTab === 'videos' && (
                    <span> Per Video</span>
                )}
            </div>
            <div className="form-actions">
                <button onClick={handleSave}>{selectedPrompt ? 'Save Changes' : 'Save Prompt'}</button>
                {selectedPrompt && <button onClick={handleDuplicate} className="secondary-btn">Duplicate</button>}
                {selectedPrompt && <button onClick={handleDelete} className="delete-btn">Delete</button>}
            </div>
            </div>
        </div>
    </div>
  );
};

export default PromptManagement;