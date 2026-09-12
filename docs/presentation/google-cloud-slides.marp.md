---
marp: true
theme: default
paginate: true
header: "Google Cloud Tech Talk | Gemini AI Classroom Assistant & Invigilator | Cyrus Wong (GDE)"
footer: "Google Developer Expert (GCP & AI/ML) | HKIIT, VTC Hong Kong | github.com/wongcyrus/Gemini-AI-Classroom-Assistant"
style: |
  section {
    background-color: #0f172a;
    color: #f1f5f9;
    font-family: "Google Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  h1 {
    color: #4285F4;
  }
  h2 {
    color: #38bdf8;
  }
  h3 {
    color: #34A853;
  }
  code {
    background: #1e293b;
    color: #FBBC05;
  }
  pre {
    background: #020617;
    border: 1px solid #334155;
  }
  a {
    color: #60a5fa;
  }
  footer, header {
    color: #94a3b8;
    font-size: 0.65rem;
  }
  .highlight-google {
    color: #4285F4;
    font-weight: bold;
  }
  .highlight-green {
    color: #34A853;
    font-weight: bold;
  }
  .highlight-amber {
    color: #FBBC05;
    font-weight: bold;
  }
  .highlight-red {
    color: #EA4335;
    font-weight: bold;
  }
---

<!-- _class: lead -->
# Gemini AI Classroom Assistant & Multimodal Invigilator
### Architecting Edge-to-Cloud Multimodal AI with Google Cloud, Firebase & Gemini
**Google Cloud Tech Talk & Developer Conference Series**  
**Presenter:** **Cyrus Wong (黃俊彥)** — Google Developer Expert (GCP & AI/ML)  
Senior Lecturer, Hong Kong Institute of Information Technology (HKIIT), VTC Hong Kong

![width:920px](images/slide_hero_classroom_ai.png)

---

## About the Speaker: Cyrus Wong (黃俊彥)
### Senior Lecturer, HKIIT / VTC Hong Kong & Google Developer Expert

![bg right:55% 95%](images/slide_speaker_bio_triple_cloud.png)

- **Institution:** Hong Kong Institute of Information Technology (HKIIT), Vocational Training Council (VTC)
- **Specialization:** Cloud & Data Centre Administration, Edge AI Systems Architecture
- **Global Recognitions (Triple Cloud):**
  - <span class="highlight-google">Google Developer Expert (GDE)</span> in **Google Cloud Platform (GCP)** & **AI/ML**
  - **AWS AI Hero** (since 2016; 1st AWS Academy Instructor globally)
  - **Microsoft MVP** in Azure AI
- **Email:** `cywong@vtc.edu.hk`
- **GitHub:** `wongcyrus/Gemini-AI-Classroom-Assistant`

---

## Act I: The Assessment Trilemma in Technology Education
### Why Traditional Invigilation and Commercial Surveillance Fail at Scale

![bg right:60% 95%](images/slide_assessment_trilemma.png)

1. **Academic Integrity:**
   - LLMs & AI Copilots make unsupervised coding exams unreliable.
   - Screen swapping, second monitors, and whispered peer collusion.
2. **Student Privacy & Trust:**
   - Hostile kernel surveillance drivers cause student backlash and privacy/GDPR violations.
3. **Institutional Cost Barrier:**
   - Commercial SaaS costs $15–$25 per student per exam—unsustainable for public educational institutions.

---

## Paradigm Shift: Surveillance Spyware vs. Edge-AI Assistant
### Moving from Punitive Surveillance to Privacy-Preserving Pedagogy

![bg right:60% 95%](images/slide_proctoring_evolution.png)

- **Legacy Surveillance Proctoring:**
  - Kernel-level drivers (risk of BSOD and system compromise).
  - 100% continuous video streaming (Wi-Fi bandwidth collapse).
  - High false-positive flags with zero pedagogical context.
  - $15–$25/student institutional licensing fees.
- **Our Edge-AI Classroom Assistant:**
  - **100% Browser-Native** (Zero software installation).
  - **95%+ Local Edge Compute** (Zero raw biometrics leave student laptop).
  - Real-time teacher command center with 1-click targeted nudges.
  - <span class="highlight-green">Sub-$0.02 per student total cloud cost.</span>

