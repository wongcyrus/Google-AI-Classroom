import './firebase.js';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { FUNCTION_REGION, AI_MODEL, DEFAULT_LECTURE_AI_MODEL } from './config.js';
import { generateWithResilience } from './analysisFlows.js';
import { calculateCost } from './cost.js';
import { logJob } from './jobLogger.js';

const db = getFirestore();
const storage = getStorage();

/**
 * Probes the precise duration in seconds of a media file via ffmpeg.
 */
export function getMediaDurationSeconds(filePath) {
  try {
    const out = execSync(`${ffmpegPath} -i "${filePath}" -f null - 2>&1`).toString();
    const matches = [...out.matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)];
    if (matches.length > 0) {
      const last = matches[matches.length - 1];
      const hours = parseFloat(last[1]);
      const mins = parseFloat(last[2]);
      const secs = parseFloat(last[3]);
      return hours * 3600 + mins * 60 + secs;
    }
  } catch (err) {
    const out = String(err.stdout || err.stderr || err);
    const matches = [...out.matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)];
    if (matches.length > 0) {
      const last = matches[matches.length - 1];
      const hours = parseFloat(last[1]);
      const mins = parseFloat(last[2]);
      const secs = parseFloat(last[3]);
      return hours * 3600 + mins * 60 + secs;
    }
  }
  return 0;
}

/**
 * Formats seconds (e.g. 74.25) to WebVTT timestamp format: HH:MM:SS.mmm
 */
export function formatTimestampToVTT(seconds) {
  const totalMs = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
  const ms = totalMs % 1000;
  const totalSecs = Math.floor(totalMs / 1000);
  const secs = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const mins = totalMins % 60;
  const hrs = Math.floor(totalMins / 60);

  const hh = String(hrs).padStart(2, '0');
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const mmm = String(ms).padStart(3, '0');

  return `${hh}:${mm}:${ss}.${mmm}`;
}


/**
 * Formats seconds to SubRip (.srt) timestamp format: HH:MM:SS,mmm
 * Note: SubRip format uses a comma instead of a period before milliseconds.
 */
export function formatTimestampToSRT(seconds) {
  return formatTimestampToVTT(seconds).replace('.', ',');
}

/**
 * Converts a list of subtitle segments into standard WebVTT text.
 */
export function buildWebVTT(segments = [], languageKey = 'original') {
  let vtt = 'WEBVTT\n\n';

  segments.forEach((seg, idx) => {
    const text = (
      languageKey === 'original'
        ? seg.original
        : seg.translations?.[languageKey] || seg.original || ''
    ).trim();

    if (!text) return;

    const start = Number(seg.start) || 0;
    let end = Number(seg.end) || 0;

    // Guard against 0 or negative duration cues that browsers discard:
    if (end <= start) {
      const nextSeg = segments[idx + 1];
      const nextStart = nextSeg ? Number(nextSeg.start) : Infinity;
      const minDisplayDur = Math.max(1.8, Math.min(5.0, text.length * 0.25));
      end = Math.min(nextStart > start ? nextStart : start + minDisplayDur, start + minDisplayDur);
    }

    vtt += `${idx + 1}\n`;
    vtt += `${formatTimestampToVTT(start)} --> ${formatTimestampToVTT(end)}\n`;
    vtt += `${text}\n\n`;
  });

  return vtt;
}

/**
 * Converts a list of subtitle segments into standard SubRip (.srt) text for YouTube.
 */
export function buildSRT(segments = [], languageKey = 'original') {
  let srt = '';

  segments.forEach((seg, idx) => {
    const text = (
      languageKey === 'original'
        ? seg.original
        : seg.translations?.[languageKey] || seg.original || ''
    ).trim();

    if (!text) return;

    const start = Number(seg.start) || 0;
    let end = Number(seg.end) || 0;

    // Guard against 0 or negative duration cues that players discard:
    if (end <= start) {
      const nextSeg = segments[idx + 1];
      const nextStart = nextSeg ? Number(nextSeg.start) : Infinity;
      const minDisplayDur = Math.max(1.8, Math.min(5.0, text.length * 0.25));
      end = Math.min(nextStart > start ? nextStart : start + minDisplayDur, start + minDisplayDur);
    }

    srt += `${idx + 1}\n`;
    srt += `${formatTimestampToSRT(start)} --> ${formatTimestampToSRT(end)}\n`;
    srt += `${text}\n\n`;
  });

  return srt;
}

/**
 * Formats chapter list into a YouTube description timestamp index.
 */
export function formatYouTubeChapters(chapters = []) {
  if (!Array.isArray(chapters) || chapters.length === 0) {
    return '00:00 - Introduction\n';
  }

  return chapters
    .map((ch) => {
      const s = Math.max(0, Math.floor(ch.timeSeconds || 0));
      const mins = Math.floor(s / 60);
      const secs = s % 60;
      const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      return `${timeStr} - ${ch.title || 'Section'}`;
    })
    .join('\n');
}

/**
 * Generates ready-to-copy YouTube Title and Description package.
 */
export function generateYouTubeMetadata({
  classId,
  title,
  topic,
  chapters = [],
  availableLanguages = [],
}) {
  const today = new Date().toISOString().split('T')[0];
  const ytTitle = `${classId} - ${title || topic || 'Lecture Recording'} (${today})`;

  const langNames = {
    original: 'Original (Cantonese/English)',
    en: 'English',
    'zh-Hant': 'Traditional Chinese (繁體中文)',
    'zh-Hans': 'Simplified Chinese (简体中文)',
    ja: 'Japanese (日本語)',
  };

  const langsList = availableLanguages
    .map((l) => `- ${langNames[l] || l}`)
    .join('\n');

  const chaptersBlock = formatYouTubeChapters(chapters);

  const description = `${title || topic || 'Lecture Recording'}
Course / Class: ${classId}
Recorded Date: ${today}

Timestamps & Chapters:
${chaptersBlock}

Closed Captions (CC) Available in YouTube Player:
${langsList}

Recorded with Google AI Classroom.`;

  return { title: ytTitle, description };
}

/**
 * Escapes unescaped raw newlines/tabs inside JSON string literals.
 * Prevents JSON5 and JSON.parse syntax errors when LLM output contains unescaped newlines in cue text.
 */
export function sanitizeJsonStringNewlines(str) {
  if (!str || typeof str !== 'string') return '';
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (escaped) {
      result += c;
      escaped = false;
      continue;
    }
    if (c === '\\') {
      escaped = true;
      result += c;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      result += c;
      continue;
    }
    if (inString) {
      if (c === '\n') {
        result += '\\n';
        continue;
      }
      if (c === '\r') {
        continue;
      }
      if (c === '\t') {
        result += '\\t';
        continue;
      }
    }
    result += c;
  }
  return result;
}

/**
 * Robust JSON parser for LLM responses.
 * Safely strips markdown code blocks, cleans unescaped control characters,
 * sanitizes unescaped newlines in strings, removes trailing commas,
 * and auto-repairs truncated JSON objects/arrays.
 */
