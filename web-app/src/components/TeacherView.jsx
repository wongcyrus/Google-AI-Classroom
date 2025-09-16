
import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, deleteDoc, query, where } from 'firebase/firestore';
import { db, auth } from '../firebase-config';
import { signOut } from 'firebase/auth';
import ClassManagement from './ClassManagement';
import { Link, Navigate } from 'react-router-dom';

const TeacherView = ({ user }) => {
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [role, setRole] = useState(null);

  useEffect(() => {
    const checkRole = async () => {
        if (user) {
            const idTokenResult = await user.getIdTokenResult(true);
            setRole(idTokenResult.claims.role);
        }
    };
    checkRole();
  }, [user]);

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
        await deleteDoc(classRef);
        
        // Note: The cleanup of the student's class subcollection is removed for now
        // to prevent crashes and will be addressed in a future update.

        setSelectedClass(null); // Reset selection
        console.log("Class deleted successfully.");

      } catch (error) {
        console.error("Error deleting class: ", error);
        alert("Error deleting class: " + error.message);
      }
    }
  };

  // This is the added security check
  if (role && role !== 'teacher') {
    return <Navigate to="/login" />;
  }

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
      <button onClick={handleLogout}>Logout</button>
    </div>
  );
};

export default TeacherView;
