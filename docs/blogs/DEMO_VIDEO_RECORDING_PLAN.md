# 🎬 Demo Video Recording Plan & Shot-by-Shot Script for Google AI Classroom Blog Series

**Target Platform:** [https://it114115-2627.web.app](https://it114115-2627.web.app)  
**Companion Series:** [10-Part Google Developer Expert (GDE) Technical Blog Series](./README.md)  
**Recommended Recording Setup:**
- **Resolution & Frame Rate:** `1920x1080` (1080p) or `2560x1440` (1440p) at **60 FPS** (via OBS Studio or Chrome Tab Capture).
- **Split-Screen Layout:** Left half (50%): **Teacher Dashboard (`ClassView`)**; Right half (50%): **Student Portal (`StudentView` + Chrome DevTools Console)** so viewers see real-time client-to-teacher synchronization in a single frame.
- **Clip Length Target:** **45–90 seconds per clip** (ideal for embedding as MP4 / GIF / YouTube clips inside each blog post and social sharing on LinkedIn / X / DEV.to).

---

## 📋 Overview of Demo Clips to Record

| Clip ID | Target Blog Post(s) | Demo Clip Title | Duration | Key Visual Proof to Capture |
| :--- | :--- | :--- | :--- | :--- |
| **Clip 1** | **Part 2** (Browser Edge AI: Gemma 4 E2B, MediaPipe & Whisper) | **On-Device Gemma 4 E2B Speech Proctoring & Playable Voice Evidence** | **60–90s** | 1. DevTools Console `await window.__gemma4Status()` showing `isModelCached: true, delegateUsed: 'webgpu'`.<br/>2. Benign self-talk (`✅ NO VIOLATION`, zero upload).<br/>3. Collusion speech (`"喂，第三題揀 A 定係 B 呀？"`) $\to$ `🚨 YES (COLLUSION_EXAM)` $\to$ `🎙️ Audio Clip` playback in `IrregularitiesView`. |
| **Clip 2** | **Part 2 & Part 9** (3D Face Mesh & Zero-Trust Exam Mode) | **MediaPipe 478-Point 3D Face Mesh, Iris Depth & Dual-Snapshot Irregularity** | **60s** | 1. Student calibrates neutral pose (`📏 55 cm`, `Yaw: 0°`).<br/>2. Student looks sideways for `> 3.0s` (debounce gate).<br/>3. Synchronized **Screen + Webcam** evidence appears in Teacher `IrregularitiesView` + 1-click `.docx` Incident Dossier export. |
| **Clip 3** | **Part 5** (Real-Time Multilingual Live Subtitles) | **Cantonese-English Code-Switching to 9-Language Live Subtitles (Cloud Gemini vs. $0.00 Local Gemma 4)** | **60s** | 1. Teacher speaks mixed Cantonese + English technical terms (`"今日我哋講 Cloud Run autoscaling 同埋 Firestore..."`).<br/>2. Student floating overlay updates in `< 1s` across Traditional Chinese, English, Japanese, or Bahasa Indonesia.<br/>3. Toggle between **Server Gemini** and **$0.00 Client Gemma 4 E2B** modes. |
| **Clip 4** | **Part 6** (1,000-Viewer Screen Broadcast & Whole-Lecture Subtitles) | **Zero-Auth Public PIN Broadcast & 1-Pass Gemini 4 Lecture Recording Studio** | **60s** | 1. Teacher starts screen broadcast with 6-digit Public PIN (`/live?pin=XXXXXX`).<br/>2. Student joins with zero login; 32×18 pixel-delta pauses frames when slide is static.<br/>3. Lecture Recording Studio generates 9-language `.srt`/`.vtt` subtitles + YouTube timestamp chapters in a single pass. |
| **Clip 5** | **Part 7** (Serverless Map-Reduce Video & Practical Task Auto-Grading) | **4-Tab Rubric Synthesis & Gemini 4 Multi-Step Code Video Auto-Grading** | **75s** | 1. Teacher synthesizes a structured step-by-step rubric from a model solution video/PDF.<br/>2. Student records practical lab task screen.<br/>3. Gemini 4 Argon grades each rubric step with exact `[MM:SS]` video seek timestamps and deterministic score reconciliation. |
| **Clip 6** | **Part 8** (Multimodal Capstone Project Supervision) | **Mobile 720p Demo Studio, Zero-Pause Photo Snap & Fake-Log Auditor** | **75s** | 1. Pre-meeting AI Auditor flags vague weekly log claims and generates targeted probing questions.<br/>2. Supervisor on mobile starts voice recording, taps **`📸 Snap Photo`** (0.1s, zero audio pause), and records a **`📹 720p Demo Video`**.<br/>3. Two-stage diarization + Gemini 4 cross-examination produces verified individual `realWorkScore (1–10)`. |
| **Clip 7** | **Part 4 & Part 9** (WebAuthn Passkeys, Rotating QR & Gamified Bingo) | **15-Second Rotating HMAC QR Attendance & Gamified Classroom Bingo** | **60s** | 1. Student scans 15s rotating QR on hardware-bound phone Passkey (and logs into shared lab PC via QR without typing password).<br/>2. Teacher launches AI Classroom Bingo from live screen broadcast; students answer to light up the 3-color comprehension heatmap. |
| **Clip 8** | **Part 1, Part 3 & Part 10** (Architecture, Prompt Studio & FinOps) | **Live FinOps Cost Telemetry (<$0.02/Student) & `✨ Optimize` Prompt Studio** | **45s** | 1. Teacher opens Prompt Management Studio and clicks `✨ Optimize` (Gemini 4 Argon meta-prompting).<br/>2. Show real-time FinOps Usage Dashboard proving sub-$0.02/student session cost and 9-category storage lifecycle cleanup. |

---

## 🎥 Detailed Shot-by-Shot Recording Instructions (Priority Clips)

### 🌟 Priority Clip 1: On-Device Gemma 4 E2B WebGPU Proctoring & Voice Evidence (For Blog Part 2)

This is the most important technical proof clip showing **100% local WebGPU LLM inference**, **persistent caching**, and **zero-egress voice evidence `.wav` capture on violation**.

#### Pre-Flight Checklist Before Recording
1. Open Chrome on Desktop (`https://it114115-2627.web.app`).
2. **Left Window (Teacher):** Log in as Teacher $\to$ Select class `IT114115-Demo` $\to$ Enable **Audio Capture** and set **Voice AI Mode** to `Hybrid (Local Gemma 4 + Cloud Fallback)` or `Client-Only (Local Gemma 4)`.
3. **Right Window (Student):** Log in as Student (`David / student1@school.edu`) $\to$ Open Chrome DevTools (`F12` $\to$ **Console** tab docked at the bottom).

#### Shot-by-Shot Action Script (75 Seconds)
- **00:00 – 00:15 | Shot 1 — Verify Local Gemma 4 E2B WebGPU & Cache Status in Console:**
  - In the Student DevTools Console, type and run:
    ```javascript
    await window.__gemma4Status()
    ```
  - **Visual Highlight:** Point cursor at the console table showing:
    - `status: "ready"`
    - `engine: "litert_lm_gemma_e2b"`
    - `isModelCached: true` (cached in `CacheStorage` / `IndexedDB` — zero 1.91 GB re-download on reload!)
    - `delegateUsed: "webgpu"`
- **00:15 – 00:35 | Shot 2 — Benign Self-Talk (Zero Cloud Egress, No False Positive):**
  - Student starts Screen + Webcam + Mic sharing.
  - Speak a normal benign sentence into the mic (or run `await window.__testGemma4("Let me read question 2 carefully to understand the diagram.")`).
  - **Visual Highlight:** Show the green console banner:
    `[LiteRT-LM Gemma 4 E2B] 🤖 Intent Evaluation: Category: [BENIGN] | Violation: ✅ NO`
  - Show that **nothing** is uploaded to Firebase Storage and no alert is triggered on the Teacher screen.
- **00:35 – 00:55 | Shot 3 — Live Cantonese/English Exam Collusion Detection:**
  - Speak into the microphone in mixed Cantonese/English:
    > *"喂，第三題揀 A 定係 B 呀？Can someone tell me the answer for question 3?"*
  - **Visual Highlight:**
    1. Console immediately logs `[Selected Track Speech STT]` transcript.
    2. Local Gemma 4 E2B evaluates in `~450 ms`:
       `Category: [COLLUSION_EXAM] | Lang: mixed | Severity: CRITICAL | Violation: 🚨 YES`
    3. Console logs:
       `[useClientLiteRTGemma] 🎙️ Uploaded voice irregularity evidence (384044 bytes) to irregularities/IT114115-Demo/.../voice_179427....wav`
- **00:55 – 01:15 | Shot 4 — Teacher Replays the Captured Voice Clip in `IrregularitiesView`:**
  - Switch focus to the **Left Window (Teacher Dashboard $\to$ Irregularities tab)**.
  - Point to the new row: **`AI Speech Alert: COLLUSION EXAM`** with the **`🎙️ Audio Clip`** button in the Evidence column (no longer `No media`!).
  - Click **`🎙️ Audio Clip`** to open the `DualMediaPlayer` modal:
    - Show the highlighted transcript: `"喂，第三題揀 A 定係 B 呀？..."`
    - Click **Play (`▶️`)** on the `<audio controls>` player so viewers hear the exact recorded `.wav` voice evidence!

---

### 🌟 Priority Clip 2: MediaPipe 3D Face Mesh & 3-Second Biometric Debounce Gate (For Blog Part 2 & Part 9)

#### Shot-by-Shot Action Script (60 Seconds)
- **00:00 – 00:15 | Shot 1 — 478-Point 3D Mesh & 1-Click Neutral Pose Calibration:**
  - On `StudentView`, toggle **Show 3D Face Mesh Overlay** on the webcam preview.
  - Click **`🎯 Calibrate Neutral Pose`** while looking naturally at the monitor. Show `Yaw: 0°`, `Pitch: 0°`, and iris metric distance `~55 cm`.
- **00:15 – 00:35 | Shot 2 — Sub-3-Second Glance (Filtered Out by Debounce Gate):**
  - Glance away for `1.5 seconds` and look back at the screen.
  - Show the yellow warning badge (`Looking Away: 1.5s / 3.0s`) resetting to green **`✅ Focused`** without logging a false-positive irregularity.
- **00:35 – 01:00 | Shot 3 — Sustained Violation (`> 3.0s`) & Dual-Snapshot Evidence:**
  - Turn head sideways or hold a phone in frame for `> 3.0 seconds`.
  - Show the Teacher `IrregularitiesView` receiving the synchronized **Screen + Webcam** dual snapshot (`DualMediaPlayer`) and click **`📄 Export .docx Incident Dossier`**.

---

### 🌟 Priority Clip 3: Mobile 720p Capstone Supervision Studio (For Blog Part 8)

#### Shot-by-Shot Action Script (60–75 Seconds)
- **00:00 – 00:20 | Shot 1 — Pre-Meeting Fake-Log Auditor:**
  - In `ProjectMeetingsView`, click **`🔍 Audit Weekly Logs & Generate Questions`** for Group 1.
  - Show Gemini flagging a vague log entry and generating 3 specific verification questions.
- **00:20 – 00:45 | Shot 2 — Continuous Voice + Zero-Pause Photo Snap + 720p Demo Video:**
  - Tap **`🔴 Start Meeting (Voice)`**.
  - While speaking, tap **`📸 Snap Photo`** of a student's architecture diagram or circuit—point out that the voice timer continues with **zero interruption**.
  - Tap **`📹 Record Demo Video (720p)`**, record a 10-second hardware/UI demo, and tap **`⏹️ Finish Demo`** (auto-resumes voice recording).
- **00:45 – 01:15 | Shot 3 — 2-Stage Diarization & Multimodal Cross-Examination:**
  - Tap **`✨ Analyze Meeting with Gemini`**.
  - Show the speaker-diarized transcript (`[MM:SS]`), the photo lightbox gallery, the 720p demo player, and each student's verified `Real Work Score (1–10)` citing visual evidence.
