# Google Cloud Presentation Masterclass Script & Speaker Notes
## Gemini AI Classroom Assistant & Multimodal Invigilator
**Presenter:** Cyrus Wong (黃俊彥) — Google Developer Expert (GCP & AI/ML)  
Senior Lecturer, Hong Kong Institute of Information Technology (HKIIT), Vocational Training Council (VTC) Hong Kong  
**Event:** Google Cloud Tech Talk & Developer Conference Series  
**Session Length:** 60 Minutes (Deep-Dive Tech Talk + Architecture Breakdown + Live Demo + Q&A)

---

## Master Session Timeline (60 Minutes)

| Timeline | Section | Focus & Architectural Topic | Slides |
| :--- | :--- | :--- | :--- |
| **00:00 – 06:00** | **01 | System Overview** | Welcome, Cyrus Wong GDE Bio, The Real-Time Invigilation & Proctoring Challenge | Slides 1–4 |
| **06:00 – 18:00** | **02 | Hybrid Architecture** | 4-Tier Hybrid Cloud on GCP, Cloud Functions Gen 2 on Cloud Run, Firestore Optimization | Slides 5–7 |
| **18:00 – 30:00** | **03 | Vertex AI & Gemini** | Gemini 3 Suite Routing, Genkit Resilience Interceptor, Structured Schemas | Slides 8–10 |
| **30:00 – 42:00** | **04 | Edge AI & Privacy** | MediaPipe Mesh, LiteRT Whisper & Gemma 4, Cloud Diarization | Slides 11–14 |
| **42:00 – 47:00** | **05 & 06 | Security & Media** | Zero-Trust Exam Mode & Portal Shielding, WebRTC Peek & Pure Frame Broadcaster | Slides 15–16 |
| **47:00 – 52:00** | **07 & 08 | Video AI & FinOps** | Teacher Command Center, FFmpeg TTL, Map-Reduce-Map Milestone Matrix, Cloud FinOps | Slides 17–20 |
| **52:00 – 56:00** | **09 | DevSecOps & Demo** | Incident Dossier Pipeline, 750+ Tests Testing Pyramid, 5-Stage Live Verification | Slides 21–23 |
| **56:00 – 60:00** | **10 | Conclusion & Q&A** | Summary, Open-Source Impact, Google Cloud & Edge AI Takeaways, Q&A | Slide 24 |

---

## Detailed Minute-by-Minute Script & Presenter Talking Points

### 00:00 – 03:00 | Slide 1: Title & Opening Vision
*Visual: `slide_hero_classroom_ai.png`*

> **Cyrus Wong:**  
> "Hello everyone, and welcome to this Google Cloud Tech Talk! I am thrilled to be here with fellow Google Cloud developers, AI practitioners, system architects, and educators. Today, we are exploring: **Architecting Edge-to-Cloud Multimodal AI with Google Cloud, Firebase, and Gemini**.
>
> In technical education and software engineering training, our primary objective is to verify real hands-on competency. But with the rapid emergence of generative AI code copilots, instructors face an unprecedented dilemma: take-home assignments and unmonitored exams no longer reflect authentic student capability.
>
> Over the past year at HKIIT / VTC Hong Kong, we engineered a completely new approach. Rather than relying on invasive, brittle, and expensive commercial proctoring software, we harmonized Google's **Gemini 3 model constellation**, **Google Genkit**, **Google Cloud Run Functions Gen 2**, and browser-native **LiteRT** and **MediaPipe** edge intelligence. The result is an open-source, privacy-preserving classroom assistant that operates at **sub-$0.02 per student per exam**.
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

