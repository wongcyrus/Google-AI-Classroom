import './MonitorView.css';
import { useState, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { db, storage } from '../firebase-config';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, query, where, onSnapshot, orderBy, limit, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import StudentScreen from './StudentScreen';
import IndividualStudentView from './IndividualStudentView';

// Modal component
const Modal = ({ show, onClose, title, children }) => {
  if (!show) {
    return null;
  }

  const modalStyle = {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    backgroundColor: '#FFF',
    padding: '20px',
    zIndex: 1000,
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
  };

  const overlayStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 999
  };

  return (
    <>
      <div style={overlayStyle} onClick={onClose} />
      <div style={modalStyle}>
        <h2>{title}</h2>
        <div>{children}</div>
        <button onClick={onClose} style={{ marginTop: '10px' }}>Close</button>
      </div>
    </>
  );
};

const MonitorView = ({ setTitle }) => {
  const { classId } = useParams();
  const [students, setStudents] = useState([]);
  const [classList, setClassList] = useState([]);
  const [studentStatuses, setStudentStatuses] = useState([]);
  const [screenshots, setScreenshots] = useState({}); // Now stores { url, timestamp }
  const [message, setMessage] = useState('');
  const [frameRate, setFrameRate] = useState(5);
  const [imageQuality, setImageQuality] = useState(0.2);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showNotSharingModal, setShowNotSharingModal] = useState(false);
  const [now, setNow] = useState(new Date()); // State to trigger re-renders for time check
  const [showControls, setShowControls] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [isPaused, setIsPaused] = useState(false);
  const pausedRef = useRef(isPaused);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [analysisResults, setAnalysisResults] = useState({});
  const [showAnalysisResultsModal, setShowAnalysisResultsModal] = useState(false);

  const functions = getFunctions();

  const frameRateOptions = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
  const imageQualityOptions = [
    { label: 'High', value: 1.0 },
    { label: 'Medium', value: 0.5 },
    { label: 'Low', value: 0.2 },
  ];

  // Set the title
  useEffect(() => {
    setTitle(`Monitoring Class: ${classId}`);
  }, [classId, setTitle]);

  useEffect(() => {
    pausedRef.current = isPaused;
  }, [isPaused]);

  // Set up an interval to update the current time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Effect to fetch class roster and live student statuses
  useEffect(() => {
    if (!classId) return;

    const classRef = doc(db, "classes", classId);
    const unsubscribeClass = onSnapshot(classRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            setClassList(data.students || []);
            setFrameRate(data.frameRate || 5);
            setImageQuality(data.imageQuality || 0.2);
            setIsCapturing(data.isCapturing || false);
        } else {
            setClassList([]);
        }
    });

    const statusQuery = query(collection(db, 'classes', classId, 'status'));
    const unsubscribeStatus = onSnapshot(statusQuery, (snapshot) => {
      const statuses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStudentStatuses(statuses);
    });

    return () => {
        unsubscribeClass();
        unsubscribeStatus();
    }
  }, [classId]);

  // Effect to merge the class roster with live statuses
  useEffect(() => {
    const combinedStudents = classList.map(email => {
        const status = studentStatuses.find(s => s.email === email);
        return {
            id: status?.id || email,
            email: email,
            isSharing: status?.isSharing || false,
        };
    });
    setStudents(combinedStudents);
  }, [classList, studentStatuses]);


  // Effect to fetch the latest screenshot for each student
  useEffect(() => {
    if (students.length === 0 || pausedRef.current) return;

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
                [student.id]: { url, timestamp: screenshotData.timestamp } 
            }));
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

  }, [students, classId, isPaused]);

  const handleSendMessage = async () => {
    if (!classId || !message.trim()) return;
    const messagesRef = collection(db, 'classes', classId, 'messages');
    await addDoc(messagesRef, {
      message,
      timestamp: serverTimestamp(),
    });
    setMessage('');
  };

  const handleDownloadAttendance = () => {
    const csvContent = "data:text/csv;charset=utf-8,"
        + "Email,Sharing Screen\n"
        + students.map(s => `${s.email},${s.isSharing}`).join("\n");

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

  const handleFrameRateChange = async (e) => {
    const newRate = parseInt(e.target.value, 10);
    setFrameRate(newRate);
    if (classId) {
      const classRef = doc(db, 'classes', classId);
      await updateDoc(classRef, { frameRate: newRate });
    }
  };

  const handleImageQualityChange = async (e) => {
    const newQuality = parseFloat(e.target.value);
    setImageQuality(newQuality);
    if (classId) {
      const classRef = doc(db, 'classes', classId);
      await updateDoc(classRef, { imageQuality: newQuality });
    }
  };

  const toggleCapture = async () => {
    if (!classId) return;
    const classRef = doc(db, 'classes', classId);
    const newIsCapturing = !isCapturing;
    await updateDoc(classRef, { 
      isCapturing: newIsCapturing,
      captureStartedAt: newIsCapturing ? serverTimestamp() : null 
    });
    setIsCapturing(newIsCapturing);
  };

  const handleStudentClick = (student) => {
    setSelectedStudent(student);
  };

  const notSharingStudents = students.filter(s => !s.isSharing);

  const selectedScreenshotUrl = selectedStudent && screenshots[selectedStudent.id] ? screenshots[selectedStudent.id].url : null;

  const handleRunAnalysis = async () => {
    if (!prompt.trim()) {
        alert('Please enter a prompt.');
        return;
    }

    const screenshotsToAnalyze = {};
    for (const student of students) {
        if (student.isSharing && screenshots[student.id]) {
            screenshotsToAnalyze[student.email] = screenshots[student.id].url;
        }
    }

    const analyzeImages = httpsCallable(functions, 'analyzeImages');
    try {
        const result = await analyzeImages({ screenshots: screenshotsToAnalyze, prompt });
        setAnalysisResults(result.data);
    } catch (error) {
        console.error("Error calling analyzeImages function: ", error);
        alert("Error analyzing images: " + error.message);
    }

    setShowPromptModal(false);
    setShowAnalysisResultsModal(true);
  };


  return (
    <div className="monitor-view">
      <div className="monitor-header">
        <div>
          <button onClick={() => setShowControls(!showControls)} style={{ marginRight: '10px' }}>
            {showControls ? 'Hide Controls' : 'Show Controls'}
          </button>
        </div>
        <Link to="/teacher">
            <button>Back to Main View</button>
        </Link>
      </div>
      {showControls && (
        <div className="class-controls">
          <div className="control-group">
            <input 
              type="text" 
              value={message} 
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Broadcast a message"
            />
            <button onClick={handleSendMessage}>Send</button>
          </div>
          <div className="control-group">
            <label>
              Frame Rate (seconds): 
              <select value={frameRate} onChange={handleFrameRateChange}>
                {frameRateOptions.map(rate => (
                  <option key={rate} value={rate}>{rate}</option>
                ))}
              </select>
            </label>
            <label>
              Image Quality: 
              <select value={imageQuality} onChange={handleImageQualityChange}>
                {imageQualityOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="control-group">
            <button onClick={toggleCapture}>
              {isCapturing ? 'Stop Capture' : 'Start Capture'}
            </button>
            <button onClick={() => setIsPaused(!isPaused)}>
              {isPaused ? 'Resume' : 'Pause'}
            </button>
            <button onClick={() => setShowPromptModal(true)}>
              Prompt
            </button>
          </div>
          <div className="control-group">
            <button onClick={() => setShowNotSharingModal(true)}>
              Show Students Not Sharing ({notSharingStudents.length})
            </button>
            <button onClick={handleDownloadAttendance}>
              Download Attendance
            </button>
          </div>
        </div>
      )}
      <hr />
      <div className="monitor-main-content">
        <div className="students-container">
          {students.filter(student => student.isSharing).map(student => {
            const screenshotData = screenshots[student.id];
            let screenshotUrl = null;

            if (screenshotData && screenshotData.timestamp) {
              const screenshotTime = screenshotData.timestamp.toDate();
              const secondsDiff = (now.getTime() - screenshotTime.getTime()) / 1000;

              if (isPaused || secondsDiff <= frameRate) {
                screenshotUrl = screenshotData.url;
              }
            }

            return (
              <StudentScreen
                key={student.id}
                student={student}
                isSharing={student.isSharing}
                screenshotUrl={screenshotUrl}
                onClick={() => handleStudentClick(student)}
              />
            );
          })}
        </div>
      </div>

      <Modal 
        show={showNotSharingModal} 
        onClose={() => setShowNotSharingModal(false)}
        title="Students Not Sharing Screen"
      >
        {notSharingStudents.length > 0 ? (
          <ul>
            {notSharingStudents.map(student => (
              <li key={student.id}>{student.email}</li>
            ))}
          </ul>
        ) : (
          <p>All students are currently sharing their screen.</p>
        )}
      </Modal>
      {selectedStudent && (
        <IndividualStudentView 
            student={selectedStudent} 
            screenshotUrl={selectedScreenshotUrl} 
            onClose={() => setSelectedStudent(null)} 
        />
      )}
      <Modal
          show={showPromptModal}
          onClose={() => setShowPromptModal(false)}
          title="Analyze Student Screens"
      >
          <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter your prompt for Gemini"
              style={{ width: '100%', minHeight: '100px' }}
          />
          <button onClick={handleRunAnalysis} style={{ marginTop: '10px' }}>Run</button>
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
