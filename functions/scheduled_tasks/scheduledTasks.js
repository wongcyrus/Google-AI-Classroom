import { getAuth } from 'firebase-admin/auth';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { format, fromZonedTime } from 'date-fns-tz';
import { FUNCTION_REGION } from './config.js';

const db = getFirestore();
const adminAuth = getAuth();

/**
 * Safely parses date strings into millisecond timestamps.
 * If the string contains an explicit timezone (Z or offset), it is parsed as standard ISO.
 * If naive (e.g. "YYYY-MM-DDTHH:mm" from datetime-local input), it is interpreted in the class timezone.
 */
export function parsePeriodDateMs(dateStr, timeZone = 'Asia/Hong_Kong') {
  if (!dateStr) return NaN;
  if (typeof dateStr.toMillis === 'function') return dateStr.toMillis();
  if (dateStr instanceof Date) return dateStr.getTime();
  if (typeof dateStr === 'number') return dateStr;
  if (typeof dateStr !== 'string') return NaN;

  if (/Z$|[+-]\d{2}(?::?\d{2})?$/i.test(dateStr.trim())) {
    return new Date(dateStr).getTime();
  }

  try {
    const zoned = fromZonedTime(dateStr, timeZone);
    const ms = zoned.getTime();
    if (!isNaN(ms)) return ms;
  } catch {}

  return new Date(dateStr).getTime();
}

