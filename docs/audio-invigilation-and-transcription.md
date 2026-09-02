# Audio Invigilation & Voice AI Architecture

This document provides a comprehensive technical guide to the complete Audio Invigilation, Moving Window Audio Segmentation, Edge LiteRT Whisper & Gemma Intent Proctoring, and Session Summarization systems powered by Google LiteRT and Gemini AI.

---

## 1. High-Level Architecture Overview

The acoustic pipeline operates across client-side edge inference (WebGPU / WASM) and server-side cloud orchestration (Firebase Cloud Functions + Gemini 3.5 Transcribe), supporting four distinct operational modes.

```mermaid
flowchart TD
    subgraph Client [Student Browser]
        Mic[Microphone Stream] --> DevAcq[Two-Phase Device Acquisition & Challenge Verification]
        DevAcq --> VAD[Volume / VAD Analyzer]
        
        %% Mode 1: Edge LiteRT
        VAD -->|Mode 1: On-Device Edge| ScriptProc[ScriptProcessorNode 16kHz PCM]
        ScriptProc --> EdgeWhisper[litertWhisper.worker.js\nQuantized Whisper Tiny]
        EdgeWhisper -->|Local Transcript| EdgeGemma[litertGemma.worker.js\nGemma 4 E2B Intent Proctor]
        EdgeGemma -->|Zero Cloud Egress| LocalAlert[Real-Time Status Alert\nclasses/.../status/uid]

        %% Mode 2: Moving Window Invigilation
        VAD -->|Mode 2: Live Moving Window| RollingBuf[30s Window / 15s Stride Buffer]
        RollingBuf -->|Silence Suppressed| DropSilence[Quiet Segment Dropped\n>80% Cost Savings]
        RollingBuf -->|Speech Detected| WebMChunk[Export WebM Segment]
        WebMChunk --> StorageUpload[Firebase Storage: /audios/...]

        %% Mode 3: Discussion Summarization
        VAD -->|Mode 3: Discussion Summary| SummaryBuf[Configurable Long Buffer\n5m, 10m, 15m, 30m, Full Session]
        SummaryBuf --> LongWebM[Export Long Audio Segment]
        LongWebM --> StorageUpload

        %% Mode 4: Offline Queue
        WebMChunk -.->|Network Offline| IDB[(IndexedDB Offline Queue)]
        IDB -.->|Network Restored| StorageUpload
    end

    subgraph Backend [Cloud Functions & Genkit AI Pipeline]
        StorageUpload --> AnalyzeFn[Cloud Function: analyzeAudio / analyzeAudioSegment]
        PromptLib[(Prompt Library\nCustom Audio Prompts)] --> AnalyzeFn
        AnalyzeFn --> GeminiTranscribe[Gemini 3.5 Transcribe & Diarization]
        GeminiTranscribe --> ToolCalling[Gemini Tool Calling:\nrecordAudioIrregularity]
        ToolCalling --> FirestoreAudits[(Firestore: /irregularities/ &\n/audio_audits/)]
    end

    subgraph Dashboard [Teacher Invigilation Dashboard]
        LocalAlert --> MonitorGrid[Live Monitor Grid Badge]
        FirestoreAudits --> LiveFeed[Acoustic Activity Feed]
        FirestoreAudits --> SummaryView[Discussion Summary Modal]
    end
```

---

## 2. Multi-Mode Voice Processing Matrix

| Specification | Mode 1: On-Device LiteRT Whisper + Gemma | Mode 2: Real-Time Rolling Moving Window | Mode 3: Discussion / Session Summarization | Mode 4: Offline Hybrid Queue |
| :--- | :--- | :--- | :--- | :--- |
| **Primary Model** | Local LiteRT Whisper + Gemma 4 E2B | Cloud `gemini-3.5-transcribe` | Cloud `gemini-3.5-transcribe` & Gemini Pro | Local IndexedDB + Post-Sync Cloud |
| **Execution Tier** | 100% Client Browser (WebGPU / WASM) | Cloud Function + Vertex AI / Genkit | Cloud Function + Vertex AI / Genkit | Client-side buffered queue |
| **Network Egress** | Zero audio upload (transcripts/alerts only) | WebM chunks uploaded via HTTPS | WebM chunks uploaded per interval | Zero until connection restored |
| **Timing Cadence** | Continuous stream (~1-2s latency) | 15s stride / 30s sliding window | 5 min, 10 min, 15 min, 30 min, or Full Session | Automatic re-flush on reconnection |
| **Prompt Customization** | Configurable Gemma Proctor Prompt | Configurable Live Invigilation Prompt | Configurable Discussion Summary Prompt | Inherited from selected cloud mode |
| **Cost Profile** | **$0.00 / Zero API Cost** | Optimized by silence suppression | Single or batch macro-call | Buffered, executed upon sync |

---

## 3. Mode 1: On-Device LiteRT Whisper + Gemma Intent Proctoring (Zero Cloud Egress)

