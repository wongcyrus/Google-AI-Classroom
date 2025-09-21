
import { useState, useEffect } from 'react';
import { auth, db } from './firebase-config';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import AuthComponent from './components/AuthComponent';
import TeacherView from './components/TeacherView';
import StudentView from './components/StudentView';
import MonitorView from './components/MonitorView'; // Import MonitorView
import DataManagementView from './components/DataManagementView';
import ClassManagementView from './components/ClassManagementView';
import IrregularitiesView from './components/IrregularitiesView';
import ClassView from './components/ClassView';
import Layout from './components/Layout';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import banner from './assets/HKIIT_logo_RGB_horizontal.jpg';

const App = () => {
  const [user, setUser] = useState(null);
  const [unverifiedUser, setUnverifiedUser] = useState(null);
  const [role, setRole] = useState(null); // 'teacher' or 'student'
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        await currentUser.reload();
        if (currentUser.emailVerified) {
            const idTokenResult = await currentUser.getIdTokenResult(true); // Force refresh
            const userRole = idTokenResult.claims.role || 'student'; // Default to student
            
            setUser(currentUser);
            setRole(userRole);
            setUnverifiedUser(null);
        } else {
            setUnverifiedUser(currentUser);
            setUser(null);
            setRole(null);
        }
      } else {
        setUser(null);
        setRole(null);
        setUnverifiedUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleLogout = () => {
    signOut(auth);
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <Router>
        <Layout 
            banner={banner} 
            title={title} 
            logoutButton={user && <button onClick={handleLogout} className="student-view-button">Logout</button>}
        >
        <Routes>
            <Route path="/login" element={!user ? <AuthComponent setTitle={setTitle} unverifiedUser={unverifiedUser} /> : <Navigate to={`/${role}`} />} />
            <Route path="/teacher" element={user && role === 'teacher' ? <TeacherView user={user} setTitle={setTitle} /> : <Navigate to="/login" />} />
            <Route path="/student" element={user && role === 'student' ? <StudentView user={user} setTitle={setTitle} /> : <Navigate to="/login" />} />
            <Route path="/monitor/:classId" element={user && role === 'teacher' ? <MonitorView setTitle={setTitle} /> : <Navigate to="/login" />} />
            <Route path="/data-management/:classId" element={user && role === 'teacher' ? <DataManagementView setTitle={setTitle} /> : <Navigate to="/login" />} />
            <Route path="/class-management" element={user && role === 'teacher' ? <ClassManagementView user={user} setTitle={setTitle} /> : <Navigate to="/login" />} />
            <Route path="/class/:classId" element={user && role === 'teacher' ? <ClassView user={user} setTitle={setTitle} /> : <Navigate to="/login" />} />
            <Route path="/teacher/irregularities" element={user && role === 'teacher' ? <IrregularitiesView /> : <Navigate to="/login" />} />
            <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
      </Layout>
    </Router>
  );
};

export default App;
