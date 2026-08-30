import { useState, useEffect } from 'react';
import VideoPromptSelector from './VideoPromptSelector';
import { doc, getDoc, setDoc, updateDoc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../firebase-config';
import './ClassManagement.css';
import Modal from './Modal';
import CustomPropertiesManager from './CustomPropertiesManager';
import ScheduleManager from './ScheduleManager';

const ClassManagement = ({ user, embeddedClassId }) => {
  const [classId, setClassId] = useState(embeddedClassId || '');
  const [className, setClassName] = useState('');
  const [studentEmails, setStudentEmails] = useState('');
  const [teacherEmails, setTeacherEmails] = useState('');
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(embeddedClassId || null);

  // Class settings state
  const [storageLimit, setStorageLimit] = useState('5'); // In GB
  const [retentionDays, setRetentionDays] = useState('30'); // In Days (Screenshots)
  const [videoRetentionDays, setVideoRetentionDays] = useState('90'); // In Days (Videos)
  const [scheduleStartDate, setScheduleStartDate] = useState('');
  const [scheduleEndDate, setScheduleEndDate] = useState('');
  const [timeZone, setTimeZone] = useState('Asia/Hong_Kong');
  const [classSchedules, setClassSchedules] = useState([]);

  const [ipRestrictions, setIpRestrictions] = useState('');
  const [automaticCapture, setAutomaticCapture] = useState(false);
  const [automaticCombine, setAutomaticCombine] = useState(false);
  const [captureMode, setCaptureMode] = useState('dual');
  const [aiModel, setAiModel] = useState('gemini-3.5-flash-lite');
  const [requireFullScreenOnly, setRequireFullScreenOnly] = useState(true);
  const [aiMonitoringMode, setAiMonitoringMode] = useState('hybrid');
  const [faceDebounceSeconds, setFaceDebounceSeconds] = useState(3);
  const [enableClientAi, setEnableClientAi] = useState(true);
  const [gazeSensitivity, setGazeSensitivity] = useState('standard');
  const [customYawAngle, setCustomYawAngle] = useState(25);
  const [customPitchDownAngle, setCustomPitchDownAngle] = useState(-22);
  const [customPitchUpAngle, setCustomPitchUpAngle] = useState(26);
  const [enableCloudFallback, setEnableCloudFallback] = useState(false);
  const [cloudFallbackRate, setCloudFallbackRate] = useState(3);
  
  // Audio Monitoring settings
  const [enableAudioCapture, setEnableAudioCapture] = useState(false);
  const [audioCaptureMode, setAudioCaptureMode] = useState('mandatory');
  const [audioSegmentDuration, setAudioSegmentDuration] = useState(30);
  const [audioSilenceSuppression, setAudioSilenceSuppression] = useState(true);
  const [enableSegmentTranscription, setEnableSegmentTranscription] = useState(false);
  const [enableCombinedLongAudio, setEnableCombinedLongAudio] = useState(false);
  const [audioMovingWindowDuration, setAudioMovingWindowDuration] = useState(30);
  const [audioMovingWindowStride, setAudioMovingWindowStride] = useState(15);
  
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [afterClassVideoPrompt, setAfterClassVideoPrompt] = useState(null);
  
  // Temp state for modal editing
  const [modalPrompt, setModalPrompt] = useState(null);
  const [modalPromptText, setModalPromptText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (embeddedClassId) {
      setSelectedClass(embeddedClassId);
      setClassId(embeddedClassId);
    }
  }, [embeddedClassId]);

  useEffect(() => {
    if (!user || embeddedClassId) return;

    const userProfileRef = doc(db, "teacherProfiles", user.uid);
    const unsubscribe = onSnapshot(userProfileRef, (profileSnap) => {
      if (profileSnap.exists()) {
        const profileData = profileSnap.data();
        const classIds = profileData.classes || [];
        const classesData = classIds.map(id => ({ id }));
        setClasses(classesData);
      } else {
        setClasses([]);
      }
    });

    return () => unsubscribe();
  }, [user, embeddedClassId]);

  useEffect(() => {
    const fetchClassDetails = async () => {
      const activeId = embeddedClassId || selectedClass;
      if (activeId) {
        const classRef = doc(db, 'classes', activeId);
        const classSnap = await getDoc(classRef);
        if (classSnap.exists()) {
          const classData = classSnap.data();
          setClassId(activeId);
          setClassName(classData.name || '');
          setRetentionDays((classData.retentionDays || 30).toString());
          setVideoRetentionDays((classData.videoRetentionDays || 90).toString());
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
          setCaptureMode(classData.captureMode || 'dual');
          setAiModel(classData.aiModel || 'gemini-3.5-flash-lite');
          setRequireFullScreenOnly(classData.requireFullScreenOnly !== false);
          setFaceDebounceSeconds(classData.faceDebounceSeconds || 3);
          
          let derivedMode = classData.aiMonitoringMode;
          if (!derivedMode) {
            if (classData.enableClientAi === false && !classData.enableCloudFallback) derivedMode = 'disabled';
            else if (classData.enableClientAi === false && classData.enableCloudFallback) derivedMode = 'cloud_only';
            else if (classData.enableClientAi !== false && !classData.enableCloudFallback) derivedMode = 'client_only';
            else derivedMode = 'hybrid';
          }
          setAiMonitoringMode(derivedMode);
          setEnableClientAi(derivedMode === 'hybrid' || derivedMode === 'client_only');
          setEnableCloudFallback(derivedMode === 'hybrid' || derivedMode === 'cloud_only');

          setGazeSensitivity(classData.gazeSensitivity || 'standard');
          setCustomYawAngle(classData.customYawAngle !== undefined ? classData.customYawAngle : 25);
          setCustomPitchDownAngle(classData.customPitchDownAngle !== undefined ? classData.customPitchDownAngle : -22);
          setCustomPitchUpAngle(classData.customPitchUpAngle !== undefined ? classData.customPitchUpAngle : 26);
          setCloudFallbackRate(classData.cloudFallbackRate || 3);
          setAfterClassVideoPrompt(classData.afterClassVideoPrompt || null);
          setEnableAudioCapture(classData.enableAudioCapture || false);
          setAudioCaptureMode(classData.audioCaptureMode || 'mandatory');
          setAudioSegmentDuration(classData.audioSegmentDuration || 30);
          setAudioSilenceSuppression(classData.audioSilenceSuppression !== false);
          setEnableSegmentTranscription(classData.enableSegmentTranscription || false);
          setEnableCombinedLongAudio(classData.enableCombinedLongAudio || false);
          setAudioMovingWindowDuration(classData.audioMovingWindowDuration || 30);
          setAudioMovingWindowStride(classData.audioMovingWindowStride || 15);
        } else {
          if (!embeddedClassId) {
            alert(`Could not find data for class: ${activeId}.`);
            setSelectedClass(null);
          }
        }
      } else {
        // Reset form if no class is selected
        setClassId('');
        setClassName('');
        setStorageLimit('5');
        setRetentionDays('30');
        setVideoRetentionDays('90');
        setScheduleStartDate('');
        setScheduleEndDate('');
        setTimeZone('Asia/Hong_Kong');
        setClassSchedules([]);
        setTeacherEmails('');
        setStudentEmails('');
        setIpRestrictions('');
        setAutomaticCapture(false);
        setAutomaticCombine(false);
        setCaptureMode('dual');
        setRequireFullScreenOnly(true);
        setFaceDebounceSeconds(3);
        setEnableCloudFallback(false);
        setEnableAudioCapture(false);
        setAudioCaptureMode('mandatory');
        setAudioSegmentDuration(30);
        setAudioSilenceSuppression(true);
        setCloudFallbackRate(3);
        setAfterClassVideoPrompt(null);
      }
    };
    fetchClassDetails();
  }, [selectedClass, embeddedClassId]);

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
    if (id.includes('/')) {
      return 'Class ID cannot contain slashes.';
    }
    return null;
  };

  const handleImportEmailsFromFile = (event, type = 'students') => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result || '';
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const matchedEmails = content.match(emailRegex) || [];
      const cleanUnique = [...new Set(matchedEmails.map(email => email.trim().toLowerCase()))];

      if (cleanUnique.length === 0) {
        alert('No valid email addresses found in the uploaded file.');
        return;
      }

      if (type === 'students') {
        const existing = studentEmails.split(/[\n,]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
        const merged = [...new Set([...existing, ...cleanUnique])];
        setStudentEmails(merged.join('\n'));
        alert(`Successfully imported ${cleanUnique.length} student email(s)!`);
      } else {
        const existing = teacherEmails.replace(/\n/g, ' ').split(/[, ]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
        const merged = [...new Set([...existing, ...cleanUnique])];
        setTeacherEmails(merged.join('\n'));
        alert(`Successfully imported ${cleanUnique.length} teacher email(s)!`);
      }
      event.target.value = '';
    };
    reader.readAsText(file);
  };

  const handleExportEmailsToCSV = (type = 'students') => {
    const emails = type === 'students'
      ? studentEmails.split(/[\n,]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
      : teacherEmails.replace(/\n/g, ' ').split(/[, ]+/).map(s => s.trim().toLowerCase()).filter(Boolean);

    if (emails.length === 0) {
      alert(`No ${type} emails to export.`);
      return;
    }

    const header = type === 'students' ? 'StudentEmail,ClassID\n' : 'TeacherEmail,ClassID\n';
    const rows = emails.map(email => `"${email}","${classId || 'class'}"`).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(classId || 'class').toLowerCase()}_${type}_roster.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleUpdateClass = async () => {
    const targetClassId = (classId || '').trim().toLowerCase();
    const validationError = validateClassId(targetClassId);
    if (validationError) {
      setError(validationError);
      return;
    }

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

    setError(null);
    setSuccessMessage('');
    setSaving(true);

    const classRef = doc(db, 'classes', targetClassId);
    const classSnap = await getDoc(classRef);
    const studentEmailList = studentEmails
      .split(/[\n,]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    
    const teacherEmailList = teacherEmails
      .replace(/\n/g, ' ')
      .split(/[, ]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);

    const storageQuotaBytes = parseInt(storageLimit) * 1024 * 1024 * 1024;
    const retentionDaysNum = parseInt(retentionDays, 10) > 0 ? parseInt(retentionDays, 10) : 30;
    const videoRetentionDaysNum = parseInt(videoRetentionDays, 10) > 0 ? parseInt(videoRetentionDays, 10) : 90;
    const ipList = ipRestrictions.split('\n').map(ip => ip.trim()).filter(Boolean);

    try {
      if (classSnap.exists()) {
        const updatedTeachers = [auth.currentUser.email, ...teacherEmailList];
        const uniqueTeachers = [...new Set(updatedTeachers.map(e => e.trim().toLowerCase()).filter(Boolean))];

        const updateData = {
          name: className.trim() || targetClassId,
          storageQuota: storageQuotaBytes,
          retentionDays: retentionDaysNum,
          videoRetentionDays: videoRetentionDaysNum,
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
          captureMode: captureMode || 'dual',
          aiModel: aiModel || 'gemini-3.5-flash-lite',
          requireFullScreenOnly: requireFullScreenOnly !== false,
          faceDebounceSeconds: parseInt(faceDebounceSeconds, 10) || 3,
          aiMonitoringMode: aiMonitoringMode || 'hybrid',
          enableClientAi: aiMonitoringMode === 'hybrid' || aiMonitoringMode === 'client_only',
          gazeSensitivity: gazeSensitivity || 'standard',
          customYawAngle: parseInt(customYawAngle, 10) || 25,
          customPitchDownAngle: parseInt(customPitchDownAngle, 10) || -22,
          customPitchUpAngle: parseInt(customPitchUpAngle, 10) || 26,
          enableCloudFallback: aiMonitoringMode === 'hybrid' || aiMonitoringMode === 'cloud_only',
          cloudFallbackRate: parseInt(cloudFallbackRate, 10) || 3,
          afterClassVideoPrompt: afterClassVideoPrompt || null,
          enableAudioCapture: enableAudioCapture || false,
          audioCaptureMode: audioCaptureMode || 'mandatory',
          audioSegmentDuration: parseInt(audioSegmentDuration, 10) || 30,
          audioSilenceSuppression: audioSilenceSuppression !== false,
          enableSegmentTranscription: enableSegmentTranscription || false,
          enableCombinedLongAudio: enableCombinedLongAudio || false,
          audioMovingWindowDuration: parseInt(audioMovingWindowDuration, 10) || 30,
          audioMovingWindowStride: parseInt(audioMovingWindowStride, 10) || 15,
        };
        await updateDoc(classRef, updateData);
        setSuccessMessage('Class settings successfully updated!');
      } else {
        const initialTeachers = [auth.currentUser.email, ...teacherEmailList];
        const uniqueTeachers = [...new Set(initialTeachers.map(e => e.trim().toLowerCase()).filter(Boolean))];

        await setDoc(classRef, {
          name: className.trim() || targetClassId,
          teacherEmails: uniqueTeachers,
          studentEmails: studentEmailList,
          storageQuota: storageQuotaBytes,
          retentionDays: retentionDaysNum,
          videoRetentionDays: videoRetentionDaysNum,
          schedule: {
            startDate: scheduleStartDate,
            endDate: scheduleEndDate,
            timeZone: timeZone,
            timeSlots: classSchedules,
          },
          storageUsage: 0,
          ipRestrictions: ipList,
          automaticCapture: automaticCapture,
          automaticCombine: automaticCombine,
          captureMode: captureMode || 'dual',
          aiModel: aiModel || 'gemini-3.5-flash-lite',
          requireFullScreenOnly: requireFullScreenOnly !== false,
          faceDebounceSeconds: parseInt(faceDebounceSeconds, 10) || 3,
          aiMonitoringMode: aiMonitoringMode || 'hybrid',
          enableClientAi: aiMonitoringMode === 'hybrid' || aiMonitoringMode === 'client_only',
          gazeSensitivity: gazeSensitivity || 'standard',
          customYawAngle: parseInt(customYawAngle, 10) || 25,
          customPitchDownAngle: parseInt(customPitchDownAngle, 10) || -22,
          customPitchUpAngle: parseInt(customPitchUpAngle, 10) || 26,
          enableCloudFallback: aiMonitoringMode === 'hybrid' || aiMonitoringMode === 'cloud_only',
          cloudFallbackRate: parseInt(cloudFallbackRate, 10) || 3,
          afterClassVideoPrompt: afterClassVideoPrompt || null,
          enableAudioCapture: enableAudioCapture || false,
          audioCaptureMode: audioCaptureMode || 'mandatory',
          audioSegmentDuration: parseInt(audioSegmentDuration, 10) || 30,
          audioSilenceSuppression: audioSilenceSuppression !== false,
          enableSegmentTranscription: enableSegmentTranscription || false,
          enableCombinedLongAudio: enableCombinedLongAudio || false,
          audioMovingWindowDuration: parseInt(audioMovingWindowDuration, 10) || 30,
          audioMovingWindowStride: parseInt(audioMovingWindowStride, 10) || 15,
          aiQuota: 50,
          aiUsedQuota: 0,
        });

        setSuccessMessage('Class successfully created!');
        if (!embeddedClassId) {
          setClasses(prev => [...prev, { id: targetClassId }]);
          setSelectedClass(targetClassId);
        }
      }
    } catch (err) {
      console.error('Error updating or creating class:', err);
      setError(err.message || 'Failed to save class.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClass = async () => {
    const activeId = embeddedClassId || selectedClass;
    if (!activeId) {
      alert('Please select a class to delete.');
      return;
    }

    if (window.confirm(`Are you sure you want to delete class "${activeId}"? This action cannot be undone.`)) {
      try {
        const classRef = doc(db, 'classes', activeId);
        await deleteDoc(classRef);
        alert('Class deleted successfully.');
        if (!embeddedClassId) {
          setSelectedClass(null);
        }
      } catch (err) {
        console.error('Error deleting class:', err);
        alert('Error deleting class: ' + err.message);
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
      {/* Video Prompt Modal */}
      <Modal show={showPromptModal} onClose={() => setShowPromptModal(false)} title="Select After-Class Video Prompt">
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button type="button" className="secondary-btn" onClick={() => { setAfterClassVideoPrompt(null); setShowPromptModal(false); }}>
            Clear Prompt
          </button>
          <button type="button" onClick={handleSetPrompt}>
            Save Prompt Selection
          </button>
        </div>
      </Modal>

      {!embeddedClassId && (
        <div className="class-management-header">
          <h2>Class Management & Configuration</h2>
        </div>
      )}

      {/* Class Selector for standalone mode */}
      {!embeddedClassId && (
        <div className="class-selector-card">
          <label htmlFor="select-class-to-manage">Select a Class to Edit or Configure:</label>
          <select
            id="select-class-to-manage"
            onChange={(e) => setSelectedClass(e.target.value)}
            value={selectedClass || ''}
          >
            <option value="">-- Create a New Class --</option>
            {classes.map(c => (
              <option key={c.id} value={c.id}>{c.id}</option>
            ))}
          </select>
        </div>
      )}

      {error && <div className="error-message">⚠️ {error}</div>}
      {successMessage && <div className="success-message">✓ {successMessage}</div>}

      {/* Section 1: Basic Information & Storage */}
      <div className="settings-section-card">
        <h3>📋 1. Basic Information & Storage Quota</h3>
        
        <div className="form-row-2col">
          <div className="form-group">
            <label>Class ID / Course Code <span style={{ color: '#ef4444' }}>*</span></label>
            <input
              type="text"
              placeholder="e.g. it114115-2026-s1"
              value={classId}
              onChange={(e) => setClassId(e.target.value.toLowerCase())}
              disabled={!!selectedClass || !!embeddedClassId}
            />
            <p className="input-hint">Unique identifier, lowercase.</p>
          </div>

          <div className="form-group">
            <label>Class Display Name</label>
            <input
              type="text"
              placeholder="e.g. Cloud Architecture Lab"
              value={className}
              onChange={(e) => setClassName(e.target.value)}
            />
          </div>
        </div>

        <div className="form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <div className="form-group">
            <label>Storage Limit Allotment</label>
            <select value={storageLimit} onChange={(e) => setStorageLimit(e.target.value)}>
              <option value="5">5 GB (Standard)</option>
              <option value="10">10 GB (Extended)</option>
              <option value="20">20 GB (Large Course)</option>
            </select>
            <p className="input-hint">Maximum storage cap for this class.</p>
          </div>

          <div className="form-group">
            <label>Screenshot Retention (Days)</label>
            <select value={retentionDays} onChange={(e) => setRetentionDays(e.target.value)}>
              <option value="7">7 Days (Short Workshop)</option>
              <option value="14">14 Days (Standard)</option>
              <option value="30">30 Days (1 Month)</option>
              <option value="60">60 Days (2 Months)</option>
              <option value="90">90 Days (1 Semester)</option>
              <option value="180">180 Days (Half Year)</option>
              <option value="365">365 Days (1 Year)</option>
            </select>
            <p className="input-hint">Raw screen capture frames older than this are recycled.</p>
          </div>

          <div className="form-group">
            <label>Video Retention (Days)</label>
            <select value={videoRetentionDays} onChange={(e) => setVideoRetentionDays(e.target.value)}>
              <option value="14">14 Days (2 Weeks)</option>
              <option value="30">30 Days (1 Month)</option>
              <option value="60">60 Days (2 Months)</option>
              <option value="90">90 Days (1 Semester)</option>
              <option value="180">180 Days (Half Year)</option>
              <option value="365">365 Days (1 Year)</option>
              <option value="730">730 Days (2 Years)</option>
            </select>
            <p className="input-hint">Compiled lesson playback videos (.mp4) retention period.</p>
          </div>
        </div>
      </div>

      {/* Section 2: Timetable & Schedule */}
      <div className="settings-section-card">
        <h3>📅 2. Class Timetable & Schedule</h3>
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
      </div>

      {/* Section 3: Student Roster & Properties */}
      <div className="settings-section-card">
        <h3>👥 3. Student Roster</h3>
        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <label style={{ margin: 0 }}>Student Email Addresses</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <label className="btn-secondary" style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem', cursor: 'pointer', margin: 0, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                📥 Import (CSV/TXT)
                <input
                  type="file"
                  accept=".csv,.txt"
                  style={{ display: 'none' }}
                  onChange={(e) => handleImportEmailsFromFile(e, 'students')}
                />
              </label>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                onClick={() => handleExportEmailsToCSV('students')}
              >
                📤 Export CSV
              </button>
            </div>
          </div>
          <textarea
            placeholder="Enter student emails (one per line or comma separated)..."
            value={studentEmails}
            onChange={(e) => setStudentEmails(e.target.value)}
            rows="5"
          />
          <p className="input-hint">Students with these emails will gain access to this class.</p>
        </div>

        {(selectedClass || embeddedClassId) ? (
          <div style={{ marginTop: '1.25rem' }}>
            <CustomPropertiesManager selectedClass={embeddedClassId || selectedClass} studentEmails={studentEmails} />
          </div>
        ) : (
          <div style={{ marginTop: '1.25rem', padding: '0.9rem 1.25rem', backgroundColor: 'var(--color-bg-secondary, #f8fafc)', border: '1px dashed var(--color-border, #cbd5e1)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.2rem' }}>ℹ️</span>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '0.88rem', color: 'var(--color-text-main, #334155)' }}>
                Custom Student Properties & CSV Upload
              </p>
              <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted, #64748b)' }}>
                Custom class-wide properties and student CSV upload controls become available after creating and selecting this class.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Section 4: Teaching Team */}
      <div className="settings-section-card">
        <h3>👨‍🏫 4. Teaching Team (Co-Instructors)</h3>
        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <label style={{ margin: 0 }}>Co-Teacher Email Addresses</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <label className="btn-secondary" style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem', cursor: 'pointer', margin: 0, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                📥 Import (CSV/TXT)
                <input
                  type="file"
                  accept=".csv,.txt"
                  style={{ display: 'none' }}
                  onChange={(e) => handleImportEmailsFromFile(e, 'teachers')}
                />
              </label>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                onClick={() => handleExportEmailsToCSV('teachers')}
              >
                📤 Export CSV
              </button>
            </div>
          </div>
          <textarea
            placeholder="Enter co-teacher emails (one per line or space separated)..."
            value={teacherEmails}
            onChange={(e) => setTeacherEmails(e.target.value)}
            rows="3"
          />
          <p className="input-hint">Your email is automatically included as a lead instructor.</p>
        </div>
      </div>

      {/* Section 5: Automation & AI Video Prompts */}
      <div className="settings-section-card">
        <h3>🤖 5. Automation & AI Prompts</h3>
        <div className="form-group">
          <label>Default Capture Mode</label>
          <select value={captureMode} onChange={(e) => setCaptureMode(e.target.value)}>
            <option value="dual">Dual Channel (Screen + Webcam)</option>
            <option value="screen">Screen Only</option>
            <option value="webcam">Webcam Only</option>
          </select>
          <p className="input-hint">Configure which visual streams students in this class stream to the instructor.</p>
        </div>

        <div className="form-group">
          <label>Preferred Gemini AI Model</label>
          <select value={aiModel} onChange={(e) => setAiModel(e.target.value)}>
            <option value="gemini-3.5-flash-lite">⚡ Gemini 3.5 Flash-Lite (Fastest & Most Economical — $0.30 / $2.50 per 1M)</option>
            <option value="gemini-3.7-flash">🧠 Gemini 3.7 Flash (High Accuracy & Balanced — $0.75 / $3.75 per 1M)</option>
            <option value="gemini-3.7-pro">🔬 Gemini 3.7 Pro (Deep Reasoning & Analytics — $3.00 / $15.00 per 1M)</option>
          </select>
          <p className="input-hint">Default Gemini model used for live invigilation and video analyses for this class.</p>
        </div>

        <div className="form-group">
          <label className="checkbox-toggle-label">
            <input
              type="checkbox"
              checked={requireFullScreenOnly}
              onChange={(e) => setRequireFullScreenOnly(e.target.checked)}
            />
            <span>Require Entire Screen (Forbid Single Window or Tab Sharing)</span>
          </label>
          <p className="input-hint">Ensures test and exam integrity by rejecting single application windows or browser tabs and forcing students to share their entire desktop.</p>
        </div>

        <div className="form-group">
          <label>AI Face & Gaze Monitoring Mode</label>
          <select 
            value={aiMonitoringMode} 
            onChange={(e) => {
              const newMode = e.target.value;
              setAiMonitoringMode(newMode);
              setEnableClientAi(newMode === 'hybrid' || newMode === 'client_only');
              setEnableCloudFallback(newMode === 'hybrid' || newMode === 'cloud_only');
            }}
          >
            <option value="hybrid">⚡ Client-side, then fallback to Cloud (Recommended — On-device MediaPipe, fallback to Cloud Gemini)</option>
            <option value="cloud_only">☁️ Just Cloud (Periodic Cloud Gemini Vision frame inspections)</option>
            <option value="client_only">💻 Just Client-side (100% Free on-device MediaPipe, zero Cloud quota)</option>
            <option value="disabled">🚫 Disable it (Turn off all face/gaze AI monitoring)</option>
          </select>
          <p className="input-hint">
            {aiMonitoringMode === 'hybrid' && 'Runs real-time face presence and gaze tracking on student machines for free, automatically falling back to Cloud Gemini AI if a student device cannot run local AI.'}
            {aiMonitoringMode === 'cloud_only' && 'Webcam frames are analyzed periodically using Cloud Gemini Vision. Client-side MediaPipe is deactivated.'}
            {aiMonitoringMode === 'client_only' && 'Runs real-time face presence and gaze tracking exclusively on student machines. No cloud vision AI calls or quotas are consumed.'}
            {aiMonitoringMode === 'disabled' && 'Face & Gaze AI monitoring is completely deactivated for this class.'}
          </p>
        </div>

        {(aiMonitoringMode === 'hybrid' || aiMonitoringMode === 'client_only') && (
          <>
            <div className="form-group">
              <label>Gaze & Head Orientation Sensitivity</label>
              <select 
                value={gazeSensitivity} 
                onChange={(e) => setGazeSensitivity(e.target.value)}
              >
                <option value="relaxed">🟢 Relaxed / Low Sensitivity (High Tolerance — Yaw ±28°, Pitch -26°/+30°)</option>
                <option value="standard">🟡 Standard / Balanced Default (Yaw ±22°, Pitch -20°/+26°)</option>
                <option value="strict">🔴 Strict / High Sensitivity (Yaw ±16°, Pitch -16°/+22°)</option>
                <option value="custom">⚙️ Custom Manual Angles (Specify exact Yaw & Pitch degrees)</option>
              </select>
              <p className="input-hint">Controls how strictly head rotation and eye deviation off-screen trigger an incident. Use "Relaxed" if students are writing on paper desks or multi-screen setups.</p>
            </div>

            {gazeSensitivity === 'custom' && (
              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#1e293b' }}>📐 Custom Angle Limits</h4>
                
                <div className="form-group" style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Horizontal Yaw Angle Limit (Turn Left / Right)</span>
                    <strong>±{customYawAngle}°</strong>
                  </label>
                  <input 
                    type="range" 
                    min="10" 
                    max="50" 
                    value={customYawAngle} 
                    onChange={(e) => setCustomYawAngle(parseInt(e.target.value, 10))}
                    style={{ width: '100%' }}
                  />
                  <p className="input-hint">Flags student when head turns more than {customYawAngle}° left or right.</p>
                </div>

                <div className="form-group" style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Pitch Down Angle Limit (Looking Down)</span>
                    <strong>{customPitchDownAngle}°</strong>
                  </label>
                  <input 
                    type="range" 
                    min="-45" 
                    max="-10" 
                    value={customPitchDownAngle} 
                    onChange={(e) => setCustomPitchDownAngle(parseInt(e.target.value, 10))}
                    style={{ width: '100%' }}
                  />
                  <p className="input-hint">Flags student when head tilts below {customPitchDownAngle}° (e.g. looking down at lap or phones).</p>
                </div>

                <div className="form-group" style={{ marginBottom: '4px' }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Pitch Up Angle Limit (Looking Up)</span>
                    <strong>+{customPitchUpAngle}°</strong>
                  </label>
                  <input 
                    type="range" 
                    min="10" 
                    max="45" 
                    value={customPitchUpAngle} 
                    onChange={(e) => setCustomPitchUpAngle(parseInt(e.target.value, 10))}
                    style={{ width: '100%' }}
                  />
                  <p className="input-hint">Flags student when head tilts above +{customPitchUpAngle}° (looking up away from screen).</p>
                </div>
              </div>
            )}
          </>
        )}

        {aiMonitoringMode !== 'disabled' && (
          <div className="form-group">
            <label>AI Gaze & Absence Debounce Gate</label>
            <select 
              value={faceDebounceSeconds} 
              onChange={(e) => setFaceDebounceSeconds(parseInt(e.target.value, 10))}
            >
              <option value={2}>⏱️ 2s (Strict — Rapid Flagging)</option>
              <option value={3}>⏱️ 3s (Standard — Default Balanced)</option>
              <option value={5}>⏱️ 5s (Relaxed — Tolerates Brief Glances)</option>
              <option value={8}>⏱️ 8s (Very Relaxed)</option>
              <option value={10}>⏱️ 10s (High Tolerance)</option>
            </select>
            <p className="input-hint">Duration a student must continuously look away or step away from camera before registering an irregularity.</p>
          </div>
        )}

        {(aiMonitoringMode === 'hybrid' || aiMonitoringMode === 'cloud_only') && (
          <div className="form-group">
            <label>{aiMonitoringMode === 'cloud_only' ? 'Cloud AI Analysis Interval' : 'Cloud Fallback Analysis Interval'}</label>
            <select 
              value={cloudFallbackRate} 
              onChange={(e) => setCloudFallbackRate(parseInt(e.target.value, 10))}
            >
              <option value={1}>⚡ Every 1 round (~5s) — Maximum Responsiveness</option>
              <option value={2}>⚡ Every 2 rounds (~10s) — Balanced</option>
              <option value={3}>⚡ Every 3 rounds (~15s) — Default Recommended</option>
              <option value={5}>⚡ Every 5 rounds (~25s) — Quota Saver</option>
              <option value={10}>⚡ Every 10 rounds (~50s) — Low Quota Consumption</option>
            </select>
            <p className="input-hint">
              {aiMonitoringMode === 'cloud_only'
                ? 'Interval between Cloud Gemini multimodal video frame inspections.'
                : 'Analysis frequency for students whose client devices cannot run MediaPipe locally and require cloud Gemini verification.'}
            </p>
          </div>
        )}

        <div className="form-group">
          <label className="checkbox-toggle-label">
            <input
              type="checkbox"
              checked={automaticCapture}
              onChange={(e) => setAutomaticCapture(e.target.checked)}
            />
            <span>Automatic Live Capture</span>
          </label>
          <p className="input-hint">Starts capturing student screens 5 minutes before lesson starts and ends 5 minutes after.</p>
        </div>

        <div className="form-group">
          <label className="checkbox-toggle-label">
            <input
              type="checkbox"
              checked={automaticCombine}
              onChange={(e) => setAutomaticCombine(e.target.checked)}
            />
            <span>Automatic Video Compilation</span>
          </label>
          <p className="input-hint">Generates a session video recording for each student when the class concludes.</p>
        </div>

        <div className="form-group">
          <label>After-Class Video Analysis Prompt</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button type="button" className="secondary-btn" onClick={handleOpenPromptModal}>
              {afterClassVideoPrompt ? `Selected: ${afterClassVideoPrompt.name || 'Custom Prompt'}` : 'Select AI Prompt'}
            </button>
            {afterClassVideoPrompt && (
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setAfterClassVideoPrompt(null)}
                style={{ color: '#ef4444' }}
              >
                Remove
              </button>
            )}
          </div>
          {afterClassVideoPrompt && (
            <p className="input-hint" style={{ marginTop: '0.5rem' }}>
              <strong>Prompt preview:</strong> {afterClassVideoPrompt.promptText.substring(0, 120)}...
            </p>
          )}
        </div>
      </div>

      {/* Section 6: Audio & Microphone Monitoring */}
      <div className="settings-section-card">
        <h3>🎙️ 6. Audio & Microphone Monitoring</h3>
        <div className="form-group">
          <label className="checkbox-toggle-label">
            <input
              type="checkbox"
              checked={enableAudioCapture}
              onChange={(e) => setEnableAudioCapture(e.target.checked)}
            />
            <span>Enable Audio Segment Recording for this Class</span>
          </label>
          <p className="input-hint">Continuously captures and saves microphone audio chunks from connected students for acoustic invigilation.</p>
        </div>

        {enableAudioCapture && (
          <>
            <div className="form-group">
              <label>Microphone Requirement</label>
              <select value={audioCaptureMode} onChange={(e) => setAudioCaptureMode(e.target.value)}>
                <option value="mandatory">🔒 Mandatory (Students must verify and activate microphone to participate)</option>
                <option value="optional">🔓 Optional (Students can choose to enable or keep microphone muted)</option>
              </select>
              <p className="input-hint">Mandatory mode prompts student with pre-flight microphone & Speech-to-Text verification before taking the test.</p>
            </div>

            <div className="form-group">
              <label className="checkbox-toggle-label">
                <input
                  type="checkbox"
                  checked={audioSilenceSuppression}
                  onChange={(e) => setAudioSilenceSuppression(e.target.checked)}
                />
                <span>Silence Suppression (Skip uploading silent segments)</span>
              </label>
              <p className="input-hint">Automatically discards quiet chunks where no talking is detected, saving up to 80% of storage quota and network bandwidth.</p>
            </div>

            {/* Mode 1: Moving Window Real-Time Transcription */}
            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginTop: '12px' }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#1e293b' }}>
                ⚡ Mode 1: Moving Window Real-Time Transcription (gemini-3.5-transcribe)
              </h4>
              <div className="form-group">
                <label className="checkbox-toggle-label">
                  <input
                    type="checkbox"
                    checked={enableSegmentTranscription}
                    onChange={(e) => setEnableSegmentTranscription(e.target.checked)}
                  />
                  <span>Enable Moving Window Real-Time Transcription & Multi-Speaker Alerts</span>
                </label>
                <p className="input-hint">
                  Transcribes audio in rolling moving windows (50% overlap), stitching sentences seamlessly with Gemini and flagging unauthorized collaboration in real time.
                </p>
              </div>

              {enableSegmentTranscription && (
                <div className="form-row-2col" style={{ marginTop: '10px' }}>
                  <div className="form-group">
                    <label>Window Duration</label>
                    <select
                      value={audioMovingWindowDuration}
                      onChange={(e) => setAudioMovingWindowDuration(parseInt(e.target.value, 10))}
                    >
                      <option value={20}>⏱️ 20 Seconds</option>
                      <option value={30}>⏱️ 30 Seconds (Recommended Standard)</option>
                      <option value={45}>⏱️ 45 Seconds (Wider Context)</option>
                    </select>
                    <p className="input-hint">Audio chunk length analyzed by Gemini.</p>
                  </div>

                  <div className="form-group">
                    <label>Sliding Stride (Overlap)</label>
                    <select
                      value={audioMovingWindowStride}
                      onChange={(e) => setAudioMovingWindowStride(parseInt(e.target.value, 10))}
                    >
                      <option value={10}>⚡ 10s Stride (Rapid rolling updates)</option>
                      <option value={15}>⚡ 15s Stride (50% Overlap — Balanced)</option>
                      <option value={20}>⚡ 20s Stride</option>
                    </select>
                    <p className="input-hint">Interval between rolling transcript updates.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Mode 2: Full Session Combined Long Audio Diarization */}
            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginTop: '12px' }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#1e293b' }}>
                📜 Mode 2: Full Session Combined Long Audio Audit (gemini-3.5-transcribe)
              </h4>
              <div className="form-group">
                <label className="checkbox-toggle-label">
                  <input
                    type="checkbox"
                    checked={enableCombinedLongAudio}
                    onChange={(e) => setEnableCombinedLongAudio(e.target.checked)}
                  />
                  <span>Enable Full-Session Combined Audio Diarization & Chat Audit</span>
                </label>
                <p className="input-hint">
                  Stitches all audio segments at the end of class into a single master track for deep multi-speaker attribution and a holistic exam integrity audit report.
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Section 7: Security & Access Restrictions */}
      <div className="settings-section-card">
        <h3>🔒 7. Security & IP Restrictions</h3>
        <div className="form-group">
          <label>Allowed Classroom IP Addresses</label>
          <textarea
            placeholder="e.g. 202.125.10.0/24 (one per line)..."
            value={ipRestrictions}
            onChange={(e) => setIpRestrictions(e.target.value)}
            rows="3"
          />
          <p className="input-hint">Optional. If set, students can only log in from these approved IP addresses during scheduled hours.</p>
        </div>
      </div>

      {/* Save Actions Bar */}
      <div className="settings-actions-bar">
        <div>
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
            Make sure to save your changes before leaving this page.
          </span>
        </div>
        <button className="save-settings-btn" onClick={handleUpdateClass} disabled={saving}>
          {saving ? 'Saving Changes...' : (selectedClass || embeddedClassId ? 'Save Class Settings' : 'Create Class')}
        </button>
      </div>

      {/* Danger Zone */}
      {(selectedClass || embeddedClassId) && (
        <div className="danger-zone-card">
          <h3>⚠️ Danger Zone</h3>
          <p>Deleting this class permanently removes its configuration. Associated storage archives can still be managed in Data Management.</p>
          <button className="danger-btn" onClick={handleDeleteClass}>
            Delete This Class
          </button>
        </div>
      )}
    </div>
  );
};

export default ClassManagement;

