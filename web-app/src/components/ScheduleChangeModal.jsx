import { useState } from 'react';
import Modal from './Modal';
import './ScheduleChangeModal.css';

/**
 * ScheduleChangeModal
 * Prompts instructors when editing a class schedule that already contains
 * completed past lessons, giving them the safe option to archive past lessons
 * into scheduleHistory and apply the new schedule starting today.
 */
const ScheduleChangeModal = ({
  show,
  onClose,
  onConfirm,
  pastLessons = [],
  existingSchedule = {},
  newSchedule = {},
}) => {
  const [selectedAction, setSelectedAction] = useState('archive_and_apply');

  if (!show) return null;

  const pastCount = pastLessons.length;
  const earliestLesson = pastLessons[pastLessons.length - 1]; // descending sort, last is earliest
  const latestLesson = pastLessons[0];

  const earliestDateStr = earliestLesson?.start
    ? new Date(earliestLesson.start).toLocaleDateString()
    : existingSchedule.startDate;
  const latestDateStr = latestLesson?.start
    ? new Date(latestLesson.start).toLocaleDateString()
    : 'recently';

  const handleConfirm = () => {
    onConfirm({
      action: selectedAction,
    });
  };

  return (
    <Modal show={show} onClose={onClose}>
      <div className="schedule-change-modal">
        <div className="schedule-change-header">
          <span className="warning-icon">📅</span>
          <h3>Class Timetable Change Safeguard</h3>
        </div>

        <div className="schedule-change-alert">
          <p>
            <strong>{pastCount} completed {pastCount === 1 ? 'lesson has' : 'lessons have'}</strong> already taken place in this class between <strong>{earliestDateStr}</strong> and <strong>{latestDateStr}</strong>.
          </p>
          <p className="sub-alert">
            Modifying dates or time slots without segmenting will recalculate past lesson boundaries, which may orphan existing attendance records, video recordings, and lesson titles.
          </p>
        </div>

        <div className="schedule-change-options">
          {/* Option 1: Recommended */}
          <label className={`option-card ${selectedAction === 'archive_and_apply' ? 'selected' : ''}`}>
            <div className="option-radio">
              <input
                type="radio"
                name="scheduleAction"
                value="archive_and_apply"
                checked={selectedAction === 'archive_and_apply'}
                onChange={() => setSelectedAction('archive_and_apply')}
              />
            </div>
            <div className="option-content">
              <div className="option-title">
                <span>🛡️ Archive Past Lessons & Apply New Timetable From Today</span>
                <span className="recommended-badge">Recommended</span>
              </div>
              <p className="option-desc">
                Preserves all {pastCount} completed lessons and their exact attendance, recordings, and custom titles in <code>scheduleHistory</code>. The new timetable will take effect starting today ({new Date().toLocaleDateString()}) without breaking previous class history.
              </p>
            </div>
          </label>

          {/* Option 2: Overwrite */}
          <label className={`option-card danger ${selectedAction === 'overwrite' ? 'selected' : ''}`}>
            <div className="option-radio">
              <input
                type="radio"
                name="scheduleAction"
                value="overwrite"
                checked={selectedAction === 'overwrite'}
                onChange={() => setSelectedAction('overwrite')}
              />
            </div>
            <div className="option-content">
              <div className="option-title">
                <span>⚠️ Overwrite Entire Schedule (Recalculate Past)</span>
              </div>
              <p className="option-desc">
                Retroactively applies the new schedule from {newSchedule.startDate || 'the start date'}. Past lesson timestamps will be recalculated according to the new slots.
              </p>
            </div>
          </label>
        </div>

        <div className="schedule-change-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={handleConfirm}>
            {selectedAction === 'archive_and_apply' ? 'Apply & Preserve History' : 'Overwrite Entire Schedule'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ScheduleChangeModal;
