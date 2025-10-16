import React, { useState, useEffect } from 'react';
import "@uiw/react-md-editor/markdown-editor.css";
import './SharedViews.css';
import './PromptManagement.css';
import { db, auth, app } from '../firebase-config';
import { getAI, getGenerativeModel, VertexAIBackend } from "firebase/ai";
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
  const [originalPromptText, setOriginalPromptText] = useState('');
  const [isOptimizing, setIsOptimizing] = useState(false);

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
    setOriginalPromptText('');
    setIsOptimizing(false);
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

  const handleOptimize = async () => {
    if (!promptText) return;

    setOriginalPromptText(promptText);
    setIsOptimizing(true);

    try {
      const ai = getAI(app, { backend: new VertexAIBackend() });
      const model = getGenerativeModel(ai, { model: "gemini-2.5-flash" });

      const imageOptimizerPrompt = `You are an expert prompt engineer, specializing in Google's AI models for **image analysis**. Your task is to rewrite and expand the user's input to create a high-quality, detailed prompt that follows Google's best practices and is ready for reliable execution.

**Rewrite the following user-provided prompt based on these strict guidelines:**

**User's prompt:** "${promptText}"

---

**REWRITING GUIDELINES (incorporating Google's best practices):**

1.  **Role Definition (Persona):** Start with a clear role for the AI (e.g., "You are an AI invigilator," "Act as a senior software engineer").

2.  **Elaboration & Detail:** If the user's prompt is brief (e.g., "check for cheating"), you **MUST** expand it. Infer the user's intent and generate a complete prompt with specific, unambiguous instructions for analyzing a **single screen capture**.

3.  **Structure and Formatting:**
    *   Use Markdown for clarity (headings, bolding, lists).
    *   Create a "## Guidelines" or "## Analysis Guidelines" section detailing what the AI should look for in the image.
    *   Create an "## Action & Response Protocol" or "## Actions" section with a step-by-step list of actions.

4.  **Incorporate Examples (Few-Shot Prompting):** If the task requires a specific output format, style, or pattern, you **MUST** add 1-2 examples to the prompt to guide the model.

5.  **Chain-of-Thought for Complexity:** If the task is complex or requires reasoning, instruct the model to "think step by step" within the action protocol.

6.  **Tool & Output Specification:**
    *   Clearly specify any tools that **MUST** be called (e.g., \`recordIrregularity\`).
    *   Define the exact text for final answers in different scenarios (e.g., "If there are no issues, your final answer MUST be the exact text: 'All systems are stable.'").
    *   Include an "## Output Guidelines" section for formatting rules, like using 'email (uid)' for students.

7.  **Positive Instructions:** Frame instructions positively. Tell the model what to do, not what to avoid (e.g., use "Ensure the summary is one paragraph" instead of "Do not write more than one paragraph").

**Return ONLY the rewritten, complete prompt as raw text, without any markdown code blocks, introductory text, or explanations.**`;

      const videoOptimizerPrompt = `You are an expert prompt engineer, specializing in Google's AI models for **video analysis**. Your task is to rewrite and expand the user's input to create a high-quality, detailed prompt that follows Google's best practices and is ready for reliable execution.

**Rewrite the following user-provided prompt based on these strict guidelines:**

**User's prompt:** "${promptText}"

---

**REWRITING GUIDELINES (incorporating Google's best practices):**

1.  **Role Definition (Persona):** Start with a clear role for the AI (e.g., "You are an AI invigilator," "Act as a senior software engineer").

2.  **Elaboration & Detail:** If the user's prompt is brief (e.g., "check for cheating"), you **MUST** expand it. Infer the user's intent and generate a complete prompt with specific, unambiguous instructions.

3.  **Structure and Formatting:**
    *   Use Markdown for clarity (headings, bolding, lists).
    *   Create a "## Guidelines" or "## Analysis Guidelines" section detailing what the AI should look for.
    *   Create an "## Action & Response Protocol" or "## Actions" section with a step-by-step list of actions.

4.  **Incorporate Examples (Few-Shot Prompting):** If the task requires a specific output format, style, or pattern, you **MUST** add 1-2 examples to the prompt to guide the model.

5.  **Chain-of-Thought for Complexity:** If the task is complex or requires reasoning, instruct the model to "think step by step" within the action protocol.

6.  **Tool & Output Specification:**
    *   Clearly specify any tools that **MUST** be called (e.g., \`recordIrregularity\`).
    *   Define the exact text for final answers in different scenarios (e.g., "If there are no issues, your final answer MUST be the exact text: 'All systems are stable.'").
    *   Include an "## Output Guidelines" section for formatting rules, like using 'email (uid)' for students.

7.  **Positive Instructions:** Frame instructions positively. Tell the model what to do, not what to avoid (e.g., use "Ensure the summary is one paragraph" instead of "Do not write more than one paragraph").

8.  **Video Context:** You **MUST** include the standard "## Video Context" section about the time-lapse video.
    *   "## Video Context
        *   The video is a fast-forwarded time-lapse created from screenshots of the student's screen. It is not a real-time recording.
        *   A top bar on each frame displays the actual date and time of the screenshot, along with the class and student's email. Use this information for context."

**Return ONLY the rewritten, complete prompt as raw text, without any markdown code blocks, introductory text, or explanations.**`;

      const optimizerPrompt = activeTab === 'videos' ? videoOptimizerPrompt : imageOptimizerPrompt;

      const result = await model.generateContent(optimizerPrompt);
      let optimizedText = result.response.text();

      // Strip markdown code block if present
      const markdownBlockRegex = /^```markdown\n([\s\S]*?)\n```$/;
      const match = optimizedText.match(markdownBlockRegex);
      if (match) {
        optimizedText = match[1];
      }

      setPromptText(optimizedText);
    } catch (error) {
      console.error("Error optimizing prompt: ", error);
      alert(`Error optimizing prompt: ${error.message}`);
      setOriginalPromptText(''); // Clear original text if optimization fails
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleUndo = () => {
    if (originalPromptText) {
      setPromptText(originalPromptText);
      setOriginalPromptText('');
    }
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
                handleOptimize={handleOptimize}
                handleUndo={handleUndo}
                isOptimizing={isOptimizing}
                originalPromptText={originalPromptText}
            />
        </div>
    </div>
  );
};

export default PromptManagement;