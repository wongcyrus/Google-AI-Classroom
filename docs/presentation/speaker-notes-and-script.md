# Google Cloud Presentation Masterclass Script & Speaker Notes
## Gemini AI Classroom Assistant & Multimodal Invigilator
**Presenter:** Cyrus Wong (黃俊彥) — Google Developer Expert (GCP & AI/ML)  
Senior Lecturer, Hong Kong Institute of Information Technology (HKIIT), Vocational Training Council (VTC) Hong Kong  
**Event:** Google Cloud Tech Talk & Developer Conference Series  
**Session Length:** 60 Minutes (Deep-Dive Tech Talk + Architecture Breakdown + Live Demo + Q&A)

---

## Master Session Timeline (60 Minutes)

| Timeline | Act | Focus & Topic | Slides |
| :--- | :--- | :--- | :--- |
| **00:00 – 06:00** | **Act I** | Welcome, Cyrus Wong GDE Bio, The Assessment Trilemma & Surveillance vs Assistant | Slides 1–4 |
| **06:00 – 18:00** | **Act II** | 4-Tier Hybrid Cloud Architecture, Cloud Functions Gen 2 on Cloud Run, Firestore Optimization | Slides 5–7 |
| **18:00 – 30:00** | **Act III** | AI Engineering: Gemini 3 Suite Routing, Genkit Tool-Calling, Structured Prompt Schemas | Slides 8–10 |
| **30:00 – 42:00** | **Act IV** | Edge AI & Privacy: MediaPipe Mesh, LiteRT Whisper/Gemma 4, Cloud Diarization, Zero-Trust Exam Mode | Slides 11–15 |
| **42:00 – 52:00** | **Act V** | Teacher Command Center, WebRTC Streaming, Media FFmpeg Lifecycle, FinOps, Dossier & DevSecOps | Slides 16–22 |
| **52:00 – 57:00** | **Act VI** | Live Interactive System Demonstration (5-Stage Verification Flow) | Slide 23 |
| **57:00 – 60:00** | **Act VI** | Summary, Open-Source Impact, Google Cloud & Edge AI Takeaways, Q&A | Slide 24 |

---

## Detailed Minute-by-Minute Script & Presenter Talking Points

### 00:00 – 03:00 | Slide 1: Title & Opening Vision
*Visual: `slide_hero_classroom_ai.png`*

> **Cyrus Wong:**  
> "Hello everyone, and welcome to this Google Cloud Tech Talk! I am thrilled to be here with fellow Google Cloud developers, AI practitioners, system architects, and educators. Today, we are discussing: **Architecting Edge-to-Cloud Multimodal AI with Google Cloud, Firebase, and Gemini**.
>
> In technical education and software training, our mission is to develop real, hands-on engineering competency. But the explosion of generative AI has presented a formidable architectural challenge: how do you build an honest, transparent, and scalable assessment platform when AI copilots can generate production code in milliseconds?
>
> Over the past year at HKIIT / VTC Hong Kong, we set out to solve this without falling into the trap of invasive, expensive commercial proctoring software. By harmonizing Google's **Gemini 3 model suite**, **Google Genkit**, **Cloud Functions Gen 2 on Cloud Run**, and browser-native **LiteRT** and **MediaPipe** edge intelligence, we built a fully open-source, privacy-preserving classroom assistant that costs **less than two cents per student per exam**.
>
> Today, I'll walk you through the end-to-end architecture, our cloud optimizations, and the lessons learned shipping this to production."

---

### 03:00 – 06:00 | Slide 2: Speaker Biography
*Visual: `slide_speaker_bio_triple_cloud.png`*

