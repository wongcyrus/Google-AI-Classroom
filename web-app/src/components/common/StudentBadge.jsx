import React from 'react';
import { formatStudentIdentity } from '../../utils/studentDisplayUtils';
import './StudentBadge.css';

/**
 * Reusable Student Identity Badge Component.
 * 
 * Renders a friendly student name with optional cohort pill (class group),
 * programme tag, secondary email line, and descriptive tooltip.
 */
const StudentBadge = ({
  student,
  profileMap = {},
  showCohort = true,
  showProgramme = false,
  showEmail = false,
  size = 'md',
  className = '',
}) => {
  const identity = formatStudentIdentity(student, profileMap);
  const { displayName, fullName, nickname, studentClass, programme, email, hasCustomProfile } = identity;

  // Build a rich tooltip for teachers
  const tooltipParts = [];
  if (displayName) tooltipParts.push(`Name: ${displayName}`);
  if (fullName && fullName !== displayName) tooltipParts.push(`Full Name: ${fullName}`);
  if (nickname) tooltipParts.push(`Nickname: ${nickname}`);
  if (studentClass) tooltipParts.push(`Class / Cohort: ${studentClass}`);
  if (programme) tooltipParts.push(`Programme: ${programme}`);
  if (email) tooltipParts.push(`Email: ${email}`);
  const tooltip = tooltipParts.join('\n');

  return (
    <div
      className={`student-badge-container student-badge-${size} ${className} ${hasCustomProfile ? 'has-profile' : 'fallback-email'}`}
      title={tooltip}
    >
      <div className="student-badge-primary-row">
        <span className="student-badge-name">{displayName}</span>
        {showCohort && studentClass && (
          <span className="student-badge-cohort" title={`Student Cohort / Class: ${studentClass}`}>
            {studentClass}
          </span>
        )}
        {showProgramme && programme && (
          <span className="student-badge-programme" title={`Programme: ${programme}`}>
            {programme}
          </span>
        )}
      </div>

      {showEmail && email && email.toLowerCase() !== displayName.toLowerCase() && (
        <span className="student-badge-email-sub">{email}</span>
      )}
    </div>
  );
};

export default StudentBadge;
