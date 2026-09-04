import { useState, useEffect } from 'react';
import { doc, getDoc, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase-config';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';

const toLocalISOString = (date) => {
  if (!date) return '';
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const h = date.getHours().toString().padStart(2, '0');
  const min = date.getMinutes().toString().padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
};

export const useClassSchedule = (classId) => {
  const [schedule, setSchedule] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [selectedLesson, setSelectedLesson] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [timezone, setTimezone] = useState('UTC');

  useEffect(() => {
    const generateLessons = (schedule, tz) => {
      const lessons = [];
      const { startDate, endDate, timeSlots } = schedule;
      if (!startDate || !endDate || !timeSlots) return lessons;

      const start = new Date(`${startDate}T00:00:00.000Z`);
      const end = new Date(`${endDate}T23:59:59.999Z`);

      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const dayOfWeek = formatInTimeZone(d, tz, 'E');

        timeSlots.forEach(slot => {
          if (slot.days.includes(dayOfWeek)) {
            const datePart = d.toISOString().split('T')[0];
            
            const lessonStartString = `${datePart}T${slot.startTime}:00`;
            const lessonEndString = `${datePart}T${slot.endTime}:00`;

            const lessonStart = fromZonedTime(lessonStartString, tz);
            const lessonEnd = fromZonedTime(lessonEndString, tz);
            
            lessons.push({ start: lessonStart, end: lessonEnd });
          }
        });
      }
      return lessons.sort((a, b) => b.start - a.start);
    };

    const getSmartDefaultLesson = async (lessons, targetClassId) => {
      if (!lessons || lessons.length === 0) return null;
      const now = new Date();
      const currentLesson = lessons.find(l => now >= l.start && now <= l.end);
      if (currentLesson) return currentLesson;

      if (targetClassId) {
        try {
          const jobsSnap = await getDocs(query(
            collection(db, 'videoJobs'),
            where('classId', '==', targetClassId),
            where('status', '==', 'completed'),
            orderBy('createdAt', 'desc'),
            limit(1)
          ));
          if (!jobsSnap.empty) {
            const jobData = jobsSnap.docs[0].data();
            const jobStart = jobData.startTime?.toDate ? jobData.startTime.toDate() : (jobData.startTime ? new Date(jobData.startTime) : null);
            if (jobStart) {
              const matchingLesson = lessons.find(l => Math.abs(l.start.getTime() - jobStart.getTime()) < 60000);
              if (matchingLesson) return matchingLesson;
            }
          }
        } catch (err) {
          console.warn('Could not query videoJobs for smart default lesson:', err);
        }

        try {
          const statusSnap = await getDocs(collection(db, 'classes', targetClassId, 'status'));
          let latestTs = null;
          const docs = statusSnap?.docs || (statusSnap?.forEach ? statusSnap : []);
          docs.forEach(d => {
            const data = typeof d.data === 'function' ? d.data() : d;
            const ts = data?.timestamp?.toDate ? data.timestamp.toDate() : (data?.timestamp ? new Date(data.timestamp) : null);
            if (ts && (!latestTs || ts > latestTs)) latestTs = ts;
          });
          if (latestTs) {
            const matchingLesson = lessons.find(l => {
              const padStart = new Date(l.start.getTime() - 30 * 60 * 1000);
              const padEnd = new Date(l.end.getTime() + 60 * 60 * 1000);
              return latestTs >= padStart && latestTs <= padEnd;
            });
            if (matchingLesson) return matchingLesson;
          }
        } catch (err) {
          console.warn('Could not query status for smart default lesson:', err);
        }
      }

      const lastCompletedLesson = lessons.find(l => now > l.end);
      return lastCompletedLesson || lessons[lessons.length - 1];
    };

    const fetchSchedule = async () => {
      if (!classId) return;
      const classRef = doc(db, 'classes', classId);
      const classSnap = await getDoc(classRef);
      if (classSnap.exists()) {
        const classData = classSnap.data();
        const scheduleData = classData.schedule;
        const tz = classData.schedule?.timeZone || 'UTC';
        setTimezone(tz);
        setSchedule(scheduleData);
        if (scheduleData) {
          const generatedLessons = generateLessons(scheduleData, tz);
          setLessons(generatedLessons);
          const defaultLesson = await getSmartDefaultLesson(generatedLessons, classId);
          if (defaultLesson) {
            setStartTime(toLocalISOString(defaultLesson.start));
            setEndTime(toLocalISOString(defaultLesson.end));
            setSelectedLesson(defaultLesson.start.toISOString());
          }
        }
      }
    };
    fetchSchedule();
  }, [classId]);

  const handleLessonChange = (e) => {
    const selectedValue = e.target.value;
    setSelectedLesson(selectedValue);

    if (selectedValue) {
      const selected = lessons.find(l => l.start.toISOString() === selectedValue);
      if (selected) {
        setStartTime(toLocalISOString(selected.start));
        setEndTime(toLocalISOString(selected.end));
      }
    } 
  };

  return { schedule, lessons, selectedLesson, startTime, endTime, setStartTime, setEndTime, handleLessonChange, timezone };
};
