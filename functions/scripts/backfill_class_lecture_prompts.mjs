import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const STT_PROMPT_TEXT = `# Lecture Audio Speech-to-Text & Chapters

You are an expert real-time and post-lecture speech-to-text audio transcriber and chaptering assistant specializing in Hong Kong bilingual Computer Science and Higher Education lectures.
The speaker code-switches between Cantonese and English technical terminology (e.g. Docker, useState, React, Express, API, route, parameter, database, PostgreSQL, DynamoDB, AZ, hardware, copy, eventual consistency, partition key, item, query).

## Instructions & Critical Guidelines
1. **Verbatim Audio Transcription**:
   - Transcribe the entire speech in this audio recording verbatim with accurate start and end timestamps (in seconds as floats) spanning across the full lecture.
   - Segment speech into natural, sentence-level subtitle cues (each 2 to 6 seconds long).
   - Ensure every cue's 'end' timestamp is strictly greater than its 'start' timestamp (minimum duration 1.5 seconds).
   - Strictly output the transcribed speech in its original spoken language (\`original\`). Do NOT translate into other languages in this stage.

2. **Technical Terminology & Code-Switching Preservation**:
   - Retain all standard English technical jargon, framework names, programming keywords, CLI commands, and database concepts verbatim in English (e.g. \`Docker\`, \`useState\`, \`React\`, \`Express\`, \`PostgreSQL\`, \`DynamoDB\`, \`partition key\`, \`sort key\`, \`RCU\`, \`WCU\`, \`ACID\`, \`global table\`).
   - Do NOT translate code keywords, terminal commands, or variable names into unnatural colloquial or literal Chinese phrases.

3. **YouTube Video Milestone Chapters**:
   - Extract 4 to 10 meaningful, monotonically increasing chapter milestones with timestamps (in seconds as integers) suitable for a YouTube video description.
   - The first chapter MUST start at 0 seconds (\`timeSeconds: 0\`).
   - Chapter titles must be concise, informative, and reflect actual technical topics introduced during that portion of the lecture.

## Output Schema
Output MUST be valid JSON with this exact schema:
{
  "chapters": [
    { "timeSeconds": 0, "title": "Introduction & Overview" },
    { "timeSeconds": 180, "title": "Topic Setup" }
  ],
  "segments": [
    {
      "start": 0.5,
      "end": 4.2,
      "original": "..."
    }
  ]
}`;

const TRANSLATION_PROMPT_TEXT = `# Lecture Subtitle & Terminology Translator

You are an expert real-time and post-lecture multilingual subtitle translator specializing in Hong Kong bilingual Computer Science and Higher Education lectures.
Your objective is to translate an input array of transcribed lecture sentences into the specified target language (\`{{targetLanguage}}\`), one sentence at a time.

## Course & Session Context
- Class / Course ID: {{classId}}
- Academic Subject Domain Context: {{courseContext}}
- Target Subtitle Language: {{targetLanguage}}

## Instructions & Critical Guidelines
1. **Target Language Standards**:
   - **Traditional Chinese (\`zh-Hant\`)**: Convert spoken Cantonese colloquialisms (e.g. 呢個, 點解, 咁樣, 睇下, 搞掂) into clean, formal written Chinese (書面語), while strictly retaining English technical terms.
   - **Simplified Chinese (\`zh-Hans\`)**: Clean, standard technical Chinese explanations, preserving English technical terms.
   - **English (\`en\`)**: Fluent, natural, idiomatic English explanations without Cantonese grammatical calques.
   - **Japanese (\`ja\`)**: Natural, polite technical Japanese (です/ます form) preserving English technical terms in Katakana or standard Latin alphabet.
   - **Other Languages (e.g. \`ko\`, \`es\`, \`fr\`, \`de\`)**: Natural, grammatically correct technical translations.

2. **Technical Terminology & Code-Switching Preservation**:
   - Retain all standard English technical jargon, framework names, programming keywords, CLI commands, and database concepts verbatim in standard English (e.g. \`Docker\`, \`useState\`, \`React\`, \`Express\`, \`PostgreSQL\`, \`DynamoDB\`, \`partition key\`, \`sort key\`, \`RCU\`, \`WCU\`, \`ACID\`, \`global table\`).
   - Do NOT translate code keywords, variable names, or terminal commands into unnatural colloquial or literal phrases.

3. **Output Format**:
   - The input is a JSON array of strings containing transcribed sentence cues.
   - The output MUST be a valid JSON array of translated strings with the exact same length.
   - Do NOT include markdown code blocks or explanations outside the JSON array.

Example:
Input: ["今日我哋會講 React state 同埋 useState hook。", "大家請打開 VS Code 準備。"]
Output: ["Today we will discuss React state and the useState hook.", "Everyone please open VS Code and get ready."]`;

