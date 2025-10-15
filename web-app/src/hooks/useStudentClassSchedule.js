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
      console.log('useStudentClassSchedule: No user, skipping.');
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

  // Step 2: Fetch the schedule for each class whenever the student's class list changes
  useEffect(() => {
    if (userClasses.length === 0) {
      console.log('useStudentClassSchedule: No classes for student, schedules empty.');
      setSchedules({});
      setLoading(false);
      return;
    }

    const fetchSchedules = async () => {
      setLoading(true);
      console.log('useStudentClassSchedule: Fetching schedules for classes:', userClasses);
      const schedulesData = {};
      for (const classId of userClasses) {
        try {
          const classRef = doc(db, 'classes', classId);
          console.log(`useStudentClassSchedule: Getting document for class ${classId}`);
          const classSnap = await getDoc(classRef);
          if (classSnap.exists()) {
            console.log(`useStudentClassSchedule: Successfully fetched schedule for ${classId}`);
            schedulesData[classId] = classSnap.data().schedule;
          } else {
            console.log(`useStudentClassSchedule: Class document ${classId} does not exist.`);
          }
        } catch (error) {
          console.error(`useStudentClassSchedule: Error fetching schedule for class ${classId}:`, error);
        }
      }
      setSchedules(schedulesData);
      setLoading(false);
      console.log('useStudentClassSchedule: Finished fetching schedules.', schedulesData);
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
        if (!schedule || !schedule.timeSlots || !schedule.timeZone || !schedule.startDate || !schedule.endDate) continue;

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
            
            if(!currentDay || !currentHour || !currentMinute || !year || !month || !day) continue;

            const currentDate = `${year}-${month}-${day}`;

            // Date check
            if (currentDate < startDate || currentDate > endDate) {
                continue;
            }

            const currentTime = `${currentHour}:${currentMinute}`;

            for (const slot of timeSlots) {
                if (slot.days.includes(currentDay)) {
                    const { startTime, endTime } = slot;
                    // Overnight slot
                    if (startTime > endTime) {
                        if (currentTime >= startTime || currentTime < endTime) {
                            activeClass = classId;
                            break;
                        }
                    } else { // Same day slot
                        if (currentTime >= startTime && currentTime < endTime) {
                            activeClass = classId;
                            break;
                        }
                    }
                }
            }
        } catch (e) {
            console.error(`Invalid timezone identifier: '${timeZone}' for class ${classId}`, e);
        }
        if (activeClass) break;
      }
      // console.log('useStudentClassSchedule: Determined active class:', activeClass);
      setCurrentActiveClassId(activeClass);
    };

    // Run check immediately and then every 30 seconds
    determineActiveClass();
    const interval = setInterval(determineActiveClass, 30000);

    return () => clearInterval(interval);
  }, [schedules]);

  return { userClasses, currentActiveClassId, loading };
};
