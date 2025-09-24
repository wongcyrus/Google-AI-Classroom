import { ai } from './ai.js';
import { z } from 'genkit';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

export const sendMessageTool = ai.defineTool(
  {
    name: 'SendMessageToStudent',
    description: 'Sends a direct message to a specific student.',
    inputSchema: z.object({
      studentEmail: z.string().describe('The email address of the student to send the message to.'),
      message: z.string().describe('The content of the message.'),
      classId: z.string().describe('The ID of the class.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    console.log('SendMessageToStudent input:', input);
    const { studentEmail, message, classId } = input;
    try {
      const db = getFirestore();
      const studentMessagesRef = db.collection('students').doc(studentEmail).collection('messages');
      const messageData = {
        message: message,
        timestamp: FieldValue.serverTimestamp(),
        classId: classId,
      };
      await studentMessagesRef.add(messageData);
      return `Successfully sent message to ${studentEmail}.`;
    } catch (error) {
      console.error("Error sending message:", error);
      return `Failed to send message to ${studentEmail}. Error: ${error.message}`;
    }
  }
);

export const recordIrregularity = ai.defineTool(
  {
    name: 'recordIrregularity',
    description: 'Records an irregularity activity.',
    inputSchema: z.object({
      email: z.string().describe('The email address of the student.'),
      title: z.string().describe('The title of the irregularity.'),
      message: z.string().describe('The description of the irregularity.'),
      imageUrl: z.string().describe('The URL of the image associated with the irregularity.'),
      classId: z.string().describe('The ID of the class.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    console.log('recordIrregularity input:', input);
    const { email, title, message, imageUrl, classId } = input;
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
        email,
        title,
        message,
        imageUrl: imagePath,
        timestamp: FieldValue.serverTimestamp(),
        classId: classId,
      });
      return `Successfully recorded irregularity for ${email}.`;
    } catch (error) {
      console.error("Error recording irregularity:", error);
      return `Failed to record irregularity for ${email}. Error: ${error.message}`;
    }
  }
);

export const recordStudentProgress = ai.defineTool(
  {
    name: 'recordStudentProgress',
    description: 'Records the work progress of a student.',
    inputSchema: z.object({
      email: z.string().describe('The email address of the student.'),
      progress: z.string().describe('The description of the student\'s work progress.'),
      classId: z.string().describe('The ID of the class.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    console.log('recordStudentProgress input:', input);
    const { email, progress, classId } = input;
    try {
      const db = getFirestore();
      const progressRef = db.collection('progress');

      await progressRef.add({
        email,
        progress,
        classId,
        timestamp: FieldValue.serverTimestamp(),
      });
      return `Successfully recorded progress for ${email}.`;
    } catch (error) {
      console.error("Error recording progress:", error);
      return `Failed to record progress for ${email}. Error: ${error.message}`;
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
      studentEmail: z.string().optional().describe('The email of the student this message is about.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    console.log('sendMessageToTeacher input:', input);
    const { classId, message, studentEmail } = input;
    try {
      const db = getFirestore();
      const classRef = db.collection('classes').doc(classId);
      const classDoc = await classRef.get();

      if (!classDoc.exists) {
        console.error(`Class with ID ${classId} not found.`);
        return `Failed to send message: Class with ID ${classId} not found.`;
      }

      const classData = classDoc.data();
      const teacherEmail = classData.teacher || (classData.teachers && classData.teachers[0]);

      if (!teacherEmail) {
        console.error(`No teacher found for class ${classId}. Class data:`, classData);
        return `Failed to send message: No teacher found for class ${classId}.`;
      }

      const teacherMessagesRef = db.collection('teachers').doc(teacherEmail).collection('messages');
      
      const finalMessage = studentEmail ? `Regarding ${studentEmail}: ${message}` : message;

      await teacherMessagesRef.add({
        message: finalMessage,
        timestamp: FieldValue.serverTimestamp(),
        classId: classId,
      });

      return `Successfully sent message to the teacher of class ${classId}.`;
    } catch (error) {
      console.error("Error sending message to teacher:", error);
      return `Failed to send message to teacher. Error: ${error.message}`;
    }
  }
);