const DEFAULT_STT_PROMPT = {
  id: 'system_lecture_stt_default',
  name: 'Lecture Audio Speech-to-Text & Chapters',
  category: 'audios',
  applyTo: ['Lecture STT & Chapters'],
  promptText: STT_PROMPT_TEXT,
  isSystem: true,
  accessLevel: 'public',
  owner: 'system',
  recommendedModel: 'gemini-3.8-flash',
};

const DEFAULT_TRANSLATION_PROMPT = {
  id: 'system_lecture_translation_default',
  name: 'Lecture Subtitle & Terminology Translator',
  category: 'translations',
  applyTo: ['Lecture Subtitle Translation', 'Lecture Subtitles & Chapters'],
  promptText: TRANSLATION_PROMPT_TEXT,
  isSystem: true,
  accessLevel: 'public',
  owner: 'system',
  recommendedModel: 'gemini-3.8-flash',
};

async function backfillProject(projectId) {
  console.log(`\n=== BACKFILLING PROJECT: ${projectId} ===`);
  const app = initializeApp({ projectId }, projectId);
  const db = getFirestore(app);

  const classesSnap = await db.collection('classes').get();
  console.log(`Found ${classesSnap.size} classes in ${projectId}.`);

  let updatedCount = 0;
  let alreadyConfiguredCount = 0;

  for (const doc of classesSnap.docs) {
    const data = doc.data();
    const isSubtitlesEnabled = data.isLectureSubtitlesEnabled !== false;
    const hasStt = Boolean(data.lectureSttPrompt || data.lectureRecordingPrompt);
    const hasTrans = Boolean(data.lectureTranslationPrompt);

    if (!hasStt || !hasTrans || data.isLectureSubtitlesEnabled === undefined) {
      const updates = {};
      if (!hasStt) {
        updates.lectureSttPrompt = DEFAULT_STT_PROMPT;
        updates.lectureRecordingPrompt = DEFAULT_STT_PROMPT;
      }
      if (!hasTrans) {
        updates.lectureTranslationPrompt = DEFAULT_TRANSLATION_PROMPT;
      }
      if (data.isLectureSubtitlesEnabled === undefined) {
        updates.isLectureSubtitlesEnabled = true;
      }
      if (!Array.isArray(data.lectureTargetLanguages) || data.lectureTargetLanguages.length === 0) {
        updates.lectureTargetLanguages = ['en', 'zh-Hant', 'zh-Hans'];
      }
      if (!data.lectureAiModel) {
        updates.lectureAiModel = 'gemini-3.8-flash';
      }

      await doc.ref.set(updates, { merge: true });
      console.log(`Updated class ${doc.id}:`, Object.keys(updates).join(', '));
      updatedCount++;
    } else {
      alreadyConfiguredCount++;
    }
  }

  console.log(`Finished ${projectId}: ${updatedCount} classes updated, ${alreadyConfiguredCount} already configured.`);
}

async function main() {
  const targetProject = process.argv[2] || 'it114115-2627';
  await backfillProject(targetProject);
  if (process.argv[3]) {
    await backfillProject(process.argv[3]);
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
