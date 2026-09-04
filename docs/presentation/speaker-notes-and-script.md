# ISATE 2026 Presentation Masterclass Script & Speaker Notes
## Gemini AI Classroom Assistant & Multimodal Invigilator
**Presenter:** Cyrus Wong (黃俊彥) — Senior Lecturer, HKIIT / VTC Hong Kong  
**Venue:** International Symposium on Advances in Technology Education (ISATE 2026), NIT Kisarazu College, Chiba, Japan  
**Session Length:** 60 Minutes (Tech Talk Masterclass + Live Demo + Q&A)

---

## Master Session Timeline (60 Minutes)

| Timeline | Act | Focus & Topic | Slides |
| :--- | :--- | :--- | :--- |
| **00:00 – 06:00** | **Act I** | Introduction, Cyrus Wong Bio (Triple Cloud), The Assessment Crisis | Slides 1–4 |
| **06:00 – 18:00** | **Act II** | 4-Tier Hybrid Cloud Architecture, Cloud Functions Gen 2, Single-Stream Firestore | Slides 5–7 |
| **18:00 – 30:00** | **Act III** | AI Engineering: Gemini 3 Suite Routing, Genkit Tool-Calling & Production Prompts | Slides 8–10 |
| **30:00 – 42:00** | **Act IV** | Edge-First AI: 468-Point Mesh Iris Geometry, LiteRT Whisper & Gemma, Cloud Diarization | Slides 11–14 |
| **42:00 – 52:00** | **Act V** | Teacher Command Center, WebRTC Streaming, FinOps ($0.85/exam), Incident Dossier | Slides 15–20 |
| **52:00 – 57:00** | **Act VI** | Live Interactive System Demonstration (5-Stage Verification Flow) | Slide 21 |
| **57:00 – 60:00** | **Act VI** | Summary, Open-Source Access, Collaborative Research & Q&A | Slide 22 |

---

## Detailed Minute-by-Minute Script & Presenter Talking Points

### 00:00 – 03:00 | Slide 1: Title & Opening Vision
*Visual: `slide_hero_classroom_ai.png`*

> **Cyrus Wong:**  
> "Good morning, distinguished delegates, professors from KOSEN colleges across Japan, esteemed colleagues from Singapore Polytechnics, and fellow technology educators from Hong Kong. Welcome to this masterclass session on the **Gemini AI Classroom Assistant and Multimodal Invigilator**.
>
> In vocational and technology education, our defining metric is practical capability. We train engineers, software developers, and cloud architects. But today, computing education faces an unprecedented existential challenge: how do we conduct honest, rigorous coding examinations in an era where generative AI can write code in milliseconds?
>
> Over the past year at the Hong Kong Institute of Information Technology (HKIIT), part of the Vocational Training Council (VTC), we designed and engineered an open-source, edge-first classroom AI assistant. By marrying Google's latest Gemini 3 model suite with browser-native WebAssembly machine learning, we achieved an invigilation and classroom monitoring platform that delivers total privacy preservation and slashes institutional cloud operational costs to **less than two cents per student per exam**.
>
> Let us dive into how we built this system."

---

### 03:00 – 06:00 | Slide 2: Speaker Biography
*Visual: `slide_speaker_bio_triple_cloud.png`*

> **Cyrus Wong:**  
> "Before we unpack the architecture, allow me to introduce myself. I am Cyrus Wong, Senior Lecturer at HKIIT, VTC Hong Kong, and Program Leader for our Higher Diploma in Cloud and Data Centre Administration.
>
> My passion has always been bridging real-world industrial cloud engineering with vocational classroom pedagogy. Over the years, I have been deeply engaged with the global developer community. I am honored to be recognized across the three primary hyperscale cloud ecosystems:
> - As a **Google Developer Expert (GDE)** for Google Cloud Platform and AI/Machine Learning.
> - As an **AWS AI Hero**, a community I have been part of since 2016, as well as serving as the first AWS Academy instructor globally.
> - As a **Microsoft MVP** in Azure AI.
>
> When you build educational technology across hundreds of vocational students every semester, you learn two inescapable truths: **simplicity is reliability**, and **licensing fees kill good ideas**. We cannot ask our institutions to pay hundreds of thousands of dollars for proprietary proctoring software. We must build solutions that are open, reproducible, and fiscally sustainable."

