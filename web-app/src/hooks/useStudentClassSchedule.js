import { useState, useEffect } from 'react';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { db } from '../firebase-config';

const timeStringToMinutes = (t) => {
  if (!t || typeof t !== 'string') return -1;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return -1;
  return h * 60 + m;
};

const toEpochMs = (val) => {
  if (!val) return 0;
  if (typeof val.toMillis === 'function') return val.toMillis();
  if (typeof val.toDate === 'function') {
    const ms = val.toDate().getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof val.seconds === 'number') return val.seconds * 1000;
  if (typeof val._seconds === 'number') return val._seconds * 1000;
  if (val instanceof Date) {
    const ms = val.getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (typeof val === 'string') {
    const ms = new Date(val).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
};

const EMPTY_SCHEDULE_STATE = {
  userClasses: [],
  currentActiveClassId: null,
  activeClassIds: [],
  schedules: {},
  loading: false,
};

function evaluateSchedulesFromData(currentSchedules, currentMeta) {
  const now = new Date();
  const nowMs = now.getTime();

  const inSlotBroadcastClasses = [];
  const overrunBroadcastClasses = [];
  const inSlotScheduledClasses = [];
  const overrunActiveClasses = [];

  const allClassIds = Array.from(
    new Set([...Object.keys(currentSchedules || {}), ...Object.keys(currentMeta || {})])
  );

  for (const classId of allClassIds) {
    const meta = currentMeta?.[classId] || {};
    const overtimeUntilMs = toEpochMs(meta.overtimeUntil);
    const hasActiveOvertime = overtimeUntilMs > nowMs;
    const hasExpiredOvertime = overtimeUntilMs > 0 && overtimeUntilMs <= nowMs;

    const broadcastStartedMs = toEpochMs(meta.broadcastStartedAt);
    const hasFreshBroadcastStart =
      broadcastStartedMs > 0 &&
      nowMs - broadcastStartedMs <= 3 * 60 * 60 * 1000;

    const schedule = currentSchedules?.[classId];
    let matchesScheduledSlot = false;
    let matchesCaptureOverrun = false;

    if (schedule && schedule.timeSlots && schedule.timeZone && schedule.startDate && schedule.endDate) {
      const { timeSlots, timeZone, startDate, endDate } = schedule;
      try {
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
        const currentDay = parts.find((p) => p.type === 'weekday')?.value;
        const currentHour = parts.find((p) => p.type === 'hour')?.value;
        const currentMinute = parts.find((p) => p.type === 'minute')?.value;

        const year = parts.find((p) => p.type === 'year')?.value;
        const month = parts.find((p) => p.type === 'month')?.value;
        const day = parts.find((p) => p.type === 'day')?.value;

        if (currentDay && currentHour && currentMinute && year && month && day) {
          const currentDate = `${year}-${month}-${day}`;

          if (currentDate >= startDate && currentDate <= endDate) {
            const currentTime = `${currentHour}:${currentMinute}`;
            const currentMins = timeStringToMinutes(currentTime);

            for (const slot of timeSlots) {
              if (slot.days.includes(currentDay)) {
                const { startTime, endTime } = slot;
                if (startTime > endTime) {
                  if (currentTime >= startTime || currentTime < endTime) {
                    matchesScheduledSlot = true;
                    break;
                  }
                } else {
                  if (currentTime >= startTime && currentTime < endTime) {
                    matchesScheduledSlot = true;
                    break;
                  } else if (meta.isCapturing && !hasExpiredOvertime && currentMins >= 0) {
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

    const isActiveBroadcastOverrun =
      Boolean(meta.isBroadcasting) &&
      (hasActiveOvertime || (!hasExpiredOvertime && (hasFreshBroadcastStart || matchesCaptureOverrun)));

    if (matchesScheduledSlot) {
      if (meta.isBroadcasting) {
        inSlotBroadcastClasses.push(classId);
      } else {
        inSlotScheduledClasses.push(classId);
      }
    } else if (isActiveBroadcastOverrun) {
      overrunBroadcastClasses.push(classId);
    } else if (hasActiveOvertime || matchesCaptureOverrun) {
      overrunActiveClasses.push(classId);
    }
  }

  return [
    ...inSlotBroadcastClasses,
    ...inSlotScheduledClasses,
    ...overrunBroadcastClasses,
    ...overrunActiveClasses,
  ];
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Shared reference-counted schedule store per `(db, userUid)` so multiple components
 * (`PasskeyEnforcementGate`, `StudentView`, `StudentMobileView`) share one
 * `studentProfiles/{uid}` listener, one batch of `classes/{id}` fetches, and one 30s timer.
 */
const dbScheduleStores = new WeakMap();

function getDbScheduleMap(dbInstance) {
  if (!dbInstance || (typeof dbInstance !== 'object' && typeof dbInstance !== 'function')) {
    return null;
  }
  let map = dbScheduleStores.get(dbInstance);
  if (!map) {
    map = new Map();
    dbScheduleStores.set(dbInstance, map);
  }
  return map;
}

function subscribeStudentScheduleStore(dbInstance, userUid, callback) {
  const storeMap = getDbScheduleMap(dbInstance);
  if (!storeMap || !userUid) {
    callback(EMPTY_SCHEDULE_STATE);
    return () => {};
  }

  let entry = storeMap.get(userUid);
  if (!entry) {
    entry = {
      listeners: new Set([callback]),
      disposed: false,
      fetchGeneration: 0,
      profileUnsub: null,
      intervalId: null,
      classMeta: {},
      state: {
        userClasses: [],
        currentActiveClassId: null,
        activeClassIds: [],
        schedules: {},
        loading: true,
      },
    };
    storeMap.set(userUid, entry);

    const emitState = (partial) => {
      if (entry.disposed) return;
      const prev = entry.state;
      const next = { ...prev, ...partial };
      const unchanged =
        prev.userClasses === next.userClasses &&
        prev.currentActiveClassId === next.currentActiveClassId &&
        prev.schedules === next.schedules &&
        prev.loading === next.loading &&
        arraysEqual(prev.activeClassIds, next.activeClassIds);
      if (unchanged) return;
      entry.state = next;
      Array.from(entry.listeners).forEach((cb) => {
        try {
          cb(next);
        } catch (err) {
          console.error('[useStudentClassSchedule] Subscriber error:', err);
        }
      });
    };

    const evaluateAndComputePatch = (nextSchedules, nextMeta) => {
      const matchedClasses = evaluateSchedulesFromData(nextSchedules, nextMeta);
      const nextPrimary = matchedClasses.length > 0 ? matchedClasses[0] : null;
      return {
        activeClassIds: arraysEqual(entry.state.activeClassIds, matchedClasses)
          ? entry.state.activeClassIds
          : matchedClasses,
        currentActiveClassId: nextPrimary,
      };
    };

    const fetchInitialSchedules = async (classes) => {
      const gen = ++entry.fetchGeneration;
      if (!classes || classes.length === 0) {
        entry.classMeta = {};
        const evalPatch = evaluateAndComputePatch({}, {});
        emitState({
          userClasses: classes,
          schedules: {},
          loading: false,
          ...evalPatch,
        });
        return;
      }

      emitState({ userClasses: classes, loading: true });
      const schedulesData = {};
      const metaData = {};

      const classIds = classes
        .map((rawClass) => (typeof rawClass === 'string' ? rawClass : rawClass?.id))
        .filter(Boolean);

      await Promise.all(
        classIds.map(async (classId) => {
          try {
            const classRef = doc(dbInstance, 'classes', classId);
            const classSnap = await getDoc(classRef);
            if (classSnap && typeof classSnap.exists === 'function' && classSnap.exists()) {
              const data = classSnap.data() || {};
              schedulesData[classId] = data.schedule;
              metaData[classId] = {
                isBroadcasting: Boolean(data.isBroadcasting),
                isCapturing: Boolean(data.isCapturing),
                overtimeUntil: data.overtimeUntil || null,
                broadcastStartedAt: data.broadcastStartedAt || null,
                captureStartedAt: data.captureStartedAt || null,
              };
            }
          } catch (error) {
            console.error(`useStudentClassSchedule: Error fetching schedule for class ${classId}:`, error);
          }
        })
      );

      if (entry.disposed || entry.fetchGeneration !== gen) return;
      entry.classMeta = metaData;
      const evalPatch = evaluateAndComputePatch(schedulesData, metaData);
      emitState({
        schedules: schedulesData,
        loading: false,
        ...evalPatch,
      });
    };

    const userDocRef = doc(dbInstance, 'studentProfiles', userUid);
    const profileUnsub = onSnapshot(
      userDocRef,
      (docSnap) => {
        if (entry.disposed) return;
        const classes = docSnap.exists() ? (docSnap.data().classes || []) : [];
        fetchInitialSchedules(classes);
      },
      (error) => {
        console.error('useStudentClassSchedule: Error fetching student profile:', error);
      }
    );

    if (entry.disposed) {
      if (typeof profileUnsub === 'function') profileUnsub();
    } else {
      entry.profileUnsub = profileUnsub;
      entry.intervalId = setInterval(() => {
        if (entry.disposed) return;

        // Re-evaluate time slot transitions first
        const timePatch = evaluateAndComputePatch(entry.state.schedules, entry.classMeta);
        emitState(timePatch);

        const currentClasses = entry.state.userClasses;
        if (currentClasses && currentClasses.length > 0) {
          const gen = entry.fetchGeneration;
          (async () => {
            let hasMetaChanges = false;
            let hasScheduleChanges = false;
            const nextSchedules = { ...entry.state.schedules };
            const nextMeta = { ...entry.classMeta };

            const classIds = currentClasses
              .map((rawClass) => (typeof rawClass === 'string' ? rawClass : rawClass?.id))
              .filter(Boolean);

            await Promise.all(
              classIds.map(async (classId) => {
                try {
                  const snap = await getDoc(doc(dbInstance, 'classes', classId));
                  if (snap && typeof snap.exists === 'function' && snap.exists()) {
                    const data = snap.data() || {};
                    if (data.schedule && JSON.stringify(nextSchedules[classId]) !== JSON.stringify(data.schedule)) {
                      nextSchedules[classId] = data.schedule;
                      hasScheduleChanges = true;
                    }
                    const newMeta = {
                      isBroadcasting: Boolean(data.isBroadcasting),
                      isCapturing: Boolean(data.isCapturing),
                      overtimeUntil: data.overtimeUntil || null,
                      broadcastStartedAt: data.broadcastStartedAt || null,
                      captureStartedAt: data.captureStartedAt || null,
                    };
                    const prevMeta = nextMeta[classId] || {};
                    if (
                      prevMeta.isBroadcasting !== newMeta.isBroadcasting ||
                      prevMeta.isCapturing !== newMeta.isCapturing ||
                      toEpochMs(prevMeta.overtimeUntil) !== toEpochMs(newMeta.overtimeUntil) ||
                      toEpochMs(prevMeta.broadcastStartedAt) !== toEpochMs(newMeta.broadcastStartedAt) ||
                      toEpochMs(prevMeta.captureStartedAt) !== toEpochMs(newMeta.captureStartedAt)
                    ) {
                      nextMeta[classId] = newMeta;
                      hasMetaChanges = true;
                    }
                  }
                } catch {
                  // Ignore transient polling errors
                }
              })
            );

            if (entry.disposed || entry.fetchGeneration !== gen) return;
            if (hasMetaChanges || hasScheduleChanges) {
              if (hasMetaChanges) entry.classMeta = nextMeta;
              const patch = evaluateAndComputePatch(
                hasScheduleChanges ? nextSchedules : entry.state.schedules,
                entry.classMeta
              );
              emitState({
                ...(hasScheduleChanges ? { schedules: nextSchedules } : {}),
                ...patch,
              });
            }
          })();
        }
      }, 30000);
    }
  } else {
    entry.listeners.add(callback);
    callback(entry.state);
  }

  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    entry.listeners.delete(callback);
    if (entry.listeners.size === 0) {
      entry.disposed = true;
      entry.fetchGeneration += 1;
      storeMap.delete(userUid);
      if (entry.intervalId) {
        clearInterval(entry.intervalId);
        entry.intervalId = null;
      }
      if (typeof entry.profileUnsub === 'function') {
        entry.profileUnsub();
        entry.profileUnsub = null;
      }
    }
  };
}

export const useStudentClassSchedule = (user) => {
  const userUid = user?.uid || null;
  const [scheduleState, setScheduleState] = useState(() =>
    userUid
      ? { ...EMPTY_SCHEDULE_STATE, loading: true }
      : EMPTY_SCHEDULE_STATE
  );

  useEffect(() => {
    if (!userUid) {
      return;
    }
    return subscribeStudentScheduleStore(db, userUid, (nextState) => {
      setScheduleState(nextState);
    });
  }, [userUid]);

  return userUid ? scheduleState : EMPTY_SCHEDULE_STATE;
};
