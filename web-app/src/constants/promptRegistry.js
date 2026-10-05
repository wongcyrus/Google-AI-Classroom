/**
 * Centralized Prompt Registry
 * Single Source of Truth for Prompt Categories, Types, Supported Placeholders,
 * Output Schemas, and UI Selector Configurations across Google AI Classroom.
 */

export const PROMPT_CATEGORIES = [
  {
    key: 'images',
    label: 'Image Prompts',
    icon: '📸',
    desc: 'Live screen invigilation & active presence question generation',
  },
  {
    key: 'videos',
    label: 'Video Prompts',
    icon: '🎥',
    desc: 'After-class multi-stream timeline and engagement analysis',
  },
  {
    key: 'audios',
    label: 'Voice / Audio Prompts',
    icon: '🎙️',
    desc: 'Audio invigilation, diarization, speech intent & verbatim STT',
  },
  {
    key: 'translations',
    label: 'Translation Prompts',
    icon: '🌐',
    desc: 'Multilingual subtitle & technical discipline terminology translation',
  },
  {
    key: 'rubrics',
    label: 'Task Rubric Prompts',
    icon: '📝',
    desc: 'Hands-on lab evaluation, demo step & milestone extraction',
  },
];

export const PROMPT_REGISTRY = {
  // ==========================================
  // 1. AUDIOS CATEGORY
  // ==========================================
  lecture_stt_chapters: {
    typeKey: 'lecture_stt_chapters',
    category: 'audios',
    applyTo: 'Lecture STT & Chapters',
    label: 'Lecture STT & Chapters',
    shortLabel: 'STT & Chapters',
    icon: '🎙️',
    description: 'Transcribes whole lecture audio verbatim and extracts YouTube chapter milestones.',
    recommendedModel: 'gemini-3.8-flash',
    pairedWith: 'lecture_subtitle_translation',
    pairedRole: 'Stage 1 of Paired Pipeline (Audio STT & Chapters)',
    supportedPlaceholders: [
      { tag: '{{classId}}', label: 'Class ID', desc: 'Course code identifier (e.g. itp4124-l)', required: false },
      { tag: '{{courseContext}}', label: 'Subject Domain', desc: 'Academic subject domain (e.g. Cloud Computing)', required: true },
      { tag: '{{title}}', label: 'Lecture Title', desc: 'Session title or topic', required: false },
      { tag: '{{topic}}', label: 'Lecture Topic', desc: 'Lesson topic', required: false },
      { tag: '{{durationHint}}', label: 'Duration Hint', desc: 'Expected recording duration in seconds', required: false },
      { tag: '{{totalDuration}}', label: 'Total Duration', desc: 'Recording duration boundary in seconds', required: false },
    ],
    outputSchema: {
      format: 'json_object',
      description: 'JSON object containing YouTube chapters array and verbatim speech segments array.',
      snippet: `{\n  "chapters": [\n    { "timeSeconds": 0, "title": "Introduction & Overview" },\n    { "timeSeconds": 180, "title": "Topic Setup" }\n  ],\n  "segments": [\n    { "start": 0.0, "end": 2.5, "original": "Verbatim transcribed sentence" }\n  ]\n}`,
    },
    placeholderText: 'Select a lecture recording prompt or enter custom verbatim transcription & chapters instructions...',
    defaultTemplateFile: 'admin/prompts/audios/Lecture Audio Speech-to-Text & Chapters.md',
  },

  live_audio_invigilation: {
    typeKey: 'live_audio_invigilation',
    category: 'audios',
    applyTo: 'Live Audio Invigilation',
    label: 'Live Audio Invigilation',
    shortLabel: 'Audio Invigilation',
    icon: '👂',
    description: 'Analyzes live classroom audio stream for whispering, unauthorized collaboration, or background chatter.',
    recommendedModel: 'gemini-3.5-flash-lite',
    supportedPlaceholders: [
      { tag: '{{classId}}', label: 'Class ID', desc: 'Course code identifier', required: false },
      { tag: '{{audioChunk}}', label: 'Audio Chunk', desc: 'Rolling audio chunk metadata', required: false },
    ],
    outputSchema: {
      format: 'json_object',
      description: 'JSON object with collaboration detection, confidence, and reasoning.',
      snippet: `{\n  "isCollaboration": false,\n  "confidence": 0.95,\n  "detectedSpeech": "...",\n  "reasoning": "Single speaker lecturing normally."\n}`,
    },
    placeholderText: 'Select an audio invigilation prompt or enter acoustic monitoring instructions...',
  },

  session_audio_summary: {
    typeKey: 'session_audio_summary',
    category: 'audios',
    applyTo: 'Session Audio Summary',
    label: 'Session Audio Summary',
    shortLabel: 'Discussion Summary',
    icon: '📋',
    description: 'Summarizes classroom discussion or lecture audio into structured minutes and action items.',
    recommendedModel: 'gemini-3.8-flash',
    supportedPlaceholders: [
      { tag: '{{classId}}', label: 'Class ID', desc: 'Course code identifier', required: false },
      { tag: '{{transcript}}', label: 'Transcript', desc: 'Verbatim classroom transcript text', required: false },
    ],
    outputSchema: {
      format: 'markdown',
      description: 'Markdown document with summary, key takeaways, and discussion topics.',
      snippet: `## Lecture Summary\n- Topic 1: Key insight...\n- Topic 2: Key insight...`,
    },
    placeholderText: 'Select a discussion summary prompt or enter custom audio summarization instructions...',
  },

  gemma_voice_intent: {
    typeKey: 'gemma_voice_intent',
    category: 'audios',
    applyTo: 'On-Device Gemma Voice Intent',
    label: 'On-Device Gemma Voice Intent',
    shortLabel: 'Gemma Voice Intent',
    icon: '⚡',
    description: 'On-device LiteRT-LM Gemma prompt for local voice command & student speech intent parsing.',
    recommendedModel: 'gemma-4-e2b-litert',
    supportedPlaceholders: [
      { tag: '{{studentVoiceCommand}}', label: 'Student Command', desc: 'Transcribed local voice command text', required: false },
    ],
    outputSchema: {
      format: 'json_object',
      description: 'JSON object with parsed intent, action, parameter, and confidence.',
      snippet: `{\n  "intent": "ask_question",\n  "action": "raise_hand",\n  "confidence": 0.98\n}`,
    },
    placeholderText: 'Enter on-device Gemma voice intent prompt or instructions...',
  },

  // ==========================================
  // 2. TRANSLATIONS CATEGORY
  // ==========================================
  lecture_subtitle_translation: {
    typeKey: 'lecture_subtitle_translation',
    category: 'translations',
    applyTo: 'Lecture Subtitle Translation',
    label: 'Lecture Subtitle Translation',
    shortLabel: 'Subtitle Translation',
    icon: '🌐',
    description: 'Translates batches of transcribed cues into a single target language, preserving CS & higher-ed terminology.',
    recommendedModel: 'gemini-3.8-flash',
    pairedWith: 'lecture_stt_chapters',
    pairedRole: 'Stage 2 of Paired Pipeline (Multilingual Translation)',
    supportedPlaceholders: [
      { tag: '{{classId}}', label: 'Class ID', desc: 'Course code identifier (e.g. itp4124-l)', required: false },
      { tag: '{{courseContext}}', label: 'Subject Domain', desc: 'Academic subject domain (e.g. Computer Science)', required: true },
      { tag: '{{targetLanguage}}', label: 'Target Language', desc: 'Target translation language (e.g. English (en), Traditional Chinese (zh-Hant))', required: true },
    ],
    outputSchema: {
      format: 'json_string_array',
      description: 'Flat JSON array of translated strings with the exact same length as input batch.',
      snippet: `[\n  "First translated sentence in target language",\n  "Second translated sentence in target language"\n]`,
    },
    placeholderText: 'Select a lecture translation prompt or enter custom translation & terminology rules...',
    defaultTemplateFile: 'admin/prompts/translations/Lecture Subtitle & Terminology Translator.md',
  },

  live_subtitles_translation: {
    typeKey: 'live_subtitles_translation',
    category: 'translations',
    applyTo: 'Live Subtitles & Translation',
    label: 'Live Subtitles & Translation',
    shortLabel: 'Live Subtitles',
    icon: '💬',
    description: 'Real-time streaming speech-to-text translation displayed in live classroom and student interfaces.',
    recommendedModel: 'gemini-3.5-flash-lite',
    supportedPlaceholders: [
      { tag: '{{subjectDomain}}', label: 'Subject Domain', desc: 'Context / Subject matter discipline', required: false },
      { tag: '{{historyText}}', label: 'Preceding Speech', desc: 'Preceding speech history for conversational context', required: false },
      { tag: '{{currentSpeech}}', label: 'Current Speech', desc: 'Current phrase or sentence to translate', required: false },
    ],
    outputSchema: {
      format: 'json_object',
      description: 'JSON object with translation, detectedLanguage, and key technical terms.',
      snippet: `{\n  "translation": "Translated text for live display",\n  "detectedLanguage": "yue",\n  "keyTerms": ["Docker", "useState"]\n}`,
    },
    placeholderText: 'Select a live subtitle translation prompt or enter custom live translation instructions...',
  },

  code_switching_lectures: {
    typeKey: 'code_switching_lectures',
    category: 'translations',
    applyTo: 'Code-Switching Lectures',
    label: 'Cantonese-English Code-Switching',
    shortLabel: 'Code-Switching',
    icon: '🔄',
    description: 'Converts mixed Cantonese-English classroom speech into formal written Chinese (書面語) while retaining technical terms.',
    recommendedModel: 'gemini-3.8-flash',
    supportedPlaceholders: [
      { tag: '{{classId}}', label: 'Class ID', desc: 'Course code identifier', required: false },
      { tag: '{{courseContext}}', label: 'Subject Domain', desc: 'Academic subject domain context', required: true },
      { tag: '{{targetLanguage}}', label: 'Target Language', desc: 'Target translation language', required: true },
    ],
    outputSchema: {
      format: 'json_string_array',
      description: 'Flat JSON array of translated strings.',
      snippet: `[\n  "書面語句子，保留 English Technical Terms"\n]`,
    },
    placeholderText: 'Enter custom Cantonese-English code-switching translation instructions...',
  },

  technical_glossary: {
    typeKey: 'technical_glossary',
    category: 'translations',
    applyTo: 'Technical Discipline Glossary',
    label: 'Technical Discipline Glossary',
    shortLabel: 'Glossary Grounding',
    icon: '📖',
    description: 'Domain-specific glossary grounding (e.g. Healthcare, Engineering, Accounting, IT) to prevent mistranslations.',
    recommendedModel: 'gemini-3.8-flash',
    supportedPlaceholders: [
      { tag: '{{classId}}', label: 'Class ID', desc: 'Course code identifier', required: false },
      { tag: '{{courseContext}}', label: 'Subject Domain', desc: 'Academic discipline glossary terms', required: true },
      { tag: '{{glossaryTerms}}', label: 'Glossary Terms', desc: 'Approved term translations mapping', required: false },
    ],
    outputSchema: {
      format: 'json_object',
      description: 'Structured terminology rules or mappings.',
      snippet: `{\n  "glossary": {\n    "partition key": "分區鍵 (Partition Key)",\n    "sort key": "排序鍵 (Sort Key)"\n  }\n}`,
    },
    placeholderText: 'Enter technical terminology glossary and translation constraints...',
  },

  lecture_subtitles_chapters_legacy: {
    typeKey: 'lecture_subtitles_chapters_legacy',
    category: 'translations',
    applyTo: 'Lecture Subtitles & Chapters',
    label: 'Lecture Subtitles & Chapters (Legacy)',
    shortLabel: 'Legacy Subtitles',
    icon: '📦',
    description: 'Backwards-compatibility target for legacy combined subtitle and chapter synthesis prompts.',
    recommendedModel: 'gemini-3.8-flash',
    supportedPlaceholders: [
      { tag: '{{classId}}', label: 'Class ID', desc: 'Course code identifier', required: false },
      { tag: '{{courseContext}}', label: 'Subject Domain', desc: 'Subject domain context', required: false },
    ],
    outputSchema: {
      format: 'json_object',
      description: 'Legacy combined output object.',
      snippet: `{\n  "chapters": [],\n  "segments": []\n}`,
    },
    placeholderText: 'Select a legacy subtitle prompt or enter custom instructions...',
  },

  // ==========================================
  // 3. IMAGES CATEGORY
  // ==========================================
  per_image_invigilation: {
    typeKey: 'per_image_invigilation',
    category: 'images',
    applyTo: 'Per Image',
    label: 'Per Image',
    shortLabel: 'Per Image',
    icon: '👤',
    description: 'Analyzes individual student screen captures and camera feeds for gaze, face presence, and forbidden software.',
    recommendedModel: 'gemini-3.5-flash-lite',
    supportedPlaceholders: [
      { tag: '{{studentName}}', label: 'Student Name', desc: 'Student display name or ID', required: false },
      { tag: '{{screenCapture}}', label: 'Screen Image', desc: 'Visual desktop stream capture', required: false },
    ],
    outputSchema: {
      format: 'json_object',
      description: 'JSON object with status (normal/warning/critical), irregularityType, and explanation.',
      snippet: `{\n  "status": "normal",\n  "irregularityType": "none",\n  "confidence": 0.98,\n  "explanation": "Student actively coding in VS Code."\n}`,
    },
    placeholderText: 'Select an image prompt or enter custom visual invigilation instructions here...',
  },

  all_images_invigilation: {
    typeKey: 'all_images_invigilation',
    category: 'images',
    applyTo: 'All Images',
    label: 'All Images',
    shortLabel: 'All Images Grid',
    icon: '👥',
    description: 'Processes multi-student grid captures or instructor presentation streams for classroom-wide attention, engagement, and anomaly detection.',
    recommendedModel: 'gemini-3.5-flash-lite',
    supportedPlaceholders: [
      { tag: '{{classId}}', label: 'Class ID', desc: 'Course code identifier', required: false },
      { tag: '{{teacherScreenImage}}', label: 'Teacher Screen', desc: 'Instructor slide or IDE broadcast capture', required: false },
    ],
    outputSchema: {
      format: 'text',
      description: 'Structured classroom-wide invigilation assessment with student observations, engagement levels, and anomaly flags.',
      snippet: `Classroom Grid Invigilation Report:\n- 24/25 active in designated IDE.\n- 1 student idle or running unauthorized application.\n- Overall engagement: High.`,
    },
    placeholderText: 'Select a classroom grid invigilation prompt or enter multi-screen analysis instructions...',
  },

  classroom_bingo_question: {
    typeKey: 'classroom_bingo_question',
    category: 'images',
    applyTo: 'Classroom Bingo Questions',
    label: 'Classroom Bingo Questions',
    shortLabel: 'Bingo Questions',
    icon: '🎯',
    description: 'Formulates 4-option attendance verification and active presence multiple-choice questions from student screens, teacher slides, or lesson topics.',
    recommendedModel: 'gemini-3.5-flash-lite',
    supportedPlaceholders: [
      { tag: '{{topic}}', label: 'Lesson Topic', desc: 'Topic or lesson material for question bank generation', required: false },
      { tag: '{{count}}', label: 'Question Count', desc: 'Number of questions to generate (1-15)', required: false },
      { tag: '{{teacherScreenImage}}', label: 'Teacher Screen', desc: 'Instructor screen capture for attention check questions', required: false },
      { tag: '{{studentScreenImage}}', label: 'Student Screen', desc: 'Student screen screenshot for presence verification questions', required: false },
      { tag: '{{captionContext}}', label: 'Spoken Commentary', desc: 'Recent instructor spoken commentary/captions', required: false },
      { tag: '{{recentQuestions}}', label: 'Recent Questions', desc: 'List of recently generated questions to prevent duplication', required: false },
    ],
    outputSchema: {
      format: 'json_object',
      description: 'JSON object with multiple-choice question, exactly 4 options, 0-based correctIndex, and observedEvidence.',
      snippet: `{\n  "question": "Which AWS service is currently displayed on screen?",\n  "options": ["Amazon S3", "Amazon DynamoDB", "AWS Lambda", "Amazon EC2"],\n  "correctIndex": 1,\n  "observedEvidence": "DynamoDB console is displayed on screen."\n}`,
    },
    placeholderText: 'Select a Bingo question prompt or enter custom 4-option question formulation instructions...',
  },

  // ==========================================
  // 4. VIDEOS CATEGORY
  // ==========================================
  after_class_video: {
    typeKey: 'after_class_video',
    category: 'videos',
    applyTo: 'Per Video',
    label: 'Per Video',
    shortLabel: 'Per Video',
    icon: '🎥',
    description: 'Processes combined multi-stream recording after class to evaluate student engagement, burnout, and task progress.',
    recommendedModel: 'gemini-3.8-flash',
    supportedPlaceholders: [
      { tag: '{{classId}}', label: 'Class ID', desc: 'Course code identifier', required: false },
      { tag: '{{studentRecords}}', label: 'Student Records', desc: 'Summary of session student interactions', required: false },
    ],
    outputSchema: {
      format: 'json_object',
      description: 'JSON object with engagement metrics, timeline anomalies, and summary.',
      snippet: `{\n  "overallEngagement": 85,\n  "timeline": [\n    { "timeMinutes": 10, "observation": "Focused on coding lab" }\n  ],\n  "burnoutIndicators": "none"\n}`,
    },
    placeholderText: 'Select a prompt or enter text here...',
  },

  // ==========================================
  // 5. RUBRICS CATEGORY
  // ==========================================
  lab_rubric_milestones: {
    typeKey: 'lab_rubric_milestones',
    category: 'rubrics',
    applyTo: 'Lab Rubric Milestones',
    label: 'Lab Rubric Milestones',
    shortLabel: 'Milestone Extractor',
    icon: '📑',
    description: 'Extracts observable demonstration milestones and grading weights from lab worksheets or teacher demonstration videos.',
    recommendedModel: 'gemini-3.8-flash',
    supportedPlaceholders: [
      { tag: '{{courseContext}}', label: 'Subject Domain', desc: 'Academic subject domain', required: true },
      { tag: '{{labGuideText}}', label: 'Lab Worksheet', desc: 'Raw text of lab instructions and tasks', required: false },
    ],
    outputSchema: {
      format: 'json_array',
      description: 'JSON array of milestones with title, criteria, and weight.',
      snippet: `[\n  {\n    "id": "step_1",\n    "title": "Configure Security Group",\n    "weight": 20,\n    "criteria": ["Allow port 80 HTTP", "Restrict SSH to instructor IP"]\n  }\n]`,
    },
    placeholderText: 'Select a rubric extraction prompt or enter milestone extraction rules...',
  },

  task_milestones_extraction: {
    typeKey: 'task_milestones_extraction',
    category: 'rubrics',
    applyTo: 'Task Milestones Extraction',
    label: 'Task Milestones Extraction',
    shortLabel: 'Submission Evaluator',
    icon: '🎯',
    description: 'Automates grading and constructive feedback on student practical code or cloud resource submissions against rubrics.',
    recommendedModel: 'gemini-3.8-flash',
    supportedPlaceholders: [
      { tag: '{{taskDescription}}', label: 'Task Description', desc: 'Practical lab task specifications', required: false },
      { tag: '{{demoSteps}}', label: 'Demo Steps', desc: 'Expected milestones and rubric criteria', required: false },
      { tag: '{{studentSubmission}}', label: 'Submission', desc: 'Student code or screen recording artifacts', required: false },
    ],
    outputSchema: {
      format: 'json_object',
      description: 'JSON object with final score, feedback comments, and milestone-by-milestone marks.',
      snippet: `{\n  "score": 90,\n  "feedback": "Excellent configuration with clean code.",\n  "rubricScores": [\n    { "milestoneId": "step_1", "score": 20, "notes": "Port 80 correctly opened." }\n  ]\n}`,
    },
    placeholderText: 'Select a task evaluation prompt or enter automated assessment instructions...',
  },
};

