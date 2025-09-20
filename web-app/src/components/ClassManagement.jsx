
import { useState, useEffect } from 'react';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  collection,
  onSnapshot,
  query,
  where,
  deleteDoc,
} from 'firebase/firestore';
import { db, auth } from '../firebase-config';
import './ClassManagement.css';
import { Link } from 'react-router-dom';

const ClassManagement = ({ user }) => {
  const [classId, setClassId] = useState('');
  const [studentEmails, setStudentEmails] = useState('');
  const [error, setError] = useState(null);
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);

  useEffect(() => {
    if (!user) return;

    const classesRef = collection(db, 'classes');
    const q = query(classesRef, where('teachers', 'array-contains', user.email));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const classesData = [];
      querySnapshot.forEach((doc) => {
        classesData.push({ id: doc.id, ...doc.data() });
      });
      setClasses(classesData);
    });

    return () => unsubscribe();
  }, [user]);

  const validateClassId = (id) => {
    if (!id || id.length < 3 || id.length > 20) {
      return 'Class ID must be between 3 and 20 characters.';
    }
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return 'Class ID can only contain letters, numbers, and hyphens.';
    }
    return null; // No error
  };

  const handleUpdateClass = async () => {
    const validationError = validateClassId(classId);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!auth.currentUser) {
      setError('You must be logged in to manage classes.');
      return;
    }
    setError(null); // Clear previous errors

    const classRef = doc(db, 'classes', classId);
    const classSnap = await getDoc(classRef);
    const studentEmailList = studentEmails
      .split(/[\n, ]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);

    try {
      if (classSnap.exists()) {
        // The class exists, so we only add new students.
        await updateDoc(classRef, {
          students: arrayUnion(...studentEmailList),
        });
        console.log('Successfully added students to the class!');
      } else {
        // The class does not exist, so create it with the current user as the teacher.
        await setDoc(classRef, {
          teachers: [auth.currentUser.email],
          students: studentEmailList,
        });
        console.log('Successfully created the class!');
      }
    } catch (error) {
      console.error('Error updating or creating class: ', error);
      setError(error.message);
    }
  };

  const handleDeleteClass = async () => {
    if (!selectedClass) {
      alert('Please select a class to delete.');
      return;
    }

    if (
      window.confirm(
        `Are you sure you want to delete the class "${selectedClass}"? This action cannot be undone.`
      )
    ) {
      try {
        const classRef = doc(db, 'classes', selectedClass);
        await deleteDoc(classRef);

        // Note: The cleanup of the student's class subcollection is removed for now
        // to prevent crashes and will be addressed in a future update.

        setSelectedClass(null); // Reset selection
        console.log('Class deleted successfully.');
      } catch (error) {
        console.error('Error deleting class: ', error);
        alert('Error deleting class: ' + error.message);
      }
    }
  };

  return (
    <div className="class-management-container">
      <h2>Class Management</h2>
      <input
        type="text"
        placeholder="Class ID"
        value={classId}
        onChange={(e) => setClassId(e.target.value)}
      />
      {error && <div className="error-message">{error}</div>}
      <textarea
        placeholder="Student emails (one per line)"
        value={studentEmails}
        onChange={(e) => setStudentEmails(e.target.value)}
      />
      <button onClick={handleUpdateClass}>Update/Create Class</button>
      <hr />
      <h3>Select a Class to Manage</h3>
        <select onChange={(e) => setSelectedClass(e.target.value)} value={selectedClass || ''}>
          <option value="" disabled>Select a class</option>
          {classes.map(c => (
            <option key={c.id} value={c.id}>{c.id}</option>
          ))}
        </select>
        {selectedClass && (
          <>
            <button onClick={handleDeleteClass} style={{ marginLeft: '10px' }}>Delete Class</button>
            <Link to={`/data-management/${selectedClass}`} style={{ marginLeft: '10px' }}>
                <button>Data Management</button>
            </Link>
          </>
        )}
    </div>
  );
};

export default ClassManagement;
