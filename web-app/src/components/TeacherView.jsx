
import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc } from 'firebase/firestore';
import { db, auth } from '../firebase-config';
import { signOut } from 'firebase/auth';
import StudentScreen from './StudentScreen';
import ClassManagement from './ClassManagement';

const TeacherView = ({ user }) => {
  const [allStudents, setAllStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [classList, setClassList] = useState([]);

  useEffect(() => {
    if (!user) return;

    const classesRef = collection(db, "classes");
    const unsubscribe = onSnapshot(classesRef, (querySnapshot) => {
      const classesData = [];
      querySnapshot.forEach((doc) => {
        if (doc.data().teachers.includes(user.email)) {
            classesData.push({ id: doc.id, ...doc.data() });
        }
      });
      setClasses(classesData);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!selectedClass) {
      setClassList([]);
      return;
    }

    const classRef = doc(db, "classes", selectedClass);
    const unsubscribe = onSnapshot(classRef, (docSnap) => {
      if (docSnap.exists()) {
        setClassList(docSnap.data().students || []);
      } else {
        setClassList([]);
      }
    });
    return () => unsubscribe();
  }, [selectedClass]);

  useEffect(() => {
    const q = collection(db, 'students');
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const studentsData = [];
      querySnapshot.forEach((doc) => {
        studentsData.push({ id: doc.id, ...doc.data() });
      });
      setAllStudents(studentsData);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = () => {
    signOut(auth);
  };

  const displayedStudents = allStudents.filter(student => classList.includes(student.email));

  return (
    <div>
      <h1>Teacher View</h1>
      <ClassManagement user={user} />
      <hr />
      <div>
        <h3>Select a Class to View</h3>
        <select onChange={(e) => setSelectedClass(e.target.value)} value={selectedClass || ''}>
          <option value="" disabled>Select a class</option>
          {classes.map(c => (
            <option key={c.id} value={c.id}>{c.id}</option>
          ))}
        </select>
      </div>
      <hr />
      <div className="student-screens">
        {selectedClass && displayedStudents.map(student => (
          <StudentScreen key={student.id} student={student} classId={selectedClass} />
        ))}
      </div>
      <button onClick={handleLogout}>Logout</button>
    </div>
  );
};

export default TeacherView;
