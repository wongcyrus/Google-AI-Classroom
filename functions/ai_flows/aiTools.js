import { ai } from './ai.js';
import { z } from 'genkit';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const adminAuth = getAuth();

export const sendMessageToStudent = ai.defineTool(
  {
    name: 'sendMessageToStudent',
    description: 'Sends a direct message or warning to a specific student.',
    inputSchema: z.object({
      studentUid: z.string().describe('The UID of the student to send the message to.'),
      message: z.string().describe('The content of the message or warning.'),
      classId: z.string().optional().describe('The ID of the class.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    console.log('sendMessageToStudent input:', input);
    const { studentUid, message, classId } = input;
    try {
      const db = getFirestore();
      const studentMessagesRef = db.collection('students').doc(studentUid).collection('messages');
      const messageData = {
        message: message,
        timestamp: FieldValue.serverTimestamp(),
        classId: classId || '',
      };
      await studentMessagesRef.add(messageData);
      console.log(`✅ Sent direct message/warning to student ${studentUid}: "${message}"`);
      return `Successfully sent message to student ${studentUid}.`;
    } catch (error) {
      console.error('Error sending message:', error);
      return `Failed to send message to student ${studentUid}. Error: ${error.message}`;
    }
  }
);

export const recordIrregularity = ai.defineTool(
  {
    name: 'recordIrregularity',
    description: 'Records an irregularity or distraction activity for a student (e.g. non-exam app, phone use, gaming).',
    inputSchema: z.object({
      studentUid: z.string().describe('The UID of the student.'),
      studentEmail: z.string().optional().describe('The email of the student.'),
      title: z.string().describe('The short title of the irregularity (e.g., Off-task browsing, Significant Distraction).'),
      message: z.string().describe('The description of what the student was doing.'),
      imageUrl: z.string().optional().describe('The URL of the image associated with the irregularity.'),
      classId: z.string().optional().describe('The ID of the class.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    console.log('recordIrregularity input:', input);
    const { studentUid, studentEmail, title, message, imageUrl, classId } = input;
    try {
      const db = getFirestore();
      const irregularitiesRef = db.collection('irregularities');

      let imagePath = imageUrl || '';
      if (imageUrl) {
        const pathRegex = /o\/(.*?)\?alt=media/;
        const match = imageUrl.match(pathRegex);
        if (match && match[1]) {
          imagePath = decodeURIComponent(match[1]);
        }
      }

      await irregularitiesRef.add({
        studentUid,
        email: studentEmail || '',
        title: title || 'Distraction / Irregularity Detected',
        message: message || '',
        type: 'image',
        imageUrl: imagePath,
        timestamp: FieldValue.serverTimestamp(),
        classId: classId || '',
      });
      console.log(`✅ Recorded irregularity for student ${studentUid}: "${title}"`);
      return `Successfully recorded irregularity for student ${studentUid}.`;
    } catch (error) {
      console.error('Error recording irregularity:', error);
      return `Failed to record irregularity. Error: ${error.message}`;
    }
  }
);

export const recordVideoIrregularity = ai.defineTool(
  {
    name: 'recordVideoIrregularity',
    description: 'Records an irregularity activity from a video.',
    inputSchema: z.object({
      studentUid: z.string().describe('The UID of the student.'),
      studentEmail: z.string().describe('The email of the student (denormalized).'),
      title: z.string().describe('The title of the irregularity.'),
      message: z.string().describe('The description of the irregularity.'),
      classId: z.string().describe('The ID of the class.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    console.log('recordVideoIrregularity input:', input);
    const { studentUid, studentEmail, title, message, classId } = input;
    try {
      const db = getFirestore();
      const irregularitiesRef = db.collection('irregularities');

      await irregularitiesRef.add({
        studentUid,
        email: studentEmail, // Keep email field for compatibility/display
        title,
        message,
        type: 'video',
        timestamp: FieldValue.serverTimestamp(),
        classId: classId,
      });
      return `Successfully recorded video irregularity for ${studentEmail}.`;
    } catch (error) {
      console.error('Error recording video irregularity:', error);
      return `Failed to record video irregularity for ${studentEmail}. Error: ${error.message}`;
    }
  }
);

export const recordAudioIrregularity = ai.defineTool(
  {
    name: 'recordAudioIrregularity',
    description: 'Records an audio irregularity (e.g. unauthorized collaboration, secondary speaker present, whispering answers, exam chat).',
    inputSchema: z.object({
      studentUid: z.string().describe('The UID of the student.'),
      studentEmail: z.string().optional().describe('The email of the student.'),
      title: z.string().describe('The title of the audio irregularity (e.g., Unauthorized Collaboration, Multiple Voices Detected).'),
      message: z.string().describe('Detailed explanation of the conversation or acoustic evidence.'),
      transcriptSnippet: z.string().optional().describe('The relevant spoken transcript snippet with speaker tags.'),
      audioPath: z.string().optional().describe('Cloud storage path of the audio snippet.'),
      imageUrl: z.string().optional().describe('URL or path to the corresponding student webcam/screen image.'),
      speakerCount: z.number().optional().describe('Number of distinct speakers identified.'),
      riskLevel: z.enum(['none', 'low', 'medium', 'high']).optional().describe('Risk severity level.'),
      classId: z.string().optional().describe('The ID of the class.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    console.log('recordAudioIrregularity input:', input);
    const {
      studentUid,
      studentEmail = '',
      title,
      message,
      transcriptSnippet = '',
      audioPath = '',
      imageUrl = '',
      speakerCount = 1,
      riskLevel = 'medium',
      classId = '',
    } = input;
    try {
      const db = getFirestore();
      const irregularitiesRef = db.collection('irregularities');

      let resolvedImagePath = imageUrl;
      if (imageUrl) {
        const pathRegex = /o\/(.*?)\?alt=media/;
        const match = imageUrl.match(pathRegex);
        if (match && match[1]) {
          resolvedImagePath = decodeURIComponent(match[1]);
        }
      }

      await irregularitiesRef.add({
        studentUid,
        email: studentEmail,
        title: title || 'Audio Irregularity Detected',
        message: message || '',
        transcriptSnippet,
        audioPath,
        imageUrl: resolvedImagePath,
        speakerCount,
        riskLevel,
        type: 'audio',
        timestamp: FieldValue.serverTimestamp(),
        classId: classId || '',
      });
      console.log(`✅ Recorded audio irregularity for student ${studentUid}: "${title}"`);
      return `Successfully recorded audio irregularity for student ${studentUid}.`;
    } catch (error) {
      console.error('Error recording audio irregularity:', error);
      return `Failed to record audio irregularity for student ${studentUid}. Error: ${error.message}`;
    }
  }
);

export const recordStudentProgress = ai.defineTool(
  {
    name: 'recordStudentProgress',
    description: 'Records the work progress of a student.',
    inputSchema: z.object({
      studentUid: z.string().describe('The UID of the student.'),
      studentEmail: z.string().describe('The email of the student (denormalized).'),
      progress: z.string().describe('The description of the student\'s work progress.'),
      classId: z.string().describe('The ID of the class.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    console.log('recordStudentProgress input:', input);
    const { studentUid, studentEmail, progress, classId } = input;
    try {
      const db = getFirestore();
      const progressRef = db.collection('progress');

      await progressRef.add({
        studentUid,
        studentEmail, // Keep email field for compatibility/display
        progress,
        classId,
        timestamp: FieldValue.serverTimestamp(),
      });
      return `Successfully recorded progress for ${studentEmail}.`;
    } catch (error) {
      console.error('Error recording progress:', error);
      return `Failed to record progress for ${studentEmail}. Error: ${error.message}`;
    }
  }
);

export const recordScreenshotAnalysis = ai.defineTool(
  {
    name: 'recordScreenshotAnalysis',
    description: "Records the student's current task based on screenshot analysis.",
    inputSchema: z.object({
      studentUid: z.string().describe('The UID of the student.'),
      classId: z.string().describe('The ID of the class.'),
      screenshotUrl: z.string().describe('The URL of the screenshot being analyzed.'),
      currentTask: z.string().describe("The student's current task, e.g., 'Question 5' or 'Writing introduction'."),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    console.log('recordScreenshotAnalysis input:', input);
    const { studentUid, classId, screenshotUrl, currentTask } = input;
    try {
      const db = getFirestore();
      await db.collection('screenshotAnalyses').add({
        studentUid,
        classId,
        screenshotUrl,
        currentTask,
        timestamp: FieldValue.serverTimestamp(),
      });
      return `Successfully recorded screenshot analysis for student ${studentUid}.`;
    } catch (error) {
      console.error('Error recording screenshot analysis:', error);
      return `Failed to record screenshot analysis. Error: ${error.message}`;
    }
  }
);

export const sendMessageToTeacher = ai.defineTool(
  {
    name: 'sendMessageToTeacher',
    description: 'Sends a direct message to the teacher of a class, optionally regarding a specific student.',
    inputSchema: z.object({
      classId: z.string().describe('The ID of the class to which the message pertains.'),
      message: z.string().describe('The content of the message.'),
      studentUid: z.string().optional().describe('The UID of the student this message is about.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    console.log('sendMessageToTeacher input:', input);
    const { classId, message, studentUid } = input;
    try {
      const db = getFirestore();
      const classRef = db.collection('classes').doc(classId);
      const classDoc = await classRef.get();

      if (!classDoc.exists) {
        console.error(`Class with ID ${classId} not found.`);
        return `Failed to send message: Class with ID ${classId} not found.`;
      }

      const classData = classDoc.data();
      const teacherUids = classData.teachers ? Object.keys(classData.teachers) : [];

      if (teacherUids.length === 0) {
        console.error(`No teachers found for class ${classId}. Class data:`, classData);
        return `Failed to send message: No teachers found for class ${classId}.`;
      }

      let finalMessage = message;
      if (studentUid) {
        try {
          const studentUser = await adminAuth.getUser(studentUid);
          finalMessage = `Regarding ${studentUser.email}: ${message}`;
        } catch {
          finalMessage = `Regarding student ${studentUid}: ${message}`;
        }
      }

      const messagePromises = teacherUids.map(teacherUid => {
        const teacherMessagesRef = db.collection('teachers').doc(teacherUid).collection('messages');
        return teacherMessagesRef.add({
          message: finalMessage,
          timestamp: FieldValue.serverTimestamp(),
          classId: classId,
        });
      });

      await Promise.all(messagePromises);

      return `Successfully sent message to all ${teacherUids.length} teachers of class ${classId}.`;
    } catch (error) {
      console.error('Error sending message to teachers:', error);
      return `Failed to send message to teachers. Error: ${error.message}`;
    }
  }
);

export const recordActualWorkingTime = ai.defineTool(
  {
    name: 'recordActualWorkingTime',
    description: "Records the actual working time in minutes for a student for a specific lesson.",
    inputSchema: z.object({
      studentUid: z.string().describe('The UID of the student.'),
      classId: z.string().describe('The ID of the class.'),
      startTime: z.string().describe('The start time of the lesson, as an ISO 8601 string.'),
      endTime: z.string().describe('The end time of the lesson, as an ISO 8601 string.'),
      workingMinutes: z.number().describe('The number of minutes the student was working.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    console.log('recordActualWorkingTime input:', input);
    const { studentUid, classId, startTime, endTime, workingMinutes } = input;
    try {
      const startDate = new Date(startTime);
      const endDate = new Date(endTime);
      const lessonStartTimeISO = startDate.toISOString();
      const lessonEndTimeISO = endDate.toISOString();

      const crypto = await import('crypto');
      const lessonId = crypto.createHash('sha256').update(`${lessonStartTimeISO}-${lessonEndTimeISO}`).digest('hex');

      const db = getFirestore();
      const lessonRef = db.collection('classes').doc(classId).collection('lessons').doc(lessonId);

      // Guardrail: working minutes cannot be negative and cannot exceed total lesson duration
      const durationMinutes = Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
      const normalizedMinutes = Math.max(0, Math.round(workingMinutes));
      const cappedWorkingMinutes = durationMinutes > 0 ? Math.min(normalizedMinutes, durationMinutes) : normalizedMinutes;

      await db.runTransaction(async (transaction) => {
        const lessonDoc = await transaction.get(lessonRef);
        if (!lessonDoc.exists) {
          transaction.set(lessonRef, {
            startTime: startDate,
            endTime: endDate,
            students: {
              [studentUid]: {
                workingMinutes: cappedWorkingMinutes
              }
            }
          });
        } else {
          const studentPath = `students.${studentUid}.workingMinutes`;
          transaction.update(lessonRef, {
            [studentPath]: cappedWorkingMinutes
          });
        }
      });

      return `Successfully recorded ${cappedWorkingMinutes} working minutes for student ${studentUid} in lesson.`;
    } catch (error) {
      console.error('Error recording actual working time:', error);
      return `Failed to record actual working time. Error: ${error.message}`;
    }
  }
);

export const recordTaskDuration = ai.defineTool(
  {
    name: 'recordTaskDuration',
    description: 'Records the estimated duration in minutes spent on a specific coursework task or milestone during the lesson. Only invoke this tool when the prompt explicitly asks to track individual lab tasks, milestones, or coursework durations. Do NOT call this tool for general invigilation or if the prompt does not specify coursework tasks to measure.',
    inputSchema: z.object({
      studentUid: z.string().describe('The UID of the student.'),
      classId: z.string().describe('The ID of the class.'),
      taskName: z.string().describe("The name of the specific task (e.g. 'Azure Setup & MFA', 'AWS Academy Lab 2.1', 'DevOps Assignment 2', 'Troubleshooting')."),
      durationMinutes: z.number().describe('The estimated duration spent on this task in minutes.'),
      startTime: z.string().optional().describe('The start time of the lesson as an ISO 8601 string.'),
      endTime: z.string().optional().describe('The end time of the lesson as an ISO 8601 string.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    console.log('recordTaskDuration input:', input);
    const { studentUid, classId, taskName, durationMinutes, startTime, endTime } = input;
    try {
      const db = getFirestore();
      const normalizedMinutes = Math.max(0, Math.round(durationMinutes));
      const durationSeconds = normalizedMinutes * 60;

      const record = {
        studentUid,
        classId,
        taskName: (taskName || 'General Task').trim(),
        duration: durationSeconds,
        status: 'completed',
        source: 'videoAnalysis',
        timestamp: FieldValue.serverTimestamp(),
      };

      if (startTime) {
        const parsedStart = new Date(startTime);
        if (!isNaN(parsedStart.getTime())) {
          record.startTime = parsedStart;
        }
      }
      if (endTime) {
        const parsedEnd = new Date(endTime);
        if (!isNaN(parsedEnd.getTime())) {
          record.endTime = parsedEnd;
        }
      }

      await db.collection('performanceMetrics').add(record);

      return `Successfully recorded ${normalizedMinutes} minutes for task "${taskName}".`;
    } catch (error) {
      console.error('Error recording task duration:', error);
      return `Failed to record task duration. Error: ${error.message}`;
    }
  }
);

export const recordLessonFeedback = ai.defineTool(
  {
    name: 'recordLessonFeedback',
    description: 'Records a piece of feedback for a specific lesson. Multiple feedbacks can be recorded, and they will be appended to a list.',
    inputSchema: z.object({
      classId: z.string().describe('The ID of the class.'),
      startTime: z.string().describe('The start time of the lesson, as an ISO 8601 string.'),
      endTime: z.string().describe('The end time of the lesson, as an ISO 8601 string.'),
      studentUid: z.string().optional().describe('The UID of the student this feedback is for.'),
      feedback: z.string().describe('A piece of feedback text. This will be added to a list of feedbacks.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const { classId, startTime, endTime, feedback, studentUid } = input;
    try {
      const startDate = new Date(startTime);
      const endDate = new Date(endTime);
      const lessonStartTimeISO = startDate.toISOString();
      const lessonEndTimeISO = endDate.toISOString();

      const crypto = await import('crypto');
      const lessonId = crypto.createHash('sha256').update(`${lessonStartTimeISO}-${lessonEndTimeISO}`).digest('hex');
      const db = getFirestore();
      const lessonRef = db.collection('classes').doc(classId).collection('lessons').doc(lessonId);

      await db.runTransaction(async (transaction) => {
        const lessonDoc = await transaction.get(lessonRef);
        if (!lessonDoc.exists) {
            transaction.set(lessonRef, {
                startTime: startDate,
                endTime: endDate,
            });
        }
      });

      if (studentUid) {
        await lessonRef.set({
            students: {
                [studentUid]: {
                    feedback: FieldValue.arrayUnion(feedback)
                }
            }
        }, { merge: true });
      } else {
        await lessonRef.set({
            generalFeedback: FieldValue.arrayUnion(feedback)
        }, { merge: true });
      }
      return `Successfully recorded feedback for lesson.`;
    } catch (error) {
      console.error('Error recording lesson feedback:', error);
      return `Failed to record lesson feedback. Error: ${error.message}`;
    }
  }
);

export const recordLessonSummary = ai.defineTool(
  {
    name: 'recordLessonSummary',
    description: 'Records a summary for a specific lesson. This will overwrite any existing summary.',
    inputSchema: z.object({
      classId: z.string().describe('The ID of the class.'),
      startTime: z.string().describe('The start time of the lesson, as an ISO 8601 string.'),
      endTime: z.string().describe('The end time of the lesson, as an ISO 8601 string.'),
      feedback: z.string().describe('The summary text.'),
      studentUid: z.string().optional().describe('The UID of the student this summary is for.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const { classId, startTime, endTime, feedback, studentUid } = input;
    try {
      const startDate = new Date(startTime);
      const endDate = new Date(endTime);
      const lessonStartTimeISO = startDate.toISOString();
      const lessonEndTimeISO = endDate.toISOString();

      const crypto = await import('crypto');
      const lessonId = crypto.createHash('sha256').update(`${lessonStartTimeISO}-${lessonEndTimeISO}`).digest('hex');
      const db = getFirestore();
      const lessonRef = db.collection('classes').doc(classId).collection('lessons').doc(lessonId);

      await db.runTransaction(async (transaction) => {
        const lessonDoc = await transaction.get(lessonRef);
        if (!lessonDoc.exists) {
            transaction.set(lessonRef, {
                startTime: startDate,
                endTime: endDate,
            });
        }
      });

      if (studentUid) {
        await lessonRef.set({
            students: {
                [studentUid]: {
                    summary: feedback
                }
            }
        }, { merge: true });
      } else {
        await lessonRef.set({
            generalSummary: feedback
        }, { merge: true });
      }
      return `Successfully recorded summary for lesson.`;
    } catch (error) {
      console.error('Error recording lesson summary:', error);
      return `Failed to record lesson summary. Error: ${error.message}`;
    }
  }
);

export const recordAudioAudit = ai.defineTool(
  {
    name: 'recordAudioAudit',
    description: 'Saves full audio audit transcript, diarization speaker turns, and integrity rating for an exam session.',
    inputSchema: z.object({
      classId: z.string().describe('The ID of the class.'),
      studentUid: z.string().describe('The UID of the student.'),
      studentEmail: z.string().optional().describe('Student email.'),
      verdict: z.enum(['clean_exam', 'suspicious_collaboration', 'whisper_detected', 'background_noise', 'inconclusive']).describe('Overall audio integrity verdict.'),
      speakerCount: z.number().describe('Total number of distinct human speakers detected.'),
      summary: z.string().describe('Comprehensive evaluation of audio analysis.'),
      transcript: z.string().describe('Full transcript with speaker labels and timestamps.'),
      audioUrl: z.string().optional().describe('URL or path to audio source file.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    console.log('recordAudioAudit input:', input);
    const { classId, studentUid, studentEmail, verdict, speakerCount, summary, transcript, audioUrl } = input;
    try {
      const db = getFirestore();
      const auditRef = db.collection('classes').doc(classId).collection('audio_audits').doc(studentUid);

      const auditData = {
        classId,
        studentUid,
        studentEmail: studentEmail || '',
        verdict,
        speakerCount,
        summary,
        transcript,
        audioUrl: audioUrl || '',
        analyzedAt: FieldValue.serverTimestamp(),
      };

      await auditRef.set(auditData, { merge: true });
      console.log(`✅ Saved audio audit report for student ${studentUid} in class ${classId}: verdict=${verdict}`);
      return `Successfully saved audio audit for student ${studentUid}.`;
    } catch (error) {
      console.error('Error saving audio audit:', error);
      return `Failed to save audio audit. Error: ${error.message}`;
    }
  }
);

