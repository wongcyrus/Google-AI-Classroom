import React from 'react';
import './DateRangeFilter.css';

const DateRangeFilter = ({ startTime, endTime, onStartTimeChange, onEndTimeChange, onSearch, loading, searchDisabled }) => {

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
      {onSearch && <button onClick={onSearch} disabled={loading || searchDisabled}>Search</button>}
    </div>
  );
};

export default DateRangeFilter;