> **Cyrus Wong:**  
> "A brief introduction before we dive into the code. I am Cyrus Wong, Senior Lecturer at HKIIT, Vocational Training Council (VTC) in Hong Kong, where I lead our Higher Diploma in Cloud and Data Centre Administration.
>
> I have spent the last decade building practical cloud architectures and bringing industrial best practices directly into the classroom. I am privileged to contribute actively across the global developer community:
> - As a **Google Developer Expert (GDE)** in **Google Cloud Platform (GCP)** and **AI/ML**.
> - As an **AWS AI Hero** (since 2016, and the first AWS Academy instructor globally).
> - As a **Microsoft MVP** in Azure AI.
>
> Being a Triple Cloud community lead gives me a unique perspective on cost engineering and architectural pragmatism. When deploying solutions across hundreds of students every week, two rules govern every architectural decision: **simplicity creates reliability**, and **uncontrolled cloud API costs will kill your project**. Every architectural pattern we share today has been battle-tested under strict production constraints."

---

### 06:00 – 09:00 | Slide 3: The Assessment Trilemma in Technology Education
*Visual: `slide_assessment_trilemma.png`*

> **Cyrus Wong:**  
> "Let's first define the engineering and pedagogical problem. In computer science and cloud education, instructors face what we call **The Assessment Trilemma**:
>
> 1. **Academic Integrity:** Take-home coding exams and unmonitored assignments are fundamentally compromised by AI assistance. In physical computer labs, unauthorized peer collaboration, whispered answers, second monitors, and screen swapping are pervasive.
> 2. **Student Privacy & Trust:** Commercial proctoring tools respond with brute force: installing ring-0 kernel drivers that inspect students' private files, lock down their OS, and continuously stream raw biometric video to third-party clouds. Students rightly push back against these privacy violations.
> 3. **Institutional Cost Barrier:** Traditional commercial proctoring SaaS charges between **$15 and $25 per student per exam**. For a public vocational college or university with thousands of students taking weekly lab tests, annual licensing fees exceed hundreds of thousands of dollars.
>
> We refused to accept this trade-off. We asked: can we build an edge-first, cloud-native architecture that satisfies all three vertices of the triangle simultaneously?"

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

### 12:00 – 15:00 | Slide 5: High-Level 4-Tier Hybrid Architecture
*Visual: `slide_hybrid_architecture.png`*

> **Cyrus Wong:**  
> "Here is our 4-tier hybrid architecture:
>
> 1. **Student Browser Edge (Client Tier):** Runs React with Vite, orchestrating dual-channel screen and camera capture. It houses isolated Web Workers executing MediaPipe FaceLandmarker, LiteRT Whisper STT, and LiteRT Gemma 4 E2B via WebAssembly and WebGPU.
> 2. **Realtime Signaling & Data Layer (Firebase Tier):** Firestore acts as our low-latency distributed state bus. Cloud Storage handles discrete screenshot chunks, compiled MP4 timelapse recordings, and audit archives.
> 3. **Serverless Cloud Intelligence (Google Cloud Run / Functions Gen 2):** Decoupled micro-codebases handle automated media compilation via FFmpeg, Genkit AI flows, and scheduled TTL lifecycle routines.
> 4. **Teacher Command Center (Instructor Tier):** A high-density dashboard that gives the instructor a real-time compliance matrix, targeted nudges, and 1-click WebRTC live peek capabilities."

---

### 15:00 – 18:00 | Slide 6: Google Cloud Run & Cloud Functions Gen 2 Topology
*Visual: `slide_cloud_functions_gen2.png`*

> **Cyrus Wong:**  
> "Behind the scenes, we leverage **Firebase Functions Gen 2**, which run directly on **Google Cloud Run** in `asia-east2` (Hong Kong).
>
> We split our backend into **7 isolated domain micro-codebases**:
> 1. `ai_flows`: Houses our Genkit flows and Gemini multimodal reasoning logic.
> 2. `attendance`: Computes aggregated session presence rollups and screen-time heatmaps.
> 3. `auth_triggers`: Handles institution domain auto-provisioning (`@stu.vtc.edu.hk`) and IP CIDR subnet gating.
> 4. `media_processing`: Runs containerized FFmpeg workers for screenshot-to-video stitching.
> 5. `property_processing`: Ingests high-frequency classroom telemetry.
> 6. `scheduled_tasks`: Executes declarative TTL cleanup and syncs Google Cloud Billing SKU rates.
> 7. `storage_triggers`: Manages storage quota governance and cascading file lifecycles.
>
> Because Gen 2 runs on Cloud Run, each function scales independently with built-in concurrency. A spike in video compilation jobs never degrades or blocks our real-time AI reasoning endpoints."

