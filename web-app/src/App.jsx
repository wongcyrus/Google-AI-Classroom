import { useState, useEffect } from 'react';
import { auth, db } from './firebase-config';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from "firebase/firestore";
import { BrowserRouter as Router, Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';

import AuthComponent from './components/AuthComponent';
import TeacherView from './components/TeacherView';
import StudentView from './components/StudentView';
import ClassManagement from './components/ClassManagement';
import MailboxView from './components/MailboxView';
import EmailDetailView from './components/EmailDetailView';
import PromptManagement from './components/PromptManagement';
import ClassView from './components/ClassView';


import './App.css';
import hkiitLogo from './assets/HKIIT_logo_RGB_horizontal.jpg';

const App = () => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser && currentUser.emailVerified) {
        const idTokenResult = await currentUser.getIdTokenResult(true);
        setUser(currentUser);
        setRole(idTokenResult.claims.role || 'student');
      } else {
        setUser(null);
        setRole(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = () => signOut(auth);

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <Router>
      <div className="app-container">
        {user && <MainHeader onLogout={handleLogout} user={user} role={role} />}
        <main className="main-content">
          <Routes>
            <Route path="/login" element={!user ? <AuthComponent /> : <Navigate to={`/${role}`} />} />
            <Route path="/teacher" element={user && role === 'teacher' ? <TeacherView user={user} /> : <Navigate to="/login" />} />
            <Route path="/student" element={user && role === 'student' ? <StudentView user={user} /> : <Navigate to="/login" />} />
            <Route path="/class-management" element={user && role === 'teacher' ? <ClassManagement user={user} /> : <Navigate to="/login" />} />
            <Route path="/mailbox" element={user && role === 'teacher' ? <MailboxView /> : <Navigate to="/login" />} />
            <Route path="/mailbox/:emailId" element={user && role === 'teacher' ? <EmailDetailView /> : <Navigate to="/login" />} />
            <Route path="/manage-prompts" element={user && role === 'teacher' ? <PromptManagement /> : <Navigate to="/login" />} />

            <Route path="/class/:classId" element={user && role === 'teacher' ? <ClassView user={user} /> : <Navigate to="/login" />} />

            <Route path="*" element={<Navigate to="/login" />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
};

const MainHeader = ({ onLogout, user, role }) => {
  const location = useLocation();
  const [className, setClassName] = useState('');
  const isClassPage = location.pathname.startsWith('/class/');

  useEffect(() => {
    let classId = null;
    if (isClassPage) {
      const pathParts = location.pathname.split('/');
      if (pathParts.length > 2) {
        classId = pathParts[2];
      }
    }

    if (classId) {
      const classRef = doc(db, "classes", classId);
      getDoc(classRef).then(docSnap => {
        if (docSnap.exists()) {
          setClassName(docSnap.data().name);
        }
      });
    }
  }, [location.pathname, isClassPage]);

  let title = "Gemini AI Classroom Assistant";
  if (isClassPage) {
    const pathParts = location.pathname.split('/');
    const classId = pathParts.length > 2 ? pathParts[2] : '';
    title = `Class: ${className || classId}`;
  } else if (role === 'student') {
    title = `Student Dashboard`;
  }
  
  return (
      <header className="main-header">
          <div className="header-left">
              <img src={hkiitLogo} alt="HKIIT Logo" style={{ height: '40px' }} />
              <span className="header-title">{title}</span>
          </div>
          {role === 'teacher' && (
            <nav className="teacher-main-nav">
                <NavLink to="/teacher" end>Dashboard</NavLink>
                <NavLink to="/class-management">Class Management</NavLink>
                <NavLink to="/mailbox">Mailbox</NavLink>
                <NavLink to="/manage-prompts">Manage Prompts</NavLink>
            </nav>
          )}
          <div className="header-right">
              {user && role === 'student' && <span style={{margin: "0 10px"}}>{user.email}</span>}
              <button onClick={onLogout} className="logout-btn">Logout</button>
          </div>
      </header>
  );
}



export default App;