// Helper to get local time, day, and date in a specific timezone
export function getLocalTimeAndDay(date, timeZone) {
  const options = {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(date);

  const localTime = parts.find(p => p.type === 'hour').value + ':' + parts.find(p => p.type === 'minute').value;
  const localDay = parts.find(p => p.type === 'weekday').value;
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  const localDate = year && month && day ? `${year}-${month}-${day}` : '';

  return { localTime, localDay, localDate };
}

// Helper to get local time and day in a specific timezone
export function getLocalTimeInfo(date, timeZone) {
  return getLocalTimeAndDay(date, timeZone);
}

/**
 * Evaluates whether a class session is currently active:
 *  - Scheduled class: Active when current time is within schedule date range and an active time slot.
 *    If outside schedule, only active if teacher explicitly enabled manual capture (overtime).
 *  - Unscheduled / manual class: Active when isCapturing is true and started < 3 hours ago.
 */
export function isClassSessionActive(classData, now = new Date()) {
  if (!classData) return false;

  const { schedule, captureStartedAt, isCapturing } = classData;

  // Case 1: Scheduled class (session active within scheduled start and end time)
  if (schedule && schedule.timeZone && Array.isArray(schedule.timeSlots) && schedule.timeSlots.length > 0) {
    try {
      const { localTime, localDay, localDate } = getLocalTimeAndDay(now, schedule.timeZone);

      if (schedule.startDate && schedule.endDate) {
        if (localDate < schedule.startDate || localDate > schedule.endDate) {
          return false;
        }
      }

      const activeSlot = schedule.timeSlots.find(slot => {
        if (!slot.days || !slot.days.includes(localDay)) return false;
        if (slot.startTime > slot.endTime) {
          return localTime >= slot.startTime || localTime <= slot.endTime;
        }
        return localTime >= slot.startTime && localTime <= slot.endTime;
      });

      return Boolean(activeSlot);
    } catch {
      return false;
    }
  }

  // Case 2: Manual / unscheduled class
  if (isCapturing) {
    if (captureStartedAt) {
      const startedMillis = captureStartedAt.toMillis ? captureStartedAt.toMillis() : new Date(captureStartedAt).getTime();
      if ((now.getTime() - startedMillis) > 3 * 60 * 60 * 1000) {
        return false;
      }
    }
    return true;
  }

  return false;
}


const scheduleOptions = {
  schedule: '5,25,35,55 * * * *',
  memory: '512MB',
  region: FUNCTION_REGION
};

export const handleAutomaticCapture = onSchedule(scheduleOptions, async () => {
  const now = new Date();
  const currentMinutes = now.getMinutes();

  const isStartTime = currentMinutes === 25 || currentMinutes === 55;
  const isStopTime = currentMinutes === 5 || currentMinutes === 35;

  const classesRef = db.collection('classes');
  const snapshot = await classesRef.where('automaticCapture', '==', true).get();

  if (snapshot.empty) {
    logger.info('No classes with automaticCapture enabled.');
    return;
  }

  const promises = [];

  snapshot.forEach(doc => {
    const classData = doc.data();
    const classId = doc.id;
    const { schedule } = classData;

    if (!schedule || !schedule.timeZone || !schedule.timeSlots || schedule.timeSlots.length === 0) {
      return; // Skip if no valid schedule
    }

    const { localTime, localDay } = getLocalTimeInfo(now, schedule.timeZone);

    schedule.timeSlots.forEach(slot => {
      if (!slot.days || !slot.days.includes(localDay)) {
        return; // Not scheduled for today
      }

      if (isStartTime) {
        // Check if a class should start in 5 minutes
        const targetStart = new Date(now.getTime() + 5 * 60 * 1000);
        const { localTime: targetLocalTime } = getLocalTimeInfo(targetStart, schedule.timeZone);

        if (slot.startTime === targetLocalTime && !classData.isCapturing) {
          logger.info(`Starting capture for class ${classId} at ${localTime} (${schedule.timeZone})`);
          promises.push(doc.ref.update({ isCapturing: true, captureStartedAt: FieldValue.serverTimestamp() }));
        }
      } else if (isStopTime) {
        // Check if a class should have ended 5 minutes ago
        const targetEnd = new Date(now.getTime() - 5 * 60 * 1000);
        const { localTime: targetLocalTime } = getLocalTimeInfo(targetEnd, schedule.timeZone);

        if (slot.endTime === targetLocalTime && classData.isCapturing) {
          logger.info(`Stopping capture for class ${classId} at ${localTime} (${schedule.timeZone})`);
          promises.push(doc.ref.update({ isCapturing: false, captureStartedAt: null }));
        }
      }
    });
  });

  await Promise.all(promises);
});

const videoCombinationOptions = {
  schedule: '15,45 * * * *',
  memory: '512MB',
  region: FUNCTION_REGION
};

export const handlePostLessonMediaConsolidation = onSchedule(videoCombinationOptions, async () => {
  const now = new Date();
  logger.info(`handlePostLessonMediaConsolidation triggered at ${now.toISOString()}`);

  const classesRef = db.collection('classes');
  const snapshot = await classesRef.get();

  if (!snapshot || snapshot.empty) {
    logger.info('No classes found in Firestore.');
    return;
  }

  logger.info(`Found ${snapshot.size} classes to check for student video jobs and teacher lecture combination.`);

  const jobCreationPromises = [];
  const notificationsToCreate = new Map(); // Use a map to avoid duplicate notifications per class

  for (const doc of snapshot.docs) {
    const classData = doc.data() || {};
    const classId = doc.id;
    const { schedule, students, teachers } = classData;
    const studentUids = Object.keys(students || {});
    const teacherUids = Object.keys(teachers || {});

    // 1. STUDENT SCREEN VIDEO COMBINATION:
    // Only applies if the class explicitly has automaticCombine === true, and has schedule + students
    if (classData.automaticCombine === true && schedule?.timeZone && Array.isArray(schedule.timeSlots) && studentUids.length > 0) {
      const { timeZone } = schedule;
      const { localDay, localTime } = getLocalTimeInfo(now, timeZone);
      const todayStr = format(now, 'yyyy-MM-dd', { timeZone });
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

      logger.info(`Checking student screen video jobs for class '${classId}'. Current time in ${timeZone}: ${localDay} ${localTime}.`);

      for (const slot of schedule.timeSlots) {
        if (!slot.days.includes(localDay)) {
          continue; // Not scheduled for today
        }

        const offset = format(now, 'XXX', { timeZone });
        const lessonEndDateTimeStr = `${todayStr}T${slot.endTime}:00${offset}`;
        const lessonEndDateTimeInZone = new Date(lessonEndDateTimeStr);

        // Check if the lesson ended within the last 30 minutes
        if (lessonEndDateTimeInZone > thirtyMinutesAgo && lessonEndDateTimeInZone <= now) {
          const lessonStartDateTimeInZone = new Date(`${todayStr}T${slot.startTime}:00${offset}`);

          // Check if this lesson overlaps with any defined exam/test periods
          const isExamSession = (classData.examPeriods || []).some(period => {
            if (!period || !period.startDate || !period.endDate) return false;
            const pStart = parsePeriodDateMs(period.startDate, timeZone);
            const pEnd = parsePeriodDateMs(period.endDate, timeZone);
            if (isNaN(pStart) || isNaN(pEnd)) return false;
            const lStart = lessonStartDateTimeInZone.getTime();
            const lEnd = lessonEndDateTimeInZone.getTime();
            return (lStart >= pStart && lStart <= pEnd) || (lEnd >= pStart && lEnd <= pEnd) || (pStart >= lStart && pEnd <= lEnd);
          }) || Boolean(slot.isExam || slot.type === 'exam');

          logger.info(`Found recently ended lesson slot for class '${classId}' (ends at ${slot.endTime}, isExam=${isExamSession}). Triggering student video combination.`);

          if (!notificationsToCreate.has(classId)) {
            notificationsToCreate.set(classId, teacherUids || []);
          }

          for (const studentUid of studentUids) {
            const videoJobsRef = db.collection('videoJobs');
            const q = videoJobsRef
              .where('classId', '==', classId)
              .where('studentUid', '==', studentUid)
              .where('startTime', '==', lessonStartDateTimeInZone)
              .where('endTime', '==', lessonEndDateTimeInZone);

            const jobPromise = q.get().then(async (existingJobs) => {
              if (existingJobs.empty) {
                try {
                  const userRecord = await adminAuth.getUser(studentUid);
                  const studentEmail = userRecord.email;

                  if (!studentEmail) {
                    logger.error(`Student with UID ${studentUid} has no email. Cannot create video job.`);
                    return;
                  }

                  const videoRetentionDays = classData.videoRetentionDays || classData.retentionDays || 90;
                  const videoExpireAt = new Date(Date.now() + videoRetentionDays * 24 * 60 * 60 * 1000);

                  const newDocRef = videoJobsRef.doc();
                  logger.info(`Creating video job for student ${studentEmail} (${studentUid}) in class ${classId} (isExam=${isExamSession})`);
                  return newDocRef.set({
                    jobId: newDocRef.id,
                    classId: classId,
                    studentUid: studentUid,
                    studentEmail: studentEmail,
                    startTime: lessonStartDateTimeInZone,
                    endTime: lessonEndDateTimeInZone,
                    status: 'pending',
                    isExam: isExamSession,
                    createdAt: FieldValue.serverTimestamp(),
                    expireAt: videoExpireAt,
                  });
                } catch (e) {
                  logger.error(`Failed to get user record for UID ${studentUid}`, e);
                }
              } else {
                logger.info(`Video job already exists for student ${studentUid} in class ${classId}, skipping.`);
              }
            });
            jobCreationPromises.push(jobPromise);
          }
        }
      }
    }

    // 2. TEACHER LECTURE RECORDING COMBINATION:
    // ALWAYS enabled across ALL classes unconditionally (ZERO special settings required!)
    // Scans classes/{classId}/lectureRecordings for unmerged rolling clips or fragments after class.
    const lectureMergePromise = (async () => {
      try {
        const lectureRecsRef = db.collection(`classes/${classId}/lectureRecordings`);
        const lectureSnap = await lectureRecsRef.get();
        if (!lectureSnap || lectureSnap.empty || !lectureSnap.forEach) return;

        const consolidateLessonVideo = classData.consolidateLessonVideo !== false;

        const unmergedClips = [];
        const existingCombinedClips = [];
        lectureSnap.forEach((recDoc) => {
          const r = recDoc.data() || {};
          if (r.isSegmentDeleted || r.status === 'discarded' || r.status === 'recording' || r.status === 'uploading') return;
          if (!r.storagePath && !r.videoUrl) return;

          const rStartMs = r.startedAt?.toMillis ? r.startedAt.toMillis() : (r.startedAt ? new Date(r.startedAt).getTime() : 0);

          if (r.isCombined) {
            if (!r.mergedIntoSessionId) {
              existingCombinedClips.push({ id: recDoc.id, ...r, rStartMs });
            }
            return;
          }

          if (r.mergedIntoSessionId) return;

          // Must be at least 2 minutes old to ensure chunk upload is completely finalized
          if (rStartMs && Date.now() - rStartMs < 2 * 60 * 1000) return;

          unmergedClips.push({ id: recDoc.id, ...r, rStartMs });
        });

        if (unmergedClips.length === 0 && (!consolidateLessonVideo || existingCombinedClips.length < 2)) return;

        // Check if a timetable slot is active, ongoing, or recently ended for this class (if timetable exists)
        let activeSlot = null;
        let isSlotOngoing = false;
        let todayStr = new Date().toISOString().slice(0, 10);
        let slotStartMs = 0;
        let slotEndMs = 0;

        if (schedule?.timeZone && Array.isArray(schedule.timeSlots)) {
          const { timeZone, timeSlots } = schedule;
          const { localDay } = getLocalTimeInfo(now, timeZone);
          todayStr = format(now, 'yyyy-MM-dd', { timeZone });
          const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

          for (const slot of timeSlots) {
            if (!slot.days.includes(localDay)) continue;
            const offset = format(now, 'XXX', { timeZone });
            const sStart = new Date(`${todayStr}T${slot.startTime}:00${offset}`);
            const sEnd = new Date(`${todayStr}T${slot.endTime}:00${offset}`);
            if (sEnd > thirtyMinutesAgo && sEnd <= now) {
              activeSlot = slot;
              slotStartMs = sStart.getTime();
              slotEndMs = sEnd.getTime();
              break;
            }
            if (sStart <= now && sEnd > now) {
              isSlotOngoing = true;
              slotStartMs = sStart.getTime();
              slotEndMs = sEnd.getTime();
            }
          }
        }

        // Handle Consolidation for Scheduled Active Slot:
        // When a scheduled lesson slot has concluded and consolidateLessonVideo !== false,
        // gather all unmerged segments AND any existing partial combined recordings belonging to that slot
        // into a single unified master merge job.
        if (activeSlot && consolidateLessonVideo) {
          const cleanStart = (activeSlot.startTime || '').replace(':', '');
          const cleanEnd = (activeSlot.endTime || '').replace(':', '');
          const mergeJobId = `merge_${classId}_${cleanStart}_${cleanEnd}_${todayStr}`;

          // Find all unmerged clips and existing combined clips that fall within this lesson slot (with a 15-minute buffer)
          const bufferMs = 15 * 60 * 1000;
          const slotClips = unmergedClips.filter(
            (c) => c.rStartMs >= (slotStartMs - bufferMs) && c.rStartMs <= (slotEndMs + bufferMs)
          );
          const slotCombined = existingCombinedClips.filter(
            (c) => c.rStartMs >= (slotStartMs - bufferMs) && c.rStartMs <= (slotEndMs + bufferMs)
          );

          const itemsToConsolidate = [...slotCombined, ...slotClips];
          if (itemsToConsolidate.length >= 2 || (slotCombined.length >= 1 && slotClips.length >= 1)) {
            const mergeJobRef = db.collection('lectureMergeJobs').doc(mergeJobId);
            const existingMergeJob = await mergeJobRef.get();
            const existingJobData = existingMergeJob.exists ? existingMergeJob.data() : null;
            const existingIds = new Set(existingJobData?.recordingIds || []);
            const hasNewItems = itemsToConsolidate.some((item) => !existingIds.has(item.id));

            if (!existingMergeJob.exists || existingJobData?.status === 'failed' || (hasNewItems && existingJobData?.status === 'completed')) {
              const effectiveJobId = (!existingMergeJob.exists || existingJobData?.status !== 'completed')
                ? mergeJobId
                : `${mergeJobId}_recombine_${Date.now()}`;

              const targetDocRef = (!existingMergeJob.exists || existingJobData?.status !== 'completed')
                ? mergeJobRef
                : db.collection('lectureMergeJobs').doc(effectiveJobId);

              logger.info(`Creating consolidated lesson merge job '${effectiveJobId}' for ${itemsToConsolidate.length} items (${slotCombined.length} previous combined, ${slotClips.length} segments) in class ${classId}`);
              await targetDocRef.set({
                jobId: effectiveJobId,
                classId,
                recordingIds: itemsToConsolidate.map((c) => c.id),
                sessionGroupId: `slot_${cleanStart}_${cleanEnd}`,
                customTitle: `Combined Full Lecture - ${todayStr}`,
                status: 'pending',
                createdAt: FieldValue.serverTimestamp(),
              });

              // Mark these clips as handled so they aren't processed again in the group loop below
              const handledIds = new Set(itemsToConsolidate.map((i) => i.id));
              for (let i = unmergedClips.length - 1; i >= 0; i--) {
                if (handledIds.has(unmergedClips[i].id)) {
                  unmergedClips.splice(i, 1);
                }
              }
            }
          }
        }

        // Group any remaining unmerged clips by sessionGroupId (or date/session prefix)
        const groups = new Map();
        for (const clip of unmergedClips) {
          const groupId = clip.sessionGroupId || clip.sessionId || `session_${clip.rStartMs ? new Date(clip.rStartMs).toISOString().slice(0, 10) : 'default'}`;
          if (!groups.has(groupId)) {
            groups.set(groupId, []);
          }
          groups.get(groupId).push(clip);
        }

        for (const [groupId, clips] of groups.entries()) {
          const isRolling = clips.some((c) => c.isRollingSegment);
          const latestClipMs = Math.max(...clips.map((c) => c.rStartMs || 0));
          // If rolling segments, session timeout requires 10 minutes of inactivity
          const isPastSession = latestClipMs > 0 && (Date.now() - latestClipMs >= (isRolling ? 10 * 60 * 1000 : 5 * 60 * 1000));

          let isConcluded = false;
          if (isSlotOngoing && isRolling) {
            // Lecture is actively recording rolling segments right now during scheduled class time;
            // DO NOT prematurely combine until class concludes!
            isConcluded = false;
          } else if (activeSlot) {
            isConcluded = true;
          } else if (isPastSession) {
            isConcluded = true;
          } else if (!isRolling && clips.some((c) => c.status === 'ready' || c.status === 'completed')) {
            isConcluded = true;
          }

          if (!isConcluded) {
            // Lecture is actively recording rolling segments right now during class; do not prematurely combine until class concludes
            continue;
          }

          if (clips.length >= 2) {
            let mergeJobId;
            if (activeSlot) {
              const cleanStart = (activeSlot.startTime || '').replace(':', '');
              const cleanEnd = (activeSlot.endTime || '').replace(':', '');
              mergeJobId = `merge_${classId}_${cleanStart}_${cleanEnd}_${todayStr}`;
            } else {
              const cleanGroupId = groupId.replace(/[^a-zA-Z0-9_-]/g, '_');
              mergeJobId = `merge_${classId}_${cleanGroupId}`;
            }

            const mergeJobRef = db.collection('lectureMergeJobs').doc(mergeJobId);
            const existingMergeJob = await mergeJobRef.get();

            if (!existingMergeJob || !existingMergeJob.exists || existingMergeJob.data()?.status === 'failed') {
              logger.info(`Creating automatic lecture merge job '${mergeJobId}' for ${clips.length} clips in class ${classId} (zero special settings required)`);
              await mergeJobRef.set({
                jobId: mergeJobId,
                classId,
                recordingIds: clips.map((c) => c.id),
                sessionGroupId: groupId,
                customTitle: `Combined Full Lecture - ${todayStr}`,
                status: 'pending',
                createdAt: FieldValue.serverTimestamp(),
              });
            }
          } else if (clips.length === 1 && clips[0].status === 'processing_subtitles') {
            const singleClip = clips[0];
            const subtitleJobId = `sub_${classId}_${singleClip.id}`;
            const subJobRef = db.collection('lectureSubtitleJobs').doc(subtitleJobId);
            const existingSubJob = await subJobRef.get();
            if (!existingSubJob || !existingSubJob.exists) {
              logger.info(`Enqueuing subtitle job for unfinalized single clip ${singleClip.id} in class ${classId}`);
              await subJobRef.set({
                jobId: subtitleJobId,
                classId,
                sessionId: singleClip.id,
                storagePath: singleClip.storagePath,
                audioStoragePath: singleClip.normalizedAudioStoragePath || singleClip.audioStoragePath,
                title: singleClip.title,
                status: 'pending',
                createdAt: FieldValue.serverTimestamp(),
              });
            }
          }
        }
      } catch (lecErr) {
        logger.warn(`Automatic lecture combination check for class ${classId} skipped: ${lecErr.message}`);
      }
    })();
    jobCreationPromises.push(lectureMergePromise);
  }

  await Promise.all(jobCreationPromises);

  const notificationPromises = [];
  for (const [classId, teachers] of notificationsToCreate.entries()) {
    for (const teacherUid of teachers) {
      const promise = db.collection('notifications').add({
        userId: teacherUid,
        message: `Automatic video creation has started for class '${classId}'. Videos will appear in the Playback tab as they become available.`,
        createdAt: FieldValue.serverTimestamp(),
        read: false,
        type: 'info'
      });
      notificationPromises.push(promise);
    }
  }

  await Promise.all(notificationPromises);
});

// Backward-compatible alias for deployment safety
export const handleAutomaticVideoCombination = handlePostLessonMediaConsolidation;

export const syncGeminiPricing = onSchedule({
  schedule: 'every 24 hours',
  memory: '256MB',
  region: FUNCTION_REGION,
}, async () => {
  logger.info('Starting daily sync of Gemini model pricing and Cloud Storage rates...');
  try {
    const VERTEX_SERVICE_ID = 'C7E2-9256-1C43';
    const STORAGE_SERVICE_ID = '95FF-2EF5-5EA1';
    const pricingData = {
      'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
      'gemini-3.8-flash': { input: 0.75, output: 3.75 },
      'gemini-3.7-flash': { input: 0.75, output: 3.75 },
      'gemini-3.7-pro': { input: 3.00, output: 15.00 },
      'gemini-3.5-transcribe': { input: 0.50, output: 2.50 },
      'gemini-3.5-transcribe-preview': { input: 0.50, output: 2.50 },
      'gemini-3.5-transcribe-live': { input: 0.60, output: 3.00 },
      'gemini-3.5-transcribe-live-preview': { input: 0.60, output: 3.00 },
      'gemini-3.1-flash-live-preview': { input: 0.60, output: 2.50 },
      'cloud-storage': {
        unit: 'GiB/month',
        ratePerGibMonth: 0.023,
        region: 'asia-east2',
        currency: 'USD',
        description: 'Standard Storage Hong Kong (Baseline)',
      },
      lastSyncedAt: new Date().toISOString(),
      source: 'catalog_sync_or_baseline',
    };

    const apiKey = process.env.GOOGLE_CLOUD_API_KEY || process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const res = await fetch(`https://cloudbilling.googleapis.com/v1/services/${VERTEX_SERVICE_ID}/skus?key=${apiKey}`);
        if (res.ok) {
          const data = await res.json();
          logger.info(`Successfully fetched ${data.skus?.length || 0} SKUs from Cloud Billing Catalog API.`);
          pricingData.source = 'cloud_billing_catalog_api';
        }
      } catch (fetchErr) {
        logger.warn('Could not query Billing Catalog API directly, using verified baseline rates:', fetchErr.message);
      }

      try {
        const resStorage = await fetch(`https://cloudbilling.googleapis.com/v1/services/${STORAGE_SERVICE_ID}/skus?key=${apiKey}`);
        if (resStorage.ok) {
          const dataStorage = await resStorage.json();
          const hkSku = dataStorage.skus?.find(s =>
            (s.serviceRegions?.includes('asia-east2') || s.description?.toLowerCase().includes('hong kong')) &&
            s.description?.toLowerCase().includes('standard storage')
          );
          if (hkSku?.pricingInfo?.[0]?.pricingExpression?.tieredRates?.[0]?.unitPrice) {
            const up = hkSku.pricingInfo[0].pricingExpression.tieredRates[0].unitPrice;
            const rate = Number(up.units || 0) + Number(up.nanos || 0) / 1e9;
            if (rate > 0) {
              pricingData['cloud-storage'] = {
                unit: 'GiB/month',
                ratePerGibMonth: rate,
                region: 'asia-east2',
                currency: up.currencyCode || 'USD',
                skuId: hkSku.skuId,
                description: hkSku.description,
              };
              logger.info(`Successfully fetched live Cloud Storage rate from Cloud Billing Catalog API: $${rate}/GiB-month (${hkSku.description})`);
            }
          }
        }
      } catch (storageErr) {
        logger.warn('Could not query Storage Billing Catalog API directly, using verified baseline rates:', storageErr.message);
      }
    }

    const pricingRef = db.collection('system_config').doc('pricing');
    await pricingRef.set(pricingData, { merge: true });
    logger.info('Successfully updated system_config/pricing in Firestore.');
  } catch (error) {
    logger.error('Error syncing Gemini pricing:', error);
  }
});