---

### 06:00 – 09:00 | Slide 3: The Assessment Trilemma in Technology Education
*Visual: `slide_assessment_trilemma.png`*

> **Cyrus Wong:**  
> "Let us examine the problem. In computer science and engineering education, every instructor is trapped in what I term **The Assessment Trilemma**:
>
> 1. **Academic Integrity:** Take-home coding assignments are essentially broken. With GitHub Copilot, Gemini, and ChatGPT, unsupervised students can produce flawless code without understanding a single line of memory management or recursion. In on-campus labs, students whisper, glance across screens, or secretly open secondary virtual desktops.
> 2. **Student Privacy & Trust:** The traditional industry response has been aggressive commercial surveillance. Students are forced to install intrusive desktop agents with kernel-level drivers that record their entire desktop, scan background processes, and upload unencrypted webcam feeds to overseas third-party servers. This breeds justified student outrage and severe GDPR and personal data privacy violations.
> 3. **Institutional Cost:** Commercial proctoring SaaS charges anywhere from $15 to $25 per student per examination. For a vocational institution with 10,000 students taking midterms and finals, that represents a quarter of a million dollars annually—an impossible recurring expense for public vocational colleges.
>
> The challenge we set ourselves was: **Can we achieve 100% Academic Integrity, 100% Student Privacy, and near-zero cost simultaneously?** The answer is yes, by shifting the paradigm from cloud surveillance to Edge AI."

---

### 09:00 – 12:00 | Slide 4: Paradigm Shift: Surveillance Spyware vs. Edge-AI Assistant
*Visual: `slide_proctoring_evolution.png`*

> **Cyrus Wong:**  
> "Look at this side-by-side comparison. On the left is legacy commercial proctoring. It behaves like malware: kernel-level rootkits, continuous video streaming that chokes campus Wi-Fi access points, and rigid, algorithmic black boxes that flag students for blinking or taking a sip of water.
>
> On the right is our Edge-AI Classroom Assistant:
> - **100% Browser Native:** Zero software installation. Students simply navigate to a Web URL. It runs in Chrome or Edge on Windows, macOS, Linux, and even budget Chromebooks.
> - **Privacy-by-Design:** 95%+ of the computer vision and speech recognition runs **locally inside the student's browser via WebAssembly and Web Workers**. Raw video feeds and audio waveforms *never* leave the student's machine unless an anomaly occurs.
> - **Human-in-the-Loop:** The AI does not fail or punish the student. It acts as an ambient co-pilot for the teacher, surfacing subtle attention drifts and allowing the instructor to intervene gently with a 1-click nudge.
> - **FinOps Optimization:** Total cloud infrastructure cost drops to **sub-$0.02 per student**."

---

### 12:00 – 16:00 | Slide 5: Act II: High-Level 4-Tier Hybrid Systems Architecture
*Visual: `slide_hybrid_architecture.png`*

> **Cyrus Wong:**  
> "Now let us delve into the cloud and edge engineering. On screen is our high-level architecture diagram. It is structured into four clearly separated horizontal tiers:
>
> 1. **Tier 1 — Student Browser Edge:** This is where the heavy lifting occurs. When a student enters an exam room, their browser activates three background Web Workers:
>    - A **MediaPipe FaceLandmarker Worker** analyzing webcam frames for 3D gaze and facial landmarks.
>    - A **LiteRT Whisper STT Worker** transcribing spoken audio locally in real-time.
>    - A **LiteRT Gemma 4 E2B Worker** classifying spoken intent.
> 2. **Tier 2 — Realtime Signaling:** We utilize Google Cloud Firestore and Cloud Storage. Instead of streaming continuous video, the browser emits compact JSON telemetry heartbeats every 5 seconds.
> 3. **Tier 3 — Cloud Intelligence & Serverless Backend:** Running on Google Cloud Run and Cloud Functions Gen 2 in region `asia-east2` (Hong Kong). When ambiguous anomalies occur, the backend invokes the Google Gemini 3 model suite to perform multi-speaker audio diarization and multimodal screen forensic audits.
> 4. **Tier 4 — Teacher Command Center:** A high-performance web dashboard giving the educator a live 50-student compliance grid, 1-click targeted nudge broadcasts, and on-demand 30 FPS peer-to-peer WebRTC video peeks."

---

