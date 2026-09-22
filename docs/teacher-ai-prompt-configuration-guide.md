# 🧠 Teacher AI Prompt & Discipline Domain Configuration Architecture

[🏠 Documentation Index](../README.md#documentation-index) | [👨‍🏫 Instructor Manual](./user-manual-teacher.md) | [🌐 Live Subtitles & Translation](./live-subtitles-and-translation.md) | [🗄️ Firestore Schema](./firestore-schema.md)

---

## 1. Executive Summary & Design Principles

The **Gemini Multimodal Classroom Agent** is built around three core architectural tenets governing AI execution:
1. **Universal Prompt Library**: Every AI system prompt across every sensory modality (Live Subtitle Translation, On-Device Gemma Voice Intent, Acoustic Invigilation, Discussion Diarization, Image/Screen Invigilation, Bingo Active Presence, and After-Class Video Analysis) is cataloged as a reusable, versioned asset in the central prompt library (`prompts` collection and `admin/prompts/`).
2. **Zero Hardcoding & Full Instructor Agency**: Instructors are never locked into rigid, one-size-fits-all prompts. Teachers can select, preview, tweak, inline-edit, or reset prompts for any class, ensuring terminology is tailored to the specific course curriculum.
3. **Dual-Surface Configuration**:
   - **Pre-Flight Class Setup (`ClassManagement.jsx`)**: Persistent configuration of default prompts stored in `classes/{classId}`.
   - **In-Flight Live Control (`TeacherSubtitleControlModal.jsx` & `MonitorView.jsx`)**: Real-time dropdown selection, subject domain switching, and inline prompt editing during live lectures, synchronizing instantly across all connected students and backend inference workers.

---

## 2. End-to-End System Architecture & Data Flow

The following diagram illustrates how prompts flow from the centralized catalog into teacher configuration surfaces, persist in Cloud Firestore, and drive inference across edge workers, browser AI, serverless Cloud Functions, and Gemini Live streaming sockets:

```mermaid
flowchart TD
    subgraph Catalog ["1. Central Prompt Library & Storage"]
        SeedMD["Markdown Seed Repository\n(admin/prompts/translations, audios, images, videos)"] --> SeedScript["seed_prompts.cjs / seed_initial_data.mjs"]
        SeedScript --> FSPrompts[("Firestore Collection: /prompts/{promptId}\n- category: translations | audios | images | videos\n- applyToFilter, accessLevel, promptText")]
    end

    subgraph TeacherUI ["2. Teacher Configuration Surfaces"]
        FSPrompts --> CM["Class Management (ClassManagement.jsx)\n- Pre-flight class creation & editing\n- Sections 4, 5, 6, 8 Configuration Pickers"]
        FSPrompts --> MonModal["Monitor Live Subtitles Modal (TeacherSubtitleControlModal.jsx)\n- Real-time Subject Domain Selector\n- Library Prompt Dropdown\n- Inline Prompt Editor with Apply & Reset"]
    end

    subgraph StatePersistence ["3. Firestore Class Document (/classes/{classId})"]
        CM -->|"updateDoc / setDoc"| ClassDoc["Document: /classes/{classId}\n- subjectDomain & customSubjectDomain\n- subtitlePrompt\n- gemmaIntentPrompt\n- liveImagePrompt\n- bingoPrompt\n- liveAudioPrompt & sessionAudioPrompt\n- afterClassVideoPrompt"]
        MonModal -->|"handleSelectSubtitlePrompt\nhandleSelectCourseContext"| ClassDoc
    end

    subgraph RuntimeConsumers ["4. Multimodal Runtime Inference Engines"]
        ClassDoc -->|"Snapshot Listener"| EdgeGemma["Edge Web Worker (litertGemma.worker.js)\nLiteRT-LM Gemma 4 E2B Voice Intent Proctor"]
        ClassDoc -->|"Snapshot Listener"| ChromeAI["Chrome Built-in AI (chromeTranslator.js)\nwindow.Translator (Gemini Nano)"]
        ClassDoc -->|"Callable API Payload / DB Read"| CFSubtitles["Cloud Function: translateTeacherSpeech\n(functions/ai_flows/subtitleFlows.js)\nGemini 3.5 Flash-Lite Server STT/Translation"]
        ClassDoc -->|"useTeacherLiveSubtitles Hook"| GeminiLive["Gemini Live WebSocket Stream\n(firebase/ai: gemini-3.1-flash-live-preview)"]
        ClassDoc -->|"analyzeFaceFallbackFlow"| CFVision["Cloud Function: analyzeFaceFallbackFlow\n(functions/ai_flows/analysisFlows.js)\nGemini Fallback Face & Gaze Invigilation"]
        ClassDoc -->|"resolveBingoQuestion"| CFBingo["Cloud Function: resolveBingoQuestion\n(functions/ai_flows/bingoFlows.js)\nGemini Attention Verification MCQ"]
        ClassDoc -->|"analyzeAudioChunk & summarizeSessionAudio"| CFAudio["Cloud Functions: analyzeAudioChunk & audioFlows\n(functions/ai_flows/audioFlows.js)\nAcoustic Invigilation & Discussion Summary"]
        ClassDoc -->|"processVideoJob"| CFVideo["Cloud Function: processVideoJob\n(functions/media_processing/processVideoJob.js)\nTwo-Stage Map-Reduce Video Rubric Evaluation"]
    end

    subgraph Distribution ["5. Real-Time Student Delivery & Display"]
        ChromeAI --> SubChannel["Firestore: classes/{classId}/liveSubtitles/current"]
        CFSubtitles --> SubChannel
        GeminiLive --> SubChannel
        SubChannel --> StudentOverlay["Student Viewport (LiveSubtitleOverlay.jsx)\nBilingual Subtitle Display (Original + Translation)"]
    end
```

---

## 3. Detailed Logic Trace-Down by Modality

### Modality 1: Live Subtitles & Multilingual Translation

- **Configurable Fields**: `subjectDomain`, `customSubjectDomain`, `subtitlePrompt` (`{ id, name, promptText }`).
- **Configuration Surfaces**:
  1. [`ClassManagement.jsx`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/web-app/src/components/ClassManagement.jsx) Section 8: Dropdown for `subjectDomain` and button triggering `AudioPromptSelector` (`applyToFilter='Live Subtitles & Translation'`).
  2. [`TeacherSubtitleControlModal.jsx`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/web-app/src/components/subtitles/TeacherSubtitleControlModal.jsx): Accessible anytime during live monitoring from the toolbar in [`MonitorView.jsx`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/web-app/src/components/MonitorView.jsx).

```mermaid
sequenceDiagram
    autonumber
    actor Teacher as 👨‍🏫 Instructor
    participant Modal as TeacherSubtitleControlModal
    participant Mon as MonitorView
    participant FS as 🗄️ Firestore (/classes/{id})
    participant Hook as useTeacherLiveSubtitles
    participant Engine as AI Engine (Client / CF / Live)
    participant Student as 🧑‍🎓 Student Clients

    Teacher->>Modal: Selects Domain ("Healthcare, Nursing & Medical Sciences")
    Modal->>Mon: onSelectCourseContext("Healthcare, Nursing & Medical Sciences")
    Mon->>FS: updateDoc({ subjectDomain: "Healthcare..." })

    Teacher->>Modal: Selects Prompt ("Nursing & Medical Clinical Translation")
    Modal->>Mon: onSelectSubtitlePrompt(selectedPrompt)
    Mon->>FS: updateDoc({ subtitlePrompt: selectedPrompt })

    Teacher->>Modal: Types custom instructions & clicks "Apply Custom Instructions"
    Modal->>Mon: onSelectSubtitlePrompt({ ...prompt, name: "... (Customized)", promptText })
    Mon->>FS: updateDoc({ subtitlePrompt: customizedPrompt })

    FS-->>Hook: onSnapshot listener updates classConfig
    Hook->>Engine: Dispatches audio chunk with customized prompt & discipline domain
    Engine->>FS: Publishes translated subtitle to /classes/{id}/liveSubtitles/current
    FS-->>Student: LiveSubtitleOverlay displays domain-accurate clinical translations
```

#### Code Execution Paths:
1. **Server Model Mode ([`functions/ai_flows/subtitleFlows.js`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/functions/ai_flows/subtitleFlows.js))**:
   - `translateTeacherSpeech` extracts `classData.subtitlePrompt?.promptText` and `classData.subjectDomain`.
   - If a custom prompt is set, it injects the custom instructions directly into the Gemini prompt while maintaining strict JSON schema output:
     ```javascript
     const domainContext = classData.subjectDomain || 'General Studies & Interdisciplinary';
     const basePrompt = classData.subtitlePrompt?.promptText 
       ? `${classData.subtitlePrompt.promptText}\n\nAcademic Subject Domain Context: "${domainContext}".`
       : `You are an expert real-time classroom lecture translator specializing in: "${domainContext}".`;
     ```
2. **Client Model Mode ([`web-app/src/utils/chromeTranslator.js`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/web-app/src/utils/chromeTranslator.js) & [`useClientLiteRTWhisper.js`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/web-app/src/hooks/useClientLiteRTWhisper.js))**:
   - STT is performed entirely on device by LiteRT Whisper WASM.
   - Translation is executed via `window.Translator` (Chrome Built-in AI / Gemini Nano). Domain context and glossaries are prefixed to the prompt context to prevent programming terms from being translated into literal colloquial words.
3. **Gemini Live Stream Mode ([`web-app/src/utils/aiLogic.js`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/web-app/src/utils/aiLogic.js))**:
   - Uses Firebase AI Logic (`gemini-3.1-flash-live-preview`).
   - The system instructions configured for the WebSocket session include the teacher's selected domain and subtitle prompt, guaranteeing low-latency (~200ms) token streaming with accurate domain vocabulary.

---

### Modality 2: On-Device Gemma Voice Intent Proctoring

- **Configurable Field**: `gemmaIntentPrompt` (`{ id, name, promptText }`).
- **Configuration Surface**: [`ClassManagement.jsx`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/web-app/src/components/ClassManagement.jsx) Section 6 (Screenshot & Recording Settings).
- **Execution Runtime**: Client-Side Web Worker ([`web-app/src/workers/litertGemma.worker.js`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/web-app/src/workers/litertGemma.worker.js)).

```mermaid
flowchart TD
    Teacher["👨‍🏫 Teacher selects / edits Gemma Intent Prompt in ClassManagement.jsx"] --> SaveDoc["Saved to classes/{classId}.gemmaIntentPrompt"]
    SaveDoc --> Hook["Student Hook (useFaceMonitor.js) receives prompt on startup"]
    Hook --> WorkerInit["Worker Message: { type: 'INIT', customPrompt: gemmaIntentPrompt.promptText }"]
    WorkerInit --> Worker["LiteRT-LM Gemma 4 E2B Web Worker (litertGemma.worker.js)"]
    
    StudentSpeech["Student speaks during proctored exam"] --> Whisper["On-Device Whisper STT transcribes transcript"]
    Whisper --> WorkerEval["Worker Message: { type: 'EVALUATE_TRANSCRIPT', transcript }"]
    WorkerEval --> PromptBuild["Worker interpolates: Student transcript: '${transcript}' into custom prompt"]
    PromptBuild --> GemmaInference["Local LiteRT Gemma 4 E2B Token Generation"]
    GemmaInference --> JSONParse["Parse JSON: { isViolation, category, severity, confidence, evidence, rationale }"]
    JSONParse --> ViolationCheck{"isViolation === true?"}
    ViolationCheck -- Yes --> Alert["Raise Onscreen Biometric Alert & Log Irregularity"]
    ViolationCheck -- No --> Pass["Mark Benign / Silence"]
```

- **Prompt Template Guidelines**:
  - The prompt guides categorization across: `COLLUSION_EXAM`, `EXTERNAL_AI_ASSIST`, `UNAUTHORIZED_TALK`, `LEGITIMATE_INQUIRY`, and `BENIGN`.
  - Teachers can tweak strictness (e.g. allowing students to read exam questions out loud or strictly forbidding all vocalization).

---

### Modality 3: Live Image & Screen Invigilation

- **Configurable Field**: `liveImagePrompt` (`{ id, name, promptText }`).
- **Configuration Surface**: [`ClassManagement.jsx`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/web-app/src/components/ClassManagement.jsx) Section 6 via [`ImagePromptSelector.jsx`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/web-app/src/components/ImagePromptSelector.jsx).
- **Execution Runtime**: Cloud Function `analyzeFaceFallbackFlow` in [`functions/ai_flows/analysisFlows.js`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/functions/ai_flows/analysisFlows.js).

```mermaid
sequenceDiagram
    autonumber
    participant Student as 🧑‍🎓 Student Client
    participant CF as ⚡ Cloud Function (analyzeFaceFallbackFlow)
    participant FS as 🗄️ Firestore (classes/{classId})
    participant Gemini as 🤖 Gemini Multimodal Vision

    Student->>CF: Sends webcam image snapshot for cloud fallback verification
    CF->>FS: Reads classes/{classId} to obtain liveImagePrompt
    alt Teacher has configured liveImagePrompt
        CF->>CF: Interpolates {{studentEmail}}, {{studentUid}}, and {{classId}} into promptText
    else Default Fallback
        CF->>CF: Uses standard face presence & gaze orientation prompt
    end
    CF->>Gemini: generateContent([interpolatedPrompt, webcamImage])
    Gemini-->>CF: Returns JSON: { faceStatus, confidence, reason }
    CF-->>Student: Updates faceStatus ('normal', 'looking_away', 'no_face', 'multiple_faces')
```

---

### Modality 4: Bingo Active Presence Challenge Verification

- **Configurable Field**: `bingoPrompt` (`{ id, name, promptText }`).
- **Configuration Surface**: [`ClassManagement.jsx`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/web-app/src/components/ClassManagement.jsx) Section 5 (Bingo Active Presence).
- **Execution Runtimes**: [`functions/ai_flows/bingoFlows.js`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/functions/ai_flows/bingoFlows.js) (`resolveBingoQuestion` and `generateBingoQuestionBank`).

#### Operational Modes & Custom Prompt Interpolation:
1. **Teacher Screen Attention Mode (`questionSource === 'teacher_screen'`)**:
   - Gemini analyzes the teacher's current live shared screen frame (`classes/{classId}/screenBroadcast/liveFrame`).
   - If the teacher configured a `bingoPrompt`, it replaces the default attention question instructions.
2. **Student Screen Activity Mode (`questionSource === 'student_screen'`)**:
   - Gemini inspects the student's latest desktop screenshot (`classes/{classId}/livePeeks/{studentUid}`).
   - Interpolates `{{studentUid}}` into the prompt, asking Gemini to verify whether the student is working on the assigned programming task rather than watching videos or idling.
3. **AI Question Bank Generator (`generateBingoQuestionBank`)**:
   - Interpolates `{{topic}}` and `{{count}}`.
   - Used by teachers in the Question Bank Studio (`BingoQuestionBankModal.jsx`) to auto-generate multiple-choice questions aligned with specific course rubrics.

---

### Modality 5: Acoustic Invigilation & Discussion Diarization

- **Configurable Fields**:
  - `liveAudioPrompt`: Short-window audio invigilation prompt (for real-time acoustic threat analysis).
  - `sessionAudioPrompt`: Full-session discussion diarization and summary prompt.
- **Configuration Surface**: [`ClassManagement.jsx`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/web-app/src/components/ClassManagement.jsx) Section 6 via [`AudioPromptSelector.jsx`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/web-app/src/components/AudioPromptSelector.jsx).
- **Execution Runtimes**:
  - `analyzeAudioChunk` (`functions/ai_flows/index.mjs`): Evaluates 30-second audio segments for unauthorized voices or collusive discussions.
  - `summarizeSessionAudio` (`functions/ai_flows/audioFlows.js`): Synthesizes student group discussion transcripts, identifying key contributors, technical debate quality, and unauthorized external assistance.

---

### Modality 6: After-Class Video Analysis & Rubric Synthesis Studio

- **Configurable Field**: `afterClassVideoPrompt` (`{ id, name, promptText }`).
- **Configuration Surface**: [`ClassManagement.jsx`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/web-app/src/components/ClassManagement.jsx) Section 6 via `VideoPromptSelector` and [`SessionReviewView.jsx`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/web-app/src/components/SessionReviewView.jsx).
- **Execution Runtime**: Cloud Function `processVideoJob` in [`functions/media_processing/processVideoJob.js`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/functions/media_processing/processVideoJob.js) and [`functions/ai_flows/analysisFlows.js`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/functions/ai_flows/analysisFlows.js).
- **Two-Stage Map-Reduce Flow**:
  - **Stage 1 (Video Observations)**: Gemini scans student compiled MP4 screencasts and extracts timecoded milestone observations.
  - **Stage 2 (Cohort Rubric Synthesis)**: Gemini aggregates observations across all students and applies `afterClassVideoPrompt` to generate a standardized lab evaluation rubric, complete with canonical milestones, common bottlenecks, and point values.

---

## 4. Prompt Template Variable Interpolation Matrix

When authoring custom prompts in the Prompt Studio or inline editors, teachers can embed template placeholders that are dynamically resolved at runtime:

| Variable Tag | Applicable Modalities | Runtime Source | Example Injected Value |
| :--- | :--- | :--- | :--- |
| `{{studentEmail}}` | Image Invigilation, Audio Chunks, Video Jobs | Authenticated User Profile | `s1234567@stu.vtc.edu.hk` |
| `{{studentUid}}` | Image Invigilation, Student Screen Bingo | Firebase Auth Token | `uid_abc123xyz` |
| `{{classId}}` | All Modalities | Active Classroom Context | `IT114115-2026-A` |
| `{{topic}}` | Bingo Question Bank Generator | Teacher Input Field | `Docker Container Networking` |
| `{{count}}` | Bingo Question Bank Generator | Teacher Input Field | `5` |
| `{{transcript}}` | On-Device Gemma Voice Intent | Whisper STT Output | `hey give me the answer for question 3` |

---

## 5. Fallback Hierarchy & FinOps Safety Net

To prevent lecture disruptions if a prompt is deleted or improperly formatted, the system enforces a strict 3-tier fallback hierarchy:

```mermaid
flowchart TD
    Start["AI Inference Triggered"] --> CheckCustom{"Is Custom Teacher Prompt\nConfigured in classDoc?"}
    CheckCustom -- Yes --> Interpolate["Interpolate Template Tags\n({{studentUid}}, {{topic}}, etc.)"]
    Interpolate --> RunCustom["Execute AI Inference with Custom Prompt"]
    
    CheckCustom -- No --> CheckLibrary{"Is Default Library Prompt\nAssociated with Class?"}
    CheckLibrary -- Yes --> RunLibrary["Execute AI Inference with Library Prompt"]
    
    CheckLibrary -- No --> RunHardcoded["Execute Safe System Baseline Prompt\n(Hardcoded Fallback in Cloud Function / Worker)"]
    
    RunCustom -.-> OnError["On JSON Parse / Model Error"]
    OnError --> RunHardcoded
```

1. **Tier 1 (Custom Teacher Prompt)**: Uses the instructor's configured prompt from `classes/{classId}` with custom parameters.
2. **Tier 2 (Library Standard Prompt)**: If no custom text is present, uses the pre-seeded institutional prompt from the `/prompts` collection.
3. **Tier 3 (Hardcoded System Baseline)**: If Firestore is unreachable or prompt text is invalid, the backend automatically defaults to the safe, hardcoded baseline prompt with strict JSON schema validation, ensuring zero proctoring downtime.