export function parseAiJsonResponse(text) {
  if (!text || typeof text !== 'string') return null;
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  cleaned = cleaned.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F]/g, ' ');

  // 1. Direct parse
  try {
    return JSON.parse(cleaned);
  } catch {}

  // 2. Sanitize unescaped newlines inside JSON string literals
  const sanitized = sanitizeJsonStringNewlines(cleaned);
  try {
    return JSON.parse(sanitized);
  } catch {}

  // 3. Remove trailing commas iteratively
  try {
    let withoutTrailingCommas = sanitized;
    let prev;
    do {
      prev = withoutTrailingCommas;
      withoutTrailingCommas = withoutTrailingCommas.replace(/,\s*([}\]])/g, '$1');
    } while (withoutTrailingCommas !== prev);
    return JSON.parse(withoutTrailingCommas);
  } catch {}

  // 4. Auto-close truncated JSON arrays / objects if truncated at token limit
  try {
    let repaired = sanitized;
    const lastBrace = repaired.lastIndexOf('}');
    if (lastBrace !== -1) {
      repaired = repaired.slice(0, lastBrace + 1);
      const openBrackets = (repaired.match(/\[/g) || []).length;
      const closeBrackets = (repaired.match(/\]/g) || []).length;
      for (let k = 0; k < openBrackets - closeBrackets; k++) {
        repaired += '\n]';
      }
      const openBraces = (repaired.match(/\{/g) || []).length;
      const closeBraces = (repaired.match(/\}/g) || []).length;
      for (let k = 0; k < openBraces - closeBraces; k++) {
        repaired += '\n}';
      }
      let prev;
      do {
        prev = repaired;
        repaired = repaired.replace(/,\s*([}\]])/g, '$1');
      } while (repaired !== prev);
      return JSON.parse(repaired);
    }
  } catch {}

  return null;
}

/**
 * Fallback regex extractor for subtitle segments and chapter milestones when LLM output
 * contains JSON syntax irregularities (e.g. unescaped quotes inside spoken sentences).
 */