### 16:00 – 19:00 | Slide 6: Google Cloud Run & Cloud Functions Gen 2 Topology
*Visual: `slide_cloud_functions_gen2.png`*

> **Cyrus Wong:**  
> "Let us look at how our backend is engineered on Google Cloud. Monolithic serverless architectures are notorious for cold-start delays and deployment blast radius. If you deploy an update to your audio analyzer, you should never risk taking down your student authentication.
>
> To solve this, we partitioned our backend into **7 isolated domain micro-codebases**, all deployed in Google Cloud's Hong Kong region (`asia-east2`) for single-digit millisecond latency across East Asia:
>
> 1. `ai_flows`: Genkit flows with Gemini 3.7 Flash and 3.5 Flash-Lite integration.
> 2. `attendance`: Class session lifecycle and aggregated student attendance rollups.
> 3. `auth_triggers`: RBAC claims injection, verifying teacher versus student roles upon sign-in.
> 4. `media_processing`: Containerized FFmpeg workers executing video compilation.
> 5. `property_processing`: High-throughput telemetry ingestion and boundary alerts.
> 6. `scheduled_tasks`: Declarative cron jobs managing TTL storage cleanups.
> 7. `storage_triggers`: Cloud Storage object finalize listeners that trigger automated asynchronous analysis.
>
> Each microservice has its own isolated `package.json`, dependencies, and deployment pipeline. A deployment in one never causes a cold-start cascade in another."

---

### 19:00 – 22:00 | Slide 7: High-Throughput Firestore Single-Stream Channel
*Visual: Code block & Architectural Callout on Slide 7*

> **Cyrus Wong:**  
> "Now let's examine a critical database engineering optimization that saved us thousands of dollars in Firestore billing.
>
> In a typical naive Firebase application, if you have 50 students in a class, each student laptop writes to `classes/{classId}/students/{studentId}`. The teacher dashboard subscribes to the entire `students` subcollection with an `onSnapshot` query.
>
> Do the math: 50 students writing every 5 seconds means 10 writes per second. The teacher dashboard receives 50 updates every 5 seconds. In a 2-hour exam, that single teacher dashboard triggers **72,000 Firestore document reads**! If you have multiple invigilators or multiple concurrent classes, you hit Firebase free tier limits in minutes and cause UI frame dropping.
>
> We replaced this with our **Single-Stream Aggregator Pattern**:
> - Student heartbeats are ingested through a lightweight Cloud Function that aggregates student states into an atomic map inside a single document: `classes/{classId}/status/current`.
> - The teacher dashboard listens to **one single document**.
> - As you can see in the code on screen from `useMonitorClass.js`, when a status snapshot arrives, the teacher's UI renders the entire 50-student grid atomically.
> - **Result:** Firestore read operations dropped by **98%**, completely eliminating database throttling and UI stutter."

---

### 22:00 – 25:00 | Slide 8: Act III: Google Gemini 3 Model Suite & Routing Strategy
*Visual: `slide_gemini_models_matrix.png`*

> **Cyrus Wong:**  
> "Let us look at AI engineering. In 2026, the hallmark of mature AI architecture is not using the largest possible model for every trivial task. It is **intelligent model routing**.
>
> We employ four distinct Google AI models across our stack:
>
> 1. **`gemini-3.7-flash` (Deep Multimodal Reasoning):** This is our heavy forensic auditor. We leverage its thinking budget capabilities for asynchronous end-of-exam auditing, where it inspects stitched 2-hour student screen videos and cross-references them with speech transcripts to generate formal academic integrity dossiers.
> 2. **`gemini-3.5-flash-lite` (Ultra Low Latency Workhorse):** Deployed for real-time Cloud Run function calls. When an anomalous screen capture needs inspection, flash-lite returns structured classifications in under 400 milliseconds at a tiny fraction of a cent.
> 3. **`gemini-3.5-transcribe-preview` (Long Audio Reasoning):** Deployed for classroom voice invigilation. It natively performs multi-speaker diarization, filters classroom HVAC and keyboard hum, and outputs word-level timestamps.
> 4. **`LiteRT Gemma 4 E2B` (On-Device Edge Proctor):** A specialized 2-billion parameter model running entirely within the student's browser via LiteRT WebAssembly. It operates at **$0 cloud cost** and ensures immediate real-time intent proctoring."

