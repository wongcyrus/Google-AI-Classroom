const { ai } = require('./ai.js');
const z = require('zod');

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
        prompt: [
          { media: { url } },
          { text: prompt },
        ],
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
      prompt: fullPrompt,
    });

    return response.text;
  }
);