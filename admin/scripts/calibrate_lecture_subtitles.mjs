import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import crypto from 'crypto';

const projectId = process.argv[2] || 'it114115-2627';
const classId = process.argv[3] || 'itp4124-l';
const sessionId = process.argv[4] || 'rec_1790924043417_ausm5my';
const bucketName = `${projectId}.firebasestorage.app`;

console.log(`[CalibrateSubtitles] Project: ${projectId}, Class: ${classId}, Session: ${sessionId}`);

const app = initializeApp({ projectId, storageBucket: bucketName });
const db = getFirestore(app);
const bucket = getStorage(app).bucket();

function formatTimestampToVTT(seconds) {
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

function formatTimestampToSRT(seconds) {
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

  return `${hh}:${mm}:${ss},${mmm}`;
}

function parseVtt(text) {
  const blocks = text.replace(/\r\n/g, '\n').split('\n\n');
  const cues = [];
  for (const b of blocks) {
    const lines = b.trim().split('\n');
    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx !== -1) {
      const m = lines[timeLineIdx].match(/(\d{2}):(\d{2}):(\d{2}\.\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}\.\d{3})/);
      if (m) {
        const start = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
        const end = parseInt(m[4], 10) * 3600 + parseInt(m[5], 10) * 60 + parseFloat(m[6]);
        const text = lines.slice(timeLineIdx + 1).join('\n').trim();
        if (text) {
          cues.push({ start, end, text });
        }
      }
    }
  }
  return cues;
}

function buildVttContent(cues) {
  let vtt = 'WEBVTT\n\n';
  cues.forEach((cue, idx) => {
    vtt += `${idx + 1}\n`;
    vtt += `${formatTimestampToVTT(cue.start)} --> ${formatTimestampToVTT(cue.end)}\n`;
    vtt += `${cue.text}\n\n`;
  });
  return vtt;
}

function buildSrtContent(cues) {
  let srt = '';
  cues.forEach((cue, idx) => {
    srt += `${idx + 1}\n`;
    srt += `${formatTimestampToSRT(cue.start)} --> ${formatTimestampToSRT(cue.end)}\n`;
    srt += `${cue.text}\n\n`;
  });
  return srt;
}