---

### 25:00 – 28:00 | Slide 9: Google Genkit Resilience & Autonomous Tool Calling
*Visual: `slide_genkit_resilience_flow.png`*

> **Cyrus Wong:**  
> "To orchestrate our cloud AI flows, we chose **Google Genkit**. Genkit provides end-to-end type safety, telemetry tracing, and native tool-calling capabilities.
>
> But in a high-stakes exam with hundreds of students, what happens if an upstream LLM API throws an HTTP 503 Service Unavailable or a 429 Rate Limit error?
>
> In our codebase (`functions/ai_flows/analysisFlows.js`), we engineered a dedicated **Resilience Interceptor**:
> - If an API error occurs, Genkit automatically initiates exponential backoff with full jitter over three attempts.
> - If the primary model (`gemini-3.7-flash`) remains saturated, the interceptor transparently falls back to `gemini-3.5-flash-lite`.
> - Once inference completes, Gemini does not just return raw markdown text. It executes structured tools defined with Zod schemas:
>   - `recordIrregularity`: Writes a timestamped event into the student's Firestore audit log.
>   - `sendMessageToStudent`: Emits an immediate toast alert to the student's screen.
>   - `recordAudioAudit`: Commits the diarized transcript and speaker metrics."

---

### 28:00 – 31:00 | Slide 10: Production Prompt Engineering: Strict Schemas & Tools
*Visual: Production Prompt Excerpts on Slide 10*

> **Cyrus Wong:**  
> "Let us look at our actual production prompts. Many developers struggle with LLMs producing conversational chatter or malformed JSON.
>
> On the left is our prompt for on-device **LiteRT Gemma 4 E2B**. Notice the prompt structure:
> - We define five mutually exclusive semantic categories: `COLLUSION_EXAM`, `EXTERNAL_AI_ASSIST`, `UNAUTHORIZED_TALK`, `LEGITIMATE_INQUIRY`, and `BENIGN`.
> - This distinction is critical in education! If a student mumbles 'Why is my Docker container not binding to port 8080?', that is `BENIGN` self-talk. If they ask 'Teacher, can you check question 3?', that is `LEGITIMATE_INQUIRY`. But if they ask 'Hey Alex, what did you write for function calculateTax?', that is classified as `COLLUSION_EXAM`.
> - We constrain the model to output **ONLY one valid JSON object**, eliminating preamble and markdown wrapping.
>
> On the right is our Cloud Genkit Tool Prompt. We inject context dynamically using Mustache interpolation: the class ID, the student email, and the rolling audio transcript. We instruct Gemini to evaluate whether collaboration occurred, and if so, to call `recordAudioIrregularity` with structured risk levels. This ensures our database is populated deterministically without manual parsing."

---

### 31:00 – 34:00 | Slide 11: Act IV: On-Device Vision AI: 468-Point Mesh & Iris Geometry
*Visual: `slide_edge_vision_gaze.png`*

> **Cyrus Wong:**  
> "Now let us turn to Act IV: On-Device Edge Vision AI.
>
> How do we detect if a student is looking away at a smartphone or a second cheating display without uploading their video to a server?
>
> In our student web app, we execute Google's **MediaPipe FaceLandmarker with Iris Tracking** directly in the browser. It maps **468 3D facial landmarks plus 10 specialized iris landmarks** (points 468 to 477).
>
> From this high-density wireframe, our mathematical model computes:
> 1. **3D Head Orientation (Yaw, Pitch, Roll):** A Yaw exceeding $\pm 25^\circ$ indicates the student is looking away from their monitor. A downward Pitch exceeding $-20^\circ$ typically indicates gazing into their lap where a mobile phone is hidden.
> 2. **Metric Iris Distance:** Using pinhole camera projection and the average human horizontal iris diameter ($11.7\text{ mm}$), we calculate the exact student-to-screen distance in centimeters:
>    $$\text{Distance (cm)} = \frac{11.7\text{ mm} \times f_x}{\Delta\text{Iris}_{\text{pixels}}}$$
>    If a student leans back past 80cm or moves out of camera range, an alert is triggered.
> 3. **Eye Aspect Ratio (EAR) & Mouth Aspect Ratio (MAR):** EAR detects eye closure and drowsiness, while MAR measures lip movement to identify whispering or silent talking before audio is even verbalized.
> 4. **1-Click Baseline Calibration HUD:** Every student sits differently. At the start of an exam, students click 'Calibrate View'. This sets their personal neutral baseline, preventing false positives caused by natural spinal posture or non-centered camera mounting."

