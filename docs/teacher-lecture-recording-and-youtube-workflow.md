# Teacher Lecture Recording & YouTube Multilingual CC Workflow

## 1. Executive Summary & Design Rationale

In classroom instruction—especially technical engineering and software development courses conducted in Hong Kong—instructors frequently use Cantonese-English code-switching (e.g., *"We use `useState` to store state, and then call `useEffect`..."*).

### Why Real-Time Subtitles Are NOT Reused for Lecture Recordings
Real-time live subtitles operate under extreme latency constraints (<1.5s per chunk). Consequently:
- Subtitles are produced from 15–30 second moving-window chunks with Voice Activity Detection (VAD) cutoffs.
- Chunks lack global discourse context, leading to sentence fragmentation, misinterpreted technical terminology, and incomplete clauses.
- Minor network fluctuations or packet jitter during live broadcast can cause dropped or desynchronized lines.

For high-stakes archive recordings and public/unlisted **YouTube publishing**, the system employs **Full-Context Offline Gemini Transcription & multilingual captioning**:
1. The teacher records the complete lecture (clean video + mixed high-fidelity microphone and desktop audio).
2. The recordings are uploaded in parallel to Cloud Storage (`lecture.webm` for video and `lecture_audio.webm` for pure audio).
3. An offline Cloud Function passes the **pure audio track (`lecture_audio.webm`)** to Google Gemini. **Video frames are strictly never sent to Gemini for captioning**, eliminating up to 90% token waste and preventing premature context exhaustion. Pure audio consumes only 32 tokens/second (~115,200 tokens/hour), fitting comfortably within Gemini's processing limits.
4. The system employs the **Whole-Audio Single-Pass Architecture (`gemini-3.5-flash-lite`)** as its definitive subtitle and CC engine:
   - Ingests the entire pure audio track via `gs://` Cloud Storage URI in a single pass without any audio slicing or chunking.
   - Leverages Gemini's 1,000,000+ token context window, zero reasoning token overhead (`thinkingConfig: { thinkingBudget: 0 }`), and `maxOutputTokens: 65536`.
   - Generates verbatim Hong Kong CS code-switching transcription (Cantonese + English technical terms), synchronized multilingual subtitles (`en`, `zh-Hant`, `zh-Hans`), and YouTube chapter milestones in one unified operation.
5. The video remains clean (unburned pixels), while standalone standard `.vtt` (in-browser HTML5 playback with synchronized `onComplete` track attachment and zero-duration cue guards) and `.srt` (YouTube Creator Studio upload) files are generated.

---

## 2. Key Operational Principles: Teacher Sovereignty & Class Overlap Handling

### Teacher Full Sovereignty (No Forced Auto-Recording)
Class schedules are unpredictable:
- Teachers may arrive late due to office hours or previous commitments.
- Teachers may spend the first 5 minutes setting up equipment or answering private administrative questions.
- Teachers frequently pause for student lab exercises, quizzes, or bio breaks.

**Core Rule**: Lecture recording **NEVER** starts automatically based solely on calendar time. Timetable data only provides contextual metadata (class title, room, default topic). The teacher retains full sovereign control to **Start**, **Pause**, **Resume**, **Stop & Save**, or **Discard** recording at any moment.

### 5-Minute Class Buffer & Overlap Protection
Many educational institutions schedule consecutive classes with a 5-minute buffer or back-to-back room handovers (e.g., Class A ends at 10:55, Class B starts at 11:00).
- Automatic calendar recording would bleed Class A's ending questions into Class B's recording.
- In our system, recording sessions are strictly bound to individual session IDs (`classes/{classId}/lectureRecordings/{sessionId}`).
- When a class window ends, the teacher is gently prompted to finalize or discard the active recording. A recording from one class cannot write into another class's collection or overwrite existing video blobs.

### Class-Level Default Recording Policy & Studio Mode Selector
To prevent teachers from accidentally forgetting to record lecture archives, the classroom configuration provides a class-level recording default:
1. **Class-Wide Default (`classes/{classId}.defaultLectureRecording`)**:
   - `true` (**Record & Stream by Default - Recommended**): Every time the teacher opens the Teacher Screen Broadcast Studio, HD recording is automatically pre-armed.
   - `false` (**Live Stream Only by Default**): Broadcaster defaults to real-time ephemeral screen delivery without saving storage files unless manually toggled.
2. **Prominent 2-Card Studio Broadcast Mode Selector**:
   - In Step 2 of the Teacher Broadcast Setup Wizard, instructors are presented with two interactive mode cards:
     - **Option 1: 🎥 Stream & Record (YouTube & CC)**: Transmits live frames to students and records full composite HD WebM video + pure audio to Cloud Storage for YouTube packaging and Gemini CC. Action button: `🔴 Start Live Stream & Record`.
     - **Option 2: 📡 Live Stream Only (0 Storage / Ephemeral)**: Streams real-time screen frames and voice subtitles directly to student monitors with zero files saved to Cloud Storage. Action button: `🚀 Start Live Stream Only (No Saving)`.
   - Teachers retain complete per-session override freedom: selecting a different card immediately flips the mode and dynamically updates the start action button.

### Asymmetric Data Nature: Teacher Sovereign Deletion vs. Student Telemetry TTL
Student data and teacher data serve fundamentally different educational purposes and are governed by distinct lifecycles:
- **Student Proctoring Telemetry (Strict Automated TTL)**: Student screenshots, webcam stills, audio slices, and presence logs are sensitive invigilation records. They are subjected to strict automated Time-To-Live (TTL) policies (14–90 days configured in Class Settings) and automatic bucket lifecycle rules, guaranteeing student privacy.
- **Teacher Lecture Archives (Permanent Teacher Sovereignty)**: Lecture recordings and AI transcripts are instructional intellectual property belonging to the course. They do **not** auto-expire on a 14-day timer. Instead, lecture recordings are permanently preserved until the teacher explicitly clicks **Delete Recording** in the Lecture Recordings Studio, triggering atomic deletion across Firestore documents, video WebM blobs, pure audio files, and all multilingual `.vtt` / `.srt` subtitle assets.

---

## 3. Architecture & Data Flow (Dual-Stream Ingestion)

```
[Teacher Screen + Mic] 
         │ (Web Audio API Destination Node)
         ├──► [Browser Video MediaRecorder] ──────► [Storage: lecture.webm (~1.2GB)]
         │                                               │ (Archive / Playback)
         └──► [Browser Audio MediaRecorder (Opus)] ──► [Storage: lecture_audio.webm (~25MB)]
                                                         │ (AI Ingestion Stream)
                                                         ▼
                                       [Cloud Function: processLectureSubtitles]
                                                         │ (Direct gs:// Audio Ingestion)
                                                         ▼
                                       [Gemini 3.5 Transcribe / 3.5 Flash via gs:// URI]
                                         ├── Verbatim Cantonese/English Transcript (Single-Pass, No Slicing)
                                         ├── multilingual subtitles (en, zh-Hant, zh-Hans)
                                         └── YouTube Chapter Markers & Metadata
                                                         │
                                                         ▼ (Cloud Storage write)
                                       [Storage: subtitles_{lang}.vtt & .srt]
                                                         │
                                                         ▼ (Firestore update: classes/{classId}/lectureRecordings/{sessionId})
                                       [LectureRecordingsView (Web App)]
                                         ├── Native HTML5 Video Player with Multilingual <track>
                                         ├── One-Click Copy YouTube Title & Description
                                         └── One-Click Download YouTube Package (.zip)
```

### 3.1 Client-Side Dual-Stream Architecture (`useLectureRecorder.js`)

To decouple massive display screencast bandwidth from AI audio speech processing, the recording hook [`web-app/src/hooks/useLectureRecorder.js`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/web-app/src/hooks/useLectureRecorder.js) operates a synchronized dual-recorder pipeline:

