import './firebase.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { ai, vertexAI } from './ai.js';
import { z } from 'genkit';
import { AI_MODEL, FUNCTION_REGION } from './config.js';
import { generateWithResilience } from './analysisFlows.js';

const db = getFirestore();

/**
 * Question Bank Generator
 * Uses Gemini to generate N multiple-choice questions for a given topic/lesson.
 */
export async function generateBingoQuestionBank({ topic, count = 5 }) {
  const safeCount = Math.min(Math.max(Number(count) || 5, 1), 15);
  const prompt = `You are a computer science instructor preparing quick-check multiple choice questions for a lab/lecture.
Topic / Lesson Material: "${topic}".
Generate exactly ${safeCount} multiple-choice questions testing immediate comprehension.
Each question MUST have exactly 4 options and a correctIndex (0, 1, 2, or 3).
Keep questions concise, practical, and unambiguous.`;

  const { response } = await generateWithResilience({
    prompt,
    output: {
      schema: z.object({
        questions: z.array(
          z.object({
            question: z.string().describe('The question prompt'),
            options: z.array(z.string()).length(4).describe('4 multiple choice options'),
            correctIndex: z.number().min(0).max(3).describe('Index of the correct option (0-3)'),
          })
        ),
      }),
    },
  }, AI_MODEL);

  const output = response.output;
  if (!output || !Array.isArray(output.questions)) {
    throw new Error('Failed to generate valid question bank format from AI');
  }

  return { questions: output.questions };
}

/**
 * Sourced question resolver: Question Bank vs Teacher Screen vs Student Screen
 */
