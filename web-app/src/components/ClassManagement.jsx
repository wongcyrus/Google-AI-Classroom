import { useState, useEffect } from 'react';
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
} from 'firebase/firestore';
import { db, auth } from '../firebase-config';
import './ClassManagement.css';
import { Link } from 'react-router-dom';

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

const ClassManagement = ({ user }) => {
  const [classId, setClassId] = useState('');
  const [studentEmails, setStudentEmails] = useState('');
  const [error, setError] = useState(null);
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

  useEffect(() => {
    if (!user) return;

    const classesRef = collection(db, 'classes');
    const q = query(classesRef, where('teachers', 'array-contains', user.email));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const classesData = [];
      querySnapshot.forEach((doc) => {
        classesData.push({ id: doc.id, ...doc.data() });
      });
      console.log('Fetched classes:', classesData);
      setClasses(classesData);
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
          if (classData.students) {
            setStudentEmails(classData.students.join('\n'));
          } else {
            setStudentEmails('');
          }
          if (classData.ipRestrictions) {
            setIpRestrictions(classData.ipRestrictions.join('\n'));
          } else {
            setIpRestrictions('');
          }
        }
      } else {
        // Reset form if no class is selected
        setClassId('');
        setStorageLimit('5');
        setScheduleStartDate('');
        setScheduleEndDate('');
        setTimeZone('Asia/Hong_Kong');
        setClassSchedules([]);
        setStudentEmails('');
        setIpRestrictions('');
      }
    };
    fetchClassDetails();
  }, [selectedClass]);


  const validateClassId = (id) => {
    if (!id || id.length < 3 || id.length > 20) {
      return 'Class ID must be between 3 and 20 characters.';
    }
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return 'Class ID can only contain letters, numbers, and hyphens.';
    }
    return null; // No error
  };

  const handleDayToggle = (day) => {
    const days = newSchedule.days.includes(day)
      ? newSchedule.days.filter((d) => d !== day)
      : [...newSchedule.days, day];
    setNewSchedule({ ...newSchedule, days });
  };

  const addSchedule = () => {
    if (!newSchedule.startTime || !newSchedule.endTime || newSchedule.days.length === 0) {
      alert('Please provide start time, end time, and at least one day for the schedule.');
      return;
    }

    const newStart = newSchedule.startTime;
    const newEnd = newSchedule.endTime;

    if (newStart >= newEnd) {
      alert('Start time must be before end time.');
      return;
    }

    for (const existing of classSchedules) {
      const hasCommonDay = newSchedule.days.some(day => existing.days.includes(day));
      if (hasCommonDay) {
        const existingStart = existing.startTime;
        const existingEnd = existing.endTime;

        if (newStart < existingEnd && newEnd > existingStart) {
          const commonDays = newSchedule.days.filter(day => existing.days.includes(day));
          alert(`Schedule overlap detected on ${commonDays.join(', ')} with the existing schedule: ${existingStart} - ${existingEnd}.`);
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

  const handleUpdateClass = async () => {
    const validationError = validateClassId(classId);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!auth.currentUser) {
      setError('You must be logged in to manage classes.');
      return;
    }
    setError(null); // Clear previous errors

    const classRef = doc(db, 'classes', classId);
    const classSnap = await getDoc(classRef);
    const studentEmailList = studentEmails
      .replace(/\n/g, ' ')
      .split(/[, ]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);

    const storageQuotaBytes = parseInt(storageLimit) * 1024 * 1024 * 1024;
    const ipList = ipRestrictions.split('\n').map(ip => ip.trim()).filter(Boolean);

    try {
      if (classSnap.exists()) {
        // The class exists, so we update it.
        const updateData = {
          storageQuota: storageQuotaBytes,
          schedule: {
            startDate: scheduleStartDate,
            endDate: scheduleEndDate,
            timeZone: timeZone,
            timeSlots: classSchedules,
          },
          students: studentEmailList,
          ipRestrictions: ipList,
        };
        await updateDoc(classRef, updateData);
        console.log('Successfully updated the class!');
      } else {
        // The class does not exist, so create it with the current user as the teacher.
        await setDoc(classRef, {
          teachers: [auth.currentUser.email],
          students: studentEmailList,
          storageQuota: storageQuotaBytes,
          schedule: {
            startDate: scheduleStartDate,
            endDate: scheduleEndDate,
            timeZone: timeZone,
            timeSlots: classSchedules,
          },
          storageUsage: 0, // Initialize storage usage
          ipRestrictions: ipList,
        });
        console.log('Successfully created the class!');
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

    if (
      window.confirm(
        `Are you sure you want to delete the class "${selectedClass}"? This action cannot be undone.`
      )
    ) {
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

  return (
    <div className="class-management-container">
      <h2>Class Management</h2>

      <h3>Select a Class to Manage or Create a New One</h3>
      <select onChange={(e) => setSelectedClass(e.target.value)} value={selectedClass || ''}>
        <option value="" disabled>Select a class to edit</option>
        {classes.map(c => (
          <option key={c.id} value={c.id}>{c.id}</option>
        ))}
      </select>
      <p>To create a new class, type a new Class ID below and fill out the details.</p>

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
                <input type="date" value={scheduleEndDate} onChange={(e) => setScheduleEndDate(e.target.value)} />
            </div>
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
                <span>{schedule.days.join(', ')}: {schedule.startTime} - {schedule.endTime}</span>
                <button type="button" onClick={() => removeSchedule(index)}>Remove</button>
              </div>
            ))}
        </div>
        <div className="add-schedule">
          <input type="time" value={newSchedule.startTime} onChange={(e) => setNewSchedule({...newSchedule, startTime: e.target.value})} />
          <input type="time" value={newSchedule.endTime} onChange={(e) => setNewSchedule({...newSchedule, endTime: e.target.value})} />
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
          <button type="button" onClick={addSchedule}>Add Schedule</button>
        </div>
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

      <div className="form-group">
        <label>Student Emails</label>
        <textarea
          placeholder="Add student emails (one per line)"
          value={studentEmails}
          onChange={(e) => setStudentEmails(e.target.value)}
          rows="6"
        />
      </div>
      <button onClick={handleUpdateClass}>Update/Create Class</button>
      
      {selectedClass && (
        <div className="manage-selected-class">
          <hr />
          <h3>Manage Selected Class</h3>
          <button onClick={handleDeleteClass}>Delete Class</button>
          <Link to={`/data-management/${selectedClass}`} style={{ marginLeft: '10px' }}>
              <button>Data Management</button>
          </Link>
        </div>
      )}
    </div>
  );
};

export default ClassManagement;