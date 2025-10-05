import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import * as dateFnsTz from 'date-fns-tz';

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
    memory: '512MB'
};

export const handleAutomaticCapture = onSchedule(scheduleOptions, async (event) => {
    const db = getFirestore();
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
    memory: '512MB'
};

export const handleAutomaticVideoCombination = onSchedule(videoCombinationOptions, async (event) => {
    const db = getFirestore();
    const now = new Date();

    const classesRef = db.collection('classes');
    const snapshot = await classesRef.where('automaticCombine', '==', true).get();

    if (snapshot.empty) {
        logger.info('No classes with automaticCombine enabled.');
        return;
    }

    const jobCreationPromises = [];
    const notificationsToCreate = new Map(); // Use a map to avoid duplicate notifications per class

    snapshot.forEach(doc => {
        const classData = doc.data();
        const classId = doc.id;
        const { schedule, students, timeZone, teachers } = classData;

        if (!schedule || !timeZone || !schedule.timeSlots || !students || students.length === 0) {
            return; // Skip if not properly configured
        }

        const { localDay } = getLocalTimeInfo(now, timeZone);
        const todayStr = dateFnsTz.formatInTimeZone(now, timeZone, 'yyyy-MM-dd');
        const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

        schedule.timeSlots.forEach(slot => {
            if (!slot.days.includes(localDay)) {
                return; // Not scheduled for today
            }

            const lessonEndDateTimeInZone = dateFnsTz.zonedTimeToUtc(`${todayStr}T${slot.endTime}`, timeZone);

            // Check if the lesson ended within the last 30 minutes
            if (lessonEndDateTimeInZone > thirtyMinutesAgo && lessonEndDateTimeInZone <= now) {
                logger.info(`Found recently ended class ${classId} at ${slot.endTime}. Triggering video combination.`);

                if (!notificationsToCreate.has(classId)) {
                    notificationsToCreate.set(classId, teachers || []);
                }

                const lessonStartDateTimeInZone = dateFnsTz.zonedTimeToUtc(`${todayStr}T${slot.startTime}`, timeZone);

                const jobsForClass = students.map(studentEmail => {
                    const student = studentEmail.trim().toLowerCase();
                    const videoJobsRef = db.collection('videoJobs');
                    
                    const q = videoJobsRef
                        .where('classId', '==', classId)
                        .where('student', '==', student)
                        .where('startTime', '==', lessonStartDateTimeInZone)
                        .where('endTime', '==', lessonEndDateTimeInZone);

                    return q.get().then(existingJobs => {
                        if (existingJobs.empty) {
                            const newDocRef = videoJobsRef.doc();
                            logger.info(`Creating video job for student ${student} in class ${classId}`);
                            return newDocRef.set({
                                jobId: newDocRef.id,
                                classId: classId,
                                student: student,
                                startTime: lessonStartDateTimeInZone,
                                endTime: lessonEndDateTimeInZone,
                                status: 'pending',
                                createdAt: FieldValue.serverTimestamp(),
                            });
                        } else {
                            logger.info(`Video job already exists for student ${student} in class ${classId}, skipping.`);
                            return Promise.resolve();
                        }
                    });
                });
                jobCreationPromises.push(...jobsForClass);
            }
        });
    });

    await Promise.all(jobCreationPromises);

    const notificationPromises = [];
    for (const [classId, teachers] of notificationsToCreate.entries()) {
        for (const teacherEmail of teachers) {
            const promise = db.collection('notifications').add({
                userId: teacherEmail,
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