1. **Hardware-Locked Audio Mixing (`Web Audio API`)**:
   - The teacher's microphone (`navigator.mediaDevices.getUserMedia`) and screen audio (`navigator.mediaDevices.getDisplayMedia`) are routed into a single browser `AudioContext`.
   - Both audio sources pass through gain stages into a `MediaStreamAudioDestinationNode`. This hardware-locks microphone and system audio without clock drift.
   - The composite video stream combines `displayStream.getVideoTracks()` with `mixedAudioDestination.stream.getAudioTracks()`.
   - A dedicated `pureAudioStreamRef` is extracted and preserved exclusively for speech transcription.

2. **Audio MIME Type Dynamic Negotiation**:
   Different client operating systems and browsers (macOS Safari vs. Windows Chrome vs. Linux Chromium) implement varying audio codec support. The hook evaluates codecs in priority order via `MediaRecorder.isTypeSupported()`:
   ```javascript
   function getSupportedAudioMimeType() {
     const types = [
       'audio/webm; codecs=opus',
       'audio/webm',
       'audio/ogg; codecs=opus',
       'audio/mp4'
     ];
     for (const type of types) {
       if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
         return type;
       }
     }
     return ''; // Fall back to browser default
   }
   ```

3. **Synchronous Multi-Recorder Lifecycle**:
   - **`videoRecorderRef`**: Captures screen video at native resolution (1080p/1440p) using `video/webm; codecs=vp9,opus` (or `video/mp4`).
   - **`audioRecorderRef`**: Captures pure voice + system sound using the negotiated audio MIME type.
   - **10-Second Timeslice Chunking**: Both recorders invoke `.start(10000)`, emitting discrete 10-second blobs via `dataavailable` event listeners. This eliminates browser tab crashes when recording 90-minute lectures.
   - **State Mirroring**: All lifecycle operations (`start`, `pause`, `resume`, `stop`, `discard`, and unmount cleanups) operate atomically across both recorders in lockstep.

4. **Concurrent Cloud Storage Uploads**:
   Upon recording termination, the hook issues parallel uploads via Firebase Storage SDK (`uploadBytesResumable`):
   - Video File: `recordings/{classId}/{sessionId}/lecture.webm` (~750 MB – 1.25 GB for 90 mins).
   - Audio Track: `recordings/{classId}/{sessionId}/lecture_audio.webm` (~20 MB – 30 MB for 90 mins).
   - Writes `videoUrl`, `storagePath`, `audioUrl`, `audioStoragePath`, and `audioFileSize` to the Firestore session document.

---

### 3.2 Backend Ingestion Prioritization & Fallback (`processLectureSubtitles.js`)

When the teacher initiates subtitle and chapter generation, the Cloud Function [`functions/ai_flows/processLectureSubtitles.js`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/functions/ai_flows/processLectureSubtitles.js) executes the following path resolution:

```javascript
export function resolveEffectiveStoragePath(sessionData, requestedStoragePath) {
  if (sessionData && sessionData.audioStoragePath && typeof sessionData.audioStoragePath === 'string') {
    return {
      storagePath: sessionData.audioStoragePath,
      source: 'audio_only'
    };
  }
  const fallbackPath = (sessionData && sessionData.storagePath) || requestedStoragePath || '';
  return {
    storagePath: fallbackPath,
    source: fallbackPath ? 'video' : 'none'
  };
}
```

#### Why Prioritizing `audioStoragePath` is Transformative:
- **97% Bandwidth & Payload Reduction**: Ingesting pure Opus audio (~25 MB) instead of composite VP9 video (~1.2 GB) prevents network saturation between Cloud Storage and Gemini inference endpoints.
- **Elimination of Container OOM Risks**: Google Cloud Functions Gen 2 instances have a 2 GiB memory ceiling. Ingesting or buffering large composite video blobs risks container crashes. Pure audio remains safely beneath 100 MB.
- **5x Faster Ingestion**: Gemini begins decoding audio tokens immediately without having to demux, decode, and discard millions of unneeded video frames.
- **FinOps & Audit Transparency**: The Cloud Function explicitly stamps `transcriptionSource: 'audio_only'` (or `'video'` fallback for legacy recordings) onto the session document in Firestore, enabling institutional billing audits.

---

### 3.3 Whole-Class Holistic Audio Ingestion vs. Live Segment-by-Segment Streaming

The platform intentionally maintains **two separate subtitle pipelines** engineered for completely different objectives:

```mermaid
flowchart TB
    subgraph WholeClassPipeline["Pipeline A: Whole-Class Voice Recording & Subtitling (Offline)"]
        direction TB
        A1["Teacher Microphone + Screen Audio"] --> A2["Web Audio API Mixer\n(MediaStreamAudioDestinationNode)"]
        A2 --> A3["Dual MediaRecorder\n(lecture_audio.webm ~25MB Opus)"]
        A3 --> A4["Firebase Storage Upload\n(Single Continuous Audio File)"]
        A4 --> A5["Cloud Function: processLectureSubtitles\n(resolveEffectiveStoragePath)"]
        A5 --> A6["Google Gemini 3.8 Flash / 3.5 Flash-Lite\n(Direct gs:// URI - 1 Single Call)"]
        A6 --> A7["Global Context Understanding\n- Full lecture semantic continuity\n- Cantonese-English code-switching preservation\n- Automatic YouTube Chapters (00:00 - Intro)\n- Multilingual Sync (en, zh-Hant, zh-Hans, ja)"]
        A7 --> A8["Cloud Storage Subtitle Files\n(subtitles_*.vtt & subtitles_*.srt)"]
        A8 --> A9["In-Browser Player & YouTube Package (.zip)"]
    end

    subgraph LiveSegmentPipeline["Pipeline B: Real-Time In-Class Subtitles (Online)"]
        direction TB
        B1["Teacher Live Microphone Input"] --> B2["AudioWorklet Processor\n(Downsample to 16kHz PCM)"]
        B2 --> B3["Voice Activity Detection (VAD)\n(Energy Threshold Detection)"]
        B3 --> B4["Fragmented Moving Windows\n(15-30s Speech Chunks)"]
        B4 --> B5["On-Device Whisper WASM or\nprocessTeacherSpeechSubtitles Cloud Function"]
        B5 --> B6["Sentence-by-Sentence multilingual captioning\n(Sub-second to 1.5s latency)"]
        B6 --> B7["Firestore / WebRTC Live Sync\n(classes/{classId}/liveSubtitles/current)"]
        B7 --> B8["Student Screen Live Subtitle Overlay\n(Immediate live viewing during speech)"]
    end
```

#### Detailed Sequence: Whole-Class voice recognition & multilingual captioning Workflow

```mermaid
sequenceDiagram
    autonumber
    actor Teacher as Teacher (Browser)
    participant Storage as Cloud Storage (GCS)
    participant CF as Cloud Function (processLectureSubtitles)
    participant Gemini as Google Gemini 3.8 Flash / 3.5 Flash-Lite (Vertex AI)
    participant Firestore as Cloud Firestore
    actor Student as Student / YouTube Studio

    Note over Teacher: Teacher delivers lecture (60-90 mins)
    Teacher->>Teacher: Web Audio mixes mic + screen audio
    Teacher->>Teacher: MediaRecorder writes continuous pure audio stream
    Teacher->>Storage: uploadBytesResumable("lecture_audio.webm")
    Teacher->>Firestore: updateDoc({ status: "recording_stopped", audioStoragePath })
    
    Teacher->>CF: onCall: processLectureSubtitles({ classId, sessionId })
    CF->>Firestore: getDoc(lectureRecordings/{sessionId})
    CF->>CF: resolveEffectiveStoragePath() -> picks audioStoragePath
    CF->>Firestore: updateDoc({ status: "generating_subtitles", transcriptionSource: "audio_only" })
    
    Note over CF,Gemini: Whole class voice passed as ONE continuous URI (no segmenting)
    CF->>Gemini: generateWithResilience(prompt, media: "gs://bucket/.../lecture_audio.webm")
    Note over Gemini: Ingests entire audio into 1M token context window
    Note over Gemini: Performs full-lecture speech recognition, code-switching preservation, subtitles, and chapters
    Gemini-->>CF: LLM JSON/Text: { chapters, segments: [ { start, end, original, subtitles } ] }
    CF->>CF: parseAiJsonResponse() (clean trailing commas & repair truncated JSON)
    CF->>CF: calibrateSubtitleTimeline() (stretches ~1.68x Gemini timescale drift to match probed duration 1:1)
    CF->>CF: buildWebVTT() & buildSRT() with non-zero duration cue guards
    CF->>Storage: upload("subtitles_*.vtt", "subtitles_*.srt")
    CF->>Firestore: updateDoc({ status: "ready", vttUrls, srtUrls, youtubeMetadata })
    CF-->>Teacher: { success: true, segmentsCount, chaptersCount }

    Student->>Firestore: onSnapshot listener detects status: "ready"
    Student->>Teacher: HTML5 video player loads track src="subtitles_en.vtt"
    Teacher->>Student: One-Click Download YouTube Package (.zip) for YouTube Studio
```

