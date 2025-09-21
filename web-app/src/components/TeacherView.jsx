import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, auth } from '../firebase-config';
import { signOut } from 'firebase/auth';
import { Link, Navigate } from 'react-router-dom';
import PromptManagement from './PromptManagement';

const TeacherView = ({ user, setTitle }) => {
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [role, setRole] = useState(null);
  const [showPromptModal, setShowPromptModal] = useState(false);

  useEffect(() => {
    setTitle('Teacher Dashboard');
  }, [setTitle]);

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
      classesData.sort((a, b) => a.id.localeCompare(b.id)); // Sort by class ID
      setClasses(classesData);
    });

    return () => unsubscribe();
  }, [user]);

  const handleLogout = () => {
    signOut(auth);
  };

  if (role && role !== 'teacher') {
    return <Navigate to="/login" />;
  }

  return (
    <div>
      {showPromptModal && <PromptManagement onClose={() => setShowPromptModal(false)} />}
      <div>
        <label htmlFor="class-select">Select a class to view:</label>
        <select id="class-select" onChange={(e) => setSelectedClass(e.target.value)} value={selectedClass || ''}>
          <option value="" disabled>Select a class</option>
          {classes.map(c => (
            <option key={c.id} value={c.id}>{c.id}</option>
          ))}
        </select>
        {selectedClass && (
          <Link to={`/class/${selectedClass}`}>
              <button style={{ marginLeft: '10px' }}>View Class</button>
          </Link>
        )}
      </div>
      <hr />
      <Link to="/class-management">
        <button>Class Management</button>
      </Link>
      <button onClick={() => setShowPromptModal(true)} style={{ marginLeft: '10px' }}>Manage Prompts</button>
      <hr />
      <button onClick={handleLogout}>Logout</button>
    </div>
  );
};

export default TeacherView;