### 12:00 – 15:00 | Slide 5: 02 | High-Level 4-Tier Hybrid Architecture on GCP
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
> 1. `ai_flows`: Houses our Genkit AI workflows and Vertex AI Gemini integrations.
> 2. `attendance`: Computes per-minute screenshot bucket mapping and attendance percentage aggregations.
> 3. `auth_triggers`: Enforces role-based access control (RBAC), domain auto-provisioning, and campus IP CIDR boundary gating.
> 4. `media_processing`: Executes containerized FFmpeg tasks with hardware acceleration.
> 5. `property_processing`: Ingests and sanitizes high-frequency client telemetry.
> 6. `scheduled_tasks`: Executes declarative TTL retention routines and synchronizes real-time Google Cloud Billing SKU rates.
> 7. `storage_triggers`: Monitors Cloud Storage uploads, generating signed URLs and enforcing storage quotas.
>
> Splitting by domain guarantees zero cold-start cascades and complete deployment isolation."

---

### 18:00 – 21:00 | Slide 7: Cloud Data Optimization: Firestore Single-Stream Channel
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

### 21:00 – 24:00 | Slide 8: 03 | Vertex AI Gemini 3 Constellation & Model Routing
*Visual: `slide_gemini_models_matrix.png`*

> **Cyrus Wong:**  
> "When building AI-powered production systems, one size does not fit all. We deploy Google's **Gemini 3 model suite**, routing each task to its optimal price-performance tier:
>
> 1. **`gemini-3.7-flash` (Deep Multimodal Reasoning):** Our primary model for video exam auditing and cheating forensics. We configure an extended thinking budget to analyze student actions, IDE code edits, and window-switching timelines.
> 2. **`gemini-3.8-flash` (Coursework Rubric & Milestone Synthesis):** Utilized in our Map-Reduce Reduce phase. With its large context window and high throughput, it synthesizes all individual student discoveries into an objective milestone rubric.
> 3. **`gemini-3.5-flash-lite` (Ultra Low Latency Workhorse):** Our fast workhorse for single-frame inspections, structured classification, and dynamic fallback.
> 4. **`gemini-3.5-transcribe-preview` (Long Audio Reasoning):** Handles audio diarization, separating multiple speakers and emitting word-level timestamps.
> 5. **`LiteRT Gemma 4 E2B`:** Runs directly on the edge in student Web Workers at zero cloud cost."

---

### 24:00 – 27:00 | Slide 9: Google Genkit Resilience & Autonomous Tool Calling
*Visual: `slide_genkit_resilience_flow.png`*

> **Cyrus Wong:**  
> "To orchestrate these models reliably in production, we use **Google Genkit**.
>
> In high-concurrency university environments, API rate limits (HTTP 429) or transient cloud spikes (HTTP 503) are inevitable. We built a custom **Resilience Interceptor**:
> - If `gemini-3.7-flash` encounters a transient error, Genkit applies automatic exponential backoff with randomized jitter.
> - If the primary model remains constrained after 3 attempts, the interceptor transparently falls back to `gemini-3.5-flash-lite`.
> - The application never crashes, and student evaluations proceed uninterrupted.
>
> Furthermore, Genkit provides deterministic schema validation using **Zod**. Autonomous tools like `recordTaskDuration` guarantee that structured outputs adhere to our strict TypeScript interfaces before writing to Firestore."

---

### 27:00 – 30:00 | Slide 10: Production Prompt Engineering: Strict Schemas & Tools
*Visual: Markdown prompt snippet with JSON schema*

> **Cyrus Wong:**  
> "Prompt engineering in production is not about casual chatting; it is about deterministic output contracts.
>
> Here you see our prompt for on-device intent classification. Notice three critical engineering choices:
> 1. **Exhaustive Category Enumeration:** We restrict the LLM to five mutually exclusive categories: `COLLUSION_EXAM`, `EXTERNAL_AI_ASSIST`, `UNAUTHORIZED_TALK`, `LEGITIMATE_INQUIRY`, and `BENIGN`.
> 2. **Strict JSON Schema:** The model must emit a single JSON object containing boolean violation status, category, severity, confidence score, evidence quotation, and rationale.
> 3. **No Conversational Filler:** By explicitly constraining the grammar, we achieve 100% parse success rates across tens of thousands of evaluations."

---

