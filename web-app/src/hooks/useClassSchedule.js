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

import {
  formatLessonTitle,
  formatLessonDisplayName,
  formatLessonFolderName,
} from '../utils/lessonUtils';

export const generateLessons = (schedule, tz = 'UTC', customLessonTitles = {}, scheduleHistory = []) => {
  const allLessons = [];

  // Normalize segments: can be an array of segments, a class object with scheduleHistory + schedule,
  // or a single schedule object with separate scheduleHistory parameter.
  let segments = [];
  if (Array.isArray(schedule)) {
    segments = schedule;
  } else if (schedule && typeof schedule === 'object') {
    const history = Array.isArray(scheduleHistory) && scheduleHistory.length > 0
      ? scheduleHistory
      : (Array.isArray(schedule.scheduleHistory) ? schedule.scheduleHistory : []);

    const active = schedule.schedule || (schedule.timeSlots ? schedule : null);
    segments = [...history, active].filter(Boolean);
  }

  if (segments.length === 0) return [];

  // Generate lessons across each segment within its date bounds
  for (const segment of segments) {
    const { startDate, endDate, timeSlots, timeZone: segmentTz } = segment || {};
    if (!startDate || !endDate || !Array.isArray(timeSlots) || timeSlots.length === 0) continue;

    const segmentTimezone = segmentTz || tz || 'UTC';
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T23:59:59.999Z`);

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) continue;

    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const dayOfWeek = formatInTimeZone(d, segmentTimezone, 'E');

      timeSlots.forEach(slot => {
        if (slot.days && slot.days.includes(dayOfWeek)) {
          const datePart = d.toISOString().split('T')[0];

          const lessonStartString = `${datePart}T${slot.startTime}:00`;
          const lessonEndString = `${datePart}T${slot.endTime}:00`;

          const lessonStart = fromZonedTime(lessonStartString, segmentTimezone);
          const lessonEnd = fromZonedTime(lessonEndString, segmentTimezone);

          allLessons.push({ start: lessonStart, end: lessonEnd });
        }
      });
    }
  }

  // Deduplicate any overlapping timestamps (e.g. edge boundary dates)
  const seenTimes = new Set();
  const uniqueLessons = [];
  for (const l of allLessons) {
    const key = l.start.getTime();
    if (!seenTimes.has(key)) {
      seenTimes.add(key);
      uniqueLessons.push(l);
    }
  }

  // Sort ascending chronologically to compute 1-based index (Lesson 01, Lesson 02...)
  uniqueLessons.sort((a, b) => a.start - b.start);
  const titles = customLessonTitles || schedule?.lessonTitles || {};

  uniqueLessons.forEach((l, i) => {
    l.index = i + 1;
    l.id = l.start.toISOString();
    l.title = formatLessonTitle({ lesson: l, index: l.index, customTitles: titles });
    l.displayName = formatLessonDisplayName({ lesson: l, index: l.index, customTitles: titles });
    l.folderName = formatLessonFolderName({ lesson: l, index: l.index, customTitles: titles });
  });

  // Preserve existing convention: return sorted descending (newest first)
  return uniqueLessons.sort((a, b) => b.start - a.start);
};

export const useClassSchedule = (classId) => {
  const [schedule, setSchedule] = useState(null);
  const [scheduleHistory, setScheduleHistory] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [selectedLesson, setSelectedLesson] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [timezone, setTimezone] = useState('UTC');

  useEffect(() => {

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
        const historyData = Array.isArray(classData.scheduleHistory) ? classData.scheduleHistory : [];
        const tz = classData.schedule?.timeZone || 'UTC';
        setTimezone(tz);
        setSchedule(scheduleData);
        setScheduleHistory(historyData);
        if (scheduleData || historyData.length > 0) {
          const titles = classData.lessonTitles || scheduleData?.lessonTitles || {};
          const generatedLessons = generateLessons(scheduleData, tz, titles, historyData);
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
    } else {
      setStartTime('');
      setEndTime('');
    } 
  };

  return { schedule, scheduleHistory, lessons, selectedLesson, startTime, endTime, setStartTime, setEndTime, handleLessonChange, timezone };
};
