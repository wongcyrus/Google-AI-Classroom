const { ai } = require('./ai.js');
const z = require('zod');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

const sendMessageTool = ai.defineTool(
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
  async ({ studentEmail, message, classId }) => {
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

const recordIrregularity = ai.defineTool(
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
  async ({ email, title, message, imageUrl, classId }) => {
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

const recordStudentProgress = ai.defineTool(
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
  async ({ email, progress, classId }) => {
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


function getTools() {
  return [sendMessageTool, recordIrregularity, recordStudentProgress];
}

exports.analyzeImagesFlow = ai.defineFlow(
  {
    name: 'analyzeImagesFlow',
    inputSchema: z.object({
      screenshots: z.record(z.string()),
      prompt: z.string(),
      classId: z.string(),
    }),
    outputSchema: z.record(z.string()),
  },
  async ({ screenshots, prompt, classId }) => {
    const tools = getTools();
    const analysisResults = {};
    for (const [email, url] of Object.entries(screenshots)) {
      const response = await ai.generate({
                model: 'vertexai/gemini-2.5-flash-lite',
                project: process.env.GCLOUD_PROJECT,
                location: process.env.FUNCTION_REGION,
                temperature: 0,
                topP: 0.1,
                prompt: [
                  { text: `This screen belongs to ${email} (image URL: ${url}). The class ID is ${classId}. ${prompt}` },
                  { media: { url } },
                ],
                tools: tools,
              });
              analysisResults[email] = response.text;
            }
            return analysisResults;
          }
        );

exports.analyzeAllImagesFlow = ai.defineFlow(
  {
    name: 'analyzeAllImagesFlow',
    inputSchema: z.object({
      screenshots: z.record(z.string()),
      prompt: z.string(),
      classId: z.string(),
    }),
    outputSchema: z.string(),
  },
  async ({ screenshots, prompt, classId }) => {
    const tools = getTools();
    const imageParts = Object.entries(screenshots).flatMap(([email, url]) => (
      [
        { text: `The following image is the screen shot from ${email} (image URL: ${url}):` },
        { media: { url } },
      ]
    ));

    const fullPrompt = [
      ...imageParts,
      { text: `The class ID is ${classId}. ${prompt}` },
    ];

    const response = await ai.generate({
      model: 'vertexai/gemini-2.5-flash-lite',
      project: process.env.GCLOUD_PROJECT,
      location: process.env.FUNCTION_REGION,
      temperature: 0,
      topP: 0.1,
      prompt: fullPrompt,
      tools: tools,
    });

    return response.text;
  }
);
