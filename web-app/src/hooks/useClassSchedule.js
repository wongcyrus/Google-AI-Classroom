import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase-config';

export const useClassSchedule = (classId) => {
  const [schedule, setSchedule] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [selectedLesson, setSelectedLesson] = useState('');
  const [startTime, setStartTime] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
  });
  const [endTime, setEndTime] = useState(() => {
    const d = new Date();
    return new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
  });

  useEffect(() => {
    const generateLessons = (schedule) => {
      const lessons = [];
      const { startDate, endDate, timeSlots } = schedule;
      if (!startDate || !endDate || !timeSlots) return lessons;
  
      const start = new Date(startDate);
      const end = new Date(endDate);
      const today = new Date();
  
      for (let d = start; d <= end && d <= today; d.setDate(d.getDate() + 1)) {
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
            setStartTime(defaultLesson.start.toISOString().slice(0, 16));
            setEndTime(defaultLesson.end.toISOString().slice(0, 16));
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
      setStartTime(selected.start.toISOString().slice(0, 16));
      setEndTime(selected.end.toISOString().slice(0, 16));
      setSelectedLesson(e.target.value);
    }
  };

  return { schedule, lessons, selectedLesson, startTime, endTime, setStartTime, setEndTime, handleLessonChange };
};