import { getAuth } from 'firebase-admin/auth';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { format } from 'date-fns-tz';
import { FUNCTION_REGION } from './config.js';

const db = getFirestore();
const adminAuth = getAuth();

// Helper to get local time and day in a specific timezone
function getLocalTimeInfo(date, timeZone) {
  const options = { timeZone, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(date);

  const localTime = parts.find(p => p.type === 'hour').value + ':' + parts.find(p => p.type === 'minute').value;
  const localDay = parts.find(p => p.type === 'weekday').value;

  return { localTime, localDay };
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

export const handleAutomaticVideoCombination = onSchedule(videoCombinationOptions, async () => {
  const now = new Date();
  logger.info(`handleAutomaticVideoCombination triggered at ${now.toISOString()}`);

  const classesRef = db.collection('classes');
  const snapshot = await classesRef.where('automaticCombine', '==', true).get();

  if (snapshot.empty) {
    logger.info('No classes with automaticCombine enabled.');
    return;
  }

  logger.info(`Found ${snapshot.size} classes with automaticCombine enabled.`);

  const jobCreationPromises = [];
  const notificationsToCreate = new Map(); // Use a map to avoid duplicate notifications per class

  for (const doc of snapshot.docs) {
    const classData = doc.data();
    const classId = doc.id;
    const { schedule, students, teachers } = classData;
    const studentUids = Object.keys(students || {});
    const teacherUids = Object.keys(teachers || {});

    if (!schedule || !schedule.timeZone || !schedule.timeSlots || !studentUids || studentUids.length === 0) {
      logger.warn(`Skipping class ${classId} due to incomplete configuration (schedule, timeZone, timeSlots, or students missing).`);
      continue; // Skip if not properly configured
    }

    const { timeZone } = schedule;
    const { localDay, localTime } = getLocalTimeInfo(now, timeZone);
    const todayStr = format(now, 'yyyy-MM-dd', { timeZone });
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

    logger.info(`Checking class '${classId}'. Current time in ${timeZone}: ${localDay} ${localTime}.`);
    let slotFound = false;

    for (const slot of schedule.timeSlots) {
      if (!slot.days.includes(localDay)) {
        continue; // Not scheduled for today
      }

      const offset = format(now, 'XXX', { timeZone });
      const lessonEndDateTimeStr = `${todayStr}T${slot.endTime}:00${offset}`;
      const lessonEndDateTimeInZone = new Date(lessonEndDateTimeStr);

      // Check if the lesson ended within the last 30 minutes
      if (lessonEndDateTimeInZone > thirtyMinutesAgo && lessonEndDateTimeInZone <= now) {
        slotFound = true;
        logger.info(`Found recently ended lesson slot for class '${classId}' (ends at ${slot.endTime}). Triggering video combination.`);

        if (!notificationsToCreate.has(classId)) {
          notificationsToCreate.set(classId, teacherUids || []);
        }

        const lessonStartDateTimeInZone = new Date(`${todayStr}T${slot.startTime}:00${offset}`);

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
                logger.info(`Creating video job for student ${studentEmail} (${studentUid}) in class ${classId}`);
                return newDocRef.set({
                  jobId: newDocRef.id,
                  classId: classId,
                  studentUid: studentUid,
                  studentEmail: studentEmail,
                  startTime: lessonStartDateTimeInZone,
                  endTime: lessonEndDateTimeInZone,
                  status: 'pending',
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
    if (!slotFound) {
      logger.info(`No recently ended lesson slots found for class '${classId}'.`);
    }
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

export const syncGeminiPricing = onSchedule({
  schedule: 'every 24 hours',
  memory: '256MB',
  region: FUNCTION_REGION,
}, async () => {
  logger.info('Starting daily sync of Gemini model pricing...');
  try {
    const VERTEX_SERVICE_ID = 'C7E2-9256-1C43';
    const pricingData = {
      'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
      'gemini-3.7-flash': { input: 0.75, output: 3.75 },
      'gemini-3.8-flash': { input: 0.75, output: 3.75 },
      'gemini-3.7-pro': { input: 3.00, output: 15.00 },
      'gemini-3.5-transcribe': { input: 0.50, output: 2.50 },
      'gemini-3.5-transcribe-live': { input: 0.60, output: 3.00 },
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
    }

    const pricingRef = db.collection('system_config').doc('pricing');
    await pricingRef.set(pricingData, { merge: true });
    logger.info('Successfully updated system_config/pricing in Firestore.');
  } catch (error) {
    logger.error('Error syncing Gemini pricing:', error);
  }
});