Mode 1 runs entirely in client-side Web Workers using Google LiteRT (`@litertjs/core` and `@litert-lm/core`).

### Mode 1 Sequence Flow

```mermaid
sequenceDiagram
    autonumber
    actor S as Student Browser
    participant W_Whisper as litertWhisper.worker.js
    participant W_Gemma as litertGemma.worker.js
    participant FS as Firestore (classes/.../status)
    actor T as Teacher Monitor Grid

    Note over S,W_Whisper: AudioCapture attached to chosen microphone
    S->>W_Whisper: INIT (modelBuffer: whisper_tiny.tflite)
    W_Whisper-->>S: INIT_COMPLETE (delegate: webgpu/wasm)

    S->>W_Gemma: INIT (modelUrl: gemma-4-e2b.bin)
    W_Gemma-->>S: INIT_COMPLETE (WebGPU initialized)

    loop Every Speech Segment
        S->>W_Whisper: TRANSCRIBE (16kHz PCM Float32Array)
        W_Whisper->>W_Whisper: Mel Spectrogram Feature Extraction & Token Decoding
        W_Whisper-->>S: TRANSCRIBE_COMPLETE ("What is the answer for question 4?")
        
        S->>W_Gemma: EVALUATE_TRANSCRIPT (transcript + Custom System Prompt)
        W_Gemma->>W_Gemma: LLM Inference with Structured JSON Output
        W_Gemma-->>S: EVALUATION_COMPLETE (isViolation: true, category: 'COLLUSION_EXAM')
        
        S->>FS: updateDoc(statusRef, { gemmaAlert: '🚨 Collusion (Gemma)' })
        FS-->>T: Real-Time Snapshot Listener Triggered
        T->>T: Highlight Student Card in Red Badge
    end
```

---

## 4. Mode 2: Real-Time Rolling Moving Window Audio Invigilation

Mode 2 resolves the classic **boundary truncation problem** using a 50% overlapping sliding window (30s window, 15s stride) with silence suppression.

### Boundary Healing & Deduplication

```mermaid
flowchart LR
    subgraph Stride1 [Window 1: 0s - 30s]
        W1A["...What is the ans- [CUT]"]
    end
    subgraph Stride2 [Window 2: 15s - 45s (50% Overlap)]
        W2A["[HEALED] What is the answer for question four?"]
    end
    subgraph Merger [transcriptMerger.js]
        W1A --> Matcher[Timestamp Alignment & Overlap Matcher]
        W2A --> Matcher
        Matcher --> FinalTranscript["'What is the answer for question four?' (Deduplicated)"]
    end
```

### Mode 2 Sequence Flow

```mermaid
sequenceDiagram
    autonumber
    actor S as Student Browser (useAudioRecorder)
    participant CS as Firebase Storage (/audios/...)
    participant CF as Cloud Function (analyzeAudioSegment)
    participant PL as Prompt Library (Firestore)
    participant G as Gemini 3.5 Transcribe
    participant DB as Firestore (/irregularities/)
    actor T as Teacher Dashboard

    S->>S: VAD Check: RMS volume > 4% threshold?
    alt Silence Detected (< 4% RMS)
        S->>S: Drop chunk (Skip Cloud Storage & API cost)
    else Speech Detected (>= 4% RMS)
        S->>CS: Upload WebM Segment (30s buffer)
        CS-->>CF: onObjectFinalized Trigger
        CF->>PL: Load Active Voice Invigilation Prompt
        CF->>G: Multimodal Audio + Prompt + recordAudioIrregularity Tool
        G->>G: Multi-Speaker Diarization & Transcribe
        G-->>CF: Tool Call: recordAudioIrregularity(severity: 'high', type: 'EXAM_COLLUSION')
        CF->>DB: Write irregularity doc & audio audit record
        DB-->>T: Real-time update in Irregularities Feed & Transcript Timeline
    end
```

---

## 5. Mode 3: Classroom Discussion & Long Session Audio Summarization

For collaborative classroom discussions or post-session reviews, short 30s chunks are replaced by **configurable long audio intervals**.

### Discussion Summarization Flow

```mermaid
sequenceDiagram
    autonumber
    actor Teacher as Teacher
    actor Student as Student Group
    participant App as Web App (useAudioRecorder)
    participant Storage as Firebase Storage
    participant Function as Cloud Function (summarizeAudioSession)
    participant Gemini as Gemini 3.5 Transcribe / Gemini Pro
    participant DB as Firestore (/dossiers/ or /audio_summaries/)

    Teacher->>App: Set audioSummaryIntervalSec (5m, 10m, 15m, 30m, Full Session)
    
    loop Per Configured Interval
        Student->>App: Group Discussion & Collaborative Speech
        App->>Storage: Upload Concatenated Discussion Audio
        Storage->>Function: Trigger Summarization
        Function->>Gemini: Execute Discussion Analysis with 'Session Audio Summary' Prompt
        Gemini->>Gemini: Analyze Key Discussion Points, Speaker Participation & Topic Progression
        Gemini-->>Function: Structured Summary (Main Insights, Action Items, Speaker Balance)
        Function->>DB: Save Discussion Dossier & Timeline Insights
        DB-->>Teacher: Render Discussion Summary Modal & Participation Graph
    end
```

