import React, { useState, useEffect } from 'react';
import "@uiw/react-md-editor/markdown-editor.css";
import './SharedViews.css';
import './PromptManagement.css';
import { db, auth } from '../firebase-config';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, where, getDocs, documentId, limit } from 'firebase/firestore';

const promptsCollectionRef = collection(db, 'prompts');

import PromptList from './prompt/PromptList';
import PromptForm from './prompt/PromptForm';

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
        return;
    }
    const { uid } = currentUser;

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





  return (
    <div className="view-container">
        <div className="view-header">
            <h2>Manage Prompts</h2>
        </div>
        <div className="prompt-management-content">
            <PromptList 
                prompts={prompts}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                selectedPrompt={selectedPrompt}
                onSelectPrompt={handleSelectPrompt}
                onClearForm={clearForm}
            />
            <PromptForm 
                selectedPrompt={selectedPrompt}
                name={name}
                setName={setName}
                promptText={promptText}
                setPromptText={setPromptText}
                applyTo={applyTo}
                handleApplyToChange={handleApplyToChange}
                accessLevel={accessLevel}
                setAccessLevel={setAccessLevel}
                sharedWithUsers={sharedWithUsers}
                emailInput={emailInput}
                setEmailInput={setEmailInput}
                handleAddEmail={handleAddEmail}
                handleRemoveUser={handleRemoveUser}
                handleSave={handleSave}
                handleDuplicate={handleDuplicate}
                handleDelete={handleDelete}
                activeTab={activeTab}
            />
        </div>
    </div>
  );
};

export default PromptManagement;