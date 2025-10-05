# UID Refactoring Plan

This document outlines the plan to refactor the application to use Firebase User IDs (`uid`) as the primary identifier for users instead of emails.

## Phase 1: Schema and Core Backend Logic (Completed)

-   [x] **Step 1: Update Firestore Schema Documentation (`docs/firestore-schema.md`)**
    -   Added `studentUids` and `teacherUids` to the `classes` collection.
    -   Updated foreign keys in other collections to use `studentUid`.
    -   Updated collection keys for `students` and `teachers` to be `uid`.
    -   Updated Mermaid diagram and relationship descriptions.

-   [x] **Step 2: Implement Core Cloud Function Logic (`functions/auth_triggers/userManagement.js`)**
    -   Modified `onClassUpdate` to handle `studentUids` and `teacherUids`.
    -   Added `onUserCreate` trigger to link new users to existing class invitations.

-   [x] **Step 3: Update IP Restriction Logic (`functions/auth_triggers/ipRestriction.js`)**
    -   Modified `checkipaddress` to query for classes using both `uid` and `email` to support pre-invited users.

## Phase 2: Remaining Backend Refactoring (Completed)

-   [x] **Step 4: Refactor AI-related Functions (`functions/ai_flows/`)**
    -   [x] `aiTools.js`: Updated all tools to use `studentUid`.
    -   [x] `analysisFlows.js`: Updated all flows to handle `studentUid`.
    -   [x] `jobLogger.js`: No changes needed, but verified.
    -   [x] `processVideoAnalysisJob.js`: Updated to use `studentUid`.

-   [x] **Step 5: Refactor Media Processing Functions (`functions/media_processing/`)**
    -   [x] `processVideoJob.js`: Updated to use `studentUid` and fetch email for video overlay.
    -   [x] `processZipJob.js`: Updated to use `studentUid` and fetch requester email for notification.

-   [x] **Step 6: Refactor Scheduled Tasks (`functions/scheduled_tasks/`)**
    -   [x] `scheduledTasks.js`: Updated `handleAutomaticVideoCombination` to use `studentUids` and `teacherUids`.

## Phase 3: Frontend Refactoring (Completed)

-   [x] **Step 7: Update Teacher and Student Home Views (`TeacherView.jsx`, `StudentView.jsx`)**
    -   [x] `TeacherView.jsx`: Updated class query to use `teacherUids`. Updated student count to use `studentUids`.
    *   [x] `StudentView.jsx`: Updated direct message listener and irregularities query to use `user.uid`.

-   [x] **Step 8: Refactor Class Management (`ClassManagement.jsx`)**
    -   [x] Updated class query to use `teacherUids`.

-   [x] **Step 9: Refactor Playback and Monitoring Views (`PlaybackView.jsx`, `MonitorView.jsx`)**
    -   [x] `PlaybackView.jsx`:
        -   [x] Update student list fetching to be UID-based.
        -   [x] Update student dropdown to use UID as value.
        -   [x] Update `handleStartPlayback` to use `studentUid`.
        -   [x] Update screenshot query to use `studentUid`.
        -   [x] Update `handleCombineToVideo` to use `studentUid`.
        -   [x] Update `handleCombineAllToVideo` to use `studentUid`.
        -   [x] Update `handleDownloadSelected` to use `studentUid` (in `VideoLibrary.jsx`).
        -   [x] Update `handleDownloadAll` to use `studentUid` (in `VideoLibrary.jsx`).
        -   [x] Update `handleRequestAnalysis` to use `studentUid` (in `VideoLibrary.jsx`).
        -   [x] Update `handleDownload` to use `studentEmail` from the video object (in `VideoLibrary.jsx`).
    -   [x] `MonitorView.jsx`:
        -   [x] Solidify UID-based logic.
        -   [x] Update `handleSendMessage` to use `uid`.
        -   [x] Update analysis functions to pass `uid`.

-   [x] **Step 10: Refactor Smaller Dependent Components**
    -   [x] `IndividualStudentView.jsx`: Update `handleSendMessage` to use `uid`.
    -   [x] `ProgressView.jsx`: Update filter to use `studentUid`.
    -   [x] `ClassView.jsx`: Update teacher message listener to use `uid`.

## Phase 4: Verification (Completed)

-   [x] **Step 11: Final Review and Testing**
    -   [x] Perform a final review of all modified files.
    -   [x] Run project's tests, build, and linting scripts.
