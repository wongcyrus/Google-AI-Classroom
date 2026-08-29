import React from 'react';
import StudentScreen from '../StudentScreen';
import './StudentsGrid.css';

const StudentsGrid = ({
  reviewTime,
  classList,
  uidToEmailMap,
  screenshots,
  frameRate,
  students,
  now,
  isPaused,
  selectedChannel = 'both',
  handleStudentClick,
}) => {
  return (
    <div className="students-container">
      {reviewTime
        ? classList.sort((a, b) => a.localeCompare(b)).map(studentUid => {
            const email = uidToEmailMap.get(studentUid) || studentUid;
            const student = { id: studentUid, email };

            const screenshotData = screenshots[studentUid];
            let isFresh = false;
            if (screenshotData && screenshotData.timestamp) {
                const screenshotTime = screenshotData.timestamp.toDate ? screenshotData.timestamp.toDate() : new Date(screenshotData.timestamp);
                const reviewTimeDate = new Date(reviewTime);
                const secondsDiff = (reviewTimeDate.getTime() - screenshotTime.getTime()) / 1000;
                if (secondsDiff >= 0 && secondsDiff < frameRate) {
                  isFresh = true;
                }
            }

            return (
              <StudentScreen
                key={studentUid}
                student={student}
                isSharing={isFresh || !!screenshotData}
                screenshotData={screenshotData}
                screenshotUrl={screenshotData?.url}
                selectedChannel={selectedChannel}
                onClick={() => handleStudentClick(student)}
              />
            );
          })
        : students.filter(student => student.isSharing).sort((a, b) => a.email.localeCompare(b.email)).map(student => {
            const screenshotData = screenshots[student.id];
            let isFresh = false;

            if (screenshotData && screenshotData.timestamp) {
              const screenshotTime = screenshotData.timestamp.toDate ? screenshotData.timestamp.toDate() : new Date(screenshotData.timestamp);
              const secondsDiff = (now.getTime() - screenshotTime.getTime()) / 1000;
              if (isPaused || secondsDiff <= frameRate) {
                isFresh = true;
              }
            }

            return (
              <StudentScreen
                key={student.id}
                student={student}
                isSharing={student.isSharing}
                screenshotData={screenshotData}
                screenshotUrl={screenshotData?.url}
                selectedChannel={selectedChannel}
                onClick={() => handleStudentClick(student)}
              />
            );
          })}
    </div>
  );
};

export default StudentsGrid;