---

### 18:00 – 21:00 | Slide 7: Cloud Data Optimization: Firestore Single-Stream Channel
*Visual: Code snippet with `onSnapshot`*

> **Cyrus Wong:**  
> "One of the most important lessons in cloud database design is avoiding naive fan-out listeners.
>
> Consider a classroom with 50 students. If each student dashboard writes a heartbeat document, and the teacher dashboard listens to all 50 sub-documents independently, you generate 2,500 Firestore read operations every 5 seconds. In a two-hour exam, that equates to **over 72,000 document reads per classroom**, quickly burning through quotas.
>
> Our solution is the **Firestore Single-Stream Aggregation Channel**:
> - An in-memory aggregation worker batches student heartbeats into a single atomic document: `classes/{classId}/status/current`.
> - The Teacher Command Center binds a single `onSnapshot` listener to that one document.
> - Result: **Read operations plunge by 98%**, network chatter is minimized, and the dashboard updates in under 200 milliseconds."

---

### 21:00 – 24:00 | Slide 8: Google Gemini 3 Suite & Model Routing Strategy
*Visual: `slide_gemini_models_matrix.png`*

> **Cyrus Wong:**  
> "Let's talk about AI model engineering. In production, one model cannot solve every problem optimally. We deploy a dynamic routing matrix across the **Google Gemini 3 family**:
>
> - **`gemini-3.7-flash`:** Our deep multimodal reasoning engine. When an incident occurs or when compiling post-exam video analyses, we leverage its extended thinking budget to synthesize complex multi-frame context and identify cheating patterns.
> - **`gemini-3.5-flash-lite`:** Our ultra-low-latency, low-cost workhorse. It performs single-frame anomaly classification, instant tool calling, and acts as a high-speed fallback.
> - **`gemini-3.5-transcribe-preview`:** Dedicated long-audio model handling multi-speaker acoustic invigilation, diarization, and word-level seekable timestamps.
> - **`LiteRT Gemma 4 E2B`:** Our edge proctor running entirely in the browser Web Worker. It classifies conversational speech intent with zero cloud egress cost."

---

### 24:00 – 27:00 | Slide 9: Google Genkit Resilience & Autonomous Tool Calling
*Visual: `slide_genkit_resilience_flow.png`*

> **Cyrus Wong:**  
> "To orchestrate our Gemini models, we use **Google Genkit**. Genkit provides enterprise-grade observability, telemetry, and structured tool calling.
>
> In real-world educational exams, API calls must never fail silently. We engineered a **Resilience Interceptor**:
> - When calling `gemini-3.7-flash`, if transient HTTP 429 or 503 errors occur, Genkit applies exponential backoff with randomized jitter.
> - If retries are exhausted after three attempts, it automatically falls back to `gemini-3.5-flash-lite`.
> - All Genkit tools—such as `recordAudioIrregularity`, `recordTaskDuration`, and `sendMessageToStudent`—are governed by strict Zod schemas, guaranteeing valid JSON payloads that can be written directly to Firestore collections."

---

### 27:00 – 30:00 | Slide 10: Production Prompt Engineering: Strict Schemas & Tools
*Visual: Prompt schema markdown*

> **Cyrus Wong:**  
> "Prompt engineering in production requires deterministic outputs. We do not accept free-form text from models.
>
> On this slide is our intent classification prompt used by our on-device proctor:
> - The output is constrained to an exact enum: `COLLUSION_EXAM`, `EXTERNAL_AI_ASSIST`, `UNAUTHORIZED_TALK`, `LEGITIMATE_INQUIRY`, or `BENIGN`.
> - The model outputs a single structured JSON object with severity, confidence score, quoted evidence snippet, and a one-sentence rationale.
> - This structured output is validated via Zod before any alert appears on the instructor's console, completely eliminating hallucinations."