/**
 * Returns prompt type definition matching a given applyTo string.
 */
export function getPromptTypeByApplyTo(applyTo) {
  if (!applyTo) return null;
  const target = Array.isArray(applyTo) ? applyTo[0] : applyTo;
  return Object.values(PROMPT_REGISTRY).find((p) => p.applyTo === target) || null;
}

/**
 * Returns all prompt types belonging to a specific category.
 */
export function getPromptTypesByCategory(category) {
  if (!category) return Object.values(PROMPT_REGISTRY);
  return Object.values(PROMPT_REGISTRY).filter((p) => p.category === category);
}

/**
 * Returns all applyTo string values for a category.
 */
export function getAllApplyToOptions(category) {
  return getPromptTypesByCategory(category).map((p) => p.applyTo);
}

/**
 * Resolves the list of supported placeholders for a prompt object or an applyTo array.
 */
export function getPlaceholdersForPrompt(promptOrApplyTo) {
  if (!promptOrApplyTo) return [];
  const applyToList = Array.isArray(promptOrApplyTo)
    ? promptOrApplyTo
    : Array.isArray(promptOrApplyTo?.applyTo)
      ? promptOrApplyTo.applyTo
      : [promptOrApplyTo?.applyTo || promptOrApplyTo];

  const placeholderMap = new Map();
  for (const applyTo of applyToList) {
    const pType = getPromptTypeByApplyTo(applyTo);
    if (pType && Array.isArray(pType.supportedPlaceholders)) {
      pType.supportedPlaceholders.forEach((ph) => {
        if (!placeholderMap.has(ph.tag)) {
          placeholderMap.set(ph.tag, ph);
        }
      });
    }
  }

  return Array.from(placeholderMap.values());
}