---

### 34:00 – 37:00 | Slide 12: Code Deep Dive: Zero-Jank Vision Loop & Metric Projection
*Visual: Code blocks on Slide 12*

> **Cyrus Wong:**  
> "Let us look at the code that makes this possible in production on ordinary student laptops.
>
> In `web-app/src/hooks/useFaceMonitor.js`, we faced a classic web performance bottleneck: running heavy computer vision models on the browser UI thread freezes the JavaScript event loop, making the student's exam interface completely unresponsive.
>
> We achieved buttery-smooth 60 FPS performance using two modern web platform primitives:
> 1. **`video.requestVideoFrameCallback()`:** Instead of relying on `requestAnimationFrame` (which fires even when the camera has no new frame), `requestVideoFrameCallback` fires *only* when the webcam hardware actually delivers a new frame.
> 2. **Zero-Copy Transferable Objects:** We convert the video frame into an `ImageBitmap` using `createImageBitmap(videoEl)` and post it to our Web Worker using the transferable array parameter `[bitmap]`. This transfers ownership of the underlying GPU memory instantaneously to the worker without copying bytes!
>
> Inside the worker, MediaPipe WASM processes the frame. If the student turns their head, only a tiny 40-byte JSON telemetry payload (`{ yaw, pitch, status: 'LOOKING_AWAY' }`) is emitted back to the main thread. The video frame itself is instantly garbage collected."

---

### 37:00 – 40:00 | Slide 13: Browser-Native Edge Speech AI: LiteRT Whisper & Gemma 4
*Visual: `slide_edge_speech_proctor.png`*

> **Cyrus Wong:**  
> "Now let us examine audio. In Hong Kong classrooms, as well as in Singapore, multilingualism is standard. Students fluidly code-switch between Cantonese, Mandarin, and English within the same sentence.
>
> Traditional cloud speech-to-text models fail on code-switched Cantonese slang, and streaming continuous microphone audio from 50 laptops saturates the school's upstream Wi-Fi bandwidth.
>
> We solved this by bringing speech AI directly into the browser:
> - We deploy a quantized **LiteRT Whisper STT model** running inside a dedicated audio Web Worker.
> - Audio is sampled at 16kHz Float32 PCM directly through the Web Audio API.
> - As the student speaks, Whisper emits rolling bilingual subtitle transcripts.
> - That text stream is piped into an on-device **LiteRT Gemma 4 E2B model**, which classifies spoken intent in real-time.
> - Both model binaries (~350MB total) are stored in the browser's persistent **Cache Storage API**. Once downloaded on day one, the entire audio invigilation pipeline functions completely offline with **zero cloud egress**."

---

### 40:00 – 42:00 | Slide 14: Cloud Audio Diarization & Moving Window Timeline
*Visual: `slide_cloud_audio_diarization.png`*

> **Cyrus Wong:**  
> "What about exams where institutional regulations require cloud-backed audio verification?
>
> Look at the audio pipeline on screen:
> - We implement a **rolling 30-second audio window with a 15-second overlapping stride**. The overlap ensures that if a student whispers a sentence across a window boundary, the words are never clipped or lost.
> - Crucially, we implemented **Web Audio RMS Silence Detection**. In an average 2-hour coding exam, students are silent for over 80% of the time. Our client-side RMS analyzer monitors ambient decibels: if the student is silent, the audio chunk is discarded right in the browser! We save over **80% of audio cloud upload bandwidth and Vertex AI API quota**.
> - For active speech chunks, the audio is processed by **Vertex AI Gemini 3.5 Transcribe Preview**. It outputs speaker diarization labels—distinguishing between the registered student and an external voice—with millisecond timestamps. In the teacher dashboard, the instructor can click any word in the transcript to jump audio playback directly to that exact syllable."

---

### 42:00 – 44:00 | Slide 15: Act V: Dual Real-Time WebRTC Media Streaming Topologies
*Visual: `slide_webrtc_topologies.png`*

