import React, { useState, useEffect } from 'react';
import MDEditor from '@uiw/react-md-editor';
import "@uiw/react-md-editor/markdown-editor.css";
import './SharedViews.css';
import './PromptManagement.css';
import { db, auth } from '../firebase-config';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, where, getDocs, documentId, limit } from 'firebase/firestore';

const promptsCollectionRef = collection(db, 'prompts');

const PromptManagement = () => {
  const [prompts, setPrompts] = useState([]);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [name, setName] = useState('');
  const [promptText, setPromptText] = useState('');
  const [applyTo, setApplyTo] = useState([]);
  const [activeTab, setActiveTab] = useState('images'); // 'images' or 'videos'
  const [searchTerm, setSearchTerm] = useState('');
  const [accessLevel, setAccessLevel] = useState('private');
  const [sharedWithUids, setSharedWithUids] = useState([]);
  const [sharedWithUsers, setSharedWithUsers] = useState([]);
  const [emailInput, setEmailInput] = useState('');

  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
        setPrompts([]);
        return;
    }
    const { uid, email } = currentUser;

    const unsubscribers = [];
    let publicPrompts = [], privatePrompts = [], sharedPrompts = [];

    const combineAndSetPrompts = () => {
        const all = [...publicPrompts, ...privatePrompts, ...sharedPrompts];
        const unique = Array.from(new Map(all.map(p => [p.id, p])).values());
        unique.sort((a, b) => a.name.localeCompare(b.name));
        setPrompts(unique);
    };

    const qPublic = query(promptsCollectionRef, where('accessLevel', '==', 'public'));
    unsubscribers.push(onSnapshot(qPublic, snapshot => {
        publicPrompts = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        combineAndSetPrompts();
    }));

    const qOwner = query(promptsCollectionRef, where('owner', '==', uid));
    unsubscribers.push(onSnapshot(qOwner, snapshot => {
        privatePrompts = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        combineAndSetPrompts();
    }));

    const qShared = query(promptsCollectionRef, where('sharedWith', 'array-contains', uid));
    unsubscribers.push(onSnapshot(qShared, snapshot => {
        sharedPrompts = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        combineAndSetPrompts();
    }));

    return () => unsubscribers.forEach(unsub => unsub());
  }, []);

  const handleSelectPrompt = async (prompt) => {
    setSelectedPrompt(prompt);
    setName(prompt.name);
    setPromptText(prompt.promptText);
    setApplyTo(prompt.applyTo || []);
    setAccessLevel(prompt.accessLevel || 'private');
    
    const uids = prompt.sharedWith || [];
    setSharedWithUids(uids);

    if (uids.length > 0) {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where(documentId(), 'in', uids));
        const snapshot = await getDocs(q);
        const users = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
        setSharedWithUsers(users);
    } else {
        setSharedWithUsers([]);
    }
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
    setAccessLevel('private');
    setSharedWithUids([]);
    setSharedWithUsers([]);
    setEmailInput('');
  };

  const handleSave = async () => {
    const { uid, email } = auth.currentUser;
    if (!uid) {
        alert('You must be logged in to save prompts.');
        return;
    }

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
        };
    }

    const fullPromptData = {
        ...promptData,
        accessLevel,
        sharedWith: accessLevel === 'shared' ? sharedWithUids : [],
        owner: uid,
        ownerEmail: email,
        lastUpdated: serverTimestamp()
    };

    try {
      if (selectedPrompt) {
        const promptDoc = doc(db, 'prompts', selectedPrompt.id);
        await updateDoc(promptDoc, fullPromptData);
        alert('Prompt updated successfully!');
      } else {
        await addDoc(promptsCollectionRef, { ...fullPromptData, createdAt: serverTimestamp() });
        alert('Prompt saved successfully!');
      }
      clearForm();
    } catch (error) {
      console.error("Error saving prompt: ", error);
      alert(`Error saving prompt: ${error.message}`);
    }
  };

  const handleDelete = async () => {
    if (!selectedPrompt || selectedPrompt.accessLevel === 'public') return;
    if (!window.confirm(`Are you sure you want to delete "${selectedPrompt.name}"?`)) return;

    const promptDoc = doc(db, 'prompts', selectedPrompt.id);
    await deleteDoc(promptDoc);
    clearForm();
  };

  const handleDuplicate = () => {
    if (!selectedPrompt) return;
    setSelectedPrompt(null); // Switch to create mode
    setName(`${name} - Copy`);
    setAccessLevel('private');
    setSharedWithUids([]);
    setSharedWithUsers([]);
  };

  const handleAddEmail = async () => {
    if (!emailInput || auth.currentUser.email === emailInput) return;

    const usersRef = collection(db, 'users');
    const q = query(usersRef, where("email", "==", emailInput), limit(1));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
        alert(`User with email ${emailInput} not found.`);
        return;
    }

    const userDoc = snapshot.docs[0];
    const uid = userDoc.id;
    const email = userDoc.data().email;

    if (!sharedWithUids.includes(uid)) {
        setSharedWithUids([...sharedWithUids, uid]);
        setSharedWithUsers([...sharedWithUsers, { uid, email }]);
    }
    setEmailInput('');
  };

  const handleRemoveUser = (uidToRemove) => {
    setSharedWithUids(sharedWithUids.filter(uid => uid !== uidToRemove));
    setSharedWithUsers(sharedWithUsers.filter(user => user.uid !== uidToRemove));
  };

  const filteredPrompts = prompts
    .filter(p => p.category === activeTab)
    .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const isPublic = selectedPrompt?.accessLevel === 'public';

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
                    {prompt.accessLevel === 'public' && <span className="prompt-badge public">Public</span>}
                    {prompt.accessLevel === 'shared' && <span className="prompt-badge shared">Shared</span>}
                    {prompt.owner === auth.currentUser?.uid && prompt.accessLevel === 'private' && <span className="prompt-badge private">Private</span>}
                </li>
                ))}
            </ul>
            </div>
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
            </div>
            </div>
        </div>
    </div>
  );
};

export default PromptManagement;