async function resolveBingoQuestion({
  classId,
  studentUid,
  questionSource = 'question_bank',
}) {
  // Mode 1: Predefined Question Bank (Zero AI cost, $0.00)
  if (questionSource === 'question_bank') {
    const classConfigDoc = await db.doc(`classes/${classId}/classProperties/config`).get();
    const configData = classConfigDoc.exists ? classConfigDoc.data() : {};
    let bank = Array.isArray(configData.bingoQuestionBank) ? configData.bingoQuestionBank : [];

    // Fallback: Also check root classes/{classId}.questionBank as documented in firestore-schema.md
    if (bank.length === 0) {
      const classDoc = await db.doc(`classes/${classId}`).get();
      if (classDoc.exists && Array.isArray(classDoc.data()?.questionBank)) {
        bank = classDoc.data().questionBank;
      }
    }

    if (bank.length > 0) {
      const selected = bank[Math.floor(Math.random() * bank.length)];
      return {
        question: selected.question,
        options: selected.options,
        correctIndex: selected.correctIndex,
        observedEvidence: 'Selected from class predefined question bank',
        questionSource: 'question_bank',
        bankQuestionId: selected.id || null,
        screenshotUrl: null,
      };
    }

    // Default fallback if bank is empty
    return {
      question: 'Quick presence check: Are you actively engaged in this lab session?',
      options: [
        'Yes, actively working on lab tasks',
        'Taking a short reading pause',
        'Need instructor assistance',
        'Just reviewing finished steps',
      ],
      correctIndex: 0,
      observedEvidence: 'Default active presence prompt',
      questionSource: 'question_bank',
      bankQuestionId: 'default_presence',
      screenshotUrl: null,
    };
  }

  // Mode 2: Teacher Screen (1 single AI call for whole class broadcast)
  if (questionSource === 'teacher_screen') {
    try {
      const liveFrameDoc = await db.doc(`classes/${classId}/screenBroadcast/liveFrame`).get();
      const liveFrameData = liveFrameDoc.exists ? liveFrameDoc.data() : null;
      const frameUrl = liveFrameData?.frameData;

      if (frameUrl && typeof frameUrl === 'string' && frameUrl.startsWith('data:image')) {
        const prompt = [
          {
            text: `You are an invigilator verifying student attention during a live lecture/explanation.
Analyze the instructor's shared screen image.
Formulate a 4-option multiple-choice question testing if a student was watching the instructor's screen explanation.
ONE option MUST be the true detail visibly on the instructor's screen (such as open file, code snippet/keyword, slide title, or active tool).
THREE options MUST be plausible but incorrect distractors.
Respond with JSON matching the schema.`,
          },
          { media: { url: frameUrl, contentType: 'image/jpeg' } },
        ];

        const { response } = await generateWithResilience({
          prompt,
          output: {
            schema: z.object({
              question: z.string(),
              options: z.array(z.string()).length(4),
              correctIndex: z.number().min(0).max(3),
              observedEvidence: z.string(),
            }),
          },
        }, AI_MODEL);

        if (response.output) {
          return {
            ...response.output,
            questionSource: 'teacher_screen',
            screenshotUrl: null,
          };
        }
      }
    } catch (err) {
      console.warn('[resolveBingoQuestion] Teacher screen generation fallback:', err);
    }

    // Fallback to question bank if teacher frame unavailable
    return resolveBingoQuestion({ classId, studentUid, questionSource: 'question_bank' });
  }

  // Mode 3: Student Screen (Inspect individual student's latest screen capture)
  if (questionSource === 'student_screen' && studentUid) {
    try {
      // Check livePeeks first for ultra-fresh thumbnail, else recent screenshots collection
      let screenshotUrl = null;
      const livePeekDoc = await db.doc(`classes/${classId}/livePeeks/${studentUid}`).get();
      if (livePeekDoc.exists && livePeekDoc.data()?.screenshotUrl) {
        screenshotUrl = livePeekDoc.data().screenshotUrl;
      } else {
        const snap = await db.collection('screenshots')
          .where('classId', '==', classId)
          .where('studentUid', '==', studentUid)
          .orderBy('timestamp', 'desc')
          .limit(1)
          .get();
        if (!snap.empty) {
          screenshotUrl = snap.docs[0].data()?.screenshotUrl;
        }
      }

      if (screenshotUrl) {
        const prompt = [
          {
            text: `You are a classroom invigilator checking student presence in a computer lab.
Analyze this student's computer screen screenshot.
Formulate a 4-option multiple choice question testing immediate awareness of their screen state (e.g. active editor file, command in terminal, running app, or video title).
ONE option MUST be the true visible detail.
THREE options MUST be plausible distractors.`,
          },
          { media: { url: screenshotUrl, contentType: 'image/jpeg' } },
        ];

        const { response } = await generateWithResilience({
          prompt,
          output: {
            schema: z.object({
              question: z.string(),
              options: z.array(z.string()).length(4),
              correctIndex: z.number().min(0).max(3),
              observedEvidence: z.string(),
            }),
          },
        }, AI_MODEL);

        if (response.output) {
          return {
            ...response.output,
            questionSource: 'student_screen',
            screenshotUrl,
          };
        }
      }
    } catch (err) {
      console.warn('[resolveBingoQuestion] Student screen generation fallback:', err);
    }

    // Fallback to question bank
    return resolveBingoQuestion({ classId, studentUid, questionSource: 'question_bank' });
  }

  return resolveBingoQuestion({ classId, studentUid, questionSource: 'question_bank' });
}

/**
 * Generate and Dispatch a Bingo Challenge
 */