---

## Act II: High-Level 4-Tier Hybrid Architecture
### Balancing Extreme Low Bandwidth at the Edge with Hyperscale Cloud Reasoning

![width:1050px](images/slide_hybrid_architecture.png)

1. **Student Browser Edge:** MediaPipe FaceLandmarker, LiteRT Whisper STT, LiteRT Gemma 4 E2B Web Workers.
2. **Realtime Signaling & Data:** Firestore single-stream status channel + Cloud Storage chunks.
3. **Cloud Intelligence & Serverless:** Cloud Run Functions Gen 2, Vertex AI Gemini 3.7 & 3.5.
4. **Teacher Command Center:** Live compliance matrix, WebRTC live peek, and broadcast nudges.

---

## Google Cloud Run & Cloud Functions Gen 2 Topology
### 7 Isolated Domain Micro-Codebases Deployed in `asia-east2` (Hong Kong)

![bg right:60% 95%](images/slide_cloud_functions_gen2.png)

- **Modular Domain Boundaries:**
  1. `ai_flows`: Genkit & Vertex AI Gemini reasoning
  2. `attendance`: Aggregated status rollups & screen-time heatmaps
  3. `auth_triggers`: Domain auto-provisioning & IP CIDR gating
  4. `media_processing`: Containerized FFmpeg workers
  5. `property_processing`: Realtime telemetry ingestion
  6. `scheduled_tasks`: Declarative TTL cleanup & SKU pricing sync
  7. `storage_triggers`: Upload quotas & cascading lifecycle
- **Zero Cold-Start Cascades:** Independent scaling and deployment isolation.

---

## Cloud Data Optimization: Firestore Single-Stream Channel
### 98% Read Operation Reduction in High-Density Computer Labs

```javascript
// web-app/src/hooks/useMonitorClass.js: Atomic Single Listener
const statusDocRef = doc(db, 'classes', classId, 'status', 'current');

const unsubscribe = onSnapshot(statusDocRef, (snapshot) => {
  if (!snapshot.exists()) return;
  
  // Single atomic payload containing all 50 students
  const { activeStudents, lastUpdated } = snapshot.data();
  updateStudentGrid(activeStudents);
});
```

- **The Naive Flaw:** 50 students $\times$ 50 dashboard listeners = 2,500 reads every 5 seconds.
- **The Single-Stream Solution:** Background aggregator combines student heartbeats into 1 single document.
- **Teacher Dashboard:** 1 read per polling interval. Quota exhaustion eliminated!

---

## Act III: Google Gemini 3 Suite & Model Routing Strategy
### Matching Model Capabilities, Latency Profiles, and Cost Parameters

![bg right:60% 95%](images/slide_gemini_models_matrix.png)

- **`gemini-3.7-flash` (Deep Multimodal Reasoning):**
  - Extended thinking budget for complex multimodal video exam analysis and cheating forensic reports.
- **`gemini-3.5-flash-lite` (Ultra Low Latency Workhorse):**
  - Rapid single-frame inspection, instant tool calling, resilient failover target.
- **`gemini-3.5-transcribe-preview` (Long Audio Reasoning):**
  - Native multi-speaker diarization, ambient noise suppression, word-level seekable timestamps.
- **`LiteRT Gemma 4 E2B` (On-Device Edge Proctor):**
  - Runs in browser Web Worker via WebGPU/WASM at $0 cloud cost.

---

## Google Genkit Resilience & Autonomous Tool Calling
### Self-Healing Failover, Exponential Backoff, and Deterministic Zod Validation

![bg right:60% 95%](images/slide_genkit_resilience_flow.png)

```javascript
// functions/ai_flows/analysisFlows.js: Resilience Interceptor
async function generateWithResilience(prompt, context, retryCount = 0) {
  try {
    return await ai.generate({ model: 'gemini-3.7-flash', prompt });
  } catch (err) {
    if ((err.status === 503 || err.status === 429) && retryCount < 3) {
      await sleep(Math.pow(2, retryCount) * 1000 + Math.random() * 500);
      return generateWithResilience(prompt, context, retryCount + 1);
    }
    // Dynamic fallback to lightweight model
    return await ai.generate({ model: 'gemini-3.5-flash-lite', prompt });
  }
}
```

