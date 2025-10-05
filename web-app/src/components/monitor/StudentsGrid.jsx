import React from 'react';
import StudentScreen from '../StudentScreen';
import './StudentsGrid.css';

const StudentsGrid = ({
  reviewTime,
  classList,
  studentIdMap,
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
        ? classList.sort((a, b) => a.localeCompare(b)).map(email => {
            const studentId = studentIdMap.current.get(email.toLowerCase());
            const student = { id: studentId || email, email };

            let screenshotUrl = null;
            if (studentId) {
              const screenshotData = screenshots[studentId];
              if (screenshotData && screenshotData.timestamp) {
                const screenshotTime = screenshotData.timestamp.toDate();
                const reviewTimeDate = new Date(reviewTime);
                const secondsDiff = (reviewTimeDate.getTime() - screenshotTime.getTime()) / 1000;
                if (secondsDiff >= 0 && secondsDiff < frameRate) {
                  screenshotUrl = screenshotData.url;
                }
              }
            }

            return (
              <StudentScreen
                key={email}
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
