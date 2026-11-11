---
title: "Google AI Classroom Part 8: Multimodal AI Capstone Project Supervision — Streamlined Mobile 720p Demo Studio, 2-Stage Diarization & Fake-Log Auditing with Gemini 4"
published: true
description: "Measuring authentic student performance in capstone projects with a mobile 720p demo studio, 2-stage diarization, and fake-log auditing using Gemini 4."
tags: ai, mobile, gemini, education
cover_image: https://raw.githubusercontent.com/wongcyrus/Google-AI-Classroom/main/docs/blogs/images/blog08_cover_multimodal_capstone_supervision.png?v=2
canonical_url: https://github.com/wongcyrus/Google-AI-Classroom/blob/main/docs/blogs/08-multimodal-capstone-project-supervision-gemini-4.md
---

# Google AI Classroom Part 8: Multimodal AI Capstone Project Supervision — Streamlined Mobile 720p Demo Studio, 2-Stage Diarization & Fake-Log Auditing with Gemini 4

**Author:** [**Cyrus Wong (黃俊彥)**](https://www.linkedin.com/in/cyruswong/) — *Google Developer Expert - Cloud (AI), Senior Lecturer at HKIIT*

---

![Google AI Classroom Part 8: Multimodal AI Capstone Project Supervision](https://raw.githubusercontent.com/wongcyrus/Google-AI-Classroom/main/docs/blogs/images/blog08_cover_multimodal_capstone_supervision.png?v=2)

## 1. The Capstone Supervision Bottleneck: ChatGPT Logbooks, Free-Riders & Multi-Device Consultation Friction

Supervising 15 final-year engineering capstone project groups (60+ students) across a 16-week semester is one of the most rewarding yet administratively exhausting responsibilities in higher education. In our Software Engineering and Cloud Computing Higher Diploma programmes, three recurring pain points threatened both pedagogical quality and assessment fairness:

1. **The "ChatGPT Logbook" Epidemic (`suspected_ai_fake`) & 1-Word Filler (`vague_useless`)**: Students are required to submit weekly progress logbooks via Google Forms before their consultation meeting. Some students type one-word filler (`"done"`, `"finish"`, `"thinking"`), while others paste LLM-generated corporate buzzword salads (*"Implemented real-time microservice telemetry, RBAC authentication, and mock AI chatbot"*) right after three consecutive weeks of reporting zero work.
2. **Why Capstone Supervision Is Never "Just Voice" — And Why We Replaced Student PC Screen Sharing with a Single-Device Mobile Studio**: A real engineering capstone consultation is **inherently multimodal, not just a voice conversation**. Around a physical lab table, students show physical IoT microcontroller breadboards, hand-drawn ER diagrams on paper/whiteboards, mobile app prototypes, and live code/terminal outputs on their personal laptops. We no longer ask students to join a web session and share their PC screen—waiting for 4 students to authenticate and switch desktop screen shares wasted 3 to 4 minutes of a 15-minute consultation and could never capture hardware wiring or whiteboard architecture diagrams. Instead, the supervisor captures **all three modalities from a single smartphone**: **🎙️ Continuous Voice Consultation**, **📸 Zero-Pause `0.1s` Instant Photo Snaps (`1280px` JPEG)**, and **📹 Auto-Sliced `720p` (`1280×720`) Mobile Camera Demo Videos**.
3. **Multilingual Speaker Attribution in Noisy Labs**: When 4 project teammates and a supervisor debate system architecture around a single table—code-switching rapidly between conversational Cantonese, Mandarin, and English technical terms (`React`, `Firestore`, `Docker`, `Cloud Run`, `PR`)—a single-pass LLM prompt cannot reliably separate *who* actually answered the technical challenge questions and demonstrated working prototypes from *who* sat silently and free-rode on their teammates' work.

In **Part 8** of our Google Developer Expert series, we dive deep into the architecture of the **Capstone Project Supervision & Weekly Log AI Pipeline** ([`ProjectMeetingsView.jsx`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/web-app/src/components/meetings/ProjectMeetingsView.jsx) and [`projectMeetingFlows.js`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/functions/ai_flows/projectMeetingFlows.js)), showing how we engineered:
- **A Self-Healing On-Demand Google Sheets Logbook Sync** with **Hamming Distance = 1 Student ID Typo Healing** and holiday-aware academic week calculation.
- **A Pre-Meeting Fake-Log AI Auditor (`prepareProjectMeetingLogQuestions`)** that cross-examines each student's current weekly log against their prior weeks' history and generates pointed live code-walkthrough challenge questions.
- **A Streamlined Single-Device Teacher Mobile Supervision Studio** on the supervisor's smartphone: combining **🎙️ Continuous Voice Recording** (+ 1-tap `🗣️ Speaking Now` student voice anchors), **📸 Zero-Pause `0.1s` Photo Snaps (`1280px` JPEG)**, and **📹 Auto-Sliced `720p` (`1280×720`) Mobile Camera Demo Videos** that completely eliminate student PC screen-capture friction.
- **A Two-Stage Multimodal Cross-Examination Pipeline (`analyzeProjectMeeting`)**: pairing **Stage 1 Acoustic Speaker Diarization (`gemini-3.5-transcribe-preview` with automatic `gemini-3.8-flash` low-volume & long-clip truncation recovery)** with **Stage 2 Multimodal Verification (`gemini-4-argon` / `gemini-3.8-flash`)** and **1-Click Secret Manager SMTP HTML Report Dispatch (`batchEmailProjectMeetingReports`)**.

---

## 2. Diagram 1: Self-Healing Google Sheets Sync & Pre-Meeting Fake-Log AI Auditor

Before the weekly consultation begins, the supervisor clicks **🔄 Sync Weekly Logs** inside [`ProjectMeetingsView.jsx`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/web-app/src/components/meetings/ProjectMeetingsView.jsx). Rather than running wasteful background cron jobs every 5 minutes, the platform performs an on-demand incremental delta sync against the class's linked Google Form spreadsheet (`Form Responses 2`), fetching only newly appended rows (`startRow = lastSyncedRowCount + 1`).

![Self-Healing Google Sheets Sync & Pre-Meeting Fake-Log AI Auditor](https://raw.githubusercontent.com/wongcyrus/Google-AI-Classroom/main/docs/blogs/images/blog08_diagram1_sheets_sync_fake_log_audit.png?v=2)

### Why Hamming Distance = 1 Student ID Healing Saved Hours of Manual Fixes
On mobile Google Forms, students frequently mistype a single digit of their 9-digit Student ID (e.g., typing `250105349` instead of `250105348`) or submit from a personal `@gmail.com` address. A strict string equality check drops those logs as orphaned records.

Our ingestion resolver compares any unmatched 9-digit numeric ID against the enrolled class roster (`projectGroups`). If **exactly one** enrolled student in the class has a 9-digit ID of identical length with **Hamming distance $= 1$** (differing by exactly 1 character position), or if the normalized student name uniquely matches an enrolled group member, the sync engine automatically heals the typo, links the log to the student's group and academic week, and flags the healed record in the UI!

### Production Code 1: Pre-Meeting Fake-Log Detection & Live Code-Walkthrough Challenge Generator (`handlePrepareProjectLogQuestions`)

Once the weekly logs are synced into `classes/{classId}/projectMeetings/{meetingId}`, the supervisor clicks **🔍 Audit Logs & Prepare Questions** (or runs **⚡ Smart Batch AI Mode 1** across all groups for Week $W$). Let's look at [`handlePrepareProjectLogQuestions`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/functions/ai_flows/projectMeetingFlows.js) in [`functions/ai_flows/projectMeetingFlows.js`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/functions/ai_flows/projectMeetingFlows.js), which feeds each student's Week $W$ log *plus* their multi-week historical log trajectory into **Gemini 4 Argon (`gemini-4-argon`)** or **Gemini 3.8 Flash (`gemini-3.8-flash`)**:

```javascript
// Source: functions/ai_flows/projectMeetingFlows.js
export async function handlePrepareProjectLogQuestions({
  classId,
  meetingId,
  groupId,
  groupName,
  projectTopic,
  weekNumber = 1,
  weeklyLogs = [],
  preferredModel,
  auth,
}) {
  const reasoningModel = preferredModel || DEFAULT_LECTURE_AI_MODEL || 'gemini-3.8-flash';

  const logsFormatted = weeklyLogs
    .map((l, idx) => {
      const priorSummary = Array.isArray(l.priorHistory) && l.priorHistory.length > 0
        ? l.priorHistory
            .map(
              (p) =>
                `  * Week ${p.weekNumber}: Doing=${p.isDoingSomething ? 'Yes' : 'No'} | WorkDone="${p.workDone || p.inactiveReason || ''}" | Plan="${p.nextPlan || ''}"`
            )
            .join('\n')
        : '  * No prior weekly logs submitted.';
      return `### Student ${idx + 1}: ${l.studentName || l.name || 'Student'} (ID: ${l.studentId || 'N/A'}, Email: ${l.email || 'N/A'})
- Week ${weekNumber} Submitted: ${l.submitted === false ? 'NO LOG SUBMITTED THIS WEEK' : 'Yes'}
- "I am doing something this week": ${l.isDoingSomething ? 'Yes' : 'No'}
- "Work done & findings since last recording": "${l.workDone || ''}"
- "Part of last plan not yet finished": "${l.unfinished || ''}"
- "Plan of work before next recording": "${l.nextPlan || ''}"
- Prior Weeks Log History (for Continuity & Sudden-Jump Fake Detection):
${priorSummary}`;
    })
    .join('\n\n');

  // ... (Constructs prompt instructing Gemini to classify each log into
  // "genuine" | "vague_useless" | "suspected_ai_fake" | "inactive"
  // and generate 2-3 live code-walkthrough challengeQuestions)

  const { response, modelUsed } = await generateWithResilience(
    {
      prompt: [{ text: prompt }],
      config: {
        temperature: 0.2,
        maxOutputTokens: 16384,
        responseMimeType: 'application/json',
      },
    },
    reasoningModel
  );
  // Persists preMeetingLogAudit[] onto classes/{classId}/projectMeetings/{meetingId}
}
```

Here is the exact **Pre-Meeting Fake-Log Audit & Challenge Question Prompt** executed inside `handlePrepareProjectLogQuestions`:

```markdown
## Pre-Meeting Weekly Log Audit & Fake-Log Challenge Question Task
You are helping the project supervisor prepare for **{{groupName}} — Week {{weekNumber}}** supervision meeting (Project Topic: {{projectTopic}}).

In this course, **writing a high-quality weekly log that accurately reflects real engineering work is an explicit grading criterion**.
However, two common student problems occur in the weekly log sheet:
1. **Useless / Vague Logs (`vague_useless`)**: 1-to-4 word filler like "done", "finish", "thinking", "do website", "proposal", or copy-pasting previous weeks' logs without concrete technical findings or deliverables.
2. **Fake / AI-Generated Logs (`suspected_ai_fake`)**: Logs that appear written by ChatGPT/AI to sound impressive (buzzword-heavy corporate prose like "Implemented real-time dashboards, mock AI chatbot, and role-based access control" or sudden massive multi-module claims right after weeks of writing "done" or "No"), without specific file names, bugs encountered, or continuity with last week's plan.

## Students' Week {{weekNumber}} Logs & Prior History
{{logsFormatted}}

## Instructions
For EVERY student listed above:
1. Classify `logQualityStatus` as one of:
   - `"genuine"`: Specific, honest, technically grounded log that connects logically to prior plans.
   - `"vague_useless"`: Too brief, generic ("done", "thinking"), or copy-pasted to evaluate real work.
   - `"suspected_ai_fake"`: Overly polished AI buzzword dump, suspicious sudden leap from prior "done"/"No" logs, or claims too many unverified subsystems at once.
   - `"inactive"`: Answered "No" to doing work this week or did not submit a log.
2. Assign `logQualityScore` from `0` to `10` (e.g., 8-10 for genuine detailed logs; 3-5 for suspected AI/fake logs pending verification; 1-4 for vague/useless logs; 0-2 for inactive/missing).
3. Write a concise `logAuditSummary` (1-2 sentences explaining why the log received this score and what looks genuine, vague, or AI-faked).
4. Generate 2 to 3 sharp, specific `challengeQuestions` for the supervisor to ask the student live during the meeting:
   - If `suspected_ai_fake`: Ask live code-walkthrough & debugging challenge questions that a student who faked the log with AI cannot answer without demonstrating real code or hardware live (e.g., "Open the exact Flask route / database table on your laptop right now for our 720p demo recording and show how X handles Y", "What specific error did you hit when integrating X and how did you fix it?").
   - If `vague_useless`: Demand an immediate live demonstration (captured via 720p mobile demo video or photo snap) of concrete artifacts and measurable next-week deliverables.
   - If `genuine`: Ask constructive technical design & edge-case verification questions about their reported findings.

Respond strictly with valid JSON matching this structure:
{
  "preMeetingLogAudit": [
    {
      "studentId": "250105348",
      "email": "250105348@stu.vtc.edu.hk",
      "name": "Student Name",
      "logQualityStatus": "suspected_ai_fake",
      "logQualityScore": 4,
      "logAuditSummary": "Sudden leap from 'done' in Weeks 6-7 to claiming full Flask backend, real-time dashboards, mock AI chatbot, and RBAC in one week.",
      "challengeQuestions": [
        "Open your Flask route file for a live demonstration: walk us through how the Doctor/Patient role-based access control check is implemented in code.",
        "Which database tables back your real-time dashboard and history page, and can you trigger a live state update right now?",
        "What was the hardest bug you fixed while connecting the frontend to Flask this week?"
      ]
    }
  ]
}
```

When a student submits a suspected ChatGPT log claiming they built an entire Flask RBAC backend in one week after writing `"done"` in Weeks 6 and 7, Gemini flags the badge as **`🟠 Suspected AI / Fake (4/10)`** right on the supervisor's smartphone card and prepares 3 targeted verification questions for live in-person demonstration:
> 1. *"Open your Flask route file for a live demonstration: walk us through how the Doctor/Patient role-based access control decorator is implemented in code."*
> 2. *"Which database tables back your real-time dashboard, and can you trigger a live state update right now while we capture a 720p demo clip?"*
> 3. *"What was the hardest bug you hit while connecting the React frontend to Flask this week?"*

---

## 3. Diagram 2: Streamlined Single-Device Teacher Mobile Supervision Studio (Voice + `0.1s` Photo Snap + Auto-Sliced `720p` Demo Video)

When the group sits down for their weekly consultation, the supervisor opens the meeting card on their smartphone or tablet.

To make live supervision effortless with **one thumb**, we eliminated cross-device student PC screen-capture signaling completely and consolidated all multimodal capture into a **Streamlined Single-Device Teacher Mobile Supervision Studio** in [`ProjectMeetingsView.jsx`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/web-app/src/components/meetings/ProjectMeetingsView.jsx):

1. **🎙️ Continuous Voice Consultation (`audio/webm` / `audio/mp4`)**: Protected by the browser Screen Wake Lock API (`navigator.wakeLock.request('screen')`) so the mobile browser never sleeps mid-consultation. As each student speaks or answers a challenge question, the supervisor taps their **`🗣️ Speaking Now`** pill, stamping `{ studentUid, name, email, timeSeconds, timestamp, clipIndex }` into `voiceAnchors[]`.
2. **📸 Zero-Pause Instant Photo Snap (`0.1s`, `1280px` JPEG @ `0.85` quality)**: When a student sketches an ER diagram on paper, shows an IoT microcontroller circuit, or points to a stack trace on their laptop, tapping **`📸 Snap Photo`** captures a crisp `1280px` image and uploads it to `projectMeetings/{classId}/{groupId}/{meetingId}/` **in `0.1` seconds without pausing or interrupting the ongoing voice recording!**
3. **📹 Auto-Sliced `720p` Mobile Camera Demo Video (`1280×720` @ `~1.5 Mbps`)**: When a student demonstrates their working software or hardware prototype on their laptop or phone, the supervisor simply taps **`📹 Record Demo Video (720p)`** and points their smartphone camera at the student's demo:
   - The studio **automatically finalizes and uploads `Voice Part N`** in the background.
   - It activates the mobile rear/front camera at **`720p` (`1280×720`, `~1.5 Mbps` bitrate)**—sharp enough for Gemini 4 Argon to read laptop UI states and terminal output, yet compact enough (`~11 MB/min`) to upload in seconds over campus Wi-Fi.
   - The instant the supervisor taps **`⏹️ Stop Demo`**, the studio uploads the `720p` demo clip (`type: 'mobile_camera'`) and **automatically resumes `Voice Part N+1`** so not a single second of verbal feedback is lost!

![Streamlined Single-Device Teacher Mobile Supervision Studio State Machine](https://raw.githubusercontent.com/wongcyrus/Google-AI-Classroom/main/docs/blogs/images/blog08_diagram2_mobile_supervision_studio_state.png?v=2)

### Atomic Stale Analysis Invalidation When Moving Clips Across Groups or Weeks
During back-to-back consultations with 10 project groups, a supervisor occasionally records Group 3's voice clip or demo video while Group 2's card is still open. In [`ProjectMeetingsView.jsx`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/web-app/src/components/meetings/ProjectMeetingsView.jsx), we built a **1-Click Clip Reassignment Modal (`➡️ Move Clip to Another Meeting / Week`)**.

Whenever a voice clip, 720p demo video, or photo is moved from Meeting $A$ to Meeting $B$ (or deleted after an AI report was already generated), a single atomic Firestore `writeBatch()` moves the media metadata, shifts any associated `voiceAnchors`, and **automatically purges stale AI report fields** (`executiveSummary`, `keyInsights`, `attendanceRecord`, `studentContributions`, `actionItems`, `rawDiarizedTranscript`) on both meetings using `deleteField()` while setting `needsReanalysis: true`. This guarantees a supervisor can never accidentally email a stale AI report after modifying a meeting's evidence!

---

## 4. Diagram 3: Two-Stage Multimodal Diarization & Gemini 4 Argon Cross-Examination (`analyzeProjectMeeting`)

Once the consultation concludes, the supervisor selects **🧠 Gemini 4 Argon (`gemini-4-argon`)** or **⚡ Gemini 3.8 Flash (`gemini-3.8-flash`)** directly in the meeting toolbar (or triggers **Smart Batch AI Mode 1 Queuing**, which sequentially processes all ready meetings in Week $W$ and skips already-analyzed meetings unless `needsReanalysis === true`).

Why split `analyzeProjectMeeting` into **two distinct AI stages** instead of feeding raw audio, video, photos, and logs into a single prompt?
- **Stage 1 (`gemini-3.5-transcribe-preview` with `gemini-3.8-flash` Resilience Fallbacks)** is dedicated 100% to **verbatim multilingual acoustic & demo-video dialogue diarization** across every voice clip (`audioClips[]`) and `720p` mobile camera demo video (`screenClips[]`), shifting timestamps cumulatively (`offsetTranscriptTimestamps`) across `Voice Part 1`, `Demo 1`, and `Voice Part 2`.
- **Stage 2 (`gemini-4-argon` or `gemini-3.8-flash`)** receives **five multimodal evidence streams simultaneously**:
  1. The **Stage 1 Diarized Audio & Demo Video Transcript**,
  2. The supervisor's **1-Tap `voiceAnchors[]` Ground Truth Speaker Stamps**,
  3. The **`720p` Mobile Camera Demo Videos (`screenClips[]`)** attached as native `video/mp4` / `video/webm` multimodal `media` parts (`reasoningMediaParts`),
  4. The **Snapped Meeting Photos (`photos[]`)** of hardware breadboards, whiteboard ERDs, and laptop code attached as `image/jpeg` `media` parts (`reasoningMediaParts`), and
  5. The **Students' Submitted Weekly Log Sheet Entries (`weeklyLogs[]`)** + **Prior Week's Assigned Action Items (`priorWeekContext`)**.

![Two-Stage Multimodal Diarization & Gemini 4 Argon Cross-Examination (analyzeProjectMeeting)](https://raw.githubusercontent.com/wongcyrus/Google-AI-Classroom/main/docs/blogs/images/blog08_diagram3_two_stage_capstone_diarization.png?v=2)

---

## 5. Deep Dive into the Production Code: Long-Clip Truncation Recovery & Deterministic Roster Reconciliation

### Production Code 2: Stage 1 Acoustic Diarization with Automatic Low-Volume & Long-Clip Truncation Recovery (`projectMeetingFlows.js`)

During real classroom testing with 25-minute capstone consultations, we discovered two edge cases with dedicated speech-to-text preview models (`gemini-3.5-transcribe-preview`):
1. **Low-Volume / Quiet Clips**: If students sit far from the supervisor's phone in a quiet room, dedicated STT filters occasionally classify soft speech as background noise and return an empty string.
2. **Mid-Meeting Silence Pause Truncation (`isLongClipTranscriptTruncated`)**: If a group pauses speaking for 20 seconds at minute `08:00` while compiling code on a laptop during a 20-minute recording (`>= 360s`), `gemini-3.5-transcribe-preview` can prematurely emit an end-of-sequence token, truncating the second half of the consultation!

In [`functions/ai_flows/projectMeetingFlows.js`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/functions/ai_flows/projectMeetingFlows.js), we built two automatic self-healing guards (`isLongClipTranscriptTruncated` and `offsetTranscriptTimestamps`) that detect both anomalies and seamlessly recover the full verbatim Cantonese/English diarization using multimodal `gemini-3.8-flash` (`thinkingBudget: 0`):

```javascript
// Source: functions/ai_flows/projectMeetingFlows.js

/**
 * Shifts [MM:SS] timestamps in a diarized transcript by offsetSeconds for multi-clip meetings.
 */
export function offsetTranscriptTimestamps(transcriptText, offsetSeconds = 0) {
  if (!transcriptText || !offsetSeconds || offsetSeconds <= 0) {
    return transcriptText || '';
  }
  return String(transcriptText).replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, (_match, ts) => {
    const secs = parseTimestampToSeconds(ts) + Math.floor(offsetSeconds);
    return `[${formatSecondsToMmSs(secs)}]`;
  });
}

/**
 * Detects whether `gemini-3.5-transcribe-preview` prematurely stopped (e.g. due to a 15s silence pause
 * or unary audio token ceiling) on a long meeting clip (>= 360s / 6+ minutes).
 */
export function isLongClipTranscriptTruncated(transcriptText, durationSeconds = 0) {
  const dur = Number(durationSeconds) || 0;
  if (dur < 360) return false;
  const clean = String(transcriptText || '').trim();
  if (clean.length < 120) return true;
  const matches = [...clean.matchAll(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g)];
  if (matches.length === 0) return false;
  let maxTsSecs = 0;
  for (const m of matches) {
    const secs = parseTimestampToSeconds(m[1]);
    if (secs > maxTsSecs) maxTsSecs = secs;
  }
  return maxTsSecs > 0 && maxTsSecs < dur * 0.45;
}
```

When `isLongClipTranscriptTruncated(clipText, clipDurationSecs)` returns `true`, Stage 1 automatically re-invokes `generateWithResilience` with an explicit full-duration boundary instruction (`"IMPORTANT: This meeting recording is 22:15 long. Do NOT stop early on pauses; transcribe the entire recording from [00:00] through [22:15]."`), ensuring 100% of the consultation dialogue reaches Stage 2!

### The 2-Stage Multimodal Prompts Powering `analyzeProjectMeeting`

Here are the exact prompts executed across Stage 1 and Stage 2 of [`functions/ai_flows/projectMeetingFlows.js`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/functions/ai_flows/projectMeetingFlows.js) (and [`admin/prompts/audios/Project Group Meeting Analyzer.md`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/admin/prompts/audios/Project%20Group%20Meeting%20Analyzer.md)):

#### 1. Stage 1 Prompt — Multilingual Acoustic Speaker Diarization & Mobile Demo Video Transcription (`gemini-3.5-transcribe-preview`)

```markdown
# Stage 1A: Voice Consultation Clip Diarization Prompt
Transcribe this project supervision meeting audio clip ({{clipLabel}}) verbatim in its original spoken language (Cantonese, Mandarin, or English, preserving English technical terms like React, Firestore, Docker, API).
Identify distinct voices using speaker diarization labels with [MM:SS] timestamps (e.g., [00:05] Speaker 1: ..., [00:42] Speaker 2: ...).
If a speaker states their name or is addressed by name, include their name next to the speaker label (e.g., [00:42] Speaker 2 (Alice): ...).

# Stage 1B: Long-Clip Truncation Recovery Suffix (Injected if maxTsSecs < dur * 0.45)
IMPORTANT: This meeting recording is {{clipDurationMmSs}} long. Do NOT stop early on pauses; transcribe the entire recording from [00:00] through [{{clipDurationMmSs}}].

# Stage 1C: 720p Mobile Camera Demo Video Dialogue Prompt
Transcribe any speech or spoken dialogue during this live project demonstration video clip ({{demoLabel}}) verbatim with speaker diarization and [MM:SS] timestamps. If no speech is present, reply with [Demonstration without speech].
```

#### 2. Stage 2 Prompt — Multimodal Roster Attribution & Weekly Log vs. Live Demo Cross-Examination (`gemini-4-argon` / `gemini-3.8-flash`)

In Stage 2, [`functions/ai_flows/projectMeetingFlows.js`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/functions/ai_flows/projectMeetingFlows.js) packages both the snapped `image/jpeg` meeting photos (`meetingPhotos.slice(0, 8)`) and the `720p` `video/mp4` / `video/webm` mobile demo clips (`mobileDemoClips.slice(0, 3)`) into `reasoningMediaParts` alongside the text prompt so **Gemini 4 Argon (`gemini-4-argon`)** or **Gemini 3.8 Flash (`gemini-3.8-flash`)** visually inspects the student's actual hardware/code demonstrations as well as their spoken answers:

```javascript
// Source: functions/ai_flows/projectMeetingFlows.js (Stage 2 Multimodal Media Assembly)
const reasoningMediaParts = [];
for (const photo of meetingPhotos.slice(0, 8)) {
  const pGsUri = resolveGsUri(photo.storagePath || photo.downloadUrl, bucketName);
  if (pGsUri) {
    reasoningMediaParts.push({ media: { url: pGsUri, contentType: 'image/jpeg' } });
  }
}
for (const vClip of mobileDemoClips.slice(0, 3)) {
  const vGsUri = resolveGsUri(vClip.storagePath || vClip.downloadUrl, bucketName);
  if (vGsUri) {
    const vContentType = vClip.mimeType?.includes('mp4') ? 'video/mp4' : 'video/webm';
    reasoningMediaParts.push({ media: { url: vGsUri, contentType: vContentType } });
  }
}

const { response: reasoningResponse, modelUsed: reasoningModelUsed } = await generateWithResilience(
  {
    prompt: [{ text: reasoningPrompt }, ...reasoningMediaParts],
    config: {
      temperature: 0.1,
      maxOutputTokens: 65536,
      responseMimeType: 'application/json',
    },
  },
  reasoningModel
);
```

Here is the Stage 2 `reasoningPrompt` sent with `...reasoningMediaParts`:

```markdown
You are an expert academic project supervisor and technical meeting analyst for higher education Capstone / Final Year Project (FYP) weekly supervision meetings in Hong Kong.
Speakers in the meeting code-switch naturally between Cantonese, Mandarin, and English technical terminology (e.g., `React`, `Firestore`, `Docker`, `Cloud Run`, `CI/CD`, `API`, `Git`, `PR`).

## Meeting Metadata
- Class ID: {{classId}}
- Project Group: {{groupName}}
- Project Topic: {{projectTopic}}
- Week Number: Week {{weekNumber}}
- Supervisor: {{supervisorName}} ({{supervisorEmail}})

## Enrolled Group Student Roster
{{rosterLines}}

## Deterministic Speaker & Multimodal Evidence Anchors (1-Tap Supervisor Voice Tags, 720p Mobile Demo Videos & Snapped Meeting Photos)
### 1-Tap Supervisor "Speaking Now" Anchors (100% Ground Truth Speaker Identity at Timestamp):
{{voiceAnchorLines}}

### Visual Demonstration Clips & Meeting Photo Artifacts:
#### Meeting Photo Artifacts Captured Live by Supervisor:
{{meetingPhotoLines}}

#### Demonstration Video Clips (720p Mobile Camera):
{{screenClipLines}}

## Prior Week's Assigned Action Items (for Continuity Check)
{{priorWeekContext}}

## Students' Submitted Weekly Log Sheet Entries for Week {{weekNumber}} (for Log Quality Grading & Fake-Log Verification)
{{weeklyLogsLines}}

## Stage 1 Diarized Audio & Demo Video Transcript (from gemini-3.5-transcribe-preview / gemini-3.8-flash)
"""
{{combinedDiarizedTranscript}}
"""

## Task Instructions
Using the Stage 1 Diarized Audio & Demo Video Transcript, the Deterministic Speaker & Multimodal Evidence Anchors, the attached Meeting Photo Artifacts and 720p Mobile Demo Videos, and the Students' Submitted Weekly Logs above:
1. Resolve anonymous speaker labels (Speaker 1, Speaker 2, etc.) to the exact students in the Enrolled Group Student Roster or the Supervisor using opening self-introductions, 1-tap voice anchors, discussed project tasks, and live 720p mobile camera demonstrations.
2. Determine the Attendance Record for every student in the roster ('present', 'late', or 'absent'), their speakingContribution ('high', 'moderate', 'low', 'none'), a concise evidence string with [MM:SS] timestamp, and firstHeardTimestamp ('MM:SS').
3. Extract Key Meeting Insights (executiveSummary, overallGroupProgress: 'on_track' | 'ahead' | 'at_risk' | 'behind', keyDecisions[], blockersAndRisks[], supervisorFeedback[], and weeklyGroupFeedback).
4. Cross-verify each student's **Submitted Weekly Log** against what they **actually discussed/demonstrated in the meeting**, including any attached **Meeting Photo Artifacts** (whiteboard diagrams, hardware wiring, terminal code) and **720p Mobile Camera Demonstration Videos**:
   - Flag **vague/useless logs** (e.g. "done", "thinking") as `"vague_useless"` and **AI-generated/fake logs** that were NOT backed up by real understanding, code, or visual demonstration in the meeting as `"suspected_ai_unverified"` or `"contradicted_in_meeting"`. If verified by their spoken explanation, 720p demo video, or photo artifacts, mark `"genuine_verified"`.
   - Grade `logQualityScore` (0 to 10) and `realWorkScore` (0 to 10). Cite specific visual evidence from photos or 720p demo clips when available.
   - Provide 1-2 `challengeQuestions` and a constructive 2-3 sentence `weeklyFeedback` for the student covering both their real project work and how to improve their weekly log quality.
5. Output speaker-attributed transcriptSegments[] with startTime ('MM:SS'), endTime ('MM:SS'), speaker (resolved student name or Supervisor), and text.
```

---

### Production Code 3: Stage 2 Deterministic Roster Reconciliation (`reconcileMeetingRosterResults`)

In Stage 2, **Gemini 4 Argon (`gemini-4-argon`)** or **Gemini 3.8 Flash (`gemini-3.8-flash`)** cross-examines the diarized transcript, the `720p` mobile demo videos, the snapped photos, and the students' written weekly logs. It evaluates whether a student's live demo and spoken answers **verified** or **contradicted** their written log (`genuine_verified`, `contradicted_in_meeting`, `suspected_ai_fake`, `vague_useless`, `inactive`) and assigns two separate marks out of 10:
- **`logQualityScore` (`/10`)**: Quality, specificity, and honesty of the written weekly logbook.
- **`realWorkScore` (`/10`)**: Verified engineering progress demonstrated live via the `720p` demo video, photos, and technical Q&A.

However, what if a 4-member group has a silent free-rider who never spoke a word during the meeting, causing the LLM to omit them from its output array? Or what if the supervisor manually tapped **`🗣️ Speaking Now`** for a student whose voice was too soft for the microphone?

In [`functions/ai_flows/projectMeetingFlows.js`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/functions/ai_flows/projectMeetingFlows.js), `reconcileMeetingRosterResults` deterministically reconciles the AI's JSON output against the authoritative `groupData.members` roster:

```javascript
// Source: functions/ai_flows/projectMeetingFlows.js
export function reconcileMeetingRosterResults({
  members = [],
  existingAttendance = [],
  aiAttendance = [],
  aiContributions = [],
  voiceAnchors = [],
  screenClips = [],
}) {
  // Maps existing manual overrides, AI attendance, and AI contributions by email/uid/name
  // ...
  const attendanceRecord = normalizedMembers.map((member) => {
    const email = (member.email || '').toLowerCase().trim();
    const uid = member.uid || email;
    const name = member.name || member.studentName || email;
    const existing = existingByKey.get(email) || existingByKey.get(uid.toLowerCase());
    const aiAtt = aiAttByKey.get(email) || aiAttByKey.get(uid.toLowerCase()) || aiAttByKey.get(name.toLowerCase()) || null;

    // Match 1-tap supervisor 'Speaking Now' voice anchors & demo clips for this student
    const studentAnchors = (Array.isArray(voiceAnchors) ? voiceAnchors : []).filter(
      (a) => (a.email && a.email.toLowerCase().trim() === email) || (a.studentUid && a.studentUid === uid)
    );
    const studentScreens = (Array.isArray(screenClips) ? screenClips : []).filter(
      (s) => (s.studentEmail && s.studentEmail.toLowerCase().trim() === email) || (s.studentUid && s.studentUid === uid)
    );

    const hasAnchorOrScreen = studentAnchors.length > 0 || studentScreens.length > 0;
    let status = aiAtt?.status || (hasAnchorOrScreen ? 'present' : 'absent');
    if (hasAnchorOrScreen && status === 'absent') {
      status = 'present'; // Supervisor voice anchor or demo clip overrides false-negative absence
    }

    let teacherVerified = false;
    if (existing && existing.teacherVerified) {
      status = existing.status || status; // Honor explicit teacher attendance badge override
      teacherVerified = true;
    } else if (studentAnchors.length > 0) {
      teacherVerified = true;
    }

    return {
      uid,
      email,
      name,
      role: member.role || 'Member',
      status,
      detectedByAi: Boolean(aiAtt?.status === 'present' || aiAtt?.status === 'late' || hasAnchorOrScreen),
      teacherVerified,
      speakingContribution: aiAtt?.speakingContribution || (hasAnchorOrScreen ? 'high' : status === 'present' ? 'moderate' : 'none'),
      evidence: aiAtt?.evidence || (status === 'present' ? 'Detected in meeting discussion.' : 'No spoken turn or demo detected.'),
    };
  });

  // Also normalizes studentContributions[], clamping logQualityScore & realWorkScore to [0, 10]
  return { attendanceRecord, studentContributions };
}
```

---

## 6. 1-Click Class-Wide HTML Email Dispatch & Longitudinal Student Portfolios

Once the supervisor reviews the generated report (or edits any score/feedback inline), clicking **`📧 Email All Week W Reports`** invokes `batchEmailProjectMeetingReports` in [`functions/ai_flows/projectMeetingFlows.js`](https://github.com/wongcyrus/Google-AI-Classroom/blob/main/functions/ai_flows/projectMeetingFlows.js).

Using SMTP credentials mounted strictly at runtime from **Google Cloud Secret Manager (`SMTP_PASSWORD`)**, the function formats a responsive, badge-styled HTML supervision report containing:
- An optional highlighted **👨‍🏫 Supervisor Note**,
- The **Executive Summary & Key Architectural Decisions**,
- The **Attendance & Speaking Contribution Table**,
- Each student's **Written Weekly Log vs. Live Verified Evaluation (`Log Quality /10`, `Real Work /10`, `Status Badge`, `Work Completed`, `Next Week Action Items`, and `Challenge Questions`)**,
- Dispatches the email simultaneously to all group members (`To`) and the supervisor (`Cc`), and writes an immutable `emailDispatch` audit timestamp onto the Firestore meeting document.

At any point during the semester, clicking **`🎓 Student Profiles & History`** opens the longitudinal **Student Project Portfolio View**, charting each student's attendance rate, average `Log Quality` vs. `Real Work` scores across Weeks 1–16, and flags chronic free-riders before final capstone grading!

---

## What's Next in Part 9?

In **Part 9**, we turn to live classroom engagement and formal assessment security—exploring how we engineered **Gamified "Classroom Bingo" Active Presence Verification** (backed by a **Gemini 4 Argon Question Bank Studio** and a **Non-Punitive Two-Strike Google Cloud Tasks State Machine**) alongside **Zero-Trust Exam Mode Lockdown** and **Court-Ready Microsoft Word (`.docx`) Incident Dossiers**.
