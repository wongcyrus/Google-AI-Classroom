
import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, deleteDoc, writeBatch, updateDoc, query, where } from 'firebase/firestore';
import { db, auth } from '../firebase-config';
import { signOut } from 'firebase/auth';
import StudentScreen from './StudentScreen';
import ClassManagement from './ClassManagement';
import { Link } from 'react-router-dom';

const TeacherView = ({ user }) => {
  const [allStudents, setAllStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [classList, setClassList] = useState([]);

  useEffect(() => {
    if (!user) return;

    const classesRef = collection(db, "classes");
    const q = query(classesRef, where("teachers", "array-contains", user.email));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const classesData = [];
      querySnapshot.forEach((doc) => {
        classesData.push({ id: doc.id, ...doc.data() });
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

  const handleDeleteClass = async () => {
    if (!selectedClass) {
      alert("Please select a class to delete.");
      return;
    }

    if (window.confirm(`Are you sure you want to delete the class "${selectedClass}"? This action cannot be undone.`)) {
      try {
        const classRef = doc(db, "classes", selectedClass);
        
        // Also delete the class from the students' subcollection
        const batch = writeBatch(db);
        const studentsInClass = classList; // from state
        
        for (const studentEmail of studentsInClass) {
            const student = allStudents.find(s => s.email === studentEmail);
            if (student) {
                const studentClassRef = doc(db, `students/${student.id}/classes`, selectedClass);
                batch.delete(studentClassRef);
            }
        }
        
        batch.delete(classRef);
        await batch.commit();

        setSelectedClass(null); // Reset selection
        console.log("Class deleted successfully.");

      } catch (error) {
        console.error("Error deleting class: ", error);
        alert("Error deleting class: " + error.message);
      }
    }
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
        {selectedClass && (
          <>
            <button onClick={handleDeleteClass} style={{ marginLeft: '10px' }}>Delete Class</button>
            <Link to={`/monitor/${selectedClass}`}>
                <button style={{ marginLeft: '10px' }}>Monitor</button>
            </Link>
          </>
        )}
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
