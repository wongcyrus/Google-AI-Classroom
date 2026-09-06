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

## 4. Map-Reduce-Map AI Jobs Architecture: Performance Prompt Synthesis & Rubric Reporting

Real-world laboratory classrooms (e.g., cloud computing labs with AWS, Azure, Docker, Kubernetes) involve distinct tasks, rubrics, and milestone requirements for each lesson session. Predefined static prompts are often too generic to measure specific task durations or evaluate complex coursework milestones, while expecting instructors to manually write exhaustive 3-page rubric prompts before every lab session creates prohibitive pedagogical overhead.

To solve this, the platform implements a **Map-Reduce-Map AI Jobs Architecture** that automatically discovers lab milestones from actual student activity, synthesizes a standardized rubric prompt, and then evaluates the entire cohort against that unified benchmark.

### 4.1 The Map-Reduce-Map Paradigm Explained

The workflow mirrors the classic distributed computing MapReduce pattern across three distinct phases:

1. **Map Phase 1 (Parallel Video Discovery & Observation)**:
   - **Input**: All student screen recording videos ($V_1, V_2, \dots, V_n$) recorded during a practical lab session.
   - **Mapping Operation**: A master analysis job (`videoAnalysisJobs`) fans out parallel child AI jobs (`aiJobs`) to Google Vertex AI Gemini Multimodal Vision API (`gemini-3.7-flash` or `gemini-3.5-flash-lite`).
   - **Output**: Each video is processed independently, extracting qualitative student observations, terminal commands executed, error messages encountered, and milestone attempts into structured text summaries saved in `aiJobs`.

2. **Reduce Phase (Cross-Student Intelligence Aggregation & Prompt Synthesis)**:
   - **Input**: The collection of all completed child `aiJob` summaries from Phase 1.
   - **Reduction Operation**: The `generateLabTaskPrompt` Cloud Function aggregates all $N$ student summaries into a unified cross-student context payload. Gemini 3.8 Flash acts as the **Reducer**:
     - Analyzes class-wide behavioral patterns, common error roadblocks, and genuine milestones reached.
     - Synthesizes an **Objective Lab Milestone Rubric** and **Performance Evaluation Prompt**.
     - Automatically embeds explicit system directives and task names tailored for the `recordTaskDuration` tool.
   - **Output**: A comprehensive, production-ready Markdown performance evaluation prompt with standardized scoring criteria and milestone definitions.

3. **Map Phase 2 (Targeted Performance Reporting & Rubric Evaluation)**:
   - **Input**: The synthesized Performance Prompt from Phase 2 + all student screen recording videos ($V_1, V_2, \dots, V_n$).
   - **Mapping Operation**: The instructor launches a targeted evaluation batch job. Parallel child `aiJobs` run across each student's video using the synthesized rubric.
   - **Autonomous Tool Execution**: Gemini evaluates the student against the unified criteria and calls `recordTaskDuration(studentUid, classId, taskName, durationMinutes)` for each completed lab milestone.
   - **Output**: Individual student performance reports with strengths and improvement recommendations, written to `aiJobs`, while structured milestone durations are persisted into `performanceMetrics` to power the **Student Milestone Matrix** and bottleneck analytics.

### 4.2 Architectural Flowchart: Map-Reduce-Map Pipeline

The diagram below illustrates how raw video recordings transition through the Map $\to$ Reduce $\to$ Map pipeline into actionable performance analytics:

