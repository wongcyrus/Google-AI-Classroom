# Video Analysis Workflow

This document provides a detailed explanation of the video analysis workflow, which is powered by Google's Vertex AI. Given that this is the most resource-intensive and expensive feature in the application, several safeguards have been implemented to ensure it runs efficiently and to prevent unnecessary costs from duplicate or runaway jobs.

## Workflow Overview

The process begins when a teacher requests an AI analysis on one or more videos. This request creates a master job that orchestrates individual analysis tasks for each video. The system is designed to be robust, handling everything from quota limits to retries and duplicate requests.

### Data Flow Diagram

This diagram illustrates the entire lifecycle of a video analysis job, from the initial user request to the final result.

```mermaid
sequenceDiagram
    participant User
    participant Frontend (VideoAnalysisJobs.jsx)
    participant Firestore
    participant ProcessVideoAnalysisJob (on-create)
    participant RetryVideoAnalysisJob (callable)
    participant AnalyzeSingleVideoFlow (genkit)
    participant VertexAI

    User->>Frontend: Clicks "Analyze Videos"
    Frontend->>Firestore: Creates `videoAnalysisJobs/job1`
    Firestore-->>ProcessVideoAnalysisJob: Triggers on create
    ProcessVideoAnalysisJob->>ProcessVideoAnalysisJob: De-duplicates & limits videos
    ProcessVideoAnalysisJob->>ProcessVideoAnalysisJob: Checks batch quota
    ProcessVideoAnalysisJob->>AnalyzeSingleVideoFlow: Invokes for each video (in parallel batches)
    AnalyzeSingleVideoFlow->>Firestore: Checks for existing COMPLETED job (Idempotency)
    alt Existing completed job found
        AnalyzeSingleVideoFlow-->>ProcessVideoAnalysisJob: Returns existing aiJobId
    else No existing job
        AnalyzeSingleVideoFlow->>VertexAI: generate()
        VertexAI-->>AnalyzeSingleVideoFlow: Analysis result
        AnalyzeSingleVideoFlow->>Firestore: Creates `aiJobs/aiJob1` with result
        AnalyzeSingleVideoFlow-->>ProcessVideoAnalysisJob: Returns new aiJobId
    end
    ProcessVideoAnalysisJob->>Firestore: Updates `videoAnalysisJobs/job1` with status & aiJobIds

    Note over User, Firestore: Later, job has failed videos

    User->>Frontend: Clicks "Retry Failed Jobs" on job1
    Frontend->>RetryVideoAnalysisJob: Calls function with {jobId: "job1"}
    RetryVideoAnalysisJob->>Firestore: Reads `videoAnalysisJobs/job1`
    RetryVideoAnalysisJob->>RetryVideoAnalysisJob: Gets `failedVideos` list
    RetryVideoAnalysisJob->>Firestore: Updates `videoAnalysisJobs/job1` (status='processing', adds retryHistory)
    RetryVideoAnalysisJob->>AnalyzeSingleVideoFlow: Invokes for each FAILED video
    Note over AnalyzeSingleVideoFlow, VertexAI: Idempotency check and analysis runs as before
    RetryVideoAnalysisJob->>Firestore: Updates `videoAnalysisJobs/job1` with final status
```

---

## 1. Initial Job Creation (`processVideoAnalysisJob`)

When a teacher requests a new analysis, a document is created in the `videoAnalysisJobs` collection. This triggers the `processVideoAnalysisJob` Cloud Function, which orchestrates the entire process with 4 layers of safety guardrails:

