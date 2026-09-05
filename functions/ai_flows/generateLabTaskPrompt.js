import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import { CORS_ORIGINS, FUNCTION_REGION } from './config.js';
import { generateWithResilience } from './analysisFlows.js';

const db = getFirestore();

export const generateLabTaskPrompt = onCall(
  {
    region: FUNCTION_REGION,
    cors: CORS_ORIGINS,
    timeoutSeconds: 120,
    memory: '1GiB',
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const { jobId, model } = request.data || {};
    if (!jobId) {
      throw new HttpsError('invalid-argument', 'The function must be called with a "jobId".');
    }

    const masterJobRef = db.collection('videoAnalysisJobs').doc(jobId);
    const jobDoc = await masterJobRef.get();

    if (!jobDoc.exists) {
      throw new HttpsError('not-found', `Video analysis job with ID "${jobId}" was not found.`);
    }

    const jobData = jobDoc.data();
    const classId = jobData.classId || 'unknown_class';
    const aiJobIds = jobData.aiJobIds || [];

    let completedJobs = [];

    // Fetch child aiJobs via ID array or fallback query
    if (aiJobIds.length > 0) {
      for (let i = 0; i < aiJobIds.length; i += 30) {
        const batchIds = aiJobIds.slice(i, i + 30);
        const querySnapshot = await db
          .collection('aiJobs')
          .where(FieldPath.documentId(), 'in', batchIds)
          .get();

        querySnapshot.forEach((doc) => {
          const data = doc.data();
          if (data.status === 'completed' && data.result && typeof data.result === 'string' && data.result.trim()) {
            completedJobs.push(data);
          }
        });
      }
    } else {
      const querySnapshot = await db
        .collection('aiJobs')
        .where('masterJobId', '==', jobId)
        .where('status', '==', 'completed')
        .get();

      querySnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.result && typeof data.result === 'string' && data.result.trim()) {
          completedJobs.push(data);
        }
      });
    }

    if (completedJobs.length === 0) {
      throw new HttpsError(
        'failed-precondition',
        'No completed student video summaries were found for this job. Please wait until at least one video analysis has finished.'
      );
    }

    // Compile observations across all students
    const compiledObservations = completedJobs
      .map((job, idx) => {
        const studentIdentifier = job.studentEmail || job.studentUid || `Student ${idx + 1}`;
        return `### Student ${idx + 1}: ${studentIdentifier}\n${job.result.trim()}`;
      })
      .join('\n\n---\n\n');

    const metaPrompt = `You are an expert Computer Science university curriculum designer and AI prompt engineer for classroom invigilation and automated lab assessment.

Below are student activity observations collected from an initial video analysis across a class session (Class ID: "${classId}"):

=== BEGIN OBSERVED STUDENT ACTIVITIES ===
${compiledObservations}
=== END OBSERVED STUDENT ACTIVITIES ===

Based on these actual classroom observations, analyze the student activities and generate an optimized, comprehensive, ready-to-use Markdown task prompt for a high-precision second-pass evaluation of this lab.

The generated prompt MUST strictly follow this Markdown structure:

# [Descriptive Lab Title Based on Discovered Coursework]

**You are an AI teaching assistant evaluating student screen recording time-lapses for [Lab Topic/Subject].**

## Video Timing Rules
* The video is a fast-forward time-lapse with on-screen timestamps.
* All duration, attendance, and task timing calculations **MUST** be derived from the in-frame date/time stamps, NOT the video playback length.

## Coursework Tasks to Evaluate
[Break down the lab into 3-5 clearly numbered, specific tasks discovered from the student observations. Include specific platforms (e.g. AWS, Azure, Cloud Shell, VS Code), repositories, scripts, resource names, and milestones].

## Milestones, Scores & Rubrics
[Detail any test numbers, scoring points (e.g., 10 pts, 20 pts), or completion verifications discovered from the observations].

## Known Blockers & Technical Obstacles to Watch For
[List the common technical errors, blockers, or pitfalls students encountered, such as backend errors, incorrect regions, or setup issues].

## Required Tool Actions
1. **Working Time**: Call 'recordActualWorkingTime' with the total estimated active concentration minutes (clamped to lesson duration).
2. **Task Durations**: For each identified task above, call 'recordTaskDuration' with studentUid, classId, taskName, and estimated durationMinutes spent on that task.
3. **Student Summary**: Call 'recordLessonSummary' with a structured bulleted summary of their progress across each task, points earned, blockers encountered, and engagement verdict.
4. **Final Response**: Output the exact same structured summary text provided to 'recordLessonSummary'.

Return ONLY the clean Markdown prompt text. Do not wrap in markdown code fence blocks (\`\`\`markdown).`;

    const preferredModel = model || 'gemini-3.8-flash';
    const generateConfig = {
      prompt: [{ text: metaPrompt }],
      config: {
        temperature: 0.2,
      },
    };

    const { response, modelUsed } = await generateWithResilience(generateConfig, preferredModel);

    let generatedPrompt = response.text || '';
    // Strip accidental outer code fences if the model returned them
    if (generatedPrompt.startsWith('```markdown')) {
      generatedPrompt = generatedPrompt.replace(/^```markdown\s*/i, '').replace(/```\s*$/i, '');
    } else if (generatedPrompt.startsWith('```')) {
      generatedPrompt = generatedPrompt.replace(/^```\s*/, '').replace(/```\s*$/i, '');
    }

    return {
      generatedPrompt: generatedPrompt.trim(),
      modelUsed,
      summaryCount: completedJobs.length,
      classId,
      jobId,
    };
  }
);
