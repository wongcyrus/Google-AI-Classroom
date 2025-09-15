
import { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase-config';
import { signOut } from 'firebase/auth';
import StudentScreen from './StudentScreen';

const TeacherView = () => {
  const [students, setStudents] = useState([]);

  useEffect(() => {
    const q = collection(db, 'students');
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const studentsData = [];
      querySnapshot.forEach((doc) => {
        studentsData.push({ id: doc.id, ...doc.data() });
      });
      setStudents(studentsData);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = () => {
    signOut(auth);
  };

  return (
    <div>
      <h1>Teacher View</h1>
      <div className="student-screens">
        {students.map(student => (
          <StudentScreen key={student.id} student={student} />
        ))}
      </div>
      <button onClick={handleLogout}>Logout</button>
    </div>
  );
};

export default TeacherView;