---

### 30:00 – 33:00 | Slide 11: On-Device Vision AI: 468-Point Mesh & Iris Geometry
*Visual: `slide_edge_vision_gaze.png`*

> **Cyrus Wong:**  
> "Now let's examine the edge tier. How do we detect gaze diversion without streaming video to Google Cloud?
>
> We embed Google's **MediaPipe FaceLandmarker** running WebAssembly in a Web Worker:
> - **3D Head Pose:** We compute real-time Yaw, Pitch, and Roll matrices. A Yaw beyond $\pm 25^\circ$ indicates looking away; a Pitch beyond $\pm 20^\circ$ detects looking down at a mobile phone.
> - **Metric Iris Distance:** Using the physiological constant of human iris diameter (11.7 mm) and camera focal length $f_x$, we estimate exact metric distance:
>   $$D = \frac{11.7\text{ mm} \times f_x}{\Delta\text{Iris}_{\text{pixels}}}$$
> - **Facial Ratios:** We calculate **Eye Aspect Ratio (EAR)** for drowsiness and blink duration, and **Mouth Aspect Ratio (MAR)** for whispering detection.
> - **1-Click Baseline Calibration:** Students simply click 'Calibrate View' during onboarding to zero out their natural seating posture."

---

### 33:00 – 36:00 | Slide 12: Vision Code Deep Dive: Hardware-Synchronized Loop
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

### 36:00 – 39:00 | Slide 13: Browser-Native Edge Speech AI: LiteRT Whisper & Gemma 4
*Visual: `slide_edge_speech_proctor.png`*

> **Cyrus Wong:**  
> "Beyond vision, we run edge audio invigilation using **LiteRT** (Google's lightweight runtime for TensorFlow Lite and on-device models):
> - The Web Audio API captures a 16kHz Float32 stream.
> - Our `litertWhisper.worker.js` provides real-time bilingual English and Cantonese speech-to-text directly in the browser.
> - Spoken sentences are passed to `litertGemma.worker.js` (Gemma 4 E2B) for intent classification.
> - **Browser Cache Persistence:** Using `caches.open('litert-gemma-cache-v1')` and `navigator.storage.persist()`, models are downloaded once during the first orientation and persisted offline permanently.
> - Cloud egress cost: **$0.00**."

---

### 39:00 – 42:00 | Slide 14: Cloud Audio Diarization & Moving Window Timeline
*Visual: `slide_cloud_audio_diarization.png`*

> **Cyrus Wong:**  
> "When high-stakes verification is required, we pair edge speech processing with cloud audio reasoning:
> - We implement a **rolling 30-second window** with a 15-second overlapping stride.
> - **Client-Side RMS Silence Suppression:** If the ambient sound energy falls below a calibrated noise floor, the chunk is dropped immediately in the browser. Over **80% of silence is filtered locally**, saving massive network bandwidth and cloud storage.
> - The remaining chunks are analyzed by **Gemini 3.5 Transcribe Preview**, which performs multi-speaker diarization (`Student` vs `External Voice`).
> - Instructors get an interactive audio timeline: clicking any transcribed word automatically seeks the audio player to that exact millisecond."

---

### 42:00 – 45:00 | Slide 15: Zero-Trust Assessment Confidentiality & Live Exam Mode
*Visual: `slide_exam_mode_zero_trust.png`*

> **Cyrus Wong:**  
> "A core requirement from educators is: *during examinations, assessment materials and recordings must remain strictly confidential*. Students must not view or share exam screencasts.
>
> We implemented an end-to-end **Zero-Trust Exam Protection Architecture**:
> 1. **Zero-Trust Cloud Storage Rules:** In `storage.rules`, student read access to `/videos/{classId}/{videoId}` is rejected if `resource.metadata.isExam == 'true'`. Even direct URL manipulation is blocked at the storage layer.
> 2. **Backend Metadata Stamping:** Our containerized FFmpeg video compiler checks `isExamTimeRange` against scheduled `examPeriods` and stamps `isExam: 'true'` onto GCS custom metadata and Firestore records.
> 3. **Student Portal Hardening:** In `StudentRecordsView.jsx`, exam videos, speech transcripts, and irregularity evidence are shielded behind confidentiality banners. Direct download fallbacks abort immediately on permission denial.
> 4. **Live Exam Mode Toggle:** Instructors can toggle `🔒 Exam Mode: ACTIVE` in the Command Center at any moment. The student client instantly detects this and enforces full-screen desktop sharing (`requireFullScreenOnly: true`), preventing off-screen cheating."