> **Cyrus Wong:**  
> "In educational environments, latency matters. If a student is cheating, a teacher needs to see what is happening *now*, not five minutes later in a batch processing queue.
>
> We implemented dual WebRTC real-time media topologies:
> 1. **1-to-1 WebRTC Live Peek & Talkback:** When an invigilator observes repeated off-screen gaze flags on a student's tile, they click 'WebRTC Live Peek'. The teacher and student browsers exchange ICE candidates and SDP offers through Firestore signaling documents. Within 500 milliseconds, a direct 30 FPS peer-to-peer audio-video stream is established. Video streams directly device-to-device across the local LAN without touching cloud storage, ensuring zero bandwidth fees. The teacher can even speak directly to the student via two-way talkback.
> 2. **1-to-Many Teacher Screen Broadcasting:** When an instructor wants to demonstrate code or announce a clarification, they activate screen broadcast. The teacher's screen stream is broadcast to all 50 student laptops, where it renders as an interactive, draggable Picture-in-Picture (PiP) modal so students can watch without losing their exam context."

---

### 44:00 – 46:00 | Slide 16: Teacher Command Center: Solving Cognitive Overload
*Visual: `slide_teacher_command_center.png`*

> **Cyrus Wong:**  
> "Human ergonomics is where many educational tools fail. If you put 50 live video streams on a single screen, no human teacher can maintain focus for two hours. It causes severe visual and cognitive exhaustion.
>
> Our Teacher Command Center solves this through **Cognitive Ergonomics**:
> - **Zero-Space Compliance Filters:** The header features immediate filtering toggles. With one click, an invigilator can filter the grid to view *only* students with active telemetry warnings ('⚠️ Problems') or severe AI detections ('🚨 Critical Alerts').
> - **1-Click Targeted Nudge (Hotkeyed to 'N'):** Rather than confronting a student publicly in front of their peers, the teacher simply presses 'N'. The system dispatches a gentle, non-punitive focus reminder to the student's screen: *'Please keep your eyes focused on your screen'*. In 90% of cases, this subtle nudge immediately corrects student behavior without escalating to disciplinary hearings.
> - **Offline State Caching:** In real classroom environments, Wi-Fi drops happen. If a student loses connection, their tile preserves their last captured frame, flags an orange `(Offline)` badge, and queues telemetry locally in IndexedDB until connectivity recovers."

---

### 46:00 – 48:00 | Slide 17: Cloud Media Lifecycle & Containerized FFmpeg Pipeline
*Visual: `slide_cloud_storage_ffmpeg_ttl.png`*

> **Cyrus Wong:**  
> "Let us discuss institutional data governance and cloud storage management.
>
> Uploading hundreds of individual JPEG screenshots from 50 students creates thousands of small storage objects, making auditing and long-term archiving painful.
>
> Our backend features an automated 3-phase media lifecycle:
> 1. **Phase 1 — Ingestion:** Student browsers upload discrete 720p screenshots at configurable intervals using short-lived Cloud Storage Signed URLs.
> 2. **Phase 2 — FFmpeg Video Compilation:** When an exam finishes, an event trigger launches a containerized **Cloud Run FFmpeg worker**. The worker downloads the raw screenshot sequence, orders them chronologically, and compiles them into a single, highly compressed H.264 MP4 exam video with a burned-in timestamp HUD. A 2-hour exam session is compressed into an 80MB video file suitable for rapid scrubbing and Gemini 3.7 video auditing.
> 3. **Phase 3 — Declarative Firestore TTL Cleanups:** To comply with privacy laws and avoid ballooning storage bills, every Firestore document and storage object is tagged with an `expireAt` timestamp. Firestore's native TTL engine automatically purges raw screenshot collections after retention periods, deletes temporary ZIP export archives after 7 days, and purges MP4 exam recordings 30 days post-audit."

---

### 48:00 – 50:00 | Slide 18: Green AI & Cloud FinOps: Institutional Cost Sustainability
*Visual: `slide_ai_cost_finops.png`*