---

## 6. Mode 4: Offline Queue & Cloud Hybrid Fallback

When a student loses internet connectivity during an examination:

```mermaid
stateDiagram-v2
    [*] --> OnlineMonitoring: Network Connected
    OnlineMonitoring --> OfflineBuffering: Connection Lost (navigator.onLine == false)
    
    state OfflineBuffering {
        [*] --> CaptureAudio: MediaRecorder Chunk
        CaptureAudio --> EdgeWhisperSTT: Local Transcription (LiteRT)
        EdgeWhisperSTT --> LocalGemmaGuard: Local Violation Check (LiteRT)
        LocalGemmaGuard --> IndexedDBQueue: Store WebM + Meta in IndexedDB
        IndexedDBQueue --> CaptureAudio
    }

    OfflineBuffering --> NetworkReconnected: Connection Restored (window.online event)
    
    state NetworkReconnected {
        [*] --> FlushQueue: readIndexedDBChunks()
        FlushQueue --> UploadStorage: Parallel Batch Upload (Storage)
        UploadStorage --> TriggerCloudAudits: Execute Cloud Gemini Backfill
        TriggerCloudAudits --> [*]
    }
    
    NetworkReconnected --> OnlineMonitoring: Sync Complete
```

---

## 7. Dynamic Voice Prompt Library & Teacher Configuration Modal

All voice prompts are managed dynamically in the unified Prompt Library and integrated directly into the Teacher Monitor's Live Configuration modal:

1. **Category `audios`**: First-class prompt category alongside `images` and `videos`.
2. **Tag Targets (`applyTo`)**:
   - `Live Audio Invigilation`: Cloud-side rolling moving window prompt for `analyzeAudioFlow` / `analyzeAudioSegment`.
   - `Session Audio Summary`: Cloud-side discussion summarization prompt for `summarizeAudioSession`.
   - `On-Device Gemma Voice Intent`: Client-side prompt for `litertGemma.worker.js`.
3. **Teacher AI Configuration Modal (`ControlsPanel.jsx` - Tab 2: Voice & Speech)**:
   - Category filter tabs (`All`, `Public`, `Private`, `Shared`).
   - Voice prompt selector dropdown populating from `useAudioPrompts`.
   - One-click placeholder insertion buttons (`+ {{transcript}}`, `+ {{classId}}`, `+ {{studentUid}}`, `+ {{studentEmail}}`).
   - Live editable prompt textarea saved to `classes/{classId}` in Firestore.
4. **Mustache Template Substitution Engine**:
   - Both client-side Gemma worker and server-side Genkit flow support dynamic interpolation:
     - `{{transcript}}`: Injected real-time microphone transcript.
     - `{{classId}}`: Active classroom ID.
     - `{{studentUid}}`: Student Firebase UID.
     - `{{studentEmail}}`: Student email address.
   - Fallback: If `{{transcript}}` is omitted from a custom template, the system automatically appends the audio transcript context block.

---

## 8. Client-Side Gemma vs. Server-Side Genkit: Irregularity & Tool Handling

| Dimension | Client-Side LiteRT Gemma (`hybrid` / `client_only`) | Server-Side Cloud Genkit (`cloud_only`) |
| :--- | :--- | :--- |
| **Model** | Gemma 4 E2B (`@litert-lm/core`) via WebGPU/WASM | Gemini 3.5 Flash-Lite via Vertex AI / Cloud Functions |
| **Tool Calling Support** | **No native tool calling** (model generates constrained JSON) | **Native Genkit tool calling** (`ai.defineTool`) |
| **Output Contract** | Structured JSON schema: `{"isViolation": bool, "category": string, "severity": string, "confidence": number, "evidence": string, "rationale": string}` | Autonomous Tool Invocations: `recordAudioIrregularity()`, `recordAudioAudit()` |
| **Irregularity Logging** | **Client Hook Execution (`useClientLiteRTGemma.js`)**: Hook detects `isViolation === true` and executes direct Firestore writes to `/irregularities` and `/classes/{classId}/irregularities` | **Cloud Function Execution (`aiTools.js`)**: Cloud Genkit agent invokes `recordAudioIrregularity` tool during generation |
| **Telemetry Updates** | Merges `gemmaAlert`, `gemmaSeverity`, `gemmaConfidence`, `lastGemmaTimestamp` directly into `/classes/{classId}/status/{studentUid}` | Cloud Function writes to class subcollections and logs audits |
| **Cloud Quota & Latency** | **$0.00 / 0 Cloud API tokens**, ~1-2s local inference | Standard Vertex AI token billing, ~3-5s network + generation roundtrip |


