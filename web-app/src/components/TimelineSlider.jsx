import React from 'react';
import './TimelineSlider.css';

const TimelineSlider = ({ min, max, value, onChange, bufferedRanges }) => {

  return (
    <div className="timeline-slider-container">
      <div className="timeline-slider-track">
        {bufferedRanges.map((range, i) => (
          <div
            key={i}
            className="timeline-slider-buffered"
            style={{
              left: `${(range.start / max) * 100}%`,
              width: `${((range.end - range.start + 1) / max) * 100}%`,
            }}
          />
        ))}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={onChange}
        className="timeline-slider"
        disabled={max === 0}
      />
    </div>
  );
};

export default TimelineSlider;