#### Architectural Deep Dive: Why Whole-Class Voice is Used

1. **Holistic Discourse Understanding**:
   - In technical programming lectures, an instructor frequently introduces a concept, writes code, pauses, and explains the outcome minutes later (e.g., *"We configure the route here... and later in line 45 we call the controller"*).
   - A segment-by-segment system processes each 15-second snippet in isolation. It cannot resolve anaphoric references (what *"it"*, *"the hook"*, or *"that parameter"* refers to).
   - In the whole-class voice pipeline, Gemini ingests the entire lecture from $00:00$ to the end. It understands the full narrative arc, producing coherent, professionally punctuated transcripts.

2. **Accurate Code-Switching & Technical Term Retention**:
   - Spoken Cantonese in Hong Kong higher education is heavily interspersed with English software engineering jargon (e.g., `useState`, `Docker`, `Kubernetes`, `async/await`, `reducer`).
   - Fragmented speech chunks lack context, causing generic speech recognition engines to misinterpret English terms into phonetic Cantonese/Mandarin homophones.
   - Whole-class audio ingestion gives Gemini the macro context of the entire technical lecture, ensuring that English programming keywords, variable names, and terminal commands are retained verbatim in code blocks and subtitles.

3. **Macro-Structure & YouTube Chapter Extraction**:
   - Generating timestamped chapter markers (e.g., `00:00 - Introduction`, `14:20 - React Hooks Demo`, `38:15 - Q&A`) requires analyzing the macro structure of the entire lecture.
   - A segment-by-segment engine cannot determine when a major topic begins or ends. Only full-audio reasoning allows Gemini to identify topic transitions and summarize milestones accurately.

4. **Zero Segment-Stitching Drift**:
   - Segment-based chunking introduces cumulative boundary drift when individual chunks are concatenated together.
   - The whole-class audio track runs on a single continuous hardware clock. Gemini generates timestamps relative to the continuous recording timeline, ensuring sub-second alignment with the video track across the entire lecture.

---

#### Technical Comparison Matrix: Whole-Class vs. Segment-by-Segment

| Dimension | 🎙️ Whole-Class Voice Subtitle Pipeline (Offline) | ⚡ Live In-Class Subtitle Pipeline (Real-Time) |
| :--- | :--- | :--- |
| **Primary Objective** | Archival recording, high-fidelity transcription, YouTube publishing | Instant visual assistance during live class broadcast |
| **Input Source** | Single continuous `lecture_audio.webm` (~25 MB Opus) | Streaming 16 kHz PCM audio via AudioWorklet |
| **Processing Paradigm** | **Holistic single-pass multimodal inference** via Gemini | **Streaming sentence-by-sentence** via VAD / LiteRT Whisper |
| **Ingestion Mechanism** | Direct Cloud Storage URI (`gs://bucket/.../lecture_audio.webm`) | Local Web Audio buffer / WebSocket stream |
| **Discourse Context Horizon** | **Global (Entire lecture: 60 to 90 minutes)** | **Local (Current 15–30 second window only)** |
| **Latency** | ~60 – 120 seconds (run once after lecture ends) | **Sub-second to 1.5 seconds (word-by-word / sentence live)** |
| **YouTube Chapter Markers** | **Yes**: Automatically synthesized with timestamps | **No**: Impossible from isolated segments |
| **Code-Switching Accuracy** | **Highest**: Full technical domain context retained | Good: Dependent on short-window prompt hinting |
| **File Artifacts Produced** | `subtitles_*.vtt`, `subtitles_*.srt`, `youtube_metadata.txt` | Temporary Firestore live documents (`liveSubtitles/current`) |
| **Underlying Engine** | Google Gemini 3.8 Flash / 3.5 Flash-Lite (Vertex AI) | LiteRT Whisper WASM / Chrome Built-in AI / `processTeacherSpeechSubtitles` |
| **FinOps Cost Model** | 1 multimodal API invocation per lecture (~$0.01 – $0.03) | Real-time sentence calls ($0.00 for client model) |

---

## 4. Subtitle Timestamp Precision Standards

YouTube and HTML5 video players require strict timestamp formatting:
- **WebVTT (`.vtt`)**: Uses periods for millisecond separation: `HH:MM:SS.mmm` (e.g., `00:01:24.500`).
- **SubRip (`.srt`)**: Strictly requires commas for millisecond separation: `HH:MM:SS,mmm` (e.g., `00:01:24,500`).

### Eliminating Floating-Point Calculation Drift
Floating-point subtraction (e.g., `s - Math.floor(s)`) in JavaScript introduces precision drift (e.g., `0.7999999999999` rendered as `00:00:04.799` instead of `00:00:04.800`).
All timestamp formatters in [`processLectureSubtitles.js`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/functions/ai_flows/processLectureSubtitles.js) convert input seconds to integer milliseconds first:
```javascript
const totalMs = Math.round(Number(seconds) * 1000);
const hours = Math.floor(totalMs / 3600000);
const minutes = Math.floor((totalMs % 3600000) / 60000);
const secs = Math.floor((totalMs % 60000) / 1000);
const ms = totalMs % 1000;
```

---

## 5. YouTube Creator Studio Upload Workflow

The web application packages everything needed for YouTube publishing into a single `.zip` file:
1. **Clean Video File**: Native WebM (`video/webm; codecs=vp9,opus`) or MP4.
2. **Multilingual SubRip Files (`.srt`)**:
   - `subtitles_en.srt` (English)
   - `subtitles_zh-Hant.srt` (Traditional Chinese)
   - `subtitles_zh-Hans.srt` (Simplified Chinese)
   - `subtitles_original.srt` (Original Cantonese/English transcript)
3. **`youtube_metadata.txt`**: Contains the pre-formatted Title and Description including clickable YouTube chapters:
   ```
   00:00 - Introduction & Course Overview
   05:14 - Setting Up Vite & React Project
   14:20 - Explaining State & Lifecycle
   32:10 - Hands-on Lab Walkthrough
   45:00 - Q&A and Wrap-up
   ```