### 30:00 – 33:00 | Slide 11: 04 | On-Device Vision AI: 468-Point Mesh & Iris Geometry
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

### 42:00 – 45:00 | Slide 15: 05 | Zero-Trust Assessment Security & Live Exam Mode
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

### 45:00 – 47:00 | Slide 16: 06 | Real-Time Classroom Media Pipelines
*Visual: `slide_realtime_media_pipelines.png`*

> **Cyrus Wong:**  
> "For live classroom interaction, we engineered two distinct real-time pipelines, each optimized for its specific topology:
>
> 1. **1-to-1 WebRTC Live Peek & Talkback:** When an alert fires, the teacher clicks 'Peek'. A direct peer-to-peer WebRTC connection is negotiated over Firestore signaling, delivering 30 FPS crystal-clear video and two-way audio. Zero cloud storage or intermediary media servers are involved.
> 2. **1-to-Many Classroom Frame Broadcaster:** When the instructor wants to demo code to 50 students, traditional WebRTC star-mesh crashes teacher browser CPU and network bandwidth. Instead, we built a lightweight **Pure Frame Broadcaster**:
>    - The teacher's screen is captured into an offscreen canvas and clamped to 720p.
>    - A **32x18 thumbnail pixel delta diffing engine** checks for visual motion, skipping identical frames.
>    - Compressed JPEG frames (~35–65 KB, <8% of Firestore doc limit) are published to `classes/{classId}/screenBroadcast/liveFrame`.
>    - Students receive the stream in a floating Picture-in-Picture window. Teacher CPU remains under 2% regardless of class size!"

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
> "What happens to the media after class?
>
> We engineered an automated 3-phase storage lifecycle:
> 1. **Client Upload:** Regular discrete screenshots are uploaded to Cloud Storage with secure signed URLs.
> 2. **Containerized FFmpeg Cloud Run Worker:** Stitches 300+ screenshots into a compact, timestamped MP4 exam video using CRF 30 and faststart H.264, shrinking storage footprint by 85%.
> 3. **Declarative Firestore TTL Engine (`expireAt`):**
>    - Raw screenshots: Purged automatically after the retention window.
>    - MP4 exam videos: Auto-deleted post-audit according to class retention policy.
>    - Ephemeral ZIP export archives: Purged after 7 days.
>
> This guarantees zero storage bloat and complete compliance with institutional data governance."

---

### 51:00 – 53:00 | Slide 19: 07 | Serverless Map-Reduce-Map Video Intelligence Pipeline
*Visual: `slide_map_reduce_ai_jobs.png`*

> **Cyrus Wong:**  
> "Now let's examine our automated coursework grading pipeline: **Serverless Map-Reduce-Map AI Video Analysis**:
>
> - **Phase 1: Map (Parallel Video Discovery):** The master job fans out parallel Gemini 3.7 vision jobs across all student screen recordings, extracting shell commands, code edits, and milestone attempts.
> - **Phase 2: Reduce (Coursework Rubric Synthesis):** A cross-student aggregator feeds all student discovery summaries into **Gemini 3.8 Flash**, which synthesizes a unified coursework rubric and objective milestone prompt. An animated UI stepper tracks this multi-stage synthesis in real time.
> - **Phase 3: Map (Milestone Evaluation & Matrix):** Mapped AI jobs evaluate each student video against the rubric. Autonomous tool calling logs milestone durations into the **Student Milestone Matrix** (`StudentMilestoneMatrix.jsx`), featuring interactive sortable heatmaps (<20m green, 20-40m amber, >40m red) and 1-click RFC 4180 CSV export."

---

### 53:00 – 54:00 | Slide 20: 08 | Green AI & Cloud FinOps: Institutional Cost Sustainability
*Visual: `slide_ai_cost_finops.png`*