export function extractSegmentsAndChaptersByRegex(text) {
  if (!text || typeof text !== 'string') return null;

  const segments = [];
  const segRegex = /\{\s*["']start["']\s*:\s*([\d.]+)\s*,\s*["']end["']\s*:\s*([\d.]+)\s*,\s*["'](?:original|text)["']\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = segRegex.exec(text)) !== null) {
    segments.push({
      start: parseFloat(m[1]),
      end: parseFloat(m[2]),
      original: m[3].replace(/\\"/g, '"').replace(/\\n/g, '\n'),
    });
  }

  const chapters = [];
  const chRegex = /\{\s*["']timeSeconds["']\s*:\s*(\d+)\s*,\s*["']title["']\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
  while ((m = chRegex.exec(text)) !== null) {
    chapters.push({
      timeSeconds: parseInt(m[1], 10),
      title: m[2].replace(/\\"/g, '"'),
    });
  }

  if (segments.length > 0) {
    return {
      chapters: chapters.length > 0 ? chapters : undefined,
      segments,
    };
  }
  return null;
}

/**
 * Resolves the optimal storage path for Gemini transcription.
 * Prioritizes parallel audio-only track (~25MB Opus) over composite video (~1.2GB).
 */
export function resolveEffectiveStoragePath(sessionData = {}, requestedStoragePath = null) {
  const effectiveAudioPath =
    sessionData.normalizedAudioStoragePath ||
    sessionData.audioStoragePath ||
    (requestedStoragePath && (requestedStoragePath.includes('audio') || requestedStoragePath.endsWith('.mp3')) ? requestedStoragePath : null);
  const effectiveStoragePath = effectiveAudioPath || requestedStoragePath || sessionData.storagePath || null;
  const transcriptionSource = effectiveAudioPath ? 'audio_only' : 'video';
  return { effectiveStoragePath, transcriptionSource };
}

/**
 * Calibrates subtitle segment timestamps and chapter offsets against actual media duration.
 * Fixes Gemini internal timescale drift where cues run faster than wall clock playback.
 */
export function calibrateSubtitleTimeline(segments = [], chapters = [], totalDuration = 0) {
  if (!Array.isArray(segments) || segments.length === 0 || !totalDuration || totalDuration <= 0) {
    return { segments, chapters, driftRatio: 1.0 };
  }

  const rawMaxEnd = Math.max(...segments.map((s) => Number(s.end) || 0));
  if (rawMaxEnd <= 0 || totalDuration <= rawMaxEnd) {
    return { segments, chapters, driftRatio: 1.0 };
  }

  const driftRatio = totalDuration / rawMaxEnd;
  if (driftRatio <= 1.05) {
    return { segments, chapters, driftRatio: 1.0 };
  }

  const calibratedSegments = segments.map((seg) => ({
    ...seg,
    start: Math.round((Number(seg.start) || 0) * driftRatio * 1000) / 1000,
    end: Math.min(totalDuration, Math.round((Number(seg.end) || 0) * driftRatio * 1000) / 1000),
  }));

  const calibratedChapters = (Array.isArray(chapters) ? chapters : []).map((ch) => ({
    ...ch,
    timeSeconds: Math.min(Math.round(totalDuration), Math.round((Number(ch.timeSeconds) || 0) * driftRatio)),
  }));

  return {
    segments: calibratedSegments,
    chapters: calibratedChapters,
    driftRatio,
  };
}

/**
 * Constructs the single-pass Gemini prompt for audio transcription and chaptering.
 * Strictly requests verbatim speech transcription and YouTube chapters without
 * inline multilingual translation, avoiding output token exhaustion (>65k tokens)
 * and Node.js fetch connection timeouts.
 */
export function buildLectureSubtitlePrompt({
  promptPreamble = '',
  classId = '',
  title = '',
  topic = '',
  durationHint = '',
  interruptionHint = '',
  totalDuration = 0,
}) {
  return `${promptPreamble}
Class: ${classId}
Title: ${title}
Topic: ${topic}${durationHint}${interruptionHint}

Instructions:
1. Transcribe the entire speech in this audio recording verbatim with accurate start and end timestamps (in seconds as floats) spanning from 0.0 to ${totalDuration > 0 ? Math.round(totalDuration) : 'the end of'} seconds across the full lecture.
2. Segment speech into natural sentence-level subtitle cues (each 2 to 6 seconds long). Each cue's 'end' timestamp MUST be strictly greater than its 'start' timestamp (e.g. end >= start + 1.5).
3. Retain all English technical words (e.g. Docker, useState, React, Express, API, route, parameter, database, PostgreSQL, DynamoDB). Do NOT translate code keywords or variable names into unnatural Chinese.
4. Extract 4 to 10 high-level chapter milestones with timestamps (in seconds) suitable for a YouTube video description.

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
}

/**
 * Constructs the language-by-language subtitle translation prompt.
 * Translates an array of transcribed sentence strings into a single target language,
 * preserving CS terminology and outputting a flat JSON array of strings.
 */
export function buildLectureTranslationPrompt({
  template = '',
  classId = '',
  subjectDomain = '',
  targetLanguage = '',
  chunk = [],
}) {
  const langLabelMap = {
    en: 'English (en)',
    'zh-Hant': 'Traditional Chinese (zh-Hant - 繁體中文書面語)',
    'zh-Hans': 'Simplified Chinese (zh-Hans - 简体中文)',
    ja: 'Japanese (ja - 日本語)',
    ko: 'Korean (ko - 한국어)',
    es: 'Spanish (es - Español)',
    fr: 'French (fr - Français)',
    de: 'German (de - Deutsch)',
  };
  const targetLangDisplay = langLabelMap[targetLanguage] || targetLanguage;

  let baseInstructions = '';
  if (template) {
    baseInstructions = template
      .replace(/\{\{classId\}\}/g, classId)
      .replace(/\{\{courseContext\}\}/g, subjectDomain)
      .replace(/\{\{subjectDomain\}\}/g, subjectDomain)
      .replace(/\{\{targetLanguage\}\}/g, targetLangDisplay)
      .replace(/\{\{spokenLanguage\}\}/g, 'Cantonese / English')
      .replace(/\{\{speechText\}\}/g, '[Transcribed lecture speech segments]');
  } else {
    baseInstructions = `# Lecture Subtitle & Terminology Translator
You are an expert multilingual subtitle translator specializing in Hong Kong bilingual Computer Science and Higher Education lectures.
Translate each transcribed lecture sentence into ${targetLangDisplay}, one sentence at a time.
Class: ${classId}
Academic Subject Domain: ${subjectDomain}

Guidelines:
1. Traditional Chinese (zh-Hant): Convert Cantonese colloquialisms into clean, formal written Chinese (書面語), while strictly retaining English technical terms.
2. English (en): Fluent, natural, idiomatic technical English without Cantonese grammatical calques.
3. Technical Terminology: Retain all standard English technical jargon, framework names, programming keywords, CLI commands, and database concepts verbatim in English (e.g. Docker, useState, React, Express, PostgreSQL, DynamoDB, partition key, sort key, RCU, WCU, ACID). Do NOT translate code keywords or variable names into literal Chinese.`;
  }

  return `${baseInstructions}

Input array of ${chunk.length} sentences:
${JSON.stringify(chunk, null, 2)}

Output MUST be a valid JSON array of translated strings with the exact same length (${chunk.length}):
[
  "..."
]`;
}

/**
 * Ensures all subtitle cues have non-empty translations for all required languages.
 * Falls back to original text if a translation is missing or blank.
 */
export function ensureSegmentTranslations(segments = [], targetLanguages = []) {
  if (!Array.isArray(segments)) return [];
  for (const seg of segments) {
    if (!seg.translations) seg.translations = {};
    for (const lang of targetLanguages) {
      if (!seg.translations[lang] || typeof seg.translations[lang] !== 'string' || !seg.translations[lang].trim()) {
        seg.translations[lang] = seg.original;
      }
    }
  }
  return segments;
}

/**
 * Ensures the lecture audio track is normalized to standard 48kHz Constant Bitrate MP3.
 * Prevents Gemini timescale distortion where raw WebM Opus (48kHz decoded against 32kHz timescale)
 * causes subtitles to run ~1.48x faster than the video playback.
 */
export async function normalizeLectureAudio({
  bucket,
  classId,
  sessionId,
  rawAudioPath,
  normalizedStoragePath = null,
  sessionRef = null,
}) {
  if (!rawAudioPath) return null;
  if (rawAudioPath.endsWith('.mp3')) return rawAudioPath;

  const candidateNormalized = `recordings/${classId}/${sessionId}/lecture_audio_normalized.mp3`;

  // 1. If explicit normalizedStoragePath provided and exists, return it
  if (normalizedStoragePath) {
    try {
      const [exists] = await bucket.file(normalizedStoragePath).exists();
      if (exists) return normalizedStoragePath;
    } catch {}
  }

  // 2. Check if candidate normalized MP3 already exists in bucket
  try {
    const [normExists] = await bucket.file(candidateNormalized).exists();
    if (normExists) return candidateNormalized;
  } catch {}

  // 3. Perform FFmpeg transcoding to standard 48kHz Constant Bitrate MP3
  let tmpRaw = null;
  let tmpMp3 = null;
  try {
    const tmpDir = os.tmpdir();
    tmpRaw = path.join(tmpDir, `aud_norm_in_${Date.now()}_${path.basename(rawAudioPath)}`);
    tmpMp3 = path.join(tmpDir, `aud_norm_out_${Date.now()}_lecture_audio_normalized.mp3`);

    const sourceFile = bucket.file(rawAudioPath);
    if (typeof sourceFile.download === 'function') {
      await sourceFile.download({ destination: tmpRaw });
    }

    if (fs.existsSync(tmpRaw) && fs.statSync(tmpRaw).size > 0) {
      execSync(`${ffmpegPath} -y -i "${tmpRaw}" -vn -c:a libmp3lame -b:a 128k -ar 48000 "${tmpMp3}"`, { stdio: 'ignore' });
      if (fs.existsSync(tmpMp3) && fs.statSync(tmpMp3).size > 0) {
        const token = crypto.randomUUID();
        await bucket.upload(tmpMp3, {
          destination: candidateNormalized,
          metadata: {
            contentType: 'audio/mpeg',
            metadata: { firebaseStorageDownloadTokens: token },
          },
        });

        const probedDuration = getMediaDurationSeconds(tmpMp3);
        if (sessionRef && typeof sessionRef.update === 'function') {
          const updatePayload = { normalizedAudioStoragePath: candidateNormalized };
          if (probedDuration > 0) {
            updatePayload.durationSeconds = Math.round(probedDuration);
          }
          await sessionRef.update(updatePayload).catch(() => {});
        }
        return candidateNormalized;
      }
    }
  } catch (err) {
    console.warn(`[normalizeLectureAudio] Normalization failed for ${rawAudioPath}, using raw audio: ${err.message}`);
  } finally {
    if (tmpRaw && fs.existsSync(tmpRaw)) {
      try { fs.unlinkSync(tmpRaw); } catch {}
    }
    if (tmpMp3 && fs.existsSync(tmpMp3)) {
      try { fs.unlinkSync(tmpMp3); } catch {}
    }
  }

  return rawAudioPath;
}

/**
 * Ensures the WebM lecture video has proper EBML SeekHead, Cues (seek index), and Duration headers.
 * Fixes the Chromium HTML5 video player bug where MediaRecorder WebM files lack a seek table
 * and duration, causing the video timeline to fail, report Infinity/0:00, or prematurely stop.
 */
export async function ensureIndexedLectureVideo({
  bucket,
  classId,
  sessionId,
  videoStoragePath,
  sessionRef = null,
}) {
  if (!videoStoragePath || !videoStoragePath.endsWith('.webm') || videoStoragePath.includes('audio')) {
    return videoStoragePath;
  }

  let tmpInput = null;
  let tmpIndexed = null;

  try {
    const videoFile = bucket.file(videoStoragePath);
    const [exists] = await videoFile.exists();
    if (!exists) return videoStoragePath;

    const [metadata] = await videoFile.getMetadata().catch(() => [{}]);
    if (metadata?.metadata?.hasCuesIndex === 'true') {
      return videoStoragePath;
    }

    const tmpDir = os.tmpdir();
    tmpInput = path.join(tmpDir, `raw_${Date.now()}_${path.basename(videoStoragePath)}`);
    tmpIndexed = path.join(tmpDir, `indexed_${Date.now()}_${path.basename(videoStoragePath)}`);

    await videoFile.download({ destination: tmpInput });

    // Remux container to inject SeekHead, Cues index, and Duration without re-encoding (-c copy)
    execSync(`${ffmpegPath} -y -i "${tmpInput}" -c copy "${tmpIndexed}"`, { stdio: 'ignore' });

    if (fs.existsSync(tmpIndexed) && fs.statSync(tmpIndexed).size > 0) {
      const durationSec = getMediaDurationSeconds(tmpIndexed);
      const token = metadata?.metadata?.firebaseStorageDownloadTokens || crypto.randomUUID();

      await bucket.upload(tmpIndexed, {
        destination: videoStoragePath,
        metadata: {
          contentType: 'video/webm',
          metadata: {
            ...(metadata?.metadata || {}),
            hasCuesIndex: 'true',
            durationSeconds: String(Math.round(durationSec || Number(metadata?.metadata?.durationSeconds || 0))),
            firebaseStorageDownloadTokens: token,
          },
        },
      });

      if (sessionRef && typeof sessionRef.update === 'function') {
        const updatePayload = { hasCuesIndex: true };
        if (durationSec > 0) {
          updatePayload.durationSeconds = Math.round(durationSec);
        }
        await sessionRef.update(updatePayload).catch(() => {});
      }

      console.info(`[ensureIndexedLectureVideo] Successfully remuxed & indexed WebM for ${videoStoragePath} (duration: ${durationSec.toFixed(1)}s)`);
    }
  } catch (err) {
    console.warn(`[ensureIndexedLectureVideo] Video remux skipped or failed for ${videoStoragePath}:`, err.message);
  } finally {
    if (tmpInput && fs.existsSync(tmpInput)) {
      try { fs.unlinkSync(tmpInput); } catch {}
    }
    if (tmpIndexed && fs.existsSync(tmpIndexed)) {
      try { fs.unlinkSync(tmpIndexed); } catch {}
    }
  }

  return videoStoragePath;
}

/**
 * Core business logic to process completed lecture recordings:
 * Ingests recorded video/audio with Gemini, produces timestamped transcripts,
 * translates to multilingual subtitles (.vtt and .srt), and saves to Cloud Storage.
 */
export async function handleProcessLectureSubtitles(data = {}, context = {}) {
  const {
    classId,
    sessionId,
    storagePath,
    title = '',
    topic = '',
    targetLanguages = null,
    preferredModel = null,
    transcriptionMode = null,
    customPrompt = null,
    promptId = null,
    sttPromptId = null,
    customSttPrompt = null,
    translationPromptId = null,
    customTranslationPrompt = null,
    isManualTrigger = false,
  } = data || {};

  if (!classId || !sessionId) {
    throw new HttpsError('invalid-argument', 'classId and sessionId are required.');
  }

  const sessionRef = db.doc(`classes/${classId}/lectureRecordings/${sessionId}`);
  const sessionSnap = await sessionRef.get();

  if (!sessionSnap.exists) {
    throw new HttpsError('not-found', `Lecture recording session ${sessionId} not found.`);
  }

  const sessionData = sessionSnap.data();

  // Prevent duplicate processing if subtitles are currently generating
  if (sessionData.status === 'generating_subtitles' && !isManualTrigger) {
    const startedMs = sessionData.processingStartedAt?.toMillis ? sessionData.processingStartedAt.toMillis() : (sessionData.processingStartedAt ? new Date(sessionData.processingStartedAt).getTime() : 0);
    if (startedMs && Date.now() - startedMs < 5 * 60 * 1000) {
      console.info(`[processLectureSubtitles] Subtitles already generating for session ${sessionId}. Skipping duplicate.`);
      return {
        success: true,
        sessionId,
        status: 'generating_subtitles',
        skipped: true,
        reason: 'already_generating',
      };
    }
  }

    // Fetch class settings
    let classData = {};
    try {
      const classSnap = await db.doc(`classes/${classId}`).get();
      if (classSnap.exists) {
        classData = classSnap.data() || {};
      }
    } catch (err) {
      console.warn(`[processLectureSubtitles] Could not read class doc: ${err.message}`);
    }

    // Check if automated subtitles are disabled by class policy (unless teacher manually clicks regenerate/retry)
    const isSubtitlesEnabled = classData.isLectureSubtitlesEnabled !== false;
    if (!isSubtitlesEnabled && !isManualTrigger) {
      console.info(`[processLectureSubtitles] Automated subtitles disabled for class ${classId}. Marking session ready without AI generation.`);
      await sessionRef.update({
        status: 'ready',
        subtitlesDisabled: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        success: true,
        sessionId,
        status: 'ready',
        skipped: true,
        reason: 'subtitles_disabled_by_class_policy',
      };
    }

    const { effectiveStoragePath, transcriptionSource } = resolveEffectiveStoragePath(sessionData, storagePath);

    if (!effectiveStoragePath) {
      throw new HttpsError('invalid-argument', 'No storagePath found for this recording session.');
    }

    const effectiveTargetLanguages =
      (Array.isArray(targetLanguages) && targetLanguages.length > 0)
        ? targetLanguages
        : (Array.isArray(classData.lectureTargetLanguages) && classData.lectureTargetLanguages.length > 0)
          ? classData.lectureTargetLanguages
          : (Array.isArray(sessionData.targetLanguages) && sessionData.targetLanguages.length > 0)
            ? sessionData.targetLanguages
            : ['en', 'zh-Hant', 'zh-Hans'];

    let candidateModel =
      preferredModel ||
      sessionData.lectureAiModel ||
      classData.lectureAiModel ||
      sessionData.aiModel ||
      DEFAULT_LECTURE_AI_MODEL ||
      AI_MODEL;

    // Strict guard: Gemini 2.5 is prohibited across all flows. Enforce Gemini 3.
    if (!candidateModel || candidateModel.includes('2.5')) {
      candidateModel = DEFAULT_LECTURE_AI_MODEL;
    }
    const activeModel = candidateModel;

    // Resolve STT prompt from request, sttPromptId, or class default
    let resolvedSttPrompt = customSttPrompt || customPrompt || null;
    let resolvedSttPromptName = null;
    const effectiveSttPromptId = sttPromptId || promptId || null;

    if (!resolvedSttPrompt && effectiveSttPromptId) {
      try {
        const promptSnap = await db.collection('prompts').doc(effectiveSttPromptId).get();
        if (promptSnap.exists) {
          const pData = promptSnap.data() || {};
          resolvedSttPrompt = pData.promptText || null;
          resolvedSttPromptName = pData.name || null;
        }
      } catch (err) {
        console.warn(`[processLectureSubtitles] Failed to fetch sttPromptId ${effectiveSttPromptId}:`, err.message);
      }
    }
    if (!resolvedSttPrompt && classData.lectureSttPrompt) {
      if (typeof classData.lectureSttPrompt === 'string') {
        resolvedSttPrompt = classData.lectureSttPrompt;
      } else if (classData.lectureSttPrompt.promptText) {
        resolvedSttPrompt = classData.lectureSttPrompt.promptText;
        resolvedSttPromptName = classData.lectureSttPrompt.name || null;
      }
    }
    if (!resolvedSttPrompt && classData.lectureRecordingPrompt) {
      if (typeof classData.lectureRecordingPrompt === 'string') {
        resolvedSttPrompt = classData.lectureRecordingPrompt;
      } else if (classData.lectureRecordingPrompt.promptText) {
        resolvedSttPrompt = classData.lectureRecordingPrompt.promptText;
        resolvedSttPromptName = classData.lectureRecordingPrompt.name || null;
      }
    }

    // Resolve Translation prompt from request, translationPromptId, or class default
    let resolvedTranslationPrompt = customTranslationPrompt || null;
    let resolvedTranslationPromptName = null;

    if (!resolvedTranslationPrompt && translationPromptId) {
      try {
        const promptSnap = await db.collection('prompts').doc(translationPromptId).get();
        if (promptSnap.exists) {
          const pData = promptSnap.data() || {};
          resolvedTranslationPrompt = pData.promptText || null;
          resolvedTranslationPromptName = pData.name || null;
        }
      } catch (err) {
        console.warn(`[processLectureSubtitles] Failed to fetch translationPromptId ${translationPromptId}:`, err.message);
      }
    }
    if (!resolvedTranslationPrompt && classData.lectureTranslationPrompt) {
      if (typeof classData.lectureTranslationPrompt === 'string') {
        resolvedTranslationPrompt = classData.lectureTranslationPrompt;
      } else if (classData.lectureTranslationPrompt.promptText) {
        resolvedTranslationPrompt = classData.lectureTranslationPrompt.promptText;
        resolvedTranslationPromptName = classData.lectureTranslationPrompt.name || null;
      }
    }

    // Backwards compatibility alias
    const resolvedCustomPrompt = resolvedSttPrompt;
    const resolvedPromptName = resolvedSttPromptName;

    console.info(`[processLectureSubtitles] Transcribing via ${transcriptionSource} track: ${effectiveStoragePath} using model ${activeModel}. Target languages: ${effectiveTargetLanguages.join(', ')}. STT prompt: ${Boolean(resolvedSttPrompt)}, Translation prompt: ${Boolean(resolvedTranslationPrompt)}`);

    // Set status to generating_subtitles
    await sessionRef.update({
      status: 'generating_subtitles',
      transcriptionSource,
      targetLanguages: effectiveTargetLanguages,
      aiModelUsed: activeModel,
      processingStartedAt: FieldValue.serverTimestamp(),
    });

    const bucketName = process.env.STORAGE_BUCKET_NAME || storage.app?.options?.storageBucket || `${db.projectId || 'it114115-2627'}.firebasestorage.app`;
    const bucket = storage.bucket(bucketName);

    // Closed captions and lecture transcription strictly require ONLY the audio track.
    // Video frames waste ~90% of token budget without providing speech content.
    // Ensure Gemini is ALWAYS and EXCLUSIVELY sent pure audio (audio/*).
    let finalAudioPath = sessionData.normalizedAudioStoragePath || sessionData.audioStoragePath;
    if (!finalAudioPath) {
      if (effectiveStoragePath.includes('audio')) {
        finalAudioPath = effectiveStoragePath;
      } else {
        const candidateAudio = `recordings/${classId}/${sessionId}/lecture_audio.webm`;
        try {
          const [exists] = await bucket.file(candidateAudio).exists();
          if (exists) {
            finalAudioPath = candidateAudio;
          }
        } catch {}
      }
    }

    if (!finalAudioPath && effectiveStoragePath) {
      const candidateAudio = `recordings/${classId}/${sessionId}/lecture_audio.webm`;
      try {
        const videoFile = bucket.file(effectiveStoragePath);
        const [videoExists] = await videoFile.exists();
        if (videoExists && !effectiveStoragePath.includes('audio')) {
          const tmpDir = os.tmpdir();
          const tmpVideo = path.join(tmpDir, `vid_${Date.now()}_${path.basename(effectiveStoragePath)}`);
          const tmpAudio = path.join(tmpDir, `aud_${Date.now()}_lecture_audio.webm`);
          await videoFile.download({ destination: tmpVideo });
          try {
            execSync(`${ffmpegPath} -y -i "${tmpVideo}" -vn -c:a copy "${tmpAudio}"`, { stdio: 'ignore' });
          } catch {
            execSync(`${ffmpegPath} -y -i "${tmpVideo}" -vn -c:a libopus -b:a 64k "${tmpAudio}"`, { stdio: 'ignore' });
          }
          if (fs.existsSync(tmpAudio) && fs.statSync(tmpAudio).size > 0) {
            const token = crypto.randomUUID();
            await bucket.upload(tmpAudio, {
              destination: candidateAudio,
              metadata: {
                contentType: 'audio/webm',
                metadata: { firebaseStorageDownloadTokens: token },
              },
            });
            try { fs.unlinkSync(tmpVideo); } catch {}
            try { fs.unlinkSync(tmpAudio); } catch {}
            finalAudioPath = candidateAudio;
            await sessionRef.update({ audioStoragePath: candidateAudio }).catch(() => {});
          }
        }
      } catch (extractErr) {
        console.warn('[processLectureSubtitles] Audio extraction fallback skipped:', extractErr.message);
      }
    }

    // Ensure WebM lecture video is indexed with SeekHead, Cues, and Duration for perfect HTML5 player timeline & seeking
    const videoStoragePath =
      (storagePath && !storagePath.includes('audio') ? storagePath : null) ||
      sessionData.storagePath ||
      (!effectiveStoragePath.includes('audio') ? effectiveStoragePath : null) ||
      `recordings/${classId}/${sessionId}/lecture.webm`;
    if (videoStoragePath) {
      await ensureIndexedLectureVideo({
        bucket,
        classId,
        sessionId,
        videoStoragePath,
        sessionRef,
      });
    }

    const rawAudioTrackPath = finalAudioPath || sessionData.audioStoragePath || effectiveStoragePath;

    // Normalize audio track to standard 48kHz Constant Bitrate MP3 to prevent Gemini timescale distortion (1.48x speed drift)
    const audioTrackPath = await normalizeLectureAudio({
      bucket,
      classId,
      sessionId,
      rawAudioPath: rawAudioTrackPath,
      normalizedStoragePath: sessionData.normalizedAudioStoragePath,
      sessionRef,
    });

    const gsUri = `gs://${bucket.name}/${audioTrackPath}`;
    const mediaContentType = audioTrackPath.endsWith('.m4a') ? 'audio/mp4' : (audioTrackPath.endsWith('.mp3') ? 'audio/mpeg' : 'audio/webm');

    let totalDuration = Number(sessionData.durationSeconds || 0);

    let localAudioPath = null;
    const ensureLocalAudio = async () => {
      if (localAudioPath && fs.existsSync(localAudioPath)) return localAudioPath;
      const tmpDir = os.tmpdir();
      localAudioPath = path.join(tmpDir, `aud_proc_${Date.now()}_${path.basename(audioTrackPath)}`);
      const fileRef = bucket.file(audioTrackPath);
      if (typeof fileRef.download === 'function') {
        await fileRef.download({ destination: localAudioPath });
      }
      return localAudioPath;
    };

    if (totalDuration <= 0) {
      try {
        const localP = await ensureLocalAudio();
        totalDuration = getMediaDurationSeconds(localP);
        if (totalDuration > 0) {
          await sessionRef.update({ durationSeconds: Math.round(totalDuration) }).catch(() => {});
        }
      } catch (err) {
        console.warn('[processLectureSubtitles] Audio duration probe fallback skipped:', err.message);
      }
    }

    let allSegments = [];
    let chapters = [{ timeSeconds: 0, title: 'Introduction' }];
    let cumulativeUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let lastModelUsed = preferredModel || AI_MODEL;

    try {
      console.info(`[processLectureSubtitles] Executing single-pass pipeline (${activeModel}). Ingesting whole audio track via gsUri: ${gsUri}`);

      const durationHint = totalDuration > 0
        ? `\nTotal Lecture Duration: ${Math.round(totalDuration)} seconds (${formatTimestampToVTT(totalDuration).slice(0, 8)}).`
        : '';

      const interruptionHint = sessionData.interruptionRemarks
        ? `\nRECORDING DISCONTINUITY NOTICE: ${sessionData.interruptionRemarks}. If there is a sudden cut, audio jump, or gap in the audio recording, note the transition smoothly and continue transcribing the remaining speech across the lecture.`
        : '';

      const subjectDomain = classData.subjectDomain || sessionData.subjectDomain || 'Computer Science & Software Engineering';

      let promptPreamble = `You are an expert transcriber and multilingual subtitler for Computer Science lectures in Hong Kong.
Academic Subject Domain: ${subjectDomain}
The speaker code-switches between Cantonese and English technical terminology (e.g. Docker, useState, React, Express, API, route, parameter, database, PostgreSQL, DynamoDB, AZ, hardware, copy, eventual consistency, partition key, item, query).`;

      if (resolvedCustomPrompt) {
        const interpolated = resolvedCustomPrompt
          .replace(/\{\{classId\}\}/g, classId)
          .replace(/\{\{courseContext\}\}/g, subjectDomain)
          .replace(/\{\{targetLanguages\}\}/g, effectiveTargetLanguages.join(', '));
        promptPreamble = `${interpolated}\n\nAcademic Subject Domain Context: "${subjectDomain}".`;
      }

      const promptText = buildLectureSubtitlePrompt({
        promptPreamble,
        classId,
        title: title || sessionData.title || 'Classroom Lecture',
        topic: topic || sessionData.topic || 'General Lecture',
        durationHint,
        interruptionHint,
        totalDuration,
      });

      const { response, modelUsed } = await generateWithResilience(
        {
          temperature: 0.2,
          topP: 0.95,
          config: {
            maxOutputTokens: 65536,
            thinkingConfig: { thinkingBudget: 0 },
          },
          prompt: [
            { text: promptText },
            { media: { url: gsUri, contentType: mediaContentType } },
          ],
        },
        activeModel
      );

      lastModelUsed = modelUsed;
      const u = response.usage || response.usageMetadata || response.raw?.usageMetadata || {};
      const inTok = u.promptTokens || u.promptTokenCount || u.inputTokens || 0;
      const outTok = u.completionTokens || u.candidatesTokenCount || u.outputTokens || 0;
      cumulativeUsage.promptTokens += inTok;
      cumulativeUsage.completionTokens += outTok;
      cumulativeUsage.totalTokens += (u.totalTokens || u.totalTokenCount || (inTok + outTok));

      let parsedData = null;
      if (response.text) {
        parsedData = parseAiJsonResponse(response.text);
      }
      if (!parsedData) {
        try {
          if (response.output && typeof response.output === 'object') {
            parsedData = response.output;
          }
        } catch (outputErr) {
          console.warn('[processLectureSubtitles] response.output getter error (safe to ignore):', outputErr.message);
        }
      }
      if (!parsedData) {
        try {
          let rawText = (response.text || '').trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
          rawText = rawText.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F]/g, ' ');
          parsedData = JSON.parse(rawText);
        } catch (parseErr) {
          const recovered = extractSegmentsAndChaptersByRegex(response.text);
          if (recovered && recovered.segments?.length > 0) {
            console.warn('[processLectureSubtitles] JSON.parse failed, but recovered segments via regex extractor:', recovered.segments.length);
            parsedData = recovered;
          } else {
            console.error('[processLectureSubtitles] Failed to parse Gemini JSON output:', response.text);
            throw new Error(`Failed to parse AI subtitle response: ${parseErr.message}`);
          }
        }
      }

      if (Array.isArray(parsedData)) {
        allSegments = parsedData.map((item, idx) => {
          const start = Number(item.start || 0);
          let end = Number(item.end);
          if (isNaN(end) || end <= start) {
            const nextStart = Number(parsedData[idx + 1]?.start);
            const textLen = (item.original || item.text || '').length;
            const minDur = Math.max(2.0, Math.min(5.0, textLen * 0.25));
            end = nextStart > start ? Math.min(nextStart, start + minDur) : start + minDur;
          }
          return {
            start,
            end,
            original: (item.original || item.text || '').trim(),
            translations: item.translations || {},
          };
        });
      } else if (parsedData && typeof parsedData === 'object') {
        if (Array.isArray(parsedData.chapters) && parsedData.chapters.length > 0) {
          chapters = parsedData.chapters;
        }
        const rawSegs = Array.isArray(parsedData.segments) ? parsedData.segments : [];
        allSegments = rawSegs.map((item, idx) => {
          const start = Number(item.start || 0);
          let end = Number(item.end);
          if (isNaN(end) || end <= start) {
            const nextStart = Number(rawSegs[idx + 1]?.start);
            const textLen = (item.original || item.text || '').length;
            const minDur = Math.max(2.0, Math.min(5.0, textLen * 0.25));
            end = nextStart > start ? Math.min(nextStart, start + minDur) : start + minDur;
          }
          return {
            start,
            end,
            original: (item.original || item.text || '').trim(),
            translations: item.translations || {},
          };
        });
      }

      // Automatic timescale calibration for Gemini long-audio subtitle drift:
      // In single-pass long audio transcription, Gemini decodes speech tokens against an internal timescale
      // that compresses timestamps linearly (typically ~1.68x faster than real-world wall clock).
      // If the probed media duration is significantly longer than the AI's final timestamp,
      // apply proportional linear calibration to stretch cues into 100% 1:1 sync with the video.
      const calibration = calibrateSubtitleTimeline(allSegments, chapters, totalDuration);
      if (calibration.driftRatio > 1.05) {
        console.info(`[processLectureSubtitles] Calibrated timescale drift (ratio: ${calibration.driftRatio.toFixed(4)}x, totalDuration: ${totalDuration.toFixed(1)}s)`);
        allSegments = calibration.segments;
        chapters = calibration.chapters;
      }

      // Cleanup local downloaded audio if created
      if (localAudioPath) {
        try { fs.unlinkSync(localAudioPath); } catch {}
        localAudioPath = null;
      }

      // Stage 2: Translate One-by-One for each target language
      const languagesToTranslate = effectiveTargetLanguages.filter((l) => l !== 'original');

      for (const targetLang of languagesToTranslate) {
        const missingIndices = [];
        for (let i = 0; i < allSegments.length; i++) {
          if (!allSegments[i].translations?.[targetLang]) {
            missingIndices.push(i);
          }
        }

        if (missingIndices.length === 0) continue;

        console.info(`[processLectureSubtitles] Translating ${missingIndices.length} cues to '${targetLang}' one-by-one...`);

        const BATCH_SIZE = 50;
        const batchChunks = [];
        for (let i = 0; i < missingIndices.length; i += BATCH_SIZE) {
          const sliceIndices = missingIndices.slice(i, i + BATCH_SIZE);
          const chunkTexts = sliceIndices.map((idx) => allSegments[idx].original);
          batchChunks.push({ sliceIndices, chunkTexts });
        }

        // Process translation chunks with controlled concurrency (3 concurrent requests per language)
        const CONCURRENCY = 3;
        for (let i = 0; i < batchChunks.length; i += CONCURRENCY) {
          const slice = batchChunks.slice(i, i + CONCURRENCY);
          await Promise.all(
            slice.map(async ({ sliceIndices, chunkTexts }) => {
              const transPrompt = buildLectureTranslationPrompt({
                template: resolvedTranslationPrompt,
                classId,
                subjectDomain,
                targetLanguage: targetLang,
                chunk: chunkTexts,
              });

              try {
                const { response: transRes, modelUsed: tm } = await generateWithResilience(
                  {
                    temperature: 0.1,
                    prompt: [{ text: transPrompt }],
                  },
                  activeModel || AI_MODEL
                );

                const tu = transRes.usage || transRes.usageMetadata || transRes.raw?.usageMetadata || {};
                const tinTok = tu.promptTokens || tu.promptTokenCount || tu.inputTokens || 0;
                const toutTok = tu.completionTokens || tu.candidatesTokenCount || tu.outputTokens || 0;
                cumulativeUsage.promptTokens += tinTok;
                cumulativeUsage.completionTokens += toutTok;
                cumulativeUsage.totalTokens += (tu.totalTokens || tu.totalTokenCount || (tinTok + toutTok));

                let parsedTrans = parseAiJsonResponse(transRes.text);
                if (!parsedTrans) {
                  let rawTrans = (transRes.text || '').trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
                  rawTrans = rawTrans.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F]/g, ' ');
                  parsedTrans = JSON.parse(rawTrans);
                }

                if (Array.isArray(parsedTrans)) {
                  for (let j = 0; j < sliceIndices.length; j++) {
                    const segIdx = sliceIndices[j];
                    const item = parsedTrans[j];
                    let transText = '';
                    if (typeof item === 'string') {
                      transText = item.trim();
                    } else if (item && typeof item === 'object') {
                      transText = (item[targetLang] || item.translation || item.text || item.translatedText || '').trim();
                    }
                    if (allSegments[segIdx]) {
                      if (!allSegments[segIdx].translations) {
                        allSegments[segIdx].translations = {};
                      }
                      allSegments[segIdx].translations[targetLang] = transText || allSegments[segIdx].original;
                    }
                  }
                }
              } catch (tErr) {
                console.warn(`[processLectureSubtitles] Translation batch failed for language ${targetLang}:`, tErr.message);
                for (const segIdx of sliceIndices) {
                  if (allSegments[segIdx]) {
                    if (!allSegments[segIdx].translations) {
                      allSegments[segIdx].translations = {};
                    }
                    if (!allSegments[segIdx].translations[targetLang]) {
                      allSegments[segIdx].translations[targetLang] = allSegments[segIdx].original;
                    }
                  }
                }
              }
            })
          );
        }
      }

      // Ensure every segment has non-empty text for all target languages
      allSegments = ensureSegmentTranslations(allSegments, effectiveTargetLanguages);

      // YouTube Chapters Synthesis Fallback if missing or empty
      if (!chapters || chapters.length <= 1) {
        if (allSegments.length > 0) {
          const maxSec = Math.max(1, Math.floor(allSegments[allSegments.length - 1].end || totalDuration));
          const sampledTimeline = allSegments
            .filter((s, idx) => idx % 8 === 0 || idx === 0)
            .map((s) => `${formatTimestampToVTT(s.start).slice(3, 8)} - ${s.original}`)
            .join('\n');

          const chapterPrompt = `Based on this timeline of lecture speech transcriptions (from 00:00 to ${formatTimestampToVTT(maxSec)}), generate 5 to 10 meaningful YouTube video chapters with timestamps in seconds.
All chapter timeSeconds MUST be between 0 and ${maxSec}, monotonically increasing, with the first chapter starting at 0.
Sampled transcript:
${sampledTimeline}

Output valid JSON with this exact schema:
{
  "chapters": [
    { "timeSeconds": 0, "title": "Introduction & Overview" }
  ]
}`;

          try {
            const { response: chRes } = await generateWithResilience(
              {
                temperature: 0.2,
                topP: 0.9,
                prompt: [{ text: chapterPrompt }],
              },
              AI_MODEL
            );

            const chu = chRes?.usage || chRes?.usageMetadata || chRes?.raw?.usageMetadata || {};
            const chinTok = chu.promptTokens || chu.promptTokenCount || chu.inputTokens || 0;
            const choutTok = chu.completionTokens || chu.candidatesTokenCount || chu.outputTokens || 0;
            cumulativeUsage.promptTokens += chinTok;
            cumulativeUsage.completionTokens += choutTok;
            cumulativeUsage.totalTokens += (chu.totalTokens || chu.totalTokenCount || (chinTok + choutTok));

            let parsedCh = parseAiJsonResponse(chRes.text);
            if (!parsedCh) {
              let rawCh = (chRes.text || '').trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
              rawCh = rawCh.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F]/g, ' ');
              parsedCh = JSON.parse(rawCh);
            }
            if (Array.isArray(parsedCh?.chapters) && parsedCh.chapters.length > 0) {
              chapters = parsedCh.chapters
                .map((ch) => ({
                  timeSeconds: Math.min(maxSec, Math.max(0, Math.floor(ch.timeSeconds || 0))),
                  title: (ch.title || 'Section').trim(),
                }))
                .filter((ch, idx, arr) => idx === 0 || ch.timeSeconds > arr[idx - 1].timeSeconds);
            }
          } catch (chErr) {
            console.warn('[processLectureSubtitles] Chapter synthesis fallback:', chErr.message);
          }
        }
      }

      const aiCost = calculateCost(cumulativeUsage, lastModelUsed);
      const segments = allSegments;

      // Languages to compile: original + target languages
      const allLanguages = ['original', ...effectiveTargetLanguages];
      const vttUrls = {};
      const srtUrls = {};

      // Write .vtt and .srt files to Cloud Storage for each language
      for (const lang of allLanguages) {
        const vttContent = buildWebVTT(segments, lang);
        const srtContent = buildSRT(segments, lang);

        const vttPath = `subtitles/${classId}/${sessionId}/subtitles_${lang}.vtt`;
        const srtPath = `subtitles/${classId}/${sessionId}/subtitles_${lang}.srt`;

        const vttFile = bucket.file(vttPath);
        const srtFile = bucket.file(srtPath);

        const vttToken = crypto.randomUUID();
        const srtToken = crypto.randomUUID();

        await vttFile.save(vttContent, {
          contentType: 'text/vtt; charset=utf-8',
          metadata: {
            classId,
            sessionId,
            language: lang,
            metadata: { firebaseStorageDownloadTokens: vttToken },
          },
        });

        await srtFile.save(srtContent, {
          contentType: 'text/plain; charset=utf-8',
          metadata: {
            classId,
            sessionId,
            language: lang,
            metadata: { firebaseStorageDownloadTokens: srtToken },
          },
        });

        const vttUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(vttPath)}?alt=media&token=${vttToken}`;
        const srtUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(srtPath)}?alt=media&token=${srtToken}`;

        vttUrls[lang] = vttUrl;
        srtUrls[lang] = srtUrl;
      }

      const youtubeMetadata = generateYouTubeMetadata({
        classId,
        title: title || sessionData.title,
        topic: topic || sessionData.topic,
        chapters,
        availableLanguages: allLanguages,
      });

      // Update Firestore document with ready status and artifacts
      await sessionRef.update({
        status: 'ready',
        targetLanguages: effectiveTargetLanguages,
        vttUrls,
        srtUrls,
        chapters,
        segmentCount: segments.length,
        youtubeMetadata,
        aiCost,
        aiModelUsed: lastModelUsed,
        subtitlesDisabled: false,
        subtitlesPromptUsed: (resolvedSttPrompt || resolvedTranslationPrompt) ? 'custom' : 'default',
        subtitlesPromptId: effectiveSttPromptId || null,
        subtitlesPromptName: resolvedSttPromptName || (resolvedSttPrompt ? 'Custom Instructions' : 'System Default'),
        sttPromptId: effectiveSttPromptId || null,
        sttPromptName: resolvedSttPromptName || null,
        translationPromptId: translationPromptId || null,
        translationPromptName: resolvedTranslationPromptName || null,
        customSttPrompt: customSttPrompt || undefined,
        customTranslationPrompt: customTranslationPrompt || undefined,
        subtitlesCompletedAt: FieldValue.serverTimestamp(),
      });

      await logJob({
        classId,
        studentUid: 'instructor',
        studentEmail: sessionData.teacherEmail || 'teacher',
        jobType: 'processLectureSubtitles',
        status: 'completed',
        promptText: 'Single-pass whole-audio lecture transcription with multilingual translations.',
        mediaPaths: [gsUri],
        usage: {
          inputTokens: cumulativeUsage.promptTokens,
          outputTokens: cumulativeUsage.completionTokens,
          totalTokens: cumulativeUsage.totalTokens,
        },
        cost: aiCost,
        modelUsed: lastModelUsed,
        result: `Generated ${segments.length} segments across ${allLanguages.length} languages via ${lastModelUsed}.`,
      });

      return {
        success: true,
        sessionId,
        status: 'ready',
        vttUrls,
        srtUrls,
        chapters,
        youtubeMetadata,
        aiCost,
      };
    } catch (err) {
      if (localAudioPath) {
        try { fs.unlinkSync(localAudioPath); } catch {}
        localAudioPath = null;
      }
      console.error('[processLectureSubtitles] Error:', err);
      await sessionRef.update({
        status: 'subtitles_failed',
        error: err.message,
        failedAt: FieldValue.serverTimestamp(),
      });

      await logJob({
        classId,
        studentUid: 'instructor',
        studentEmail: sessionData.teacherEmail || 'teacher',
        jobType: 'processLectureSubtitles',
        status: 'failed',
        promptText: 'Lecture subtitle generation',
        mediaPaths: [gsUri],
        usage: {
          inputTokens: cumulativeUsage.promptTokens,
          outputTokens: cumulativeUsage.completionTokens,
          totalTokens: cumulativeUsage.totalTokens,
        },
        cost: 0,
        modelUsed: lastModelUsed || AI_MODEL,
        errorDetails: err.message,
      });

      throw new HttpsError('internal', `Failed to generate lecture subtitles: ${err.message}`);
    }
}