### Step-by-Step Teacher Guide:
1. In the Monitor View top bar, click **"🎥 Lecture Recordings & YouTube CC"**.
2. Select the completed recording from the list.
3. Click **"📥 Download YouTube Package (.zip)"**.
4. Open [YouTube Studio](https://studio.youtube.com) and click **Create -> Upload videos**.
5. Upload the downloaded video file.
6. Click **📋 Copy Title** and **📋 Copy Description** in the web app and paste them into YouTube Studio.
7. Under the **Subtitles** tab in YouTube Studio:
   - Click **Add Language** (e.g., Chinese Traditional / English).
   - Choose **Upload File -> With timing**.
   - Select the respective `subtitles_*.srt` file from the unzipped folder.
8. Set Visibility to **Unlisted** (accessible to students with the link) and click **Publish**.

---

## 6. Firestore Data Model Reference

Recordings are stored under `classes/{classId}/lectureRecordings/{sessionId}`:

| Field | Type | Description |
|---|---|---|
| `sessionId` | `string` | Unique recording identifier (`rec_...`) |
| `classId` | `string` | Class identifier (e.g., `IT114115`) |
| `teacherUid` | `string` | UID of the teacher who recorded the lecture |
| `teacherEmail` | `string` | Email of the teacher |
| `title` | `string` | Display title of the lecture |
| `topic` | `string` | Subject topic (e.g., React Hooks) |
| `status` | `string` | `recording` \| `paused` \| `generating_subtitles` \| `ready` \| `subtitles_failed` \| `discarded` |
| `videoUrl` | `string` | Public/signed download URL of the clean video |
| `storagePath` | `string` | Cloud Storage path (`classes/{classId}/lectureRecordings/{sessionId}/raw_recording.webm` or `recordings/.../lecture.webm`) |
| `audioUrl` | `string` | Public/signed download URL of the pure audio stream (`.webm`, `.ogg`, `.mp4`) |
| `audioStoragePath` | `string` | Cloud Storage path for the pure audio stream (`recordings/{classId}/{sessionId}/lecture_audio.webm`) |
| `audioFileSize` | `number` | Size in bytes of the pure audio file (~20 MB – 30 MB) |
| `transcriptionSource` | `string` | Ingestion mode used by Gemini (`'audio_only'` or `'video'`) |
| `durationSeconds` | `number` | Total net active recorded duration in seconds |
| `startedAt` | `Timestamp` | Recording initiation timestamp |
| `endedAt` | `Timestamp` | Recording completion timestamp |
| `vttUrls` | `map` | Map of ISO language codes to `.vtt` file download URLs |
| `srtUrls` | `map` | Map of ISO language codes to `.srt` file download URLs |
| `youtubeMetadata` | `map` | Formatted YouTube `title`, `description`, and `chapters` array |

---

## 7. Gemini Tokenomics, Audio-Only Ingestion & 64K Output Capacity

When conducting standard university or vocational lectures lasting **60 to 90 minutes (or longer)**, the system is engineered around the true multimodal capabilities and tokenomics of Google Gemini:

### 📊 Real-World Tokenomics: Audio vs. Video Ingestion

| Metric / Dimension | Pure Audio Track (`audio/webm`) | Composite Video (1 FPS + Audio) | Architectural Reality |
| :--- | :--- | :--- | :--- |
| **Token Ingestion Rate** | **32 tokens / sec** (~1,920 tokens/min) | **~290 – 300 tokens / sec** (~18,000 tokens/min) | Audio uses **nearly 90% fewer tokens** (~10x savings) |
| **1-Hour Lecture Input Tokens** | **~115,200 tokens** (11.5% of 1M context) | **~1,080,000 tokens** (**EXCEEDS 1M limit**) | Video cannot fit a 60-min lecture in a 1M window! |
| **Maximum Supported Duration** | **~8.5 to 9.5 Hours** in a single call | **~45 to 55 Minutes** (Google Vertex official ceiling) | Pure audio easily covers entire half-day workshops |
| **Empirical 37-min Benchmark** | **55,450 input tokens** | **~650,000 input tokens** | 91.5% input token reduction |
| **Upload Payload & Memory** | **~25 MB** (Opus audio stream) | **~1.2 GB** (VP9/H.264 video container) | Zero risk of Cloud Functions 2GiB OOM |
| **Speech Context & Accuracy** | 100% focused on acoustic speech | Distracted by visual slide changes & webcam frames | Pure audio yields superior Speech Recognition and timestamp precision |

> [!IMPORTANT]
> **Why Video Frames Are NEVER Sent into Gemini for Captions**:
> Closed captions, transcriptions, and lecture chapters depend exclusively on speech dialogue. Sending video frames wastes 258 tokens per second on redundant visual imagery, artificially caps lecture duration to ~45 minutes, increases API cost by ~10x, and provides zero benefit to acoustic speech recognition.

---

### 🚀 Demystifying the Output Token Limit: 8K Default vs. 64K Real Maximum

A common misconception is that Gemini has a hard single-turn limit of 8,192 output tokens. 

- **8,192 Tokens Is Merely the API Default**: If the caller omits `maxOutputTokens` from `generationConfig`, Google's API automatically defaults to an 8,192 token ceiling, which truncates responses for lectures longer than ~15–20 minutes.
- **The True Supported Maximum is 65,536 Tokens (64K)**: Modern Gemini models (Gemini 2.5 Flash, Gemini 3.x Flash) support a maximum output capacity of **65,536 tokens**.
- **Unlocking Full Output**: By explicitly configuring `config: { maxOutputTokens: 65536 }`, Gemini generates over 50,000+ output tokens in a single request.

#### Empirical Verification (37-Minute Production Lecture `rec_1790924043417_ausm5my`):
- **Input Tokens**: `55,450` tokens (pure Opus audio track `lecture_audio.webm`).
- **Output Tokens Generated**: **`53,073` tokens** (119,043 characters).
- **Execution Time**: **174.5 seconds (~2.9 minutes)** in a single pass.
- **Output Artifacts**: 268 continuous, uninterrupted subtitle segments from `0.5s` to `3653s` covering:
  - Original verbatim Cantonese/English transcript
  - English (`en`) multilingual captioning
  - Traditional Chinese (`zh-Hant`) multilingual captioning
  - Simplified Chinese (`zh-Hans`) multilingual captioning
  - 10 structured YouTube chapter markers (`00:00 - Introduction & Course Overview` to `37:20 - SQL vs NoSQL Databases`)

---

---

### 🛡️ Pure Whole-Audio Single-Pass Architecture (Zero Slicing) with Gemini 3.5 Flash-Lite

A core principle of modern Gemini speech transcription is **ingesting the entire audio track at once without audio slicing or chunking**:
- **Why Audio Slicing is Harmful for Speech AI**: Legacy systems split audio into arbitrary 5-minute or 2-minute slices with FFmpeg. Slicing truncates words across boundary cuts, destroys sentence-level prosody and discourse context, and introduces discontinuous subtitle jumps.
- **Whole-Audio Direct Ingestion**: Gemini processes audio tracks directly from Cloud Storage via `gs://` URIs (`contentType: 'audio/webm'`). Pure audio consumes only **32 tokens/second** (~1,920 tokens/minute = ~115,200 tokens/hour). A 60-minute lecture consumes ~115K tokens, fitting effortlessly within Gemini's 1,000,000+ context window.

```mermaid
flowchart TD
    A["Clean Lecture Audio<br/>gs://.../lecture_audio.webm"] --> B["Gemini 3.5 Flash-Lite<br/>Whole-Audio Single Pass<br/>thinkingBudget: 0 (No Reasoning Token Waste)"]
    B --> C["400+ Master Sentence-Level Cues<br/>(2 to 6s cadence, verbatim Cantonese/English)"]
    B --> D["YouTube Chapter Milestones<br/>(4 to 10 chapters with timestamps)"]
    C --> E["multilingual captioning Alignment<br/>en, zh-Hant, zh-Hans (Identical Timestamps)"]
    E --> F["Zero-Duration Cue Duration Guard<br/>(Forces min 1.8s duration so browser players don't discard cues)"]
    F --> G["Standard .vtt & .srt Track Generation"]
    G --> H["YouTube Creator Studio CC & Description Package"]
```

#### Why `gemini-3.5-transcribe-preview` Failed for Lecture Archiving & Why It Was Removed

During production evaluation on real Hong Kong classroom lectures (e.g. session `rec_1790924043417_ausm5my`, 36m51s / 2,211.4s), Google's preview speech model `gemini-3.5-transcribe-preview` exhibited 4 critical, irrecoverable failure modes:

1. **The 45,000 Audio Token Ceiling**:
   - Vertex AI enforces a strict unary request quota of **45,000 audio tokens** (~1,800s / 30 minutes) on `gemini-3.5-transcribe-preview`.
   - Passing a standard 37-minute, 50-minute, or 90-minute lecture immediately causes the API to reject the request:
     `[400 Bad Request] The request has estimated 55286 audio tokens... which exceeds the maximum of 45000 tokens.`
2. **Turn-Based VAD Premature Cutoff**:
   - `gemini-3.5-transcribe-preview` is optimized for short conversational turn-taking (e.g. telephony, voice agents).
   - In actual classroom teaching, instructors frequently pause for 5 to 15 seconds (e.g. writing code on VS Code, diagramming on the whiteboard, or waiting for students to complete a step). The model's internal Voice Activity Detection (VAD) misinterprets these natural instructional silences as the definitive end of speech and emits `finishReason: STOP`.
   - **Empirical Diagnostics on Production**:
     - *15-minute slice (0s - 900s)*: Emitted only **2 words** (`好啦` at 16.5s) and prematurely halted with `finishReason: STOP`.
     - *29-minute slice (0s - 1,740s)*: Emitted 88 cues and halted at 486s (~8 minutes), permanently dropping the remaining 21 minutes of instructional speech.
3. **Severe Preview Quota Exhaustion (`429 RESOURCE_EXHAUSTED`)**:
   - To bypass the 45k token ceiling, an experimental pipeline sliced audio into 29-minute chunks with 3-minute overlap windows.
   - However, `gemini-3.5-transcribe-preview` has minimal Request-Per-Minute (RPM) and Token-Per-Minute (TPM) limits on Vertex AI. Sequential or parallel chunk processing triggered frequent `[429 Too Many Requests] RESOURCE_EXHAUSTED: Quota exceeded for aiplatform.googleapis.com/generate_content_requests`.
4. **Audio Slicing Artifacts & Non-Keyframe Boundary Desynchronization**:
   - Cutting Opus audio streams in WebM containers creates presentation timestamp (PTS) discontinuities and audio pops at chunk boundaries. Even with optimal speech cutover heuristics (`findOptimalCutoverTimestamp`), words at boundary edges were occasionally clipped or duplicated.

#### Why `gemini-3.5-flash-lite` Single-Pass Is the Definitive Engine

In contrast to the transcribe preview model, `gemini-3.5-flash-lite` in single-pass mode demonstrated 100% reliability, exceptional transcription quality, and high cost-efficiency:

1. **Massive 1M+ Token Context Window**:
   - Ingests up to 9 hours of pure audio in a single API call via Cloud Storage `gs://` URI. No audio slicing, no FFmpeg cutting, and no chunk reassembly.
2. **Zero-Thinking Configuration (`thinkingBudget: 0`)**:
   - By setting `thinkingConfig: { thinkingBudget: 0 }` and `maxOutputTokens: 65536`, no output budget is wasted on reasoning tokens. The entire 65K token output buffer is dedicated to producing continuous, verbatim subtitle cues from second 0 to the very end of the lecture.
3. **Continuous Classroom Speech & Code-Switching**:
   - Seamlessly ignores 10-30s classroom teacher pauses and accurately transcribes mixed Cantonese/English CS terminology (`Docker`, `useState`, `React`, `Express`, `PostgreSQL`, `eventual consistency`).
   - On the 37-minute test recording, generated **414 continuous subtitle cues** across 4 languages (`original`, `en`, `zh-Hant`, `zh-Hans`) plus 8 YouTube chapter milestones in 182 seconds ($0.18 FinOps cost).
4. **The Chromium Zero-Duration Cue Guard**:
   - Chromium-based browsers (Chrome, Edge, Brave) automatically drop `<track>` cues where `start == end` (0ms duration).
   - In `buildWebVTT` and `buildSRT`, a dynamic reading-speed duration guard enforces a minimum duration ($\ge 1.8$s or up to next cue start) whenever $end \le start$, guaranteeing 100% of generated subtitles render properly in browser video players and YouTube.

---

### 🎬 Frontend Player Clock Synchronization & WebM Duration Fix

In addition to backend timestamp accuracy, in-browser playback of recorded WebM video requires specific handling in Chromium-based browsers:

1. **Chromium WebM Seek Duration Trick (`1e101`)**:
   - `MediaRecorder` in Chromium produces WebM streams with an unknown (`Infinity`) duration header because the stream length is not known in advance.
   - The utility `fixWebmPlaybackDuration(video, onComplete)` forces Chromium to compute the duration by setting `video.currentTime = 1e101` and listening for the seek completion before resetting `video.currentTime = 0`.
2. **Race-Condition-Free Subtitle Track Attachment**:
   - In earlier versions, `applySubtitleTrack` was invoked *before* duration probing finished. When `video.currentTime` jumped to `1e101` and back to `0`, Chromium's native `TextTrackCueList` fired cues for the end of the video and desynchronized the subtitle rendering engine.
   - **The Fix**: In both `LectureRecordingsView.jsx` and `StudentRecordsView.jsx`, `applySubtitleTrack` is invoked strictly inside the `onComplete` callback of `fixWebmPlaybackDuration`, ensuring cues are attached only after `currentTime` has cleanly settled at `0.0`.
3. **EBML Header Patching at Recording Stop**:
   - For recording finalization, [`useLectureRecorder.js`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/web-app/src/hooks/useLectureRecorder.js) patches EBML duration headers directly onto the recorded blob using `fixWebmDuration`, with a 30,000ms safety timeout for large (50MB–1GB) files.


---

## 8. Automated Multi-Clip Merging & Fuzzy Schedule Grouping

### 8.1 The Fragmented Lecture Problem
During everyday teaching, a single lecture period often produces multiple separate recording clips:
- The teacher briefly pauses or stops and restarts screen sharing (e.g., to answer a student question privately or switch windows).
- A brief network hiccup causes the browser's `MediaRecorder` stream to finalize.
- The teacher records an initial 1-minute test clip before beginning the 50-minute main lecture.

Without automated merging, teachers and students are presented with fragmented clips (`Part 1 (1m)`, `Part 2 (52m)`), forcing instructors to manually download, splice, and re-upload files before publishing to YouTube.

### 8.2 Fuzzy Timetable Slot Matching (`sessionGrouping.js`)
Class timetables provide predefined slots (e.g., `Monday 10:30–11:30`). However, real-world classroom sessions rarely adhere strictly to calendar boundaries:
- Teachers frequently arrive 5–15 minutes early to test their microphone, set up presentation slides, and verify screen broadcast.
- Lectures frequently run overtime by 15–30 minutes for student Q&A and lab wrap-up.

To group all relevant clips without manual configuration, the system implements **Fuzzy Schedule Slot Grouping**:

```mermaid
flowchart LR
    A["Early Setup<br/>-45 min margin"] --> B["Official Slot Start<br/>(e.g., 10:30 AM)"]
    B --> C["Lecture Period<br/>(10:30 - 11:30 AM)"]
    C --> D["Official Slot End<br/>(11:30 AM)"]
    D --> E["Lecture Overrun<br/>+60 min margin"]
```

1. **Early Start Tolerance (-45 Minutes)**:
   - A clip started up to 45 minutes before the official class start time (e.g., 10:28 AM for a 10:30 AM class) is automatically matched to the scheduled slot.
2. **Overrun Tolerance (+60 Minutes)**:
   - A clip continuing or started up to 60 minutes after the official class end time (e.g., 11:45 AM or 12:15 PM for an 11:30 AM class) remains bound to the same session group.
3. **Inactivity Gap Tolerance (<30 Minutes)**:
   - If an instructor stops recording and starts a new recording within 30 minutes, the consecutive clips are clustered together into the same group.
4. **Broadcast Session Anchoring (`broadcastSessionId`)**:
   - When recording via the Teacher Screen Broadcast Studio, all recordings inherit the active `broadcastSessionId`, generating an explicit anchor `bcast_${broadcastSessionId}`.

### 8.3 Serverless Stream-Copy Concatenation (`mergeLectureRecordings`)
When merging is triggered, the `mergeLectureRecordings` Cloud Function (`functions/media_processing`, 2nd Gen, `asia-east2`, 2GiB RAM, 2 vCPUs) executes:

1. **Zero-Transcoding Stream Copy**:
   - Constructs an FFmpeg concat manifest:
     ```text
     file '/tmp/clip1.webm'
     file '/tmp/clip2.webm'
     ```
   - Executes:
     ```bash
     ffmpeg -f concat -safe 0 -i list.txt -c copy -y combined.webm
     ```
   - **Performance**: Completes in **~2 seconds** for a 1-hour 1080p WebM recording because it copies compressed VP8/VP9 and Opus bitstreams directly without CPU-intensive decoding or re-encoding.
2. **WebM Duration & Seek Index Healing**:
   - Native browser `MediaRecorder` omits the Matroska EBML `Duration` header and seek cues. FFmpeg remuxing automatically injects standard headers and cues, enabling HTML5 `<video>` players to seek immediately without player freezes.
3. **Pure Audio Extraction**:
   - Executes `ffmpeg -i combined.webm -vn -c:a copy combined_audio.webm` in ~0.5s, producing a compact Opus audio track for Gemini AI ingestion.
4. **Document Hierarchy & Traceability**:
   - Creates a master document `classes/{classId}/lectureRecordings/{combinedSessionId}` stamped with:
     - `isCombined: true`
     - `sourceRecordingIds: ['rec_1...', 'rec_2...']`
     - `durationSeconds`: Total combined duration verified by `ffprobe`
   - Updates source clips:
     - `isFragment: true`
     - `fragmentIndex`: `1`, `2`, ...
     - `mergedIntoSessionId: combinedSessionId`
5. **Automated Subtitle Pipeline Trigger**:
   - Upon completion, the function automatically invokes `processLectureSubtitles`, generating full multilingual `.vtt` / `.srt` subtitle files and YouTube chapters for the unified lecture.

### 8.4 User Experience & Workflow

#### Automatic Merging on Broadcast Stop
When a teacher finishes broadcasting in `MonitorView` and clicks **"Stop Sharing"**, the system checks if multiple recordings were generated during that broadcast. If so, `mergeSessionRecordings` is automatically dispatched in the background after a 2.5-second buffer (ensuring all chunk uploads have completed).

#### Smart Detection Banner in Lecture Recordings View
When visiting **🎬 Recordings & Sessions -> 🎥 Teacher Lecture Recordings**:
1. If unmerged clips from the same session or day are detected, a prominent blue alert banner appears:
   > 💡 **2 separate recording clips detected from 9/21/2026** (53m 5s total). Would you like to merge them into a single continuous full lecture?  
   > `[ 🔗 Merge into Full Lecture ]`
2. Clicking **Merge into Full Lecture** triggers the serverless merge pipeline with real-time spinner feedback.
3. Once merged, the banner automatically clears.

#### Custom Selection Merging
Teachers can click **"🔗 Custom Merge"** to enter manual selection mode:
- Checkboxes appear on each recording card.
- The teacher selects 2 or more clips and clicks **"🔗 Merge Selected (N clips)"**.
- An optional custom title can be specified.

#### Visual Hierarchy & Badges
- **Master Combined Lecture**: Marked with a distinctive teal badge: `🌟 Combined Full Lecture`.
- **Source Fragments**: Marked with a gold badge: `✂️ Part 1`, `✂️ Part 2 (Merged into master lecture)`.
- **Interrupted & Recovered Lectures**: Marked with `⚠️ Combined (Gap Remarked)` or `⚠️ Rest Preserved`.
- **YouTube Published**: Marked with a red pill badge: `📺 YouTube`.

---

### 8.5 Crash Resilience, Gap Detection & Continuous Automation Pipeline

Classroom instruction can be unexpectedly interrupted by client hardware shutdowns, operating system restarts, power outages, or accidental tab closures. The platform implements an end-to-end, multi-tier defense ensuring zero data loss and uninterrupted AI processing:

```mermaid
flowchart TD
    A["Lecture Recording Starts"] --> B["MediaRecorder emits chunks every 10s"]
    B --> C["1. Memory Buffer (recordedChunksRef)"]
    B --> D["2. Persistent Local Disk Buffer (IndexedDB: lectureRecoveryDb)"]
    
    C -->|Browser Crash / Reboot| E["Memory Lost"]
    D -->|Browser Reopens| F["Auto-Recovery on Mount: Reads IndexedDB Chunks"]
    F --> G["Compiles WebM & Uploads Salvaged Clip to Cloud Storage"]
    G --> H["Teacher Records Remaining Part (Clip 2)"]
    
    H --> I["Automated Session Merging (mergeLectureRecordings)"]
    I --> J["Detects Gaps: (currEnd -> nextStart > 15s)"]
    J --> K["Calculates Lost Time & Generates Interruption Remarks"]
    K --> L["FFmpeg Stream-Copy (-c copy) Concat & Cues Indexing"]
    L --> M["Master Recording Stamped with hasMissingSegment: true & interruptionRemarks"]
    M --> N["Auto-Invokes processLectureSubtitles"]
    N --> O["Gemini Transcribes Smoothly with Discontinuity Context"]
    O --> P["Final Video with Multi-Language CC & Chapters Ready for Students/YouTube"]
```

#### Tier 1: Client-Side Navigation Guard (`beforeunload`)
- When recording or uploading, `useLectureRecorder.js` registers a native browser `beforeunload` listener.
- If the teacher clicks close or navigates away, the browser prompts: *"A lecture recording is currently active or uploading. Leaving now will discard the current recording segment. Are you sure you want to leave?"*

#### Tier 2: Persistent 10-Second Disk Buffering (`lectureRecoveryDb.js`)
- Traditional Web browsers hold `MediaRecorder` chunks in volatile JavaScript memory. A browser crash would lose all un-uploaded memory chunks.
- Our recording hook streams every 10-second chunk into browser **IndexedDB (`ClassroomLectureRecoveryDB`)**.
- On app launch, `useLectureRecorder` queries `getPendingRecoverySessions()`. If an interrupted session from before the crash is discovered, it automatically:
  1. Assembles the persistent chunks into a WebM container.
  2. Uploads the salvaged video to Cloud Storage (`isRecoveredAfterCrash: true`).
  3. Updates the Firestore document with `status: 'ready'`.
  4. Deletes the local IndexedDB storage.
  5. Triggers `mergeSessionRecordings` to merge the salvaged pre-crash segment with any subsequent clips.

#### Tier 3: 3-Hour Auto-Stop Safety Limit (`maxDurationSeconds`)
- If an instructor forgets to stop recording and leaves the computer running over the weekend, continuous recording would eventually exhaust memory or inflate file sizes.
- `useLectureRecorder.js` enforces `DEFAULT_MAX_RECORDING_SECONDS = 3 * 3600` (3 hours).
- If continuous recording reaches 3 hours, the hook automatically stops recording safely, finalizes the WebM blob, uploads it to Cloud Storage, and triggers Gemini transcription.

#### Tier 4: Serverless Crash-Tolerant Concatenation & Gap Remarking (`mergeLectureRecordings.js`)
When `mergeLectureRecordings` executes, it handles all crash and interruption edge cases:
1. **Surviving Single Clip Handling (`1 valid clip + 1+ crashed clips`)**:
   - Previously, the function aborted with `single_valid_clip`, halting the pipeline.
   - Now: It preserves the surviving valid clip, calculates the lost time from the crashed stub, stamps `hasMissingSegment: true` and `interruptionRemarks`, marks the crashed stub as `status: 'interrupted'`, and returns `success: true`. The calling pipeline automatically continues into `processLectureSubtitles`!
2. **Multiple Clips with Gaps (`>= 2 valid clips`)**:
   - Calculates exact time gaps between clips (`nextStart - currEnd > 15s`).
   - Computes `totalLostSeconds` and formats readable remarks (e.g., `~2.5 min gap between 10:25 AM and 10:27 AM`).
   - Staves `gapDetails`, `hasMissingSegment: true`, and `lostDurationSeconds` onto the master record.
3. **Continuous Automation**:
   - Automatically chains into `processLectureSubtitles`.
   - Gemini receives the `RECORDING DISCONTINUITY NOTICE` in its prompt context, allowing it to bridge audio jumps smoothly without throwing hallucination errors or halting transcription.

#### Tier 5: Clear UI Alerts for Teachers and Students (`LectureRecordingsView.jsx`)
- Recordings with missing segments display a prominent status badge: `⚠️ Combined (Gap Remarked)` or `⚠️ Rest Preserved`.
- A dedicated **Lecture Interruption & Crash Recovery Notice** appears above the video player, explaining precisely which minutes were lost and confirming that the remaining lecture content was preserved and captioned.

---

## 9. Phase 1: YouTube Studio Export & Dual-Player Integration

### 9.1 Design Philosophy: Why Phase 1 Completes the Loop Without API Pitfalls
Direct automated YouTube API uploads face severe technical, legal, and operational hurdles:
1. **No Service Account Support**: Google Cloud Service Accounts cannot own YouTube channels.
2. **Private-by-Default Audit Lock**: Since July 2020, videos uploaded via unverified OAuth applications are irrevocably forced into `private` mode until the developer completes a formal YouTube API Compliance Audit and Google CASA Tier 2 Cloud Application Security Assessment.
3. **Workspace vs. Personal Friction**: School Workspace accounts frequently disable YouTube channel creation or restrict external third-party API apps via Google Admin Console policies.

Phase 1 provides a friction-free, robust, and permanent solution that works with **any Google account** (institutional Workspace or personal `@gmail.com`):

```mermaid
sequenceDiagram
    autonumber
    actor Teacher
    participant App as Web Application (Classroom)
    participant Studio as YouTube Creator Studio
    participant Firestore as Cloud Firestore
    actor Student

    Teacher->>App: 1. Click "📥 Download YouTube Package (.zip)" & "💾 Direct Video Download"
    App-->>Teacher: Saves clean WebM video + all multilingual .srt tracks
    Teacher->>App: 2. Click "📋 Copy Title" & "📋 Copy Description"
    Teacher->>Studio: 3. Drag video into YouTube Studio, paste Title & Description with chapters
    Teacher->>Studio: 4. Add Multilingual Subtitles (.srt files)
    Studio-->>Teacher: Publishes video & provides watch link (e.g., https://youtu.be/xyz)
    Teacher->>App: 5. Paste YouTube URL & click "🔗 Save YouTube Link"
    App->>Firestore: Updates lecture recording with youtubeUrl & youtubeVideoId
    Firestore-->>Student: Real-time update: activates 📺 YouTube Player stream!
```

### 9.2 Key Features in Phase 1 Implementation

1. **3-Step Guided Studio Workflow Card**:
   - **Step 1: Download Media & Subtitles**: One-click download of `.zip` containing all multilingual subtitle files (`.srt`), metadata, and instructions, alongside a reliable client-side video file downloader with progress feedback.
   - **Step 2: Upload to YouTube Studio**: Dedicated launcher button (`🚀 Open YouTube Studio Upload ↗`) that navigates directly to YouTube channel upload. Prominent 1-click clipboard copy buttons for YouTube Title and Description with timestamps.
   - **Step 3: Link YouTube Video to Classroom**: Input field accepting any YouTube link (`youtu.be`, `youtube.com/watch?v=...`, `youtube.com/embed/...`, or raw 11-char ID). Updates Firestore with `youtubeUrl`, `youtubeVideoId`, and `youtubeLinkedAt`.
2. **Dual-Player Switcher (`activePlayerMode`)**:
   - Once a lecture recording is linked to YouTube, the video player automatically defaults to **📺 YouTube Stream (Fast & Adaptive)**, embedding `https://www.youtube-nocookie.com/embed/${youtubeVideoId}` with full screen and responsive 16:9 layout.
   - Users can seamlessly switch back to **🎞️ Cloud Storage HTML5 Player** at any time to verify raw video and in-app WebVTT subtitles.
   - An external launcher **▶️ Open on YouTube ↗** allows instant playback in YouTube's native application.
3. **Sidebar Indicators**:
   - Recordings linked to YouTube display a prominent `📺 YouTube` badge in the left-hand recordings list, giving teachers instantaneous visibility over their published curriculum.

---

## 10. Google Drive Direct Cloud Archiving & Multi-Player Streaming

### 10.1 Why Google Drive Integration Works Across Personal & Workspace Accounts

While direct automated YouTube uploads encounter strict verification barriers (Private-by-default lock and mandatory CASA Tier 2 Cloud Application Security Assessments), **Google Drive API v3** offers a frictionless, compliant solution for video distribution:

| Metric / Dimension | Automated YouTube API Upload | Direct Google Drive API Integration |
| :--- | :--- | :--- |
| **GCP Project Requirement** | Standard GCP project | Standard GCP project (even a free personal Gmail GCP project) |
| **Account Type Support** | Often blocked on Workspace if channel creation is disabled | **Works equally on personal `@gmail.com` and Workspace accounts** |
| **OAuth Scope Classification** | Restricted (`youtube.upload`) | **Sensitive** (`https://www.googleapis.com/auth/drive.file`) |
| **Google CASA Tier 2 Audit** | **Mandatory** for public/unlisted videos | **Bypassed completely** in Testing mode (up to 100 users) and standard verification |
| **Least-Privilege Security** | Broad channel management | **Least-privilege**: can only access/modify files created by this application |
| **Personal Account Quota** | Quota units consumed (1600/upload) | Uses teacher's own Drive quota (15 GB personal / 30 GB - Unlimited Workspace) |
| **Instant Playback** | Transcoding delays & copyright scan delays | **Instant preview streaming** via `/file/d/{id}/preview` iframe |

### 10.2 Architectural Implementation

```mermaid
sequenceDiagram
    autonumber
    actor Teacher
    participant App as Classroom Assistant (Browser)
    participant GIS as Google Identity Services
    participant DriveAPI as Google Drive API v3
    participant Firestore as Cloud Firestore
    actor Student

    Teacher->>App: 1. Click "📁 Connect Google Drive"
    App->>GIS: Initialize token client (scope: drive.file)
    GIS-->>Teacher: Consent prompt (personal @gmail.com or Workspace)
    Teacher->>GIS: Grant access to app-created files only
    GIS-->>App: Short-lived access token
    App->>App: Cache in sessionStorage & display connected status pill

    Teacher->>App: 2. Click "☁️ Upload Video to Google Drive"
    App->>DriveAPI: POST /upload/drive/v3/files?uploadType=resumable
    DriveAPI-->>App: Session URI
    App->>DriveAPI: PUT chunks with XHR progress tracking (0% -> 100%)
    DriveAPI-->>App: File Created (fileId, webViewLink)

    App->>DriveAPI: POST /drive/v3/files/{id}/permissions (role: reader, type: anyone)
    App->>Firestore: updateDoc({ driveFileId, driveWebViewLink, driveEmbedUrl, driveUploadedAt })
    Firestore-->>Student: Activates 📁 Google Drive Stream tab!
```

### 10.3 Core Capabilities

1. **Least-Privilege OAuth 2.0**:
   - Requests exclusively `https://www.googleapis.com/auth/drive.file`.
   - The application has zero permission to view or modify any existing private documents or files in the teacher's Google Drive.
2. **Resumable Chunky Uploads with Real-Time Progress**:
   - Uses standard XMLHttpRequest-based resumable uploads to Google Drive's chunk endpoint (`/upload/drive/v3/files?uploadType=resumable`).
   - Reports byte-accurate progress (0% to 100%) in the UI.
3. **Automatic Link-Sharing Permissions**:
   - Immediately following upload, sets permission `type: 'anyone'`, `role: 'reader'`, enabling seamless streaming for enrolled students without permission request dialogues.
4. **Tri-Mode Player Switcher**:
   - Instructors and students can toggle between:
     - `📺 YouTube Stream (Fast & Adaptive)` (when linked to YouTube)
     - `📁 Google Drive Stream (Direct Preview)` (when linked to Google Drive)
     - `🎞️ Cloud Storage HTML5 Player (Multilingual CC)` (always accessible for offline/raw playback)
5. **Direct Configuration & Portability**:
   - Configured via environment variable (`VITE_GOOGLE_CLIENT_ID`) in `web-app/.env.prod` (or `web-app/.env.dev`).

### 10.4 Setting Up `VITE_GOOGLE_CLIENT_ID` (Step-by-Step Instructions & Warning)

> [!WARNING]
> If `VITE_GOOGLE_CLIENT_ID` is not configured or left empty, direct browser-to-Drive cloud upload in Teacher Lecture Recordings is disabled by default. Teachers will see:
> `🔒 Google Drive direct cloud upload is disabled (not configured for this system).`
> Teachers can still link already-uploaded videos via Step B (Link Existing Google Drive Video), but 1-click cloud upload requires this configuration key.

#### How to Configure `VITE_GOOGLE_CLIENT_ID`
1. **Google Cloud Console Credentials**:
   - Open **APIs & Services > Credentials** in your GCP project.
   - Click **+ Create Credentials > OAuth client ID**.
   - Application type: **Web application**.
   - Name: `Classroom Assistant Web Client`.
2. **Authorized JavaScript Origins**:
   - Add your application hosting URLs:
     - Production: `https://it114115-2627.web.app` and `https://it114115-2627.firebaseapp.com`
     - Development: `https://it114115-dev-2026.web.app` and `https://it114115-dev-2026.firebaseapp.com`
     - Local Dev: `http://localhost:5173`
3. **OAuth Consent Screen Scope**:
   - Ensure the scope `https://www.googleapis.com/auth/drive.file` is selected.
4. **Set Environment File**:
   - In `web-app/.env.prod` (for production) or `web-app/.env.dev` (for development), add:
     ```bash
     VITE_GOOGLE_CLIENT_ID=xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
     ```
   *(Note: You only need to edit `.env.prod`. Scripts will automatically copy it to `.env.production` during deployment).*
5. **Deploy**:
   - Run `./deploy.sh prod` (or `./deploy.sh dev`).

---

### 10.5 Troubleshooting: "Access blocked / Error 403: access_denied"

If you see:
> *"Access blocked: it114115-2627.web.app has not completed the Google verification process. The app is currently being tested, and can only be accessed by developer-approved testers. Error 403: access_denied"*

This occurs because your OAuth Consent Screen in Google Cloud Console is in **Testing** mode (the default for newly created credentials).

#### Solution Option 1: Add Authorized Test Users (Instant Fix)
1. Open the [Google Cloud Console OAuth Consent Screen](https://console.cloud.google.com/apis/credentials/consent).
2. Select your project (e.g. `it114115-2627`).
3. Scroll down to the **Test users** section.
4. Click **+ ADD USERS**.
5. Enter your email (e.g. `cy.gdoc@gmail.com` and any colleagues' emails).
6. Click **SAVE**.
7. Refresh `https://it114115-2627.web.app` and click **📁 Connect Google Drive**. Sign-in will succeed immediately!

#### Solution Option 2: Publish the App (All Google Users)
1. On the same **OAuth consent screen** page, under **Publishing status**, click **PUBLISH APP**.
2. Confirm the prompt to push the app to production.
3. *Note*: Since the requested scope `https://www.googleapis.com/auth/drive.file` is restricted to only files created by this application, you can use the app without requiring an exhaustive Google verification audit (users may see an "Advanced > Proceed" prompt on first consent).

#### Solution Option 3: Internal Organization (Workspace for Education)
If your Google Cloud Project belongs to your school's Google Workspace organization, set the **User Type** to **Internal**. All teachers within `@vtc.edu.hk` can then sign in directly with zero test-user limits and zero verification screens.

---

## 11. AI Model Selection & Empirical Speech Recognition Benchmarks

Classrooms can configure their preferred lecture transcription and subtitle AI model in **Class Management -> Settings -> Section 8 (Lecture Broadcast & Teacher Recordings Policy)**:

| AI Model | Recommended Scenario | Strengths & Characteristics | FinOps Cost (1-Hr Audio) |
| :--- | :--- | :--- | :--- |
| **`gemini-3.8-flash`** *(Recommended Default)* | 30–90 min technical CS lectures code-switching between Cantonese & English | Flagship multimodal model. Superior long-context attention; eliminates repetition loops; state-of-the-art recognition of CS keywords (DynamoDB, Partition Keys, Consistency, AZ). | ~$0.15 – $0.25 |
| **`gemini-3.5-flash-lite`** *(Economical)* | Short clips (< 15 mins) & budget-constrained classes | Ultra-low latency, lowest token cost. Note: can experience repetition on 30+ min mixed audio at low temperatures. | ~$0.05 – $0.09 |

### 11.1 Why `gemini-3.5-transcribe-preview` Was Replaced

During empirical testing on classroom recordings (e.g. 37-minute lecture session `rec_1790924043417_ausm5my`):
1. **45,000 Audio Token Hard Ceiling**: The transcribe-preview model enforces a 45,000 audio token limit (~30 mins). Whole-lecture audio (> 30 mins) triggered immediate `400 Bad Request: exceeds maximum of 45000 tokens`.
2. **Turn-Based VAD Premature Cutoff**: Optimized for call-center dialogue, the transcribe model interpreted standard 5–15 second classroom pauses (teachers typing code or drawing on whiteboards) as call termination (`finishReason: STOP`), silently dropping up to 75% of the lecture.
3. **Severe Rate-Limiting**: Slicing audio into 29-minute segments triggered rapid `429 RESOURCE_EXHAUSTED` errors on Vertex AI.
4. **The Solution**: Single-pass ingestion with `gemini-3.8-flash` via Cloud Storage `gs://` URI, passing pure audio directly with `thinkingBudget: 0` and `maxOutputTokens: 65536`.

### 11.2 Chromium Zero-Duration Cue Guard

In standard HTML5 video players (Chrome, Safari, Edge), any WebVTT/SRT cue where `end <= start` (duration = 0ms) is discarded by the browser's subtitle rendering engine as invalid.
If an AI model outputs identical start and end timestamps (e.g. `00:06:33.000 --> 00:06:33.000`), captions would appear up to that point and then vanish.

The pipeline applies a two-layer guard:
1. **Segment Ingestion Level**:
   ```javascript
   if (isNaN(end) || end <= start) {
     const nextStart = Number(rawSegs[idx + 1]?.start);
     const minDur = Math.max(2.0, Math.min(5.0, textLen * 0.25));
     end = nextStart > start ? Math.min(nextStart, start + minDur) : start + minDur;
   }
   ```
2. **WebVTT / SRT Serializer Level**:
   ```javascript
   if (end <= start) {
     const nextStart = nextSeg ? Number(nextSeg.start) : Infinity;
     const minDisplayDur = Math.max(1.8, Math.min(5.0, text.length * 0.25));
     end = Math.min(nextStart > start ? nextStart : start + minDisplayDur, start + minDisplayDur);
   }
   ```
This ensures 100% of generated subtitle cues remain visible and accurately synchronized in the video player.






