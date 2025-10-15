import { useState, useEffect } from 'react';
import VideoPromptSelector from './VideoPromptSelector';
import { doc, getDoc, setDoc, updateDoc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../firebase-config';
import './ClassManagement.css';
import Modal from './Modal';
import CustomPropertiesManager from './CustomPropertiesManager';

import ScheduleManager from './ScheduleManager';

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

  const [ipRestrictions, setIpRestrictions] = useState('');
  const [automaticCapture, setAutomaticCapture] = useState(false);
  const [automaticCombine, setAutomaticCombine] = useState(false);
  
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [afterClassVideoPrompt, setAfterClassVideoPrompt] = useState(null);
  
  // Temp state for modal editing
  const [modalPrompt, setModalPrompt] = useState(null);
  const [modalPromptText, setModalPromptText] = useState('');



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

      }
    };
    fetchClassDetails();
  }, [selectedClass]);







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

      <ScheduleManager 
        scheduleStartDate={scheduleStartDate} 
        setScheduleStartDate={setScheduleStartDate} 
        scheduleEndDate={scheduleEndDate} 
        setScheduleEndDate={setScheduleEndDate} 
        timeZone={timeZone} 
        setTimeZone={setTimeZone} 
        classSchedules={classSchedules} 
        setClassSchedules={setClassSchedules} 
      />

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
      {selectedClass && <CustomPropertiesManager selectedClass={selectedClass} studentEmails={studentEmails} />}

      <button onClick={handleUpdateClass}>Update/Create Class</button>
      {successMessage && <div className="success-message">{successMessage}</div>}
      
      {selectedClass && (
        <div className="manage-selected-class">
          <hr />
          <h3>Manage Selected Class</h3>
          <button onClick={handleDeleteClass}>Delete Class</button>
        </div>
      )}
    </div>
  );
};

export default ClassManagement;