---

### 45:00 – 47:00 | Slide 16: Dual Real-Time WebRTC Media Streaming Topologies
*Visual: `slide_webrtc_topologies.png`*

> **Cyrus Wong:**  
> "For live classroom interaction, we engineered two distinct real-time topologies:
> - **1-to-1 WebRTC Live Peek & Talkback:** When an alert fires, the teacher clicks 'Peek'. A peer-to-peer WebRTC connection is negotiated over Firestore signaling, delivering 30 FPS crystal-clear video and two-way audio. Zero cloud storage or intermediary media servers are involved.
> - **1-to-Many Teacher Screen Broadcaster:** Delivering a live screen broadcast to 50 students via standard WebRTC mesh would crash classroom bandwidth. Instead, we built a lightweight frame broadcaster: the teacher's screen is captured at 720p, processed through a 32x18 thumbnail pixel delta diffing engine, and only changing frames are emitted to Firestore. Students view the teacher's demo in a floating Picture-in-Picture window."

---

### 47:00 – 49:00 | Slide 17: Teacher Command Center: Solving Cognitive Overload
*Visual: `slide_teacher_command_center.png`*

> **Cyrus Wong:**  
> "Monitoring 50 live video feeds simultaneously causes extreme cognitive fatigue for human proctors.
>
> Our Teacher Command Center solves this:
> - **Zero-Space Compliance Filters:** Instructors filter the grid with a single click: `⚠️ Problems`, `📷 Missing Cam`, `🎙️ Missing Mic`, `🖥️ Not Sharing`, or `🚨 AI Alerts`.
> - **1-Click Targeted Nudge (`N`):** Selecting a student tile and pressing `N` instantly transmits a gentle focus notification to that student's screen.
> - **Offline Resilience:** If a student experiences a network glitch, their tile caches the last known frame and marks them as `(Offline)`."

---

### 49:00 – 51:00 | Slide 18: Cloud Media Lifecycle & Automated Storage Governance
*Visual: `slide_cloud_storage_ffmpeg_ttl.png`*

> **Cyrus Wong:**  
> "Managing student media files at scale requires strict data governance:
> 1. **Client Frame Upload:** The browser uploads discrete JPEG frames to Cloud Storage via secure signed URLs.
> 2. **Containerized FFmpeg Cloud Run Worker:** Stitches hundreds of screenshots into a compact MP4 timelapse (CRF 30, faststart H.264), reducing storage volume by 85%.
> 3. **Declarative Firestore TTL Engine (`expireAt`):**
>    - Raw screenshots are purged automatically after video compilation.
>    - MP4 exam videos expire after the class retention window.
>    - Temporary ZIP export archives are deleted after 7 days.
> This guarantees institutional GDPR compliance with zero manual intervention."

---

### 51:00 – 53:00 | Slide 19: Map-Reduce AI Video Analysis & Performance Reporting
*Visual: `slide_map_reduce_ai_jobs.png`*

> **Cyrus Wong:**  
> "After an exam or hands-on lab, instructors want granular performance feedback. We designed a **Map-Reduce AI Video Analysis Pipeline**:
> - **Map Phase 1:** Parallel Gemini 3.7 vision jobs ingest each student's screencast, extracting timestamped terminal commands and lab actions.
> - **Reduce Phase:** An aggregator combines all student observations into Gemini 3.8 Flash, which synthesizes a unified lab milestone rubric.
> - **Map Phase 2:** A second batch job evaluates each student against the synthesized rubric, using the `recordTaskDuration` Genkit tool to construct the **Student Milestone Matrix**."