---

## Production Prompt Engineering: Strict Schemas & Tools

```markdown
<!-- admin/prompts/audios/AI Speech Intent Proctor (Gemma On-Device).md -->
You are an AI exam proctor. Classify a student's spoken transcript by meaning and context.
Use exactly one category:
- COLLUSION_EXAM: discussing exam questions, answers, options, code snippets
- EXTERNAL_AI_ASSIST: querying Siri, Alexa, phone AI, ChatGPT via voice
- UNAUTHORIZED_TALK: casual conversation with peers
- LEGITIMATE_INQUIRY: technical question addressed to teacher/proctor
- BENIGN: self-talk, thinking aloud, reading code, background noise

Respond with ONLY one valid JSON object:
{
  "isViolation": boolean,
  "category": "COLLUSION_EXAM" | "EXTERNAL_AI_ASSIST" | "UNAUTHORIZED_TALK" | "LEGITIMATE_INQUIRY" | "BENIGN",
  "severity": "critical" | "high" | "medium" | "low" | "none",
  "confidence": 0.95,
  "evidence": "quoted speech snippet",
  "rationale": "one-sentence explanation"
}
```

---

## Act IV: On-Device Vision AI: 468-Point Mesh & Iris Geometry
### MediaPipe Landmarker in Web Workers (Zero UI Thread Jank)

![bg right:60% 95%](images/slide_edge_vision_gaze.png)

- **3D Head Pose Matrix:**
  - Real-time Yaw, Pitch, Roll calculation.
  - Yaw $\pm 25^\circ$ = Looking Away.
  - Pitch $\pm 20^\circ$ = Looking Down at Phone.
- **Metric Iris Distance:**
  $$D = \frac{11.7\text{ mm} \times f_x}{\Delta\text{Iris}_{\text{pixels}}}$$
- **Facial Ratios:**
  - **EAR (Eye Aspect Ratio):** Drowsiness & blink duration.
  - **MAR (Mouth Aspect Ratio):** Whispering & talking detection.
- **1-Click Baseline Calibration HUD:** Neutral view offset zeroing.

---

## Vision Code Deep Dive: Hardware-Synchronized Loop

```javascript
// web-app/src/hooks/useFaceMonitor.js
const processFrame = async (now, metadata) => {
  if (!workerRef.current || !isDetecting) return;

  // Zero-copy Transferable ImageBitmap transferred to Web Worker
  const bitmap = await createImageBitmap(videoEl);
  workerRef.current.postMessage(
    { type: 'DETECT_FRAME', bitmap, timestamp: now },
    [bitmap] // Instant zero-copy memory ownership transfer
  );

  // Synchronized directly with GPU hardware refresh rate
  videoEl.requestVideoFrameCallback(processFrame);
};
```

- Zero dropped frames on budget Chromebooks and student laptops.
- Web Worker isolates MediaPipe WASM computation from React rendering.

---

## Browser-Native Edge Speech AI: LiteRT Whisper & Gemma 4
### Bilingual Cantonese & English Code-Switching with Zero Cloud Egress

![bg right:60% 95%](images/slide_edge_speech_proctor.png)

- **16kHz Float32 Audio Stream:** Captured via Web Audio API.
- **LiteRT Whisper STT Worker:** Real-time bilingual transcription.
- **LiteRT Gemma 4 E2B Worker:** Real-time intent classification.
- **Browser Cache Storage Persistence:**
  - `caches.open('litert-gemma-cache-v1')` caches ~1.5 GB model locally.
  - `navigator.storage.persist()` prevents browser disk eviction.
- **Sub-$0.00 Cloud Incurrence:** Total privacy-by-design.

---

## Cloud Audio Diarization & Moving Window Timeline
### RMS Silence Suppression Drops >80% Audio Locally; Gemini Diarizes

![bg right:60% 95%](images/slide_cloud_audio_diarization.png)

- **Rolling 30-Second Window:** 15-second overlapping stride ensures continuous context across boundaries.
- **Web Audio RMS Silence Detection:** Silent audio chunks are dropped right in the browser. Quota saved: >80%!
- **Google Cloud Vertex AI Gemini 3.5 Transcribe:** Multi-speaker separation (`Student` vs `External Voice`).
- **Synchronized Waveform Seek:** Teachers click any word to jump audio directly to that exact millisecond.

