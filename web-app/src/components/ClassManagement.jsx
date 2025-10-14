import { useState, useEffect, useRef } from 'react';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  onSnapshot,
  query,
  where,
  deleteDoc,
  writeBatch,
  addDoc,
  serverTimestamp,
  orderBy,
  limit,
  getDocs,
} from 'firebase/firestore';
import { CSVLink } from 'react-csv';
import { db, auth } from '../firebase-config';
import './ClassManagement.css';
import Modal from './Modal';
import VideoPromptSelector from './VideoPromptSelector';

const timeZones = [
    'Asia/Hong_Kong',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'UTC',
]

const formatTime12Hour = (time24) => {
  if (!time24) return '';
  const [h, m] = time24.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${m} ${ampm}`;
};

const timeOptions = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 30) {
    const hour = h.toString().padStart(2, '0');
    const minute = m.toString().padStart(2, '0');
    const value = `${hour}:${minute}`;
    timeOptions.push({ value, label: formatTime12Hour(value) });
  }
}

const ClassManagement = ({ user }) => {
  const [classId, setClassId] = useState('');
  const [studentEmails, setStudentEmails] = useState('');
  const [teacherEmails, setTeacherEmails] = useState('');
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);

  // New state for class details
  const [storageLimit, setStorageLimit] = useState('5'); // In GB
  const [scheduleStartDate, setScheduleStartDate] = useState('');
  const [scheduleEndDate, setScheduleEndDate] = useState('');
  const [timeZone, setTimeZone] = useState('Asia/Hong_Kong');
  const [classSchedules, setClassSchedules] = useState([]);
  const [newSchedule, setNewSchedule] = useState({
    startTime: '',
    endTime: '',
    days: [],
  });
  const [ipRestrictions, setIpRestrictions] = useState('');
  const [automaticCapture, setAutomaticCapture] = useState(false);
  const [automaticCombine, setAutomaticCombine] = useState(false);
  
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [afterClassVideoPrompt, setAfterClassVideoPrompt] = useState(null);
  
  // Temp state for modal editing
  const [modalPrompt, setModalPrompt] = useState(null);
  const [modalPromptText, setModalPromptText] = useState('');

  // State for Custom Properties
  const [classProperties, setClassProperties] = useState([{ key: '', value: '' }]);
  const [_studentProperties, setStudentProperties] = useState({});

  const [propertyUploadJobs, setPropertyUploadJobs] = useState([]);

  // State for CSV Download
  const [downloadProps, setDownloadProps] = useState(null);
  const csvLink = useRef(null);

  useEffect(() => {
    if (!user) return;

    const userProfileRef = doc(db, "teacherProfiles", user.uid);
    const unsubscribe = onSnapshot(userProfileRef, (profileSnap) => {
      if (profileSnap.exists()) {
        const profileData = profileSnap.data();
        const classIds = profileData.classes || [];
        const classesData = classIds.map(id => ({ id })); // We only need the IDs for the dropdown
        console.log('Fetched classes:', classesData);
        setClasses(classesData);
      } else {
        setClasses([]);
      }
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    const fetchClassDetails = async () => {
      if (selectedClass) {
        const classRef = doc(db, 'classes', selectedClass);
        const classSnap = await getDoc(classRef);
        if (classSnap.exists()) {
          const classData = classSnap.data();
          setClassId(selectedClass);
          if (classData.storageQuota) {
            setStorageLimit((classData.storageQuota / (1024 * 1024 * 1024)).toString());
          } else {
            setStorageLimit('5');
          }
          if (classData.schedule) {
            setScheduleStartDate(classData.schedule.startDate || '');
            setScheduleEndDate(classData.schedule.endDate || '');
            setTimeZone(classData.schedule.timeZone || 'Asia/Hong_Kong');
            setClassSchedules(classData.schedule.timeSlots || []);
          } else {
            setScheduleStartDate('');
            setScheduleEndDate('');
            setTimeZone('Asia/Hong_Kong');
            setClassSchedules([]);
          }
          if (classData.teacherEmails) {
            setTeacherEmails(classData.teacherEmails.join('\n'));
          } else {
            setTeacherEmails('');
          }
          if (classData.studentEmails) {
            setStudentEmails(classData.studentEmails.join('\n'));
          } else {
            setStudentEmails('');
          }
          if (classData.ipRestrictions) {
            setIpRestrictions(classData.ipRestrictions.join('\n'));
          } else {
            setIpRestrictions('');
          }
          setAutomaticCapture(classData.automaticCapture || false);
          setAutomaticCombine(classData.automaticCombine || false);
          setAfterClassVideoPrompt(classData.afterClassVideoPrompt || null);

          // Fetch Custom Properties
          const classPropsRef = doc(db, 'classes', selectedClass, 'classProperties', 'config');
          const classPropsSnap = await getDoc(classPropsRef);
          if (classPropsSnap.exists()) {
              const propsData = classPropsSnap.data();
              const propsArray = Object.entries(propsData).map(([key, value]) => ({ key, value }));
              setClassProperties(propsArray.length > 0 ? propsArray : [{ key: '', value: '' }]);
          } else {
              setClassProperties([{ key: '', value: '' }]);
          }
        } else {
            alert(`Could not find data for class: ${selectedClass}. It might have been deleted.`);
            setSelectedClass(null); // This will trigger a re-render and run the outer else block.
        }
      } else {
        // Reset form if no class is selected
        setClassId('');
        setStorageLimit('5');
        setScheduleStartDate('');
        setScheduleEndDate('');
        setTimeZone('Asia/Hong_Kong');
        setClassSchedules([]);
        setTeacherEmails('');
        setStudentEmails('');
        setIpRestrictions('');
        setAutomaticCapture(false);
        setAutomaticCombine(false);
        setAfterClassVideoPrompt(null);
        setClassProperties([{ key: '', value: '' }]);
        setStudentProperties({});
        setPropertyUploadJobs([]);
      }
    };
    fetchClassDetails();
  }, [selectedClass]);

  // Listen for property upload jobs
  useEffect(() => {
      if (!selectedClass) {
          setPropertyUploadJobs([]);
          return;
      }

      const jobsRef = collection(db, 'propertyUploadJobs');
      const q = query(jobsRef, where('classId', '==', selectedClass), orderBy('createdAt', 'desc'), limit(5));

      const unsubscribe = onSnapshot(q, (snapshot) => {
          const jobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setPropertyUploadJobs(jobs);
      });

      return () => unsubscribe();
  }, [selectedClass]);

  const handleDownloadStudentTemplate = async () => {
    if (!selectedClass) {
        alert("Please select a class first.");
        return;
    }

    try {
        // Fetch the class document to get the student list (UID -> email map)
        const classRef = doc(db, 'classes', selectedClass);
        const classSnap = await getDoc(classRef);
        if (!classSnap.exists()) {
            throw new Error("Could not find the selected class data.");
        }
        const classData = classSnap.data();
        const studentsMap = classData.students || {};

        // If no students are enrolled, download a template with just the StudentEmail header.
        if (Object.keys(studentsMap).length === 0) {
            const studentEmailList = studentEmails.split(/[\n,]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
            const data = studentEmailList.map(email => ({ StudentEmail: email }));
            const headers = ['StudentEmail']; // Only StudentEmail header
            setDownloadProps({ headers, data });
            setTimeout(() => {
                if (csvLink.current) {
                    csvLink.current.link.click();
                    setDownloadProps(null);
                }
            }, 100);
            return;
        }

        // If students are enrolled, download their existing, student-specific properties.
        
        // 1. Fetch all student-specific properties
        const propertiesCollectionRef = collection(db, 'classes', selectedClass, 'studentProperties');
        const propertiesSnapshot = await getDocs(propertiesCollectionRef);
        const studentPropertiesData = {}; // uid -> {prop: value}
        propertiesSnapshot.forEach(doc => {
            // Trim the doc ID to safeguard against whitespace issues.
            studentPropertiesData[doc.id.trim()] = doc.data();
        });

        // 2. Determine all possible property keys for headers ONLY from student-specific properties.
        const allPropertyKeys = new Set();
        Object.values(studentPropertiesData).forEach(props => {
            Object.keys(props).forEach(key => allPropertyKeys.add(key));
        });

        const headers = ['StudentEmail', ...Array.from(allPropertyKeys).sort()];

        // 3. Build data for each student using only their specific properties.
        const data = Object.entries(studentsMap).map(([uid, email]) => {
            const row = { StudentEmail: email };
            // Trim the UID from studentsMap to safeguard against whitespace issues.
            const studentProps = studentPropertiesData[uid.trim()] || {};
            
            headers.forEach(header => {
                if (header !== 'StudentEmail') {
                    row[header] = studentProps[header] ?? ''; // Use only student prop, or empty string.
                }
            });
            return row;
        });

        // Sort by email before generating the CSV
        data.sort((a, b) => a.StudentEmail.localeCompare(b.StudentEmail));

        setDownloadProps({ headers, data });
        setTimeout(() => {
            if (csvLink.current) {
                csvLink.current.link.click();
                setDownloadProps(null);
            }
        }, 100);

    } catch (err) {
        console.error("Error preparing student properties for download:", err);
        alert("Failed to prepare student properties for download: " + err.message);
    }
  };

  const handleDayToggle = (day) => {
    const days = newSchedule.days.includes(day)
      ? newSchedule.days.filter((d) => d !== day)
      : [...newSchedule.days, day];
    setNewSchedule({ ...newSchedule, days });
  };

  const addSchedule = () => {
    setError(null); // Clear previous errors
    if (!newSchedule.startTime || !newSchedule.endTime || newSchedule.days.length === 0) {
      setError('Please provide start time, end time, and at least one day for the schedule.');
      return;
    }

    const newStart = newSchedule.startTime;
    const newEnd = newSchedule.endTime;

    if (newStart >= newEnd) {
      setError('Start time must be before end time.');
      return;
    }

    for (const existing of classSchedules) {
      const hasCommonDay = newSchedule.days.some(day => existing.days.includes(day));
      if (hasCommonDay) {
        const existingStart = existing.startTime;
        const existingEnd = existing.endTime;

        if (newStart <= existingEnd && newEnd >= existingStart) {
          const commonDays = newSchedule.days.filter(day => existing.days.includes(day));
          setError(`Schedule overlap or adjacent schedule detected on ${commonDays.join(', ')} with the existing schedule: ${existingStart} - ${existingEnd}.`);
          return;
        }
      }
    }

    // If no overlap, add the schedule
    setClassSchedules([...classSchedules, { ...newSchedule, days: [...newSchedule.days].sort() }]);
    setNewSchedule({ startTime: '', endTime: '', days: [] });
  };

  const removeSchedule = (index) => {
    const updatedSchedules = classSchedules.filter((_, i) => i !== index);
    setClassSchedules(updatedSchedules);
  };

  const handleStartTimeChange = (e) => {
    const startTime = e.target.value;
    // If start time is cleared, do nothing special, just update the state
    if (!startTime) {
      setNewSchedule({ ...newSchedule, startTime: '', endTime: '' });
      return;
    }

    const [hour, minute] = startTime.split(':').map(Number);
    const newEndHour = hour + 2;
    const suggestedEndTime = `${String(newEndHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    // Check if the suggested time is a valid option. If not, use the last available time slot.
    const finalEndTime = timeOptions.some(option => option.value === suggestedEndTime)
      ? suggestedEndTime
      : timeOptions[timeOptions.length - 1].value;

    setNewSchedule({ ...newSchedule, startTime, endTime: finalEndTime });
  };

  const validateClassId = (id) => {
    if (!id || id.trim().length === 0) {
      return 'Class ID cannot be empty.';
    }
    if (id.trim().length < 3) {
      return 'Class ID must be at least 3 characters long.';
    }
    if (id.length > 100) {
      return 'Class ID is too long.';
    }
    // Firestore document IDs must not contain slashes.
    if (id.includes('/')) {
      return 'Class ID cannot contain slashes.';
    }
    return null;
  };

  const handleUpdateClass = async () => {
    const validationError = validateClassId(classId);
    if (validationError) {
      setError(validationError);
      return;
    }

    // Validate that the end date is not before the start date
    if (scheduleStartDate && scheduleEndDate && scheduleEndDate < scheduleStartDate) {
      setError('Schedule end date cannot be before the start date.');
      return;
    }

    if (!scheduleStartDate || !scheduleEndDate || classSchedules.length === 0) {
      setError('Schedule information is required. Please provide a start date, end date, and at least one time slot.');
      return;
    }
    
    if (!auth.currentUser) {
      setError('You must be logged in to manage classes.');
      return;
    }
    setError(null); // Clear previous errors
    setSuccessMessage(''); // Clear previous success messages

    const classRef = doc(db, 'classes', classId);
    const classSnap = await getDoc(classRef);
    const studentEmailList = studentEmails
      .split(/[\n,]+/) // Corrected regex for splitting by newline or comma
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    
    const teacherEmailList = teacherEmails
      .replace(/\n/g, ' ')
      .split(/[, ]+/) // Corrected regex for splitting by comma or space
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);

    const storageQuotaBytes = parseInt(storageLimit) * 1024 * 1024 * 1024;
    const ipList = ipRestrictions.split('\n').map(ip => ip.trim()).filter(Boolean);

    try {
      if (classSnap.exists()) {
        // The class exists, so we update it.
        const updatedTeachers = [auth.currentUser.email, ...teacherEmailList];
        const uniqueTeachers = [...new Set(updatedTeachers.map(e => e.trim().toLowerCase()).filter(Boolean))];

        const updateData = {
          storageQuota: storageQuotaBytes,
          schedule: {
            startDate: scheduleStartDate,
            endDate: scheduleEndDate,
            timeZone: timeZone,
            timeSlots: classSchedules,
          },
          studentEmails: studentEmailList,
          teacherEmails: uniqueTeachers,
          ipRestrictions: ipList,
          automaticCapture: automaticCapture,
          automaticCombine: automaticCombine,
          afterClassVideoPrompt,
        };
        await updateDoc(classRef, updateData);
        setSuccessMessage('Successfully updated the class!');
      } else {
        // The class does not exist, so create it with the current user as the teacher.
        const initialTeachers = [auth.currentUser.email, ...teacherEmailList];
        const uniqueTeachers = [...new Set(initialTeachers.map(e => e.trim().toLowerCase()).filter(Boolean))];

        await setDoc(classRef, {
          teacherEmails: uniqueTeachers,
          studentEmails: studentEmailList,
          storageQuota: storageQuotaBytes,
          schedule: {
            startDate: scheduleStartDate,
            endDate: scheduleEndDate,
            timeZone: timeZone,
            timeSlots: classSchedules,
          },
          storageUsage: 0, // Initialize storage usage
          ipRestrictions: ipList,
          automaticCapture: automaticCapture,
          automaticCombine: automaticCombine,
          afterClassVideoPrompt,
          aiQuota: 10, // Default AI Quota
          aiUsedQuota: 0, // Initialize AI Quota Usage
        });

        setSuccessMessage('Successfully created the class!');
        // Optimistically update the UI with the new class
        setClasses(prevClasses => [...prevClasses, { id: classId }]);
        setSelectedClass(classId); // Automatically select the new class
      }
    } catch (error) {
      console.error('Error updating or creating class: ', error);
      setError(error.message);
    }
  };

  const handleDeleteClass = async () => {
    if (!selectedClass) {
      alert('Please select a class to delete.');
      return;
    }

    if (confirm('Are you sure you want to delete the class ' + selectedClass + '? This action cannot be undone.')) {
      try {
        const classRef = doc(db, 'classes', selectedClass);
        await deleteDoc(classRef);

        // Note: The cleanup of the student's class subcollection is removed for now
        // to prevent crashes and will be addressed in a future update.

        setSelectedClass(null); // Reset selection
        console.log('Class deleted successfully.');
      } catch (error) {
        console.error('Error deleting class: ', error);
        alert('Error deleting class: ' + error.message);
      }
    }
  };

  const handleOpenPromptModal = () => {
    setModalPrompt(afterClassVideoPrompt);
    setModalPromptText(afterClassVideoPrompt ? afterClassVideoPrompt.promptText : '');
    setShowPromptModal(true);
  };

  const handleSetPrompt = () => {
    if (modalPrompt) {
        const isModified = modalPrompt.promptText !== modalPromptText;
        const finalPrompt = {
            ...modalPrompt,
            promptText: modalPromptText,
            name: isModified && modalPrompt.name ? `${modalPrompt.name} (Customized)` : (modalPrompt.name || 'Custom Prompt'),
            originalId: modalPrompt.id || modalPrompt.originalId,
        };
        if (finalPrompt.id) delete finalPrompt.id;
        setAfterClassVideoPrompt(finalPrompt);
    } else if (modalPromptText.trim()) {
        setAfterClassVideoPrompt({
            name: 'Custom Prompt',
            promptText: modalPromptText,
            category: 'videos',
        });
    } else {
        setAfterClassVideoPrompt(null);
    }
    setShowPromptModal(false);
  };

  // --- Custom Properties Handlers ---

  const handlePropertyChange = (index, field, value) => {
    const updated = [...classProperties];
    updated[index][field] = value;
    setClassProperties(updated);
  };

  const addPropertyRow = () => {
    setClassProperties([...classProperties, { key: '', value: '' }]);
  };

  const removePropertyRow = (index) => {
    setClassProperties(classProperties.filter((_, i) => i !== index));
  };

  const handleSaveProperties = async () => {
    if (!selectedClass) {
        setError("Please select a class first.");
        return;
    }
    setError(null);
    setSuccessMessage('');

    try {
        const batch = writeBatch(db);

        // Save class-wide properties
        const classPropsRef = doc(db, 'classes', selectedClass, 'classProperties', 'config');
        const classPropsMap = classProperties.reduce((acc, prop) => {
            if (prop.key.trim()) {
                acc[prop.key.trim()] = prop.value;
            }
            return acc;
        }, {});
        batch.set(classPropsRef, classPropsMap);

        await batch.commit();
        setSuccessMessage("Successfully saved properties!");

    } catch (err) {
        setError("Failed to save properties: " + err.message);
        console.error(err);
    }
  };

  const handleStudentPropertiesCSVUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = null; // Reset file input

    const reader = new FileReader();
    reader.onload = async (e) => {
        const csvData = e.target.result;
        if (!selectedClass) {
            setError("Please select a class first.");
            return;
        }
        try {
            const jobsRef = collection(db, 'propertyUploadJobs');
            await addDoc(jobsRef, {
                classId: selectedClass,
                csvData,
                requesterUid: auth.currentUser.uid,
                status: 'pending',
                createdAt: serverTimestamp(),
            });
            setSuccessMessage("CSV uploaded for processing. Properties will be updated in the background.");
        } catch (err) {
            setError("Failed to upload CSV for processing. " + err.message);
        }
    };
    reader.readAsText(file);
  };

  return (
    <div className="class-management-container">
      <Modal show={showPromptModal} onClose={() => setShowPromptModal(false)} title="Set After Class Video Prompt">
          <VideoPromptSelector
              user={user}
              selectedPrompt={modalPrompt}
              onSelectPrompt={(p) => {
                setModalPrompt(p);
                setModalPromptText(p ? p.promptText : '');
              }}
              promptText={modalPromptText}
              onTextChange={setModalPromptText}
          />
          <button onClick={handleSetPrompt}>Set Prompt</button>
          <button onClick={() => { setAfterClassVideoPrompt(null); setShowPromptModal(false); }} style={{marginLeft: '10px'}}>Clear and Close</button>
      </Modal>

      <h2>Class Management</h2>

      <h3>Select a Class to Manage or Create a New One</h3>
      <select onChange={(e) => setSelectedClass(e.target.value)} value={selectedClass || ''}>
        <option value="" disabled>Select a class to edit</option>
        {classes.map(c => (
          <option key={c.id} value={c.id}>{c.id}</option>
        ))}
      </select>
      <p>Or, to create a new class, type a new Class ID below and fill out the details.</p>

      <input
        type="text"
        placeholder="Class ID"
        value={classId}
        onChange={(e) => setClassId(e.target.value.toLowerCase())}
        disabled={!!selectedClass} // Disable if a class is selected for editing
      />
      <p className="input-hint">Class ID will be converted to lowercase.</p>
      {error && <div className="error-message">{error}</div>}

      <div className="form-group">
        <label>Storage Limit</label>
        <select value={storageLimit} onChange={(e) => setStorageLimit(e.target.value)}>
          <option value="5">5 GB</option>
          <option value="10">10 GB</option>
        </select>
      </div>

      <div className="form-group">
        <label>Schedule</label>
        <div className="schedule-settings">
            <div className="date-range-inputs">
                <input type="date" value={scheduleStartDate} onChange={(e) => setScheduleStartDate(e.target.value)} />
                <span> to </span>
                                  <input type="date" value={scheduleEndDate} onChange={(e) => setScheduleEndDate(e.target.value)} />            </div>
            <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
                {timeZones.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
        </div>
      </div>

      <div className="form-group">
        <label>Class Time Slots</label>
        <div className="schedules-list">
            {classSchedules.map((schedule, index) => (
              <div key={index} className="schedule-item">
                <span>{schedule.days.join(', ')}: {formatTime12Hour(schedule.startTime)} - {formatTime12Hour(schedule.endTime)}</span>
                <button type="button" onClick={() => removeSchedule(index)}>Remove</button>
              </div>
            ))}
        </div>
        <div className="add-schedule">
          <select value={newSchedule.startTime} onChange={handleStartTimeChange}>
            <option value="" disabled>Start Time</option>
            {timeOptions.map(time => <option key={time.value} value={time.value}>{time.label}</option>)}
          </select>
          <select value={newSchedule.endTime} onChange={(e) => setNewSchedule({...newSchedule, endTime: e.target.value})}>
            <option value="" disabled>End Time</option>
            {timeOptions.map(time => <option key={time.value} value={time.value}>{time.label}</option>)}
          </select>
          <div className="days-checkboxes">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={newSchedule.days.includes(day)}
                  onChange={() => handleDayToggle(day)}
                /> {day}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%', marginTop: '10px' }}>
            <p className="input-hint">Remember to click "Add Schedule" to save the time slot above.</p>
            <button type="button" onClick={addSchedule}>Add Schedule</button>
          </div>
        </div>
      </div>

      <div className="form-group">
        <label>Student Emails</label>
        <textarea
          placeholder="Add student emails (one per line)"
          value={studentEmails}
          onChange={(e) => setStudentEmails(e.target.value)}
          rows="6"
        />
      </div>

      <div className="form-group">
        <label>Teacher Emails</label>
        <textarea
          placeholder="Add teacher emails (one per line)"
          value={teacherEmails}
          onChange={(e) => setTeacherEmails(e.target.value)}
          rows="3"
        />
      </div>

      <div className="form-group">
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input
            type="checkbox"
            checked={automaticCapture}
            onChange={(e) => setAutomaticCapture(e.target.checked)}
          />
          Automatic Capture
        </label>
        <p className="input-hint">Start capturing 5 mins before class starts and stop 5 mins after it ends.</p>
      </div>

      <div className="form-group">
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input
            type="checkbox"
            checked={automaticCombine}
            onChange={(e) => setAutomaticCombine(e.target.checked)}
          />
          Automatic Combine Image to Video
        </label>
        <p className="input-hint">Automatically generate a video recording for each student after the class session ends.</p>
      </div>

      <div className="form-group">
        <label>After Class Video Prompt</label>
        <button type="button" onClick={handleOpenPromptModal}>
            {afterClassVideoPrompt ? afterClassVideoPrompt.name || 'Custom Prompt' : 'Select Prompt'}
        </button>
        {afterClassVideoPrompt && <p className="input-hint">{afterClassVideoPrompt.promptText.substring(0, 100)}...</p>}
      </div>

      <div className="form-group">
        <label>IP Address Restrictions</label>
        <textarea
          placeholder="Allowed IP addresses or ranges (one per line)"
          value={ipRestrictions}
          onChange={(e) => setIpRestrictions(e.target.value)}
          rows="4"
        />
        <p className="input-hint">Leave blank for no IP restrictions. If IPs are entered, students can only log in from these addresses during scheduled class times.</p>
      </div>
      <button onClick={handleUpdateClass}>Update/Create Class</button>
      {successMessage && <div className="success-message">{successMessage}</div>}
      
      {selectedClass && (
        <div className="manage-selected-class">
          <hr />
          <h3>Custom Properties</h3>
          <div className="form-group">
              <label>Class-wide Properties</label>
              <div className="properties-table">
                  {classProperties.map((prop, index) => (
                      <div key={index} className="property-row">
                          <input
                              type="text"
                              placeholder="Key"
                              value={prop.key}
                              onChange={(e) => handlePropertyChange(index, 'key', e.target.value)}
                          />
                          <input
                              type="text"
                              placeholder="Value"
                              value={prop.value}
                              onChange={(e) => handlePropertyChange(index, 'value', e.target.value)}
                          />
                          <button type="button" onClick={() => removePropertyRow(index)}>Remove</button>
                      </div>
                  ))}
              </div>
              <button type="button" onClick={addPropertyRow}>Add Property</button>
          </div>

          <div className="form-group">
              <label>Student-specific Properties (via CSV)</label>
              <p className="input-hint">
                  Upload a CSV with `StudentEmail` as the first column header. The system will process it in the background.
              </p>
              <div className="csv-buttons">
                  <button type="button" onClick={handleDownloadStudentTemplate}>Download Existing Properties</button>
                  {downloadProps && (
                    <CSVLink
                        headers={downloadProps.headers}
                        data={downloadProps.data}
                        filename={`${selectedClass}-student-properties.csv`}
                        style={{ display: "none" }}
                        ref={csvLink}
                        target="_blank"
                    />
                  )}
                  <label htmlFor="csv-upload" className="button-like-label">Upload CSV</label>
                  <input id="csv-upload" type="file" accept=".csv" onChange={handleStudentPropertiesCSVUpload} style={{ display: 'none' }} />
              </div>
          </div>

          <div className="form-group">
              <label>Recent Upload Jobs</label>
              <div className="jobs-list">
                  {propertyUploadJobs.length > 0 ? propertyUploadJobs.map(job => (
                      <div key={job.id} className="job-item">
                          <span>{job.createdAt?.toDate().toLocaleString()} - <strong>{job.status}</strong></span>
                          {(job.status === 'completed' || job.status === 'completed_with_errors') && typeof job.totalRows === 'number' && (
                            <p className="job-details" style={{ margin: '4px 0 0', fontSize: '0.9em', color: '#666' }}>
                                Processed: {job.processedCount || 0}/{job.totalRows}.
                                {job.notFoundCount > 0 && ` Not Found: ${job.notFoundCount}.`}
                            </p>
                          )}
                          {job.error && <p className="error-message">{job.error}</p>}
                      </div>
                  )) : <p>No recent uploads.</p>}
              </div>
          </div>

          <button onClick={handleSaveProperties}>Save Properties</button>
          <hr />
          <h3>Manage Selected Class</h3>
          <button onClick={handleDeleteClass}>Delete Class</button>
        </div>
      )}
    </div>
  );
};

export default ClassManagement;