const bingoScheduleOptions = {
  schedule: '* * * * *',
  memory: '512MB',
  region: FUNCTION_REGION,
};

export const handleAutomaticBingo = onSchedule(bingoScheduleOptions, async () => {
  const now = new Date();
  logger.info(`handleAutomaticBingo triggered at ${now.toISOString()}`);

  const classesRef = db.collection('classes');
  const snapshot = await classesRef
    .where('autoBingoEnabled', '==', true)
    .get();

  if (snapshot.empty) {
    logger.info('No classes with autoBingoEnabled found.');
    return;
  }

  const batchJobs = [];

  for (const doc of snapshot.docs) {
    const classId = doc.id;
    const classData = doc.data() || {};

    // Stop bingo if class has ended or is not active (capturing stopped or outside schedule)
    if (!isClassSessionActive(classData, now)) {
      logger.info(`Class '${classId}' is not in an active session (capturing stopped or outside schedule). Skipping auto-bingo.`);
      continue;
    }

    // Auto-Bingo requires teacher's screen to be actively broadcasting!
    // If screen is not sharing, auto-bingo must stop immediately.
    try {
      const screenSessionDoc = await db.doc(`classes/${classId}/screenBroadcast/session`).get();
      const isScreenSharing = screenSessionDoc.exists && screenSessionDoc.data()?.isBroadcasting === true;
      if (!isScreenSharing) {
        logger.info(`Class '${classId}' is not broadcasting screen. Skipping auto-bingo.`);
        continue;
      }
    } catch (err) {
      logger.warn(`Failed to check screen broadcast session for class '${classId}':`, err);
      continue;
    }

    const intervalMinutes = Math.max(5, Math.min(30, Number(classData.autoBingoIntervalMinutes) || 5));
    const intervalMs = intervalMinutes * 60 * 1000;
    const mode = classData.autoBingoMode || 'teacher_screen';

    let isDue = false;
    if (classData.lastAutoBingoAt) {
      const lastAtMillis = classData.lastAutoBingoAt.toMillis ? classData.lastAutoBingoAt.toMillis() : new Date(classData.lastAutoBingoAt).getTime();
      if ((now.getTime() - lastAtMillis) >= intervalMs) {
        isDue = true;
      }
    } else if (classData.captureStartedAt) {
      const startedAtMillis = classData.captureStartedAt.toMillis ? classData.captureStartedAt.toMillis() : new Date(classData.captureStartedAt).getTime();
      if ((now.getTime() - startedAtMillis) >= intervalMs) {
        isDue = true;
      }
    } else {
      isDue = true;
    }

    if (isDue) {
      logger.info(`Class '${classId}' is due for automated Bingo check (interval: ${intervalMinutes}m, mode: ${mode}).`);
      
      const jobRef = db.collection('bingoJobs').doc();
      const jobPromise = (async () => {
        await jobRef.set({
          jobId: jobRef.id,
          classId,
          mode,
          status: 'pending',
          createdAt: FieldValue.serverTimestamp(),
        });
        await doc.ref.update({
          lastAutoBingoAt: FieldValue.serverTimestamp(),
        });
      })();

      batchJobs.push(jobPromise);
    }
  }

  await Promise.all(batchJobs);
});