const { https } = require("firebase-functions");
const { VertexAI } = require('@google-cloud/vertexai');
const axios = require('axios');

// Initialize Vertex AI
const vertex_ai = new VertexAI({project: 'ai-invigilator-hkiit', location: 'us-central1'});
const model = 'gemini-2.5-flash-lite';

const generativeModel = vertex_ai.getGenerativeModel({
    model: model,
    generation_config: {
      "max_output_tokens": 2048,
      "temperature": 0.4,
      "top_p": 1,
      "top_k": 32,
    },
    safety_settings: [
        {
            "category": "HARM_CATEGORY_HARASSMENT",
            "threshold": "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
            "category": "HARM_CATEGORY_HATE_SPEECH",
            "threshold": "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
            "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            "threshold": "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
            "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
            "threshold": "BLOCK_MEDIUM_AND_ABOVE"
        }
    ],
});

async function analyzeImage(imageUrl, prompt) {
    try {
        const image_response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const image_base64 = Buffer.from(image_response.data).toString('base64');

        const request = {
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            inlineData: {
                                mimeType: 'image/jpeg',
                                data: image_base64,
                            }
                        },
                        {
                            text: prompt,
                        }
                    ]
                }
            ]
        };

        const result = await generativeModel.generateContent(request);
        const response = result.response;
        
        if (response && response.candidates && response.candidates.length > 0 && response.candidates[0].content && response.candidates[0].content.parts && response.candidates[0].content.parts.length > 0) {
            return response.candidates[0].content.parts[0].text;
        } else {
            // Log the response if it's not in the expected format
            console.error("Unexpected Gemini response format:", JSON.stringify(response));
            return "No text part in Gemini response: " + JSON.stringify(response);
        }
    } catch (error) {
        console.error("Error analyzing image:", error);
        return "Error calling Gemini: " + error.message;
    }
}

exports.analyzeImages = https.onCall(async (data, context) => {
    // Make sure the user is authenticated
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const { screenshots, prompt } = data;

    const analysisResults = {};
    for (const [email, url] of Object.entries(screenshots)) {
        analysisResults[email] = await analyzeImage(url, prompt);
    }
    return analysisResults;
});
