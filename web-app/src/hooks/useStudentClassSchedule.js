import { useState, useEffect, useRef } from 'react';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { db } from '../firebase-config';

const timeStringToMinutes = (t) => {
  if (!t || typeof t !== 'string') return -1;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return -1;
  return h * 60 + m;
};

export const useStudentClassSchedule = (user) => {
  const [userClasses, setUserClasses] = useState([]);
  const [schedules, setSchedules] = useState({});
  const [classMeta, setClassMeta] = useState({});
  const classMetaRef = useRef({});
  const [activeClassIds, setActiveClassIds] = useState([]);
  const [currentActiveClassId, setCurrentActiveClassId] = useState(null);
  const [loading, setLoading] = useState(true);

  // Step 1: Fetch all class IDs for the student in real-time
  useEffect(() => {
    if (!user || !user.uid) {
      console.log('useStudentClassSchedule: No user, skipping.');
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }

    console.log(`useStudentClassSchedule: Subscribing to student profile for ${user.uid}`);
    const userDocRef = doc(db, 'studentProfiles', user.uid);
    const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const userData = docSnap.data();
        const classes = userData.classes || [];
        console.log(`useStudentClassSchedule: Student is in classes:`, classes);
        setUserClasses(classes);
      } else {
        console.log('useStudentClassSchedule: Student profile does not exist.');
        setUserClasses([]);
      }
    }, (error) => {
      console.error('useStudentClassSchedule: Error fetching student profile:', error);
    });

    return () => unsubscribe();
  }, [user]);

  // Step 2: Fetch the schedule and live broadcast/overtime metadata for each class whenever the student's class list changes
  useEffect(() => {
    if (userClasses.length === 0) {
      console.log('useStudentClassSchedule: No classes for student, schedules empty.');
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSchedules({});
      setClassMeta({});
      classMetaRef.current = {};
      setLoading(false);
      return;
    }

    const fetchSchedules = async () => {
      setLoading(true);
      console.log('useStudentClassSchedule: Fetching schedules for classes:', userClasses);
      const schedulesData = {};
      const metaData = {};
      for (const rawClass of userClasses) {
        const classId = typeof rawClass === 'string' ? rawClass : rawClass?.id;
        if (!classId) continue;
        try {
          const classRef = doc(db, 'classes', classId);
          console.log(`useStudentClassSchedule: Getting document for class ${classId}`);
          const classSnap = await getDoc(classRef);
          if (classSnap && typeof classSnap.exists === 'function' && classSnap.exists()) {
            console.log(`useStudentClassSchedule: Successfully fetched schedule for ${classId}`);
            const data = classSnap.data() || {};
            schedulesData[classId] = data.schedule;
            metaData[classId] = {
              isBroadcasting: Boolean(data.isBroadcasting),
              isCapturing: Boolean(data.isCapturing),
              overtimeUntil: data.overtimeUntil || null,
            };
          } else {
            console.log(`useStudentClassSchedule: Class document ${classId} does not exist.`);
          }
        } catch (error) {
          console.error(`useStudentClassSchedule: Error fetching schedule for class ${classId}:`, error);
        }
      }
      classMetaRef.current = metaData;
      setClassMeta(metaData);
      setSchedules(schedulesData);
      setLoading(false);
      console.log('useStudentClassSchedule: Finished fetching schedules.', schedulesData);
    };

    fetchSchedules();
  }, [userClasses]);

  // Step 3: Periodically check the schedules & live broadcast/overtime status to determine the currently active class(es)
  useEffect(() => {
    const evaluateSchedules = (currentSchedules, currentMeta) => {
      const now = new Date();
      const nowMs = now.getTime();

      // Priority buckets to ensure overlapping / back-to-back classes are handled without hijacking:
      // 1. inSlotBroadcastClasses: Currently in scheduled slot AND actively broadcasting
      // 2. overrunBroadcastClasses: Outside scheduled slot, but teacher is actively broadcasting live right now
      // 3. inSlotScheduledClasses: Currently in scheduled slot (normal scheduled class)
      // 4. overrunActiveClasses: Outside scheduled slot, but has explicit overtimeUntil > now or active capture overrun (within 90m)
      const inSlotBroadcastClasses = [];
      const overrunBroadcastClasses = [];
      const inSlotScheduledClasses = [];
      const overrunActiveClasses = [];

      const allClassIds = Array.from(
        new Set([...Object.keys(currentSchedules || {}), ...Object.keys(currentMeta || {})])
      );

      for (const classId of allClassIds) {
        const meta = currentMeta?.[classId] || {};
        const overtimeUntilMs = meta.overtimeUntil
          ? (typeof meta.overtimeUntil.toDate === 'function'
              ? meta.overtimeUntil.toDate().getTime()
              : new Date(meta.overtimeUntil).getTime())
          : 0;
        const hasActiveOvertime = !Number.isNaN(overtimeUntilMs) && overtimeUntilMs > nowMs;

        const schedule = currentSchedules?.[classId];
        let matchesScheduledSlot = false;
        let matchesCaptureOverrun = false;

        if (schedule && schedule.timeSlots && schedule.timeZone && schedule.startDate && schedule.endDate) {
          const { timeSlots, timeZone, startDate, endDate } = schedule;
          try {
            // Get current time and day in the target timezone
            const formatter = new Intl.DateTimeFormat('en-US', {
              timeZone,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              weekday: 'short',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            });
            const parts = formatter.formatToParts(now);
            const currentDay = parts.find(p => p.type === 'weekday')?.value;
            const currentHour = parts.find(p => p.type === 'hour')?.value;
            const currentMinute = parts.find(p => p.type === 'minute')?.value;

            const year = parts.find(p => p.type === 'year')?.value;
            const month = parts.find(p => p.type === 'month')?.value;
            const day = parts.find(p => p.type === 'day')?.value;

            if (currentDay && currentHour && currentMinute && year && month && day) {
              const currentDate = `${year}-${month}-${day}`;

              if (currentDate >= startDate && currentDate <= endDate) {
                const currentTime = `${currentHour}:${currentMinute}`;
                const currentMins = timeStringToMinutes(currentTime);

                for (const slot of timeSlots) {
                  if (slot.days.includes(currentDay)) {
                    const { startTime, endTime } = slot;
                    // Overnight slot
                    if (startTime > endTime) {
                      if (currentTime >= startTime || currentTime < endTime) {
                        matchesScheduledSlot = true;
                        break;
                      }
                    } else { // Same day slot
                      if (currentTime >= startTime && currentTime < endTime) {
                        matchesScheduledSlot = true;
                        break;
                      } else if (meta.isCapturing && currentMins >= 0) {
                        const endMins = timeStringToMinutes(endTime);
                        if (endMins >= 0 && currentMins >= endMins && currentMins <= endMins + 90) {
                          matchesCaptureOverrun = true;
                        }
                      }
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.error(`Invalid timezone identifier: '${timeZone}' for class ${classId}`, e);
          }
        }

        if (matchesScheduledSlot) {
          if (meta.isBroadcasting) {
            inSlotBroadcastClasses.push(classId);
          } else {
            inSlotScheduledClasses.push(classId);
          }
        } else if (meta.isBroadcasting) {
          overrunBroadcastClasses.push(classId);
        } else if (hasActiveOvertime || matchesCaptureOverrun) {
          overrunActiveClasses.push(classId);
        }
      }

      const matchedClasses = [
        ...inSlotBroadcastClasses,
        ...overrunBroadcastClasses,
        ...inSlotScheduledClasses,
        ...overrunActiveClasses,
      ];
      setActiveClassIds(matchedClasses);
      setCurrentActiveClassId(matchedClasses.length > 0 ? matchedClasses[0] : null);
    };

    // Run check immediately
    evaluateSchedules(schedules, classMeta);

    // Every 30 seconds, evaluate schedule immediately and refresh class metadata in background
    const interval = setInterval(() => {
      evaluateSchedules(schedules, classMetaRef.current);

      if (userClasses && userClasses.length > 0) {
        (async () => {
          let hasChanges = false;
          const nextSchedules = { ...schedules };
          const nextMeta = { ...classMetaRef.current };

          for (const rawClass of userClasses) {
            const classId = typeof rawClass === 'string' ? rawClass : rawClass?.id;
            if (!classId) continue;
            try {
              const snap = await getDoc(doc(db, 'classes', classId));
              if (snap && typeof snap.exists === 'function' && snap.exists()) {
                const data = snap.data() || {};
                if (data.schedule) {
                  nextSchedules[classId] = data.schedule;
                }
                const newMeta = {
                  isBroadcasting: Boolean(data.isBroadcasting),
                  isCapturing: Boolean(data.isCapturing),
                  overtimeUntil: data.overtimeUntil || null,
                };
                const prevMeta = nextMeta[classId] || {};
                if (
                  prevMeta.isBroadcasting !== newMeta.isBroadcasting ||
                  prevMeta.isCapturing !== newMeta.isCapturing ||
                  prevMeta.overtimeUntil !== newMeta.overtimeUntil
                ) {
                  nextMeta[classId] = newMeta;
                  hasChanges = true;
                }
              }
            } catch {
              // Ignore transient polling errors
            }
          }

          if (hasChanges) {
            classMetaRef.current = nextMeta;
            setClassMeta(nextMeta);
            evaluateSchedules(nextSchedules, nextMeta);
          }
        })();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [schedules, classMeta, userClasses]);

  return { userClasses, currentActiveClassId, activeClassIds, schedules, loading };
};

