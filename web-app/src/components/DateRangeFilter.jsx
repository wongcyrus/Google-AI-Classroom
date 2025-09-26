import React from 'react';
import './DateRangeFilter.css';

const DateRangeFilter = ({ startTime, endTime, onStartTimeChange, onEndTimeChange, onSearch, loading, searchDisabled, lessons, selectedLesson, onLessonChange }) => {

  const handleStartTimeChange = (e) => {
    onStartTimeChange(e.target.value);
  };

  const handleEndTimeChange = (e) => {
    onEndTimeChange(e.target.value);
  };

  return (
    <div className="date-range-filter">
      <label>From: <input type="datetime-local" value={startTime} onChange={handleStartTimeChange} disabled={loading} /></label>
      <label>To: <input type="datetime-local" value={endTime} onChange={handleEndTimeChange} disabled={loading} /></label>
      {lessons && onLessonChange && (
        <label>Lesson:
          <select value={selectedLesson} onChange={onLessonChange}>
            <option value="">Select a Lesson</option>
            {lessons.map(lesson => (
              <option key={lesson.start.toISOString()} value={lesson.start.toISOString()}>
                {lesson.start.toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      )}
      {onSearch && <button onClick={onSearch} disabled={loading || searchDisabled}>Search</button>}
    </div>
  );
};

export default DateRangeFilter;
