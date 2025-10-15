
import { useState } from 'react';
import './ClassManagement.css'; // Assuming styles are in ClassManagement.css

const timeZones = [
    'Asia/Hong_Kong',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'UTC',
];

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

const ScheduleManager = ({ 
    scheduleStartDate, 
    setScheduleStartDate, 
    scheduleEndDate, 
    setScheduleEndDate, 
    timeZone, 
    setTimeZone, 
    classSchedules, 
    setClassSchedules 
}) => {
  const [newSchedule, setNewSchedule] = useState({
    startTime: '',
    endTime: '',
    days: [],
  });
  const [error, setError] = useState(null);

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

  return (
    <>
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
        {error && <div className="error-message">{error}</div>}
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
    </>
  );
};

export default ScheduleManager;
