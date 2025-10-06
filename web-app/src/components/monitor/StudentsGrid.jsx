import React from 'react';
import StudentScreen from '../StudentScreen';
import './StudentsGrid.css';

const StudentsGrid = ({
  reviewTime,
  classList,
  uidToEmailMap, // Changed from studentUidMap
  screenshots,
  frameRate,
  students,
  now,
  isPaused,
  handleStudentClick,
}) => {
  return (
    <div className="students-container">
      {reviewTime
        ? classList.sort((a, b) => a.localeCompare(b)).map(studentUid => { // Changed variable name for clarity
            const email = uidToEmailMap.current.get(studentUid) || studentUid; // Use uidToEmailMap
            const student = { id: studentUid, email };

            let screenshotUrl = null;
            const screenshotData = screenshots[studentUid]; // Use studentUid directly
            if (screenshotData && screenshotData.timestamp) {
                const screenshotTime = screenshotData.timestamp.toDate();
                const reviewTimeDate = new Date(reviewTime);
                const secondsDiff = (reviewTimeDate.getTime() - screenshotTime.getTime()) / 1000;
                if (secondsDiff >= 0 && secondsDiff < frameRate) {
                  screenshotUrl = screenshotData.url;
                }
            }

            return (
              <StudentScreen
                key={studentUid} // Use studentUid for key
                student={student}
                isSharing={!!screenshotUrl}
                screenshotUrl={screenshotUrl}
                onClick={() => handleStudentClick(student)}
              />
            );
          })
        : students.filter(student => student.isSharing).sort((a, b) => a.email.localeCompare(b.email)).map(student => {
            const screenshotData = screenshots[student.id];
            let screenshotUrl = null;

            if (screenshotData && screenshotData.timestamp) {
              const screenshotTime = screenshotData.timestamp.toDate();
              const secondsDiff = (now.getTime() - screenshotTime.getTime()) / 1000;
              if (isPaused || secondsDiff <= frameRate) {
                screenshotUrl = screenshotData.url;
              }
            }

            return (
              <StudentScreen
                key={student.id}
                student={student}
                isSharing={student.isSharing}
                screenshotUrl={screenshotUrl}
                onClick={() => handleStudentClick(student)}
              />
            );
          })}
    </div>
  );
};

export default StudentsGrid;