```mermaid
flowchart TD
    Req[Teacher Requests Video Analysis] --> Doc[Firestore: videoAnalysisJobs/jobId Created]
    Doc --> Trig[processVideoAnalysisJob Cloud Function]

    subgraph S1 [Safeguard 1: De-duplication]
        Trig --> Dedupe[Extract unique videoPath Map]
    end

    subgraph S2 [Safeguard 2: Job Size Limiting]
        Dedupe --> CapCheck{Unique Videos > 100?}
        CapCheck -->|Yes| Trunc[Slice to First 100 Videos + Stamp Job Notes]
        CapCheck -->|No| BatchGroup[Group into Batches of 5]
        Trunc --> BatchGroup
    end

    subgraph S3 [Safeguard 3: Batch Quota Pre-Flight]
        BatchGroup --> EstCost[Compute Estimated Gemini Cost for Batch]
        EstCost --> QuotaCheck{Class Remaining AI Quota >= Cost?}
        QuotaCheck -->|No| SkipBatch[Mark Batch as blocked-by-quota & Continue]
        QuotaCheck -->|Yes| S4Flow[Dispatch to AnalyzeSingleVideoFlow]
    end

    subgraph S4 [Safeguard 4: SHA-256 Idempotency Check]
        S4Flow --> HashCalc[Generate SHA-256 of Prompt & Target GCS Video]
        HashCalc --> DBQuery{Existing aiJobs with same Hash & Status==completed?}
        DBQuery -->|Found Result| Reuse[Reuse Existing aiJobId - Zero Extra Cost]
        DBQuery -->|Not Found| CallAI[Invoke Gemini Multimodal Vision API]
        CallAI --> WriteResult[Create aiJobs Record & Deduct AI Quota]
    end

    Reuse --> UpdateMaster[Update videoAnalysisJobs Status & aiJobIds]
    WriteResult --> UpdateMaster
```

### Safeguard 1: De-duplication

When an analysis is requested for a time range, the function first queries all `videoJobs` within that range. To prevent analyzing the same video multiple times if there are duplicate records, it de-duplicates the list based on the unique `videoPath`.

**Code Justification (`processVideoAnalysisJob.js`):**
```javascript
      // De-duplicate videos by path to prevent redundant analysis
      const videoMap = new Map();
      querySnapshot.forEach(doc => {
        const video = doc.data();
        if (video.videoPath && !videoMap.has(video.videoPath)) {
          videoMap.set(video.videoPath, { studentUid: video.studentUid, studentEmail: video.studentEmail, videoPath: video.videoPath });
        }
      });
      videosToAnalyze = Array.from(videoMap.values());
```

### Safeguard 2: Job Size Limiting

To prevent a single job from running for too long and timing out (the function limit is 1 hour), we enforce a hard limit on the number of videos that can be processed in one job. If the number of unique videos exceeds this limit, the job is truncated, and a note is added to the job document.

**Code Justification (`processVideoAnalysisJob.js`):**
```javascript
    const MAX_VIDEOS_PER_JOB = 100;
    let jobNotes = jobData.notes || null;

    if (videosToAnalyze.length > MAX_VIDEOS_PER_JOB) {
        videosToAnalyze = videosToAnalyze.slice(0, MAX_VIDEOS_PER_JOB);
        jobNotes = `Job truncated to the first ${MAX_VIDEOS_PER_JOB} unique videos found. Create a new job with a more specific time range to process remaining videos.`;
    }
```

### Safeguard 3: Batch Quota Checking

Instead of checking the AI quota for every single video (which is inefficient), the function groups the videos into batches. It then estimates the total cost for the entire batch and performs a single quota check. If the quota is insufficient, the entire batch is skipped, and each video is logged as `blocked-by-quota`.

**Code Justification (`processVideoAnalysisJob.js`):**
```javascript
      let batchEstimatedCost = 0;
      for (const video of batch) {
          const promptText = promptTemplate(video);
          const media = [{ media: { url: `gs://${bucketName}/${video.videoPath}`, contentType: 'video/mp4' } }];
          batchEstimatedCost += estimateCost(promptText, media);
      }

      const hasQuota = await checkQuota(jobData.classId, batchEstimatedCost);

      if (!hasQuota) {
          // ... log jobs as blocked-by-quota and skip batch
          continue;
      }