---

## Zero-Trust Assessment Confidentiality & Live Exam Mode
### Protecting Exam Integrity Across Storage Rules, Backend & Student Portal

![bg right:60% 95%](images/slide_exam_mode_zero_trust.png)

- **Zero-Trust Cloud Storage Rules:**
  - `storage.rules`: Student video access rejected if `resource.metadata.isExam == 'true'`.
- **Backend Metadata Stamping:**
  - Containerized FFmpeg worker evaluates `isExamTimeRange` and stamps `isExam: 'true'` onto GCS objects & Firestore jobs.
- **Student Portal Hardening (`StudentRecordsView.jsx`):**
  - Withholds exam videos, audio transcripts, and irregularity evidence behind security shields.
  - Aborts direct download fallbacks immediately on permission denial.
- **Live Classroom Exam Mode:**
  - Instructor toggles `🔒 Exam Mode: ACTIVE` in Teacher Command Center.
  - Student client enforces mandatory full-screen desktop sharing (`requireFullScreenOnly: true`).

---

## Act V: Dual Real-Time WebRTC Media Streaming Topologies
### 1-to-1 Live Peek & 1-to-Many Teacher Screen Broadcasting

![bg right:60% 95%](images/slide_webrtc_topologies.png)

- **1-to-1 WebRTC Live Peek & Talkback:**
  - Direct P2P connection between teacher and student.
  - 30 FPS smooth video verification.
  - Zero cloud storage cost and zero intermediary servers.
- **1-to-Many Teacher Screen Broadcast:**
  - Lightweight frame streaming delivering teacher screen to 50+ students.
  - Offscreen 720p clamping with 32x18 thumbnail pixel delta diffing.
  - Displays inside student browser as a floating Picture-in-Picture (PiP) modal.

---

## Teacher Command Center: Solving Cognitive Overload
### Zero-Space Compliance Filtering & 1-Click Targeted Nudge ('N')

![bg right:60% 95%](images/slide_teacher_command_center.png)

- **Zero-Space Compliance Filter:** Instantly isolate students flagged with `Problems` or `Critical Alerts`.
- **1-Click Targeted Nudge:** Press `N` keyboard shortcut to display a gentle focus alert on the student's screen.
- **Offline Resilience:** If a student disconnects, their tile caches the last known frame and displays `(Offline)`.
- **Integrated Video Peek:** Instant one-click jump to full-screen peer-to-peer live stream.

---

## Cloud Media Lifecycle & Automated Storage Governance
### Automatic Screenshot-to-MP4 Compilation & Declarative Firestore TTL

![bg right:60% 95%](images/slide_cloud_storage_ffmpeg_ttl.png)

1. **Client Upload:** Regular discrete screenshots uploaded to Cloud Storage with secure signed URLs.
2. **Containerized FFmpeg Cloud Run Worker:** Stitches 300+ screenshots into a compact, timestamped MP4 exam video (CRF 30, faststart H.264, 85% smaller).
3. **Declarative Firestore TTL Engine (`expireAt`):**
   - Raw screenshots: Purged automatically after retention window.
   - MP4 exam videos: Auto-deleted post-audit according to class retention policy.
   - Ephemeral ZIP export archives: Purged after 7 days.

---

## Map-Reduce AI Video Analysis & Performance Reporting
### Map All Videos $\to$ Reduce to Performance Prompt $\to$ Map to Milestone Matrix

![bg right:60% 95%](images/slide_map_reduce_ai_jobs.png)

- **Map Phase 1 (Parallel Video Discovery):**
  - Master job fans out parallel Gemini 3.7 vision jobs across all student screen recordings.
  - Extracts timestamped terminal commands, code actions, and raw milestone attempts.
- **Reduce Phase (Performance Prompt Synthesis):**
  - Cross-student aggregator combines all individual findings into Gemini 3.8 Flash.
  - Synthesizes an objective, unified coursework rubric and milestone evaluation prompt.
