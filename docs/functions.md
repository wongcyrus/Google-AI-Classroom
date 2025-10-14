# Cloud Functions

This document provides an overview of all the backend Cloud Functions used in the AI Invigilator application. The functions are organized by their functional area.

## AI Flows

This directory contains all the Cloud Functions related to AI-powered analysis, including image and video analysis, quota management, and performance metrics aggregation.

### Functions

#### Callable Functions

-   **`analyzeImage`**: A callable function restricted to users with a 'teacher' role. It triggers the `analyzeImageFlow` Genkit flow to perform AI analysis on a single image.
-   **`analyzeAllImages`**: A callable function for teachers that triggers the `analyzeAllImagesFlow` Genkit flow, which analyzes all images associated with a specific student within a given context.

#### Firestore Triggers

-   **`processVideoAnalysisJob`**:
    -   **Trigger**: `onDocumentCreated` in `videoAnalysisJobs/{jobId}`.
    -   **Description**: This function orchestrates the AI analysis of multiple videos. When a new job is created in the `videoAnalysisJobs` collection, this function collects the target videos (either from a provided list or by querying a time range) and creates individual AI analysis jobs for each one using the `analyzeSingleVideoFlow`. It updates the master job document with the status (`processing`, `completed`, `failed`) and the IDs of the individual AI jobs.

-   **`triggerAutomaticAnalysis`**:
    -   **Trigger**: `onDocumentUpdated` in `videoJobs/{jobId}`.
    -   **Description**: This function enables automated, session-wide video analysis. When a video processing job (`videoJob`) is updated to a terminal state (`completed` or `failed`), it checks if all videos for that class session have been processed. If the class is configured for automatic analysis and all videos are ready, it creates a new `videoAnalysisJobs` document to analyze all videos from that session using a predefined prompt. This ensures that a comprehensive analysis is performed as soon as all the necessary data is available.

-   **`onAiJobCreated`**:
    -   **Trigger**: `onDocumentCreated` in `aiJobs/{jobId}`.
    -   **Description**: This function is responsible for real-time quota management. When a new AI analysis job (`aiJob`) is created, it reads the associated `cost` and updates the total usage for the corresponding class. This helps in monitoring and enforcing budget limits.

-   **`aggregatePerformanceMetrics`**:
    -   **Trigger**: `onDocumentCreated` in `screenshotAnalyses/{analysisId}`.
    -   **Description**: This function calculates and aggregates student performance metrics. When a new screenshot analysis is saved, it tracks the time a student spends on a particular task. If the task changes, it finalizes the metric for the previous task (calculating the duration) and starts a new one. This provides insights into how students are allocating their time during a session.

### Data Models

-   **`videoAnalysisJobs`**: Stores requests for bulk video analysis. Documents include the requester's UID, the AI prompt, and either a list of videos or a time range.
-   **`aiJobs`**: Represents a single AI analysis task. Contains details about the job, including the cost.
-   **`screenshotAnalyses`**: Contains the results of an individual screenshot analysis.
-   **`performanceMetrics`**: Stores aggregated data on student task durations.

---

## Auth Triggers

This directory contains Cloud Functions that are triggered by authentication events or that manage user-related data in response to database changes.

### Functions

#### Identity Triggers

-   **`checkipaddress`**:
    -   **Trigger**: `beforeUserSignedIn`.
    -   **Description**: This security function enforces IP-based access control for students. Before a user is signed in, it checks if they are a student attempting to log in during a scheduled class time. If so, it verifies that their IP address is on the allowed list for that class. If the IP is not authorized, the login is blocked. This function does not apply to users with a 'teacher' role.

-   **`beforeusercreated`**:
    -   **Trigger**: `beforeUserCreated`.
    -   **Description**: This function automatically assigns a `role` (`student` or `teacher`) to a new user based on their email domain (`@stu.vtc.edu.hk` for students, `@vtc.edu.hk` for teachers). It also checks for any classes where the user's email was pre-enrolled and automatically links them by updating the relevant class and user profile documents.

