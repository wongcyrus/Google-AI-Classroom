---
title: "Google AI Classroom Part 6: Low-Bandwidth Classroom Screen Broadcasting & Single-Pass Whole-Lecture Subtitles with Gemini 4 Argon"
published: true
description: "Scaling classroom screen broadcasting without WebRTC CPU collapse and compiling single-pass whole-lecture study subtitles with Gemini 4 Argon."
tags: googlecloud, video, serverless, gemini
cover_image: https://raw.githubusercontent.com/wongcyrus/Google-AI-Classroom/main/docs/blogs/images/blog06_cover_scalable_screen_broadcast.png?v=2
canonical_url: https://github.com/wongcyrus/Google-AI-Classroom/blob/main/docs/blogs/06-scalable-screen-broadcast-and-gemini-4-lecture-studio.md
---

# Google AI Classroom Part 6: Low-Bandwidth Classroom Screen Broadcasting & Single-Pass Whole-Lecture Subtitles with Gemini 4 Argon

**Author:** [**Cyrus Wong (黃俊彥)**](https://www.linkedin.com/in/cyruswong/) — *Google Developer Expert - Cloud (AI), Senior Lecturer at HKIIT*

---

![Google AI Classroom Part 6: Low-Bandwidth Classroom Screen Broadcasting & Gemini 4 Lecture Studio](https://raw.githubusercontent.com/wongcyrus/Google-AI-Classroom/main/docs/blogs/images/blog06_cover_scalable_screen_broadcast.png?v=2)

## 1. Problem Statement: Breaking Two Hard Ceilings in Lecture Hall Broadcasting & Post-Lecture Publishing

When broadcasting a live coding demonstration to a 30-to-80 student lab or up to a 600-seat multi-cohort lecture hall—and publishing the recorded 3-hour lecture with multilingual closed captions to YouTube Studio afterward—conventional web architectures hit two catastrophic walls:

1. **The WebRTC 6-Peer CPU Wall & Firebase Anonymous Auth 100/hr NAT IP Ceiling**:
   - Peer-to-peer WebRTC screen sharing encodes a separate VP8/H.264 video stream per connected viewer ($O(N)$ CPU complexity), pegging the presenter's laptop CPU at 100% after just 6–8 students.
   - Worse, when dozens of students in a lecture hall scan a live broadcast QR code while connected to the same campus Wi-Fi NAT gateway IP, calling `signInAnonymously()` immediately triggers **Firebase Auth's hard 100-signups-per-hour-per-IP rate limit** (`auth/too-many-requests`), locking out attendees.
2. **The Chunked Speech-Preview VAD Cutoff & Timescale Drift Bugs**:
   - Early speech-to-text preview models enforced a 45,000 audio token ceiling (~30 minutes) and mistook natural 10-second classroom pauses—while the lecturer writes code in VS Code or draws a diagram on the whiteboard—as end-of-speech (`finishReason: STOP`), silently dropping the remaining 75% of the lecture's captions.
   - Furthermore, feeding raw `MediaRecorder` WebM Opus chunks into long-context multimodal models caused **1.48×–1.68× timescale compression drift** (subtitles running faster than wall-clock video playback) and wasted **90% of the token budget** on redundant video frames.

In this post, we walk through how we solved both problems using:
- A **32×18 RGB Pixel-Delta Screen Broadcaster** (`<2%` presenter CPU) paired with **Zero-Auth Firestore PIN Security Rules** (`/live/:classId?pin=XXXX`) that scale effortlessly from daily 30-student labs up to 600-student multi-cohort lecture halls.
- A **Crash-Tolerant 1-Minute Segmented Recorder** backed by IndexedDB recovery and a **Cloud Run FFmpeg Merger** guarded by a strict **5-Point Pre-Deletion Verification Gate**.
- A **Single-Pass Audio-Only Whole-Lecture Subtitle & YouTube Studio Pipeline** powered by **Gemini 4 Argon (`gemini-4-argon`)**, **Gemini 3.8 Flash (`gemini-3.8-flash`)**, and **Gemini 3.5 Flash-Lite (`gemini-3.5-flash-lite`)** with 48kHz CBR MP3 normalization, linear timescale calibration, and a Chromium zero-duration cue guard.

---

## 2. Architectural Deep-Dive: Why This Architecture Scales ($O(1)$ vs. $O(N)$ Complexity)

In a programming lecture, the presenter's screen (slides, IDE code, terminal output) needs crisp **1080p / 1440p text legibility**, not 60 FPS motion video. And when the lecturer talks over a slide for 45 seconds without scrolling, re-uploading identical frames wastes bandwidth and compute.

### Diagram 1: Why Serverless Screen Broadcast Scales — WebRTC $O(N)$ CPU Collapse vs. $O(1)$ Firestore Fanout

![Why Serverless Screen Broadcast Scales: WebRTC O(N) Collapse vs. O(1) Firestore Fanout](https://raw.githubusercontent.com/wongcyrus/Google-AI-Classroom/main/docs/blogs/images/blog06_diagram1_webrtc_vs_firestore_broadcast.png)

### Why WebRTC Mesh Fails in Classrooms vs. How Our $O(1)$ Design Solves It

1. **The WebRTC Mesh $O(N)$ Trap**: In peer-to-peer WebRTC, the presenter's browser must establish an independent peer connection and video encoder pipeline for each connected student. For $N$ students, the presenter's CPU and upstream bandwidth scale as $O(N)$. On typical laptops, CPU load hits ~75% at 8 peers and locks up at 12–15 peers with dropped frames and audio glitching.
2. **Our Serverless Single-Write $O(1)$ Presenter Workload**:
   - The teacher's browser runs an inline Web Worker timer and a 32×18 thumbnail canvas to compute pixel deltas.
   - If the screen is static, 0 frames are uploaded. When slide or code changes, it encodes **one single JPEG frame**.
   - It writes to **exactly one Firestore document**: `classes/{classId}/screenBroadcast/liveFrame`.
   - The presenter's machine workload is strictly $O(1)$—taking `<2%` CPU whether 5 students or 600 students are watching.
3. **Google Cloud Firestore Real-Time Fanout**:
   - Google Cloud's distributed Firestore infrastructure handles the fanout to all student `onSnapshot()` listeners.
4. **Zero-Auth Campus NAT Gate**:
   - Standard Firebase Auth anonymous sign-ins share the campus Wi-Fi public IP and quickly hit the 100 signups/hr per-IP limit.
   - We validate a 4-digit session PIN directly inside `firestore.rules` without invoking Firebase Auth, allowing entire student cohorts to connect simultaneously without authentication throttling.

> [!NOTE]
> **Architectural Boundary & Sizing**: This pipeline is intentionally designed for **slide and code demonstration at 0.5–1 FPS (1 frame every 1–3s)** where text sharpness is paramount. It is not intended for 30 FPS video streaming. For higher education computer labs (30–80 students) and peak joint multi-cohort lecture halls (up to 600 seats), this zero-infrastructure serverless pattern delivers rock-solid stability without maintaining expensive media servers. Beyond 600 seats (e.g. multi-thousand public MOOCs or stadium keynotes), an institution would transition to CDN-backed HLS/DASH media distribution.

### Implementation Walkthrough: 32×18 RGB Pixel Diffing, Hardware `ImageCapture`, & 950 KB Payload Guard

In [`web-app/src/hooks/useTeacherScreenBroadcast.js`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/web-app/src/hooks/useTeacherScreenBroadcast.js), our broadcaster solves four gnarly browser compositor bugs:
1. **Inline Web Worker Tick Loop**: When a lecturer switches focus from Chrome to VS Code or PowerPoint, Chromium throttles standard main-thread `setInterval` timers to 1 tick per minute. We instantiate an inline `Blob` Web Worker (`worker.postMessage({ action: 'start', interval })`) whose ticks are completely immune to background tab throttling.
2. **1000ms `ImageCapture.grabFrame()` Watchdog & GPU Texture Release**: We read frames directly from the hardware media track via `reusableImageCapture.grabFrame()`. However, on Windows/macOS, `grabFrame()` can hang indefinitely when the desktop compositor has zero damaged rectangles. We race `grabFrame()` against a `1000ms` timeout—falling back to an attached `1920x1080` offscreen `<video>` element—and always call `frameSource.close()` in `finally` so `ImageBitmap` GPU textures never leak.
3. **32×18 Downsampled RGB Delta**: Before encoding a high-resolution JPEG, we draw the frame onto a tiny `32×18` canvas (`576 pixels`) and compare the `R, G, B` channels against `lastDiffDataRef.current`. We only encode and upload a full-resolution frame if more than 2 pixels changed by $>10$ intensity units (or every `2000ms` as a keep-alive heartbeat).
4. **Automatic Firestore 1 MB Ceiling Guard**: Firestore documents have a strict `1,048,576 byte` limit. If a complex 1440p IDE screenshot produces a Base64 JPEG string exceeding `950,000 characters`, we dynamically step down the JPEG quality and canvas scale (`0.85×`) before calling `setDoc`:

```javascript
// From web-app/src/hooks/useTeacherScreenBroadcast.js
// 1. Draw to low-res 32x18 thumbnail canvas to check RGB pixel delta
const diffCtx = diffCanvasRef.current.getContext('2d', { willReadFrequently: true });
diffCtx.drawImage(frameSource, 0, 0, 32, 18);
const currentDiffData = diffCtx.getImageData(0, 0, 32, 18).data;

let hasChanged = force || !lastDiffDataRef.current;
if (!hasChanged && lastDiffDataRef.current) {
  let diffPixels = 0;
  for (let i = 0; i < currentDiffData.length; i += 4) {
    if (
      Math.abs(currentDiffData[i] - lastDiffDataRef.current[i]) > 10 ||
      Math.abs(currentDiffData[i + 1] - lastDiffDataRef.current[i + 1]) > 10 ||
      Math.abs(currentDiffData[i + 2] - lastDiffDataRef.current[i + 2]) > 10
    ) {
      diffPixels++;
      if (diffPixels > 2) {
        hasChanged = true;
        break;
      }
    }
  }
}

// 2. Heartbeat emission every 2s so terminal cursors and newly joined viewers never freeze
const now = Date.now();
if (!hasChanged && now - frameStatsRef.current.lastEmittedTime > 2000) {
  hasChanged = true;
}

if (hasChanged) {
  // ... [Draw to targetWidth x targetHeight captureCanvas with bicubic smoothing] ...
  let quality = currentPreset.quality || 0.82;
  let jpegDataUrl = captureCanvasRef.current.toDataURL('image/jpeg', quality);

  // 3. Guard against Firestore 1MB document limit (1,048,576 bytes)
  const MAX_FIRESTORE_PAYLOAD_LEN = 950000;
  if (jpegDataUrl.length > MAX_FIRESTORE_PAYLOAD_LEN) {
    quality = Math.max(0.60, quality - 0.12);
    jpegDataUrl = captureCanvasRef.current.toDataURL('image/jpeg', quality);
    if (jpegDataUrl.length > MAX_FIRESTORE_PAYLOAD_LEN) {
      const safeCanvas = document.createElement('canvas');
      safeCanvas.width = Math.round(targetWidth * 0.85);
      safeCanvas.height = Math.round(targetHeight * 0.85);
      const safeCtx = safeCanvas.getContext('2d');
      safeCtx.imageSmoothingEnabled = true;
      safeCtx.imageSmoothingQuality = 'high';
      safeCtx.drawImage(captureCanvasRef.current, 0, 0, safeCanvas.width, safeCanvas.height);
      jpegDataUrl = safeCanvas.toDataURL('image/jpeg', 0.78);
    }
  }

  const seq = ++frameSeqRef.current;
  await setDoc(doc(db, `classes/${classId}/screenBroadcast/liveFrame`), {
    frameData: jpegDataUrl,
    frameSeq: seq,
    width: targetWidth,
    height: targetHeight,
    resolution: currentRes,
    timestamp: serverTimestamp(),
  });
  lastDiffDataRef.current = currentDiffData;
}
```

### Architectural Decision: Why In-Document Base64 Over Cloud Storage Bucket Links

A frequent architectural question is: *why write Base64 image payloads directly to a single Firestore document (`liveFrame`) instead of uploading `.jpg` files to a Google Cloud Storage bucket and broadcasting the download link?*

While Cloud Storage is the standard choice for large assets and long recordings, four critical real-world requirements led us to choose in-document Base64 for live screen broadcasts:

1. **Sub-Second Real-Time Push vs. Multi-Hop HTTP Roundtrips**:
   - **With Firestore Base64**: The teacher's browser pushes a single `setDoc()` call over an existing, persistent bidirectional WebSocket/gRPC channel. All connected student listeners receive the raw image data immediately in a single push (~200–400 ms latency).
   - **With Cloud Storage**: The teacher would need to (1) upload the JPEG blob via `uploadBytes()`, (2) wait for upload confirmation, (3) write the storage URL to Firestore, and (4) every student browser would receive the metadata and then fire an *additional* HTTP GET request to download the image from the bucket. This doubles or triples latency (~1,000–1,500 ms) and introduces network race conditions where frame #42 might finish downloading after frame #43 over student mobile Wi-Fi.
2. **Fine-Grained Dynamic Security Rules (Cross-Checking PINs & Enrollment)**:
   - In `firestore.rules`, we can dynamically cross-check whether the student is currently enrolled in `classes/{classId}`, or if a guest's 4-digit PIN matches the active lecture session document.
   - **Firebase Storage rules cannot query Firestore documents** (there is no `get()` in `storage.rules`). Storage rules have no way to verify whether a public PIN in a URL matches a dynamic session document in Firestore, nor can they verify real-time class roster membership without a dedicated backend token broker.
3. **Instant, Atomic Session Revocation**:
   - The moment an instructor clicks **Stop Broadcast**, Firestore sets `isBroadcasting: false`. `firestore.rules` instantly denies further reads to all listeners across the entire cohort.
   - In contrast, Storage public URLs (`getDownloadURL`) contain persistent bearer tokens (`?alt=media&token=...`) that remain readable on Google Cloud CDN caches even after the lecture ends, creating potential privacy leaks.
4. **Ephemeral Single-Document In-Place Overwrite & Zero Long-Term Database Storage**:
   - **Never Accumulates Historical Frame Documents**: During a broadcast, frames are *never* appended as a growing collection of documents. Every new frame calls `setDoc()` on the exact same single document path (`classes/{classId}/screenBroadcast/liveFrame`), **completely overwriting the previous frame in-place**. Whether a lecture runs for 15 minutes or 3 hours, the total Firestore storage footprint is bounded to **at most 1 frame (~150–350 KB)** at any moment.
   - **Immediate `null` Wipe on Broadcast Stop**: The instant the lecturer stops sharing, `stopBroadcast()` in [`useTeacherScreenBroadcast.js`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/web-app/src/hooks/useTeacherScreenBroadcast.js) wipes `frameData` to `null`—leaving **0 bytes of image data stored in Firestore long-term** and avoiding the tens of thousands of orphaned `.jpg` files that sequential Cloud Storage uploads (`frame_001.jpg`, `frame_002.jpg`) would leave behind:

```javascript
// From web-app/src/hooks/useTeacherScreenBroadcast.js — Wiping frame payload on stop
const liveFrameDocRef = doc(db, `classes/${classId}/screenBroadcast/liveFrame`);
await setDoc(liveFrameDocRef, {
  frameData: null,
  endedAt: serverTimestamp(),
}, { merge: true });
```

### 2.2 FinOps & Cost Breakdown: Firestore Document Fanout at Classroom Scale

Because each frame overwrites the single `liveFrame` document in-place and is wiped to `null` when the session ends, **long-term Firestore disk storage cost is $0.00**. Runtime billing is strictly limited to **document operations** ($0.18 per 100K writes, $0.06 per 100K reads in `asia-east2`) and **network egress** (~$0.12 per GiB). Here is the empirical cost model for a typical **1-hour lecture** (~500 emitted frames, leveraging 32×18 pixel-delta suppression when slides are static):

| Workload Scale | Active Attendees | Firestore Writes (~500 Frames) | Firestore Reads | Network Egress (~450 KB/frame) | Total Google Cloud Cost (1-Hour Session) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Typical Computer Lab** | **30 Students** | 500 writes ($0.0009) | 15,000 reads ($0.009) | ~6.75 GB (Within 10 GB Free Tier) | **~$0.01 USD** |
| **Standard Lecture Hall** | **60 Students** | 500 writes ($0.0009) | 30,000 reads ($0.018) | ~13.5 GB (~$0.42 after free tier) | **~$0.44 USD** |
| **Multi-Cohort Joint Lecture** | **150 Students** | 500 writes ($0.0009) | 75,000 reads ($0.045) | ~33.7 GB (~$2.84) | **~$2.89 USD** |
| **Peak Auditorium / Keynote** | **600 Students** | 500 writes ($0.0009) | 300,000 reads ($0.180) | ~135 GB (~$15.00) | **~$15.18 USD** |

#### Why Serverless Wins Over Dedicated Media Streaming Servers (SFU)
- **Traditional WebRTC SFU / Media Server**: Hosting dedicated media servers (e.g. Janus, Mediasoup, or LiveKit clusters on 2–4 `c2-standard-4` Cloud Compute VMs) incurs a fixed baseline cost of **$250 – $500 USD per month** 24/7—even during nights, weekends, and semester breaks when no classes take place.
- **Our Serverless Firestore Pattern**: When no lecture is broadcasting, infrastructure costs drop strictly to **$0.00**. For daily classroom teaching (30–60 students), a complete 1-hour broadcast costs **less than half a dollar**, scaling up to ~$15 for an occasional 600-student symposium without provisioning a single server.

---

### Bypassing the 100/hr NAT Ceiling with Zero-Auth Firestore PIN Rules

To let multi-cohort student audiences join `/live/:classId?pin=XXXX` simultaneously from the same campus Wi-Fi NAT IP—and allow speakers to share the QR code in advance—we store both `publicPin` and `savedPublicPin` in `classes/{classId}/screenBroadcast/session` (`configurePublicAccess` in [`useTeacherScreenBroadcast.js`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/web-app/src/hooks/useTeacherScreenBroadcast.js)) and validate the PIN directly inside [`firestore.rules`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/firestore.rules) with **zero Firebase Auth calls**:

```javascript
// From firestore.rules
function isPublicBroadcastActive(classId) {
  let sessionPath = /databases/$(database)/documents/classes/$(classId)/screenBroadcast/session;
  return exists(sessionPath) && (
    (get(sessionPath).data.get('isPublic', false) == true &&
     get(sessionPath).data.get('publicPin', '') != '') ||
    (get(sessionPath).data.get('savedIsPublic', false) == true &&
     get(sessionPath).data.get('savedPublicPin', '') != '')
  );
}

match /screenBroadcast/{docId} {
  allow read: if isPublicBroadcastActive(classId) || isTeacher() || isTeacherInClass(classId) || isStudentInClass(classId);
  allow write: if isTeacher() || isTeacherInClass(classId);
}

match /screenBroadcastViewers/{studentUid} {
  allow create, update: if (
      request.auth != null && request.auth.uid == studentUid &&
      (isTeacher() || isTeacherInClass(classId) || isStudentInClass(classId))
    ) || (
      isPublicBroadcastActive(classId) &&
      request.resource.data.get('pin', '') != '' && (
        request.resource.data.get('pin', '') == get(/databases/$(database)/documents/classes/$(classId)/screenBroadcast/session).data.get('publicPin', '') ||
        request.resource.data.get('pin', '') == get(/databases/$(database)/documents/classes/$(classId)/screenBroadcast/session).data.get('savedPublicPin', '')
      )
    );
}
```

---

## 3. Crash-Tolerant 1-Minute Segmented Recording & The 5-Point Cloud Run FFmpeg Safety Gate

Recording a 3-hour lecture into a single in-memory browser `Blob` is a ticking time bomb: if the browser tab crashes or the laptop battery dies at minute 179, the entire 3-hour recording is lost.

### Diagram 2: Resilient 1-Minute Rolling Ingestion & 5-Point Pre-Deletion Safety Gate

In [`useLectureRecorder.js`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/web-app/src/hooks/useLectureRecorder.js) and [`functions/media_processing/mergeLectureRecordings.js`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/functions/media_processing/mergeLectureRecordings.js), we record rolling **1-minute self-contained `.webm` segments** backed by an IndexedDB crash-recovery queue (`lectureRecoveryDb.js`), and merge them post-lecture inside a `2 vCPU, 2GiB RAM` Cloud Run container guarded by a **5-Point Pre-Deletion Integrity Gate**:

![Resilient 1-Minute Rolling Ingestion & 5-Point Cloud Run FFmpeg Safety Gate](https://raw.githubusercontent.com/wongcyrus/Google-AI-Classroom/main/docs/blogs/images/blog06_diagram2_ffmpeg_5point_safety_gate.png)

### Production Code: Mixed Audio Alignment, 48kHz CBR MP3 Extraction, & Pre-Deletion Gate

What happens if a lecturer starts recording their screen with the microphone unplugged for the first two 1-minute clips, and plugs in their USB headset at minute 3? A standard `ffmpeg -f concat -c copy` command will either fail or slide the audio from minute 3 backward to minute 0, ruining lip/slide sync for the entire 3-hour video!

Here is how [`functions/media_processing/mergeLectureRecordings.js`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/functions/media_processing/mergeLectureRecordings.js) aligns mixed audio/no-audio clips using `lavfi anullsrc`, extracts a normalized 48kHz CBR MP3 for Gemini, and enforces the Pre-Deletion Integrity Gate:

```javascript
// From functions/media_processing/mergeLectureRecordings.js
// 1. Stream alignment across clips: if some clips have audio and others do not,
// pad silent clips with a 48kHz stereo Opus track so FFmpeg concat preserves sync.
const clipsWithAudio = downloadedFiles.map((f) => currentAudioChecker(f));
const anyHasAudio = clipsWithAudio.some(Boolean);
const allHaveAudio = clipsWithAudio.every(Boolean);

const alignedFiles = [];
if (anyHasAudio && !allHaveAudio && !overrides.ffmpegRunner) {
  for (let i = 0; i < downloadedFiles.length; i++) {
    const filePath = downloadedFiles[i];
    if (!clipsWithAudio[i]) {
      const paddedPath = path.join(workDir, `clip_${i}_padded.webm`);
      const padRes = spawnSync(ffmpeg_static, [
        '-i', filePath,
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
        '-c:v', 'copy', '-c:a', 'libopus', '-shortest', '-y', paddedPath,
      ]);
      if (padRes.status === 0 && fs.existsSync(paddedPath)) {
        alignedFiles.push(paddedPath);
        continue;
      }
    }
    alignedFiles.push(filePath);
  }
} else {
  alignedFiles.push(...downloadedFiles);
}

// 2. Concatenate videos via stream copy (-c copy) with monotonic DTS/PTS generation
const combinedVideoPath = path.join(workDir, 'combined_lecture.webm');
const concatCmd = ffmpeg()
  .input(concatListPath)
  .inputOptions(['-f concat', '-safe 0'])
  .outputOptions(['-c copy', '-avoid_negative_ts make_zero', '-fflags +genpts'])
  .output(combinedVideoPath);
await currentFfmpegRunner(concatCmd);

// 3. Extract normalized 48kHz Constant Bitrate MP3 for Gemini speech recognition
// Eliminates MediaRecorder WebM timestamp resets & prevents 1.48x subtitle drift!
const combinedMp3Path = path.join(workDir, 'combined_audio_normalized.mp3');
const audioNormalizedCmd = ffmpeg(combinedVideoPath)
  .noVideo()
  .audioCodec('libmp3lame')
  .audioBitrate('128k')
  .audioChannels(2)
  .audioFrequency(48000)
  .outputOptions(['-avoid_negative_ts make_zero', '-fflags +genpts'])
  .output(combinedMp3Path);
await currentFfmpegRunner(audioNormalizedCmd);

// ... [Uploads lecture.webm & lecture_audio_normalized.mp3 and commits Firestore doc] ...

// 4. Pre-Deletion Integrity Verification Gate:
// If ANY check fails, abort immediately so intermediate 1-min segments are NEVER deleted!
const destVideoFile = bucket.file(destVideoPath);
const [destExists] = await destVideoFile.exists();
if (!destExists) {
  throw new Error(`Integrity check failed: merged video '${destVideoPath}' does not exist in Cloud Storage. Segment deletion aborted.`);
}
const [metadata] = await destVideoFile.getMetadata();
const remoteSize = Number(metadata?.size || 0);
if (remoteSize > 0 && remoteSize < 1024) {
  throw new Error(`Integrity check failed: merged video is suspiciously small (${remoteSize} bytes). Segment deletion aborted.`);
}
if (durationSeconds <= 0 && videoStats.size < 1024) {
  throw new Error('Integrity check failed: merged video has 0 duration and invalid size. Segment deletion aborted.');
}
```

---

## 4. Single-Pass Audio-Only Whole-Lecture Subtitles with Gemini 4 Argon (`gemini-4-argon`)

Why send 1.2 GB of video frames into a multimodal LLM when closed captions and YouTube chapter markers come entirely from the lecturer's voice?

In [`ClassManagement.jsx`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/web-app/src/components/ClassManagement.jsx) and [`LectureRecordingsView.jsx`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/web-app/src/components/LectureRecordingsView.jsx), instructors can select their preferred lecture intelligence model—**🧠 Gemini 4 Argon (`gemini-4-argon`)**, **⚡ Gemini 3.8 Flash (`gemini-3.8-flash`, Default)**, or **🚀 Gemini 3.5 Flash-Lite (`gemini-3.5-flash-lite`)** (`SUPPORTED_LECTURE_AI_MODELS` in [`functions/ai_flows/config.js`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/functions/ai_flows/config.js)).

### Diagram 3: Two-Stage Whole-Lecture Audio Pipeline, Timescale Calibration & YouTube Studio Packaging

![Single-Pass Whole-Lecture Audio Subtitles & YouTube Studio Packaging with Gemini 4 Argon](https://raw.githubusercontent.com/wongcyrus/Google-AI-Classroom/main/docs/blogs/images/blog06_diagram3_gemini4_lecture_subtitles_sequence.png)

### Why We Split Whole-Lecture Subtitling into Stage 1 (Single-Pass Audio STT) + Stage 2 (Batched Translation)

When we initially asked the model to transcribe a 2-hour lecture *and* translate every sentence inline into 4 languages within a single JSON response, the output exceeded `65,536 completion tokens` (`maxOutputTokens`) around minute 70, truncating the JSON!

In [`functions/ai_flows/processLectureSubtitles.js`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/functions/ai_flows/processLectureSubtitles.js), we architected a **Two-Stage Pipeline** that handles up to **9-hour audio recordings** without ever hitting the 65,536 output token ceiling:
1. **Stage 1 — Single-Pass Whole-Audio Verbatim Transcription & Chaptering**: We pass the normalized 48kHz CBR MP3 (`gs://.../lecture_audio_normalized.mp3`) to **Gemini 4 Argon (`gemini-4-argon`)** or **Gemini 3.8 Flash (`gemini-3.8-flash`)** with `maxOutputTokens: 65536` and `thinkingConfig: { thinkingBudget: 0 }`. Because Stage 1 outputs *only* the `original` spoken cues and 4–10 YouTube chapter milestones, a full 3-hour lecture takes only ~18,000 output tokens and never cuts off on whiteboard pauses.
2. **Stage 2 — Controlled-Concurrency Batched Translation**: We slice the transcribed segments into batches of `50 sentences` (`BATCH_SIZE = 50`, `CONCURRENCY = 3`) and translate each target language independently via `buildLectureTranslationPrompt`.

### Solving Three Production Media & Subtitle Failure Modes

#### 1. Fixing Long-Audio Timescale Drift (`normalizeLectureAudio` & `calibrateSubtitleTimeline`)
When Gemini processes long raw WebM Opus recordings in a single pass, WebM timestamp resets and internal audio framing cause the model's emitted timestamps to compress linearly (running ~1.48× to 1.68× faster than wall-clock video playback).
- **Our Fix**: First, `normalizeLectureAudio` transcodes the audio track into a constant-bitrate 48kHz MP3 (`-c:a libmp3lame -b:a 128k -ar 48000`). Second, `calibrateSubtitleTimeline` compares the highest segment timestamp (`rawMaxEnd`) against the FFmpeg-probed `totalDuration`; if `driftRatio > 1.05`, it linearly stretches all segment `start`/`end` timestamps and chapter offsets into 1:1 synchronization with the video player:

```javascript
// From functions/ai_flows/processLectureSubtitles.js
export function calibrateSubtitleTimeline(segments = [], chapters = [], totalDuration = 0) {
  if (!Array.isArray(segments) || segments.length === 0 || !totalDuration || totalDuration <= 0) {
    return { segments, chapters, driftRatio: 1.0 };
  }

  const rawMaxEnd = Math.max(...segments.map((s) => Number(s.end) || 0));
  if (rawMaxEnd <= 0 || totalDuration <= rawMaxEnd) {
    return { segments, chapters, driftRatio: 1.0 };
  }

  const driftRatio = totalDuration / rawMaxEnd;
  if (driftRatio <= 1.05) {
    return { segments, chapters, driftRatio: 1.0 };
  }

  const calibratedSegments = segments.map((seg) => ({
    ...seg,
    start: Math.round((Number(seg.start) || 0) * driftRatio * 1000) / 1000,
    end: Math.min(totalDuration, Math.round((Number(seg.end) || 0) * driftRatio * 1000) / 1000),
  }));

  const calibratedChapters = (Array.isArray(chapters) ? chapters : []).map((ch) => ({
    ...ch,
    timeSeconds: Math.min(Math.round(totalDuration), Math.round((Number(ch.timeSeconds) || 0) * driftRatio)),
  }));

  return { segments: calibratedSegments, chapters: calibratedChapters, driftRatio };
}
```

#### 2. The Chromium `<track>` Zero-Duration Cue Drop Guard (`buildWebVTT` & `buildSRT`)
Occasionally, an LLM emits a subtitle cue where `end == start` (e.g., `start: 142.5, end: 142.5`). Both Chromium's native HTML5 `<track>` parser and YouTube Studio's `.srt` ingestion engine silently discard any cue where `end <= start`!
- **Our Fix**: In `buildWebVTT` and `buildSRT`, we enforce a strict duration floor (`end > start`) proportional to the character length of the cue (`Math.max(1.8, Math.min(5.0, text.length * 0.25))`), clamped to the start of the next segment:

```javascript
// From functions/ai_flows/processLectureSubtitles.js
export function buildWebVTT(segments = [], languageKey = 'original') {
  let vtt = 'WEBVTT\n\n';

  segments.forEach((seg, idx) => {
    const text = (
      languageKey === 'original'
        ? seg.original
        : seg.translations?.[languageKey] || seg.original || ''
    ).trim();

    if (!text) return;

    const start = Number(seg.start) || 0;
    let end = Number(seg.end) || 0;

    // Guard against 0 or negative duration cues that Chromium & YouTube discard:
    if (end <= start) {
      const nextSeg = segments[idx + 1];
      const nextStart = nextSeg ? Number(nextSeg.start) : Infinity;
      const minDisplayDur = Math.max(1.8, Math.min(5.0, text.length * 0.25));
      end = Math.min(nextStart > start ? nextStart : start + minDisplayDur, start + minDisplayDur);
    }

    vtt += `${idx + 1}\n`;
    vtt += `${formatTimestampToVTT(start)} --> ${formatTimestampToVTT(end)}\n`;
    vtt += `${text}\n\n`;
  });

  return vtt;
}
```

#### 3. Fixing Unseekable `MediaRecorder` WebM Videos (`ensureIndexedLectureVideo`)
Files streamed directly from browser `MediaRecorder` lack an EBML `SeekHead`, `Cues` index table, and container `Duration` header—causing HTML5 `<video>` players to display `0:00 / Infinity` and refuse to seek when a student clicks a chapter timestamp.
- **Our Fix**: `ensureIndexedLectureVideo` runs a fast, zero-transcoding FFmpeg container remux (`ffmpeg -y -i raw.webm -c copy indexed.webm`) and stamps `hasCuesIndex: 'true'` into the Cloud Storage metadata so every lecture video seeks instantaneously.

---

## 5. Architectural Comparison: Legacy Video Broadcasting vs. Pixel-Delta & Audio-First Lecture Studio

| Architecture / Pipeline Stage | Traditional WebRTC / Raw Video Approach | Our Gemini 4 / 3.8 Lecture Studio Architecture | Architectural Advantage |
| :--- | :--- | :--- | :--- |
| **Live Screen Broadcast Transport** | Peer-to-peer WebRTC video encoding per viewer | **32×18 RGB Pixel-Delta + Firestore Single-Doc Fanout** | Constant presenter workload regardless of viewer count |
| **Campus Wi-Fi Student Onboarding** | Blocked at 100 users/hr by Anonymous Auth NAT IP limit | **Zero-Auth PIN Rules (`/live/:classId?pin=XXXX`)** | Bypasses shared campus NAT IP throttling |
| **Lecture Segment Merging** | Full video transcoding on every merge | **Zero-Transcode `ffmpeg -f concat -c copy` + 5-Point Safety Gate** | Stream-copy concat without re-encoding video frames |
| **Multimodal Input Payload to Gemini** | Uploading full composite MP4/WebM video frames | **Extracted 48kHz CBR MP3 Audio (`normalizeLectureAudio`)** | Eliminates redundant video frame tokens for speech STT |
| **Whole-Lecture Subtitle & Chapter Generation** | Single monolithic prompt with video | **Stage 1 Audio-Only STT + Stage 2 Batched Translation (50 cues/batch)** | Prevents output token truncation on multi-hour lectures |
| **Google Drive Archival** | Proxying video buffers through Cloud Functions | **Direct Browser $\rightarrow$ Google Drive OAuth Resumable Upload** | **$0.00 GCP Cloud Function Egress** |

---

## 6. Key Takeaways

1. **Broadcast Slides & Code via Pixel-Delta Frames, Not Mesh WebRTC**: A `32×18` RGB pixel-diffing canvas driven by an inline Web Worker timer and gated by Zero-Auth Firestore PIN rules scales 1080p/1440p classroom screen broadcasting across multi-seat cohorts at `<2%` presenter CPU.
2. **Never Delete Raw Segments Without a Multi-Point Verification Gate**: Recording in 1-minute rolling segments with IndexedDB recovery protects against browser crashes, while our 5-point Cloud Run FFmpeg check ensures intermediate clips are never purged unless the merged master video is verified healthy.
3. **Send Pure Normalized 48kHz CBR MP3 to Gemini, Never Video Frames**: Stripping video frames saves 90% of multimodal input tokens, while normalizing to 48kHz Constant Bitrate MP3 (`normalizeLectureAudio`) and running `calibrateSubtitleTimeline` eliminates the 1.48×–1.68× Opus timescale compression drift.
4. **Decouple Verbatim Audio STT from Batched Multilingual Translation**: Using **Gemini 4 Argon (`gemini-4-argon`)** or **Gemini 3.8 Flash (`gemini-3.8-flash`)** (`thinkingBudget: 0`, `maxOutputTokens: 65536`) for single-pass verbatim audio transcription + chaptering first, followed by 50-sentence batched translation and a zero-duration cue guard (`end > start`), guarantees 100% complete `.vtt` and YouTube Studio `.srt` packages for lectures up to 9 hours long.