---

### 53:00 – 55:00 | Slide 20: Green AI & Google Cloud FinOps
*Visual: `slide_ai_cost_finops.png`*

> **Cyrus Wong:**  
> "Let's review the cloud economics. This slide shows the exact cost breakdown for a 50-student, 2-hour examination:
> - Commercial SaaS costs **$750 to $1,250** per exam.
> - Our Google Cloud architecture costs **$0.85 total**—or **<$0.02 per student**.
>
> How do we achieve this?
> - **Edge Compute:** 95%+ of computer vision runs on student devices ($0 server cost).
> - **Audio Filtering:** Silence suppression cuts 80% of audio before hitting Vertex AI.
> - **Video Compression:** Discrete frames stitched into MP4 cut storage costs by 90%.
> - **Live FinOps Integration:** Our scheduled task queries the Google Cloud Billing Catalog API, maintaining real-time SKU pricing in `system_config/pricing`."

---

### 55:00 – 56:30 | Slide 21: Academic Integrity Incident Dossier Pipeline
*Visual: `slide_incident_dossier_workflow.png`*

> **Cyrus Wong:**  
> "When academic misconduct occurs, disciplinary committees require incontrovertible proof.
>
> Our **Incident Dossier Pipeline** automates this completely:
> - With one click, the system compiles a complete forensic report: high-resolution screenshots, 3D head pose matrices, verbatim transcripts, and Gemini's reasoning chain.
> - It outputs an official **Microsoft Word (`.docx`) dossier** alongside verifiable raw CSV audit logs.
> - What used to take instructors hours of manual screenshot-taking and log compiling is now finished in 5 seconds."

---

### 56:30 – 58:00 | Slide 22: DevSecOps & Production Reliability Engineering
*Visual: `slide_devsecops_safeguards.png`*

> **Cyrus Wong:**  
> "Reliability in educational production is non-negotiable. If software crashes during a final exam, the exam is invalidated.
>
> We built a **Four-Tier Automated Testing Pyramid with 750+ tests and assertions**:
> - **Level 1 (Frontend):** 603 unit and component tests covering Web Workers, hooks, and UI states.
> - **Level 2 (Backend):** 98 tests across 6 isolated Cloud Function codebases.
> - **Level 3 (Security Rules):** 23 real-token isolation test scenarios.
> - **Level 4 (System Smoke Tests):** 28 live end-to-end assertions against real Google Cloud environments.
>
> Our deployment pipeline maintains dual Google Cloud environments (`it114115-dev-2026` for development and `it114115-2627` for production), backed by pre-bundling credential guardrails."

---

### 58:00 – 59:00 | Slide 23: Live System Demonstration: 5-Stage Verification Flow
*Visual: `slide_live_demo_workflow.png`*

> **Cyrus Wong:**  
> "In our live demonstration, you can see all five stages operating in harmony:
> 1. The student completes the 3-step hardware onboarding wizard and 1-click calibration.
> 2. The teacher monitor displays real-time compliance tiles.
> 3. An edge anomaly (looking away or whispering) triggers instant local telemetry.
> 4. The teacher triggers a targeted nudge (`N`) and verifies via WebRTC Live Peek.
> 5. The audio timeline seeks to exact spoken words, and the Word incident dossier is exported with one click."

---

### 59:00 – 60:00 | Slide 24: Empowering Education with Google Cloud & Edge AI
*Visual: `slide_closing_summary.png`*

> **Cyrus Wong:**  
> "To conclude: by combining **Google Cloud's serverless ecosystem**, **Gemini 3 multimodal intelligence**, and **browser-native edge computing**, we demonstrated that high-integrity educational technology does not require invasive surveillance or expensive licensing.
>
> - The live system is running right now at: `https://it114115-2627.web.app`
> - The entire project is open-source on GitHub at: `github.com/wongcyrus/Gemini-AI-Classroom-Assistant`
>
> Thank you very much! I look forward to your questions and exploring collaborative opportunities with developer communities and educational institutions worldwide."
