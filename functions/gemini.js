const { ai } = require('./ai.js');
const z = require('zod');
const { FieldValue } = require('firebase-admin/firestore');

let dbInstance; // To hold the initialized db

// Define the tool for sending messages to students
const sendMessageTool = ai.defineTool(
  {
    name: 'SendMessageToStudent',
    description: 'Sends a direct message to a specific student.',
    inputSchema: z.object({
      studentEmail: z.string().describe('The email address of the student to send the message to.'),
      message: z.string().describe('The content of the message.'),
      classId: z.string().optional().describe('Optional: The ID of the class this message pertains to.'),
    }),
    outputSchema: z.string(),
  },
  async ({ studentEmail, message, classId }) => {
    try {
      // Use the passed dbInstance
      const studentMessagesRef = dbInstance.collection('students').doc(studentEmail).collection('messages');
      const messageData = {
        message: message,
        timestamp: FieldValue.serverTimestamp(),
      };
      if (classId) {
        messageData.classId = classId;
      }
      await studentMessagesRef.add(messageData);
      return `Successfully sent message to ${studentEmail}.`;
    } catch (error) {
      console.error("Error sending message:", error);
      return `Failed to send message to ${studentEmail}. Error: ${error.message}`;
    }
  }
);

// Export a function to initialize the flows and tools
exports.initializeFlows = (db) => {
  dbInstance = db; // Store the initialized db

  exports.analyzeImagesFlow = ai.defineFlow(
    {
      name: 'analyzeImagesFlow',
      inputSchema: z.object({
        screenshots: z.record(z.string()),
        prompt: z.string(),
      }),
      outputSchema: z.record(z.string()),
    },
    async ({ screenshots, prompt }) => {
      const analysisResults = {};
      for (const [email, url] of Object.entries(screenshots)) {
        const response = await ai.generate({
                  model: 'vertexai/gemini-2.5-flash-lite',
                  project: process.env.GCLOUD_PROJECT,
                  location: process.env.FUNCTION_REGION,
                  temperature: 0,
                  topP: 0.1,
                  prompt: [
                    { media: { url } },
                    { text: `This screen belongs to ${email}. ${prompt}` },
                  ],
                  tools: [sendMessageTool], // Make tool available to the model
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
              }),
              outputSchema: z.string(),
            },
            async ({ screenshots, prompt }) => {
              const imageParts = Object.entries(screenshots).flatMap(([email, url]) => ([
                { text: `The following image is the screen shot from ${email}:` },
                { media: { url } },
              ]));
          
              const fullPrompt = [
                ...imageParts,
                { text: prompt },
              ];
          
              const response = await ai.generate({
                model: 'vertexai/gemini-2.5-flash-lite',
                project: process.env.GCLOUD_PROJECT,
                location: process.env.FUNCTION_REGION,
                temperature: 0,
                topP: 0.1,
                prompt: fullPrompt,
                tools: [sendMessageTool], // Make tool available to the model
              });
          
              return response.text;
            }
          );};