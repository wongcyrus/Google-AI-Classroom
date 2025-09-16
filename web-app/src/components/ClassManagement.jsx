
import { useState } from 'react';
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../firebase-config';
import './ClassManagement.css';

const ClassManagement = () => {
  const [classId, setClassId] = useState('');
  const [studentEmails, setStudentEmails] = useState('');
  const [error, setError] = useState(null);

  const validateClassId = (id) => {
    if (!id || id.length < 3 || id.length > 20) {
      return "Class ID must be between 3 and 20 characters.";
    }
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return "Class ID can only contain letters, numbers, and hyphens.";
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
        setError("You must be logged in to manage classes.");
        return;
    }
    setError(null); // Clear previous errors

    const classRef = doc(db, 'classes', classId);
    const classSnap = await getDoc(classRef);
    const studentEmailList = studentEmails.split('\n').map(email => email.trim()).filter(Boolean);

    try {
        if (classSnap.exists()) {
            // The class exists, so we only add new students.
            await updateDoc(classRef, { students: arrayUnion(...studentEmailList) });
            console.log('Successfully added students to the class!');
        } else {
            // The class does not exist, so create it with the current user as the teacher.
            await setDoc(classRef, { 
                teachers: [auth.currentUser.email], 
                students: studentEmailList 
            });
            console.log('Successfully created the class!');
        }
    } catch (error) {
        console.error("Error updating or creating class: ", error);
        setError(error.message);
    }
  };

  return (
    <div className="class-management-container">
      <h2>Class Management</h2>
      <input
        type="text"
        placeholder="Class ID"
        value={classId}
        onChange={e => setClassId(e.target.value)}
      />
      {error && <div className="error-message">{error}</div>}
      <textarea
        placeholder="Student emails (one per line)"
        value={studentEmails}
        onChange={e => setStudentEmails(e.target.value)}
      />
      <button onClick={handleUpdateClass}>Update/Create Class</button>
    </div>
  );
};

export default ClassManagement;