#### Firestore Triggers

-   **`onClassUpdate`**:
    -   **Trigger**: `onDocumentWritten` in `classes/{classId}`.
    -   **Description**: This function manages the relationship between users and classes. When a class document is updated (e.g., students or teachers are added or removed from the `studentEmails` or `teacherEmails` arrays), it performs the following actions:
        -   **User Creation**: If a user for an added email does not exist, it creates a new Firebase Auth user and assigns the appropriate role.
        -   **Association**: It links/unlinks the class to/from the user's profile (`studentProfiles` or `teacherProfiles`).
        -   **Denormalization**: It adds/removes the user's UID and email from the `students` or `teachers` map within the class document for efficient lookups.

### Data Models

-   **`classes`**: Stores class information, including schedules, IP restrictions, and lists of student/teacher emails and UIDs.
-   **`studentProfiles`**: A collection where each document represents a student, storing a list of classes they are enrolled in.
-   **`teacherProfiles`**: A collection where each document represents a teacher, storing a list of classes they are assigned to.

---

## Media Processing

This directory contains Cloud Functions responsible for handling media-related tasks, such as video creation, ZIP archiving, and job cleanup.

### Functions

#### Firestore Triggers

-   **`processVideoJob`**:
    -   **Trigger**: `onDocumentCreated` in `videoJobs/{jobId}`.
    -   **Description**: This function orchestrates the creation of a video from a series of screenshots. When a new job is created in the `videoJobs` collection, it fetches the corresponding screenshots, adds a timestamp and other metadata to each frame, and then uses `ffmpeg` to compile them into an MP4 video. The resulting video is uploaded to Cloud Storage, and the job document is updated with the video path and status.

-   **`processZipJob`**:
    -   **Trigger**: `onDocumentCreated` in `zipJobs/{jobId}`.
    -   **Description**: This function handles requests for bulk video downloads. When a new job is created in the `zipJobs` collection, it downloads the specified videos from Cloud Storage, archives them into a single ZIP file, and generates a `summary.csv` file with metadata. The final ZIP file is uploaded to a `zips/` directory in Cloud Storage, and an email is sent to the requester with a link to download the archive.

#### Scheduled Functions

-   **`cleanupStuckJobs`**:
    -   **Trigger**: Scheduled to run every hour.
    -   **Description**: This maintenance function identifies and handles video processing jobs that have been stuck in the 'processing' state for an extended period (currently 2 hours). It marks these jobs as 'failed' and adds an error message, preventing them from being stuck indefinitely and helping to identify potential issues in the video processing pipeline.

### Data Models

-   **`videoJobs`**: Stores requests to create a video from screenshots. Documents include the class ID, student UID, and the time range for the screenshots.
-   **`zipJobs`**: Stores requests to archive multiple videos into a single ZIP file. Documents include the requester's UID and an array of video objects to be included in the archive.
-   **`mails`**: A collection used to queue outgoing emails. The `processZipJob` function creates a document here to send a download link to the user.

---

## Property Processing

This directory contains the Cloud Function responsible for handling bulk updates of student properties via CSV uploads.

### Functions

#### Firestore Triggers

-   **`processPropertyUpload`**:
    -   **Trigger**: `onDocumentCreated` in `propertyUploadJobs/{jobId}`.
    -   **Description**: This function provides a powerful way to manage student-specific configurations in bulk. When a CSV file is uploaded and a corresponding job is created in the `propertyUploadJobs` collection, this function is triggered.
    -   It parses the CSV, which must contain a `StudentEmail` column. It then resolves these emails to Firebase Auth UIDs. For each student found, it takes the remaining columns in that student's row and updates their corresponding document in the `classes/{classId}/studentProperties/{studentUid}` subcollection.
    -   This allows administrators to set or override properties (like custom prompts, feature flags, etc.) for many students at once. The function performs these updates in batches to work within Firestore limits and reports the final status (`completed`, `completed_with_errors`, or `failed`) back to the job document.

