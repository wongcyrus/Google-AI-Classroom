# 🔄 Data Retention & Autonomous Media Lifecycle Architecture

[🏠 Documentation Index](../README.md#documentation-index) | [👨‍🏫 Teacher Manual](./user-manual-teacher.md) | [🧑‍🎓 Student Manual](./user-manual-student.md) | [🛠️ Admin Manual](./user-manual-admin.md) | [📘 UI Catalog](./comprehensive-ui-controls-and-features-catalog.md)

---

This document provides a comprehensive technical reference for the real-time data retention, autonomous Firestore TTL lifecycle, Storage event-driven deletion triggers, and cascading class removal in the Google AI Classroom.

---

## 📑 Table of Contents

1. [System Architecture Overview](#️-system-architecture-overview)
2. [1. Per-Class Dual Retention Configuration](#️-1-per-class-dual-retention-configuration)
3. [2. Real-Time Event-Driven Deletion Triggers](#-2-real-time-event-driven-deletion-triggers-functionsstorage_triggers)
4. [3. Comprehensive Cascading Class Deletion](#️-3-comprehensive-cascading-class-deletion-onclassdocdeleted)
5. [4. Data Safety & Isolation Model](#️-4-data-safety--isolation-model)
6. [5. Firestore Native TTL Policy Setup](#️-5-firestore-native-ttl-policy-setup)
7. [6. Teacher Lecture Recording & Telemetry Deletion Lifecycle](#-6-teacher-lecture-recording--telemetry-deletion-lifecycle)
8. [7. Immediate Screenshot Purge & Practical Task Video Slicing Safeguards](#-7-immediate-screenshot-purge--practical-task-video-slicing-safeguards)

---

## 🏛️ System Architecture Overview

```mermaid
flowchart TD
    UI[Class Management UI: Teacher Configures Retention Days] -->|1. Stamping at Ingestion| Stamping[Asset Ingestion & Expiration Stamping]

    subgraph Ingestion [Ingestion expireAt Stamping]
        Stamping --> S1[Screenshots: expireAt = now + retentionDays]
        Stamping --> S2[VideoJobs: expireAt = now + videoRetentionDays]
        Stamping --> S3[ZipJobs: expireAt = now + 7 Days]
        Stamping --> S4[Audio Chunks: expireAt = now + retentionDays]
    end

    Ingestion -->|2. Background Firestore Expiry| TTL[Firestore Native TTL Engine]
    TTL -->|3. onDocumentDeleted Events| Triggers[Storage Event Triggers]

    subgraph Triggers [Event-Driven Cloud Storage Cleanup]
        Triggers --> T1[onScreenshotDocDeleted: Deletes .jpg from GCS]
        Triggers --> T2[onVideoJobDocDeleted: Deletes .mp4 from GCS]
        Triggers --> T3[onZipJobDocDeleted: Deletes .zip from GCS]
        Triggers --> T4[onAudioDocDeleted: Deletes .webm from GCS]
        Triggers --> T5[onLectureRecordingDeleted: Deletes lecture recordings from GCS]
    end

    Triggers -->|4. Cloud Storage Object Deleted Event| Quota[onObjectDeleted: Auto-Decrements Class Storage Quota]
```

---

## ⚙️ 1. Per-Class Dual Retention Configuration

### Data Model (`classes/{classId}`)
* **`retentionDays`** `(number)`: Configurable retention period for **raw screen captures** (Presets: 7, 14, 30, 60, 90, 180, 365 days; Default: 30 days).
* **`videoRetentionDays`** `(number)`: Configurable retention period for **compiled lesson videos** (`.mp4`) (Presets: 14, 30, 60, 90, 180, 365, 730 days; Default: 90 days).

### Ingestion Stamping (`expireAt`)
Every generated document is stamped with a deterministic UTC expiration timestamp at creation time:
* **Screenshots (`StudentView.jsx`)**:
  `expireAt = new Date(Date.now() + retentionDays * 86,400,000 ms)`
* **Video Jobs (`scheduledTasks.js` / `SessionReviewView.jsx`)**:
  `expireAt = new Date(Date.now() + videoRetentionDays * 86,400,000 ms)`
* **Zip Export Jobs (`VideoLibrary.jsx`)**:
  `expireAt = new Date(Date.now() + 7 * 86,400,000 ms)` (Standard 7-day export window)

---

## ⚡ 2. Real-Time Event-Driven Deletion Triggers (`functions/storage_triggers/`)

### `onScreenshotDocDeleted`
* **Trigger**: `onDocumentDeleted('screenshots/{screenshotId}')`
* **Behavior**: Extracts `imagePath` and immediately deletes the physical image blob from Cloud Storage (`bucket.file(imagePath).delete({ ignoreNotFound: true })`).
* **Guarantee**: Eliminates orphaned image files when documents are removed by Firestore TTL, teacher manual delete, or class deletion.

### `onVideoJobDocDeleted`
* **Trigger**: `onDocumentDeleted('videoJobs/{jobId}')`
* **Behavior**: Extracts `videoPath` (e.g., `videos/{classId}/{jobId}.mp4`) and deletes the compiled video file from Cloud Storage.

### `onZipJobDocDeleted`
* **Trigger**: `onDocumentDeleted('zipJobs/{jobId}')`
* **Behavior**: Extracts `zipPath` (e.g., `zips/{classId}/{jobId}.zip`) and deletes the temporary ZIP archive from Cloud Storage.

### `onAudioDocDeleted`
* **Trigger**: `onDocumentDeleted('audio/{audioId}')`
* **Behavior**: Extracts `audioPath` and immediately deletes the physical audio file (.webm) from Cloud Storage (`bucket.file(audioPath).delete({ ignoreNotFound: true })`).

### `onLectureRecordingDeleted`
* **Trigger**: `onDocumentDeleted('classes/{classId}/lectureRecordings/{recordingId}')`
* **Behavior**: Extracts `audioGcsPath`, `videoGcsPath`, `vttGcsPath`, and `srtGcsPath` from the lecture recording document and deletes all associated media and subtitle blobs from Cloud Storage.

### `onClassRetentionUpdated`
* **Trigger**: `onDocumentUpdated('classes/{classId}')`
* **Timeout**: 300 seconds | **Memory**: 512MiB
* **Behavior**:
  1. Detects changes when a teacher alters `retentionDays` or `videoRetentionDays`.
  2. Queries existing `screenshots`, `audio`, and `videoJobs` for that class in **500-item chunks**.
  3. Computes `newExpireAt = doc.timestamp + (newDays * 86.4M ms)`.
  4. If `newExpireAt <= now`: Deletes the document immediately (cascading to storage deletion).
  5. If `newExpireAt > now`: Updates the `expireAt` field with the new future timestamp.

---

## 🗑️ 3. Comprehensive Cascading Class Deletion (`onClassDocDeleted`)

When a teacher deletes a class in the UI (`ClassManagement.jsx`), only one quick Firestore operation is executed:
```javascript
await deleteDoc(doc(db, 'classes', classId));
```

The Cloud Function **`onClassDocDeleted`** (`functions/storage_triggers/cleanupTriggers.js`) is triggered and executes a **4-stage cascading purge**:

```mermaid
flowchart TD
    A[Teacher Deletes Class in UI] -->|deleteDoc 'classes/classId'| B[(Firestore)]
    B -->|Trigger Event| C[onClassDocDeleted Function]
    
    subgraph S1 [Stage 1: Cloud Storage Purge]
        C --> St1[Purge screenshots/classId/*]
        C --> St2[Purge videos/classId/*]
        C --> St3[Purge audio/classId/*]
        C --> St4[Purge recordings/classId/*]
        C --> St5[Purge zips/classId/*]
    end
    
    subgraph S2 [Stage 2: Firestore Batch Purge in 500s]
        C --> F1[screenshots where classId == id]
        C --> F2[videoJobs where classId == id]
        C --> F3[zipJobs where classId == id]
        C --> F4[videoAnalysisJobs where classId == id]
        C --> F5[irregularities & progress where classId == id]
        C --> F6[propertyUploadJobs where classId == id]
    end
    
    subgraph S3 [Stage 3: Subcollection Cleanup]
        C --> M1[Delete classes/classId/metadata/storage]
        C --> M2[Delete subcollections: lectureRecordings, screenBroadcast, liveSubtitles]
    end
    
    subgraph S4 [Stage 4: Profile Unlinking]
        C --> P1[FieldValue.arrayRemove classId from teacherProfiles]
        C --> P2[FieldValue.arrayRemove classId from studentProfiles]
    end
```

### Stage Details:
1. **Stage 1 (Cloud Storage Purge)**:
   Purges all file prefixes under the class directory (`screenshots/{classId}/`, `videos/{classId}/`, `audio/{classId}/`, `recordings/{classId}/`, `zips/{classId}/`).
2. **Stage 2 (Firestore Collection Batch Purge)**:
   Queries and batch-deletes all documents linked by `classId` in 500-item chunks across:
   * `screenshots`
   * `videoJobs`
   * `zipJobs`
   * `videoAnalysisJobs`
   * `irregularities`
   * `progress`
   * `propertyUploadJobs`
3. **Stage 3 (Subcollection Purge)**:
   Deletes `classes/{classId}/metadata/storage` tracking doc.
4. **Stage 4 (User Profile Unlinking)**:
   Queries `teacherProfiles` and `studentProfiles` where `classes` array contains `classId` and calls `FieldValue.arrayRemove(classId)`.

---

## 🛡️ 4. Data Safety & Isolation Model

| Entity | Impact on Class Deletion | Why It Is Safe |
| :--- | :--- | :--- |
| **Teacher Accounts** | **Preserved** | Auth accounts & profile documents remain intact. Only the deleted `classId` is removed from their `classes` array. |
| **Student Accounts** | **Preserved** | Students can continue logging in. Other enrolled courses remain active and unaffected. |
| **Other Classes** | **Isolated & Untouched** | Storage folders are strictly scoped (`.../{classId}/`) and queries use exact `.where('classId', '==', classId)` filters. |
| **Quota Metrics** | **Auto-Adjusted** | Storage deletions automatically trigger `onObjectDeleted` to keep system storage calculations accurate. |

---

## ⚙️ 5. Firestore Native TTL Policy Setup

To ensure Firestore automatically prunes expired documents natively, enable TTL on the `expireAt` field for the relevant collections:

```bash
# Enable TTL on screenshots
gcloud firestore fields ttls update expireAt --collection-group=screenshots --enable-ttl

# Enable TTL on audio telemetry
gcloud firestore fields ttls update expireAt --collection-group=audio --enable-ttl

# Enable TTL on videoJobs
gcloud firestore fields ttls update expireAt --collection-group=videoJobs --enable-ttl

# Enable TTL on zipJobs
gcloud firestore fields ttls update expireAt --collection-group=zipJobs --enable-ttl
```

---

## 🎥 6. Teacher Lecture Recording & Telemetry Deletion Lifecycle

Teacher lecture recordings (`classes/{classId}/lectureRecordings/{sessionId}`) and telemetry follow rigorous deletion lifecycle policies:
- **Clean Video, Pure Audio & Multi-CC Artifacts**: Stored at `recordings/{classId}/{sessionId}/` containing:
  - `lecture.webm` (composite screen + mic recording).
  - `lecture_audio.webm` (pure Opus audio track used for low-bandwidth Gemini speech transcription).
  - `subtitles_*.vtt` and `subtitles_*.srt` (multilingual subtitle tracks).
- **Teacher Sovereign Discard & On-Demand Deletion**:
  - Teachers can delete any lecture recording directly from the **Lecture Recordings View** via the **"🗑️ Delete Recording"** button.
  - Deleting the `classes/{classId}/lectureRecordings/{sessionId}` Firestore document fires the `onLectureRecordingDeleted` Cloud Storage trigger, which automatically purges all files under `recordings/{classId}/{sessionId}/` from Google Cloud Storage (`force: true`).
  - Quota is decremented immediately in `classes/{classId}/metadata/storage` via `updateStorageUsageOnDelete`.
- **Granular Selective Telemetry Purge (`purgeClassTelemetryData`)**:
  - From the **Data Management View**, teachers have granular control to selectively purge telemetry:
    - Target toggles: Screenshots, Audio recordings, Compiled Student Videos, Lecture Recordings, Irregularities & Evidence Photos, and Activity/Bingo Audit Records.
    - Scope presets: Current Lesson, Older than 14 Days, Older than 30 Days, Older than 90 Days, All Time (Entire History), or Custom Range.
    - **Dual Storage & Document Sweeping**: Not only purges Firestore documents, but also actively sweeps physical Cloud Storage prefixes (`screenshots/{classId}/`, `audio/{classId}/`, `videos/{classId}/`, `recordings/{classId}/`, `irregularities/{classId}/`) for files created in range, permanently eliminating orphaned storage files.
    - Queries use direct fail-fast composite index queries to identify telemetry within range, surfacing index or precondition errors immediately without unbounded in-memory collection scans.
    - Purges both physical Cloud Storage blobs and Firestore documents in safe 400-item chunks.
    - **Automatic Quota Reconciliation**: Every purge operation concludes with an automated invocation of `recalculateStorageUsageInternal` to sync the storage quota bar immediately.
    - **Data Integrity & Pre-Purge Attendance Safeguard**:
      - Purging raw screenshots to reclaim quota **never deletes student attendance or AI analysis**.
      - **Pre-Purge Freezing**: In `purgeClassTelemetryData`, before deleting screenshot documents, the system scans for overlapping lessons without finalized attendance, computes their attendance snapshot from raw screenshots, and writes them to `lessons/{lessonId}` before deleting any raw telemetry.
      - **Post-Lesson Freezing**: In `handlePostLessonMediaConsolidation`, as soon as a scheduled lesson concludes, the attendance snapshot is immediately frozen in `classes/{classId}/lessons/{lessonId}` while screenshots are fresh.
      - **Multi-Source Recovery**: Even if raw interim screenshots are purged, attendance is reconstructed from completed screencast videos in `videoJobs` and AI `workingMinutes`. Positive attendance is never overwritten with zeroes. Student attendance records, activity milestone progress, task submissions, and grades remain permanently preserved in Firestore.
- **Autonomous Storage Quota Reconciliation (`recalculateStorageUsage`)**:
  - Teachers can trigger on-demand storage audits from Data Management via **"🔄 Recalculate Storage"**.
  - Directly scans physical GCS blobs across `screenshots/{classId}/`, `videos/{classId}/`, `zips/{classId}/`, `audio/{classId}/`, `recordings/{classId}/`, and `irregularities/{classId}/` to heal any metric drift in `classes/{classId}/metadata/storage`.
- **Cascading Removal on Class Deletion**:
  - When an entire class is deleted via `onClassDocDeleted`, Cloud Storage prefixes (`screenshots/{classId}/`, `videos/{classId}/`, `zips/{classId}/`, `audio/{classId}/`, `recordings/{classId}/`, `taskDemos/{classId}/`) are automatically wiped.
  - Subcollections including `lectureRecordings`, `tasks` (with `submissions`), `bingoSessions`, `status`, `screenBroadcast`, and `liveSubtitles` are completely purged from Firestore.

---

## ✂️ 7. Immediate Screenshot Purge & Practical Task Video Slicing Safeguards

### The Immediate Purge Strategy (`purgeScreenshotsAfterVideoCombine: true`)
When enabled in Class Settings, the system maximizes storage efficiency by immediately deleting routine raw screenshots (`screenshots/{screenshotId}` and `screenshots/{classId}/*.jpg`) as soon as the lesson screencast MP4 finishes compiling. This saves up to 85% of Cloud Storage quota per student session.

### The Race Condition with In-Class Practical Tasks
In practical task challenges, students perform hands-on coding or lab exercises during live class while continuous screenshot capturing is active. 

If task videos were compiled independently from raw screenshots alongside class video compilation:
* **Race Condition A (Class Finishes First)**: Class video compilation concludes and triggers immediate screenshot deletion. When the task compilation job starts, all student screenshots have already been purged, causing the task video job to fail with `0 screenshots found`.
* **Race Condition B (Task Finishes First)**: If a student finishes a practical task early and task compilation triggers immediate deletion, it would wipe the screenshots mid-lesson, creating a massive missing gap in the student's overall class screencast.

```mermaid
sequenceDiagram
    autonumber
    actor Student as Student Client (StudentView.jsx)
    participant FS as Firestore
    participant VP as processVideoJob Cloud Function
    participant GCS as Cloud Storage
    participant AI as Gemini 3.8 Flash AI Rubric Grading

    Note over Student,FS: 1. Live Class Practical Task Challenge
    Student->>FS: Completes Task Attempt (status: 'awaiting_class_video')
    Student->>FS: Class Ends -> videoJobs (type: 'class_screencast')

    Note over VP,GCS: 2. Unified Class Video Compilation
    VP->>GCS: Compiles class frames into /tmp/{jobId}.mp4
    VP->>GCS: Uploads class video to videos/{classId}/{jobId}.mp4

    Note over VP,GCS: 3. Stream-Copy Sub-Clip Slicing (Approach 2)
    VP->>FS: slicePendingTaskSubmissions (queries 'awaiting_class_video' attempts)
    VP->>VP: Matches attempt timestamp window against frame sequence
    VP->>VP: ffmpeg -ss {startSec} -t {durSec} -i class.mp4 -c copy attempt.mp4 (Takes ~200ms)
    VP->>GCS: Uploads attempt clip to classes/{classId}/tasks/{taskId}/submissions/...
    VP->>FS: Updates attempt & submission status to 'compiling_complete'
    VP->>FS: Updates task videoJob to 'completed'
    FS-->>AI: Triggers triggerAutomaticAnalysis for automated rubric grading

    Note over VP,GCS: 4. Post-Slicing Immediate Screenshot Purge
    VP->>FS: if (!isTaskSubmission && purgeScreenshotsAfterVideoCombine === true)
    VP->>GCS: Purges raw jpg screenshots safely (Zero Task Data Loss)
```

### The Architectural Solution: Stream-Copy Sub-Clip Slicing (Approach 2)
To eliminate this race condition with zero redundant resource overhead, the platform uses **Stream-Copy Sub-Clip Slicing** directly within `processVideoJob.js`:

1. **Class-Aware Task Submission Stamping (`StudentView.jsx`)**:
   - When a student submits an in-class practical task attempt while class capture is active, the attempt status is marked as `'awaiting_class_video'` and the task video job is queued with `status: 'awaiting_class_video'`.
   - `StudentView.jsx` guarantees continuous capture liveness via `isTaskActive` (`isSharing && (isCapturing || isExamActive || isTaskActive)`).
2. **Atomic Slicing in `slicePendingTaskSubmissions`**:
   - Immediately after the class video is compiled and uploaded, but **before** local `/tmp` files are deleted, `processVideoJob` discovers all pending task attempts for that student.
   - It calculates the precise start offset (`startSec`) and duration (`durSec`) by matching the task attempt window against the sorted screenshot timestamps.
   - It slices the sub-clip in milliseconds using `ffmpeg -ss <startSec> -t <durSec> -c copy -avoid_negative_ts make_zero -movflags +faststart`.
   - If stream-copy fails due to keyframe boundaries, an ultrafast re-encode fallback (`-preset ultrafast -c:v libx264 -crf 28`) is applied automatically.
3. **Automated AI Grading Dispatch**:
   - Sliced sub-clips are uploaded directly to `classes/{classId}/tasks/{taskId}/submissions/{studentUid}/attempt_{attemptNumber}.mp4`.
   - The task attempt document is updated to `compiling_complete` and the task `videoJobs` document is marked `status: 'completed'` with `slicedFromClassVideo: true`.
   - This status update triggers `triggerAutomaticAnalysis` in `functions/ai_flows`, dispatching Gemini 3.8 Flash automated rubric grading without manual teacher intervention.
4. **Execution Order Guarantee**:
   - Raw screenshots are purged **only after** all task sub-clips are extracted, verified, and uploaded.
5. **Standalone Task Guard**:
   - Standalone task video jobs (`isTaskSubmission: true`) are explicitly prevented from executing class-wide screenshot purges:
     ```javascript
     if (!isTaskSubmission && classData?.purgeScreenshotsAfterVideoCombine !== false) {
       await purgeScreenshotsAfterCombine(...);
     }
     ```
6. **Homework / Out-of-Class Support**:
   - When students complete practical tasks outside of scheduled class hours, `StudentView.jsx` marks the attempt as `'compiling'` and queues the task video job with `status: 'pending'`. The standalone compilation runs independently and will never purge screenshots.
7. **Post-Class / Retroactive Extraction Independence (`extractRetroactiveTaskSubmissions`)**:
   - When instructors define practical tasks *after* a class session has concluded (`scheduleMode: 'retroactive'`), raw screenshot documents and image blobs have typically already been deleted by the post-combine purge.
   - The retroactive extraction engine bypasses raw screenshots entirely and operates downstream on the finalized class MP4 (`videos/{classId}/{jobId}.mp4`).
   - Because compiled class videos are governed by `videoRetentionDays` (default 90 days), instructors can define and extract tasks days or weeks after the lesson.
   - Retroactive task extraction is strictly read-only with respect to historical class media; it creates sub-clips under `classes/{classId}/tasks/{taskId}/submissions/...` and never triggers deletion or truncation of the underlying class recordings.

---

[← Back to Documentation Index](../README.md#documentation-index)