/**
 * Resolves the primary output schema for a prompt object or an applyTo array.
 */
export function getOutputSchemaForPrompt(promptOrApplyTo) {
  if (!promptOrApplyTo) return null;
  const applyToList = Array.isArray(promptOrApplyTo)
    ? promptOrApplyTo
    : Array.isArray(promptOrApplyTo?.applyTo)
      ? promptOrApplyTo.applyTo
      : [promptOrApplyTo?.applyTo || promptOrApplyTo];

  for (const applyTo of applyToList) {
    const pType = getPromptTypeByApplyTo(applyTo);
    if (pType?.outputSchema) {
      return pType.outputSchema;
    }
  }
  return null;
}

/**
 * Resolves standard textarea placeholder for selector components.
 */
export function getPlaceholderTextForSelector(category, applyToFilter = null) {
  if (applyToFilter === 'Classroom Bingo Questions' || applyToFilter === 'bingo') {
    return 'Select a Bingo question prompt or enter custom 4-option question formulation instructions...';
  }
  if (applyToFilter === 'Per Image' || applyToFilter === 'invigilation') {
    return 'Select an image prompt or enter custom visual invigilation instructions here...';
  }
  if (applyToFilter === 'Lecture STT & Chapters' || (category === 'audios' && applyToFilter === 'Lecture Subtitles & Chapters')) {
    return 'Select a lecture recording prompt or enter custom verbatim transcription & chapters instructions here...';
  }
  if (applyToFilter === 'Live Subtitles & Translation') {
    return 'Select a live subtitle translation prompt or enter custom instructions here...';
  }
  if (applyToFilter === 'Lecture Subtitle Translation' || (category === 'translations' && applyToFilter === 'Lecture Subtitles & Chapters')) {
    return 'Select a lecture translation prompt or enter custom translation rules here...';
  }
  if (applyToFilter) {
    const pType = getPromptTypeByApplyTo(applyToFilter);
    if (pType?.placeholderText) return pType.placeholderText;
  }
  const defaultMap = {
    audios: 'Select an audio prompt or enter custom speech & acoustic instructions here...',
    translations: 'Select a translation prompt or enter custom translation rules here...',
    images: 'Select an image prompt or enter custom visual invigilation instructions here...',
    videos: 'Select a prompt or enter text here...',
    rubrics: 'Select a rubric prompt or enter task evaluation instructions here...',
  };
  return defaultMap[category] || 'Select a prompt or enter custom instructions here...';
}