### Data Models

-   **`propertyUploadJobs`**: Stores requests for bulk property updates. Each document contains the `classId` and the raw `csvData` to be processed.
-   **`classes/{classId}/studentProperties/{studentUid}`**: A subcollection where each document stores key-value property pairs for a specific student within a class. This is the data that the `processPropertyUpload` function modifies.

---

## Scheduled Tasks

This directory contains Cloud Functions that are triggered on a schedule to perform routine, automated tasks for the application.

### Functions

#### Scheduled Functions

-   **`handleAutomaticCapture`**:
    -   **Trigger**: Scheduled to run at 5, 25, 35, and 55 minutes past every hour.
    -   **Description**: This function manages the automatic start and stop of the screen capture feature for classes. It queries for all classes that have the `automaticCapture` flag set to `true`. By checking the class schedules against the current time, it determines if a class session is about to begin or has just ended, and updates the `isCapturing` boolean field on the class document accordingly. This allows the frontend to automatically start or stop capturing without manual intervention from the teacher.

-   **`handleAutomaticVideoCombination`**:
    -   **Trigger**: Scheduled to run at 15 and 45 minutes past every hour.
    -   **Description**: This function automates the process of creating video compilation jobs after a class session ends. It queries for classes with the `automaticCombine` flag enabled and checks if any of their scheduled time slots have recently concluded. If so, it creates a new `videoJobs` document for each student enrolled in that class session. This, in turn, triggers the `processVideoJob` function to begin compiling the screenshots into a video. It also creates a notification for the teachers of the class to inform them that the process has started.

### Data Models

-   **`classes`**: This function reads class documents to check the `automaticCapture`, `automaticCombine`, and `schedule` properties. It also updates the `isCapturing` flag.
-   **`videoJobs`**: This function creates new documents in this collection to trigger the video processing workflow.
-   **`notifications`**: This function creates documents in this collection to inform teachers that the automatic video combination process has begun.

---

## Storage Triggers

This directory contains Cloud Functions that are triggered by events in Cloud Storage, as well as callable functions for managing stored files.

### Functions

#### Storage Triggers

-   **`updateStorageUsageOnUpload`**:
    -   **Trigger**: `onObjectFinalized` (file upload).
    -   **Description**: This function is crucial for enforcing storage quotas. When a new file is uploaded to a tracked folder (`screenshots/`, `videos/`, or `zips/`), it increments the storage usage for the corresponding class. It then checks if the class's total usage exceeds its allocated `storageQuota`. If the quota is exceeded, the newly uploaded file is automatically deleted to prevent further usage, and the usage counter is reverted. This ensures that classes stay within their storage limits.

-   **`updateStorageUsageOnDelete`**:
    -   **Trigger**: `onObjectDeleted` (file deletion).
    -   **Description**: This function keeps the storage usage metrics accurate. When a file is deleted from a tracked folder, it decrements the total storage usage for the corresponding class, ensuring the reported usage reflects the actual state of the storage bucket.

#### Callable Functions

-   **`deleteScreenshotsByDateRange`**:
    -   **Trigger**: `onCall` (callable function).
    -   **Description**: This function provides a mechanism for authenticated users (typically teachers or admins) to delete screenshots in bulk. It requires a `classId`, `startDate`, and `endDate`. The function queries all screenshot documents within that range, deletes the corresponding image files from Cloud Storage, and then marks the Firestore documents as `deleted`. This is useful for data management and for freeing up storage space.

### Data Models

-   **`classes/{classId}/metadata/storage`**: A document that stores the aggregated storage usage for a class, broken down by file type (screenshots, videos, zips). This is the primary document read from and written to by the storage trigger functions.
-   **`screenshots`**: This collection is read by the `deleteScreenshotsByDateRange` function to find files to delete. The function also updates documents in this collection to mark them as deleted.