async function main() {
  const sessionRef = db.collection('classes').doc(classId).collection('lectureRecordings').doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new Error(`Session ${sessionId} not found`);
  }
  const sessionData = sessionSnap.data();
  console.log(`[CalibrateSubtitles] Found session: "${sessionData.title || sessionData.topic || sessionId}"`);

  const totalDuration = 2211.5; // Probed exact duration of video and audio
  console.log(`[CalibrateSubtitles] Total real media duration: ${totalDuration}s (36:51.5)`);

  const languages = ['original', 'en', 'zh-Hant', 'zh-Hans'];
  const calibratedCuesByLang = {};

  // Download and parse original to calculate precise drift ratio
  const origPath = `subtitles/${classId}/${sessionId}/subtitles_original.vtt`;
  const [origBuf] = await bucket.file(origPath).download();
  const rawOrigCues = parseVtt(origBuf.toString('utf8'));
  const rawMaxEnd = rawOrigCues[rawOrigCues.length - 1].end;
  const driftRatio = totalDuration / rawMaxEnd;
  console.log(`[CalibrateSubtitles] Raw max end: ${rawMaxEnd}s, Probed duration: ${totalDuration}s, Drift ratio: ${driftRatio.toFixed(6)}x`);

  for (const lang of languages) {
    const vttPath = `subtitles/${classId}/${sessionId}/subtitles_${lang}.vtt`;
    console.log(`[CalibrateSubtitles] Processing ${lang} from ${vttPath}...`);
    const [buf] = await bucket.file(vttPath).download();
    const rawCues = parseVtt(buf.toString('utf8'));
    console.log(`[CalibrateSubtitles] Parsed ${rawCues.length} cues for ${lang}`);

    const calibratedCues = rawCues.map((c, idx) => {
      const calStart = Math.round(c.start * driftRatio * 1000) / 1000;
      let calEnd = Math.round(c.end * driftRatio * 1000) / 1000;
      if (calEnd <= calStart) {
        calEnd = calStart + 2.0;
      }
      calEnd = Math.min(totalDuration, calEnd);
      return {
        start: calStart,
        end: calEnd,
        text: c.text,
      };
    });

    calibratedCuesByLang[lang] = calibratedCues;
  }

  // Upload calibrated VTT and SRT files to Cloud Storage
  const vttUrls = {};
  const srtUrls = {};

  for (const lang of languages) {
    const cues = calibratedCuesByLang[lang];
    const vttContent = buildVttContent(cues);
    const srtContent = buildSrtContent(cues);

    const vttPath = `subtitles/${classId}/${sessionId}/subtitles_${lang}.vtt`;
    const srtPath = `subtitles/${classId}/${sessionId}/subtitles_${lang}.srt`;

    const vttToken = crypto.randomUUID();
    const srtToken = crypto.randomUUID();

    console.log(`[CalibrateSubtitles] Uploading calibrated ${vttPath} and ${srtPath}...`);

    await bucket.file(vttPath).save(vttContent, {
      contentType: 'text/vtt; charset=utf-8',
      metadata: {
        classId,
        sessionId,
        language: lang,
        calibrated: 'true',
        metadata: { firebaseStorageDownloadTokens: vttToken },
      },
    });

    await bucket.file(srtPath).save(srtContent, {
      contentType: 'text/plain; charset=utf-8',
      metadata: {
        classId,
        sessionId,
        language: lang,
        calibrated: 'true',
        metadata: { firebaseStorageDownloadTokens: srtToken },
      },
    });

    vttUrls[lang] = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(vttPath)}?alt=media&token=${vttToken}`;
    srtUrls[lang] = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(srtPath)}?alt=media&token=${srtToken}`;
  }

  // Calibrated chapter markers based on content analysis
  const chapters = [
    { timeSeconds: 0, title: 'DynamoDB Architecture & Replication Factor' },
    { timeSeconds: 344, title: 'RCU & WCU Capacity Calculations' },
    { timeSeconds: 846, title: 'ACID Transactions & DynamoDB Streams' },
    { timeSeconds: 1175, title: 'Global Tables & Clock Synchronization' },
    { timeSeconds: 1458, title: 'Point-in-Time Recovery (PITR) vs Snapshots' },
    { timeSeconds: 1726, title: 'Provisioned Capacity & Error Handling' },
    { timeSeconds: 1994, title: 'DynamoDB APIs, Scan, Query & Expressions' },
  ];

  const chaptersBlock = chapters
    .map((ch) => {
      const s = ch.timeSeconds;
      const mins = Math.floor(s / 60);
      const secs = s % 60;
      return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')} - ${ch.title}`;
    })
    .join('\n');

  const today = new Date().toISOString().split('T')[0];
  const youtubeMetadata = {
    title: `${classId} - DynamoDB Advanced Architecture & Operations (${today})`,
    description: `ITP4124 Lecture: DynamoDB Advanced Architecture & Operations
Course: ${classId}
Recorded Date: ${today}

Timestamps & Chapters:
${chaptersBlock}

Closed Captions (CC) Available in Player:
- Original (Cantonese/English)
- English
- Traditional Chinese (繁體中文)
- Simplified Chinese (简体中文)

Recorded with Google AI Classroom Assistant.`,
  };

  // Update Firestore document
  console.log(`[CalibrateSubtitles] Updating Firestore session doc...`);
  await sessionRef.update({
    status: 'ready',
    vttUrls,
    srtUrls,
    chapters,
    segmentCount: calibratedCuesByLang.original.length,
    durationSeconds: Math.round(totalDuration),
    subtitlesCalibrated: true,
    driftRatio: Math.round(driftRatio * 10000) / 10000,
    youtubeMetadata,
    aiModelUsed: 'gemini-3.8-flash',
    targetLanguages: ['en', 'zh-Hant', 'zh-Hans'],
    subtitlesCompletedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  console.log(`[CalibrateSubtitles] Successfully updated session ${sessionId}!`);
  console.log('Chapters:');
  console.log(chaptersBlock);
  console.log('\nVTT URLs:');
  console.log(JSON.stringify(vttUrls, null, 2));
}

main().catch((err) => {
  console.error('[CalibrateSubtitles] Fatal error:', err);
  process.exit(1);
});
