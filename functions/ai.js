const { genkit } = require('genkit');
const { vertexAI } = require('@genkit-ai/google-genai');

const ai = genkit({
  plugins: [
    vertexAI(),
  ],
});

module.exports = { ai };
