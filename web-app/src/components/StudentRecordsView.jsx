import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db, storage, functions } from '../firebase-config';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, getDownloadURL } from 'firebase/storage';
import VideoPlayerModal from './VideoPlayerModal';
import { computeLessonDuration, getLessonId } from '../utils/attendanceUtils';
import { generateLessons } from '../hooks/useClassSchedule';
import './StudentRecordsView.css';

const formatDuration = (totalSeconds) => {
  if (!totalSeconds || isNaN(totalSeconds)) return '0s';
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.round(totalSeconds % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
};

const formatBytes = (bytes) => {
  if (!bytes || isNaN(bytes) || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const formatDate = (val) => {
  if (!val) return 'N/A';
  try {
    const d = val?.toDate ? val.toDate() : new Date(val);
    return isNaN(d.getTime()) ? 'N/A' : d.toLocaleString();
  } catch {
    return 'N/A';
  }
};

export const parseTimeMs = (val) => {
  if (!val) return NaN;
  if (val.toMillis && typeof val.toMillis === 'function') return val.toMillis();
  if (typeof val.seconds === 'number') return val.seconds * 1000;
  if (val instanceof Date) return val.getTime();
  const parsed = new Date(val).getTime();
  return isNaN(parsed) ? NaN : parsed;
};

export const isRecordInLesson = (record, lesson) => {
  if (!record || !lesson) return false;

  // 1. Direct classId mismatch check
  if (record.classId && lesson.classId && record.classId !== lesson.classId) {
    return false;
  }

  // 2. Direct lessonId match
  if (record.lessonId && lesson.lessonId && record.lessonId === lesson.lessonId) {
    return true;
  }

  // 3. Lesson time bounds
  const lStart = parseTimeMs(lesson.startTime);
  if (isNaN(lStart)) return false;

  let lEnd = parseTimeMs(lesson.endTime);
  if (isNaN(lEnd) && lesson.duration) {
    lEnd = lStart + Number(lesson.duration) * 60 * 1000;
  }
  if (isNaN(lEnd)) {
    lEnd = lStart + 60 * 60 * 1000;
  }

  // Allow a 30-minute buffer before start (early setup) and 60-minute buffer after end
  // to cover student wrap-up, lab compilation, and asynchronous AI evaluation jobs
  const PRE_BUFFER_MS = 30 * 60 * 1000;
  const POST_BUFFER_MS = 60 * 60 * 1000;
  const winStart = lStart - PRE_BUFFER_MS;
  const winEnd = lEnd + POST_BUFFER_MS;

  // Extract record time
  const rStart = parseTimeMs(record.startTime) ||
                 parseTimeMs(record.startedAt) ||
                 parseTimeMs(record.timestamp) ||
                 parseTimeMs(record.createdAt);

  const rEnd = parseTimeMs(record.endTime) ||
               parseTimeMs(record.finishedAt) ||
               rStart;

  if (!isNaN(rStart) && !isNaN(rEnd)) {
    return Math.max(rStart, winStart) <= Math.min(rEnd, winEnd);
  }

  if (!isNaN(rStart)) {
    return rStart >= winStart && rStart <= winEnd;
  }

  return false;
};

export const isExamRecord = (record, classObj) => {
  if (!record) return false;
  if (Boolean(record.isExam) || record.lessonType === 'exam') return true;
  if (!classObj?.examPeriods || !Array.isArray(classObj.examPeriods)) return false;

  const timeMs = parseTimeMs(record.startTime) ||
                 parseTimeMs(record.startedAt) ||
                 parseTimeMs(record.timestamp) ||
                 parseTimeMs(record.createdAt);
  if (isNaN(timeMs)) return false;

  return classObj.examPeriods.some((period) => {
    if (!period?.startDate || !period?.endDate) return false;
    const startMs = new Date(period.startDate).getTime();
    const endMs = new Date(period.endDate).getTime();
    return timeMs >= startMs && timeMs <= endMs;
  });
};

const StudentRecordsView = ({ user }) => {
  const [activeTab, setActiveTab] = useState('videos');
  const [loading, setLoading] = useState(true);
  const [enrolledClasses, setEnrolledClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedLessonId, setSelectedLessonId] = useState('');
  const [attendanceViewMode, setAttendanceViewMode] = useState('per_lesson'); // 'per_lesson' | 'all_lessons'

  // Record data states
  const [videoJobs, setVideoJobs] = useState([]);
  const [lessonsData, setLessonsData] = useState([]);
  const [performanceMetrics, setPerformanceMetrics] = useState([]);
  const [progressReports, setProgressReports] = useState([]);
  const [aiJobsFeedback, setAiJobsFeedback] = useState([]);
  const [irregularities, setIrregularities] = useState([]);
  const [audioRecords, setAudioRecords] = useState([]);

  // Video player modal state
  const [showPlayer, setShowPlayer] = useState(false);
  const [playerVideoUrl, setPlayerVideoUrl] = useState('');
  const [playerLoading, setPlayerLoading] = useState(false);

  // Audio player state
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const [audioUrlMap, setAudioUrlMap] = useState({});
  const [audioLoadingId, setAudioLoadingId] = useState(null);

  // 1. Fetch Enrolled Classes for Student
  useEffect(() => {
    if (!user?.uid) return;
    const fetchClasses = async () => {
      try {
        const classMap = new Map();

        // Check studentProfiles doc
        const profileRef = doc(db, 'studentProfiles', user.uid);
        const profileSnap = await getDoc(profileRef);
        if (profileSnap.exists()) {
          const profileClasses = profileSnap.data().classes || [];
          for (const cId of profileClasses) {
            classMap.set(cId, { id: cId, name: cId });
          }
        }

        // Fetch details (name, etc.) for mapped classes
        const classIds = Array.from(classMap.keys());
        if (classIds.length > 0) {
          const classDocs = await Promise.all(
            classIds.map((id) => getDoc(doc(db, 'classes', id)).catch(() => null))
          );
          classDocs.forEach((cSnap) => {
            if (cSnap && cSnap.exists()) {
              const data = cSnap.data();
              classMap.set(cSnap.id, {
                id: cSnap.id,
                name: data.name || cSnap.id,
                timeZone: data.schedule?.timeZone || 'UTC',
                schedule: data.schedule || null,
                examPeriods: data.examPeriods || [],
                studentRecordingsPolicy: data.studentRecordingsPolicy || 'always_enabled',
                studentRecordingsReleaseDate: data.studentRecordingsReleaseDate || null,
              });
            }
          });
        }

        const classList = Array.from(classMap.values());
        setEnrolledClasses(classList);

        // Enforce strict class selection (default to first enrolled class, never "all")
        if (classList.length > 0) {
          setSelectedClassId((prev) => {
            if (!prev || !classList.some((c) => c.id === prev)) {
              return classList[0].id;
            }
            return prev;
          });
        }
      } catch (err) {
        console.error('Error fetching enrolled classes:', err);
      }
    };
    fetchClasses();
  }, [user]);

  // 2. Fetch All Student Records
  const loadAllStudentRecords = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);

    try {
      // 2a. Fetch Video Jobs
      const videoQuery = query(
        collection(db, 'videoJobs'),
        where('studentUid', '==', user.uid)
      );
      const videoSnap = await getDocs(videoQuery);
      const fetchedVideos = videoSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      fetchedVideos.sort((a, b) => {
        const timeA = a.startTime?.toDate ? a.startTime.toDate() : new Date(a.startTime || a.createdAt || 0);
        const timeB = b.startTime?.toDate ? b.startTime.toDate() : new Date(b.startTime || b.createdAt || 0);
        return timeB - timeA;
      });
      setVideoJobs(fetchedVideos);

      // 2b. Fetch Irregularities
      const irregQuery = query(
        collection(db, 'irregularities'),
        where('studentUid', '==', user.uid)
      );
      const irregSnap = await getDocs(irregQuery);
      const fetchedIrregs = irregSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      fetchedIrregs.sort((a, b) => {
        const timeA = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp || 0);
        const timeB = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp || 0);
        return timeB - timeA;
      });
      setIrregularities(fetchedIrregs);

      // 2c. Fetch Audio Records
      const audioQuery = query(
        collection(db, 'audio'),
        where('studentUid', '==', user.uid)
      );
      const audioSnap = await getDocs(audioQuery);
      const fetchedAudio = audioSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      fetchedAudio.sort((a, b) => {
        const timeA = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp || 0);
        const timeB = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp || 0);
        return timeB - timeA;
      });
      setAudioRecords(fetchedAudio);

      // 2d. Fetch Performance Metrics
      const metricsQuery = query(
        collection(db, 'performanceMetrics'),
        where('studentUid', '==', user.uid)
      );
      const metricsSnap = await getDocs(metricsQuery);
      const fetchedMetrics = metricsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      fetchedMetrics.sort((a, b) => {
        const timeA = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp || 0);
        const timeB = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp || 0);
        return timeB - timeA;
      });
      setPerformanceMetrics(fetchedMetrics);

      // 2e. Fetch Progress Reports
      const progressQuery = query(
        collection(db, 'progress'),
        where('studentUid', '==', user.uid)
      );
      const progressSnap = await getDocs(progressQuery);
      const fetchedProgress = progressSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      fetchedProgress.sort((a, b) => {
        const timeA = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp || 0);
        const timeB = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp || 0);
        return timeB - timeA;
      });
      setProgressReports(fetchedProgress);

      // 2f. Fetch AI Jobs Feedback
      const aiJobsQuery = query(
        collection(db, 'aiJobs'),
        where('studentUid', '==', user.uid)
      );
      const aiJobsSnap = await getDocs(aiJobsQuery);
      const fetchedAiJobs = aiJobsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      fetchedAiJobs.sort((a, b) => {
        const timeA = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp || 0);
        const timeB = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp || 0);
        return timeB - timeA;
      });
      setAiJobsFeedback(fetchedAiJobs);

      // 2g. Fetch & Generate Lessons for Enrolled Classes (Scheduled + Subcollection + Discovered)
      let candidateClasses = [...enrolledClasses];
      if (candidateClasses.length === 0) {
        try {
          const profileDoc = await getDoc(doc(db, 'studentProfiles', user.uid));
          if (profileDoc.exists()) {
            const cIds = profileDoc.data().classes || [];
            const fetchedClassDocs = await Promise.all(
              cIds.map((id) => getDoc(doc(db, 'classes', id)).catch(() => null))
            );
            fetchedClassDocs.forEach((cSnap) => {
              if (cSnap && cSnap.exists()) {
                const cData = cSnap.data();
                candidateClasses.push({
                  id: cSnap.id,
                  name: cData.name || cSnap.id,
                  timeZone: cData.schedule?.timeZone || 'UTC',
                  schedule: cData.schedule || null,
                  examPeriods: cData.examPeriods || [],
                });
              }
            });
          }
        } catch {
          // ignore
        }
      }

      const lessonsList = [];
      for (const classObj of candidateClasses) {
        const cId = classObj.id;
        const classLessonsMap = new Map();

        // 1. Fetch any explicit lesson documents in classes/{cId}/lessons
        try {
          const lessonsColRef = collection(db, 'classes', cId, 'lessons');
          const lessonSnaps = await getDocs(lessonsColRef);
          (lessonSnaps.docs || []).forEach((lDoc) => {
            const data = lDoc.data();
            const studentEntry = data.students?.[user.uid];
            const startStr = data.startTime?.toDate ? data.startTime.toDate().toISOString() : data.startTime;
            const endStr = data.endTime?.toDate ? data.endTime.toDate().toISOString() : data.endTime;
            const duration = data.duration || computeLessonDuration(startStr, endStr) || (studentEntry?.attendance?.length || 0) || 60;
            const sharedMins = studentEntry?.sharedScreenMinutes || 0;
            const workingMins = studentEntry?.workingMinutes || 0;
            const attendanceArr = Array.isArray(studentEntry?.attendance) ? studentEntry.attendance : [];
            const attendedMins = attendanceArr.filter((v) => v === 1).length;

            const attPercentage = duration > 0 ? ((attendedMins / duration) * 100).toFixed(2) : '0.00';
            const sharePercentage = duration > 0 ? ((sharedMins / duration) * 100).toFixed(2) : '0.00';
            const aiPercentage = duration > 0 ? ((workingMins / duration) * 100).toFixed(2) : '0.00';

            classLessonsMap.set(lDoc.id, {
              lessonId: lDoc.id,
              classId: cId,
              startTime: startStr,
              endTime: endStr,
              duration,
              attendedMinutes: attendedMins,
              sharedScreenMinutes: sharedMins,
              workingMinutes: workingMins,
              attPercentage,
              sharePercentage,
              aiPercentage,
              percentage: sharePercentage, // preserve for compatibility
              attendance: attendanceArr,
              summary: studentEntry?.summary || studentEntry?.aiSummary || null,
              feedback: studentEntry?.feedback || studentEntry?.aiFeedback || null,
              generalSummary: data.generalSummary || null,
              generalFeedback: data.generalFeedback || null,
              hasAttendanceDoc: true,
            });
          });
        } catch (err) {
          console.warn(`Could not fetch lessons for class ${cId}:`, err);
        }

        // 2. Generate scheduled lessons from class schedule (matching teacher schedule view)
        if (classObj.schedule) {
          try {
            const tz = classObj.timeZone || classObj.schedule?.timeZone || 'UTC';
            const scheduled = generateLessons(classObj.schedule, tz);
            // If more than 60 scheduled slots (e.g. daily demo class over multiple years),
            // filter to slots up to now + 24h to avoid hundreds of empty future days
            const filteredSched = scheduled.length > 60
              ? scheduled.filter((s) => s.start.getTime() <= Date.now() + 24 * 60 * 60 * 1000)
              : scheduled;

            for (const item of filteredSched) {
              const sIso = item.start.toISOString();
              const eIso = item.end.toISOString();
              let expectedLessonId = '';
              try {
                expectedLessonId = await getLessonId(sIso, eIso, tz);
              } catch {
                expectedLessonId = '';
              }

              // Check if already in classLessonsMap (by ID or within 5 minutes)
              const existingList = Array.from(classLessonsMap.values());
              const alreadyExists = (expectedLessonId && classLessonsMap.has(expectedLessonId)) ||
                existingList.some((ex) => Math.abs(parseTimeMs(ex.startTime) - item.start.getTime()) < 5 * 60 * 1000);

              if (!alreadyExists) {
                const dur = Math.round((item.end - item.start) / 60000) || 60;
                const schedId = expectedLessonId || `sched_${cId}_${item.start.getTime()}`;
                classLessonsMap.set(schedId, {
                  lessonId: schedId,
                  classId: cId,
                  startTime: sIso,
                  endTime: eIso,
                  duration: dur,
                  attendedMinutes: 0,
                  sharedScreenMinutes: 0,
                  workingMinutes: 0,
                  attPercentage: '0.00',
                  sharePercentage: '0.00',
                  aiPercentage: '0.00',
                  percentage: '0.00',
                  attendance: [],
                  summary: null,
                  feedback: null,
                  generalSummary: null,
                  generalFeedback: null,
                  isScheduled: true,
                });
              }
            }
          } catch (err) {
            console.warn(`Could not generate scheduled lessons for ${cId}:`, err);
          }
        }

        // 3. Discover lessons from student records (videoJobs) so every recorded screencast has a matching lesson
        const classVideos = fetchedVideos.filter((v) => v.classId === cId && !isExamRecord(v, classObj));
        for (const vid of classVideos) {
          const vidTime = parseTimeMs(vid.startTime) || parseTimeMs(vid.createdAt);
          if (!vidTime) continue;

          const existingList = Array.from(classLessonsMap.values());
          const matched = existingList.some((l) => isRecordInLesson(vid, l));
          if (!matched) {
            const dur = vid.duration ? Math.max(Math.round(vid.duration / 60), 1) : 60;
            const sDate = new Date(vidTime);
            const eDate = new Date(vidTime + dur * 60 * 1000);
            let discId = vid.lessonId;
            if (!discId) {
              try {
                discId = await getLessonId(sDate.toISOString(), eDate.toISOString(), classObj.timeZone || 'UTC');
              } catch {
                discId = '';
              }
            }
            if (!discId) {
              discId = `discovered_${cId}_${vidTime}`;
            }

            classLessonsMap.set(discId, {
              lessonId: discId,
              classId: cId,
              startTime: sDate.toISOString(),
              endTime: eDate.toISOString(),
              duration: dur,
              attendedMinutes: dur,
              sharedScreenMinutes: dur,
              workingMinutes: 0,
              attPercentage: '100.00',
              sharePercentage: '100.00',
              aiPercentage: '0.00',
              percentage: '100.00',
              attendance: Array(dur).fill(1),
              summary: null,
              feedback: null,
              generalSummary: null,
              generalFeedback: null,
              isDiscovered: true,
            });
          }
        }

        classLessonsMap.forEach((l) => lessonsList.push(l));
      }

      lessonsList.sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0));
      setLessonsData(lessonsList);

    } catch (err) {
      console.error('Error loading student records:', err);
    } finally {
      setLoading(false);
    }
  }, [user, enrolledClasses]);

  useEffect(() => {
    loadAllStudentRecords();
  }, [loadAllStudentRecords]);

  // Active class object
  const activeClassObj = useMemo(() => {
    return enrolledClasses.find((c) => c.id === selectedClassId) || null;
  }, [enrolledClasses, selectedClassId]);

  // Lessons for selected class
  const classLessons = useMemo(() => {
    if (!selectedClassId) return [];
    return lessonsData.filter((l) => l.classId === selectedClassId);
  }, [lessonsData, selectedClassId]);

  // Helper to determine if a video falls into a protected exam session or exam period
  const isExamVideo = useCallback((video) => {
    const classObj = enrolledClasses.find((c) => c.id === video?.classId);
    return isExamRecord(video, classObj);
  }, [enrolledClasses]);

  // Synchronize selectedLessonId when classLessons changes
  useEffect(() => {
    if (classLessons.length > 0) {
      setSelectedLessonId((prev) => {
        if (prev === 'all') return 'all';
        if (prev && classLessons.some((l) => l.lessonId === prev)) return prev;

        // Smart default: prioritize the most recent lesson with accessible recorded activity
        const lessonWithAccessibleVideo = classLessons.find((l) =>
          videoJobs.some((v) => v.classId === selectedClassId && !isExamVideo(v) && isRecordInLesson(v, l))
        );
        if (lessonWithAccessibleVideo) {
          return lessonWithAccessibleVideo.lessonId;
        }

        const lessonWithActivity = classLessons.find((l) =>
          l.attendedMinutes > 0 || l.sharedScreenMinutes > 0 || l.hasAttendanceDoc
        );
        if (lessonWithActivity) {
          return lessonWithActivity.lessonId;
        }

        return classLessons[0].lessonId;
      });
    } else {
      setSelectedLessonId('');
    }
  }, [classLessons, videoJobs, selectedClassId, isExamVideo]);

  // Active lesson for per-lesson breakdown
  const activeLesson = useMemo(() => {
    if (selectedLessonId === 'all') return null;
    if (selectedLessonId) {
      const match = classLessons.find((l) => l.lessonId === selectedLessonId);
      if (match) return match;
    }
    return classLessons[0] || null;
  }, [classLessons, selectedLessonId]);

  // Filtered views strictly scoped to selectedClassId and activeLesson
  const filteredVideos = useMemo(() => {
    if (!selectedClassId) return [];
    const classVideos = videoJobs.filter((v) => v.classId === selectedClassId);
    if (!activeLesson || selectedLessonId === 'all') {
      return classVideos;
    }
    return classVideos.filter((v) => isRecordInLesson(v, activeLesson));
  }, [videoJobs, selectedClassId, activeLesson, selectedLessonId]);

  // Screen recordings from exam/test periods are strictly excluded from student sharing
  const visibleVideos = useMemo(() => {
    return filteredVideos.filter((v) => !isExamVideo(v));
  }, [filteredVideos, isExamVideo]);

  const excludedExamVideosCount = useMemo(() => {
    return videoJobs.filter((v) => v.classId === selectedClassId && isExamVideo(v)).length;
  }, [videoJobs, selectedClassId, isExamVideo]);

  const filteredMetrics = useMemo(() => {
    if (!selectedClassId) return [];
    const classMetrics = performanceMetrics.filter((m) => m.classId === selectedClassId);
    if (!activeLesson || selectedLessonId === 'all') {
      return classMetrics;
    }
    return classMetrics.filter((m) => isRecordInLesson(m, activeLesson));
  }, [performanceMetrics, selectedClassId, activeLesson, selectedLessonId]);

  const filteredProgress = useMemo(() => {
    if (!selectedClassId) return [];
    const classProgress = progressReports.filter((p) => p.classId === selectedClassId);
    if (!activeLesson || selectedLessonId === 'all') {
      return classProgress;
    }
    return classProgress.filter((p) => isRecordInLesson(p, activeLesson));
  }, [progressReports, selectedClassId, activeLesson, selectedLessonId]);

  const filteredAiJobs = useMemo(() => {
    if (!selectedClassId) return [];
    const classAi = aiJobsFeedback.filter((j) => j.classId === selectedClassId);
    if (!activeLesson || selectedLessonId === 'all') {
      return classAi;
    }
    return classAi.filter((j) => isRecordInLesson(j, activeLesson));
  }, [aiJobsFeedback, selectedClassId, activeLesson, selectedLessonId]);

  const filteredIrregularities = useMemo(() => {
    if (!selectedClassId) return [];
    const classIrregs = irregularities.filter((i) => i.classId === selectedClassId);
    if (!activeLesson || selectedLessonId === 'all') {
      return classIrregs;
    }
    return classIrregs.filter((i) => isRecordInLesson(i, activeLesson));
  }, [irregularities, selectedClassId, activeLesson, selectedLessonId]);

  const filteredAudio = useMemo(() => {
    if (!selectedClassId) return [];
    const classAudioList = audioRecords.filter((a) => a.classId === selectedClassId);
    if (!activeLesson || selectedLessonId === 'all') {
      return classAudioList;
    }
    return classAudioList.filter((a) => isRecordInLesson(a, activeLesson));
  }, [audioRecords, selectedClassId, activeLesson, selectedLessonId]);

  // Audio recorded during exam periods is strictly excluded to protect assessment integrity
  const visibleAudio = useMemo(() => {
    return filteredAudio.filter((a) => !isExamRecord(a, activeClassObj));
  }, [filteredAudio, activeClassObj]);

  const excludedExamAudioCount = useMemo(() => {
    return filteredAudio.filter((a) => isExamRecord(a, activeClassObj)).length;
  }, [filteredAudio, activeClassObj]);

  // Evaluates recording access status for a given video
  const getRecordingAccessStatus = useCallback((video) => {
    if (isExamVideo(video)) {
      return {
        isLocked: true,
        badgeText: '🔒 Exam Material (Restricted)',
        tooltip: 'Screen recordings of exam or test periods are confidential and not shared with students.',
        reason: 'Screen recordings for exam or test periods are confidential and not shared with students to protect assessment questions.',
      };
    }

    const classObj = enrolledClasses.find((c) => c.id === video.classId);
    const policy = classObj?.studentRecordingsPolicy || 'always_enabled';
    const releaseDate = classObj?.studentRecordingsReleaseDate;

    if (policy === 'disabled') {
      return {
        isLocked: true,
        badgeText: '🔒 Restricted (Test Material)',
        tooltip: 'Screen recordings are disabled by instructor to protect assessment questions.',
        reason: 'The instructor has disabled recording access for this class to protect test questions.',
      };
    }

    if (policy === 'delayed_release' && releaseDate) {
      const releaseTime = new Date(releaseDate).getTime();
      if (!isNaN(releaseTime) && Date.now() < releaseTime) {
        return {
          isLocked: true,
          badgeText: `⏳ Available ${new Date(releaseDate).toLocaleDateString()}`,
          tooltip: `Screen recordings will be released on ${new Date(releaseDate).toLocaleString()}.`,
          reason: `Screen recordings for this class are scheduled for release on ${new Date(releaseDate).toLocaleString()}.`,
        };
      }
    }

    return { isLocked: false, badgeText: null, tooltip: null, reason: null };
  }, [enrolledClasses, isExamVideo]);

  // Aggregate KPI metrics based on selected class
  const completedVideos = visibleVideos.filter((v) => v.status === 'completed');
  const unlockedVideosCount = completedVideos.filter((v) => !getRecordingAccessStatus(v).isLocked).length;
  const lockedVideosCount = completedVideos.filter((v) => getRecordingAccessStatus(v).isLocked).length;
  const totalVideosDisplay = lockedVideosCount > 0
    ? `${unlockedVideosCount} (${lockedVideosCount} 🔒)`
    : `${unlockedVideosCount}`;

  const totalScreenMinutes = activeLesson
    ? (activeLesson.sharedScreenMinutes || 0)
    : classLessons.reduce((sum, l) => sum + (l.sharedScreenMinutes || 0), 0);
  const totalWorkingMinutes = activeLesson
    ? (activeLesson.workingMinutes || 0)
    : classLessons.reduce((sum, l) => sum + (l.workingMinutes || 0), 0);
  const avgAttendance = activeLesson
    ? (activeLesson.attPercentage || '0.0')
    : classLessons.length > 0
    ? (classLessons.reduce((sum, l) => sum + parseFloat(l.attPercentage || 0), 0) / classLessons.length).toFixed(1)
    : '0.0';
  const totalTasks = filteredMetrics.length;
  const totalAlerts = filteredIrregularities.length;

  // Cumulative Attendance calculation across all class lessons
  const cumulativeAttendance = useMemo(() => {
    const totalDuration = classLessons.reduce((sum, l) => sum + (l.duration || 0), 0);
    const totalAttendedMins = classLessons.reduce((sum, l) => sum + (l.attendedMinutes || 0), 0);
    const totalSharedMins = classLessons.reduce((sum, l) => sum + (l.sharedScreenMinutes || 0), 0);
    const totalAiMins = classLessons.reduce((sum, l) => sum + (l.workingMinutes || 0), 0);

    const attRate = totalDuration > 0 ? ((totalAttendedMins / totalDuration) * 100).toFixed(2) : '0.00';
    const shareRate = totalDuration > 0 ? ((totalSharedMins / totalDuration) * 100).toFixed(2) : '0.00';
    const aiRate = totalDuration > 0 ? ((totalAiMins / totalDuration) * 100).toFixed(2) : '0.00';

    return {
      totalDuration,
      totalAttendedMins,
      totalSharedMins,
      totalAiMins,
      attRate,
      shareRate,
      aiRate,
      lessonsAttendedCount: classLessons.filter((l) => parseFloat(l.attPercentage) >= 50).length,
      totalLessonsCount: classLessons.length,
    };
  }, [classLessons]);

  // Video playback handler
  const handlePlayVideo = async (video) => {
    const accessStatus = getRecordingAccessStatus(video);
    if (accessStatus.isLocked) {
      alert(accessStatus.reason || 'Screen recording playback is restricted for this session.');
      return;
    }

    setPlayerLoading(true);
    setShowPlayer(true);
    try {
      try {
        const getStudentVideoPlaybackUrl = httpsCallable(functions, 'getStudentVideoPlaybackUrl');
        const result = await getStudentVideoPlaybackUrl({ jobId: video.id });
        if (result?.data?.url) {
          setPlayerVideoUrl(result.data.url);
          setPlayerLoading(false);
          return;
        }
      } catch (callErr) {
        if (
          callErr.code === 'permission-denied' ||
          callErr.message?.includes('denied') ||
          callErr.message?.includes('restricted') ||
          isExamRecord(video, activeClassObj)
        ) {
          throw new Error(callErr.message || 'Access denied: Screen recording is restricted.');
        }
        console.warn('Callable function getStudentVideoPlaybackUrl failed, falling back to direct storage URL:', callErr);
      }

      if (video.videoPath) {
        const videoRef = ref(storage, video.videoPath);
        const url = await getDownloadURL(videoRef);
        setPlayerVideoUrl(url);
      } else {
        throw new Error('Video storage path is missing.');
      }
    } catch (err) {
      console.error('Error fetching video URL:', err);
      alert(`Could not load video for playback: ${err.message}`);
      setShowPlayer(false);
    } finally {
      setPlayerLoading(false);
    }
  };

  // Video download handler
  const handleDownloadVideo = async (video) => {
    const accessStatus = getRecordingAccessStatus(video);
    if (accessStatus.isLocked) {
      alert(accessStatus.reason || 'Screen recording download is restricted for this session.');
      return;
    }

    if (!video.videoPath) {
      alert('This video does not have a valid storage path.');
      return;
    }

    try {
      let downloadUrl = '';
      try {
        const getStudentVideoPlaybackUrl = httpsCallable(functions, 'getStudentVideoPlaybackUrl');
        const res = await getStudentVideoPlaybackUrl({ jobId: video.id });
        downloadUrl = res?.data?.url;
      } catch (callErr) {
        if (
          callErr.code === 'permission-denied' ||
          callErr.message?.includes('denied') ||
          callErr.message?.includes('restricted') ||
          isExamRecord(video, activeClassObj)
        ) {
          throw new Error(callErr.message || 'Access denied: Screen recording download is restricted.');
        }
        console.warn('Callable function getStudentVideoPlaybackUrl failed for download, falling back to direct storage URL:', callErr);
      }

      if (!downloadUrl) {
        const videoRef = ref(storage, video.videoPath);
        downloadUrl = await getDownloadURL(videoRef);
      }

      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `recording-${video.classId || 'class'}-${video.id}.mp4`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('Error downloading video:', err);
      alert(`Could not initiate download: ${err.message}`);
    }
  };

  // On-demand audio snippet playback handler
  const handleTogglePlayAudio = async (audioItem) => {
    if (isExamRecord(audioItem, activeClassObj)) {
      alert('Audio playback is restricted for exam sessions to safeguard assessment materials.');
      return;
    }

    if (playingAudioId === audioItem.id) {
      setPlayingAudioId(null);
      return;
    }

    if (audioUrlMap[audioItem.id]) {
      setPlayingAudioId(audioItem.id);
      return;
    }

    try {
      setAudioLoadingId(audioItem.id);
      let resolvedUrl = audioItem.audioUrl;
      if (!resolvedUrl && audioItem.audioPath) {
        const fileRef = ref(storage, audioItem.audioPath);
        resolvedUrl = await getDownloadURL(fileRef);
      }
      if (resolvedUrl) {
        setAudioUrlMap((prev) => ({ ...prev, [audioItem.id]: resolvedUrl }));
        setPlayingAudioId(audioItem.id);
      } else {
        alert('No audio file found for this recording.');
      }
    } catch (err) {
      console.error('Error resolving audio URL:', err);
      alert('Unable to load audio playback snippet.');
    } finally {
      setAudioLoadingId(null);
    }
  };

  if (loading) {
    return (
      <div className="student-records-container">
        <div className="empty-state-box">
          <div className="empty-state-icon">⏳</div>
          <div className="empty-state-text">Loading student classroom records and analytics...</div>
        </div>
      </div>
    );
  }

  if (enrolledClasses.length === 0) {
    return (
      <div className="student-records-container">
        <div className="student-records-header">
          <div className="student-records-title-group">
            <h1>My Classroom Records</h1>
            <p className="student-records-subtitle">Review personal learning analytics, attendance, and recordings</p>
          </div>
        </div>
        <div className="tab-panel-card">
          <div className="empty-state-box">
            <div className="empty-state-icon">🏫</div>
            <div className="empty-state-text">
              You are not currently enrolled in any active classes. Once your instructor adds you to a class roster, your learning records will appear here.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="student-records-container">
      {/* Header and Controls */}
      <div className="student-records-header">
        <div className="student-records-title-group">
          <h1>
            <span>🎓</span> My Classroom Records
          </h1>
          <p className="student-records-subtitle">
            Classroom learning records, teacher-grade attendance analytics, and session recordings
          </p>
        </div>

        <div className="student-records-controls">
          <div className="control-label-group">
            <label htmlFor="class-selector">Class:</label>
            <select
              id="class-selector"
              aria-label="Class:"
              className="records-filter-select"
              value={selectedClassId}
              onChange={(e) => {
                setSelectedClassId(e.target.value);
                setSelectedLessonId('');
              }}
            >
              {enrolledClasses.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name && cls.name !== cls.id ? `${cls.name} (${cls.id})` : cls.id}
                </option>
              ))}
            </select>
          </div>

          {classLessons.length > 0 && (
            <div className="control-label-group">
              <label htmlFor="lesson-selector">Lesson / Date:</label>
              <select
                id="lesson-selector"
                aria-label="Lesson / Date:"
                className="records-filter-select"
                value={selectedLessonId}
                onChange={(e) => setSelectedLessonId(e.target.value)}
              >
                <option value="all">🌐 All Lessons / Full Semester ({classLessons.length})</option>
                {classLessons.map((l, idx) => {
                  const hasVideo = videoJobs.some((v) => v.classId === selectedClassId && isRecordInLesson(v, l));
                  return (
                    <option key={l.lessonId} value={l.lessonId}>
                      {idx === 0 ? '⭐ Latest: ' : '📅 '}
                      {formatDate(l.startTime)} ({l.duration}m)
                      {hasVideo ? ' 🎬' : ''}
                      {l.attendedMinutes > 0 ? ' ✓' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards Bar (Class Scoped) */}
      <div className="student-kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: '#dcfce7', color: '#15803d' }}>
            📅
          </div>
          <div className="kpi-content">
            <span className="kpi-value">{avgAttendance}%</span>
            <span className="kpi-label">Class Attendance</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: '#eff6ff', color: '#1d4ed8' }}>
            🖥️
          </div>
          <div className="kpi-content">
            <span className="kpi-value">{totalScreenMinutes} min</span>
            <span className="kpi-label">Screen Share Duration</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: '#f5f3ff', color: '#7c3aed' }}>
            🤖
          </div>
          <div className="kpi-content">
            <span className="kpi-value">{totalWorkingMinutes} min</span>
            <span className="kpi-label">AI Estimated Working</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: '#f8fafc', color: '#475569' }}>
            🎬
          </div>
          <div className="kpi-content">
            <span className="kpi-value">{totalVideosDisplay}</span>
            <span className="kpi-label">Recorded Videos</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: '#fef3c7', color: '#b45309' }}>
            ⚡
          </div>
          <div className="kpi-content">
            <span className="kpi-value">{totalTasks}</span>
            <span className="kpi-label">Lab Tasks Completed</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: totalAlerts > 0 ? '#fee2e2' : '#f1f5f9', color: totalAlerts > 0 ? '#b91c1c' : '#64748b' }}>
            🛡️
          </div>
          <div className="kpi-content">
            <span className="kpi-value">{totalAlerts}</span>
            <span className="kpi-label">Proctoring Flags</span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="student-records-tabs" role="tablist">
        <button
          className={`records-tab-btn ${activeTab === 'videos' ? 'active' : ''}`}
          onClick={() => setActiveTab('videos')}
          role="tab"
          aria-selected={activeTab === 'videos'}
        >
          <span>🎬</span> Screencasts
          {visibleVideos.length > 0 && (
            <span className="tab-badge">{visibleVideos.length}</span>
          )}
        </button>

        <button
          className={`records-tab-btn ${activeTab === 'attendance' ? 'active' : ''}`}
          onClick={() => setActiveTab('attendance')}
          role="tab"
          aria-selected={activeTab === 'attendance'}
        >
          <span>📅</span> Attendance & Lessons
        </button>

        <button
          className={`records-tab-btn ${activeTab === 'tasks' ? 'active' : ''}`}
          onClick={() => setActiveTab('tasks')}
          role="tab"
          aria-selected={activeTab === 'tasks'}
        >
          <span>⚡</span> Tasks & AI Progress
          {(filteredMetrics.length + filteredProgress.length) > 0 && (
            <span className="tab-badge">{filteredMetrics.length + filteredProgress.length}</span>
          )}
        </button>

        <button
          className={`records-tab-btn ${activeTab === 'irregularities' ? 'active' : ''}`}
          onClick={() => setActiveTab('irregularities')}
          role="tab"
          aria-selected={activeTab === 'irregularities'}
        >
          <span>🛡️</span> Integrity & Alerts
          {filteredIrregularities.length > 0 && (
            <span className="tab-badge tab-badge-alert">{filteredIrregularities.length}</span>
          )}
        </button>

        <button
          className={`records-tab-btn ${activeTab === 'audio' ? 'active' : ''}`}
          onClick={() => setActiveTab('audio')}
          role="tab"
          aria-selected={activeTab === 'audio'}
        >
          <span>🎙️</span> Audio Transcripts
          {visibleAudio.length > 0 && (
            <span className="tab-badge">{visibleAudio.length}</span>
          )}
        </button>
      </div>

      {/* Scope Indicator Banner */}
      {classLessons.length > 0 && (
        <div className="active-scope-banner">
          {activeLesson ? (
            <div className="scope-banner-content">
              <span className="scope-banner-text">
                📅 Showing records for lesson: <strong>{formatDate(activeLesson.startTime)}</strong> ({activeLesson.duration}m)
              </span>
              <button
                type="button"
                className="scope-toggle-btn"
                onClick={() => setSelectedLessonId('all')}
              >
                🌐 Show All Lessons
              </button>
            </div>
          ) : (
            <div className="scope-banner-content">
              <span className="scope-banner-text">
                🌐 Showing cumulative records across all <strong>{classLessons.length} lessons</strong>
              </span>
              {classLessons[0] && (
                <button
                  type="button"
                  className="scope-toggle-btn"
                  onClick={() => setSelectedLessonId(classLessons[0].lessonId)}
                >
                  📅 Filter to Latest Lesson
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab 1: Screen Recordings (Videos) */}
      {activeTab === 'videos' && (
        <div className="tab-panel-card">
          <div className="panel-header">
            <h2 className="panel-title">Session Video Screencasts</h2>
            <small style={{ color: '#64748b' }}>
              Compiled MP4 screen recordings of your lab sessions in {activeClassObj?.name || selectedClassId}
            </small>
          </div>

          {/* Assessment Integrity Notice Banner */}
          {(() => {
            if (excludedExamVideosCount > 0) {
              return (
                <div
                  className="security-notice-banner"
                  role="alert"
                  style={{
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '8px',
                    padding: '0.85rem 1.1rem',
                    marginBottom: '1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    color: '#991b1b',
                  }}
                >
                  <span style={{ fontSize: '1.4rem' }}>🔒</span>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: '0.92rem' }}>
                      Assessment Integrity: Exam Period Recordings Restricted
                    </p>
                    <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: '#b91c1c' }}>
                      {excludedExamVideosCount} recording(s) recorded during defined exam/test periods are withheld from student view to protect assessment questions.
                    </p>
                  </div>
                </div>
              );
            }

            if (!activeClassObj) return null;

            if (activeClassObj.studentRecordingsPolicy === 'disabled') {
              return (
                <div
                  className="security-notice-banner"
                  role="alert"
                  style={{
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '8px',
                    padding: '0.85rem 1.1rem',
                    marginBottom: '1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    color: '#991b1b',
                  }}
                >
                  <span style={{ fontSize: '1.4rem' }}>🔒</span>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: '0.92rem' }}>
                      Assessment Integrity Active: Screen Recordings Disabled
                    </p>
                    <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: '#b91c1c' }}>
                      Screen recordings for this class have been restricted by the instructor to protect confidential test and assessment questions.
                    </p>
                  </div>
                </div>
              );
            }

            if (
              activeClassObj.studentRecordingsPolicy === 'delayed_release' &&
              activeClassObj.studentRecordingsReleaseDate &&
              Date.now() < new Date(activeClassObj.studentRecordingsReleaseDate).getTime()
            ) {
              return (
                <div
                  className="security-notice-banner"
                  role="alert"
                  style={{
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: '8px',
                    padding: '0.85rem 1.1rem',
                    marginBottom: '1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    color: '#92400e',
                  }}
                >
                  <span style={{ fontSize: '1.4rem' }}>⏳</span>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: '0.92rem' }}>Scheduled Post-Exam Release</p>
                    <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: '#b45309' }}>
                      Screen recordings for this class are protected and will be automatically unlocked on{' '}
                      {new Date(activeClassObj.studentRecordingsReleaseDate).toLocaleString()}.
                    </p>
                  </div>
                </div>
              );
            }

            return null;
          })()}

          {visibleVideos.length === 0 ? (
            <div className="empty-state-box">
              <div className="empty-state-icon">🎬</div>
              <div className="empty-state-text">
                {excludedExamVideosCount > 0
                  ? `No accessible screen recordings. ${excludedExamVideosCount} recording(s) from exam or test periods are withheld to protect assessment questions.`
                  : activeLesson
                  ? `No session recordings found for this lesson (${formatDate(activeLesson.startTime)}). Once your teacher compiles past classroom screencasts, they will appear here for review and revision.`
                  : 'No session recordings found for this selection. Once your teacher compiles past classroom screencasts, they will appear here for review and revision.'}
              </div>
              {activeLesson && (
                <button
                  type="button"
                  className="scope-toggle-btn"
                  style={{ marginTop: '0.75rem' }}
                  onClick={() => setSelectedLessonId('all')}
                >
                  🌐 View All Class Screencasts
                </button>
              )}
            </div>
          ) : (
            <div className="records-table-container">
              <table className="records-table">
                <thead>
                  <tr>
                    <th>Date & Time</th>
                    <th>Class</th>
                    <th>Duration</th>
                    <th>Size</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleVideos.map((video) => {
                    const access = getRecordingAccessStatus(video);
                    return (
                      <tr key={video.id}>
                        <td style={{ fontWeight: 600 }}>{formatDate(video.startTime || video.createdAt)}</td>
                        <td>
                          <span className="pill-badge pill-neutral">{video.classId || 'N/A'}</span>
                        </td>
                        <td>{formatDuration(video.duration)}</td>
                        <td>{formatBytes(video.size)}</td>
                        <td>
                          {access.isLocked ? (
                            <span className="pill-badge pill-danger" title={access.tooltip}>
                              {access.badgeText}
                            </span>
                          ) : (
                            <span
                              className={`pill-badge ${
                                video.status === 'completed'
                                  ? 'pill-success'
                                  : video.status === 'failed'
                                  ? 'pill-danger'
                                  : 'pill-warning'
                              }`}
                            >
                              {video.status || 'unknown'}
                            </span>
                          )}
                        </td>
                        <td>
                          {access.isLocked ? (
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                              <button
                                className="action-btn-sm action-btn-disabled"
                                disabled
                                title={access.tooltip}
                                style={{ opacity: 0.6, cursor: 'not-allowed' }}
                              >
                                🔒 Locked
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button
                                className="action-btn-sm action-btn-primary"
                                onClick={() => handlePlayVideo(video)}
                                disabled={video.status !== 'completed' || !video.videoPath}
                              >
                                ▶ Watch
                              </button>
                              <button
                                className="action-btn-sm action-btn-secondary"
                                onClick={() => handleDownloadVideo(video)}
                                disabled={video.status !== 'completed' || !video.videoPath}
                              >
                                ⬇ Download
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Attendance & Lessons (Teacher-Grade with 3 Ratios) */}
      {activeTab === 'attendance' && (
        <div className="tab-panel-card">
          <div className="panel-header">
            <h2 className="panel-title">Attendance & Lesson Participation</h2>
            <small style={{ color: '#64748b' }}>
              Teacher-grade attendance telemetry and 3-ratio participation breakdown for {activeClassObj?.name || selectedClassId}
            </small>
          </div>

          {/* Sub-view mode toggle: Per Lesson vs All Lessons */}
          <div className="attendance-view-mode-toggle">
            <button
              type="button"
              className={`mode-toggle-btn ${attendanceViewMode === 'per_lesson' ? 'active' : ''}`}
              onClick={() => setAttendanceViewMode('per_lesson')}
            >
              <span>📅</span> Per Lesson Breakdown
            </button>
            <button
              type="button"
              className={`mode-toggle-btn ${attendanceViewMode === 'all_lessons' ? 'active' : ''}`}
              onClick={() => setAttendanceViewMode('all_lessons')}
            >
              <span>📊</span> All Lessons Summary
            </button>
          </div>

          {classLessons.length === 0 ? (
            <div className="empty-state-box">
              <div className="empty-state-icon">📅</div>
              <div className="empty-state-text">
                No lesson attendance records recorded yet for {activeClassObj?.name || selectedClassId}. Once your teacher conducts class sessions and finalizes attendance, detailed metrics will appear here.
              </div>
            </div>
          ) : attendanceViewMode === 'per_lesson' && activeLesson ? (
            <div>
              {/* Lesson Metadata Header */}
              <div className="lesson-detail-header-card">
                <div className="lesson-detail-meta">
                  <h3>Session on {formatDate(activeLesson.startTime)}</h3>
                  <p>
                    Duration: <strong>{activeLesson.duration} minutes</strong> • Class: <strong>{selectedClassId}</strong>
                  </p>
                </div>
                {classLessons.length > 1 && (
                  <div>
                    <select
                      className="records-filter-select"
                      value={activeLesson.lessonId}
                      onChange={(e) => setSelectedLessonId(e.target.value)}
                    >
                      {classLessons.map((l) => (
                        <option key={l.lessonId} value={l.lessonId}>
                          {formatDate(l.startTime)} ({l.duration} min)
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* The 3 Core Ratios (Hero Cards) */}
              <div className="ratios-grid">
                {/* Ratio 1: Attendance Presence Ratio */}
                <div className="ratio-card ratio-card-border-1">
                  <div className="ratio-card-header">
                    <h4 className="ratio-card-title">1. Attendance Presence</h4>
                    <span
                      className={`pill-badge ${
                        parseFloat(activeLesson.attPercentage) >= 80
                          ? 'pill-success'
                          : parseFloat(activeLesson.attPercentage) >= 50
                          ? 'pill-warning'
                          : 'pill-danger'
                      }`}
                    >
                      {parseFloat(activeLesson.attPercentage) >= 80
                        ? '🟢 Present'
                        : parseFloat(activeLesson.attPercentage) >= 50
                        ? '🟡 Partial / Late'
                        : '🔴 Absent'}
                    </span>
                  </div>
                  <div className="ratio-percentage-display">{activeLesson.attPercentage}%</div>
                  <div className="ratio-fraction-display">
                    {activeLesson.attendedMinutes} min of {activeLesson.duration} min active
                  </div>
                  <div className="ratio-card-footer">
                    Attendance bitmask calculated from minute-by-minute presence telemetry
                  </div>
                </div>

                {/* Ratio 2: Screen Sharing Ratio */}
                <div className="ratio-card ratio-card-border-2">
                  <div className="ratio-card-header">
                    <h4 className="ratio-card-title">2. Screen Sharing Ratio</h4>
                    <span
                      className={`pill-badge ${
                        parseFloat(activeLesson.sharePercentage) >= 80
                          ? 'pill-success'
                          : parseFloat(activeLesson.sharePercentage) >= 50
                          ? 'pill-warning'
                          : 'pill-danger'
                      }`}
                    >
                      {parseFloat(activeLesson.sharePercentage) >= 80
                        ? '🟢 High Sharing'
                        : parseFloat(activeLesson.sharePercentage) >= 50
                        ? '🟡 Moderate'
                        : '🔴 Low Sharing'}
                    </span>
                  </div>
                  <div className="ratio-percentage-display">{activeLesson.sharePercentage}%</div>
                  <div className="ratio-fraction-display">
                    {activeLesson.sharedScreenMinutes} min of {activeLesson.duration} min shared
                  </div>
                  <div className="ratio-card-footer">
                    Active desktop or application window stream broadcast to classroom
                  </div>
                </div>

                {/* Ratio 3: AI Working Minutes Ratio */}
                <div className="ratio-card ratio-card-border-3">
                  <div className="ratio-card-header">
                    <h4 className="ratio-card-title">3. AI Working Minutes</h4>
                    <span
                      className={`pill-badge ${
                        parseFloat(activeLesson.aiPercentage) >= 70
                          ? 'pill-success'
                          : parseFloat(activeLesson.aiPercentage) >= 40
                          ? 'pill-warning'
                          : 'pill-danger'
                      }`}
                    >
                      {parseFloat(activeLesson.aiPercentage) >= 70
                        ? '🟢 High Focus'
                        : parseFloat(activeLesson.aiPercentage) >= 40
                        ? '🟡 Moderate Focus'
                        : '🔴 Low Focus / Idle'}
                    </span>
                  </div>
                  <div className="ratio-percentage-display">{activeLesson.aiPercentage}%</div>
                  <div className="ratio-fraction-display">
                    {activeLesson.workingMinutes} min of {activeLesson.duration} min working
                  </div>
                  <div className="ratio-card-footer">
                    AI multimodal analysis of active task focus and execution
                  </div>
                </div>
              </div>

              {/* Minute-by-Minute Attendance Timeline Grid */}
              <div className="attendance-timeline-section">
                <div className="attendance-timeline-section-header">
                  <h4>⏱️ Minute-by-Minute Attendance Timeline ({activeLesson.duration} Minutes)</h4>
                  <div className="timeline-legend">
                    <div className="legend-item">
                      <span className="legend-swatch legend-swatch-active"></span>
                      <span>Present (Active)</span>
                    </div>
                    <div className="legend-item">
                      <span className="legend-swatch legend-swatch-inactive"></span>
                      <span>Inactive / Absent</span>
                    </div>
                  </div>
                </div>

                {activeLesson.attendance && activeLesson.attendance.length > 0 ? (
                  <div className="minute-grid-scroll-wrapper">
                    <table className="minute-grid-table">
                      <thead>
                        <tr>
                          {activeLesson.attendance.map((_, idx) => (
                            <th key={idx} className="minute-header-cell">
                              {idx + 1}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {activeLesson.attendance.map((present, idx) => (
                            <td
                              key={idx}
                              className="minute-state-cell"
                              style={{
                                backgroundColor: present ? '#2ecc71' : '#fadbd8',
                                color: present ? '#065f46' : '#991b1b',
                              }}
                              title={`Minute ${idx + 1}: ${present ? 'Present' : 'Absent'}`}
                            >
                              {present ? '✓' : '✗'}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                    No minute-by-minute telemetry recorded for this session.
                  </div>
                )}
              </div>

              {/* Lesson Summary & Feedback */}
              <div className="feedback-grid">
                <div className="feedback-box">
                  <h4 className="feedback-box-title">📝 Session General Summary</h4>
                  <p className="feedback-box-content">
                    {activeLesson.generalSummary || 'General lesson summary has not been finalized by the instructor.'}
                  </p>
                  {activeLesson.generalFeedback && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <strong style={{ fontSize: '0.8rem', color: '#475569' }}>Classroom Feedback:</strong>
                      <p className="feedback-box-content" style={{ marginTop: '0.2rem' }}>
                        {Array.isArray(activeLesson.generalFeedback)
                          ? activeLesson.generalFeedback.join(' | ')
                          : activeLesson.generalFeedback}
                      </p>
                    </div>
                  )}
                </div>

                <div className="feedback-box">
                  <h4 className="feedback-box-title">💡 Student-Specific Guidance & Feedback</h4>
                  <p className="feedback-box-content">
                    {activeLesson.feedback ||
                      activeLesson.summary ||
                      'No individual guidance notes recorded for this lesson.'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* All Lessons Summary (Cumulative Comparison Table) */
            <div>
              {/* Cumulative Metrics Bar */}
              <div className="student-kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                  <div className="kpi-icon" style={{ background: '#dcfce7', color: '#15803d' }}>
                    📈
                  </div>
                  <div className="kpi-content">
                    <span className="kpi-value">{cumulativeAttendance.attRate}%</span>
                    <span className="kpi-label">Cumulative Attendance</span>
                  </div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-icon" style={{ background: '#eff6ff', color: '#1d4ed8' }}>
                    🖥️
                  </div>
                  <div className="kpi-content">
                    <span className="kpi-value">{cumulativeAttendance.shareRate}%</span>
                    <span className="kpi-label">Screen Sharing Rate</span>
                  </div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-icon" style={{ background: '#f5f3ff', color: '#7c3aed' }}>
                    🤖
                  </div>
                  <div className="kpi-content">
                    <span className="kpi-value">{cumulativeAttendance.aiRate}%</span>
                    <span className="kpi-label">AI Working Rate</span>
                  </div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-icon" style={{ background: '#f8fafc', color: '#475569' }}>
                    🏫
                  </div>
                  <div className="kpi-content">
                    <span className="kpi-value">
                      {cumulativeAttendance.lessonsAttendedCount} / {cumulativeAttendance.totalLessonsCount}
                    </span>
                    <span className="kpi-label">Sessions Attended</span>
                  </div>
                </div>
              </div>

              {/* All Lessons Comparison Table */}
              <div className="records-table-container">
                <table className="records-table">
                  <thead>
                    <tr>
                      <th>Lesson Date & Time</th>
                      <th>Duration</th>
                      <th>1. Attendance %</th>
                      <th>2. Screen Share %</th>
                      <th>3. AI Working %</th>
                      <th>Timeline Preview</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classLessons.map((l) => (
                      <tr key={l.lessonId}>
                        <td style={{ fontWeight: 600 }}>{formatDate(l.startTime)}</td>
                        <td>{l.duration} min</td>
                        <td>
                          <span
                            className={`pill-badge ${
                              parseFloat(l.attPercentage) >= 80
                                ? 'pill-success'
                                : parseFloat(l.attPercentage) >= 50
                                ? 'pill-warning'
                                : 'pill-danger'
                            }`}
                          >
                            {l.attPercentage}% ({l.attendedMinutes}m)
                          </span>
                        </td>
                        <td>
                          <span
                            className={`pill-badge ${
                              parseFloat(l.sharePercentage) >= 80
                                ? 'pill-success'
                                : parseFloat(l.sharePercentage) >= 50
                                ? 'pill-warning'
                                : 'pill-danger'
                            }`}
                          >
                            {l.sharePercentage}% ({l.sharedScreenMinutes}m)
                          </span>
                        </td>
                        <td>
                          <span
                            className={`pill-badge ${
                              parseFloat(l.aiPercentage) >= 70
                                ? 'pill-success'
                                : parseFloat(l.aiPercentage) >= 40
                                ? 'pill-warning'
                                : 'pill-danger'
                            }`}
                          >
                            {l.aiPercentage}% ({l.workingMinutes}m)
                          </span>
                        </td>
                        <td>
                          {l.attendance && l.attendance.length > 0 ? (
                            <div className="timeline-bar-wrapper">
                              <div className="timeline-bar" title="Green: Active, Pink: Inactive">
                                {l.attendance.map((val, idx) => (
                                  <div
                                    key={idx}
                                    style={{ flex: 1 }}
                                    className={val === 1 ? 'timeline-segment-active' : 'timeline-segment-inactive'}
                                  />
                                ))}
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>No data</span>
                          )}
                        </td>
                        <td>
                          <button
                            className="action-btn-sm action-btn-secondary"
                            onClick={() => {
                              setSelectedLessonId(l.lessonId);
                              setAttendanceViewMode('per_lesson');
                            }}
                          >
                            🔍 Inspect Lesson
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Tasks & AI Progress */}
      {activeTab === 'tasks' && (
        <div className="tab-panel-card">
          <div className="panel-header">
            <h2 className="panel-title">Completed Lab Tasks & Progress</h2>
            <small style={{ color: '#64748b' }}>
              Real-time task telemetry and automated AI evaluation reports for {activeClassObj?.name || selectedClassId}
            </small>
          </div>
          {filteredMetrics.length === 0 && filteredProgress.length === 0 ? (
            <div className="empty-state-box">
              <div className="empty-state-icon">📋</div>
              <div className="empty-state-text">
                {activeLesson
                  ? `No lab tasks recorded for this lesson (${formatDate(activeLesson.startTime)}). Complete assignments inside the classroom to track your performance.`
                  : 'No lab tasks recorded yet for this class. Complete assignments inside the classroom to track your performance.'}
              </div>
              {activeLesson && (
                <button
                  type="button"
                  className="scope-toggle-btn"
                  style={{ marginTop: '0.75rem' }}
                  onClick={() => setSelectedLessonId('all')}
                >
                  🌐 View All Class Tasks
                </button>
              )}
            </div>
          ) : (
            <div className="records-table-container">
              <table className="records-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Task Name</th>
                    <th>Status</th>
                    <th>Execution Time</th>
                    <th>AI Evaluation & Findings</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMetrics.map((m) => {
                    const matchedAi = filteredAiJobs.find(
                      (j) => j.lessonId === m.lessonId || (j.taskName && j.taskName === m.taskName)
                    );
                    const matchedProgress = filteredProgress.find(
                      (p) => p.taskName === m.taskName || p.lessonId === m.lessonId
                    );
                    return (
                      <tr key={m.id}>
                        <td style={{ fontWeight: 600 }}>{formatDate(m.timestamp)}</td>
                        <td>
                          <strong>{m.taskName || 'Classroom Exercise'}</strong>
                          {m.stepDetails && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{m.stepDetails}</div>}
                          {matchedProgress?.feedback && (
                            <div style={{ fontSize: '0.75rem', color: '#16a34a', marginTop: '0.2rem' }}>
                              {matchedProgress.feedback}
                            </div>
                          )}
                        </td>
                        <td>
                          <span
                            className={`pill-badge ${
                              m.status === 'completed'
                                ? 'pill-success'
                                : m.status === 'in_progress'
                                ? 'pill-warning'
                                : 'pill-neutral'
                            }`}
                          >
                            {m.status || 'recorded'}
                          </span>
                        </td>
                        <td>{m.durationMinutes ? `${m.durationMinutes} min` : 'N/A'}</td>
                        <td>
                          {matchedAi?.result ? (
                            <div className="feedback-card">
                              <span className="feedback-card-label">🤖 AI Assessment:</span>
                              {matchedAi.result}
                            </div>
                          ) : m.feedback ? (
                            <div className="feedback-card">
                              <span className="feedback-card-label">💡 Note:</span>
                              {m.feedback}
                            </div>
                          ) : (
                            <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Evaluated in session</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Integrity & Alerts */}
      {activeTab === 'irregularities' && (
        <div className="tab-panel-card">
          <div className="panel-header">
            <h2 className="panel-title">Invigilation & Proctoring Logs</h2>
            <small style={{ color: '#64748b' }}>
              On-device gaze, face orientation, and browser irregularities recorded for {activeClassObj?.name || selectedClassId}
            </small>
          </div>
          {filteredIrregularities.length === 0 ? (
            <div className="empty-state-box">
              <div className="empty-state-icon">✅</div>
              <div className="empty-state-text">
                {activeLesson
                  ? `Excellent! Zero proctoring irregularities or behavioral alerts recorded for this lesson (${formatDate(activeLesson.startTime)}).`
                  : 'Excellent! Zero proctoring irregularities or behavioral alerts recorded for this class.'}
              </div>
              {activeLesson && (
                <button
                  type="button"
                  className="scope-toggle-btn"
                  style={{ marginTop: '0.75rem' }}
                  onClick={() => setSelectedLessonId('all')}
                >
                  🌐 View All Class Alerts
                </button>
              )}
            </div>
          ) : (
            <div className="records-table-container">
              <table className="records-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Alert Type</th>
                    <th>Risk Level</th>
                    <th>Evidence / Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIrregularities.map((irreg) => (
                    <tr key={irreg.id}>
                      <td style={{ fontWeight: 600 }}>{formatDate(irreg.timestamp)}</td>
                      <td>
                        <span className="pill-badge pill-danger">{irreg.type || 'IRREGULARITY'}</span>
                      </td>
                      <td>
                        <span
                          className={`pill-badge ${
                            irreg.severity === 'high'
                              ? 'pill-danger'
                              : irreg.severity === 'medium'
                              ? 'pill-warning'
                              : 'pill-neutral'
                          }`}
                        >
                          {irreg.severity || 'medium'}
                        </span>
                      </td>
                      <td>
                        <div>{irreg.reason || 'Telemetry deviation detected.'}</div>
                        {isExamRecord(irreg, activeClassObj) ? (
                          <div className="pill-badge pill-neutral" style={{ marginTop: '4px', fontSize: '0.72rem' }}>
                            🔒 Exam Session: Media and snapshots shielded for test confidentiality
                          </div>
                        ) : irreg.metadata && (
                          <div className="evidence-box">
                            {irreg.metadata.details || JSON.stringify(irreg.metadata)}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 5: Audio Transcripts */}
      {activeTab === 'audio' && (
        <div className="tab-panel-card">
          <div className="panel-header">
            <h2 className="panel-title">Monitored Audio Transcripts</h2>
            <small style={{ color: '#64748b' }}>
              Speech-to-text transcript snippets logged during active audio monitoring for {activeClassObj?.name || selectedClassId}
            </small>
          </div>

          {(excludedExamAudioCount > 0 || isExamRecord(activeLesson, activeClassObj)) && (
            <div className="exam-security-banner" style={{ marginBottom: '1rem' }}>
              <div className="exam-security-banner-icon">🔒</div>
              <div className="exam-security-banner-content">
                <strong>Assessment Confidentiality: Exam Audio Restricted</strong>
                <p>
                  Audio transcripts and recordings captured during scheduled examination periods are protected and withheld from student access to maintain test confidentiality.
                </p>
              </div>
            </div>
          )}

          {visibleAudio.length === 0 ? (
            <div className="empty-state-box">
              <div className="empty-state-icon">🎙️</div>
              <div className="empty-state-text">
                {activeLesson
                  ? `No audio transcripts available for this lesson (${formatDate(activeLesson.startTime)}). Transcripts from non-exam discussions will appear here.`
                  : 'No audio transcripts recorded yet for this class.'}
              </div>
              {activeLesson && (
                <button
                  type="button"
                  className="scope-toggle-btn"
                  style={{ marginTop: '0.75rem' }}
                  onClick={() => setSelectedLessonId('all')}
                >
                  🌐 View All Class Audio
                </button>
              )}
            </div>
          ) : (
            <div className="records-table-container">
              <table className="records-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Language</th>
                    <th>Detected Speech Transcript</th>
                    <th>Audio Clip</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAudio.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 600 }}>{formatDate(a.timestamp)}</td>
                      <td>
                        <span className="pill-badge pill-neutral">{a.language || 'en'}</span>
                      </td>
                      <td>
                        {a.transcript ? (
                          <blockquote className="transcript-quote">{a.transcript}</blockquote>
                        ) : (
                          <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>[No speech detected in sample]</span>
                        )}
                      </td>
                      <td>
                        {(a.audioPath || a.audioUrl) ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <button
                              type="button"
                              className="action-btn-small"
                              onClick={() => handleTogglePlayAudio(a)}
                              disabled={audioLoadingId === a.id}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px', fontSize: '0.78rem' }}
                            >
                              {audioLoadingId === a.id
                                ? '⏳ Loading...'
                                : playingAudioId === a.id
                                ? '⏹ Stop'
                                : '▶ Play Clip'}
                            </button>
                            {playingAudioId === a.id && audioUrlMap[a.id] && (
                              <audio
                                controls
                                autoPlay
                                src={audioUrlMap[a.id]}
                                style={{ height: '30px', width: '180px', marginTop: '4px' }}
                                onEnded={() => setPlayingAudioId(null)}
                              />
                            )}
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>No audio file</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Video Player Modal */}
      {showPlayer && (
        <VideoPlayerModal
          show={showPlayer}
          onClose={() => {
            setShowPlayer(false);
            setPlayerVideoUrl('');
          }}
          videoUrl={playerVideoUrl}
          loading={playerLoading}
        />
      )}
    </div>
  );
};

export default StudentRecordsView;