```

---

## 2. Preventing Duplicate Analysis (Idempotency)

This is the most critical safeguard against unnecessary costs. Before starting a new analysis on a video, the system checks if that exact same work has already been successfully completed.

### Safeguard 4: Idempotency Check

For each video, before calling the AI model, the system generates a SHA-256 hash of the full prompt text. It then queries the `aiJobs` collection to find a previous job with the **exact same video path** and **prompt hash** that has a status of **`completed`** and contains a **non-empty result**.

If such a job is found, the system reuses the existing result instead of running a new analysis. This prevents duplicate work if the same job is accidentally triggered twice and also makes the retry mechanism more efficient.

**Code Justification (`processVideoAnalysisJob.js`):**
```javascript
            const crypto = await import('crypto');
            const promptHash = crypto.createHash('sha256').update(promptText).digest('hex');

            // Idempotency Check: Reuse existing completed jobs only if they have a valid result.
            // NOTE: This query requires a composite index in Firestore on (promptHash, status).
            const existingJobsQuery = db.collection('aiJobs')
                .where('mediaPaths', 'array-contains', gsUri)
                .where('promptHash', '==', promptHash)
                .where('status', '==', 'completed')
                .limit(1);
            
            const existingJobsSnapshot = await existingJobsQuery.get();

            if (!existingJobsSnapshot.empty) {
                const existingJobDoc = existingJobsSnapshot.docs[0];
                const existingJobData = existingJobDoc.data();
                // Also check that the result is not empty.
                if (existingJobData.result) {
                    console.log(`Reusing completed job '${existingJobDoc.id}' for video '${video.videoPath}'.`);
                    return { status: 'success', jobId: existingJobDoc.id };
                }
            }

            // If no valid existing job, proceed with analysis.
            const result = await analyzeSingleVideoFlow({...});
```

---

## 3. Retry Mechanism

When a job has failures (e.g., due to temporary network issues, quota limits, or model errors), the user can trigger a retry.

### In-Place Retry with History

Instead of creating a new, confusing master job for each retry, the system updates the *existing* job.

1.  **Trigger**: The user clicks the "Retry Failed Jobs" button, which calls the `retryVideoAnalysisJob` callable Cloud Function.
2.  **Identify Failures**: The function identifies which videos to retry, either from the `failedVideos` array on the job document or (for legacy jobs) by querying for associated `aiJobs` with a `failed` status.
3.  **Log History**: The function updates the master job with a `retryHistory` array, creating a log of every retry attempt.
4.  **Re-run**: The function then re-runs the analysis process, but **only for the videos that previously failed**. All the safeguards mentioned above (batch quota check, idempotency) are also applied during the retry.

**Code Justification (`retryVideoAnalysisJob.js`):**
```javascript
    // Find videos to retry
    let videosToAnalyze = jobData.failedVideos || [];

    // Fallback for legacy jobs
    if (videosToAnalyze.length === 0) {
        const aiJobsSnapshot = await db.collection('aiJobs').where('masterJobId', '==', jobId).where('status', '==', 'failed').get();
        // ... logic to reconstruct videosToAnalyze from failed jobs
    }

    // ...

    // Log the retry attempt to the job's history
    await masterJobRef.update({
        status: 'processing',
        failedVideos: [], // Clear the list for the new retry attempt
        retryHistory: FieldValue.arrayUnion({
            retriedAt: FieldValue.serverTimestamp(),
            videoCount: videosToAnalyze.length,
            originalFailures: videosToAnalyze 
        })
    });

    // ... proceed with analysis only on the videosToAnalyze list
