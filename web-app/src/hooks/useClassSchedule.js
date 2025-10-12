import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
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
  const [startTime, setStartTime] = useState(null);
  const [endTime, setEndTime] = useState(null);
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

    const getDefaultLesson = (lessons) => {
      if (lessons.length === 0) return null;
      const now = new Date();
      const currentLesson = lessons.find(l => now >= l.start && now <= l.end);
      if (currentLesson) return currentLesson;
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
          const defaultLesson = getDefaultLesson(generatedLessons);
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
    const selected = lessons.find(l => l.start.toISOString() === e.target.value);
    if (selected) {
      setStartTime(toLocalISOString(selected.start));
      setEndTime(toLocalISOString(selected.end));
      setSelectedLesson(e.target.value);
    }
  };

  return { schedule, lessons, selectedLesson, startTime, endTime, setStartTime, setEndTime, handleLessonChange, timezone };
};