> **Cyrus Wong:**  
> "Here are the unit economics that make this system viable for public education:
>
> - Commercial surveillance SaaS costs **$15 to $25 per student per exam**. For a 50-student class, that is $750.00 to $1,250.00.
> - With our edge-first hybrid architecture, 95% of compute occurs locally on student devices. Cloud audio is pre-filtered by 80% silence reduction, and screenshots are compiled into compact MP4s.
> - The total Google Cloud cost for a 50-student, 2-hour exam is **$0.85 total—less than two cents per student!**
> - In addition, we ingest live Google Cloud Billing Catalog API SKU rates to provide real-time budget forecasting and automated alerts in the teacher dashboard."

---

### 54:00 – 55:00 | Slide 21: Academic Integrity Incident Dossier Pipeline
*Visual: `slide_incident_dossier_workflow.png`*

> **Cyrus Wong:**  
> "If an irregularity occurs, proctors must provide indisputable evidence to faculty disciplinary committees.
>
> We built a **1-Click Incident Dossier Generator**:
> - It aggregates timestamped screenshots, 3D gaze angles, Whisper audio transcripts, and the Gemini reasoning chain.
> - Generates a formal, tamper-evident Microsoft Word (`.docx`) disciplinary report with institutional headers, alongside verifiable raw CSV telemetry logs.
> - Faculty committees receive objective, forensic evidence with zero manual administrative overhead."

---

### 55:00 – 56:00 | Slide 22: 09 | DevSecOps & Production Reliability Engineering
*Visual: `slide_devsecops_safeguards.png`*

> **Cyrus Wong:**  
> "Quality assurance is critical when deploying assessment software. We built a 4-tier automated testing pyramid:
>
> - **750+ Automated Tests & Assertions with Zero Flaky Tests:**
>   - **Level 1 (Frontend):** 603 tests across 87 suites achieving **>80% code coverage** in `web-app`.
>   - **Level 2 (Backend Cloud Functions):** 98 tests across 6 domain codebases.
>   - **Level 3 (Security Rules):** 23 real-token isolation test scenarios.
>   - **Level 4 (Live Smoke Tests):** 28 live end-to-end cloud assertions.
> - **Dual-Environment CI/CD:** We maintain isolated Development (`it114115-dev-2026`) and Production (`it114115-2627`) projects, with pre-bundling validation in `vite.config.js` to prevent credential cross-contamination."

---

### 56:00 – 58:00 | Slide 23: Live System Demonstration: 5-Stage Verification Flow
*Visual: `slide_live_demo_workflow.png`*

> **Cyrus Wong:**  
> "Now let's switch to our live demonstration across 5 stages:
>
> 1. **Student Onboarding:** The student launches the web app, completing the 3-step hardware readiness wizard with full-screen display sharing, dual webcam calibration, and microphone check.
> 2. **Teacher Live Grid:** The instructor opens the Command Center, filtering students by zero-space compliance status.
> 3. **Simulated Anomaly:** A student looks away toward a phone; on-device MediaPipe flags looking-away telemetry in under 200 milliseconds.
> 4. **Targeted Intervention:** The instructor presses `N` to send an instant focus alert, or initiates a 30 FPS WebRTC Live Peek.
> 5. **Instant Verification:** The instructor reviews the synchronized audio waveform seek player and exports the formal incident dossier."

---

### 58:00 – 60:00 | Slide 24: 10 | Empowering Education with Google Cloud & Edge AI
*Visual: `slide_closing_summary.png`*

> **Cyrus Wong:**  
> "To conclude, the Gemini AI Classroom Assistant demonstrates that educators and software engineers do not need to choose between academic integrity, student privacy, and institutional cost.
>
> By pairing Google Cloud's world-class **Vertex AI Gemini 3 suite** with **browser-native edge computing**, we achieved:
> - Complete privacy-by-design with zero raw biometrics egress.
> - 99.8% cost reduction at sub-$0.02 per student.
> - High-density teacher ergonomics that eliminate cognitive overload.
>
> The entire project is open-source on GitHub, and our live production environment is accessible right now at `https://it114115-2627.web.app`.
>
> Thank you so much for your time today. Let's open the floor for questions and discussion on Edge AI, Google Genkit, and Gemini 3 architecture!"
