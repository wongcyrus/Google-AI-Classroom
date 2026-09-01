import React from 'react';
import StudentScreen from '../StudentScreen';
import './StudentsGrid.css';

const StudentsGrid = ({
  reviewTime,
  classList = [],
  uidToEmailMap = new Map(),
  screenshots = {},
  frameRate = 5,
  students = [],
  displayStudents,
  problemFilter = 'all',
  now = new Date(),
  isPaused = false,
  selectedChannel = 'both',
  handleStudentClick,
}) => {
  // Determine which list of students to display based on review mode or filter
  const listToRender = displayStudents !== undefined
    ? displayStudents
    : (reviewTime
        ? classList.slice().sort((a, b) => a.localeCompare(b)).map((studentUid) => {
            const email = uidToEmailMap.get(studentUid) || studentUid;
            const existingStudent = students.find((s) => s.id === studentUid);
            return existingStudent || { id: studentUid, email, isSharing: !!screenshots[studentUid] };
          })
        : (problemFilter === 'all'
            ? students.filter((student) => student.isSharing)
            : students
          )
      );

  if (listToRender.length === 0) {
    return (
      <div className="students-container">
        <div
          className="empty-filter-state"
          style={{
            gridColumn: '1 / -1',
            textAlign: 'center',
            padding: '3rem 1.5rem',
            color: '#64748b',
            fontSize: '0.95rem',
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            border: '1px dashed #cbd5e1',
            margin: '10px 0',
          }}
        >
          {problemFilter !== 'all'
            ? '✨ All students are compliant with the selected filter.'
            : 'No active student streams currently sharing.'}
        </div>
      </div>
    );
  }

  return (
    <div className="students-container">
      {listToRender
        .slice()
        .sort((a, b) => (a.email || '').localeCompare(b.email || ''))
        .map((student) => {
          const studentUid = student.id;
          const screenshotData = screenshots[studentUid];
          let isFresh = false;

          if (screenshotData && screenshotData.timestamp) {
            const screenshotTime = screenshotData.timestamp.toDate
              ? screenshotData.timestamp.toDate()
              : (screenshotData.timestamp instanceof Date ? screenshotData.timestamp : new Date(screenshotData.timestamp));
            const refTime = reviewTime ? new Date(reviewTime) : now;
            const secondsDiff = (refTime.getTime() - screenshotTime.getTime()) / 1000;
            const freshnessWindow = Math.max(frameRate * 3, 30);
            if (isPaused || (secondsDiff >= 0 && secondsDiff <= freshnessWindow)) {
              isFresh = true;
            }
          }

          const isStudentSharing = reviewTime
            ? (isFresh || !!screenshotData)
            : Boolean(student.isSharing && (isFresh || isPaused));

          return (
            <StudentScreen
              key={studentUid}
              student={student}
              isSharing={isStudentSharing}
              screenshotData={isStudentSharing || reviewTime ? screenshotData : null}
              screenshotUrl={isStudentSharing || reviewTime ? screenshotData?.url : null}
              selectedChannel={selectedChannel}
              onClick={() => handleStudentClick && handleStudentClick(student)}
            />
          );
        })}
    </div>
  );
};

export default StudentsGrid;