export async function generateBingoChallenge({
  classId,
  targetStudentUid = 'all',
  questionSource = 'question_bank',
  triggerType = 'teacher_manual_all',
  timeLimitSeconds = 45,
  strikeNumber = 1,
  priorBingoId = null,
}) {
  if (!classId) {
    throw new Error('classId is required');
  }

  const classDoc = await db.doc(`classes/${classId}`).get();
  if (!classDoc.exists) {
    throw new Error(`Class ${classId} not found`);
  }
  const classData = classDoc.data() || {};
  const studentsMap = classData.students || {};

  // Resolve target students
  let targetUids = [];
  if (targetStudentUid && targetStudentUid !== 'all') {
    targetUids = [targetStudentUid];
  } else {
    // If 'all', target students in active class status or enrolled
    const statusSnap = await db.collection(`classes/${classId}/status`).get();
    const activeUids = new Set();
    statusSnap.forEach(doc => {
      const data = doc.data() || {};
      if (data.isCapturing || data.isSharing || (Array.isArray(data.activeStreams) && data.activeStreams.length > 0)) {
        activeUids.add(doc.id);
      }
    });

    if (activeUids.size > 0) {
      targetUids = Array.from(activeUids);
    } else {
      targetUids = Object.keys(studentsMap);
    }
  }

  if (targetUids.length === 0) {
    return { success: false, message: 'No target students found' };
  }

  // If questionSource is 'teacher_screen' or 'question_bank', generate question ONCE for all targets!
  let sharedQuestionData = null;
  if (questionSource !== 'student_screen') {
    sharedQuestionData = await resolveBingoQuestion({
      classId,
      studentUid: targetUids[0],
      questionSource,
    });
  }

  const recordsCreated = [];

  for (const studentUid of targetUids) {
    const studentEmail = (studentsMap[studentUid] || '').toLowerCase();

    // If student screen mode, generate individually
    const qData = sharedQuestionData || await resolveBingoQuestion({
      classId,
      studentUid,
      questionSource,
    });

    const studentIssuedAtMillis = Date.now();
    const studentExpiresAtMillis = studentIssuedAtMillis + (timeLimitSeconds * 1000);

    const bingoRef = db.collection(`classes/${classId}/bingoRecords`).doc();
    const bingoRecord = {
      id: bingoRef.id,
      classId,
      studentUid,
      studentEmail,
      question: qData.question,
      options: qData.options,
      correctIndex: qData.correctIndex, // Saved on server only
      selectedIndex: null,
      selectedOptionText: null,
      result: 'pending',
      responseTimeSec: null,
      questionSource: qData.questionSource,
      bankQuestionId: qData.bankQuestionId || null,
      screenshotUrl: qData.screenshotUrl || null,
      observedEvidence: qData.observedEvidence || '',
      triggerType,
      strikeNumber: Number(strikeNumber) || 1,
      priorBingoId: priorBingoId || null,
      issuedAt: FieldValue.serverTimestamp(),
      issuedAtMillis: studentIssuedAtMillis,
      expiresAtMillis: studentExpiresAtMillis,
      timeLimitSeconds,
    };

    await bingoRef.set(bingoRecord);

    // Write activeBingo to studentProperties (omit correctIndex to prevent inspection)
    const studentPropsRef = db.doc(`classes/${classId}/studentProperties/${studentUid}`);
    await studentPropsRef.set({
      activeBingo: {
        bingoId: bingoRef.id,
        question: qData.question,
        options: qData.options,
        timeLimitSeconds,
        issuedAtMillis: studentIssuedAtMillis,
        expiresAtMillis: studentExpiresAtMillis,
        status: 'pending',
        strikeNumber: Number(strikeNumber) || 1,
        questionSource: qData.questionSource,
        priorBingoId: priorBingoId || null,
      },
      lastBingoIssuedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    recordsCreated.push(bingoRef.id);
  }

  return {
    success: true,
    createdCount: recordsCreated.length,
    bingoIds: recordsCreated,
    question: sharedQuestionData?.question || 'Multiple custom questions generated',
  };
}

/**
 * Submit and Grade a Bingo Response
 */
export async function submitBingoResponse({
  classId,
  studentUid,
  bingoId,
  selectedIndex = null,
  responseTimeSec = null,
  windowFocused = true,
}) {
  if (!classId || !studentUid || !bingoId) {
    throw new Error('classId, studentUid, and bingoId are required');
  }

  const bingoDocRef = db.doc(`classes/${classId}/bingoRecords/${bingoId}`);
  const bingoDoc = await bingoDocRef.get();

  if (!bingoDoc.exists) {
    throw new Error(`Bingo record ${bingoId} not found`);
  }

  const record = bingoDoc.data();
  if (record.result !== 'pending') {
    return { success: true, alreadySubmitted: true, result: record.result };
  }

  const isTimeout = selectedIndex === null || selectedIndex === undefined;
  const isCorrect = !isTimeout && Number(selectedIndex) === record.correctIndex;
  
  let result = 'failed_incorrect';
  if (isCorrect) {
    result = 'passed';
  } else if (isTimeout) {
    result = 'missed_timeout';
  }

  const selectedOptionText = !isTimeout && Array.isArray(record.options)
    ? record.options[Number(selectedIndex)] || null
    : null;

  const actualLatency = responseTimeSec !== null
    ? Math.max(0.1, Number(responseTimeSec))
    : (isTimeout ? record.timeLimitSeconds : null);

  const classDoc = await db.doc(`classes/${classId}`).get();
  const classData = classDoc.exists ? (classDoc.data() || {}) : {};
  const retryDelayMinutes = Math.min(15, Math.max(1, Number(classData.bingoRetryDelayMinutes) || 3));
  const retryDelaySeconds = retryDelayMinutes * 60;

  // 1. Update the permanent bingoRecord
  await bingoDocRef.update({
    selectedIndex: isTimeout ? null : Number(selectedIndex),
    selectedOptionText,
    result,
    responseTimeSec: actualLatency,
    windowFocused: Boolean(windowFocused),
    answeredAt: FieldValue.serverTimestamp(),
  });

  // 2. Update student properties status and stats
  const studentPropsRef = db.doc(`classes/${classId}/studentProperties/${studentUid}`);
  const studentPropsDoc = await studentPropsRef.get();
  const prevStats = studentPropsDoc.exists ? (studentPropsDoc.data()?.bingoStats || {}) : {};

  const newStats = {
    total: (prevStats.total || 0) + 1,
    passed: (prevStats.passed || 0) + (result === 'passed' ? 1 : 0),
    failed: (prevStats.failed || 0) + (result !== 'passed' ? 1 : 0),
    lastResult: result,
  };

  const existingActiveBingo = (studentPropsDoc.exists && studentPropsDoc.data()?.activeBingo) || {};

  const updatePayload = {
    activeBingo: {
      ...existingActiveBingo,
      status: result,
      result: result,
      responseTimeSec: actualLatency,
    },
    bingoStats: newStats,
  };

  // 3. Handle Two-Strike Attendance Protocol & Irregularities
  if (result === 'passed') {
    // Clear any pending strikes upon success
    updatePayload.strikeNumber = 0;
    updatePayload.pendingRetryBingo = false;
  } else if (result === 'failed_incorrect') {
    // Student was present at desk, answered wrong. Do NOT dock attendance.
    updatePayload.lastInattentiveAt = FieldValue.serverTimestamp();
  } else if (result === 'missed_timeout') {
    // Student completely missed/ignored the 45s timer
    const currentStrike = Number(record.strikeNumber) || 1;

    if (currentStrike === 1) {
      // Strike 1: Schedule follow-up retry in configured delayMinutes (default: 3 mins)
      updatePayload.pendingRetryBingo = true;
      updatePayload.retryBingoScheduledAtMillis = Date.now() + (retryDelaySeconds * 1000);
      updatePayload.priorMissedBingoId = bingoId;
      updatePayload.retryDelayMinutes = retryDelayMinutes;

      // Enqueue to Google Cloud Tasks for serverless event-driven execution
      await enqueueBingoRetryTask({
        classId,
        studentUid,
        priorBingoId: bingoId,
        delaySeconds: retryDelaySeconds,
      });

      // Log Strike 1 proctoring irregularity
      await db.collection(`classes/${classId}/irregularities`).add({
        classId,
        studentUid,
        type: 'bingo',
        riskLevel: 'medium',
        title: 'Bingo Check Missed (Strike 1)',
        description: `Student failed to respond to active presence check within ${record.timeLimitSeconds}s. Follow-up verification scheduled in ${retryDelayMinutes}m.`,
        bingoId,
        question: record.question,
        timestamp: FieldValue.serverTimestamp(),
      });
    } else if (currentStrike >= 2) {
      // Strike 2 Confirmed Absence! Apply attendance deduction!
      updatePayload.pendingRetryBingo = false;
      const priorBingoId = record.priorBingoId;
      let startMillis = record.issuedAtMillis - (retryDelaySeconds * 1000);

      if (priorBingoId) {
        const priorDoc = await db.doc(`classes/${classId}/bingoRecords/${priorBingoId}`).get();
        if (priorDoc.exists && priorDoc.data()?.issuedAtMillis) {
          startMillis = priorDoc.data().issuedAtMillis;
        }
      }

      const endMillis = Date.now();
      const deductedMinutes = Math.max(1, Math.round((endMillis - startMillis) / 60000));

      // Record attendance adjustment
      await db.collection(`classes/${classId}/attendanceAdjustments`).add({
        classId,
        studentUid,
        startTime: new Date(startMillis),
        endTime: new Date(endMillis),
        startMillis,
        endMillis,
        deductedMinutes,
        voidedMinutesCount: deductedMinutes,
        reason: `Missed 2 consecutive Bingo checks (AFK/Decoy)`,
        check1Id: priorBingoId || 'strike_1',
        check2Id: bingoId,
        strike1BingoId: priorBingoId || 'strike_1',
        strike2BingoId: bingoId,
        createdAt: FieldValue.serverTimestamp(),
        appliedAt: FieldValue.serverTimestamp(),
      });

      // Log high-risk confirmed irregularity
      await db.collection(`classes/${classId}/irregularities`).add({
        classId,
        studentUid,
        type: 'bingo',
        riskLevel: 'high',
        title: '⚠️ Confirmed Absence: Missed Consecutive Bingo Checks (Attendance Deducted)',
        description: `Student failed 2 consecutive Bingo presence checks. Deducted ${deductedMinutes} minutes of unverified attendance.`,
        bingoId,
        priorBingoId,
        deductedMinutes,
        timestamp: FieldValue.serverTimestamp(),
      });
    }
  }

  await studentPropsRef.set(updatePayload, { merge: true });

  return {
    success: true,
    result,
    isCorrect,
    correctIndex: record.correctIndex,
  };
}

/**
 * Enqueue a Strike 2 retry challenge to Google Cloud Tasks
 */
export async function enqueueBingoRetryTask({ classId, studentUid, priorBingoId, delaySeconds = 180 }) {
  try {
    const queue = getFunctions().taskQueue(`locations/${FUNCTION_REGION}/functions/dispatchBingoRetryTask`);
    const sanitizedTaskId = `retry-${classId}-${studentUid}-${priorBingoId}`
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 100);

    await queue.enqueue(
      { classId, studentUid, priorBingoId },
      {
        scheduleDelaySeconds: Math.max(15, delaySeconds),
        id: sanitizedTaskId,
      }
    );
    console.log(`[enqueueBingoRetryTask] Successfully enqueued Strike 2 task for student ${studentUid} in ${delaySeconds}s`);
    return { success: true, taskId: sanitizedTaskId };
  } catch (err) {
    console.warn(`[enqueueBingoRetryTask] Task queue enqueue warning/skipped:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Handler for dispatchBingoRetryTask (called by Cloud Tasks queue worker)
 */
export async function handleDispatchBingoRetry({ classId, studentUid, priorBingoId }) {
  if (!classId || !studentUid) {
    console.warn('[handleDispatchBingoRetry] Missing classId or studentUid. Skipping.');
    return { skipped: true, reason: 'missing_arguments' };
  }

  // Pre-flight check: Verify class and student enrollment
  const classDoc = await db.doc(`classes/${classId}`).get();
  if (!classDoc.exists) {
    console.warn(`[handleDispatchBingoRetry] Class ${classId} no longer exists.`);
    return { skipped: true, reason: 'class_not_found' };
  }

  const classData = classDoc.data() || {};
  if (!classData.students || !classData.students[studentUid]) {
    console.warn(`[handleDispatchBingoRetry] Student ${studentUid} not enrolled in class ${classId}.`);
    return { skipped: true, reason: 'student_not_enrolled' };
  }

  // Check student properties
  const studentPropsRef = db.doc(`classes/${classId}/studentProperties/${studentUid}`);
  const studentPropsDoc = await studentPropsRef.get();
  if (!studentPropsDoc.exists) {
    console.warn(`[handleDispatchBingoRetry] studentProperties for ${studentUid} not found.`);
    return { skipped: true, reason: 'properties_not_found' };
  }

  const studentData = studentPropsDoc.data() || {};

  // If the student is no longer pending retry (e.g. they already responded or got cleared), skip!
  if (!studentData.pendingRetryBingo) {
    console.log(`[handleDispatchBingoRetry] Student ${studentUid} pendingRetryBingo is false. Skipping.`);
    return { skipped: true, reason: 'already_cleared' };
  }

  // If the priorMissedBingoId does not match this task, skip!
  if (studentData.priorMissedBingoId && studentData.priorMissedBingoId !== priorBingoId) {
    console.log(`[handleDispatchBingoRetry] Mismatched priorMissedBingoId. Skipping.`);
    return { skipped: true, reason: 'mismatched_prior_id' };
  }

  // Dispatch Strike 2 Challenge
  console.log(`[handleDispatchBingoRetry] Dispatching Strike 2 challenge for student ${studentUid} in class ${classId}`);
  const result = await generateBingoChallenge({
    classId,
    targetStudentUid: studentUid,
    questionSource: 'question_bank', // Standardized pool for retry
    triggerType: 'scheduled_strike_retry',
    strikeNumber: 2,
    priorBingoId,
  });

  // Mark pendingRetryBingo false now that strike 2 has been dispatched
  await studentPropsRef.set({
    pendingRetryBingo: false,
    lastRetryDispatchedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { success: true, result };
}

/**
 * Enqueue a periodic staggered Bingo task to Google Cloud Tasks
 */
export async function enqueueScheduledBingoTask({ classId, studentUid, questionSource = 'question_bank', delaySeconds = 0 }) {
  try {
    const queue = getFunctions().taskQueue(`locations/${FUNCTION_REGION}/functions/dispatchScheduledBingoTask`);
    const sanitizedTaskId = `auto-${classId}-${studentUid}-${Date.now()}`
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 100);

    await queue.enqueue(
      { classId, studentUid, questionSource },
      {
        scheduleDelaySeconds: Math.max(0, delaySeconds),
        id: sanitizedTaskId,
      }
    );
    console.log(`[enqueueScheduledBingoTask] Enqueued scheduled Bingo for student ${studentUid} in ${delaySeconds}s`);
    return { success: true, taskId: sanitizedTaskId };
  } catch (err) {
    console.warn(`[enqueueScheduledBingoTask] Task queue enqueue warning/skipped:`, err.message);
    return { success: false, error: err.message };
  }
}

// Helper to get local time, day, and date in a specific timezone
export function getLocalTimeAndDay(date, timeZone) {
  const options = {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(date);

  const localTime = parts.find(p => p.type === 'hour').value + ':' + parts.find(p => p.type === 'minute').value;
  const localDay = parts.find(p => p.type === 'weekday').value;
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  const localDate = year && month && day ? `${year}-${month}-${day}` : '';

  return { localTime, localDay, localDate };
}

/**
 * Evaluates whether a class session is currently active across 3 operational cases:
 *  - Case 1: Scheduled class with active capture (isCapturing === true AND within schedule). Stops when slot ends.
 *  - Case 2: Manual capture class without schedule (isCapturing === true and < 3 hours). Stops when isCapturing === false.
 *  - Case 3: Scheduled class without capture (isCapturing === false, mode === 'question_bank', within schedule slot). Stops when slot ends.
 */
export function isClassSessionActive(classData, now = new Date()) {
  if (!classData) return false;

  const { isCapturing, schedule, autoBingoMode, captureStartedAt } = classData;

  // Case 1 & 2: Capturing is explicitly true
  if (isCapturing) {
    if (schedule && schedule.timeZone && Array.isArray(schedule.timeSlots) && schedule.timeSlots.length > 0) {
      try {
        const { localTime, localDay, localDate } = getLocalTimeAndDay(now, schedule.timeZone);

        if (schedule.startDate && schedule.endDate) {
          if (localDate < schedule.startDate || localDate > schedule.endDate) {
            return false;
          }
        }

        const activeSlot = schedule.timeSlots.find(slot => {
          if (!slot.days || !slot.days.includes(localDay)) return false;
          if (slot.startTime > slot.endTime) {
            return localTime >= slot.startTime || localTime <= slot.endTime;
          }
          return localTime >= slot.startTime && localTime <= slot.endTime;
        });

        return Boolean(activeSlot);
      } catch {
        return false;
      }
    }

    if (captureStartedAt) {
      const startedMillis = captureStartedAt.toMillis ? captureStartedAt.toMillis() : new Date(captureStartedAt).getTime();
      if ((now.getTime() - startedMillis) > 3 * 60 * 60 * 1000) {
        return false;
      }
    }
    return true;
  }

  // Case 3: Capturing is false, but class is schedule-driven with question_bank mode
  if (!isCapturing && (autoBingoMode === 'question_bank' || !autoBingoMode)) {
    if (schedule && schedule.timeZone && Array.isArray(schedule.timeSlots) && schedule.timeSlots.length > 0) {
      try {
        const { localTime, localDay, localDate } = getLocalTimeAndDay(now, schedule.timeZone);

        if (schedule.startDate && schedule.endDate) {
          if (localDate < schedule.startDate || localDate > schedule.endDate) {
            return false;
          }
        }

        const activeSlot = schedule.timeSlots.find(slot => {
          if (!slot.days || !slot.days.includes(localDay)) return false;
          if (slot.startTime > slot.endTime) {
            return localTime >= slot.startTime || localTime < slot.endTime;
          }
          return localTime >= slot.startTime && localTime < slot.endTime;
        });

        return Boolean(activeSlot);
      } catch {
        return false;
      }
    }
  }

  return false;
}

/**
 * Worker for dispatchScheduledBingoTask (called by Cloud Tasks queue worker)
 */
export async function handleDispatchScheduledBingo({ classId, studentUid, questionSource = 'question_bank' }) {
  if (!classId || !studentUid) {
    console.warn('[handleDispatchScheduledBingo] Missing classId or studentUid. Skipping.');
    return { skipped: true, reason: 'missing_arguments' };
  }

  // Pre-flight check: Verify class exists and session is actively ongoing
  const classDoc = await db.doc(`classes/${classId}`).get();
  if (!classDoc.exists) {
    console.warn(`[handleDispatchScheduledBingo] Class ${classId} no longer exists.`);
    return { skipped: true, reason: 'class_not_found' };
  }

  const classData = classDoc.data() || {};
  if (!isClassSessionActive(classData)) {
    console.log(`[handleDispatchScheduledBingo] Class ${classId} session has ended or is not active (evaluated across 3 cases). Skipping scheduled task.`);
    return { skipped: true, reason: 'class_session_ended' };
  }

  if (!classData.students || !classData.students[studentUid]) {
    console.warn(`[handleDispatchScheduledBingo] Student ${studentUid} not enrolled in class ${classId}.`);
    return { skipped: true, reason: 'student_not_enrolled' };
  }

  console.log(`[handleDispatchScheduledBingo] Dispatching periodic Bingo challenge to ${studentUid} in ${classId}`);
  const result = await generateBingoChallenge({
    classId,
    targetStudentUid: studentUid,
    questionSource,
    triggerType: 'automated_periodic_staggered',
  });

  return { success: true, result };
}

/**
 * Process a bingoJob created by handleAutomaticBingo
 */
export async function handleProcessBingoJob({ jobId, classId, mode = 'question_bank', jitterMinutes = 3 }) {
  if (!classId) {
    console.warn('[handleProcessBingoJob] Missing classId.');
    return { skipped: true, reason: 'missing_class_id' };
  }

  const classDoc = await db.doc(`classes/${classId}`).get();
  if (!classDoc.exists) {
    console.warn(`[handleProcessBingoJob] Class ${classId} does not exist.`);
    return { skipped: true, reason: 'class_not_found' };
  }

  const classData = classDoc.data() || {};
  if (!isClassSessionActive(classData)) {
    console.log(`[handleProcessBingoJob] Class ${classId} session has ended or is not active. Skipping job.`);
    if (jobId) {
      await db.doc(`bingoJobs/${jobId}`).update({ status: 'skipped_session_ended', completedAt: FieldValue.serverTimestamp() });
    }
    return { skipped: true, reason: 'class_session_ended' };
  }

  const studentsMap = classData.students || {};
  // Check active student status first
  const statusSnap = await db.collection(`classes/${classId}/status`).get();
  const activeUids = new Set();
  statusSnap.forEach(doc => {
    if (doc.data()?.isCapturing) activeUids.add(doc.id);
  });

  let targetUids = activeUids.size > 0 ? Array.from(activeUids) : Object.keys(studentsMap);
  if (targetUids.length === 0) {
    console.log(`[handleProcessBingoJob] No students enrolled or active for class ${classId}.`);
    if (jobId) {
      await db.doc(`bingoJobs/${jobId}`).update({ status: 'completed', totalStudentsTargeted: 0, completedAt: FieldValue.serverTimestamp() });
    }
    return { success: true, totalStudentsTargeted: 0 };
  }

  const maxJitterSeconds = Math.max(0, Number(jitterMinutes) || 0) * 60;

  if (maxJitterSeconds === 0) {
    // Simultaneous dispatch for all students
    const challengeRes = await generateBingoChallenge({
      classId,
      targetStudentUid: 'all',
      questionSource: mode,
      triggerType: 'automated_periodic',
    });

    if (jobId) {
      await db.doc(`bingoJobs/${jobId}`).update({
        status: 'completed',
        totalStudentsTargeted: targetUids.length,
        completedAt: FieldValue.serverTimestamp(),
      });
    }

    return { success: true, challengeRes, totalStudentsTargeted: targetUids.length };
  }

  // Staggered delivery with anti-collusion jitter via Cloud Tasks
  const enqueuePromises = targetUids.map(studentUid => {
    const delaySeconds = Math.floor(Math.random() * maxJitterSeconds);
    return enqueueScheduledBingoTask({
      classId,
      studentUid,
      questionSource: mode,
      delaySeconds,
    });
  });

  await Promise.all(enqueuePromises);

  if (jobId) {
    await db.doc(`bingoJobs/${jobId}`).update({
      status: 'enqueued',
      totalStudentsTargeted: targetUids.length,
      completedAt: FieldValue.serverTimestamp(),
    });
  }

  return { success: true, enqueuedCount: targetUids.length };
}

