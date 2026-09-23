import React, { useState, useEffect } from 'react';
import "@uiw/react-md-editor/markdown-editor.css";
import './SharedViews.css';
import './PromptManagement.css';
import { db, auth, app } from '../firebase-config';
import { getAI, getGenerativeModel, AgentPlatformBackend, VertexAIBackend } from "firebase/ai";
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isZenMode, setIsZenMode] = useState(false);

  useEffect(() => {
    let unsubscribers = [];
    let publicPrompts = [], privatePrompts = [], sharedPrompts = [];

    const combineAndSetPrompts = () => {
        const all = [...publicPrompts, ...privatePrompts, ...sharedPrompts];
        const unique = Array.from(new Map(all.map(p => [p.id, p])).values());
        unique.sort((a, b) => a.name.localeCompare(b.name));
        setPrompts(unique);
    };

    const setupListeners = (user) => {
        unsubscribers.forEach(u => u());
        unsubscribers = [];
        publicPrompts = [];
        privatePrompts = [];
        sharedPrompts = [];

        if (!user) {
            setPrompts([]);
            return;
        }
        const { uid } = user;

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
    };

    if (auth.onAuthStateChanged) {
        const unsub = auth.onAuthStateChanged(user => setupListeners(user || auth.currentUser));
        return () => {
            if (typeof unsub === 'function') unsub();
            unsubscribers.forEach(u => u());
        };
    } else {
        setupListeners(auth.currentUser);
        return () => unsubscribers.forEach(u => u());
    }
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

  const clearForm = (tab = activeTab) => {
    setSelectedPrompt(null);
    setName('');
    setPromptText('');
    let defaultApply = [];
    if (tab === 'translations') defaultApply = ['Live Subtitles & Translation'];
    else if (tab === 'rubrics') defaultApply = ['Lab Rubric Milestones'];
    setApplyTo(defaultApply);
    setAccessLevel('private');
    setSharedWithUids([]);
    setSharedWithUsers([]);
    setEmailInput('');
    setOriginalPromptText('');
    setIsOptimizing(false);
  };

  const handleSave = async () => {
    const { uid, email } = auth.currentUser || {};
    if (!uid) {
        alert('You must be logged in to save prompts.');
        return;
    }

    if (selectedPrompt) {
        const isSystem = selectedPrompt.isSystem || 
                         selectedPrompt.owner === 'system' || 
                         (selectedPrompt.accessLevel === 'public' && (!selectedPrompt.owner || selectedPrompt.owner === 'system'));
        const isOwner = !selectedPrompt.owner || selectedPrompt.owner === uid;
        const isSharedEditor = selectedPrompt.accessLevel === 'shared' && selectedPrompt.sharedWith?.includes(uid);

        if (isSystem) {
            alert('This is a pre-seeded system prompt and cannot be edited. Please click "Make a Copy to Personalize" to save a customized version.');
            return;
        }
        if (!isOwner && !isSharedEditor) {
            alert('You do not have permission to edit this prompt. Please click "Make a Copy to Personalize" to save your own customized version.');
            return;
        }
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
    } else if (activeTab === 'translations') {
        if (!name || !promptText) {
            alert('Please fill in all fields.');
            return;
        }
        promptData = {
          name,
          promptText,
          applyTo: applyTo.length > 0 ? applyTo : ['Live Subtitles & Translation'],
          category: 'translations',
        };
    } else if (activeTab === 'rubrics') {
        if (!name || !promptText) {
            alert('Please fill in all fields.');
            return;
        }
        promptData = {
          name,
          promptText,
          applyTo: applyTo.length > 0 ? applyTo : ['Lab Rubric Milestones'],
          category: 'rubrics',
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
        owner: selectedPrompt?.owner && selectedPrompt.owner !== 'system' ? selectedPrompt.owner : uid,
        ownerEmail: selectedPrompt?.ownerEmail || email,
        isSystem: false,
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
    if (!selectedPrompt) return;
    const isSystem = selectedPrompt.isSystem || 
                     selectedPrompt.owner === 'system' || 
                     (selectedPrompt.accessLevel === 'public' && (!selectedPrompt.owner || selectedPrompt.owner === 'system'));
    if (isSystem) return;

    const { uid } = auth.currentUser || {};
    const isOwner = !selectedPrompt.owner || selectedPrompt.owner === uid;
    if (!isOwner) {
        alert('Only the author can delete this prompt.');
        return;
    }
    if (!window.confirm(`Are you sure you want to delete "${selectedPrompt.name}"?`)) return;

    const promptDoc = doc(db, 'prompts', selectedPrompt.id);
    await deleteDoc(promptDoc);
    clearForm();
  };

  const handleDuplicate = () => {
    if (!selectedPrompt) return;
    const isSystem = selectedPrompt.isSystem || 
                     selectedPrompt.owner === 'system' || 
                     (selectedPrompt.accessLevel === 'public' && (!selectedPrompt.owner || selectedPrompt.owner === 'system'));
    const isOwner = !selectedPrompt.owner || selectedPrompt.owner === auth.currentUser?.uid;

    setSelectedPrompt(null); // Switch to create mode
    setName(`${name} - Copy`);
    setAccessLevel('private');
    setSharedWithUids([]);
    setSharedWithUsers([]);
    if (isSystem || !isOwner) {
      alert(`Created a personal copy of "${selectedPrompt.name}". You can now customize and save it.`);
    }
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
      const location = import.meta.env?.VITE_VERTEX_AI_LOCATION || 'global';
      const backend = typeof AgentPlatformBackend !== 'undefined'
        ? new AgentPlatformBackend(location)
        : new VertexAIBackend(location);
      const ai = getAI(app, { backend });
      const candidateModels = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];

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

      const audioOptimizerPrompt = `You are an expert prompt engineer, specializing in Google's AI models for **speech, audio transcript invigilation, and classroom discussion analysis**. Your task is to rewrite and expand the user's input to create a high-quality, detailed prompt that follows Google's best practices and is ready for reliable execution.

**Rewrite the following user-provided prompt based on these strict guidelines:**

**User's prompt:** "${promptText}"

---

**REWRITING GUIDELINES (incorporating Google's best practices):**

1.  **Role Definition (Persona):** Start with a clear role for the AI (e.g., "You are an AI Classroom Invigilator," "You are an AI Educational Discussion Analyst").

2.  **Elaboration & Context:** Specify clearly whether the prompt is analyzing short rolling live speech (15-45s) for immediate cheating/whispering or full session/discussion continuous audio for topic breakdown and educational summaries.

3.  **Structure and Formatting:**
    *   Use Markdown for clarity (headings, bolding, lists).
    *   Include "## Guidelines" for identifying multi-speaker dynamics, collusion, questions read aloud, or key discussion arguments.
    *   Include "## Actions & Response Protocol" with step-by-step instructions.

4.  **Tool Specifications:**
    *   For invigilation tasks, reference calling \`recordAudioIrregularity\` and \`recordAudioAudit\` tools with clear verdicts ('clean_exam', 'suspicious_collaboration', 'whisper_detected', 'background_noise', 'inconclusive').
    *   For on-device Gemma intent tasks, format structured JSON output with fields: \`isViolation\`, \`category\`, \`severity\`, \`confidence\`, \`evidence\`, \`rationale\`.

5.  **Positive & Precise Instructions:** Explicitly state what indicators to evaluate (e.g., "Evaluate whether speaker turns indicate answer sharing vs. procedural clarification").

**Return ONLY the rewritten, complete prompt as raw text, without any markdown code blocks, introductory text, or explanations.**`;

      const translationOptimizerPrompt = `You are an expert prompt engineer, specializing in Google's AI models for **real-time classroom lecture translation and dual-line subtitle generation**. Your task is to rewrite and expand the user's input into a high-quality, precise translation prompt following Google's best practices.

**Rewrite the following user-provided prompt based on these strict guidelines:**

**User's prompt:** "${promptText}"

---

**REWRITING GUIDELINES (incorporating Google's best practices):**

1.  **Role Definition (Persona):** State clearly: "You are an expert real-time classroom lecture translator and subtitle specialist."
2.  **Context Integration:** Specify input placeholders for Spoken Language ({{spokenLanguage}}), Target Subtitle Language ({{targetLanguage}}), and Course Discipline Domain ({{courseContext}}).
3.  **Terminology & Technical Nomenclature Rules:** Explicitly mandate preserving technical terms, variable names, formulas, clinical nomenclature, or accounting standards in their standard English/Latin representation without destructive translation.
4.  **Code-Switching Support:** If handling bilingual lecture speech (e.g., Cantonese mixed with English), provide rules to convert colloquial conversational grammar into formal written text while keeping technical loanwords intact.
5.  **Output Pacing & Format:** State that output must be concise, readable dual-line subtitle phrases. Mandate returning ONLY direct translated text with zero explanations, zero phonetic guides, and zero markdown formatting.

**Return ONLY the rewritten, complete prompt as raw text, without any markdown code blocks, introductory text, or explanations.**`;

      const rubricOptimizerPrompt = `You are an expert prompt engineer specializing in Google's Gemini models for **technical practical task assessment, milestone extraction, and automated rubric generation**. Your task is to rewrite and expand the user's input into a high-quality, precise rubric extraction prompt following Google's best practices.

**Rewrite the following user-provided prompt based on these strict guidelines:**

**User's prompt:** "${promptText}"

---

**REWRITING GUIDELINES (incorporating Google's best practices):**

1.  **Role Definition (Persona):** State clearly: "You are an expert technical educator, university curriculum designer, and automated practical skills assessment evaluator."
2.  **Context Integration:** Guide the AI to inspect teacher demonstration recordings, identifying visual commands, code editor changes, configuration steps, and verification indicators.
3.  **Milestone Structure:** Instruct the AI to extract between 3 and 8 distinct, chronological milestones.
4.  **Observable Evidence:** Explicitly mandate that each milestone specifies expected visual evidence (e.g. terminal output text, HTTP status codes, opened network ports, browser UI, green test checks).
5.  **Balanced Scoring:** Mandate allocating point weights that sum to 100 points, calibrated to the difficulty and pedagogical weight of each step.
6.  **Output Format:** Specify that output must strictly be structured JSON with fields: title, description, suggestedMaxScore, and steps (stepNumber, title, description, expectedEvidence, points).

**Return ONLY the rewritten, complete prompt as raw text, without any markdown code blocks, introductory text, or explanations.**`;

      const optimizerPrompt = 
        activeTab === 'videos' ? videoOptimizerPrompt : 
        activeTab === 'audios' ? audioOptimizerPrompt : 
        activeTab === 'translations' ? translationOptimizerPrompt : 
        activeTab === 'rubrics' ? rubricOptimizerPrompt :
        imageOptimizerPrompt;

      let result = null;
      let lastErr = null;
      for (const mName of candidateModels) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const model = getGenerativeModel(ai, { model: mName });
            result = await model.generateContent(optimizerPrompt);
            if (result) break;
          } catch (err) {
            lastErr = err;
            console.warn(`[PromptOptimizer] Attempt ${attempt} on ${mName} encountered:`, err?.message || err);
            await new Promise((r) => setTimeout(r, 600 * attempt));
          }
        }
        if (result) break;
      }

      if (!result) throw lastErr;

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





  const categoryCounts = React.useMemo(() => {
    const counts = { images: 0, videos: 0, audios: 0, translations: 0, rubrics: 0 };
    prompts.forEach(p => {
      if (p.category === 'images') counts.images++;
      else if (p.category === 'videos') counts.videos++;
      else if (p.category === 'audios') counts.audios++;
      else if (p.category === 'translations') counts.translations++;
      else if (p.category === 'rubrics') counts.rubrics++;
      // Cross-scope fallbacks
      if (p.category !== 'translations' && p.applyTo?.includes('Live Subtitles & Translation')) {
        counts.translations++;
      }
      if (p.category !== 'rubrics' && (p.applyTo?.includes('Lab Rubric Milestones') || p.applyTo?.includes('Task Milestones Extraction'))) {
        counts.rubrics++;
      }
    });
    return counts;
  }, [prompts]);

  return (
    <div className={`view-container prompt-studio-view ${isZenMode ? 'zen-mode-active' : ''}`}>
        <div className="view-header prompt-studio-header">
            <div className="prompt-header-title-row">
                <h2>Manage Prompts</h2>
                <div className="prompt-header-actions">
                    <button 
                        type="button" 
                        className={`sidebar-toggle-btn ${isSidebarCollapsed ? 'collapsed' : ''}`}
                        onClick={() => setIsSidebarCollapsed(prev => !prev)}
                        title={isSidebarCollapsed ? "Expand Prompts List" : "Collapse Prompts List to Maximize Editor"}
                    >
                        {isSidebarCollapsed ? "▶ Show List" : "◀ Hide List"}
                    </button>
                </div>
            </div>
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
                isCollapsed={isSidebarCollapsed}
                onToggleCollapse={() => setIsSidebarCollapsed(prev => !prev)}
                categoryCounts={categoryCounts}
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
                isZenMode={isZenMode}
                setIsZenMode={setIsZenMode}
                isSidebarCollapsed={isSidebarCollapsed}
                onToggleSidebar={() => setIsSidebarCollapsed(prev => !prev)}
            />
        </div>
    </div>
  );
};

export default PromptManagement;