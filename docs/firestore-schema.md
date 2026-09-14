# Firestore Schema

[🏠 Documentation Index](../README.md#documentation-index) | [👨‍🏫 Teacher Manual](./user-manual-teacher.md) | [🧑‍🎓 Student Manual](./user-manual-student.md) | [🛠️ Admin Manual](./user-manual-admin.md) | [📘 UI Catalog](./comprehensive-ui-controls-and-features-catalog.md)

---

This document outlines the Firestore database schema for the AI Invigilator application.

---

## 📑 Table of Contents

1. [Schema Diagram & Entity Relationships](#schema-diagram)
2. [Collections](#collections)
   - [`aiJobs`](#aijobs)
   - [`audio`](#audio)
   - [`classes`](#classes)
   - [`irregularities`](#irregularities)
   - [`mails`](#mails)
   - [`notifications`](#notifications)
   - [`progress`](#progress)
   - [`performanceMetrics`](#performancemetrics)
   - [`prompts`](#prompts)
   - [`propertyUploadJobs`](#propertyuploadjobs)
   - [`screenshots`](#screenshots)
   - [`studentProfiles`](#studentprofiles)
   - [`students`](#students)
   - [`teacherProfiles`](#teacherprofiles)
   - [`teachers`](#teachers)
   - [`users`](#users)
   - [`videoAnalysisJobs`](#videoanalysisjobs)
   - [`videoJobs`](#videojobs)
   - [`zipJobs`](#zipjobs)
3. [Relationships](#relationships)
4. [Indexes & Query Optimization](#-indexes--query-optimization)
   - [1. Composite Index Matrix](#1-composite-index-matrix)
   - [2. Time-To-Live (TTL) Automatic Deletion Policies](#2-time-to-live-ttl-automatic-deletion-policies)
   - [3. Student Self-Service Records & Security Isolation](#3-student-self-service-records--security-isolation)

---

## Schema Diagram

```mermaid
erDiagram
    users {
        string uid PK
        string email
        string name
        string role "teacher | student"
    }

    classes {
        string classId PK
        map students "uid:email map"
        map teachers "uid:email map"
        array studentEmails "enrolled student emails"
        array teacherEmails "enrolled teacher emails"
        number storageQuota "Storage limit in bytes"
        number retentionDays "Raw screenshots TTL days"
        number videoRetentionDays "Compiled MP4 TTL days"
        object schedule "TimeSlots and TimeZone"
        array ipRestrictions "Allowed CIDR IP subnets"
        boolean automaticCapture
        boolean automaticCombine
        number aiQuota "AI budget limit in USD"
        string aiModel "Gemini model name"
        string aiMonitoringMode "hybrid | cloud_only | client_only | disabled"
        boolean enableClientAi "MediaPipe face tracking"
        string gazeSensitivity "relaxed | standard | strict | custom"
        number customYawAngle "Custom yaw degrees"
        number customPitchDownAngle "Custom look-down pitch"
        number customPitchUpAngle "Custom look-up pitch"
        number faceDebounceSeconds "Deviation debounce seconds"
        boolean enableCloudFallback "Cloud Gemini fallback"
        boolean enableAudioCapture "Continuous microphone capture"
        string audioCaptureMode "mandatory | optional"
        boolean audioSilenceSuppression "Discard quiet chunks"
        boolean enableSegmentTranscription "Moving window STT"
        boolean enableCombinedLongAudio "Full-session diarization"
        number audioMovingWindowDuration "Rolling window seconds"
        number audioMovingWindowStride "Sliding stride seconds"
        number frameRate "Capture interval in seconds"
        number imageQuality "JPEG quality"
        number maxImageSize "Max byte size limit"
        string captureMode "screen | dual | webcam"
        boolean isCapturing
        timestamp captureStartedAt
        boolean isExamActive "Live proctored exam mode toggle"
        timestamp examActiveUpdatedAt "Timestamp of last exam mode toggle"
        array examPeriods "[{ id, name, startDate, endDate }] - Exam/test periods withheld from students"
        string studentRecordingsPolicy "always_enabled | disabled | delayed_release"
        string studentRecordingsReleaseDate "ISO timestamp"
        array questionBank "[{ id, question, options, correctIndex, explanation, topic }] - Predefined MCQ pool"
        number bingoRetryDelayMinutes "Strike 2 grace retry delay in minutes (1-15m)"
        boolean autoBingoEnabled "Toggle periodic automated Bingo verification"
        number autoBingoIntervalMinutes "Interval in minutes (15-60m, default 20m)"
        string autoBingoMode "question_bank | teacher_screen | student_screen"
        number autoBingoJitterMinutes "Anti-collusion stagger jitter in minutes (0-5m)"
        timestamp lastAutoBingoAt "Timestamp of last automated Bingo execution"
    }

    teacherProfiles {
        string teacherUid PK
        array classes "Enrolled class IDs"
    }

    studentProfiles {
        string studentUid PK
        array classes "Enrolled class IDs"
    }

    teachers {
        string teacherUid PK
    }

    teachers_messages "messages (teacher private)" {
        string messageId PK
        string classId FK
        string message
        boolean read
        timestamp timestamp
    }

    screenshots {
        string screenshotId PK
        string classId FK
        string studentUid FK
        string email "denormalized"
        string channel "screen | webcam"
        string imagePath "GCS storage path"
        number size "File size in bytes"
        timestamp timestamp
        timestamp expireAt "Firestore TTL expiration"
        boolean deleted
    }

    audio {
        string audioId PK
        string classId FK
        string studentUid FK
        string email "denormalized"
        string audioPath "GCS storage path"
        number duration "Window duration in seconds"
        number strideDuration "Sliding stride in seconds"
        number strideIndex "Stride index sequence"
        boolean isSlidingWindow
        number windowStartSec "Session start offset"
        number peakVolume "Peak RMS volume"
        number averageVolume "Average RMS volume"
        boolean isSilenceSuppressed
        number size "File size in bytes"
        timestamp timestamp
        timestamp expireAt "Firestore TTL expiration"
        boolean deleted
    }

    audio_audits {
        string auditId PK
        string classId FK
        string studentUid FK
        string studentEmail "denormalized"
        string verdict "clean_exam | suspicious_collaboration"
        number speakerCount "Total distinct voices"
        string summary "Forensic audio summary"
        string transcript "Full session transcript"
        string audioUrl "Stitched master audio GCS path"
        timestamp timestamp
    }

    videoJobs {
        string jobId PK
        string classId FK
        string studentUid FK
        string studentEmail "denormalized"
        timestamp startTime
        timestamp endTime
        string status "pending | processing | completed | failed"
        timestamp startedAt
        timestamp finishedAt
        string videoPath "GCS compiled video path"
        number duration "Video duration in seconds"
        number size "File size in bytes"
        string error
        string errorStack
        string ffmpegError
        timestamp expireAt "Firestore TTL expiration"
        boolean isExam "Exam session recording"
    }

    zipJobs {
        string jobId PK
        string classId FK
        string requesterUid FK
        timestamp startTime
        timestamp endTime
        string status "pending | processing | completed | failed"
        string zipPath "GCS zip archive path"
        string error
        array videos "Included video paths"
        timestamp expireAt "7-day retention expiration"
    }

    videoAnalysisJobs {
        string jobId PK
        string classId FK
        string requesterUid FK
        string prompt
        string status "pending | processing | completed | failed"
        timestamp createdAt
        timestamp startTime
        timestamp endTime
        string filterField
        array aiJobIds
        array videos
    }

    aiJobs {
        string jobId PK
        string classId FK
        string studentUid FK
        string studentEmail "denormalized"
        string prompt
        string status "pending | processing | completed | failed"
        string result "AI structured analysis output"
        number costUsd "Calculated token cost in USD"
        timestamp createdAt
    }

    irregularities {
        string irregularityId PK
        string classId FK
        string studentUid FK
        string email "denormalized"
        string type "visual | audio"
        string title
        string message
        string imageUrl "Webcam/screen snapshot URL"
        string audioPath "GCS audio snippet path"
        number speakerCount "Distinct speakers identified"
        string riskLevel "none | low | medium | high"
        timestamp timestamp
    }

    mails {
        string mailId PK
        string to "Recipient email"
        string subject
        string html "Email HTML body"
    }

    notifications {
        string notificationId PK
        string userId "Target user UID"
        string message
        boolean read
        timestamp timestamp
    }

    progress {
        string progressId PK
        string classId FK
        string studentUid FK
        string studentEmail "denormalized"
        string progress "Progress report content"
        timestamp timestamp
    }

    prompts {
        string promptId PK
        string name
        string category "image | video | audio"
        string prompt
        array applyTo
        string accessLevel "private | shared | public"
        string owner "Creator UID"
        array sharedWith "User UIDs or Emails"
        timestamp createdAt
    }

    propertyUploadJobs {
        string jobId PK
        string classId FK
        string requesterUid FK
        string status "pending | processing | completed | failed"
        timestamp createdAt
    }

    system_config_pricing "system_config/pricing" {
        string id PK
        map rates "Live Google Cloud Gemini SKU rates"
        timestamp lastSyncedAt "Daily sync timestamp"
    }

    bingoRecords "classes/{classId}/bingoRecords" {
        string bingoId PK
        string classId FK
        string studentUid FK "Target student UID or 'all'"
        string questionSource "question_bank | teacher_screen | student_screen"
        string triggerType "manual | scheduled | retry"
        string question
        array options "4 MC options"
        number correctIndex "0-3"
        number timeLimitSeconds "45s default"
        number expiresAtMillis
        string status "pending | passed | failed_incorrect | missed_timeout"
        number strikeNumber "1 | 2"
        number selectedIndex "Student selected choice"
        number responseTimeSec
        boolean windowFocused
        timestamp createdAt
        timestamp answeredAt
    }

    attendanceAdjustments "classes/{classId}/attendanceAdjustments" {
        string adjustmentId PK
        string classId FK
        string studentUid FK
        timestamp startTime
        timestamp endTime
        number startMillis
        number endMillis
        number deductedMinutes
        number voidedMinutesCount
        string strike1BingoId
        string strike2BingoId
        string reason
        timestamp appliedAt
        timestamp createdAt
    }

    classes ||--o{ studentProfiles : "enrolled in"
    classes ||--o{ teacherProfiles : "managed by"
    classes }o--|| users : "created by teachers"
    classes ||--o{ bingoRecords : "dispatches"
    classes ||--o{ attendanceAdjustments : "penalizes unacknowledged presence"
    bingoRecords }o--|| studentProfiles : "challenges"
    attendanceAdjustments }o--|| studentProfiles : "adjusts attendance for"
    screenshots }o--|| classes : "captured in"
    screenshots }o--|| studentProfiles : "captured for"
    audio }o--|| classes : "recorded in"
    audio }o--|| studentProfiles : "spoken by"
    audio_audits }o--|| classes : "audited in"
    audio_audits }o--|| studentProfiles : "audits student"
    videoJobs }o--|| classes : "compiled for"
    videoJobs }o--|| studentProfiles : "belongs to"
    videoAnalysisJobs ||--|| videoJobs : "analyzes"
    aiJobs }o--|| videoAnalysisJobs : "generates"
    aiJobs }o--|| prompts : "uses prompt"
    irregularities }o--|| classes : "flagged in"
    irregularities }o--|| studentProfiles : "attributed to"
    classes ||--o{ irregularities_subcollection "classes/{classId}/irregularities" : "stores class-scoped incidents"
    progress }o--|| classes : "tracks student in"
    progress }o--|| studentProfiles : "evaluates"
    propertyUploadJobs }o--|| classes : "imports properties for"
```

## Collections

### `aiJobs`

Stores complete audit trails and billing telemetry for all AI processing jobs.

*   **Document ID**: Auto-generated (`jobId`).
*   **Fields**:
    *   `jobId`: (string) Unique job identifier.
    *   `classId`: (string) The ID of the class.
    *   `studentUid`: (string) The UID of the student associated with the job (or `null` for class-wide grid analyses).
    *   `studentEmail`: (string) The student's email, denormalized for search and reporting.
    *   `jobType`: (string) The category of analysis (`analyzeImage`, `analyzeAllImages`, `analyzeSingleVideo`, `cloudFallbackFaceAnalysis`, `analyzeAudio`, `liveSubtitleStream`, `other`).
    *   `modelUsed`: (string) Exact Gemini model executed (`gemini-3.5-flash-lite`, `gemini-3.7-flash`, `gemini-3.7-pro`, `gemini-3.5-transcribe`, `gemini-3.5-transcribe-live`, `gemini-3.1-flash-live-preview`, `gemini-2.5-flash-native-audio-preview-12-2025`).
    *   `durationSeconds`: (number, optional) Live streaming session duration in seconds (for `liveSubtitleStream`).
    *   `prompt`: (string) The prompt or instruction text sent to the model.
    *   `status`: (string) Execution status (`pending`, `processing`, `completed`, `failed`, `blocked-by-quota`).
    *   `cost`: (number) Exact cost computed in USD (6 decimal places, e.g. `0.000420`).
    *   `usage`: (map) Model token consumption metadata (`{ inputTokens: number, outputTokens: number }` or `{ promptTokenCount, candidatesTokenCount }`).
    *   `result`: (string) The structured result or markdown analysis generated by the model.
    *   `timestamp`: (timestamp) Creation timestamp of the job record.
    *   `createdAt`: (timestamp) Legacy timestamp alias.
    *   `expireAt`: (timestamp) TTL timestamp for automated Firestore data lifecycle purging.

### `audio`

Stores metadata for recorded audio segments and sliding moving windows.

*   **Document ID**: Auto-generated (`audioId`).
*   **Fields**:
    *   `audioId`: (string) Document ID.
    *   `classId`: (string) The ID of the class the audio segment belongs to.
    *   `studentUid`: (string) The UID of the student who recorded the segment.
    *   `studentEmail`: (string) The student's email, denormalized for easier querying.
    *   `audioPath`: (string) The path to the audio file in Firebase Storage (`audio/{classId}/{studentUid}/{fileName}`).
    *   `duration`: (number) The duration of the recorded window in seconds (e.g., `30`).
    *   `strideDuration`: (number) The sliding stride interval in seconds (e.g., `15`).
    *   `strideIndex`: (number) Sequential index of the stride window.
    *   `isSlidingWindow`: (boolean) Indicates if the segment is an overlapping sliding window.
    *   `windowStartSec`: (number) Absolute session second offset when this window began.
    *   `peakVolume`: (number) Peak audio volume level (0-100%).
    *   `averageVolume`: (number) Average audio volume level (0-100%).
    *   `isSilenceSuppressed`: (boolean) Whether silence suppression is enabled.
    *   `timestamp`: (timestamp) Server timestamp when the segment was uploaded.
    *   `expireAt`: (timestamp) Expiration timestamp based on class `retentionDays`, purged by automated TTL/cleanup triggers.
    *   `deleted`: (boolean) Soft delete flag.

### `classes`

Stores information about each class.

*   **Document ID**: `classId` (string)
*   **Fields**:
    *   `studentEmails`: (array) An array of student emails used for enrollment.
    *   `teacherEmails`: (array) An array of teacher emails used for enrollment.
    *   `students`: (map) A map of student UIDs to their email addresses (`{ <studentUid>: <studentEmail> }`).
    *   `teachers`: (map) A map of teacher UIDs to their email addresses (`{ <teacherUid>: <teacherEmail> }`).
    *   `storageQuota`: (number) The storage limit for the class in bytes.
    *   `retentionDays`: (number) The screenshot data retention period in days (e.g., 7, 14, 30, 90). Screenshots older than this duration are automatically purged.
    *   `videoRetentionDays`: (number) The video retention period in days (e.g., 30, 90, 180, 365). Compiled lesson videos older than this duration are automatically purged.
    *   `schedule`: (object) An object containing the class schedule.
        *   `startDate`: (string) The start date of the class.
        *   `endDate`: (string) The end date of the class.
        *   `timeZone`: (string) The time zone for the class.
        *   `timeSlots`: (array) An array of time slots, each with `startTime`, `endTime`, and an array of `days`.
    *   `ipRestrictions`: (array) An array of allowed IP addresses.
    *   `automaticCapture`: (boolean) A boolean indicating if automatic screen capture is enabled.
    *   `automaticCombine`: (boolean) A boolean indicating if automatic video combination is enabled.
    *   `aiQuota`: (number) The AI processing quota for the class in USD (e.g. `10.00` or `50.00`).
    *   `aiUsedQuota`: (number) Cumulative AI expenditure in USD (updated atomically via `onAiJobCreated` Cloud Functions triggers).
    *   `aiModel`: (string) Gemini model for multimodal analysis (`gemini-3.5-flash-lite`, `gemini-3.7-flash`, `gemini-3.7-pro`).
    *   `aiMonitoringMode`: (string) Face and gaze invigilation mode (`hybrid`, `cloud_only`, `client_only`, `disabled`).
    *   `enableClientAi`: (boolean) Whether client-side on-device MediaPipe monitoring is active.
    *   `gazeSensitivity`: (string) Sensitivity preset (`relaxed`, `standard`, `strict`, `custom`).
    *   `customYawAngle`: (number) Custom left/right yaw deviation threshold in degrees.
    *   `customPitchDownAngle`: (number) Custom look-down pitch threshold in degrees (e.g. `-22`).
    *   `customPitchUpAngle`: (number) Custom look-up pitch threshold in degrees (e.g. `26`).
    *   `faceDebounceSeconds`: (number) Sustained seconds of deviation before registering looking away irregularity (e.g. `3`).
    *   `enableCloudFallback`: (boolean) Whether to trigger Cloud Gemini Vision inspections on client detection anomalies or failure.
    *   `enableAudioCapture`: (boolean) Whether continuous microphone audio capture is enabled for the class.
    *   `audioCaptureMode`: (string) Microphone requirement (`mandatory`, `optional`).
    *   `audioSilenceSuppression`: (boolean) Automatically discards silent audio chunks (saves >80% bandwidth & quota).
    *   `enableSegmentTranscription`: (boolean) Mode 1: Moving Window Real-Time AI Transcription (`gemini-3.5-transcribe`).
    *   `enableCombinedLongAudio`: (boolean) Mode 2: Full Session Combined Long Audio Diarization & Chat Audit (`gemini-3.5-transcribe`).
    *   `audioMovingWindowDuration`: (number) Rolling audio window duration in seconds (default `30`s).
    *   `audioMovingWindowStride`: (number) Sliding stride overlap in seconds (default `15`s, 50% overlap).
    *   `frameRate`: (number) The frame rate for screen capture (in seconds per frame).
    *   `imageQuality`: (number) The image quality for screen capture.
    *   `maxImageSize`: (number) The maximum image size for screen capture in bytes.
    *   `captureMode`: (string) Default stream capture mode (`dual`, `screen`, `webcam`).
    *   `isCapturing`: (boolean) A boolean indicating if screen capture is currently active.
    *   `captureStartedAt`: (timestamp) A timestamp indicating when the capture started.
    *   `isExamActive`: (boolean) Live in-class exam mode toggle managed from `ControlsPanel.jsx` / `MonitorView.jsx`. When `true`, enforces strict assessment confidentiality across all connected student portals, mandates full-screen sharing, and triggers exam metadata stamping on all recorded media.
    *   `examActiveUpdatedAt`: (timestamp) Server timestamp recording when `isExamActive` was last toggled.
    *   `examPeriods`: (array of objects) Specific exam and test periods defined by the instructor (`[{ id, name, startDate, endDate }]`). Any sessions or video recordings falling within these defined windows are withheld from student sharing and blocked by zero-trust backend authorization to protect assessment questions from leakage.
    *   `studentRecordingsPolicy`: (string) Access policy governing student visibility and download of screen recordings (`always_enabled`, `disabled`, `delayed_release`). Prevents assessment question extraction.
    *   `studentRecordingsReleaseDate`: (string|null) Scheduled ISO 8601 release timestamp when recordings become accessible under `delayed_release`.
    *   `questionBank`: (array of objects) Predefined multiple-choice question pool for the Bingo verification system (`[{ id, question, options, correctIndex, explanation, topic, createdAt }]`). Managed via `BingoQuestionBankModal.jsx`. Synchronized across both `classes/{classId}.questionBank` (class-level field) and `classes/{classId}/classProperties/config.bingoQuestionBank` (subcollection configuration) for seamless operational compatibility.
    *   `bingoRetryDelayMinutes`: (number) Configurable grace period delay in minutes (integer between 1 and 15, default `3`) before Google Cloud Tasks automatically dispatches a Strike 2 follow-up verification challenge to an unacknowledged student.
    *   `autoBingoEnabled`: (boolean) Toggle enabling periodic automated Bingo verification during active capture sessions.
    *   `autoBingoIntervalMinutes`: (number) Configurable cadence in minutes (between 15 and 60, default `20`) between automatic Bingo dispatches.
    *   `autoBingoMode`: (string) Question generation strategy for automated runs (`question_bank`, `teacher_screen`, `student_screen`). Defaults to zero-token `question_bank` ($0.00).
    *   `autoBingoJitterMinutes`: (number) Maximum randomized anti-collusion jitter window in minutes (0–5, default `3`) used to stagger student challenge deliveries via Google Cloud Tasks.
    *   `lastAutoBingoAt`: (timestamp) Server timestamp recording when the automated scheduler last triggered a Bingo run for this class.
*   **Subcollections**:
    *   **`lessons`**: Stores aggregated data and AI analysis results for each lesson.
        *   **Document ID**: A hash of the lesson's start and end times.
        *   **Fields**:
            *   `startTime`: (timestamp) The start time of the lesson.
            *   `endTime`: (timestamp) The end time of the lesson.
            *   `generalFeedback`: (array) An array of strings containing AI-generated feedback for the whole class.
            *   `generalSummary`: (string) An AI-generated summary for the whole class.
            *   `students`: (map) A map where each key is a `studentUid`.
                *   `workingMinutes`: (number) AI-estimated working minutes.
                *   `sharedScreenMinutes`: (number) Minutes calculated from screen sharing.
                *   `attendance`: (array) A per-minute array of numbers representing attendance state: `0` = absent / no screen, `1` = present & screen verified, `2` = voided presence due to consecutive unacknowledged Bingo checks.
                *   `deductedMinutes`: (number) Cumulative minutes deducted from the student's attendance total due to consecutive failed or missed Bingo verification checks.
                *   `feedback`: (array) An array of strings containing student-specific AI feedback.
                *   `summary`: (string) A student-specific AI-generated summary.
    *   **`classProperties`**: Stores class-wide custom properties.
        *   **Document ID**: `config`
        *   **Fields**: A map of custom key-value pairs.
    *   **`metadata`**: Stores metadata for the class, like usage information.
        *   **Document ID**: Can be `storage` or `ai`.
        *   **If Document ID is `storage`**:
            *   `storageUsage`: (number) The total storage used by the class in bytes.
            *   `storageUsageScreenShots`: (number) Storage used by screenshots.
            *   `storageUsageVideos`: (number) Storage used by videos.
            *   `storageUsageZips`: (number) Storage used by zips.
        *   **If Document ID is `ai`**:
            *   `aiUsedQuota`: (number) The used AI processing quota.
    *   **`status`**: Stores the real-time status and live preview metadata of students in the class.
        *   **Document ID**: `studentUid` (string)
        *   **Fields**:
            *   `isSharing`: (boolean) A boolean indicating if the student is actively sharing any stream (screen or webcam).
            *   `isScreenSharing`: (boolean) A boolean indicating if the student is actively sharing screen.
            *   `isWebcamSharing`: (boolean) A boolean indicating if the student is actively sharing webcam.
            *   `email`: (string) The student's email.
            *   `name`: (string) The student's name.
            *   `latestImagePath`: (string) Primary screenshot path for backward compatibility.
            *   `latestScreenPath`: (string) Cloud Storage path of student's latest screen capture (`screenshots/{classId}/{studentUid}/screen_{timestamp}.jpg`).
            *   `latestWebcamPath`: (string) Cloud Storage path of student's latest webcam capture (`screenshots/{classId}/{studentUid}/webcam_{timestamp}.jpg`).
            *   `faceStatus`: (string) Real-time AI face tracking status (`normal`, `looking_away`, `no_face`, `multiple_faces`, `loading`, `error`, `disabled`).
            *   `faceStatusReason`: (string) Human-readable explanation of the face tracking state.
            *   `gazeYaw`: (number) Head yaw angle in degrees.
            *   `gazePitch`: (number) Head pitch angle in degrees.
            *   `gazeDirection`: (string) Primary gaze orientation (`forward`, `left`, `right`, `down`, `up`).
            *   `metricDistance`: (number) Estimated metric distance in cm via depth-from-iris calculation.
            *   `irisGazeAway`: (boolean) Boolean indicating pupil deviation away from screen center.
            *   `isAudioSharing`: (boolean) Whether microphone stream is active and transmitting.
            *   `audioStatus`: (string) Acoustic activity state (`speaking`, `quiet`, `muted`).
            *   `audioLevel`: (number) Current RMS volume percentage (0-100%).
            *   `isMultiSpeaker`: (boolean) Flag when multiple simultaneous speakers are detected by Gemini.
            *   `speakerCount`: (number) Number of distinct speakers identified in recent window.
            *   `audioRiskLevel`: (string) Audio integrity classification severity (`none`, `low`, `medium`, `high`).
            *   `timestamp`: (timestamp) A timestamp of the last heartbeat / screenshot update.
            *   `lastUploadTimestamp`: (timestamp) A timestamp of the last screenshot upload.
            *   `sessionId`: (string) A unique ID for the student's session.
            *   `ipAddress`: (string) The student's IP address.
    *   **`messages`**: Stores real-time class-wide broadcast messages from teachers to all enrolled students in the class.
        *   **Document ID**: Auto-generated.
        *   **Fields**:
            *   `message`: (string) The broadcast message content.
            *   `timestamp`: (timestamp) A timestamp of when the message was sent.
            *   `senderUid`: (string) The UID of the teacher who broadcasted the message.
            *   `senderEmail`: (string) The email of the teacher who broadcasted the message.
    *   **`screenBroadcast`**: Stores teacher live screen broadcast session metadata and the active compressed screen frame stream.
        *   **Document `session`** (`classes/{classId}/screenBroadcast/session`):
            *   `isBroadcasting`: (boolean) Whether teacher screen broadcasting is currently active.
            *   `broadcastMode`: (string) Broadcast transmission mode (`'frame'`). Pure frame architecture avoiding WebRTC mesh CPU exhaustion.
            *   `teacherUid`: (string) UID of the teacher who started the broadcast.
            *   `teacherEmail`: (string) Email of the broadcasting teacher.
            *   `startedAt`: (timestamp) Server timestamp when the broadcast commenced.
            *   `endedAt`: (timestamp | null) Server timestamp when the broadcast ended.
        *   **Document `liveFrame`** (`classes/{classId}/screenBroadcast/liveFrame`):
            *   `frameData`: (string) Base64 Data URL (`data:image/jpeg;base64,...`) of the latest captured screen frame (clamped to 720p at 0.65 JPEG quality, ~35–65 KB, <8% of Firestore doc limit).
            *   `frameSeq`: (number) Monotonically increasing sequence number for viewer synchronization.
            *   `width`: (number) Frame width in pixels (clamped to max 1280).
            *   `height`: (number) Frame height in pixels (clamped to max 720).
            *   `timestamp`: (timestamp) Server timestamp of the emitted frame (emitted every 1.5s on visual change, or 5s heartbeat if static).
    *   **`screenBroadcastViewers`**: Real-time viewer presence tracker for students tuned into the teacher's screen broadcast.
        *   **Document ID**: `studentUid` (string)
        *   **Fields**:
            *   `studentEmail`: (string) Enrolled student email.
            *   `joinedAt`: (timestamp) Timestamp when the student opened the viewer modal.
            *   `status`: (string) Viewer status (`'watching'`).
            *   `connectionState`: (string) Viewer connection state (`'connected'`).
    *   **`liveSubtitles`**: Real-time teacher lecture transcription and multilingual translation stream.
        *   **Document `current`** (`classes/{classId}/liveSubtitles/current`):
            *   `active`: (boolean) Whether live subtitling is currently active for this class.
            *   `engineMode`: (string) Selected translation engine architecture (`'client'` [LiteRT + Chrome Nano], `'server'` [LiteRT + Cloud Function Gemini 2.5 Flash], or `'firebase_live'` [Firebase AI Logic Gemini Live WebSocket]).
            *   `original`: (string) Original spoken transcript (Cantonese with English technical terms).
            *   `translations`: (map of string -> string) Keyed by language code (e.g. `{ "en": "...", "zh-Hant": "...", "zh-Hans": "...", "ja": "...", "ko": "...", "es": "...", "fr": "..." }`).
            *   `isFinal`: (boolean) Flag indicating whether the turn is complete/finalized (`true`) or actively receiving token streaming (`false`).
            *   `speechLanguage`: (string) Teacher's primary spoken language code (`'zh-HK'`).
            *   `targetLanguages`: (array of strings) Enabled target languages for translation.
            *   `updatedAt`: (timestamp) Server timestamp of the latest subtitle update.
            *   `history`: (array of objects) Rolling buffer of the last 5 finalized turns (`[{ original, translations, timestamp }]`) for UI history and contextual recall.
        *   **Security Rules**: Enrolled students have real-time read access (`allow read: if isTeacherInClass(classId) || isStudentInClass(classId);`), while writes are restricted exclusively to the authorized teacher (`allow write: if isTeacherInClass(classId);`).
    *   **`classes/{classId}/irregularities`**: Class-scoped incident logs for class-specific report generation and teacher dashboards.
        *   **Document ID**: Auto-generated.
        *   **Fields**: Mirror the root `irregularities` schema (`classId`, `studentUid`, `studentEmail`, `category`, `severity`, `confidence`, `transcript`, `evidence`, `rationale`, `source`, `timestamp`).
        *   **Security & Integrity**: Protected by Firestore Security Rules. Only authenticated enrolled students can create records matching their `request.auth.uid`. **Students have ZERO update and ZERO delete permissions** (`allow update: if isTeacherInClass(classId); allow delete: if isTeacherInClass(classId);`), preventing any student tampering or deletion of flagged incidents.
    *   **`classes/{classId}/bingoRecords`**: Stores live and historical presence verification challenge records ("Bingo") dispatched to verify physical student presence and attention.
        *   **Document ID**: `bingoId` (string, generated UUID or timestamp key).
        *   **Fields**:
            *   `bingoId`: (string) Unique challenge identifier.
            *   `classId`: (string) Class ID where the challenge was issued.
            *   `targetStudentUid`: (string) Target student UID, or `'all'` for class-wide broadcast challenges.
            *   `questionSource`: (string) Challenge generation method (`'question_bank'` for predefined class bank [$0.00 / 0 AI tokens], `'teacher_screen'` for Gemini analysis of teacher's broadcast screen [1 call per cohort], or `'student_screen'` for targeted individual screenshot evaluation).
            *   `triggerType`: (string) Trigger invocation context (`'manual'`, `'scheduled'`, `'retry'`).
            *   `question`: (string) Prompt text of the multiple-choice presence challenge.
            *   `options`: (array of 4 strings) 4 multiple-choice options.
            *   `correctIndex`: (number) 0-indexed integer (0–3) indicating the correct option. Evaluated strictly server-side; NEVER sent down to the student client `activeBingo` payload.
            *   `timeLimitSeconds`: (number) Permitted interaction window in seconds (default `45`s).
            *   `expiresAtMillis`: (number) Epoch timestamp in milliseconds after which the challenge is flagged as timed out.
            *   `status`: (string) Current state (`'pending'`, `'passed'`, `'failed_incorrect'`, `'missed_timeout'`).
            *   `strikeNumber`: (number) `1` for initial check; `2` for scheduled follow-up check after an initial timeout.
            *   `retryScheduledAt`: (timestamp | null) Server timestamp when a Strike 2 follow-up was scheduled after a Strike 1 timeout.
            *   `selectedIndex`: (number | null) Student's selected option index (0–3), or `null` if timed out.
            *   `responseTimeSec`: (number | null) Elapsed seconds between challenge dispatch and student submission.
            *   `windowFocused`: (boolean) Whether the browser window was active/focused during interaction.
            *   `result`: (object) Structured scoring and explanation payload (`{ score, isCorrect, explanation, feedback }`).
            *   `createdAt`: (timestamp) Server timestamp when the challenge was created.
            *   `answeredAt`: (timestamp | null) Server timestamp when student submitted their choice.
        *   **Security & Integrity**: Governed by Firestore Security Rules:
            ```javascript
            match /classes/{classId}/bingoRecords/{bingoId} {
              allow read: if isTeacherInClass(classId) || (isStudentInClass(classId) && (resource.data.studentUid == request.auth.uid || resource.data.studentUid == 'all'));
              allow write: if isTeacherInClass(classId);
            }
            ```
            Enrolled students can only read challenges dispatched to themselves or class-wide broadcasts. Students cannot read peers' records and cannot write/tamper directly with records.
    *   **`classes/{classId}/attendanceAdjustments`**: Stores penalty deduction records applied to a student's attendance when they miss consecutive presence checks.
        *   **Document ID**: Auto-generated (`adjustmentId`).
        *   **Fields**:
            *   `classId`: (string) Parent class identifier.
            *   `studentUid`: (string) UID of the student incurring the deduction.
            *   `startTime`: (timestamp) Timestamp when Strike 1 was issued.
            *   `endTime`: (timestamp) Timestamp when Strike 2 timed out.
            *   `startMillis`: (number) Epoch millisecond when Strike 1 was issued.
            *   `endMillis`: (number) Epoch millisecond when Strike 2 timed out.
            *   `deductedMinutes` / `voidedMinutesCount`: (number) Number of attendance minutes voided between the two checkpoints.
            *   `reason`: (string) Clear human-readable justification (e.g. `'Missed 2 consecutive Bingo checks (AFK/Decoy)'`).
            *   `check1Id` / `strike1BingoId`: (string) ID of the initial timed-out check (Strike 1).
            *   `check2Id` / `strike2BingoId`: (string) ID of the second timed-out check (Strike 2).
            *   `appliedAt` / `createdAt`: (timestamp) Server timestamp when the penalty was registered.
        *   **Security Rules**:
            ```javascript
            match /classes/{classId}/attendanceAdjustments/{adjustmentId} {
              allow read: if isTeacherInClass(classId) || (isStudentInClass(classId) && resource.data.studentUid == request.auth.uid);
              allow write: if isTeacherInClass(classId);
            }
            ```
    *   **`classes/{classId}/studentProperties`**: Stores per-student runtime state and active challenge payloads.
        *   **Document ID**: `studentUid` (string).
        *   **Fields**:
            *   `activeBingo`: (object | null) Active challenge dispatched to student (`{ bingoId, question, options, timeLimitSeconds, expiresAtMillis, strikeNumber }`). Excluded `correctIndex` prevents client inspection exploitation. Cleared or stamped with `{ status: 'passed' | 'failed_incorrect' }` on completion.
            *   `pendingRetryBingo`: (boolean) Flag indicating student missed Strike 1 and is awaiting scheduled Strike 2 retry challenge.
            *   `priorMissedBingoId`: (string | null) The `bingoId` of the missed Strike 1 verification used for linkage and attendance deduction accounting.
            *   `retryBingoScheduledAtMillis`: (number | null) Epoch timestamp in milliseconds indicating when the Strike 2 retry challenge is scheduled to fire.
            *   `retryDelayMinutes`: (number | null) Configured grace period delay applied for this retry schedule.
            *   `lastRetryDispatchedAt`: (timestamp | null) Server timestamp of when Strike 2 challenge was dispatched via Cloud Tasks.

### `irregularities`

Stores top-level information about any irregularities detected across visual and acoustic monitoring streams (e.g. MediaPipe FaceLandmarker, LiteRT Gemma on-device intent evaluation, cloud Gemini analysis).

*   **Document ID**: Auto-generated.
*   **Security**: Students can read their own records and submit incidents (`allow create`), but **strictly CANNOT update or delete** (`allow update: if isTeacher(); allow delete: if isTeacher();`).
*   **Fields**:
    *   `classId`: (string) The ID of the class where the irregularity occurred.
    *   `studentUid`: (string) The UID of the student involved.
    *   `studentEmail` / `email`: (string) The student's email, denormalized for display.
    *   `title`: (string) A title for the irregularity (e.g. `AI Speech Alert: COLLUSION_EXAM`, `Unauthorized Collaboration`, `Looking Away`).
    *   `message` / `rationale`: (string) A description or explanation of the irregularity.
    *   `category`: (string) Standardized AI violation category (`COLLUSION_EXAM`, `COLLUSION_DISCUSS`, `EXTERNAL_ASSISTANCE`, `EXAM_CONTENT_LEAK`, `NON_EXAM_TALK`, `LEGITIMATE_INQUIRY`, `LOOKING_AWAY`, etc.).
    *   `severity`: (string) Severity tier (`none`, `low`, `medium`, `critical`).
    *   `confidence`: (number) AI model confidence score (0.0 to 1.0).
    *   `source`: (string) Detection source (`on_device_gemma`, `on_device_whisper`, `client_face_mesh`, `cloud_gemini`).
    *   `type`: (string) Incident stream type (`image`, `video`, `audio`, `looking_away`, `no_face`, `multiple_faces`).
    *   `imageUrl`: (string) Cloud Storage path or URL of the image associated with the irregularity.
    *   `audioPath`: (string) Cloud Storage path of the audio snippet associated with the incident.
    *   `transcript` / `transcriptSnippet`: (string) Spoken dialogue quote with speaker attribution labels.
    *   `speakerCount`: (number) Number of distinct speakers detected.
    *   `riskLevel`: (string) Risk classification severity (`none`, `low`, `medium`, `high`).
    *   `status`: (string) Incident status (`active`, `resolved`).
    *   `durationSeconds`: (number) Sustained seconds of the irregularity before resolution.
    *   `timestamp`: (timestamp) A timestamp of when the irregularity occurred.

### `mails`

Stores emails that are sent from the system.

*   **Document ID**: Auto-generated.
*   **Fields**:
    *   `to`: (string) The recipient's email address.
    *   `subject`: (string) The subject of the email.
    *   `html`: (string) The HTML content of the email.

### `notifications`

Stores notifications for users.

*   **Document ID**: Auto-generated.
*   **Fields**:
    *   `userId`: (string) The UID of the user the notification is for.
    *   `message`: (string) The notification message.
    *   `read`: (boolean) A boolean indicating if the notification has been read.
    *   `timestamp`: (timestamp) A timestamp of when the notification was created.

### `progress`

Stores student progress reports.

*   **Document ID**: Auto-generated.
*   **Fields**:
    *   `classId`: (string) The ID of the class.
    *   `studentUid`: (string) The UID of the student.
    *   `studentEmail`: (string) The student's email, denormalized for display.
    *   `progress`: (string) A description of the student's progress.
    *   `timestamp`: (timestamp) A timestamp of when the progress was recorded.

### `performanceMetrics`

Stores individual and aggregated task duration records for students, tracking how long students spend completing specific lab milestones and coursework tasks. Fed by the `recordTaskDuration` AI tool during video analysis and used to render the **Performance Analytics** charts.

*   **Document ID**: Auto-generated.
*   **Fields**:
    *   `studentUid`: (string) The UID of the student who completed the task.
    *   `classId`: (string) The ID of the class.
    *   `taskName`: (string) The name of the specific task or lab milestone (e.g., `'AWS Academy Lab 2.1'`, `'Azure Setup & MFA'`, `'Docker Containerization'`).
    *   `duration`: (number) The duration in **seconds** spent on this task.
    *   `status`: (string) The completion status (e.g., `'completed'`).
    *   `source`: (string) The source of the measurement (e.g., `'videoAnalysis'`, `'screenshot'`).
    *   `timestamp`: (timestamp) Timestamp when the metric was recorded.

### `prompts`

Stores the AI prompts.

*   **Document ID**: Auto-generated.
*   **Fields**:
    *   `name`: (string) The name of the prompt.
    *   `category`: (string) The category of the prompt (e.g., `images`, `videos`).
    *   `prompt`: (string) The prompt text.
    *   `applyTo`: (array) An array of strings indicating where the prompt can be applied (e.g., `Per Image`, `All Images`, `Per Video`).
    *   `createdAt`: (timestamp) A timestamp of when the prompt was created.
    *   `accessLevel`: (string) The access level of the prompt (`private`, `shared`, `public`).
    *   `owner`: (string) The UID of the user who created the prompt.
    *   `sharedWith`: (array) An array of UIDs with whom the prompt is shared.

### `propertyUploadJobs`

Stores jobs for processing student-specific properties from a CSV upload.

*   **Document ID**: Auto-generated.
*   **Fields**:
    *   `classId`: (string) The ID of the class the properties belong to.
    *   `requesterUid`: (string) The UID of the user who requested the upload.
    *   `csvData`: (string) The raw CSV content to be processed.
    *   `status`: (string) The status of the job (e.g., `pending`, `processing`, `completed`, `completed_with_errors`, `failed`).
    *   `createdAt`: (timestamp) A timestamp of when the job was created.
    *   `totalRows`: (number) The total number of data rows in the CSV.
    *   `processedCount`: (number) The number of rows successfully processed.
    *   `notFoundCount`: (number) The number of students in the CSV not found in the class.
    *   `error`: (string) An error message if the job failed.

### `screenshots`

Stores metadata for each screenshot.

*   **Document ID**: Auto-generated.
*   **Fields**:
    *   `classId`: (string) The ID of the class the screenshot belongs to.
    *   `studentUid`: (string) The UID of the student who took the screenshot.
    *   `email`: (string) The student's email, denormalized for easier querying.
    *   `channel`: (string) The capture channel: `'screen'` or `'webcam'`.
    *   `imagePath`: (string) The path to the screenshot image in Firebase Storage.
    *   `size`: (number) The size of the screenshot in bytes.
    *   `timestamp`: (timestamp) A timestamp of when the screenshot was taken.
    *   `expireAt`: (timestamp) The exact expiration date calculated from class `retentionDays`, used by Firestore TTL and delete triggers.
    *   `deleted`: (boolean) A boolean indicating if the screenshot has been deleted.

### `studentProfiles`

Stores the class enrollments for each student. This is a core part of the authorization system.

*   **Document ID**: `studentUid` (string)
*   **Fields**:
    *   `classes`: (array) An array of `classId`s that the student is enrolled in.

### `students`

Used for sending messages to students.

*   **Document ID**: `studentUid` (string)
*   **Subcollections**:
    *   **`messages`**: Stores direct messages sent to the student.
        *   **Document ID**: Auto-generated.
        *   **Fields**:
            *   `message`: (string) The message content.
            *   `timestamp`: (timestamp) A timestamp of when the message was sent.

### `teacherProfiles`

Stores the class enrollments for each teacher. This is a core part of the authorization system.

*   **Document ID**: `teacherUid` (string)
*   **Fields**:
    *   `classes`: (array) An array of `classId`s that the teacher is enrolled in.

### `teachers`

Used for sending messages to teachers.

*   **Document ID**: `teacherUid` (string)
*   **Subcollections**:
    *   **`messages`**: Stores direct messages sent to the teacher.
        *   **Document ID**: Auto-generated.
        *   **Fields**:
            *   `message`: (string) The message content.
            *   `timestamp`: (timestamp) A timestamp of when the message was sent.

### `users`

Stores a directory of users for discovery and lookup purposes (e.g., finding a user's UID by their email address when sharing prompts). It is not the primary source for authorization.

*   **Document ID**: `uid` (string) - The Firebase Auth User ID.
*   **Fields**:
    *   `email`: (string) The user's email address.
    *   `name`: (string) The user's display name.
    *   `role`: (string) The user's role (e.g., `student`, `teacher`).

### `videoAnalysisJobs`

Stores information about video analysis jobs.

*   **Document ID**: `jobId` (string)
*   **Fields**:
    *   `classId`: (string) The ID of the class.
    *   `requester`: (string) The UID of the user who requested the analysis.
    *   `videos`: (array) An array of objects, each containing details about a video to be analyzed. This is for jobs on selected videos.
        *   `studentUid`: (string) The UID of the student.
        *   `studentEmail`: (string) The student's email.
        *   `videoPath`: (string) The path to the video in Cloud Storage.
    *   `prompt`: (string) The AI prompt to be used for the analysis.
    *   `status`: (string) The status of the job (e.g., `pending`, `processing`, `completed`, `failed`).
    *   `createdAt`: (timestamp) When the job was created.
    *   `startTime`: (timestamp) The start time for the range of videos to be analyzed (for "all videos" jobs).
    *   `endTime`: (timestamp) The end time for the range of videos to be analyzed (for "all videos" jobs).
    *   `filterField`: (string) The field to filter by (`startTime` or `createdAt`).
    *   `aiJobIds`: (array) An array of `aiJob` IDs associated with this analysis.
    *   `completedAt`: (timestamp) When the job was completed.
    *   `error`: (string) An error message if the job failed.
    *   `deleted`: (boolean) A flag to mark the job as deleted.

### `videoJobs`

Stores information about video processing jobs.

*   **Document ID**: `jobId` (string)
*   **Fields**:
    *   `classId`: (string) The ID of the class the video belongs to.
    *   `studentUid`: (string) The UID of the student.
    *   `studentEmail`: (string) The student's email, denormalized for easier querying.
    *   `startTime`: (timestamp) The start time of the video.
    *   `endTime`: (timestamp) The end time of the video.
    *   `status`: (string) The status of the job (e.g., `pending`, `processing`, `completed`, `failed`).
    *   `startedAt`: (timestamp) A timestamp of when the job started.
    *   `finishedAt`: (timestamp) A timestamp of when the job finished.
    *   `videoPath`: (string) The path to the processed video in Firebase Storage.
    *   `duration`: (number) The duration of the video in seconds.
    *   `size`: (number) The size of the video in bytes.
    *   `expireAt`: (timestamp) The exact expiration date calculated from class `videoRetentionDays`, used by Firestore TTL and delete triggers.
    *   `error`: (string) An error message if the job failed.
    *   `errorStack`: (string) The stack trace of the error.
    *   `ffmpegError`: (string) The error from ffmpeg if it failed.
    *   `isExam`: (boolean) Whether the video job was recorded during an exam slot or active exam session, determining student access restrictions under exam policies.

### `zipJobs`

Stores information about zip file creation jobs.

*   **Document ID**: `jobId` (string)
*   **Fields**:
    *   `classId`: (string) The ID of the class the zip file belongs to.
    *   `requester`: (string) The UID of the user who requested the zip job.
    *   `videos`: (array) An array of objects, each containing details about a video to be included in the zip.
        *   `path`: (string) The path to the video in Cloud Storage.
        *   `classId`: (string) The ID of the class.
        *   `studentUid`: (string) The UID of the student.
        *   `studentEmail`: (string) The student's email.
        *   `startTime`: (timestamp) The start time of the video.
    *   `status`: (string) The status of the job (e.g., `pending`, `processing`, `completed`, `failed`).
    *   `createdAt`: (timestamp) When the job was created.
    *   `startTime`: (timestamp) The start time for the range of videos to be zipped.
    *   `endTime`: (timestamp) The end time for the range of videos to be zipped.
    *   `zipPath`: (string) The path to the zip file in Firebase Storage.
    *   `expireAt`: (timestamp) The expiration timestamp (7 days post-creation) used by Firestore TTL and `onZipJobDocDeleted`.
    *   `error`: (string) An error message if the job failed.

## Relationships

*   **`classes` <-> `studentProfiles` / `teacherProfiles`**: Many-to-many. A class has many users, and a user can be in many classes. This relationship is the core of the authorization system, managed by a cloud function that syncs the `students` and `teachers` maps in the `classes` collection with the `classes` array in the respective user profile collections.
*   **`classes` -> `students` / `teachers`**: One-to-many. A class has lists of student and teacher UIDs, which are used as keys in the `students` and `teachers` collections for direct messaging.
*   **`screenshots` -> `classes` & `studentProfiles`**: Many-to-one. A screenshot belongs to one class and one student, linked via `studentUid`.
*   **`videoJobs` -> `classes` & `studentProfiles`**: Many-to-one. A video job belongs to one class and one student, linked via `studentUid`.
*   **`videoAnalysisJobs` -> `videoJobs`**: One-to-one. A video analysis job is created from a video job.
*   **`aiJobs` -> `videoAnalysisJobs`**: Many-to-one. Many AI jobs can be part of one video analysis job.
*   **`irregularities` / `progress` -> `classes` & `studentProfiles`**: Many-to-one. These records belong to a class and a student, linked via `studentUid`.
*   **`aiJobs` -> `prompts`**: Many-to-one. An AI job uses one prompt.
*   **`notifications` -> `users` (Firebase Auth)**: Many-to-one. A notification is for a specific user, linked via `userId` (which should be a UID).
*   **`mails`**: Standalone collection for triggering emails.
*   **`users`**: A directory for user discovery. It is not directly linked in the authorization flow but is used to look up user UIDs by email for features like sharing.
*   **`propertyUploadJobs` -> `classes`**: Many-to-one. A property upload job belongs to one class.

---

## ⚡ Indexes & Query Optimization

All multi-field queries in the application rely on Firestore composite indexes defined in [`firestore.indexes.json`](../firestore.indexes.json). Deploying these indexes guarantees sub-second query performance and eliminates missing index errors during live exams.

### 1. Composite Index Matrix

| Collection / Scope | Indexed Fields | Query Pattern & Application Feature |
| :--- | :--- | :--- |
| **`screenshots`** (Group) | `classId ASC, timestamp DESC` | **PlaybackView / Session Review**: Fetches latest screenshots in descending chronological order for timeline scrubbing and smart session initialization. |
| **`screenshots`** (Group) | `classId ASC, timestamp ASC` | **Media Processing Cloud Functions**: Chronologically iterates screenshots for automated MP4 compilation (`processVideoJob`). |
| **`screenshots`** (Group) | `classId ASC, studentUid ASC, timestamp ASC` | **Per-Student Timeline**: Extracts an individual student's contiguous frame sequence for single-student video generation or export. |
| **`videoJobs`** (Group) | `classId ASC, status ASC, createdAt DESC` | **Smart Lesson Resolution & Video Library**: Detects completed student videos to automatically activate the correct lesson time slot (`useClassSchedule`). |
| **`videoJobs`** (Group) | `classId ASC, createdAt DESC` | **Teacher Video Dashboard**: Lists recent video jobs across all students in a class. |
| **`videoJobs`** (Group) | `studentUid ASC, createdAt DESC` | **Student History**: Displays all processed video assets for a single student. |
| **`aiJobs`** (Group) | `classId ASC, createdAt DESC` | **AI Cost Report**: Aggregates token usage, financial spend, and Gemini model breakdown across a class session. |
| **`aiJobs`** (Group) | `studentUid ASC, createdAt DESC` | **Student AI Consumption Matrix**: Per-student audit table displaying job counts and token consumption. |
| **`audio`** (Group) | `classId ASC, studentUid ASC, windowStartSec ASC` | **Audio Transcript Modal**: Chronological retrieval of 30-second audio snippets for dialogue playback and multi-speaker diarization seek. |
| **`irregularities`** (Group)| `classId ASC, timestamp DESC` | **IrregularitiesView & Incident Dossiers**: Real-time violation alert stream and audit report export. |

### 2. Time-To-Live (TTL) Automatic Deletion Policies

Collections with high throughput media metadata include the `expireAt` timestamp field, governed by Cloud Firestore TTL policies and Cloud Storage cleanup triggers:

- **`screenshots`**: `expireAt = timestamp + (classes.retentionDays * 86400s)`. Raw screenshots are deleted automatically once retention expires.
- **`videoJobs`**: `expireAt = finishedAt + (classes.videoRetentionDays * 86400s)`. Compiled MP4 videos are purged when class video retention limits expire.
- **`zipJobs`**: `expireAt = createdAt + 7 days`. Ephemeral ZIP download archives are automatically removed from Cloud Storage after 7 days.

---

### 3. Student Self-Service Records & Security Isolation

To support student transparency and review of academic and invigilation history without compromising peer privacy, specific Firestore and Cloud Storage security rules grant read access to records belonging to the authenticated student:

| Collection / Resource | Permission | Rule & Ownership Predicate |
| :--- | :--- | :--- |
| **`classes/{classId}/lessons`** | `read` | `isTeacherInClass(classId) || isStudentInClass(classId)` — Enrolled students can read lesson logs; in-memory filtering isolates the calling student's attendance entry (`students[user.uid]`), including deducted minutes. |
| **`classes/{classId}/bingoRecords`** | `read` | `isTeacherInClass(classId) || (isStudentInClass(classId) && (resource.data.studentUid == request.auth.uid || resource.data.studentUid == 'all'))` — Students can read challenges addressed to them or class broadcasts; peers' records are isolated. Writes strictly restricted to teachers. |
| **`classes/{classId}/attendanceAdjustments`** | `read` | `isTeacherInClass(classId) || (isStudentInClass(classId) && resource.data.studentUid == request.auth.uid)` — Students can view their own transparent attendance adjustment and strike history. |
| **`videoJobs`** | `read` | `isTeacher() || (request.auth != null && request.auth.uid == resource.data.studentUid)` — Students can only query and read their own compiled video jobs. |
| **`aiJobs`** | `read` | `isTeacher() || (request.auth != null && request.auth.uid == resource.data.studentUid)` — Students can only query and read AI analysis feedback jobs assigned to their UID. |
| **`performanceMetrics`** | `read` | `isTeacher() || (request.auth != null && request.auth.uid == resource.data.studentUid)` — Students can only view their own lab task completion times and milestones. |
| **`progress`** | `read` | `isTeacher() || (request.auth != null && request.auth.uid == resource.data.studentUid)` — Students can only view progress milestones stamped with their UID. |
| **`irregularities`** | `read` | `isTeacher() || (request.auth != null && request.auth.uid == resource.data.studentUid)` — Students can view invigilation incident notices and evidence regarding themselves. |
| **`audio`** | `read` | `isTeacher() || (request.auth != null && request.auth.uid == resource.data.studentUid)` — Students can view their recorded speech segments and transcripts. |
| **`classes/{classId}/audio_audits`** | `read` | `isTeacherInClass(classId) || (isStudentInClass(classId) && request.auth.uid == studentUid)` — Students can view their own forensic audio audit reports; peer audits are isolated. Writes restricted to teachers. |
| **`classes/{classId}/questionBank`** | `read/write` | `isTeacherInClass(classId)` — Predefined question bank containing questions and correct indices is strictly teacher-only; students have zero access. |
| **`users`** | `read` | `isTeacher() || (request.auth != null && request.auth.uid == userId)` — Teachers can search user directory for prompt collaboration; students can only view their own user document. Client writes are forbidden. |
| **Cloud Storage `videos/{classId}/{videoId}`** | `read` | `isTeacher() || resource.metadata.studentUid == request.auth.uid` — Students can directly stream and download their own compiled video MP4s via token or signed v4 URL (`getStudentVideoPlaybackUrl`). |

---

[← Back to Documentation Index](../README.md#documentation-index)