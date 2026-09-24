import './firebase.js';
import crypto from 'crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { FUNCTION_REGION, AI_MODEL } from './config.js';
import { generateWithResilience } from './analysisFlows.js';
import { calculateCost } from './cost.js';
import { logJob } from './jobLogger.js';

const db = getFirestore();
const storage = getStorage();

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

    vtt += `${idx + 1}\n`;
    vtt += `${formatTimestampToVTT(seg.start)} --> ${formatTimestampToVTT(seg.end)}\n`;
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

    srt += `${idx + 1}\n`;
    srt += `${formatTimestampToSRT(seg.start)} --> ${formatTimestampToSRT(seg.end)}\n`;
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

Recorded with Google AI Classroom Assistant.`;

  return { title: ytTitle, description };
}

/**
 * Resolves the optimal storage path for Gemini transcription.
 * Prioritizes parallel audio-only track (~25MB Opus) over composite video (~1.2GB).
 */
export function resolveEffectiveStoragePath(sessionData = {}, requestedStoragePath = null) {
  const effectiveAudioPath = sessionData.audioStoragePath || (requestedStoragePath && requestedStoragePath.includes('audio') ? requestedStoragePath : null);
  const effectiveStoragePath = effectiveAudioPath || requestedStoragePath || sessionData.storagePath || null;
  const transcriptionSource = effectiveAudioPath ? 'audio_only' : 'video';
  return { effectiveStoragePath, transcriptionSource };
}

/**
 * Cloud Function to process completed lecture recordings:
 * Ingests recorded video/audio with Gemini, produces timestamped transcripts,
 * translates to multilingual subtitles (.vtt and .srt), and saves to Cloud Storage.
 */
export const processLectureSubtitles = onCall(
  {
    region: FUNCTION_REGION,
    memory: '2GiB',
    timeoutSeconds: 540,
  },
  async (request) => {
    const {
      classId,
      sessionId,
      storagePath,
      title = '',
      topic = '',
      targetLanguages = ['en', 'zh-Hant', 'zh-Hans', 'ja'],
      preferredModel = null,
    } = request.data || {};

    if (!classId || !sessionId) {
      throw new HttpsError('invalid-argument', 'classId and sessionId are required.');
    }

    const sessionRef = db.doc(`classes/${classId}/lectureRecordings/${sessionId}`);
    const sessionSnap = await sessionRef.get();

    if (!sessionSnap.exists) {
      throw new HttpsError('not-found', `Lecture recording session ${sessionId} not found.`);
    }

    const sessionData = sessionSnap.data();
    const { effectiveStoragePath, transcriptionSource } = resolveEffectiveStoragePath(sessionData, storagePath);

    if (!effectiveStoragePath) {
      throw new HttpsError('invalid-argument', 'No storagePath found for this recording session.');
    }

    console.info(`[processLectureSubtitles] Transcribing via ${transcriptionSource} track: ${effectiveStoragePath}`);

    // Set status to generating_subtitles
    await sessionRef.update({
      status: 'generating_subtitles',
      transcriptionSource,
      processingStartedAt: FieldValue.serverTimestamp(),
    });

    const bucket = storage.bucket();
    const gsUri = `gs://${bucket.name}/${effectiveStoragePath}`;
    const activeModel = preferredModel || AI_MODEL || 'gemini-3.5-flash-lite';

    const promptText = `You are an expert video transcriber and multilingual subtitler for higher education Computer Science lectures in Hong Kong.
The speaker code-switches between Cantonese and English technical terminology.

Lecture Context:
Class: ${classId}
Title: ${title || sessionData.title || 'Classroom Lecture'}
Topic: ${topic || sessionData.topic || 'General Lecture'}

Instructions:
1. Transcribe the audio verbatim with accurate start and end timestamps (in seconds as floats).
2. Retain all English technical words (e.g. Docker, useState, React, Express, API, route, parameter, database, PostgreSQL). Do NOT translate code keywords or variable names into unnatural Chinese.
3. Provide high-quality, natural translations for each segment into the following target languages:
${targetLanguages.map((l) => `   - "${l}"`).join('\n')}
4. Extract 3 to 10 high-level chapter milestones with timestamps (in seconds) suitable for a YouTube video description.

Output MUST be valid JSON with this exact schema:
{
  "chapters": [
    { "timeSeconds": 0, "title": "Introduction & Overview" },
    { "timeSeconds": 180, "title": "Express Route Handler Setup" }
  ],
  "segments": [
    {
      "start": 0.5,
      "end": 4.2,
      "original": "今日我哋會用 useState 整一個 real-time component。",
      "translations": {
        "en": "Today we will use useState to build a real-time component.",
        "zh-Hant": "今天我們將使用 useState 構建一個實時組件。",
        "zh-Hans": "今天我们将使用 useState 构建一个实时组件。",
        "ja": "今日は useState を使ってリアルタイムコンポーネントを作成します。"
      }
    }
  ]
}`;

    const mediaContentType = (transcriptionSource === 'audio_only' || effectiveStoragePath.endsWith('_audio.webm')) ? 'audio/webm' : 'video/webm';

    try {
      const { response, modelUsed } = await generateWithResilience(
        {
          temperature: 0.1,
          topP: 0.95,
          output: { format: 'json' },
          prompt: [
            { text: promptText },
            { media: { url: gsUri, contentType: mediaContentType } },
          ],
        },
        activeModel
      );

      const usage = response.usage || {};
      const aiCost = calculateCost(usage, modelUsed);

      // Parse JSON response safely
      let parsedData = { chapters: [], segments: [] };
      if (response.output && typeof response.output === 'object') {
        parsedData = response.output;
      } else {
        try {
          const rawText = (response.text || '').trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
          parsedData = JSON.parse(rawText);
        } catch (parseErr) {
          console.error('[processLectureSubtitles] Failed to parse Gemini JSON output:', response.text);
          throw new Error(`Failed to parse AI subtitle response: ${parseErr.message}`);
        }
      }

      const segments = Array.isArray(parsedData.segments) ? parsedData.segments : [];
      const chapters = Array.isArray(parsedData.chapters) ? parsedData.chapters : [];

      // Languages to compile: original + target languages
      const allLanguages = ['original', ...targetLanguages];
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
        vttUrls,
        srtUrls,
        chapters,
        segmentCount: segments.length,
        youtubeMetadata,
        aiCost,
        aiModelUsed: modelUsed,
        subtitlesCompletedAt: FieldValue.serverTimestamp(),
      });

      await logJob({
        classId,
        jobType: 'processLectureSubtitles',
        status: 'completed',
        promptText,
        mediaPaths: [gsUri],
        cost: aiCost,
        modelUsed,
        result: `Generated ${segments.length} segments across ${allLanguages.length} languages.`,
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
      console.error('[processLectureSubtitles] Error:', err);
      await sessionRef.update({
        status: 'subtitles_failed',
        error: err.message,
        failedAt: FieldValue.serverTimestamp(),
      });

      await logJob({
        classId,
        jobType: 'processLectureSubtitles',
        status: 'failed',
        promptText,
        mediaPaths: [gsUri],
        cost: 0,
        modelUsed: activeModel,
        errorDetails: err.message,
      });

      throw new HttpsError('internal', `Failed to generate lecture subtitles: ${err.message}`);
    }
  }
);
