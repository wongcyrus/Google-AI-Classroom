# Google Cloud Presentation Masterclass Script & Speaker Notes

[🏠 Documentation Index](../../README.md#documentation-index) | [📊 Presentation Slides (Marp)](./google-cloud-slides.marp.md) | [🌐 Interactive HTML Deck](./google-cloud-slides.html) | [📄 PDF Deck](./google-cloud-slides.pdf) | [📽️ PPTX Deck](./google-cloud-slides.pptx)

---

## Google AI Classroom Assistant
**Presenter:** Cyrus Wong (黃俊彥) — Google Developer Expert (GCP & AI/ML)  
Senior Lecturer, Hong Kong Institute of Information Technology (HKIIT), Vocational Training Council (VTC) Hong Kong  
**Event:** Google Cloud Tech Talk & Developer Conference Series  
**Session Length:** 60 Minutes (Deep-Dive Tech Talk + Architecture Breakdown + Live Demo + Q&A)

---

## Master Session Timeline (60 Minutes)

| Timeline | Section | Focus & Architectural Topic | Slides |
| :--- | :--- | :--- | :--- |
| **00:00 – 06:00** | **Speaker & Opening** | Welcome, Cyrus Wong GDE Bio, The Real-Time Invigilation & Assessment Challenge | Slides 1–2 |
| **06:00 – 12:00** | **01 \| System Overview** | The Assessment Trilemma, Surveillance Spyware vs. Edge-AI Assistant Paradigm Shift | Slides 3–4 |
| **12:00 – 18:00** | **02 \| Hybrid Architecture** | 4-Tier Hybrid Cloud, Cloud Functions Gen 2 on Cloud Run, Firestore Optimization, 4-Tier Hybrid Role Resolution & GCIP, Frontend Component & Stream Engine | Slides 5–9 |
| **18:00 – 26:00** | **03 \| Gemini Agent Platform** | Gemini 3 Suite Routing, Genkit Resilience, Teacher AI Prompt Studio & Optimizers, Structured Schemas | Slides 10–13 |
| **26:00 – 34:00** | **04 \| Edge AI & Privacy** | MediaPipe Mesh, Hardware Loop, LiteRT Whisper & Gemma 4, Cloud Diarization | Slides 14–17 |
| **34:00 – 38:00** | **05 \| Zero-Trust Security** | Zero-Trust Exam Mode, 1-Min Bingo Presence & 2-Strike State Machine | Slides 18–19 |
| **38:00 – 48:00** | **06 \| Real-Time Media & Student Hub** | WebRTC & Broadcaster, Live Subtitles, Subject Domains & Custom Translation Prompts, YouTube CC, YouTube-Style Desktop Student Hub, 3-Step Readiness Wizard & Schedule, Command Center, Serverless Cloud FFmpeg Compilation, Media Lifecycle & Cascading Purge | Slides 20–28 |
| **48:00 – 52:00** | **07 \| Video AI Pipeline** | Map-Reduce-Map Video Intelligence Pipeline, Dynamic Lab Tasks & Sortable Milestone Matrix | Slide 29 |
| **52:00 – 56:00** | **08 \| FinOps & Operations** | Cloud FinOps Sustainability, Incident Dossiers, 23 UI Domains, Institutional Admin Console & Governance Hub, 1-Command Terraform IaC & Automated Demo Sandbox | Slides 30–34 |
| **56:00 – 59:00** | **09 \| Operations & DevSecOps** | 1,100+ Tests Testing Pyramid, 5-Stage Live Verification Flow | Slides 35–36 |
| **59:00 – 60:00** | **10 \| Conclusion & Q&A** | Summary, Enterprise Docs & Open-Source Impact, Google Cloud & Edge AI Takeaways, Q&A | Slide 37 |

---

## Detailed Minute-by-Minute Script & Presenter Talking Points

### 00:00 – 03:00 | Slide 1: Title & Opening Vision
*Visual: `slide_hero_classroom_ai.png`*

> **Cyrus Wong:**  
> "Hello everyone, and welcome to this Google Cloud Tech Talk! I am thrilled to be here with fellow Google Cloud developers, AI practitioners, system architects, and educators. Today, we are exploring: **Architecting Edge-to-Cloud Multimodal AI with Google Cloud, Firebase, and Gemini**.
>
> In technical education and software engineering training, our primary objective is to verify real hands-on competency. But with the rapid emergence of generative AI code copilots, instructors face an unprecedented dilemma: take-home assignments and unmonitored exams no longer reflect authentic student capability.
>
> Over the past year at HKIIT / VTC Hong Kong, we engineered a completely new approach. Rather than relying on invasive, brittle, and expensive commercial proctoring software, we harmonized Google's **Gemini 3 model constellation**, **Google Genkit**, **Google Cloud Run Functions Gen 2**, and browser-native **LiteRT** and **MediaPipe** edge intelligence. The result is an open-source, privacy-preserving multimodal classroom agent that operates at **sub-$0.02 per student per exam**.
>
> Today, I'll walk you through our production architecture, cloud optimizations, zero-trust security model, and the hard lessons learned deploying this system to live computer labs."

---

### 03:00 – 06:00 | Slide 2: Speaker Biography
*Visual: `slide_speaker_bio_triple_cloud.png`*

> **Cyrus Wong:**  
> "A brief introduction before we dive into the code. I am Cyrus Wong, Senior Lecturer at HKIIT, Vocational Training Council (VTC) in Hong Kong, where I lead our Higher Diploma in Cloud and Data Centre Administration.
>
> I have spent over a decade designing production cloud systems and bringing enterprise infrastructure best practices into vocational technical education:
> - As a **Google Developer Expert (GDE)** in **Google Cloud Platform (GCP)** and **AI/ML**.
> - As an **AWS AI Hero** (since 2016, and the first AWS Academy instructor globally).
> - As a **Microsoft MVP** in Azure AI.
>
> Being a Triple Cloud community lead gives me a relentless focus on cost engineering and architectural pragmatism. When deploying software across hundreds of concurrent students in real lab environments, two principles guide every design decision: **architectural simplicity creates rock-solid reliability**, and **uncontrolled cloud API egress and token costs will kill institutional adoption**. Every pattern we share today was built to solve real production constraints."

---

### 06:00 – 09:00 | Slide 3: 01 | The Real-Time Invigilation & Assessment Challenge
*Visual: `slide_assessment_trilemma.png`*

> **Cyrus Wong:**  
> "Let's first define the engineering and pedagogical challenge. When conducting software assessments in modern computing laboratories, instructors face what we call **The Assessment Trilemma**:
>
> 1. **Academic Integrity:** Take-home coding exams and unmonitored environments are fundamentally broken by AI assistance. In physical computer labs, unauthorized peer collaboration, whispered answers, second monitors, and unauthorized browser tabs are pervasive.
> 2. **Student Privacy & Trust:** Commercial proctoring tools respond with brute force: installing ring-0 kernel drivers that inspect students' private files, lock down their operating systems, and stream continuous raw video to third-party clouds. Students and privacy regulators rightly push back against this spyware model.
> 3. **Institutional Cost Barrier:** Traditional commercial proctoring SaaS charges between **$15 and $25 per student per exam**. For an institution with thousands of students taking weekly lab tests, annual licensing fees exceed hundreds of thousands of dollars.
>
> We refused to accept this trade-off. We asked: can we build an edge-first, cloud-native architecture that satisfies all three constraints simultaneously?"

---

### 09:00 – 12:00 | Slide 4: Paradigm Shift: Surveillance Spyware vs. Edge-AI Assistant
*Visual: `slide_proctoring_evolution.png`*

> **Cyrus Wong:**  
> "The solution required a fundamental paradigm shift: moving away from punitive surveillance spyware toward a **human-in-the-loop, privacy-first AI assistant**.
>
> - **Legacy Surveillance Tools:** Require native executables or kernel drivers, saturate campus Wi-Fi by streaming 50 continuous HD video feeds per classroom to the cloud, generate hundreds of false-positive alerts, and charge exorbitant SaaS fees.
> - **Our Edge-AI Assistant:** Is **100% browser-native** with zero installation. Over **95% of computer vision and audio inference occurs locally on the student's device** using MediaPipe and LiteRT in Web Workers. No raw webcam footage or audio ever leaves the laptop unless an anomaly is verified.
> - Most importantly, the total operational cost on Google Cloud drops to **<$0.02 per student per exam**—a 99.8% reduction."

---

### 12:00 – 13:30 | Slide 5: 02 | High-Level 4-Tier Hybrid Architecture on GCP
*Visual: `slide_hybrid_architecture.png`*

> **Cyrus Wong:**  
> "Here is our 4-tier hybrid architecture:
>
> 1. **Student Browser Edge (Client Tier):** Runs React with Vite, orchestrating dual-channel screen and camera capture. It houses isolated Web Workers executing MediaPipe FaceLandmarker, LiteRT Whisper STT, and LiteRT Gemma 4 E2B via WebAssembly and WebGPU.
> 2. **Realtime Signaling & Data Layer (Firebase Tier):** Firestore acts as our low-latency distributed state bus. Cloud Storage handles discrete screenshot chunks, compiled MP4 timelapse recordings, and audit archives.
> 3. **Serverless Cloud Intelligence (Google Cloud Run / Functions Gen 2):** Decoupled micro-codebases handle automated media compilation via FFmpeg, Genkit AI flows, and scheduled TTL lifecycle routines.
> 4. **Teacher Command Center (Instructor Tier):** A high-density dashboard that gives the instructor a real-time compliance matrix, targeted nudges, and 1-click WebRTC live peek capabilities."

---

### 13:30 – 15:00 | Slide 6: Google Cloud Run & Cloud Functions Gen 2 Topology
*Visual: `slide_cloud_functions_gen2.png`*

> **Cyrus Wong:**  
> "Behind the scenes, we leverage **Firebase Functions Gen 2**, which run directly on **Google Cloud Run** in `asia-east2` (Hong Kong).
>
> We split our backend into **7 isolated domain micro-codebases**:
> 1. `ai_flows`: Houses our Genkit AI workflows and Gemini Enterprise Agent Platform integrations.
> 2. `attendance`: Computes per-minute screenshot bucket mapping and attendance percentage aggregations.
> 3. `auth_triggers`: Enforces role-based access control (RBAC), domain auto-provisioning, and campus IP CIDR boundary gating.
> 4. `media_processing`: Executes containerized FFmpeg tasks with hardware acceleration.
> 5. `property_processing`: Ingests and sanitizes high-frequency client telemetry.
> 6. `scheduled_tasks`: Executes declarative TTL retention routines and synchronizes real-time Google Cloud Billing SKU rates.
> 7. `storage_triggers`: Monitors Cloud Storage uploads, generating signed URLs and enforcing storage quotas.
>
> Splitting by domain guarantees zero cold-start cascades and complete deployment isolation."

---

### 15:00 – 16:30 | Slide 7: Cloud Data Optimization: Firestore Single-Stream Channel
*Visual: Code snippet with `useMonitorClass.js`*

> **Cyrus Wong:**  
> "Let's examine our first major cloud cost optimization.
>
> In a naive Firebase design, 50 student laptops each write their status to individual Firestore documents, and the teacher dashboard listens to all 50 documents with separate snapshot listeners. In a class of 50 students, that produces 2,500 document reads every 5 seconds—over 1.8 million reads during a 2-hour lab, quickly exhausting free tiers.
>
> We solved this with the **Atomic Single-Stream Channel**:
> - Client devices write heartbeats to an ephemeral status collection.
> - A lightweight background aggregator rolls all 50 student payloads into a single document: `classes/{classId}/status/current`.
> - The instructor's dashboard attaches **exactly one listener** to this single aggregated document.
> - Result: Read operations plummeted from 2,500 per tick down to **1 read per tick**—a 98% reduction in Firestore operations."

---

### 16:30 – 18:00 | Slide 8: 4-Tier Hybrid Role Resolution & GCIP Blocking Functions
*Visual: `slide_hybrid_role_resolution.png`*

> **Cyrus Wong:**  
> "A critical security and financial governance challenge in educational institutions is identity management.
>
> In our platform, teachers have the authority to trigger expensive Gemini 3 AI batch analyses and view classroom telemetry, while students stream sensor data and must never access peer recordings or initiate cloud AI jobs. But institutions have diverse domain strategies: some have separate subdomains (`@stu.school.edu` vs `@school.edu`), others share the same domain (`@school.edu`), and hackathons use open email providers. If an ambiguous user signs up, granting teacher privileges by default would expose the institution's cloud budget to rapid exhaustion.
>
> To solve this, we implemented a **4-Tier Deterministic Resolution Hierarchy**:
> 1. **Tier 1 (Class Pre-Enrollment):** Queries `classes.where('teacherEmails', 'array-contains', email)`. If an instructor was already pre-enrolled by a coordinator, they receive `teacher` privileges immediately regardless of username pattern.
> 2. **Tier 2 (Subdomain Priority):** Student domains (`stu.vtc.edu.hk`) are strictly checked *before* teacher domains (`vtc.edu.hk`), preventing accidental elevation from substring containment.
> 3. **Tier 3 (Username Regex Pattern):** On shared domains, `STUDENT_USERNAME_REGEX` (e.g. 8-digit student IDs) partitions roles cleanly.
> 4. **Tier 4 (Zero-Trust Fallback):** Unmatched accounts default safely to `student`.
>
> We enforce this using **Google Cloud Identity Platform (GCIP) Blocking Functions** (`beforeUserCreated`). The function intercepts the sign-up event *before* any JWT is minted, writes the user profile to Firestore, and bakes `{ customClaims: { role } }` directly into the token. If an instructor requires manual elevation later, an atomic CLI script (`grantTeacherRole.js`) updates claims and performs two-phase profile migration."

---

### 17:30 – 18:30 | Slide 9: Frontend Architecture & Reactive Stream Engine
*Visual: `slide_frontend_architecture.png`*

> **Cyrus Wong:**  
> "Now let's examine the client-side architecture that makes this real-time system responsive on consumer student laptops without crashing the browser.
>
> 1. **Dynamic Route Code-Splitting (`App.jsx`):**
>    - Using a custom `lazyWithRetry` wrapper around React 19 lazy imports, we sliced our initial bundle from ~2.4MB down to between 3KB and 17KB per route chunk—a **99% reduction in initial load**.
>    - If a teacher or student has an open tab during a production deployment, `lazyWithRetry` catches stale chunk 404s and automatically reloads the asset, eliminating deployment white-screen crashes.
> 2. **Custom Hooks Data Mesh & Dedicated Web Workers:**
>    - To guarantee a steady 60 FPS in the browser, we offloaded all heavy machine learning to dedicated background Web Workers.
>    - `useFaceMonitor` manages `faceLandmarker.worker.js` for 468-point mesh tracking.
>    - `useClientLiteRTWhisper` manages `litertWhisper.worker.js` for on-device speech-to-text.
>    - `useClientLiteRTGemma` manages `litertGemma.worker.js` for real-time intent classification.
>    - Web Workers communicate via structured cloning and `ImageBitmap` zero-copy transfers, keeping the main React UI thread completely unblocked.
> 3. **Persistent Browser Cache Storage & Self-Service Records Portal:**
>    - AI model weights are cached in browser `CacheStorage` (`webai-models-v1`, `litert-gemma-cache-v1`), enabling instant repeat loads and offline resilience.
>    - In `StudentRecordsView.jsx`, students access a 5-tab self-service records portal featuring their Attendance Presence %, Screen Sharing %, and AI Working Minutes % ratios with zero-trust privacy controls."

---

### 18:30 – 20:30 | Slide 10: 03 | Gemini Enterprise Agent Platform: Gemini 3 Constellation & Model Routing
*Visual: `slide_gemini_models_matrix.png`*

> **Cyrus Wong:**  
> "When building AI-powered production systems, one size does not fit all. We deploy Google's **Gemini 3 model suite**, routing each task to its optimal price-performance tier with pure modern model architecture:
>
> 1. **`gemini-3.8-flash` (Deep Multimodal Reasoning & Full Lectures):** Our flagship model for whole-class lecture speech-to-text, YouTube chapter generation, and Map-Reduce rubric synthesis. Its 1M+ context window effortlessly ingests 90-minute unbroken audio tracks.
> 2. **`gemini-3.5-flash-lite` (Ultra-Low Latency Workhorse):** Our fast workhorse for single-frame inspections, serverless live speech translation into 7 languages, and instant resilience fallback.
> 3. **`gemini-3.1-flash-live-preview` (Live Bidirectional Streaming):** Dedicated model for ultra-low latency WebSocket audio streaming via regional `us-central1`, powering live classroom subtitles with sub-second feedback.
> 4. **`gemini-3.5-transcribe-preview` (Audio Diarization):** Cloud audio reasoning that separates multi-speaker overlaps and outputs exact millisecond timestamps.
> 5. **`LiteRT Gemma 4 E2B & Whisper`:** Runs browser-native in student Web Workers via WebGPU/WASM at zero cloud cost."

---

### 20:30 – 22:30 | Slide 11: Google Genkit Resilience & Autonomous Tool Calling
*Visual: `slide_genkit_resilience_flow.png`*

> **Cyrus Wong:**  
> "To orchestrate these models reliably in production, we use **Google Genkit**.
>
> In high-concurrency university environments, API rate limits (HTTP 429) or transient cloud spikes (HTTP 503) are inevitable. We built a custom **Resilience Interceptor**:
> - If `gemini-3.8-flash` encounters a transient error, Genkit applies automatic exponential backoff with randomized jitter.
> - If the primary model remains constrained after 3 attempts, the interceptor transparently falls back to `gemini-3.5-flash-lite`.
> - The application never crashes, and student evaluations proceed uninterrupted.
>
> Furthermore, Genkit provides deterministic schema validation using **Zod**. Autonomous tools like `recordTaskDuration` guarantee that structured outputs adhere to our strict TypeScript interfaces before writing to Firestore."

---

### 22:30 – 24:30 | Slide 12: Teacher AI Prompt Studio & Multi-Domain AI Prompt Optimizers
*Visual: `slide_prompt_management_studio.png`*

> **Cyrus Wong:**  
> "One of our most powerful architectural additions is the **Teacher AI Prompt Studio & Multi-Domain AI Prompt Optimizers**:
>
> In real educational institutions, instructors teach diverse courses—from Introductory Python and Kubernetes to Healthcare and Accounting. A generic prompt cannot accurately assess specialized lab tasks or terminology.
>
> We categorized platform intelligence into **4 Multimodal Prompt Domains**:
> 1. **Images:** Vision AI prompts for dual-screen analysis, IDE active code verification, and off-screen gaze diversion.
> 2. **Videos:** Map-Reduce coursework rubric synthesis prompts for distilling class-wide milestones.
> 3. **Audios:** Speech intent proctoring, distinguishing legitimate inquiries from exam collusion or external AI copilot queries.
> 4. **Translations:** Technical discipline translation prompts ensuring terms like `useEffect`, `Docker`, or `EBITDA` remain untranslated in localized subtitles.
>
> In addition, we equipped every modality with a dedicated **AI Prompt Optimizer (`✨ Optimize` button)**:
> - Powered by built-in Gemini meta-prompts (e.g. `translationOptimizerPrompt`, `visionOptimizerPrompt`), it automatically transforms an instructor's rough notes into production-ready prompts with strict JSON schemas, few-shot edge cases, and anti-hallucination guardrails.
> - An **In-App FinOps Testing Sandbox** allows teachers to run live test executions against Gemini models, previewing actual output, execution latency in milliseconds, token counts, and estimated dollar costs before deploying to students.
> - Furthermore, our strict platform rule mandates that **100% of prompts**—from client-side Gemma Web Workers to Gemini Live WebSockets and Cloud Run Genkit flows—are maintained in version-controlled Markdown files in `admin/prompts/` and dynamically resolved with Firestore persistence."

---

### 24:30 – 26:00 | Slide 13: Production Prompt Engineering: Strict Schemas & Tools
*Visual: Markdown prompt snippet with JSON schema*

> **Cyrus Wong:**  
> "Prompt engineering in production is not about casual chatting; it is about deterministic output contracts.
>
> Here you see our prompt for on-device intent classification. Notice three critical engineering choices:
> 1. **Exhaustive Category Enumeration:** We restrict the LLM to five mutually exclusive categories: `COLLUSION_EXAM`, `EXTERNAL_AI_ASSIST`, `UNAUTHORIZED_TALK`, `LEGITIMATE_INQUIRY`, and `BENIGN`.
> 2. **Strict JSON Schema:** The model must emit a single JSON object containing boolean violation status, category, severity, confidence score, evidence quotation, and rationale.
> 3. **No Conversational Filler:** By explicitly constraining the grammar, we achieve 100% parse success rates across tens of thousands of evaluations."

---

### 26:00 – 28:00 | Slide 14: 04 | On-Device Vision AI: 468-Point Mesh & Iris Geometry
*Visual: `slide_edge_vision_gaze.png`*

> **Cyrus Wong:**  
> "Now let's examine our edge intelligence tier. How do we detect student distraction, looking at a smartphone, or looking away from the screen without streaming video to the cloud?
>
> We run **MediaPipe FaceLandmarker** directly in the browser:
> - It tracks **468 3D facial landmarks** in real time.
> - We calculate the **3D Head Pose Matrix** (Yaw, Pitch, Roll). A Yaw divergence beyond $\pm 25^\circ$ indicates looking away; Pitch beyond $\pm 20^\circ$ indicates looking down at a mobile device.
> - We compute **Metric Iris Distance** using pinhole camera geometry:
>   $$D = \frac{11.7\text{ mm} \times f_x}{\Delta\text{Iris}_{\text{pixels}}}$$
> - We calculate **Eye Aspect Ratio (EAR)** for blink duration and drowsiness, and **Mouth Aspect Ratio (MAR)** for whispering detection.
> - An interactive **1-Click Baseline Calibration HUD** establishes each student's neutral posture at the start of class, eliminating false positives caused by natural head tilts."

---

### 28:00 – 30:00 | Slide 15: Vision Code Deep Dive: Hardware-Synchronized Loop
*Visual: Code snippet with `requestVideoFrameCallback`*

> **Cyrus Wong:**  
> "How do we run high-frequency computer vision on budget student Chromebooks without freezing the React UI?
>
> We use two modern Web APIs:
> 1. **`requestVideoFrameCallback`:** Instead of `setInterval` or `requestAnimationFrame`, this callback fires precisely when a new hardware camera frame is delivered to the compositor.
> 2. **Transferable `ImageBitmap`:** We create an `ImageBitmap` from the video element and pass it to the Web Worker via `postMessage` with zero-copy memory ownership transfer: `[bitmap]`.
>
> The main React thread spends 0% of its CPU budget processing computer vision tensors, resulting in a locked 60 FPS user interface."

---

### 30:00 – 32:00 | Slide 16: Browser-Native Edge Speech AI: LiteRT Whisper & Gemma 4
*Visual: `slide_edge_speech_proctor.png`*

> **Cyrus Wong:**  
> "Beyond vision, we run edge audio invigilation using **LiteRT** (Google's lightweight runtime for on-device models):
> - The Web Audio API captures a 16kHz Float32 stream.
> - Our `litertWhisper.worker.js` provides real-time bilingual English and Cantonese speech-to-text directly in the browser.
> - Spoken sentences are passed to `litertGemma.worker.js` (Gemma 4 E2B) for intent classification.
> - **Browser Cache Persistence:** Using `caches.open('litert-gemma-cache-v1')` and `navigator.storage.persist()`, models are downloaded once during the first orientation and persisted offline permanently.
> - Cloud egress cost: **$0.00**."

---

### 32:00 – 34:00 | Slide 17: Cloud Audio Diarization & Moving Window Timeline
*Visual: `slide_cloud_audio_diarization.png`*

> **Cyrus Wong:**  
> "When high-stakes verification is required, we pair edge speech processing with cloud audio reasoning:
> - We implement a **rolling 30-second window** with a 15-second overlapping stride.
> - **Client-Side RMS Silence Suppression:** If the ambient sound energy falls below a calibrated noise floor, the chunk is dropped immediately in the browser. Over **80% of silence is filtered locally**, saving massive network bandwidth and cloud storage.
> - The remaining chunks are analyzed by **Gemini 3.5 Transcribe Preview**, which performs multi-speaker diarization (`Student` vs `External Voice`).
> - Instructors get an interactive audio timeline: clicking any transcribed word automatically seeks the audio player to that exact millisecond."

---

### 34:00 – 36:00 | Slide 18: 05 | Zero-Trust Assessment Security & Live Exam Mode
*Visual: `slide_exam_mode_zero_trust.png`*

> **Cyrus Wong:**  
> "A core requirement from educators is: *during examinations, assessment materials, recordings, and proctoring telemetry must remain strictly confidential*. Students must not view or share exam screencasts.
>
> We implemented an end-to-end **Zero-Trust Exam Protection Architecture**:
> 1. **Zero-Trust Cloud Storage Rules:** In `storage.rules`, student read access to `/videos/{classId}/{videoId}` is rejected if `resource.metadata.isExam == 'true'`. Even direct URL manipulation is blocked at the storage layer.
> 2. **Scheduled Exam Periods & Backend Stamping:** Teachers define scheduled `examPeriods: [{ name, startTime, endTime, requireFullScreenOnly }]`. Our containerized FFmpeg video compiler checks `isExamTimeRange` and stamps `isExam: 'true'` onto GCS custom metadata and Firestore records.
> 3. **Mandatory Full-Screen Enforcement (`requireFullScreenOnly: true`):** When Exam Mode is active, the student client rejects window or tab sharing, requiring a full desktop display share. This completely prevents students from hiding unauthorized AI chat windows behind the shared application.
> 4. **Student Records Portal Shielding (`StudentRecordsView.jsx`):** Exam videos, speech transcripts, and irregularity evidence are shielded behind confidentiality banners, preventing test leakage while still allowing post-exam reviews for regular practice labs."

---

### 36:00 – 38:00 | Slide 19: Bingo Active Presence: AI Generation & 2-Strike Verification
*Visual: `slide_bingo_active_presence.png`*

> **Cyrus Wong:**  
> "In hybrid and remote technical learning, a persistent challenge is students walking Away From Keyboard (AFK) while leaving browser sessions open.
>
> We upgraded our **Bingo Active Presence System** with automated AI generation and an **Automated 1-Minute FinOps Cadence (`* * * * *`)**:
> - **AI Question Bank Generator (`generateQuestionBankAi`):** Instructors don't need to manually write hundreds of questions. Gemini 3.5 Flash-Lite or 3.8 Flash autonomously drafts batches of 5 domain-tailored multiple choice questions with 4 options, correct answer keys, and pedagogical rationales directly from the lesson topic, or teachers can bulk import via standard Aiken format (`ANSWER: X`).
> - **3 Sourced FinOps Verification Modes:**
>   1. **Predefined Question Bank ($0.00 zero-AI cost):** Instantly sampled from the local class question pool.
>   2. **Teacher Screen Broadcast:** 1 single Gemini multimodal call analyzes the teacher's active broadcast frame, generating attention questions for 50+ students for just ~$0.00015!
>   3. **Student Screen Inspection:** On-demand individual verification analyzing active student IDE windows.
> - **Pedagogical Evaluation vs 2-Strike State Machine:**
>   - If a student answers incorrectly (`failed_incorrect`), their physical presence is confirmed! **No strike or attendance penalty is applied.**
>   - If they timeout without answering (`missed_timeout`), Strike 1 enqueues an asynchronous retry via **Google Cloud Tasks** (`dispatchBingoRetryTask`) with teacher-configurable grace delay (1–15 minutes).
>   - A consecutive Strike 2 confirms unverified absence, immediately voiding unverified elapsed minutes with Bitmask Code `2` (`attendanceAdjustments`)."

---

### 38:00 – 39:30 | Slide 20: 06 | Real-Time Classroom Media Pipelines
*Visual: `slide_realtime_media_pipelines.png`*

> **Cyrus Wong:**  
> "For live classroom interaction, we engineered two distinct real-time pipelines:
>
> 1. **1-to-1 WebRTC Live Peek & Talkback:** When an alert fires, the teacher clicks 'Peek'. A direct peer-to-peer WebRTC connection is negotiated over Firestore signaling, delivering 30 FPS crystal-clear video and two-way Opus audio without touching cloud storage.
> 2. **1-to-Many Classroom Pure Frame Broadcaster:** Traditional WebRTC star-mesh crashes teacher browser CPU when broadcasting to 50 students. Instead:
>    - The teacher screen is captured to an offscreen canvas and clamped to 720p.
>    - A **32x18 thumbnail pixel delta engine** diffs frames and emits lightweight compressed JPEG updates (~35–65 KB) to Firestore `screenBroadcast/liveFrame`.
>    - Students receive the stream in a floating Picture-in-Picture window while teacher CPU remains <2%!"

---

### 38:30 – 39:30 | Slide 21: Anonymous Public Presentation Mode: Projector QR & 4-Digit PIN
*Visual: `slide_public_presentation_mode.png`*

> **Cyrus Wong:**  
> "When presenting at tech conferences, open seminars, or lightning talks, audience members often struggle to see small terminal fonts on distant stage projectors or speak different native languages. We solved this with **Anonymous Public Presentation Mode**:
>
> 1. **Zero-Friction Audience Access via Projector QR Code:**
>    - In Step 2 of screen broadcasting, the speaker toggles 'Public Presentation Mode', generating a high-contrast SVG QR code modal.
>    - When projected onto the auditorium screen, audience members scan the QR code (`/live/:classId?pin=XXXX`) on their smartphones.
>    - Firebase automatically logs them in anonymously (`signInAnonymously`), unlocking the live screen stream with 1x/1.5x/2x zoom and real-time multilingual subtitles.
> 2. **Strict Server-Side Firestore Security Rules (`firestore.rules`):**
>    - The PIN is never exposed in readable session metadata.
>    - Attendees write a viewer presence record with their PIN, which Firestore security rules validate against `session.publicPin`. Only valid writes unlock read access to `screenBroadcast` and `liveSubtitles`.
> 3. **Hybrid Classroom & Ephemeral Teardown:**
>    - Teachers can use an existing class with enrolled students without exposing any student rosters or grades.
>    - As soon as the speaker clicks 'Stop Sharing', `isPublic` and `publicPin` are wiped, immediately terminating public access and keeping normal classroom data 100% private!"

---

### 39:30 – 40:30 | Slide 22: Real-Time Live Subtitles & Multilingual Translation Engine
*Visual: `slide_live_subtitles_translation.png`*

> **Cyrus Wong:**  
> "In international computing faculties and polytechnics, students possess diverse native languages. We engineered a flexible **3-Tier Multilingual Live Subtitle Engine**:
>
> - **Tier 1: On-Device Client AI ($0.00 Cloud Cost):**
>   - LiteRT Whisper Web Worker processes the teacher's microphone locally.
>   - Spoken text is instantly translated via Chrome Built-in AI (`window.Translator` powered by Gemini Nano).
>   - Zero latency, zero cloud egress, 100% privacy-compliant.
> - **Tier 2: Serverless Batch Translation (High Precision):**
>   - Edge Whisper STT streams transcribed sentences to Cloud Run Function `translateTeacherSpeech`.
>   - Powered by **Gemini 3.5 Flash-Lite** (with 3.8 Flash fallback), delivering high-precision translations into **7 languages** (`en`, `zh-Hant`, `zh-Hans`, `ja`, `ko`, `es`, `fr`).
>   - Preserves Cantonese-English technical code-switching (e.g. keeping terms like `useState` or `Docker` intact).
> - **Tier 3: Gemini 3.1 Flash Live (Bidirectional Streaming):**
>   - Uses WebSocket connection directly to regional `us-central1` via Firebase AI Logic.
>   - Buffers updates with a 350ms debounced Firestore synchronization channel.
>   - Students toggle between a docked bottom bar and a draggable floating HUD overlay with live bilingual subtitles."

---

### 40:30 – 42:00 | Slide 22: Course Subject Domains & Domain-Specific AI Translation
*Visual: `slide_subject_domain_translation.png`*

> **Cyrus Wong:**  
> "A generic translation model completely breaks down when applied to specialized academic lectures. If a lecturer says *'Deploy a cluster'* or *'Check the EBITDA'*, a standard translator might naively translate 'cluster' as a bunch of bananas or grapes, or mangle clinical medical terminology into gibberish!
>
> To solve this, we architected **Course Subject Domains & Domain-Specific AI Translation**:
>
> 1. **8 Academic Discipline Domains (+ Custom Freeform):**
>    - 💻 **Computer Science & Software Development:** Strictly locks programming APIs, variables, framework syntax, and keywords (`useState`, `Docker`, `SQL`, `git commit`).
>    - 💼 **Business, Finance & Accounting:** Preserves financial acronyms (`EBITDA`, `GAAP`, `IFRS`, `ROI`) and economics models.
>    - 🎨 **Design, Media & Visual Arts:** Preserves color spaces (`CMYK`, `RGB`), UI/UX heuristics, and rendering terminology.
>    - 🏥 **Healthcare, Nursing & Medical Sciences:** Preserves clinical pharmacology, anatomical nomenclature, dosage, and triage codes.
>    - ⚙️ **Engineering & Construction:** Preserves mechanical tolerances, CAD specifications, and structural formulas.
>    - 🍳 **Hospitality, Culinary & Tourism:** Preserves culinary jargon, HACCP hygiene standards, and hotel PMS codes.
>    - 📚 **Languages, Humanities & Social Sciences:** Preserves historical context, cultural idioms, and dialect nuances.
>    - ✏️ **Custom Subject Domain:** Allows instructors to type any specialized field (e.g. *Aeronautical Avionics*).
> 2. **Domain Context Injection & Specialized Translation AI Prompts:**
>    - The selected `subjectDomain` and custom `subtitlePrompt` are injected directly into the Gemini system instructions at runtime, guaranteeing domain glossary preservation without literal translation errors.
>    - Instructors can click the **Translation Prompt AI Optimizer (`✨ Optimize`)** to have Gemini refine their prompt into rigorous bilingual guidelines with glossary constraints.
> 3. **Hong Kong Cantonese-English Code-Switching Normalization:**
>    - In Hong Kong higher education, teachers naturally speak in mixed Cantonese and English (*'呢個 function return 個 boolean'*, *'deploy 個 cluster'*). Our translation prompt intelligently normalizes code-switching, producing clean, readable bilingual subtitles.
> 4. **Zero-Restart Real-Time Dynamic Propagation:**
>    - When an instructor updates their subject domain or translation prompt in Class Management, Firestore `onSnapshot` dynamically pushes updates to the active subtitle broadcast (`useTeacherLiveSubtitles`) on the fly with **zero broadcast restart**!
> 5. **High-Contrast Dual-Line Subtitles:**
>    - Displayed in student players with original spoken Cantonese on top and high-visibility **YouTube Caption Yellow** (`#ffe600`) English translation on the bottom!"

---

### 42:00 – 43:30 | Slide 23: Teacher Lecture Recording & Multilingual YouTube CC Workflow
*Visual: `slide_lecture_recording_youtube.png`*

> **Cyrus Wong:**  
> "A major feature requested by educators is post-lecture publishing: how can teachers record lectures and upload them directly to YouTube with professional multilingual closed captions and timestamped chapters?
>
> We automated this entire pipeline:
> 1. **Continuous A/V Hardware-Mixed Recording:**
>    - Web Audio API mixes the instructor's screen audio and microphone into a continuous `lecture_audio.webm` stream.
>    - Unlike segmented chunking, the whole-class voice track is preserved without clipping mid-sentence and uploaded to Cloud Storage via resumable chunks.
> 2. **Whole-Class Voice Processing in Gemini 3.8 Flash:**
>    - The Cloud Function `processLectureSubtitles` sends the whole unbroken audio track into Gemini 3.8 Flash's massive context window.
>    - The model produces word-perfect Cantonese-English speech transcription and automatically identifies topical shifts, generating formatted **YouTube Chapters** (e.g., `00:00 - Introduction`, `12:45 - Containerization`).
> 3. **Dual Caption Standards (Integer Millisecond Precision):**
>    - Generates WebVTT (`.vtt`, period millisecond delimiter) for the in-app HTML5 video player `<track>`.
>    - Generates SubRip (`.srt`, comma millisecond delimiter) for native YouTube Studio upload.
> 4. **1-Click "Download YouTube Package (.zip)":**
>    - Instructors click one button to download a ZIP containing the MP4 video, multilingual `.srt` captions (`en`, `zh-Hant`, `zh-Hans`, `ja`), and `youtube_metadata.txt` containing chapter timestamps, ready for drag-and-drop into YouTube Studio!"

---

### 43:30 – 45:00 | Slide 24: YouTube-Style Desktop Student Hub & Screen Modes
*Visual: `slide_student_desktop_youtube.png`*

> **Cyrus Wong:**  
> "Now let's examine the student desktop experience. In traditional proctoring tools, the student's interface is cluttered with clunky diagnostic widgets that fight for window space.
>
> We redesigned the student desktop into an intuitive **YouTube-style Player Experience**:
> - **Integrated Video Player Stage:** Embeds the teacher's live screen broadcast (`🔴 LIVE`, `1080P`, stream zoom), while proctoring screen/webcam streams dock cleanly in Picture-in-Picture.
> - **YouTube Closed Caption (CC) Overlay:** Renders speech cues directly on the player stage. Original speech appears in a translucent dark pill, while real-time translations render in high-contrast **YouTube Caption Yellow** (`#ffe600`).
> - **YouTube Bottom Control Bar:** Provides a 1-click `[CC]` toggle, live target language selector, settings gear popover for font size and display modes, and native fullscreen toggle.
> - **Flexible Screen Modes ('Just Max or Smallest'):**
>   - **🗖 Max Mode (Theater / Full-Width):** Video player expands to 100% width via CSS `display: contents;`. Controls and the tabbed sidebar flow beneath in a clean 2-column layout with **zero DOM reparenting and zero stream flicker**.
>   - **🗗 Smallest Mode (Corner Mini-Player):** Shrinks the player to a compact corner widget (380x220px, `z-index: 100`), opening **100% of the desktop viewport** for the student's IDE, terminal, and course assignments.
>   - **🔲 Standard Mode:** Classic 70/30 split view.
> - **YouTube-Style Live Transcript in Sidebar:** Students can switch to a live transcript tab that streams teacher sentences chronologically with automatic scrolling.
> - **Ironclad Classroom Bingo Safeguards ('Don't Break the Bingo'):**
>   - Bingo challenge modal mounts via React Portal directly to `document.body` at `z-index: 2147483647 !important`, strictly above the mini-player.
>   - A top pulsing alert banner with an 'Answer Challenge ➔' button guarantees students never miss a check.
>   - Browser fullscreen is proactively exited upon challenge arrival, and switching screen modes never resets or cancels active Bingo state."

---

### 44:00 – 45:30 | Slide 25: 3-Step Exam Readiness Wizard & Schedule Automation
*Visual: `slide_readiness_wizard_schedule.png`*

> **Cyrus Wong:**  
> "To prevent hardware surprises during exams, we built an automated onboarding and schedule-driven workflow:
>
> 1. **3-Step Exam Readiness Wizard (`ExamReadinessWizard.jsx`):**
>    - **Step 1: 🎙️ Microphone Test:** Detects hardware, displays a live VU volume meter (calibrated between 15% and 65%), requires reading a spoken challenge sentence, and plays back a 3-second audio loopback so students verify their voice clearly.
>    - **Step 2: 📷 Camera & Gaze Calibration:** Aligns the student's face inside an oval guide and records a 1-click neutral baseline pitch/yaw calibration (`🎯 Set Center Pose`).
>    - **Step 3: 🖥️ Display Surface Verification:** Enforces mandatory full-screen display sharing, rejecting window or single-tab shares during exam mode.
> 2. **Schedule-Driven Engine (`useStudentClassSchedule.js`):**
>    - Evaluates enrolled course schedules every 30 seconds with automatic timezone adjustment.
>    - Automatically binds the student to the active class with a visual **'(Live)'** tag.
>    - Supports manual class selection with a 1-click **'Follow Schedule'** restore button.
> 3. **Concurrent Classes & 10-Minute Back-to-Back Buffer:**
>    - Automatically starts capture 5 minutes before scheduled start and ends 5 minutes after class conclusion.
>    - **Zero-Waste Single Storage Upload:** One image blob is uploaded to Cloud Storage, while Firestore records metadata for all overlapping courses (`targetClasses`). Neither instructor misses student telemetry!"

---

### 45:30 – 46:30 | Slide 26: Teacher Command Center: Solving Cognitive Overload
*Visual: `slide_teacher_command_center.png`*

> **Cyrus Wong:**  
> "Monitoring 50 live video feeds simultaneously causes extreme cognitive fatigue for human proctors.
>
> Our Teacher Command Center solves this:
> - **Zero-Space Compliance Filters:** Instructors filter the grid with a single click: `⚠️ Problems`, `📷 Missing Cam`, `🎙️ Missing Mic`, `🖥️ Not Sharing`, or `🚨 AI Alerts`.
> - **1-Click Targeted Nudge (`N`):** Selecting a student tile and pressing `N` instantly transmits a gentle focus notification to that student's screen.
> - **Offline Resilience:** If a student experiences a network glitch, their tile caches the last known frame and marks them as `(Offline)`.
> - **Integrated Video Peek:** Instant one-click jump to full-screen peer-to-peer live stream."

---

### 46:30 – 47:30 | Slide 27: Serverless Cloud FFmpeg: Image-to-Video Compilation Pipeline
*Visual: `slide_ffmpeg_compilation.png`*

> **Cyrus Wong:**  
> "Now let's examine the serverless media compilation pipeline that converts tens of thousands of student screenshots into lightweight, reviewable video assets without overwhelming cloud compute or storage.
>
> 1. **Client Geometric Scaling Formula (`StudentView.jsx`):**
>    - Before an image is uploaded, the browser checks payload bounds. If a capture exceeds the target size, it calculates an adaptive geometric scaling factor:
>      $$\text{scale} = \sqrt{\frac{\text{maxImageSize}}{\text{blob.size}}} \times 0.9$$
>    - This guarantees that downscaling converges in a single pass without memory-heavy iterative trial loops.
> 2. **High-Memory Cloud Run Worker (`processVideoJob.js`):**
>    - Running on Cloud Run Functions Gen 2 with `8GiB RAM` and `2 vCPUs`, the container compiles up to 1,800 frames per student session.
>    - Images are processed in memory-bounded batches (`BATCH_SIZE = 15`) to prevent container OOM (Out-Of-Memory) crashes.
> 3. **Sharp SVG 40px Security Banner:**
>    - A cryptographically stamped 40px SVG banner is composited across each frame, displaying the UTC timestamp, class ID, student email, and channel identifier (`[SCREEN]` or `[WEBCAM]`).
>    - Enforces even pixel dimensions (`w%2===0`, `h%2===0`) for strict H.264 macroblock compliance.
> 4. **FFmpeg Timelapse Encoding Parameters:**
>    - `-preset fast`: Slashes container CPU time by 70% compared to slow encoding with identical text clarity.
>    - `-crf 30`: Achieves an **80% reduction in MP4 file size** compared to default presets, keeping 2-hour lab timelapses under 25MB.
>    - `-tune stillimage` & `-movflags +faststart`: Optimizes for static screen content and enables instant video playback without waiting for full download."

---

### 47:30 – 48:30 | Slide 28: Cloud Media Lifecycle & Automated Storage Governance
*Visual: `slide_cloud_storage_ffmpeg_ttl.png`*

> **Cyrus Wong:**  
> "What happens to all this media after class? Without strict governance, video recordings and proctoring screenshots will rapidly inflate cloud storage bills.
>
> We engineered an end-to-end **Automated Storage Lifecycle & Cascading Purge Architecture**:
> 1. **Per-Class Dual Retention Policies (`classes/{classId}`):**
>    - `retentionDays`: TTL for raw screenshots (default: 30 days, configurable 7–365 days).
>    - `videoRetentionDays`: TTL for compiled MP4 lesson videos (default: 90 days, configurable 14–730 days).
>    - Ephemeral ZIP export archives: Auto-purged after 7 days.
> 2. **Deterministic UTC Expiration Stamping (`expireAt`):**
>    - Every screenshot, video job, and audio chunk is stamped with an explicit UTC `expireAt` timestamp upon ingestion.
>    - Managed autonomously by the **Firestore Native TTL Engine** at zero maintenance cost.
> 3. **Event-Driven GCS Blob Deletion Triggers (`storage_triggers/`):**
>    - `onScreenshotDocDeleted`, `onVideoJobDocDeleted`, and `onZipJobDocDeleted` detect Firestore document deletions (whether triggered by TTL or teacher deletion) and immediately delete the underlying physical blobs from Cloud Storage.
> 4. **4-Stage Cascading Class Purge (`onClassDocDeleted`):**
>    - When a teacher deletes a class in the UI, a single Firestore delete triggers a Cloud Function that cascades across screenshots, compiled videos, zip archives, subcollections (`properties`, `status`, `broadcast`), and records.
>    - Class storage quotas are automatically decremented via `onObjectDeleted`, ensuring zero orphaned files and zero runaway storage costs."

---

### 48:30 – 50:30 | Slide 29: 07 | Serverless Map-Reduce-Map Video Intelligence Pipeline
*Visual: `slide_map_reduce_ai_jobs.png`*

> **Cyrus Wong:**  
> "Now let's examine our automated coursework grading pipeline: **Serverless Map-Reduce-Map AI Video Analysis**:
>
> - **Phase 1: Map (Parallel Video Discovery):** The master dispatcher initializes progress counters and enqueues individual tasks to **Google Cloud Tasks** (`analyzeSingleVideoTask`) in ~2 seconds. Tasks are throttled to 4 concurrent workers (`maxDispatchesPerSecond: 2`) with dedicated 300s/2GiB containers, eliminating Cloud Function timeout walls and Gemini 429 rate limit spikes.
> - **Phase 2: Reduce (Coursework Rubric Synthesis):** A cross-student aggregator feeds all student discovery summaries into **Gemini 3.8 Flash**, which synthesizes a unified coursework rubric and objective milestone prompt. An animated UI stepper tracks this multi-stage synthesis in real time.
> - **Phase 3: Map (Milestone Evaluation & Matrix):** Mapped AI jobs evaluate each student video against the rubric. Autonomous tool calling logs milestone durations into the **Student Milestone Matrix** (`StudentMilestoneMatrix.jsx`), featuring interactive sortable heatmaps (<20m green, 20-40m amber, >40m red) and 1-click RFC 4180 CSV export.
> - **Dynamic AI Lab Task Generator (`generateLabTaskPrompt`):** Beyond passive evaluation, the aggregator flow synthesizes completed child jobs (`aiJobs`) into real-world hands-on lab tasks with step-by-step logic, correct solution routes, and grading criteria.
> - **Cloud Multimodal Fallback (`analyzeFaceFallback`):** When student edge MediaPipe landmarks are occluded, face lighting is poor, or WebGL is unavailable, a high-efficiency serverless fallback (`gemini-3.5-flash-lite`, temperature 0.1) performs resilient gaze and face verification in the cloud."

---

### 50:30 – 52:30 | Slide 30: 08 | Green AI & Cloud FinOps: Institutional Cost Sustainability
*Visual: `slide_ai_cost_finops.png`*

> **Cyrus Wong:**  
> "Here are the unit economics that make this system viable for public education:
>
> - Commercial surveillance SaaS costs **$15 to $25 per student per exam**. For a 50-student class, that is $750.00 to $1,250.00.
> - With our edge-first hybrid architecture, 95% of compute occurs locally on student devices. Cloud audio is pre-filtered by 80% silence reduction, and screenshots are compiled into compact MP4s.
> - In active presence verification, our Predefined Question Bank mode incurs **$0.00 AI cost**, while 1-to-many Teacher Broadcast runs at just **$0.000075 per check** for 50 students!
> - The total Google Cloud cost for a 50-student, 2-hour exam is **$0.85 total—less than two cents per student!**
> - In addition, we ingest live Google Cloud Billing Catalog API SKU rates to provide real-time budget forecasting and automated alerts in the teacher dashboard."

---

### 52:30 – 53:30 | Slide 31: Academic Integrity Incident Dossier Pipeline
*Visual: `slide_incident_dossier_workflow.png`*

> **Cyrus Wong:**  
> "If an irregularity occurs, proctors must provide indisputable evidence to faculty disciplinary committees.
>
> We built a **1-Click Incident Dossier Generator**:
> - It aggregates timestamped screenshots, 3D gaze angles, Whisper audio transcripts, and the Gemini reasoning chain.
> - Generates a formal, tamper-evident Microsoft Word (`.docx`) disciplinary report with institutional headers, alongside verifiable raw CSV telemetry logs.
> - Faculty committees receive objective, forensic evidence with zero manual administrative overhead."

---

### 53:30 – 54:30 | Slide 32: Multi-Persona Operations & 23 UI Control Domains
*Visual: `slide_multipersona_operations.png`*

> **Cyrus Wong:**  
> "A common failure mode in academic software is the gap between code capabilities and user accessibility. To ensure seamless institutional adoption, we published exhaustive role-based user documentation and mapped all 23 UI control domains across the platform:
>
> - **Instructor & TA Command Center (17 Chapters):** Operational guidance covering timetable automation, zero-space problem filters, 1-to-1 WebRTC Live Peek and Opus intercom, Pure Frame Broadcaster, 1-minute Bingo challenges, Teacher Prompt Management Studio, YouTube CC studio, and Word/CSV incident dossiers.
> - **Student & Examinee Portal (12 Chapters):** Self-service workflows detailing the 3-step hardware readiness wizard, dual-stream webcam/screen capture, on-device LiteRT Whisper and Gemma proctoring, 1-min Bingo focus HUD, docked & floating live subtitles HUD, and the **Student Mobile View** (`StudentMobileView.jsx`) for attendance on phones.
> - **Admin & DevOps Governance (11 Chapters):** Enterprise administration detailing GCIP blocking auth triggers for institutional domain claim mapping, zero-trust exam confidentiality storage rules, the 7 isolated Cloud Run Functions codebases, and daily FinOps Gemini pricing sync.
> - **15 Mermaid Interaction & State Diagrams:** We mapped every critical interaction—from lesson lifecycle and WebRTC signaling to the Bingo Cloud Tasks retry state machine and two-stage rubric synthesis—into clear, auditable diagrams with zero guesswork."

---

### 54:30 – 55:30 | Slide 33: Institutional Admin Console & System Governance Hub
*Visual: `slide_admin_governance.png`*

> **Cyrus Wong:**  
> "To support institution-wide rollouts across multiple departments and campuses, we designed the **Institutional Admin Console & System Governance Hub**:
>
> 1. **Identity & Privilege CLI (`admin/scripts/`):**
>    - Institutional coordinators cannot wait for manual database edits. We built `grantTeacherRole.js`, a 2-phase CLI tool that safely checks target user existence, updates GCIP custom claims `{ role: 'teacher' }`, and performs atomic Firestore migration between `studentProfiles` and `teacherProfiles`.
>    - An automated administrator creation tool (`createAdminUser.js`) provisions root governance credentials with deterministic security claims.
> 2. **Cloud Governance & Resource Controls:**
>    - Storage caps: Admins can set per-class storage quota overrides directly in Firestore, preventing runaway video compilation from exhausting institutional bucket limits.
>    - Dual-environment switcher (`./switch-env.sh dev` / `prod`): Synchronizes configuration across all 7 isolated Cloud Run Functions directories in one step.
> 3. **Automated Prompt Governance & Seed Scripts:**
>    - Platform prompts are versioned in git under `admin/prompts/`. Running `node admin/scripts/seed_prompts.mjs` scans all markdown prompt files, extracts their metadata, and seeds or updates Firestore with zero downtime.
>    - Sandbox reset script (`reset_demo_env.sh`): Wipes test classes and resets the `IT114115-Demo` class to clean state in seconds."

---

### 55:30 – 56:30 | Slide 34: 1-Command Terraform IaC & Automated Demo Sandbox
*Visual: `slide_terraform_demo_sandbox.png`*

> **Cyrus Wong:**  
> "To enable any university or school to deploy this entire platform in minutes, we automated cloud provisioning with **Zero UI Clicks**:
>
> - **1-Command Provisioning (`./setup-new-project.sh <PROJECT_ID> <BILLING_ACCOUNT_ID>`):**
>   - Executes 100% Terraform Infrastructure as Code (`terraform/`).
>   - Activates 17 Google Cloud APIs, spins up Cloud Firestore Native in `asia-east2`, creates Cloud Storage buckets with custom CORS, deploys Cloud Run Functions Gen 2, and configures GCIP Identity Platform.
>   - Automatically generates `web-app/.env` and `functions/config.js` with zero manual configuration.
> - **24/7 Pre-Seeded Development Sandbox (`IT114115-Demo`):**
>   - The setup script pre-seeds a verified lead teacher account (`teacher1@vtc.edu.hk`) and 5 demo students (`student1`..`student5@stu.vtc.edu.hk`).
>   - Includes 1-click clipboard credential copy buttons in the documentation for instant testing without manual registration.
>   - Pre-seeds 13 multimodal system prompt templates across images, videos, audios, and multilingual translation.
> - **Dual-Environment Workflow:** Seamless switching between development (`it114115-dev-2026`) and production (`it114115-2627`) via `./switch-env.sh [dev|prod]` with build-time environment guardrails."

---

### 56:30 – 58:00 | Slide 35: 09 | DevSecOps & Production Reliability Engineering
*Visual: `slide_devsecops_safeguards.png`*

> **Cyrus Wong:**  
> "Quality assurance is critical when deploying assessment software. We built a 4-tier automated testing pyramid:
>
> - **1,100+ Automated Tests & Assertions with Zero Flaky Tests:**
>   - **Level 1 (Frontend):** 890 tests across 108 suites achieving **>80% code coverage** in Vitest.
>   - **Level 2 (Backend Cloud Functions):** 151 tests in `functions/ai_flows` + dozens across attendance, auth, media, and scheduled tasks.
>   - **Level 3 (Security Rules):** 42 real-token isolation test scenarios verifying student self-read, exam shielding, and `attendanceAdjustments` privacy.
>   - **Level 4 (Live Smoke Tests):** 28 live end-to-end cloud assertions.
> - **100% Gemini 3 Family Standardization:** Standardized entirely on the Gemini 3 family in compliance with Google Cloud 2026 platform standards.
> - **Automated Dual-Environment CI/CD:** We maintain isolated Development (`it114115-dev-2026`) and Production (`it114115-2627`) projects via `./deploy.sh [dev|prod]`, with pre-bundling validation in `vite.config.js` to prevent credential cross-contamination."

---

### 58:00 – 59:00 | Slide 36: Live System Demonstration: 5-Stage Verification Flow
*Visual: `slide_live_demo_workflow.png`*

> **Cyrus Wong:**  
> "Now let's switch to our live demonstration across 5 stages:
>
> 1. **Student Onboarding:** The student launches the web app, completing the 3-step hardware readiness wizard with full-screen display sharing, dual webcam calibration, and microphone check.
> 2. **Teacher Live Grid:** The instructor opens the Command Center, filtering students by zero-space compliance status.
> 3. **Active Presence Check:** The automated 1-minute Bingo check fires; students receive the chime alert and respond within 45 seconds with window focus detection, while delayed Cloud Tasks handle retries.
> 4. **Targeted Intervention:** The instructor presses `N` to send an instant focus alert, or initiates a 30 FPS WebRTC Live Peek.
> 5. **Instant Verification:** The instructor reviews the synchronized audio waveform seek player, inspects attendance adjustments, and exports the formal incident dossier."

---

### 59:00 – 60:00 | Slide 37: 10 | Empowering Education with Google Cloud & Edge AI
*Visual: `slide_closing_summary.png`*

> **Cyrus Wong:**  
> "To conclude, the Google AI Classroom Assistant demonstrates that educators and software engineers do not need to choose between academic integrity, student privacy, and institutional cost.
>
> By pairing Google Cloud's world-class **Gemini Enterprise Agent Platform (Gemini 3 suite)** with **browser-native edge computing**, we achieved:
> - Complete privacy-by-design with zero raw biometrics egress.
> - 99.8% cost reduction at sub-$0.02 per student.
> - High-density teacher ergonomics that eliminate cognitive overload.
> - Enterprise-grade documentation with comprehensive user manuals and 15 system interaction diagrams.
>
> The entire project is open-source on GitHub, and our live production environment is accessible right now at `https://it114115-2627.web.app`.
>
> Thank you so much for your time today. Let's open the floor for questions and discussion on Edge AI, Google Genkit, and Gemini 3 architecture!"

---

[← Back to Documentation Index](../../README.md#documentation-index)