> **Cyrus Wong:**  
> "Now let us examine the bottom line: **Cloud FinOps and Green Computing**.
>
> Look at the metrics on screen. We benchmarked our platform against commercial proctoring SaaS for a standard 50-student, 2-hour practical programming exam:
> - **Commercial SaaS:** Charges an average of $15.00 per student per exam. Total institutional cost: **$750.00**.
> - **Gemini AI Classroom Assistant:**
>   - Edge Whisper STT & Gemma 4 on client laptops: **$0.00**.
>   - Firestore reads and writes (single-stream optimized): **$0.08**.
>   - Cloud Storage screenshot ingestion & FFmpeg compilation: **$0.24**.
>   - Gemini 3.5 Flash-Lite & Transcribe API calls for verified anomalies: **$0.53**.
>   - **Total Institutional Cost for 50 Students: $0.85.**
>
> That is **less than $0.02 per student per exam**—a **99.8% cost reduction**!
>
> In addition, our instructor dashboard features a real-time FinOps circuit breaker. Teachers can set a hard class budget cap—say $5.00—and the system tracks token expenditure live. If the budget cap is reached, the system gracefully falls back to 100% on-device heuristic monitoring, ensuring zero unexpected cloud billing surprises."

---

### 50:00 – 52:00 | Slide 19: Academic Integrity Incident Dossier Pipeline
*Visual: `slide_incident_dossier_workflow.png`*

> **Cyrus Wong:**  
> "What happens when genuine academic misconduct occurs?
>
> In academic disciplinary panels, vague instructor accusations like 'I think the student looked at their phone' are often dismissed due to lack of objective evidence.
>
> We engineered an end-to-end **Incident Dossier Pipeline**:
> 1. When an anomaly triggers, the system aggregates all multimodal evidence: the exact timestamped screen capture, the student's 3D head pose angles, the transcribed audio snippet, and the Gemini reasoning audit log.
> 2. With a single click in the teacher dashboard, the system exports a formal, publication-ready **Microsoft Word document (`.docx`)** containing official institutional headers, student credentials, incident timelines, and embedded high-resolution screenshots.
> 3. Alongside the Word report, the system exports a **verifiable raw CSV log** containing sub-second sensor readings for mathematical auditability.
>
> Disciplinary committees receive a complete, objective, and legally sound forensic package with zero manual paperwork required from the teacher."

---

### 52:00 – 54:00 | Slide 20: DevSecOps & Software Reliability Engineering
*Visual: `slide_devsecops_safeguards.png`*

> **Cyrus Wong:**  
> "Behind this application is rigorous enterprise software engineering.
>
> We anchor our platform on three DevSecOps pillars:
> 1. **Terraform Infrastructure-as-Code:** The entire Google Cloud environment—IAM roles, Cloud Run microservices, Firestore composite indexes, and Cloud Storage buckets—is defined declaratively in Terraform. Any educational institution can clone our repository and provision their own isolated cloud environment in a single command (`terraform apply`).
> 2. **Automated Testing Pyramid:** In educational software, failures on exam day are catastrophic. Our codebase is backed by **64 Vitest test suites comprising 408 automated unit and integration tests** with 100% passing rate. We test everything from MediaPipe worker messaging to Genkit exponential backoff fallbacks and Firestore status serialization.
> 3. **Production Build Guardrails:** To eliminate accidental leaks, our `vite.config.js` includes a hard pre-bundling validation check: if development staging credentials or demo API keys are detected during a production build, the build immediately aborts with a clear error."

---

### 54:00 – 57:00 | Slide 21: Act VI: Live System Demonstration: 5-Stage Verification Flow
*Visual: `slide_live_demo_workflow.png`*

> **Cyrus Wong:**  
> "Now, let us switch from theory to practice with a live demonstration.
>
> *(Presenter transitions to live web browser window running the application)*
>
> **Stage 1: Student Hardware Onboarding**  
> Here is the student view. The student completes a streamlined 3-step readiness wizard: granting camera and microphone permissions, selecting their exam desktop screen share, and clicking 'Calibrate Baseline'. Notice the instant 468-point mesh lock.
>
> **Stage 2: Teacher Multi-Camera Live Grid**  
> On the instructor screen, the student's video and screen tiles appear immediately via our single-stream channel. Notice how snappy the grid remains as additional students join.
>
> **Stage 3: Simulating an Attention Anomaly**  
> Now watch what happens when I turn my head 45 degrees to the right to look at a secondary device... In less than 500 milliseconds, the client-side MediaPipe worker detects the Yaw threshold breach. The status pill transitions from green to amber: *'Looking Away'*.
>
> **Stage 4: Targeted Intervention & Live WebRTC Peek**  
> In the teacher dashboard, I filter the view using our Zero-Space filter. The student tile is highlighted. I press the 'N' key to send a gentle nudge. Look at the student's screen: a discrete toast appears: *'Please focus on your exam screen'*. If I need to inspect further, I click 'WebRTC Live Peek'—and instantly I have a 30 FPS direct peer-to-peer view of the student.
>
> **Stage 5: Instant Verification & Dossier Export**  
> At the conclusion of the session, I navigate to the audit tab. The audio waveform player displays color-coded diarization bars. I click on an anomalous audio peak, and it jumps directly to that audio segment. With one click on 'Export Incident Dossier', the browser downloads the formatted `.docx` file and raw CSV log. Everything works reliably, smoothly, and in real time."

