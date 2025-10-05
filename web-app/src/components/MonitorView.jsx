import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { db, storage } from '../firebase-config';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, query, where, onSnapshot, orderBy, limit, doc, updateDoc, addDoc, serverTimestamp, getDoc, getDocs } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import StudentScreen from './StudentScreen';
import IndividualStudentView from './IndividualStudentView';
import TimelineSlider from './TimelineSlider';
import { useClassSchedule } from '../hooks/useClassSchedule';
import { formatBytes } from '../utils/formatters';
import Modal from './Modal';

import ControlsPanel from './monitor/ControlsPanel';
import StudentsGrid from './monitor/StudentsGrid';

const MonitorView = ({ classId: propClassId }) => {
  const { classId: paramClassId } = useParams();
  const classId = propClassId || paramClassId;
  const [students, setStudents] = useState([]);
  const [classList, setClassList] = useState([]);
  const [studentStatuses, setStudentStatuses] = useState([]);
  const [screenshots, setScreenshots] = useState({});
  const [message, setMessage] = useState('');
  const [frameRate, setFrameRate] = useState(5);
  const [maxImageSize, setMaxImageSize] = useState(0.1 * 1024 * 1024);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showNotSharingModal, setShowNotSharingModal] = useState(false);
  const [now, setNow] = useState(new Date());
  const [showControls, setShowControls] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [isPaused, setIsPaused] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);

        const { lessons, selectedLesson, startTime, endTime, handleLessonChange: originalHandleLessonChange } = useClassSchedule(classId);
        const [reviewTime, setReviewTime] = useState(null);
        const [timelineScrubTime, setTimelineScrubTime] = useState(null);
        const timelineDebounceTimer = useRef(null);
      
        const handleLessonChange = (e) => {
          originalHandleLessonChange(e);
          setReviewTime(null);
        };
  
        const handleTimelineChange = (e) => {
          const time = parseInt(e.target.value, 10);
          setTimelineScrubTime(time);
  
          clearTimeout(timelineDebounceTimer.current);
          timelineDebounceTimer.current = setTimeout(() => {
              setReviewTime(new Date(time).toISOString());
              setTimelineScrubTime(null);
          }, 500);
        };
  const [storageUsage, setStorageUsage] = useState(0);
  const [storageQuota, setStorageQuota] = useState(0);
  const [storageUsageScreenShots, setStorageUsageScreenShots] = useState(0);
  const [storageUsageVideos, setStorageUsageVideos] = useState(0);
  const [storageUsageZips, setStorageUsageZips] = useState(0);
  const [aiQuota, setAiQuota] = useState(0);
  const [aiUsedQuota, setAiUsedQuota] = useState(0);

  const [analysisResults, setAnalysisResults] = useState({});
  const [showAnalysisResultsModal, setShowAnalysisResultsModal] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [prompts, setPrompts] = useState([]);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [editablePromptText, setEditablePromptText] = useState('');
  const [isPerImageAnalysisRunning, setIsPerImageAnalysisRunning] = useState(false);
  const [isAllImagesAnalysisRunning, setIsAllImagesAnalysisRunning] = useState(false);
  const [samplingRate, setSamplingRate] = useState(5);
  const analysisCounterRef = useRef(0);
  const studentIdMap = useRef(new Map());



  const pausedRef = useRef(isPaused);
  useEffect(() => { pausedRef.current = isPaused; }, [isPaused]);

  // Refs for stable callbacks
  const studentsRef = useRef(students);
  useEffect(() => { studentsRef.current = students; }, [students]);
  const screenshotsRef = useRef(screenshots);
  useEffect(() => { screenshotsRef.current = screenshots; }, [screenshots]);
  const editablePromptTextRef = useRef(editablePromptText);
  useEffect(() => { editablePromptTextRef.current = editablePromptText; }, [editablePromptText]);

  const functions = getFunctions();

  const runPerImageAnalysis = useCallback(async (screenshotsToAnalyze) => {
    if (!editablePromptTextRef.current.trim()) return;
    console.log(`[${new Date().toISOString()}] Running per-image analysis for:`, Object.keys(screenshotsToAnalyze));
    const analyzeImage = httpsCallable(functions, 'analyzeImage');
    try {
        const result = await analyzeImage({ screenshots: screenshotsToAnalyze, prompt: editablePromptTextRef.current, classId });
        console.log(`[${new Date().toISOString()}] Per-image analysis result for ${Object.keys(screenshotsToAnalyze)}:`, result.data);
        setAnalysisResults(prev => ({ ...prev, ...result.data }));
    } catch (error) {
        console.error("Error calling analyzeImage function: ", error);
    }
  }, [functions, classId]);

  const runAllImagesAnalysis = useCallback(async (screenshotsToAnalyze) => {
    if (!editablePromptTextRef.current.trim()) return;
    console.log(`[${new Date().toISOString()}] Running all-images analysis for ${Object.keys(screenshotsToAnalyze).length} images.`);
    const analyzeAllImages = httpsCallable(functions, 'analyzeAllImages');
    try {
        const result = await analyzeAllImages({ screenshots: screenshotsToAnalyze, prompt: editablePromptTextRef.current, classId });
        console.log(`[${new Date().toISOString()}] All-images analysis result:`, result.data);
        setAnalysisResults(prev => ({ ...prev, 'All Images': result.data }));
    } catch (error) {
        console.error("Error calling analyzeAllImages function: ", error);
    }
  }, [functions, classId]);

  // Effect to fetch prompts
  useEffect(() => {
    const promptsCollectionRef = collection(db, 'prompts');
    const q = query(promptsCollectionRef, where('category', '==', 'images'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const promptsData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      promptsData.sort((a, b) => a.name.localeCompare(b.name)); // Sort by name
      setPrompts(promptsData);
    });
    return () => unsubscribe();
  }, []);

  const frameRateOptions = [1, 5, 10, 15, 20, 25, 30];
  const maxImageSizeOptions = [
    { label: '1MB', value: 1024 * 1024 },
    { label: '0.75MB', value: 0.75 * 1024 * 1024 },
    { label: '0.5MB', value: 0.5 * 1024 * 1024 },
    { label: '0.25MB', value: 0.25 * 1024 * 1024 },
    { label: '0.1MB', value: 0.1 * 1024 * 1024 }
  ];

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 2000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!classId) return;

    const classRef = doc(db, "classes", classId);
    const unsubscribeClass = onSnapshot(classRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            setClassList(data.students || []);
            setFrameRate(prevRate => {
                const newRate = data.frameRate || 5;
                return newRate === prevRate ? prevRate : newRate;
            });
            setMaxImageSize(prevSize => {
                const newSize = data.maxImageSize || 0.1 * 1024 * 1024;
                return newSize === prevSize ? prevSize : newSize;
            });
            setIsCapturing(data.isCapturing || false);
            setStorageQuota(data.storageQuota || 0);
            setAiQuota(data.aiQuota || 0);
            setAiUsedQuota(data.aiUsedQuota || 0);
        } else {
            setClassList([]);
        }
    });

    const storageRef = doc(db, "classes", classId, "metadata", "storage");
    const unsubscribeStorage = onSnapshot(storageRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            setStorageUsage(data.storageUsage || 0);
            setStorageUsageScreenShots(data.storageUsageScreenShots || 0);
            setStorageUsageVideos(data.storageUsageVideos || 0);
            setStorageUsageZips(data.storageUsageZips || 0);
        }
    });

    const statusQuery = query(collection(db, 'classes', classId, 'status'));
    const unsubscribeStatus = onSnapshot(statusQuery, (snapshot) => {
      const statuses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      statuses.forEach(status => {
        if (status.email && status.id) {
          studentIdMap.current.set(status.email.toLowerCase(), status.id);
        }
      });

      const latestStatuses = Object.values(statuses.reduce((acc, curr) => {
          if (!curr.email) return acc;
          const existingTs = acc[curr.email]?.timestamp?.toMillis() || 0;
          const currentTs = curr.timestamp?.toMillis() || 0;

          if (currentTs >= existingTs) {
              acc[curr.email] = curr;
          }
          return acc;
      }, {}));
      setStudentStatuses(latestStatuses);
    });

    return () => {
        unsubscribeClass();
        unsubscribeStorage();
        unsubscribeStatus();
    }
  }, [classId]);

  useEffect(() => {
    if (!reviewTime || classList.length === 0) return;

    const fetchScreenshotsForReview = async () => {
      const newScreenshots = {};
      const reviewTimeDate = new Date(reviewTime);

      for (const studentEmail of classList) {
        const studentId = studentIdMap.current.get(studentEmail.toLowerCase());
        if (!studentId) continue;

        const screenshotsQuery = query(
          collection(db, 'screenshots'),
          where('classId', '==', classId),
          where('studentId', '==', studentId),
          where('timestamp', '<=', reviewTimeDate),
          orderBy('timestamp', 'desc'),
          limit(1)
        );

        const snapshot = await getDocs(screenshotsQuery);
        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          const screenshotData = doc.data();
          try {
            const url = await getDownloadURL(ref(storage, screenshotData.imagePath));
            newScreenshots[studentId] = { url, timestamp: screenshotData.timestamp, imagePath: screenshotData.imagePath };
          } catch (error) {
            console.error("Error getting download URL for review: ", error);
          }
        }
      }
      setScreenshots(newScreenshots);
    };

    fetchScreenshotsForReview();
  }, [reviewTime, classList, classId]);

  useEffect(() => {
    const lowercasedClassList = classList.map(email => (email || '').toLowerCase());
    const onlineStudents = studentStatuses.filter(status => status && status.email && lowercasedClassList.includes(status.email.toLowerCase()));

    const newStudents = onlineStudents.map(status => {
        return {
            id: status.id,
            email: status.email,
            isSharing: status.isSharing || false,
        };
    });

    setStudents(prevStudents => {
      if (JSON.stringify(prevStudents) === JSON.stringify(newStudents)) {
        return prevStudents;
      }
      return newStudents;
    });
  }, [classList, studentStatuses]);

  useEffect(() => {
    if (reviewTime || students.length === 0 || pausedRef.current) return;

    const unsubscribes = students.map(student => {
      if (student.id === student.email) return () => {};

      const screenshotsQuery = query(
        collection(db, 'screenshots'),
        where('classId', '==', classId),
        where('studentId', '==', student.id),
        orderBy('timestamp', 'desc'),
        limit(1)
      );

      return onSnapshot(screenshotsQuery, async (snapshot) => {
        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          const screenshotData = doc.data();
          try {
            const url = await getDownloadURL(ref(storage, screenshotData.imagePath));
            setScreenshots(prev => ({
                ...prev,
                [student.id]: { url, timestamp: screenshotData.timestamp, imagePath: screenshotData.imagePath }
            }));

            if (isPerImageAnalysisRunning && isCapturing) {
              analysisCounterRef.current += 1;
              if (analysisCounterRef.current % samplingRate === 0) {
                const screenshotsToAnalyze = { [student.email]: url };
                runPerImageAnalysis(screenshotsToAnalyze);
              }
            }
          } catch (error) {
            console.error("Error getting download URL: ", error);
            setScreenshots(prev => {
                const newState = { ...prev };
                delete newState[student.id];
                return newState;
            });
          }
        } else {
            setScreenshots(prev => {
                const newState = { ...prev };
                delete newState[student.id];
                return newState;
            });
        }
      });
    });

    return () => unsubscribes.forEach(unsub => unsub());

  }, [students, classId, isPaused, isPerImageAnalysisRunning, isCapturing, samplingRate, runPerImageAnalysis, reviewTime]);



  useEffect(() => {
    if (!isAllImagesAnalysisRunning || !isCapturing) {
      return;
    }

    const intervalId = setInterval(() => {
      const screenshotsToAnalyze = {};
      for (const student of studentsRef.current) {
        if (student.isSharing && screenshotsRef.current[student.id]) {
          screenshotsToAnalyze[student.email] = screenshotsRef.current[student.id].url;
        }
      }
      if (Object.keys(screenshotsToAnalyze).length > 0) {
        runAllImagesAnalysis(screenshotsToAnalyze);
      }
    }, samplingRate * frameRate * 1000);

    return () => clearInterval(intervalId);
  }, [isAllImagesAnalysisRunning, isCapturing, samplingRate, frameRate, runAllImagesAnalysis]);

  const handleSendMessage = async () => {
    if (!message.trim()) return;

    const onlineStudents = students.filter(s => s.isSharing);
    if (onlineStudents.length === 0) {
      alert("No students are online to receive the message.");
      return;
    }

    try {
      for (const student of onlineStudents) {
        const studentMessagesRef = collection(db, 'students', student.email, 'messages');
        await addDoc(studentMessagesRef, {
          message,
          timestamp: serverTimestamp(),
        });
      }
      setMessage('');
      alert(`Message sent to ${onlineStudents.length} student(s).`);
    } catch (error) {
      console.error("Error sending message to students: ", error);
      alert("An error occurred while sending the message.");
    }
  };

  const handleDownloadAttendance = () => {
    const statusMap = new Map(studentStatuses.map(status => [status.email.toLowerCase(), status]));

    const attendanceData = classList.map(email => {
      const lowercasedEmail = email.toLowerCase();
      const status = statusMap.get(lowercasedEmail);
      const isSharing = status ? status.isSharing || false : false;
      return { email, isSharing };
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + 'Email,Sharing Screen\n' + attendanceData.map(s => `${s.email},${s.isSharing}`).join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const now = new Date();
    const timeString = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}_${now.getHours()}-${now.getMinutes()}-${now.getSeconds()}`;
    link.setAttribute("download", `${classId}_${timeString}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFrameRateChange = useCallback(async (e) => {
    const newRate = parseInt(e.target.value, 10);
    const oldRate = frameRate;
    setFrameRate(newRate); // Optimistic update
    if (classId) {
      try {
        const classRef = doc(db, 'classes', classId);
        await updateDoc(classRef, { frameRate: newRate });
      } catch (error) {
        console.error("Error updating frame rate:", error);
        setFrameRate(oldRate); // Revert on error
        alert("Failed to update frame rate. Please try again.");
      }
    }
  }, [classId, frameRate]);

  const handleMaxImageSizeChange = async (e) => {
    const newSize = parseFloat(e.target.value);
    if (classId) {
      try {
        const classRef = doc(db, 'classes', classId);
        await updateDoc(classRef, { maxImageSize: newSize });
      } catch (error) {
        console.error("Error updating max image size:", error);
        alert("Failed to update max image size. Please try again.");
      }
    }
  };

  const toggleCapture = useCallback(async () => {
    if (!classId) return;
    const newIsCapturing = !isCapturing;
    setIsCapturing(newIsCapturing); // Optimistic update
    try {
      const classRef = doc(db, 'classes', classId);
      await updateDoc(classRef, { 
        isCapturing: newIsCapturing,
        captureStartedAt: newIsCapturing ? serverTimestamp() : null 
      });
    } catch (error) {
      console.error("Error toggling capture:", error);
      setIsCapturing(!newIsCapturing); // Revert on error
      alert("Failed to update capture status. Please try again.");
    }
  }, [classId, isCapturing]);

  const handleStudentClick = (student) => {
    setSelectedStudent(student);
  };

  const onlineSharingEmails = new Set(
    studentStatuses
      .filter(status => status.isSharing)
      .map(status => status.email.toLowerCase())
  );

  const notSharingStudents = classList
    .filter(email => !onlineSharingEmails.has(email.toLowerCase()))
    .map(email => ({ id: email, email: email }));

  const selectedScreenshotUrl = selectedStudent && screenshots[selectedStudent.id] ? screenshots[selectedStudent.id].url : null;

  const handleRunAnalysis = async () => {
    if (!editablePromptText.trim()) {
        alert('Please select or enter a prompt.');
        return;
    }

    const screenshotsToAnalyze = {};
    for (const student of students) {
        if (student.isSharing && screenshots[student.id]) {
            screenshotsToAnalyze[student.email] = screenshots[student.id].url;
        }
    }

    setIsAnalyzing(true);
    const analyzeImage = httpsCallable(functions, 'analyzeImage');
    try {
        const result = await analyzeImage({ screenshots: screenshotsToAnalyze, prompt: editablePromptText, classId });
        setAnalysisResults(result.data);
    } catch (error) {
        console.error("Error calling analyzeImage function: ", error);
        alert("Error analyzing images: " + error.message);
    } finally {
        setIsAnalyzing(false);
    }

    setShowPromptModal(false);
    setShowAnalysisResultsModal(true);
  };

  const handleRunAllImagesAnalysis = async () => {
    if (!editablePromptText.trim()) {
        alert('Please select or enter a prompt.');
        return;
    }

    const screenshotsToAnalyze = {};
    for (const student of students) {
        if (student.isSharing && screenshots[student.id]) {
            screenshotsToAnalyze[student.email] = screenshots[student.id].url;
        }
    }

    setIsAnalyzing(true);
    const analyzeAllImages = httpsCallable(functions, 'analyzeAllImages');
    try {
        const result = await analyzeAllImages({ screenshots: screenshotsToAnalyze, prompt: editablePromptText, classId });
        setAnalysisResults({ 'All Images': result.data });
    } catch (error) {
        console.error("Error calling analyzeAllImages function: ", error);
        alert("Error analyzing images: " + error.message);
    } finally {
        setIsAnalyzing(false);
    }

    setShowPromptModal(false);
    setShowAnalysisResultsModal(true);
  };

        const displayTime = timelineScrubTime ?? (reviewTime ? new Date(reviewTime).getTime() : now.getTime());
  
        return (
          <div className="monitor-view" style={{ display: 'flex', flexDirection: 'row' }}>
            {showControls ? <ControlsPanel 
              message={message}
              setMessage={setMessage}
              handleSendMessage={handleSendMessage}
              setShowControls={setShowControls}
              frameRate={frameRate}
              handleFrameRateChange={handleFrameRateChange}
              frameRateOptions={frameRateOptions}
              maxImageSize={maxImageSize}
              handleMaxImageSizeChange={handleMaxImageSizeChange}
              maxImageSizeOptions={maxImageSizeOptions}
              isCapturing={isCapturing}
              toggleCapture={toggleCapture}
              isPaused={isPaused}
              setIsPaused={setIsPaused}
              setShowPromptModal={setShowPromptModal}
              notSharingStudents={notSharingStudents}
              setShowNotSharingModal={setShowNotSharingModal}
              handleDownloadAttendance={handleDownloadAttendance}
              editablePromptText={editablePromptText}
              isPerImageAnalysisRunning={isPerImageAnalysisRunning}
              isAllImagesAnalysisRunning={isAllImagesAnalysisRunning}
              setIsPerImageAnalysisRunning={setIsPerImageAnalysisRunning}
              setIsAllImagesAnalysisRunning={setIsAllImagesAnalysisRunning}
              samplingRate={samplingRate}
              setSamplingRate={setSamplingRate}
              storageUsage={storageUsage}
              storageQuota={storageQuota}
              storageUsageScreenShots={storageUsageScreenShots}
              storageUsageVideos={storageUsageVideos}
              storageUsageZips={storageUsageZips}
              aiQuota={aiQuota}
              aiUsedQuota={aiUsedQuota}
            /> : <button onClick={() => setShowControls(true)} className="show-controls-btn">Show Controls</button>}
            
            <div className="monitor-main-content">
              <div className="timeline-controls" style={{ padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '10px' }}>
                  <select value={selectedLesson} onChange={handleLessonChange}>
                    {lessons.map(lesson => (
                      <option key={lesson.start.toISOString()} value={lesson.start.toISOString()}>
                        {`${lesson.start.toLocaleDateString()} ${lesson.start.toLocaleTimeString()} - ${lesson.end.toLocaleTimeString()}`}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => setReviewTime(null)} disabled={!reviewTime}>Go Live</button>
                  <span>
                    {reviewTime ? `Review: ${new Date(reviewTime).toLocaleString()}` : `Live: ${now.toLocaleString()}`}
                  </span>
                </div>
                {startTime && endTime && (
                  <TimelineSlider
                    min={new Date(startTime).getTime()}
                    max={new Date(endTime).getTime()}
                    value={displayTime}
                    onChange={handleTimelineChange}
                    bufferedRanges={[]}
                  />
                )}
              </div>
              <StudentsGrid
                reviewTime={reviewTime}
                classList={classList}
                studentIdMap={studentIdMap}
                screenshots={screenshots}
                frameRate={frameRate}
                students={students}
                now={now}
                isPaused={isPaused}
                handleStudentClick={handleStudentClick}
              />
            </div>

            <Modal show={showNotSharingModal} onClose={() => setShowNotSharingModal(false)} title="Students Not Sharing Screen">
              {notSharingStudents.length > 0 ? (
                <ul style={{listStyleType: 'none', padding: 0}}>{notSharingStudents.map(s => <li key={s.id} style={{padding: '5px 0'}}>{s.email}</li>)}</ul>
              ) : <p>All students are sharing their screen.</p>}
            </Modal>

            {selectedStudent && <IndividualStudentView student={selectedStudent} screenshotUrl={selectedScreenshotUrl} onClose={() => setSelectedStudent(null)} />}

            <Modal
                show={showPromptModal}
                onClose={() => {
                  setShowPromptModal(false);
                }}
                title="Analyze Student Screens"
            >
                <select 
                  value={selectedPrompt ? selectedPrompt.id : ''} 
                  onChange={(e) => {
                    const prompt = prompts.find(p => p.id === e.target.value);
                    setSelectedPrompt(prompt);
                    setEditablePromptText(prompt ? prompt.promptText : '');
                  }}
                  style={{ width: '100%', marginBottom: '10px', boxSizing: 'border-box' }}
                >
                  <option value="" disabled>Select a prompt</option>
                  {prompts.map(p => (
                    <option key={p.id} value={p.id} title={p.name}>{p.name}</option>
                  ))}
                </select>
                
                <textarea
                    value={editablePromptText}
                    onChange={(e) => setEditablePromptText(e.target.value)}
                    placeholder="Select a prompt or enter text here..."
                    style={{ width: '100%', flexGrow: 1, marginBottom: '10px', boxSizing: 'border-box' }}
                />

                <div style={{ marginTop: '10px' }}>
                  {/* Conditionally render buttons based on selectedPrompt, but use editablePromptText for the action */}
                  {(selectedPrompt ? selectedPrompt.applyTo?.includes('Per Image') : true) && (
                    <button onClick={handleRunAnalysis} disabled={isAnalyzing}>
                      {isAnalyzing ? 'Analyzing...' : 'Per Image Analysis'}
                    </button>
                  )}
                  {(selectedPrompt ? selectedPrompt.applyTo?.includes('All Images') : true) && (
                    <button onClick={handleRunAllImagesAnalysis} style={{ marginLeft: '10px' }} disabled={isAnalyzing}>
                      {isAnalyzing ? 'Analyzing...' : 'All Images Analysis'}
                    </button>
                  )}
                </div>
            </Modal>
            <Modal
                show={showAnalysisResultsModal}
                onClose={() => setShowAnalysisResultsModal(false)}
                title="Analysis Results"
            >
                {Object.keys(analysisResults).length > 0 ? (
                    <ul>
                        {Object.entries(analysisResults).map(([email, result]) => (
                            <li key={email}><strong>{email}:</strong> {result}</li>
                        ))}
                    </ul>
                ) : (
                    <p>No analysis has been run yet.</p>
                )}
            </Modal>
          </div>
        );
};

export default MonitorView;