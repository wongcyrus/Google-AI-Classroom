import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase-config';

const toLocalISOString = (date) => {
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
  const [startTime, setStartTime] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return toLocalISOString(d);
  });
  const [endTime, setEndTime] = useState(() => {
    const d = new Date();
    return toLocalISOString(d);
  });

  useEffect(() => {
    const generateLessons = (schedule) => {
      const lessons = [];
      const { startDate, endDate, timeSlots } = schedule;
      if (!startDate || !endDate || !timeSlots) return lessons;
  
      const start = new Date(startDate);
      const end = new Date(endDate);
      const today = new Date();
  
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dayOfWeek = d.toLocaleDateString('en-US', { weekday: 'short' });
        timeSlots.forEach(slot => {
          if (slot.days.includes(dayOfWeek)) {
            const [startHour, startMinute] = slot.startTime.split(':');
            const [endHour, endMinute] = slot.endTime.split(':');
            const lessonStart = new Date(d);
            lessonStart.setHours(startHour, startMinute, 0, 0);
            const lessonEnd = new Date(d);
            lessonEnd.setHours(endHour, endMinute, 0, 0);
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
        const scheduleData = classSnap.data().schedule;
        setSchedule(scheduleData);
        if (scheduleData) {
          const generatedLessons = generateLessons(scheduleData);
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

  return { schedule, lessons, selectedLesson, startTime, endTime, setStartTime, setEndTime, handleLessonChange };
};