export const executeProcessLectureSubtitles = handleProcessLectureSubtitles;

/**
 * Callable Cloud Function to process lecture subtitles from client UI.
 */
export const processLectureSubtitles = onCall(
  {
    region: FUNCTION_REGION,
    memory: '2GiB',
    timeoutSeconds: 540,
  },
  async (request) => {
    return await handleProcessLectureSubtitles(request.data || {}, { auth: request.auth });
  }
);

/**
 * Firestore Event Triggered Worker: processLectureSubtitleJob
 * Automatically executes lecture subtitle generation enqueued in background,
 * decoupled from browser connection or teacher workstation status.
 */
export const processLectureSubtitleJob = onDocumentCreated(
  {
    document: 'lectureSubtitleJobs/{jobId}',
    region: FUNCTION_REGION,
    memory: '2GiB',
    timeoutSeconds: 540,
  },
  async (event) => {
    const jobSnap = event.data;
    if (!jobSnap) return;
    const jobData = jobSnap.data() || {};
    const jobId = event.params.jobId;

    if (jobData.status !== 'pending') return;

    const jobRef = jobSnap.ref;
    await jobRef.update({ status: 'processing', startedAt: FieldValue.serverTimestamp() });

    try {
      const result = await handleProcessLectureSubtitles({
        classId: jobData.classId,
        sessionId: jobData.sessionId,
        storagePath: jobData.storagePath,
        title: jobData.title,
        targetLanguages: jobData.targetLanguages,
        preferredModel: jobData.preferredModel,
        sttPromptId: jobData.sttPromptId,
        customSttPrompt: jobData.customSttPrompt,
        translationPromptId: jobData.translationPromptId,
        customTranslationPrompt: jobData.customTranslationPrompt,
      });

      await jobRef.update({
        status: result?.success ? 'completed' : 'failed',
        result,
        finishedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error(`[processLectureSubtitleJob] Failed for job ${jobId}:`, err);
      await jobRef.update({
        status: 'failed',
        error: err.message,
        finishedAt: FieldValue.serverTimestamp(),
      });
    }
  }
);

/**
 * Automatically inspects and reconciles orphaned or interrupted lecture recordings
 * where media files exist in Cloud Storage but the Firestore document was left incomplete.
 */
export async function handleReconcileLectureRecordings({ classId, triggerSubtitles = true }) {
  if (!classId) {
    throw new HttpsError('invalid-argument', 'classId is required.');
  }

  const recordingsRef = db.collection(`classes/${classId}/lectureRecordings`);
  const snapshot = await recordingsRef.get();
  const bucket = storage.bucket();
  const reconciledSessions = [];

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const sessionId = docSnap.id;

    // A recording is a candidate for reconciliation if it's missing videoUrl or stuck in recording/uploading/processing_subtitles
    const isCandidate =
      data.status === 'recording' ||
      data.status === 'uploading' ||
      data.status === 'processing_subtitles' ||
      !data.videoUrl;

    if (!isCandidate) continue;

    // Check Cloud Storage for video file
    const possibleVideoPaths = [
      data.storagePath,
      `recordings/${classId}/${sessionId}/lecture.webm`,
      `recordings/${classId}/${sessionId}/lecture.mp4`,
    ].filter(Boolean);

    // Check Cloud Storage for audio file
    const possibleAudioPaths = [
      data.normalizedAudioStoragePath,
      `recordings/${classId}/${sessionId}/lecture_audio_normalized.mp3`,
      data.audioStoragePath,
      `recordings/${classId}/${sessionId}/lecture_audio.webm`,
      `recordings/${classId}/${sessionId}/lecture_audio.m4a`,
    ].filter(Boolean);

    let videoFile = null;
    let videoPath = null;
    let videoMetadata = null;

    for (const p of possibleVideoPaths) {
      const f = bucket.file(p);
      const [exists] = await f.exists();
      if (exists) {
        videoFile = f;
        videoPath = p;
        try {
          const [meta] = await f.getMetadata();
          videoMetadata = meta;
        } catch {}
        break;
      }
    }

    let audioFile = null;
    let audioPath = null;
    let audioMetadata = null;

    for (const p of possibleAudioPaths) {
      const f = bucket.file(p);
      const [exists] = await f.exists();
      if (exists) {
        audioFile = f;
        audioPath = p;
        try {
          const [meta] = await f.getMetadata();
          audioMetadata = meta;
        } catch {}
        break;
      }
    }

    if (videoFile || audioFile) {
      if (videoFile && videoPath?.endsWith('.webm') && videoMetadata?.metadata?.hasCuesIndex !== 'true') {
        try {
          await ensureIndexedLectureVideo({
            bucket,
            classId,
            sessionId,
            videoStoragePath: videoPath,
            sessionRef: docSnap.ref,
          });
          const [updatedMeta] = await videoFile.getMetadata().catch(() => [videoMetadata]);
          videoMetadata = updatedMeta || videoMetadata;
        } catch (idxErr) {
          console.warn(`[handleReconcileLectureRecordings] Video indexing skipped for ${videoPath}:`, idxErr.message);
        }
      }

      let videoUrl = data.videoUrl;
      let audioUrl = data.audioUrl;

      if (videoFile && !videoUrl) {
        let token = videoMetadata?.metadata?.firebaseStorageDownloadTokens;
        if (!token) {
          token = crypto.randomUUID();
          try {
            await videoFile.setMetadata({
              contentType: videoMetadata?.contentType || 'video/webm',
              metadata: {
                ...(videoMetadata?.metadata || {}),
                firebaseStorageDownloadTokens: token,
              },
            });
          } catch {}
        }
        videoUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(videoPath)}?alt=media&token=${token}`;
      }

      if (audioFile && !audioUrl) {
        let token = audioMetadata?.metadata?.firebaseStorageDownloadTokens;
        if (!token) {
          token = crypto.randomUUID();
          try {
            await audioFile.setMetadata({
              contentType: audioMetadata?.contentType || 'audio/webm',
              metadata: {
                ...(audioMetadata?.metadata || {}),
                firebaseStorageDownloadTokens: token,
              },
            });
          } catch {}
        }
        audioUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(audioPath)}?alt=media&token=${token}`;
      }

      const durationSeconds =
        data.durationSeconds ||
        Number(videoMetadata?.metadata?.durationSeconds || audioMetadata?.metadata?.durationSeconds || 0) ||
        null;

      const updatePayload = {
        status: data.vttUrls ? 'ready' : (data.status === 'recording' || data.status === 'uploading' ? 'ready' : data.status),
        videoUrl: videoUrl || data.videoUrl || null,
        storagePath: videoPath || data.storagePath || null,
        audioUrl: audioUrl || data.audioUrl || null,
        audioStoragePath: audioPath || data.audioStoragePath || null,
      };

      if (videoMetadata?.size) {
        updatePayload.fileSize = Number(videoMetadata.size);
      }
      if (audioMetadata?.size) {
        updatePayload.audioFileSize = Number(audioMetadata.size);
      }
      if (durationSeconds && !data.durationSeconds) {
        updatePayload.durationSeconds = durationSeconds;
      }
      if (!data.endedAt && data.startedAt && durationSeconds) {
        const startMillis = data.startedAt.toMillis ? data.startedAt.toMillis() : new Date(data.startedAt).getTime();
        updatePayload.endedAt = new Date(startMillis + durationSeconds * 1000);
      }

      await docSnap.ref.update(updatePayload);

      if (triggerSubtitles && !data.vttUrls && (videoPath || data.storagePath)) {
        try {
          await handleProcessLectureSubtitles({
            classId,
            sessionId,
            storagePath: videoPath || data.storagePath,
            title: data.title,
            targetLanguages: data.targetLanguages,
          });
        } catch (subErr) {
          console.warn(`[handleReconcileLectureRecordings] Auto-trigger subtitles notice for ${sessionId}:`, subErr.message);
        }
      }

      reconciledSessions.push({
        sessionId,
        videoUrl,
        audioUrl,
        durationSeconds,
        hasSubtitles: Boolean(data.vttUrls),
      });
    } else if (data.status === 'recording' || data.status === 'uploading') {
      const startedMillis = data.startedAt?.toMillis ? data.startedAt.toMillis() : (data.startedAt ? new Date(data.startedAt).getTime() : 0);
      const isStale = startedMillis && (Date.now() - startedMillis > 2 * 3600 * 1000);
      if (isStale) {
        await docSnap.ref.update({
          status: 'interrupted',
          interruptedReason: 'No media files found in Cloud Storage. The browser may have closed or crashed before upload completed.',
          endedAt: new Date(),
        });
        reconciledSessions.push({
          sessionId,
          status: 'interrupted',
          reason: 'No media found in Cloud Storage after 2+ hours',
        });
      }
    }
  }

  return {
    success: true,
    reconciledCount: reconciledSessions.length,
    reconciledSessions,
  };
}

