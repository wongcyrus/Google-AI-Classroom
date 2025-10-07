import { useState, useEffect } from 'react';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { db } from '../firebase-config';

export const useStudentClassSchedule = (user) => {
  const [userClasses, setUserClasses] = useState([]);
  const [schedules, setSchedules] = useState({});
  const [currentActiveClassId, setCurrentActiveClassId] = useState(null);
  const [loading, setLoading] = useState(true);

  // Step 1: Fetch all class IDs for the student in real-time
  useEffect(() => {
    if (!user || !user.uid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }

    const userDocRef = doc(db, 'studentProfiles', user.uid);
    const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const userData = docSnap.data();
        const classes = userData.classes || [];
        setUserClasses(classes);
      } else {
        setUserClasses([]);
      }
    });

    return () => unsubscribe();
  }, [user]);

  // Step 2: Fetch the schedule for each class whenever the student's class list changes
  useEffect(() => {
    if (userClasses.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSchedules({});
      setLoading(false);
      return;
    }

    const fetchSchedules = async () => {
      setLoading(true);
      const schedulesData = {};
      for (const classId of userClasses) {
        const classRef = doc(db, 'classes', classId);
        const classSnap = await getDoc(classRef);
        if (classSnap.exists()) {
          schedulesData[classId] = classSnap.data().schedule;
        }
      }
      setSchedules(schedulesData);
      setLoading(false);
    };

    fetchSchedules();
  }, [userClasses]);

  // Step 3: Periodically check the schedules to determine the currently active class
  useEffect(() => {
    const determineActiveClass = () => {
      const now = new Date();
      let activeClass = null;

      for (const classId in schedules) {
        const schedule = schedules[classId];
        if (!schedule || !schedule.timeSlots || !schedule.timeZone) continue;

        const { timeSlots, timeZone } = schedule;

        try {
            // Get current time and day in the target timezone
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone,
                weekday: 'short',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
            });
            const parts = formatter.formatToParts(now);
            const currentDay = parts.find(p => p.type === 'weekday')?.value;
            const currentHour = parts.find(p => p.type === 'hour')?.value;
            const currentMinute = parts.find(p => p.type === 'minute')?.value;

            if(!currentDay || !currentHour || !currentMinute) continue;

            const currentTime = `${currentHour}:${currentMinute}`;

            for (const slot of timeSlots) {
                if (slot.days.includes(currentDay)) {
                    if (currentTime >= slot.startTime && currentTime < slot.endTime) {
                        activeClass = classId;
                        break;
                    }
                }
            }
        } catch (e) {
            console.error(`Invalid timezone identifier: '${timeZone}' for class ${classId}`, e);
        }
        if (activeClass) break;
      }
      setCurrentActiveClassId(activeClass);
    };

    // Run check immediately and then every 30 seconds
    determineActiveClass();
    const interval = setInterval(determineActiveClass, 30000);

    return () => clearInterval(interval);
  }, [schedules]);

  return { userClasses, currentActiveClassId, loading };
};