---

### 57:00 – 60:00 | Slide 22: Act VI: Summary, Open-Source Access & Q&A
*Visual: `slide_closing_summary.png`*

> **Cyrus Wong:**  
> "To conclude, technology education does not have to choose between academic integrity, student privacy, and institutional cost. By leveraging edge computing for continuous sensor analysis and reserving cloud multimodal AI like Google Gemini for contextual reasoning, we can build a learning environment that is honest, respectful, and scalable.
>
> The entire project is open-source on GitHub at `github.com/wongcyrus/Gemini-AI-Classroom-Assistant`. You can scan the QR code on screen to access the live web application at `https://it114115-2627.web.app`.
>
> We warmly invite faculty from KOSEN colleges in Japan, Singapore Polytechnics, and international colleges to test our platform, collaborate on joint pedagogical research, and deploy it in your computing labs.
>
> Thank you very much, *Arigatou gozaimasu*, and I look forward to your questions!"

---

## Anticipated Q&A Playbook for ISATE 2026 Delegates

### Question 1 (KOSEN Faculty — Privacy & Biometrics):
**"In Japan, students and school boards are extremely sensitive to facial recognition. Does this system store student face templates or biometrics in the cloud?"**

> **Presenter Answer:**  
> "That is a paramount question. The answer is **absolutely not**. Our system adheres strictly to Privacy-by-Design. The MediaPipe facial landmark model runs 100% locally in the student's browser Web Worker using WebAssembly. The raw facial coordinates and biometric templates are discarded from memory immediately after mathematical calculation. The only data transmitted to Google Cloud is an anonymous numerical orientation angle—such as `yaw: -22` and a Boolean flag `isLookingAway: true`. No facial embeddings, biometric hashes, or continuous webcam videos are ever stored in the cloud. Student privacy is completely safeguarded."

---

### Question 2 (Singapore Polytechnic Faculty — Bandwidth & Low-End Laptops):
**"Our computer labs have 60 students per room. Does running Whisper and Gemma in the browser cause lag or crash older laptops?"**

> **Presenter Answer:**  
> "We specifically optimized the platform for lower-spec educational hardware like Intel Core i3 laptops and Chromebooks. 
> 
> First, all AI models are executed inside background Web Workers, which ensures the main browser UI thread maintains 60 FPS without jank. 
> 
> Second, our LiteRT models are 4-bit and 8-bit quantized: the entire Gemma 4 E2B model occupies under 200MB of RAM and runs inference in WebAssembly with SIMD acceleration.
> 
> Third, on the network layer, because silence suppression discards >80% of audio and video is processed as discrete screenshots, each student consumes less than 15 KB/s of network bandwidth—allowing 60 students to comfortably share standard classroom Wi-Fi."

---

### Question 3 (Vocational College Dean — Implementation & Cloud Costs):
**"Our department has limited cloud funding. How easy is it for our IT team to deploy this, and will we get hit with unexpected cloud bills?"**

> **Presenter Answer:**  
> "Deployment requires zero manual cloud console clicking. Our entire Google Cloud environment is codified in **Terraform**. Your IT team simply runs `./switch-env.sh prod` and `terraform apply`. In under ten minutes, the Cloud Run functions, Firestore rules, and storage buckets are provisioned in your own GCP project.
> 
> Regarding billing: because 95% of computation occurs at the edge, a typical 50-student exam costs approximately **$0.85 in total GCP consumption**. Furthermore, we built a hard budget circuit breaker into the teacher dashboard: you can configure a $5.00 class cap, and the system automatically halts all billable Vertex AI calls if that threshold is reached."