```

---

## 4. Two-Stage Lab Task Discovery, Dynamic Prompt Synthesis & Tool Safety

Real-world laboratory classrooms (e.g., cloud computing labs with AWS, Azure, Docker, Kubernetes) involve distinct tasks, rubrics, and milestone requirements for each lesson session. Predefined static prompts are often too generic to measure specific task durations or evaluate complex coursework milestones.

To address this without requiring teachers to author complex prompts from scratch, the system provides an automated **Two-Stage Lab Task Discovery & Dynamic Synthesis Workflow**:

```mermaid
sequenceDiagram
    autonumber
    actor Teacher
    participant UI as Web App (VideoAnalysisJobs.jsx)
    participant Syn as generateLabTaskPrompt (Callable Cloud Function)
    participant AI as Gemini 3.8 Flash
    participant FS as Firestore
    participant Runner as processVideoAnalysisJob (Firestore Trigger)

    Note over Teacher, Runner: Stage 1: Initial Discovery Pass
    Teacher->>UI: Run generic analysis across lesson videos
    UI->>Runner: Creates videoAnalysisJobs document
    Runner->>FS: Saves student summaries in aiJobs (status: completed)

    Note over Teacher, Runner: Synthesis: Cross-Student Intelligence Aggregation
    Teacher->>UI: Selects completed job & clicks "✨ Generate Lab Task Prompt"
    UI->>Syn: Invokes generateLabTaskPrompt({ jobId })
    Syn->>FS: Reads all completed child aiJobs for jobId
    Syn->>AI: Synthesizes student observations into structured coursework prompt
    AI-->>Syn: Tailored prompt (Coursework tasks, rubrics, technical blockers, tool directives)
    Syn-->>UI: Returns synthesized Markdown prompt

    Note over Teacher, Runner: Stage 2: Targeted Re-Analysis
    UI->>Teacher: Opens modal with editable prompt, model selector & scope
    Teacher->>UI: Reviews / tweaks prompt, picks model & clicks "🚀 Launch Analysis Job"
    UI->>FS: Creates new videoAnalysisJobs document (and optionally saves to Prompt Library)
    FS->>Runner: Triggers targeted 2nd-stage batch analysis
    Runner->>AI: Executes tailored rubrics & records individual task durations
    AI->>FS: Logs recordTaskDuration -> performanceMetrics collection
```

### Tool Safety & Zero Prompt Corruption Guarantees

When new tools are introduced to the AI toolset, there is an important engineering consideration: *Could adding a new tool inadvertently corrupt, distract, or alter the execution of existing, working prompts (e.g., standard invigilation or simple attentiveness monitors)?*

The system prevents prompt corruption through **4 Strict Architectural Safeguards**:

1. **Negative Constraint Scoping in Tool Definitions**:
   The tool definition for `recordTaskDuration` in [`functions/ai_flows/aiTools.js`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/functions/ai_flows/aiTools.js) explicitly defines its applicability boundary:
   ```javascript
   description: 'Records the estimated duration in minutes spent on a specific coursework task or milestone during the lesson. Only invoke this tool when the prompt explicitly asks to track individual lab tasks, milestones, or coursework durations. Do NOT call this tool for general invigilation or if the prompt does not specify coursework tasks to measure.'
   ```
   Gemini's function-calling planner checks each tool's schema and description against the caller's prompt. Because existing invigilation prompts (like `AI invigilator.md`) only request attendance, distraction detection, and overall working time, Gemini's planner will **never** invoke `recordTaskDuration` during those runs.

2. **Data Model Isolation (Zero Collision)**:
   - `recordActualWorkingTime`: Writes directly to `classes/{classId}/lessons/{lessonId}` under `students.{studentUid}.workingMinutes`.
   - `recordLessonSummary`: Writes to `classes/{classId}/lessons/{lessonId}` under `students.{studentUid}.summary`.
   - `recordIrregularity` / `recordVideoIrregularity`: Writes to `irregularities` collection.
   - `recordTaskDuration`: Writes exclusively to the independent `performanceMetrics` collection.
   
   Because each tool interacts with disjoint Firestore documents and collections, tool calls cannot overwrite, mutate, or corrupt lesson documents, student working minutes, or invigilation logs.

3. **Strict Action & Response Protocols in Prompts**:
   Built-in prompts (such as `AI invigilator.md`) enforce numbered action protocols:
   - *"If there were no distractions at all, your final answer MUST be: 'The student remained focused and on track throughout the video.'"*
   The model is strictly constrained to output the exact required textual response structure regardless of tool executions.

4. **Idempotency & Clamping Guardrails**:
   All metric tools enforce idempotency and boundary validation. For example, `recordActualWorkingTime` replaces `[studentPath]: cappedWorkingMinutes` (clamped between 0 and total lesson length) rather than incrementing, ensuring retries or multiple passes never inflate student working minutes.