```mermaid
flowchart TD
    subgraph InputPool [Class Video Ingestion]
        V1[Student A Screen Video]
        V2[Student B Screen Video]
        V3[Student C Screen Video]
        Vn[Student N Screen Video]
    end

    subgraph MapPhase1 [Phase 1: MAP - Video Exploration & Activity Discovery]
        M1[Gemini 3.7 Vision Worker A]
        M2[Gemini 3.7 Vision Worker B]
        M3[Gemini 3.7 Vision Worker C]
        Mn[Gemini 3.7 Vision Worker N]

        V1 --> M1
        V2 --> M2
        V3 --> M3
        Vn --> Mn

        S1[(aiJobs: Student A Summary)]
        S2[(aiJobs: Student B Summary)]
        S3[(aiJobs: Student C Summary)]
        Sn[(aiJobs: Student N Summary)]

        M1 --> S1
        M2 --> S2
        M3 --> S3
        Mn --> Sn
    end

    subgraph ReducePhase [Phase 2: REDUCE - Performance Prompt & Rubric Synthesis]
        Agg[Cross-Student Summary Funnel: generateLabTaskPrompt]
        S1 --> Agg
        S2 --> Agg
        S3 --> Agg
        Sn --> Agg

        GeminiReducer[Gemini 3.8 Flash Prompt Synthesizer]
        Agg --> GeminiReducer

        RubricPrompt[Synthesized Objective Lab Rubric Prompt<br/>- Task Milestones Defined<br/>- Rubric Scoring Criteria<br/>- recordTaskDuration Directives]
        GeminiReducer --> RubricPrompt
    end

    subgraph MapPhase2 [Phase 3: MAP - Targeted Performance Reporting & Metric Extraction]
        RubricPrompt -.->|Injected as Master Prompt| EvalRunner[Launch Targeted Batch Job]

        E1[Gemini Evaluation Worker A]
        E2[Gemini Evaluation Worker B]
        E3[Gemini Evaluation Worker C]
        En[Gemini Evaluation Worker N]

        EvalRunner --> E1
        EvalRunner --> E2
        EvalRunner --> E3
        EvalRunner --> En

        V1 -.-> E1
        V2 -.-> E2
        V3 -.-> E3
        Vn -.-> En

        Tool1[recordTaskDuration Tool Calls]
        Tool2[recordTaskDuration Tool Calls]
        Tool3[recordTaskDuration Tool Calls]
        Tooln[recordTaskDuration Tool Calls]

        E1 --> Tool1
        E2 --> Tool2
        E3 --> Tool3
        En --> Tooln
    end

    subgraph AnalyticsOutputs [Persisted Analytics & Reports]
        PM[(Firestore: performanceMetrics Collection)]
        Tool1 --> PM
        Tool2 --> PM
        Tool3 --> PM
        Tooln --> PM

        Matrix[Student Milestone Matrix<br/>- Sortable Time-to-Completion Heatmap<br/>- Task Duration Badges]
        Bottlenecks[Class Bottleneck Analysis<br/>- Average Task Durations<br/>- Drop-off / Delay Identification]
        Reports[Individual Student Performance Reports<br/>- Qualitative Rubric Feedback<br/>- CSV / JSON / Markdown Exports]

        PM --> Matrix
        PM --> Bottlenecks
        E1 --> Reports
        E2 --> Reports
        E3 --> Reports
        En --> Reports
    end

    style MapPhase1 fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    style ReducePhase fill:#1e1b4b,stroke:#a855f7,stroke-width:2px,color:#f8fafc
    style MapPhase2 fill:#022c22,stroke:#10b981,stroke-width:2px,color:#f8fafc
    style AnalyticsOutputs fill:#18181b,stroke:#f59e0b,stroke-width:2px,color:#f8fafc
```

### 4.3 Sequence Diagram: End-to-End Execution Flow

