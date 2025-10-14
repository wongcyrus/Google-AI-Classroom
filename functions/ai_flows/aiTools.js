import { ai } from './ai.js';
import { z } from 'genkit';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const adminAuth = getAuth();

export const sendMessageToStudent = ai.defineTool(
  {
    name: 'sendMessageToStudent',
    description: 'Sends a direct message to a specific student.',
    inputSchema: z.object({
      studentUid: z.string().describe('The UID of the student to send the message to.'),
      message: z.string().describe('The content of the message.'),
      classId: z.string().describe('The ID of the class.'),
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
        classId: classId,
      };
      await studentMessagesRef.add(messageData);
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
    description: 'Records an irregularity activity.',
    inputSchema: z.object({
      studentUid: z.string().describe('The UID of the student.'),
      studentEmail: z.string().describe('The email of the student (denormalized).'),
      title: z.string().describe('The title of the irregularity.'),
      message: z.string().describe('The description of the irregularity.'),
      imageUrl: z.string().describe('The URL of the image associated with the irregularity.'),
      classId: z.string().describe('The ID of the class.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    console.log('recordIrregularity input:', input);
    const { studentUid, studentEmail, title, message, imageUrl, classId } = input;
    try {
      const db = getFirestore();
      const irregularitiesRef = db.collection('irregularities');

      const pathRegex = /o\/(.*?)\?alt=media/;
      const match = imageUrl.match(pathRegex);
      let imagePath = imageUrl;
      if (match && match[1]) {
        imagePath = decodeURIComponent(match[1]);
      }

      await irregularitiesRef.add({
        studentUid,
        email: studentEmail, // Keep email field for compatibility/display
        title,
        message,
        imageUrl: imagePath,
        timestamp: FieldValue.serverTimestamp(),
        classId: classId,
      });
      return `Successfully recorded irregularity for ${studentEmail}.`;
    } catch (error) {
      console.error('Error recording irregularity:', error);
      return `Failed to record irregularity for ${studentEmail}. Error: ${error.message}`;
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
        } catch (e) {
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
