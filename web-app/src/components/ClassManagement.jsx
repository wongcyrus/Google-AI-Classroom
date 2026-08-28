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
          setAfterClassVideoPrompt(classData.afterClassVideoPrompt || null);
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
          afterClassVideoPrompt: afterClassVideoPrompt || null,
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
          afterClassVideoPrompt: afterClassVideoPrompt || null,
          aiQuota: 10,
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

        {(selectedClass || embeddedClassId) && (
          <div style={{ marginTop: '1.25rem' }}>
            <label style={{ fontWeight: '600', display: 'block', marginBottom: '0.5rem' }}>
              Custom Student Properties (CSV Upload / Edit):
            </label>
            <CustomPropertiesManager selectedClass={embeddedClassId || selectedClass} studentEmails={studentEmails} />
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

      {/* Section 6: Security & Access Restrictions */}
      <div className="settings-section-card">
        <h3>🔒 6. Security & IP Restrictions</h3>
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

