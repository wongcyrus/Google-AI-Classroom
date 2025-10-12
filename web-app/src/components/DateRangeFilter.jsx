import React from 'react';
import './DateRangeFilter.css';

const DateRangeFilter = ({ 
  startTime, 
  endTime, 
  onStartTimeChange, 
  onEndTimeChange, 
  onSearch, 
  loading, 
  searchDisabled, 
  lessons, 
  selectedLesson, 
  onLessonChange, 
  timezone,
  filterField,
  onFilterFieldChange,
  filterFieldOptions
}) => {

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
      
      {filterFieldOptions && onFilterFieldChange && (
        <label>Filter by:
          <select value={filterField} onChange={(e) => onFilterFieldChange(e.target.value)} disabled={loading}>
            {filterFieldOptions.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      )}

      {lessons && onLessonChange && (
        <label>Lesson:
          <select value={selectedLesson} onChange={onLessonChange} disabled={loading}>
            <option value="">Select a Lesson</option>
            {lessons.map(lesson => (
              <option key={lesson.start.toISOString()} value={lesson.start.toISOString()}>
                                {`${lesson.start.toLocaleDateString()} (${lesson.start.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - ${lesson.end.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})})`}
                              </option>            ))}
          </select>
        </label>
      )}
      {onSearch && <button onClick={onSearch} disabled={loading || searchDisabled}>Search</button>}
            {timezone && timezone !== 'UTC' && <span className="timezone-display">Timezone: {timezone.replace(/_/g, ' ')}</span>}
    </div>
  );
};

export default DateRangeFilter;