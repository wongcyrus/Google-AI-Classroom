import './firebase.js';
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { ai, vertexAI } from './ai.js';
import { z } from 'genkit';
import { AI_MODEL, FUNCTION_REGION } from './config.js';
import { generateWithResilience } from './analysisFlows.js';
import { logJob } from './jobLogger.js';
import { calculateCost } from './cost.js';

const db = getFirestore();

/**
 * Question Bank Generator
 * Uses Gemini to generate N multiple-choice questions for a given topic/lesson.
 */
export async function generateBingoQuestionBank({ topic, count = 5, customPrompt = null, classId = null }) {
  const safeCount = Math.min(Math.max(Number(count) || 5, 1), 15);
  let prompt = customPrompt;
  if (prompt) {
    prompt = prompt
      .replace(/\{\{topic\}\}/g, topic || '')
      .replace(/\{\{count\}\}/g, String(safeCount));
  } else {
    prompt = `You are a computer science instructor preparing quick-check multiple choice questions for a lab/lecture.
Topic / Lesson Material: "${topic}".
Generate exactly ${safeCount} multiple-choice questions testing immediate comprehension.
Each question MUST have exactly 4 options and a correctIndex (0, 1, 2, or 3).
Keep questions concise, practical, and unambiguous.`;
  }

  const { response, modelUsed } = await generateWithResilience({
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

  const usage = response?.usage || response?.usageMetadata || {};
  const cost = calculateCost(usage, modelUsed || AI_MODEL);
  if (classId) {
    try {
      await logJob({
        classId,
        jobType: 'generateBingoQuestionBank',
        status: 'completed',
        promptText: prompt,
        mediaPaths: [],
        usage: {
          inputTokens: usage.inputTokens ?? usage.promptTokenCount ?? 0,
          outputTokens: usage.outputTokens ?? usage.candidatesTokenCount ?? 0,
        },
        cost,
        modelUsed: modelUsed || AI_MODEL,
        result: `Generated ${output.questions.length} bingo questions on "${topic}"`,
      });
    } catch (logErr) {
      console.warn('[generateBingoQuestionBank] Failed to log AI job:', logErr);
    }
  }

  const shuffledQuestions = output.questions.map((q) => {
    const { options, correctIndex } = shuffleOptionsAndCorrectIndex(q.options, q.correctIndex);
    return {
      ...q,
      options,
      correctIndex,
    };
  });

  return { questions: shuffledQuestions };
}

/**
 * Randomly shuffles options and updates correctIndex accordingly,
 * eliminating LLM positional bias (e.g. LLM always outputting the correct answer at option A).
 */
export function shuffleOptionsAndCorrectIndex(options, correctIndex) {
  if (!Array.isArray(options) || options.length <= 1) {
    return {
      options: options || [],
      correctIndex: typeof correctIndex === 'number' ? correctIndex : 0,
    };
  }

  const safeCorrectIndex = (typeof correctIndex === 'number' && correctIndex >= 0 && correctIndex < options.length)
    ? correctIndex
    : 0;

  // Track original correct item
  const items = options.map((opt, idx) => ({
    text: opt,
    isCorrect: idx === safeCorrectIndex,
  }));

  // Fisher-Yates shuffle
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }

  const shuffledOptions = items.map(item => item.text);
  const newCorrectIndex = items.findIndex(item => item.isCorrect);

  return {
    options: shuffledOptions,
    correctIndex: newCorrectIndex >= 0 ? newCorrectIndex : 0,
  };
}

/**
 * Detects exact or high lexical similarity between a candidate question and prior questions
 */
export function isDuplicateQuestion(candidateQuestion, priorQuestions) {
  if (!candidateQuestion || !Array.isArray(priorQuestions) || priorQuestions.length === 0) {
    return false;
  }
  const normCandidate = candidateQuestion.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
  const wordsCandidate = normCandidate.split(/\s+/).filter(w => w.length > 2);
  const setCandidate = new Set(wordsCandidate);

  for (const prior of priorQuestions) {
    if (!prior || typeof prior !== 'string') continue;
    const normPrior = prior.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
    if (normCandidate === normPrior) return true;

    const wordsPrior = normPrior.split(/\s+/).filter(w => w.length > 2);
    const setPrior = new Set(wordsPrior);
    if (setCandidate.size > 0 && setPrior.size > 0) {
      let intersection = 0;
      for (const w of setCandidate) {
        if (setPrior.has(w)) intersection++;
      }
      const similarity = intersection / Math.max(setCandidate.size, setPrior.size);
      if (similarity >= 0.80) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Sourced question resolver: Question Bank vs Teacher Screen vs Student Screen
 */
export async function resolveBingoQuestion({
  classId,
  studentUid,
  questionSource = 'question_bank',
}) {
  const classDoc = await db.doc(`classes/${classId}`).get();
  const classData = classDoc.exists ? (classDoc.data() || {}) : {};
  const customBingoPrompt = classData.bingoPrompt?.promptText || null;

  // Mode 1: Predefined Question Bank (Zero AI cost, $0.00)
  if (questionSource === 'question_bank') {
    const classConfigDoc = await db.doc(`classes/${classId}/classProperties/config`).get();
    const configData = classConfigDoc.exists ? classConfigDoc.data() : {};
    let bank = Array.isArray(configData.bingoQuestionBank) ? configData.bingoQuestionBank : [];

    // Fallback: Also check root classes/{classId}.questionBank as documented in firestore-schema.md
    if (bank.length === 0) {
      if (Array.isArray(classData.questionBank)) {
        bank = classData.questionBank;
      }
    }

    if (bank.length > 0) {
      const selected = bank[Math.floor(Math.random() * bank.length)];
      const { options: shuffledOptions, correctIndex: shuffledCorrectIndex } = shuffleOptionsAndCorrectIndex(
        selected.options,
        selected.correctIndex
      );
      return {
        question: selected.question,
        options: shuffledOptions,
        correctIndex: shuffledCorrectIndex,
        observedEvidence: 'Selected from class predefined question bank',
        questionSource: 'question_bank',
        bankQuestionId: selected.id || null,
        screenshotUrl: null,
      };
    }

    // Dynamic fallback if bank is empty: check if teacher is broadcasting screen
    try {
      const liveFrameDoc = await db.doc(`classes/${classId}/screenBroadcast/liveFrame`).get();
      if (liveFrameDoc.exists && liveFrameDoc.data()?.frameData) {
        console.log(`[resolveBingoQuestion] Question bank is empty for class ${classId}. Using live teacher screen.`);
        return await resolveBingoQuestion({ classId, studentUid, questionSource: 'teacher_screen' });
      }
    } catch (e) {
      console.warn(`[resolveBingoQuestion] Error checking screen broadcast on empty bank:`, e);
    }

    // Default fallback if bank is empty and no screen is broadcasting
    const { options: presenceOptions, correctIndex: presenceCorrectIndex } = shuffleOptionsAndCorrectIndex(
      [
        'Yes, actively working on lab tasks',
        'Taking a short reading pause',
        'Need instructor assistance',
        'Just reviewing finished steps',
      ],
      0
    );
    return {
      question: 'Quick presence check: Are you actively engaged in this lab session?',
      options: presenceOptions,
      correctIndex: presenceCorrectIndex,
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
        // Fetch recent teacher live subtitles / speech captions if available
        let captionContext = '';
        try {
          const subDoc = await db.doc(`classes/${classId}/liveSubtitles/current`).get();
          if (subDoc.exists) {
            const subData = subDoc.data() || {};
            const subTime = subData.timestamp?.toMillis
              ? subData.timestamp.toMillis()
              : (subData.timestamp?.toDate ? subData.timestamp.toDate().getTime() : new Date(subData.timestamp).getTime());
            const ageMs = Date.now() - subTime;
            // Freshness window: include captions if spoken within the last 5 minutes (300,000 ms)
            if (!isNaN(ageMs) && ageMs <= 5 * 60 * 1000) {
              const lines = [];
              if (Array.isArray(subData.recentHistory)) {
                for (const entry of subData.recentHistory) {
                  const text = entry?.originalText || entry?.text;
                  if (text && !lines.includes(text)) {
                    lines.push(text);
                  }
                }
              }
              if (subData.originalText && !lines.includes(subData.originalText)) {
                lines.push(subData.originalText);
              }
              if (lines.length > 0) {
                captionContext = lines.join(' | ');
              }
            }
          }
        } catch (subErr) {
          console.warn(`[resolveBingoQuestion] Note: could not load live subtitles:`, subErr);
        }

        let promptText = customBingoPrompt;
        if (!promptText) {
          if (captionContext) {
            promptText = `You are an invigilator verifying student attention during a live lecture/explanation.
Analyze the instructor's shared screen image alongside their recent spoken commentary/captions:
Recent Instructor Spoken Commentary: "${captionContext}"

Formulate a 4-option multiple-choice question testing whether a student was actively following the instructor's lecture explanation.
The question can reference what the instructor just explained verbally, key details visible on the shared screen, or the connection between them.
ONE option MUST be the true detail from the screen or verbal explanation.
THREE options MUST be plausible but incorrect distractors.
Respond with JSON matching the schema.`;
          } else {
            promptText = `You are an invigilator verifying student attention during a live lecture/explanation.
Analyze the instructor's shared screen image.
Formulate a 4-option multiple-choice question testing if a student was watching the instructor's screen explanation.
ONE option MUST be the true detail visibly on the instructor's screen (such as open file, code snippet/keyword, slide title, or active tool).
THREE options MUST be plausible but incorrect distractors.
Respond with JSON matching the schema.`;
          }
        } else if (captionContext) {
          promptText = `${customBingoPrompt}\n\nRecent Instructor Spoken Commentary: "${captionContext}"`;
        }

        // Retrieve recently asked Bingo questions for this class to prevent duplicates
        const recentQuestions = [];
        try {
          const recentSnap = await db.collection(`classes/${classId}/bingoRecords`)
            .orderBy('issuedAtMillis', 'desc')
            .limit(10)
            .get();
          recentSnap.forEach((doc) => {
            const q = doc.data()?.question;
            if (q && typeof q === 'string' && !recentQuestions.includes(q.trim())) {
              recentQuestions.push(q.trim());
            }
          });
        } catch (recErr) {
          console.warn('[resolveBingoQuestion] Note: could not fetch recent bingo records for deduplication:', recErr);
        }

        const dedupInstruction = recentQuestions.length > 0
          ? `\n\nCRITICAL ANTI-DUPLICATION RULE:
The instructor may be holding or explaining the same slide/window. The following questions were ALREADY recently asked to students:
${recentQuestions.slice(0, 5).map((q, idx) => `${idx + 1}. "${q}"`).join('\n')}

You MUST NOT repeat or rephrase any of the above questions.
You MUST choose a completely DIFFERENT detail, spoken concept, code line, toolbar item, question angle, or UI element that was NOT covered above.`
          : '';

        let candidateOutput = null;
        let lastUsedModel = AI_MODEL;
        let lastUsage = {};

        for (let attempt = 0; attempt < 2; attempt++) {
          const currentPromptText = attempt === 0
            ? promptText + dedupInstruction
            : `${promptText + dedupInstruction}\n\nATTENTION: Your previous question was rejected because it duplicated a recent question. Pick a completely DIFFERENT element or spoken concept.`;

          const prompt = [
            { text: currentPromptText },
            { media: { url: frameUrl, contentType: 'image/jpeg' } },
          ];

          const { response, modelUsed } = await generateWithResilience({
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

          lastUsedModel = modelUsed || AI_MODEL;
          lastUsage = response?.usage || response?.usageMetadata || {};

          if (response?.output?.question) {
            if (recentQuestions.length === 0 || !isDuplicateQuestion(response.output.question, recentQuestions)) {
              candidateOutput = response.output;
              break;
            }
            console.log(`[resolveBingoQuestion] Generated question was duplicate of recent question ("${response.output.question}"). Attempting alternate angle (attempt ${attempt + 1}).`);
            candidateOutput = response.output; // fallback if second attempt also duplicates
          }
        }

        if (candidateOutput) {
          const cost = calculateCost(lastUsage, lastUsedModel);
          if (classId) {
            try {
              await logJob({
                classId,
                jobType: 'generateBingoQuestion',
                status: 'completed',
                promptText: promptText,
                mediaPaths: [frameUrl],
                usage: {
                  inputTokens: lastUsage.inputTokens ?? lastUsage.promptTokenCount ?? 0,
                  outputTokens: lastUsage.outputTokens ?? lastUsage.candidatesTokenCount ?? 0,
                },
                cost,
                modelUsed: lastUsedModel,
                result: candidateOutput.question,
              });
            } catch (logErr) {
              console.warn('[resolveBingoQuestion] Failed to log teacher screen AI job:', logErr);
            }
          }

          const { options: shuffledOptions, correctIndex: shuffledCorrectIndex } = shuffleOptionsAndCorrectIndex(
            candidateOutput.options,
            candidateOutput.correctIndex
          );
          return {
            ...candidateOutput,
            options: shuffledOptions,
            correctIndex: shuffledCorrectIndex,
            questionSource: 'teacher_screen',
            screenshotUrl: null,
            captionContext: captionContext || null,
          };
        }
      }
    } catch (err) {
      console.warn('[resolveBingoQuestion] Teacher screen generation failed:', err);
    }

    // Do NOT fallback to question bank if teacher screen is requested but unavailable
    console.log(`[resolveBingoQuestion] Teacher screen frame unavailable for class ${classId}. Skipping.`);
    return null;
  }

  // Mode 3: Student Screen (Inspect individual student's latest screen capture)
  if (questionSource === 'student_screen') {
    if (!studentUid) return null;
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
        if (!snap.empty && snap.docs?.[0]) {
          screenshotUrl = snap.docs[0].data()?.screenshotUrl;
        }
      }

      if (screenshotUrl) {
        const promptText = customBingoPrompt
          ? customBingoPrompt.replace(/\{\{studentUid\}\}/g, studentUid || '')
          : `You are a classroom invigilator checking student presence in a computer lab.
Analyze this student's computer screen screenshot.
Formulate a 4-option multiple choice question testing immediate awareness of their screen state (e.g. active editor file, command in terminal, running app, or video title).
ONE option MUST be the true visible detail.
THREE options MUST be plausible distractors.`;

        const prompt = [
          { text: promptText },
          { media: { url: screenshotUrl, contentType: 'image/jpeg' } },
        ];

        const { response, modelUsed } = await generateWithResilience({
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
          const usage = response?.usage || response?.usageMetadata || {};
          const cost = calculateCost(usage, modelUsed || AI_MODEL);
          if (classId) {
            try {
              await logJob({
                classId,
                studentUid,
                jobType: 'generateBingoQuestion',
                status: 'completed',
                promptText,
                mediaPaths: [screenshotUrl],
                usage: {
                  inputTokens: usage.inputTokens ?? usage.promptTokenCount ?? 0,
                  outputTokens: usage.outputTokens ?? usage.candidatesTokenCount ?? 0,
                },
                cost,
                modelUsed: modelUsed || AI_MODEL,
                result: response.output.question,
              });
            } catch (logErr) {
              console.warn('[resolveBingoQuestion] Failed to log student screen AI job:', logErr);
            }
          }

          const { options: shuffledOptions, correctIndex: shuffledCorrectIndex } = shuffleOptionsAndCorrectIndex(
            response.output.options,
            response.output.correctIndex
          );
          return {
            ...response.output,
            options: shuffledOptions,
            correctIndex: shuffledCorrectIndex,
            questionSource: 'student_screen',
            screenshotUrl,
          };
        }
      }
    } catch (err) {
      console.warn('[resolveBingoQuestion] Student screen generation failed:', err);
    }

    // Do NOT fallback to question bank if student screen is requested but unavailable
    console.log(`[resolveBingoQuestion] Student ${studentUid} screen capture unavailable for class ${classId}. Skipping.`);
    return null;
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
  timeLimitSeconds = null,
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

  // If automated trigger, verify class session is active and screen is broadcasting!
  if (typeof triggerType === 'string' && triggerType.startsWith('automated_')) {
    if (!isClassSessionActive(classData)) {
      console.log(`[generateBingoChallenge] Class ${classId} is not in an active capturing session. Skipping automated challenge.`);
      return {
        success: false,
        skipped: true,
        reason: 'class_session_ended',
        message: 'Class is not in an active capturing session.',
      };
    }

    try {
      const screenSessionDoc = await db.doc(`classes/${classId}/screenBroadcast/session`).get();
      if (!screenSessionDoc.exists || screenSessionDoc.data()?.isBroadcasting !== true) {
        console.log(`[generateBingoChallenge] Class ${classId} is not broadcasting screen. Skipping automated challenge.`);
        return {
          success: false,
          skipped: true,
          reason: 'screen_not_broadcasting',
          message: 'Teacher screen is not sharing.',
        };
      }
    } catch (err) {
      console.warn(`[generateBingoChallenge] Error checking screen broadcast session:`, err);
    }
  }

  const effectiveTimeLimit = Number(timeLimitSeconds) || Number(classData.bingoTimeLimitSeconds) || 30;
  const studentsMap = classData.students || {};

  // Resolve target students
  let targetUids = [];
  if (targetStudentUid && targetStudentUid !== 'all') {
    targetUids = [targetStudentUid];
  } else {
    // If 'all', target all students enrolled in the class or active in class status
    const allCandidateUids = new Set(Object.keys(studentsMap));
    const statusSnap = await db.collection(`classes/${classId}/status`).get();
    statusSnap.forEach(doc => {
      allCandidateUids.add(doc.id);
    });
    targetUids = Array.from(allCandidateUids);
  }

  if (targetUids.length === 0) {
    return { success: false, message: 'No target students found' };
  }

  // If questionSource is 'teacher_screen' or 'question_bank', generate question ONCE for all targets!
  // Safety: For multiple targets, student_screen mode would trigger N sequential vision calls. Use teacher_screen instead.
  let effectiveQuestionSource = questionSource;
  if (targetUids.length > 1 && effectiveQuestionSource === 'student_screen') {
    console.log(`[generateBingoChallenge] Multiple targets (${targetUids.length}) specified with student_screen mode. Using teacher_screen for class-wide efficiency.`);
    effectiveQuestionSource = 'teacher_screen';
  }

  let sharedQuestionData = null;
  if (effectiveQuestionSource !== 'student_screen') {
    sharedQuestionData = await resolveBingoQuestion({
      classId,
      studentUid: targetUids[0],
      questionSource: effectiveQuestionSource,
    });
    if (!sharedQuestionData && effectiveQuestionSource === 'teacher_screen') {
      return {
        success: false,
        skipped: true,
        reason: 'teacher_screen_not_broadcasting',
        message: 'Teacher screen broadcast frame is unavailable. Skipped vision challenge without fallback.',
      };
    }
  }

  const recordsCreated = [];
  const operations = [];
  const studentIssuedAtMillis = Date.now();
  const studentExpiresAtMillis = studentIssuedAtMillis + (effectiveTimeLimit * 1000);

  for (const studentUid of targetUids) {
    const studentEmail = (studentsMap[studentUid] || '').toLowerCase();

    // If individual student screen mode, generate per-student
    const qData = sharedQuestionData || await resolveBingoQuestion({
      classId,
      studentUid,
      questionSource: effectiveQuestionSource,
    });

    if (!qData) {
      console.log(`[generateBingoChallenge] Skipping student ${studentUid} because question could not be generated.`);
      continue;
    }

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
      captionContext: qData.captionContext || null,
      triggerType,
      strikeNumber: Number(strikeNumber) || 1,
      priorBingoId: priorBingoId || null,
      issuedAt: FieldValue.serverTimestamp(),
      issuedAtMillis: studentIssuedAtMillis,
      expiresAtMillis: studentExpiresAtMillis,
      timeLimitSeconds: effectiveTimeLimit,
    };

    const studentPropsRef = db.doc(`classes/${classId}/studentProperties/${studentUid}`);
    const studentPropsData = {
      activeBingo: {
        bingoId: bingoRef.id,
        classId,
        question: qData.question,
        options: qData.options,
        timeLimitSeconds: effectiveTimeLimit,
        issuedAtMillis: studentIssuedAtMillis,
        expiresAtMillis: studentExpiresAtMillis,
        status: 'pending',
        result: null,
        selectedIndex: null,
        responseTimeSec: null,
        strikeNumber: Number(strikeNumber) || 1,
        questionSource: qData.questionSource,
        priorBingoId: priorBingoId || null,
      },
      lastBingoIssuedAt: FieldValue.serverTimestamp(),
    };

    operations.push({ bingoRef, bingoRecord, studentPropsRef, studentPropsData });
    recordsCreated.push(bingoRef.id);
  }

  // Execute writes: If 1 student, direct set for compatibility; if multiple students, atomic batches of up to 200 items
  if (operations.length === 1) {
    const op = operations[0];
    await op.bingoRef.set(op.bingoRecord);
    await op.studentPropsRef.set(op.studentPropsData, { merge: true });
  } else if (operations.length > 1) {
    const BATCH_SIZE = 200; // 200 students * 2 writes = 400 operations, below 500 Firestore batch limit
    const batchPromises = [];
    for (let i = 0; i < operations.length; i += BATCH_SIZE) {
      const chunk = operations.slice(i, i + BATCH_SIZE);
      const batch = db.batch();
      for (const op of chunk) {
        batch.set(op.bingoRef, op.bingoRecord);
        batch.set(op.studentPropsRef, op.studentPropsData, { merge: true });
      }
      batchPromises.push(batch.commit());
    }
    await Promise.all(batchPromises);
  }

  if (recordsCreated.length === 0) {
    return {
      success: true,
      skipped: true,
      createdCount: 0,
      bingoIds: [],
      reason: 'no_screens_available',
      message: 'No students had active screen captures to evaluate. Skipped vision challenge.',
    };
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

  // Pre-flight check: Verify class session is still actively capturing
  if (!isClassSessionActive(classData)) {
    console.log(`[handleDispatchBingoRetry] Class ${classId} session has ended or is not active. Cancelling retry.`);
    await studentPropsRef.set({
      pendingRetryBingo: false,
      retryCancelledReason: 'class_session_ended',
    }, { merge: true });
    return { skipped: true, reason: 'class_session_ended' };
  }

  // Pre-flight check: Verify teacher screen is actively broadcasting
  try {
    const screenSessionDoc = await db.doc(`classes/${classId}/screenBroadcast/session`).get();
    if (!screenSessionDoc.exists || screenSessionDoc.data()?.isBroadcasting !== true) {
      console.log(`[handleDispatchBingoRetry] Class ${classId} is not broadcasting screen. Cancelling retry.`);
      await studentPropsRef.set({
        pendingRetryBingo: false,
        retryCancelledReason: 'screen_not_broadcasting',
      }, { merge: true });
      return { skipped: true, reason: 'screen_not_broadcasting' };
    }
  } catch (err) {
    console.warn(`[handleDispatchBingoRetry] Error checking screen broadcast session:`, err);
  }

  if (!classData.students || !classData.students[studentUid]) {
    console.warn(`[handleDispatchBingoRetry] Student ${studentUid} not enrolled in class ${classId}.`);
    return { skipped: true, reason: 'student_not_enrolled' };
  }
  if (studentData.priorMissedBingoId && studentData.priorMissedBingoId !== priorBingoId) {
    console.log(`[handleDispatchBingoRetry] Mismatched priorMissedBingoId. Skipping.`);
    return { skipped: true, reason: 'mismatched_prior_id' };
  }

  // Dispatch Strike 2 Challenge
  console.log(`[handleDispatchBingoRetry] Dispatching Strike 2 challenge for student ${studentUid} in class ${classId}`);
  const result = await generateBingoChallenge({
    classId,
    targetStudentUid: studentUid,
    questionSource: classData.autoBingoMode || 'question_bank',
    triggerType: 'scheduled_strike_retry',
    timeLimitSeconds: classData.bingoTimeLimitSeconds || null,
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
 * Evaluates whether a class session is currently active:
 *  - Scheduled class: Active when current time is within schedule date range and an active time slot.
 *    If outside schedule, only active if teacher explicitly enabled manual capture (overtime).
 *  - Unscheduled / manual class: Active when isCapturing is true and started < 3 hours ago.
 */
export function isClassSessionActive(classData, now = new Date()) {
  if (!classData) return false;

  const { schedule, captureStartedAt, isCapturing } = classData;

  // Case 1: Scheduled class (session active within scheduled start and end time)
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

  // Case 2: Manual / unscheduled class
  if (isCapturing) {
    if (captureStartedAt) {
      const startedMillis = captureStartedAt.toMillis ? captureStartedAt.toMillis() : new Date(captureStartedAt).getTime();
      if ((now.getTime() - startedMillis) > 3 * 60 * 60 * 1000) {
        return false;
      }
    }
    return true;
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
    console.log(`[handleDispatchScheduledBingo] Class ${classId} session has ended or is not capturing. Skipping scheduled task.`);
    return { skipped: true, reason: 'class_session_ended' };
  }

  if (!classData.students || !classData.students[studentUid]) {
    console.warn(`[handleDispatchScheduledBingo] Student ${studentUid} not enrolled in class ${classId}.`);
    return { skipped: true, reason: 'student_not_enrolled' };
  }

  // Auto-Bingo requires teacher's screen to be actively broadcasting!
  try {
    const screenSessionDoc = await db.doc(`classes/${classId}/screenBroadcast/session`).get();
    if (!screenSessionDoc.exists || screenSessionDoc.data()?.isBroadcasting !== true) {
      console.log(`[handleDispatchScheduledBingo] Class ${classId} is not broadcasting screen. Skipping scheduled task.`);
      return { skipped: true, reason: 'screen_not_broadcasting' };
    }
  } catch (err) {
    console.warn(`[handleDispatchScheduledBingo] Error checking screen broadcast session:`, err);
  }

  console.log(`[handleDispatchScheduledBingo] Dispatching periodic Bingo challenge to ${studentUid} in ${classId}`);
  const result = await generateBingoChallenge({
    classId,
    targetStudentUid: studentUid,
    questionSource,
    timeLimitSeconds: classData.bingoTimeLimitSeconds || null,
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

  // Auto-Bingo requires teacher's screen to be actively broadcasting!
  try {
    const screenSessionDoc = await db.doc(`classes/${classId}/screenBroadcast/session`).get();
    if (!screenSessionDoc.exists || screenSessionDoc.data()?.isBroadcasting !== true) {
      console.log(`[handleProcessBingoJob] Class ${classId} is not broadcasting screen. Skipping job.`);
      if (jobId) {
        await db.doc(`bingoJobs/${jobId}`).update({ status: 'skipped_screen_not_sharing', completedAt: FieldValue.serverTimestamp() });
      }
      return { skipped: true, reason: 'screen_not_broadcasting' };
    }
  } catch (err) {
    console.warn(`[handleProcessBingoJob] Error checking screen broadcast session:`, err);
  }

  const studentsMap = classData.students || {};
  const targetUidSet = new Set(Object.keys(studentsMap));
  const statusSnap = await db.collection(`classes/${classId}/status`).get();
  statusSnap.forEach(doc => {
    targetUidSet.add(doc.id);
  });

  let targetUids = Array.from(targetUidSet);
  if (targetUids.length === 0) {
    console.log(`[handleProcessBingoJob] No students enrolled or active for class ${classId}.`);
    if (jobId) {
      await db.doc(`bingoJobs/${jobId}`).update({ status: 'completed', totalStudentsTargeted: 0, completedAt: FieldValue.serverTimestamp() });
    }
    return { success: true, totalStudentsTargeted: 0 };
  }

  // Direct simultaneous dispatch for all students (no jitter)
  const challengeRes = await generateBingoChallenge({
    classId,
    targetStudentUid: 'all',
    questionSource: mode,
    timeLimitSeconds: classData.bingoTimeLimitSeconds || null,
    triggerType: 'automated_periodic',
  });

  if (jobId) {
    const isSkipped = challengeRes?.skipped;
    await db.doc(`bingoJobs/${jobId}`).update({
      status: isSkipped ? 'skipped_no_screen_available' : 'completed',
      totalStudentsTargeted: challengeRes?.createdCount || 0,
      skippedReason: challengeRes?.reason || null,
      completedAt: FieldValue.serverTimestamp(),
    });
  }

  return { success: true, challengeRes, totalStudentsTargeted: challengeRes?.createdCount || 0 };
}

/**
 * Cancel and purge active Bingo challenges and pending retries for a class
 */
export async function cancelActiveBingo({ classId }) {
  if (!classId) {
    throw new Error('classId is required');
  }

  let cancelledStudentsCount = 0;

  // 1. Find all studentProperties in class that have activeBingo.status === 'pending' or pendingRetryBingo === true
  const studentPropsSnap = await db.collection(`classes/${classId}/studentProperties`).get();
  const batch = db.batch();
  let opsCount = 0;

  for (const doc of studentPropsSnap.docs) {
    const data = doc.data() || {};
    const hasPendingBingo = data.activeBingo && (data.activeBingo.status === 'pending' || data.activeBingo.status === 'active');
    const hasPendingRetry = data.pendingRetryBingo === true;

    if (hasPendingBingo || hasPendingRetry) {
      cancelledStudentsCount++;
      const updates = {};
      if (hasPendingBingo) {
        updates['activeBingo.status'] = 'cancelled';
        updates['activeBingo.result'] = 'cancelled';
      }
      if (hasPendingRetry) {
        updates.pendingRetryBingo = false;
        updates.retryCancelledReason = 'teacher_cancelled';
      }
      batch.update(doc.ref, updates);
      opsCount++;
    }
  }

  // 2. Cancel any pending bingoJobs for this class
  const jobsSnap = await db.collection('bingoJobs')
    .where('classId', '==', classId)
    .where('status', '==', 'pending')
    .get();

  for (const jobDoc of jobsSnap.docs) {
    batch.update(jobDoc.ref, {
      status: 'cancelled',
      completedAt: FieldValue.serverTimestamp(),
    });
    opsCount++;
  }

  if (opsCount > 0) {
    await batch.commit();
  }

  console.log(`[cancelActiveBingo] Successfully cancelled active Bingo for ${cancelledStudentsCount} students in class ${classId}`);
  return { success: true, cancelledStudentsCount };
}