/**
 * Resolves standard dropdown default option text for selector components.
 */
export function getDropdownPlaceholderForSelector(category, applyToFilter = null) {
  if (applyToFilter === 'Classroom Bingo Questions' || applyToFilter === 'bingo') {
    return '-- Select a Classroom Bingo Question prompt --';
  }
  if (applyToFilter === 'Per Image' || applyToFilter === 'invigilation') {
    return '-- Select an image invigilation AI prompt --';
  }
  if (applyToFilter === 'Lecture STT & Chapters' || (category === 'audios' && applyToFilter === 'Lecture Subtitles & Chapters')) {
    return '-- Select a lecture speech-to-text (STT) & chapters prompt --';
  }
  if (applyToFilter === 'Live Subtitles & Translation') {
    return '-- Select a live subtitle translation prompt --';
  }
  if (applyToFilter === 'Lecture Subtitle Translation' || (category === 'translations' && applyToFilter === 'Lecture Subtitles & Chapters')) {
    return '-- Select a subtitle translation prompt --';
  }
  if (applyToFilter) {
    const pType = getPromptTypeByApplyTo(applyToFilter);
    if (pType?.label) return `-- Select a ${pType.label.toLowerCase()} prompt --`;
  }
  const defaultMap = {
    audios: '-- Select a voice/audio prompt --',
    translations: '-- Select a subtitle translation prompt --',
    images: '-- Select an image invigilation AI prompt --',
    videos: '-- Select a prompt --',
    rubrics: '-- Select a task rubric AI prompt --',
  };
  return defaultMap[category] || '-- Select a prompt --';
}

/**
 * Validates prompt text against required placeholders for all selected applyTo targets.
 * @param {string} promptText - The prompt template content.
 * @param {string|string[]} applyTo - Selected applyTo target(s).
 * @returns {{ isValid: boolean, missingPlaceholders: Array<{ tag: string, label: string }>, errors: string[] }}
 */
export function validatePrompt(promptText, applyTo) {
  if (!promptText || typeof promptText !== 'string' || !promptText.trim()) {
    return { isValid: false, missingPlaceholders: [], errors: ['Prompt text cannot be empty.'] };
  }

  const applyToList = Array.isArray(applyTo) ? applyTo : [applyTo].filter(Boolean);
  const placeholders = getPlaceholdersForPrompt(applyToList);
  const requiredPlaceholders = placeholders.filter((p) => p.required);

  const missingPlaceholders = requiredPlaceholders.filter((p) => !promptText.includes(p.tag));
  const errors = missingPlaceholders.map((p) => `Missing required placeholder: ${p.tag} (${p.label})`);

  return {
    isValid: errors.length === 0,
    missingPlaceholders,
    errors,
  };
}