- **Map Phase 2 (Targeted Performance Reporting):**
  - Mapped AI job evaluates each student video against the synthesized milestone rubric.
  - Autonomous tool calling (`recordTaskDuration`) logs milestones into **Student Milestone Matrix**.

---

## Green AI & Cloud FinOps: Institutional Cost Sustainability
### 99.8% Cost Reduction: $0.85 per 50-Student Exam vs. $750.00 Commercial SaaS

![bg right:60% 95%](images/slide_ai_cost_finops.png)

| Resource Layer | Commercial Surveillance SaaS | Gemini AI Classroom Assistant | Savings |
| :--- | :--- | :--- | :--- |
| **Compute Location** | 100% Cloud Servers | 95%+ Local Student Edge | **-95% Server Load** |
| **Audio Processing** | Continuous 100% Streaming | Local Whisper + RMS Silence Cut | **-80% Ingestion** |
| **Video Storage** | Uncompressed Continuous Video | Discrete Frames $\to$ MP4 FFmpeg | **-90% Storage** |
| **Total Cost / Student** | **$15.00 – $25.00** | **<$0.02** | **99.8% Reduction** |

- **Live Google Cloud Billing Catalog API:** Ingests dynamic SKU rates into `system_config/pricing`.

---

## Academic Integrity Incident Dossier Pipeline
### Automated 1-Click Export to Verifiable Microsoft Word (.docx) & CSV

![bg right:60% 95%](images/slide_incident_dossier_workflow.png)

- **Step 1:** Flag raised for gaze diversion, unauthorized speech, or collusion.
- **Step 2:** Multimodal aggregator bundles screenshots, 3D head poses, transcripts, and LLM reasoning chain.
- **Step 3:** Automated generation of formal Microsoft Word (`.docx`) report with institutional header and verifiable raw CSV logs.
- **Step 4:** Ready for immediate submission to Academic Integrity Disciplinary Boards. Zero-tamper evidence!

---

## DevSecOps & Production Reliability Engineering
### Multi-Tier Automated Testing Pyramid & Dual-Environment Deployments

![bg right:60% 95%](images/slide_devsecops_safeguards.png)

- **750+ Automated Tests & Assertions:**
  - **Level 1 (Frontend):** 603 tests across 87 suites (MediaPipe, Web Workers, Hooks, UI components).
  - **Level 2 (Backend Cloud Functions):** 98 tests across 6 domain codebases.
  - **Level 3 (Security Rules):** 23 real-token isolation test scenarios.
  - **Level 4 (Live Smoke Tests):** 28 live end-to-end cloud assertions.
- **Automated Dual-Environment CI/CD:**
  - Development (`it114115-dev-2026`) & Production (`it114115-2627`).
  - Pre-bundling credential mismatch guardrails in `vite.config.js`.

---

## Act VI: Live System Demonstration: 5-Stage Verification Flow

![bg right:60% 95%](images/slide_live_demo_workflow.png)

1. **Student Onboarding:** 3-step hardware readiness wizard (Screen share + Dual webcam + 1-Click calibration).
2. **Teacher Live Grid:** Multi-camera invigilation grid with zero-space problem filters.
3. **Simulated Anomaly:** Student look-away / whisper triggering on-device telemetry.
4. **Targeted Intervention:** 1-click broadcast nudge (`N`) & 30 FPS WebRTC Live Peek.
5. **Instant Verification:** Audio waveform seek player & 1-click Word dossier export.

---

<!-- _class: lead -->
## Empowering Education with Google Cloud & Edge AI
### Live System & Open-Source Repository

![bg right:55% 95%](images/slide_closing_summary.png)

- **Live Application:** [https://it114115-2627.web.app](https://it114115-2627.web.app)
- **Open-Source Repository:** [github.com/wongcyrus/Gemini-AI-Classroom-Assistant](https://github.com/wongcyrus/Gemini-AI-Classroom-Assistant)
- **Presenter:** **Cyrus Wong (黃俊彥)**
  - Google Developer Expert in GCP & AI/ML
  - Senior Lecturer, HKIIT / VTC Hong Kong
  - `cywong@vtc.edu.hk`
- **Questions & Discussion:** Edge AI, Google Genkit & Gemini 3 Architecture