```mermaid
sequenceDiagram
    autonumber
    actor Teacher
    participant UI as Web App (VideoAnalysisJobs.jsx)
    participant Syn as generateLabTaskPrompt (Callable Cloud Function)
    participant AI as Vertex AI (Gemini 3.7 / 3.8 Flash)
    participant FS as Firestore (aiJobs & performanceMetrics)
    participant Runner as processVideoAnalysisJob (Firestore Trigger)

    Note over Teacher, Runner: MAP PHASE 1: Parallel Video Discovery
    Teacher->>UI: Selects date range / class & clicks "Analyze Videos"
    UI->>FS: Creates `videoAnalysisJobs/job1` (Level 1 Master Job)
    FS-->>Runner: Triggered on creation
    Runner->>FS: Queries unique student video paths
    loop For each student video in parallel batches
        Runner->>AI: analyzeSingleVideoFlow (Video + Discovery Prompt)
        AI-->>Runner: Qualitative summary & timeline events
        Runner->>FS: Writes child `aiJobs/aiJob_i` (status: 'completed')
    end
    Runner->>FS: Updates `videoAnalysisJobs/job1` status to 'completed'
    FS-->>UI: Real-time listener updates UI with completed badge

    Note over Teacher, Runner: REDUCE PHASE: Cross-Student Prompt Synthesis
    Teacher->>UI: Selects completed job & clicks "✨ Generate Lab Task Prompt"
    UI->>UI: Displays 3-Stage Animated Progress Stepper
    UI->>Syn: Invokes generateLabTaskPrompt({ jobId: 'job1' })
    Syn->>FS: Queries all completed child `aiJobs` for `masterJobId == 'job1'`
    Syn->>Syn: Aggregates student observation summaries into unified context
    Syn->>AI: Synthesizes class observations with Gemini 3.8 Flash
    AI-->>Syn: Objective Lab Rubric (Milestones, Rubrics, Tool Directives)
    Syn-->>UI: Returns synthesized Markdown prompt
    UI->>Teacher: Opens review modal with editable prompt, model selector & scope

    Note over Teacher, Runner: MAP PHASE 2: Performance Evaluation & Reporting
    Teacher->>UI: Reviews / tweaks prompt & clicks "🚀 Launch Analysis Job"
    UI->>FS: Creates new `videoAnalysisJobs/job2` with synthesized rubric
    FS-->>Runner: Triggered on creation
    loop For each student video in parallel batches
        Runner->>AI: analyzeSingleVideoFlow with synthesized rubric
        AI->>AI: Identifies milestone completions & durations
        AI->>FS: Tool call: recordTaskDuration(studentUid, classId, taskName, durationMinutes)
        Note over AI, FS: Writes directly to `performanceMetrics` collection
        AI-->>Runner: Student performance evaluation report
        Runner->>FS: Writes child `aiJobs/aiJob_target_i` with final report
    end
    Runner->>FS: Updates `videoAnalysisJobs/job2` to 'completed'
    FS-->>UI: Real-time update in PerformanceAnalyticsView
    Note over Teacher, UI: Teacher views sortable Milestone Matrix, duration heatmaps & exports CSV
```

### 4.4 Phase Characteristics & Operational Matrix

| Dimension | Map Phase 1 (Video Discovery) | Reduce Phase (Prompt Synthesis) | Map Phase 2 (Performance Evaluation) |
| :--- | :--- | :--- | :--- |
| **Primary Goal** | Ground-truth activity discovery from raw screen video | Synthesize objective rubric & milestones across cohort | Evaluate individual competencies against unified rubric |
| **Target Dataset** | $N$ Student MP4 screen recordings | $N$ Text summaries from completed child `aiJobs` | $N$ Student MP4 screen recordings + Synthesized Rubric |
| **Gemini Model** | `gemini-3.7-flash` or `gemini-3.5-flash-lite` | `gemini-3.8-flash` (High-reasoning synthesis) | `gemini-3.7-flash` (Deep Multimodal Reasoning) |
| **Execution Layer** | Cloud Run Function (`processVideoAnalysisJob`) | Callable Cloud Function (`generateLabTaskPrompt`) | Cloud Run Function (`processVideoAnalysisJob`) |
| **Tool Calling** | Disabled or generic invigilation tools | None (Pure prompt engineering & reasoning) | Enabled: `recordTaskDuration` tool execution |
| **Firestore Reads** | `videoJobs` collection | `aiJobs` sub-collection | `videoJobs` collection + synthesized prompt |
| **Firestore Writes** | `aiJobs` records (observations & summaries) | None (Prompt returned in-memory to client) | `aiJobs` (reports) + `performanceMetrics` (milestones) |
| **UI Surface** | `VideoAnalysisJobsTable.jsx` (Level 1 Table) | Animated 3-Stage Progress Stepper Modal | `AiJobsTable.jsx` + `PerformanceAnalyticsView.jsx` |
| **Primary Output** | Raw chronological findings per student | Tailored Markdown prompt with milestone rubric | **Student Milestone Matrix**, duration heatmaps & reports |

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
