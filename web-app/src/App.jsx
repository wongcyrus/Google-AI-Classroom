import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { auth, db } from './firebase-config';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, collection, query, where, onSnapshot } from "firebase/firestore";
import { BrowserRouter as Router, Routes, Route, Navigate, NavLink, Link, useLocation } from 'react-router-dom';

import ChangePasswordModal from './components/ChangePasswordModal';
import UnsupportedBrowserNotice from './components/UnsupportedBrowserNotice';
import { isGoogleChrome, getBrowserName } from './utils/browserDetection';
import './App.css';
import hkiitLogo from './assets/HKIIT_logo_RGB_horizontal.jpg';

// Failsafe lazy import: if a dynamic chunk fails to fetch due to a new deployment, auto-reload once
const lazyWithRetry = (componentImport) =>
  lazy(async () => {
    const pageHasBeenForceRefreshed = JSON.parse(
      window.sessionStorage.getItem('page-has-been-force-refreshed') || 'false'
    );

    try {
      const component = await componentImport();
      window.sessionStorage.setItem('page-has-been-force-refreshed', 'false');
      return component;
    } catch (error) {
      if (!pageHasBeenForceRefreshed) {
        window.sessionStorage.setItem('page-has-been-force-refreshed', 'true');
        window.location.reload();
        return { default: () => null };
      }
      throw error;
    }
  });

// Lazy-loaded route components
const AuthComponent = lazyWithRetry(() => import('./components/AuthComponent'));
const TeacherView = lazyWithRetry(() => import('./components/TeacherView'));
const StudentView = lazyWithRetry(() => import('./components/StudentView'));
const ClassManagement = lazyWithRetry(() => import('./components/ClassManagement'));
const MailboxView = lazyWithRetry(() => import('./components/MailboxView'));
const EmailDetailView = lazyWithRetry(() => import('./components/EmailDetailView'));
const PromptManagement = lazyWithRetry(() => import('./components/PromptManagement'));
const ClassView = lazyWithRetry(() => import('./components/ClassView'));

const App = () => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unsupportedStudentBrowser, setUnsupportedStudentBrowser] = useState(false);
  const [detectedBrowser, setDetectedBrowser] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser && currentUser.emailVerified) {
        let idTokenResult = await currentUser.getIdTokenResult();
        if (!idTokenResult.claims.role) {
          idTokenResult = await currentUser.getIdTokenResult(true);
        }
        const resolvedRole = idTokenResult.claims.role || 'student';

        // Enforce Google Chrome strictly for students
        if (resolvedRole === 'student' && !isGoogleChrome()) {
          const browserName = getBrowserName();
          console.warn(`[BrowserEnforcement] Student account ${currentUser.email} attempted login on non-Chrome browser (${browserName}). Forcing logout.`);
          setDetectedBrowser(browserName);
          setUnsupportedStudentBrowser(true);
          try {
            await signOut(auth);
          } catch (err) {
            console.error('Error signing out non-Chrome student:', err);
          }
          setUser(null);
          setRole(null);
          setLoading(false);
          return;
        }

        setUser(currentUser);
        setRole(resolvedRole);
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
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: '1rem', color: '#64748b' }}>
        <div style={{ width: '40px', height: '40px', border: '3px solid #e2e8f0', borderTopColor: '#4f46e5', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <span>Loading workspace...</span>
      </div>
    );
  }

  if (unsupportedStudentBrowser) {
    return (
      <UnsupportedBrowserNotice
        detectedBrowser={detectedBrowser}
        onBackToLogin={() => setUnsupportedStudentBrowser(false)}
      />
    );
  }

  return (
    <Router>
      <div className="app-container">
        {user && <MainHeader onLogout={handleLogout} user={user} role={role} />}
        <main className="main-content">
          <Suspense fallback={
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', flexDirection: 'column', gap: '0.75rem', color: '#64748b' }}>
              <div style={{ width: '32px', height: '32px', border: '3px solid #e2e8f0', borderTopColor: '#4f46e5', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <span style={{ fontSize: '0.9rem' }}>Loading view...</span>
            </div>
          }>
            <Routes>
              <Route path="/login" element={!user ? <AuthComponent /> : <Navigate to={`/${role}`} />} />
              <Route path="/teacher" element={user && role === 'teacher' ? <TeacherView user={user} /> : <Navigate to="/login" />} />
              <Route
                path="/student"
                element={
                  user && role === 'student' ? (
                    isGoogleChrome() ? (
                      <StudentView user={user} />
                    ) : (
                      <UnsupportedBrowserNotice
                        onBackToLogin={() => {
                          signOut(auth);
                          setUser(null);
                          setRole(null);
                        }}
                      />
                    )
                  ) : (
                    <Navigate to="/login" />
                  )
                }
              />
              <Route path="/class-management" element={user && role === 'teacher' ? <ClassManagement user={user} /> : <Navigate to="/login" />} />
              <Route path="/mailbox" element={user && role === 'teacher' ? <MailboxView /> : <Navigate to="/login" />} />
              <Route path="/mailbox/:emailId" element={user && role === 'teacher' ? <EmailDetailView /> : <Navigate to="/login" />} />
              <Route path="/manage-prompts" element={user && role === 'teacher' ? <PromptManagement /> : <Navigate to="/login" />} />
              <Route path="/class/:classId" element={user && role === 'teacher' ? <ClassView user={user} /> : <Navigate to="/login" />} />
              <Route path="*" element={<Navigate to="/login" />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </Router>
  );
};

const MainHeader = ({ onLogout, user, role }) => {
  const location = useLocation();
  const [className, setClassName] = useState('');
  const [unreadMailCount, setUnreadMailCount] = useState(0);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showChangePwdModal, setShowChangePwdModal] = useState(false);
  const menuRef = useRef(null);
  const isClassPage = location.pathname.startsWith('/class/');

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
          setClassName(docSnap.data().name || classId);
        } else {
          setClassName(classId);
        }
      }).catch(() => setClassName(classId));
    }
  }, [location.pathname, isClassPage]);

  // Listen for unread mails for teacher
  useEffect(() => {
    if (!user || role !== 'teacher') return;
    const q = query(
      collection(db, 'mails'),
      where('to', '==', user.email),
      where('read', '==', false)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setUnreadMailCount(snapshot.size);
    }, (err) => console.error("Mail listener error:", err));
    return () => unsubscribe();
  }, [user, role]);

  return (
    <>
      <header className="main-header">
        <div className="header-left">
          <Link to={role === 'teacher' ? '/teacher' : '/student'} className="brand-link">
            <img src={hkiitLogo} alt="HKIIT Logo" className="header-logo-img" />
            <div className="header-title-wrapper">
              <span className="header-title">Gemini AI Classroom</span>
              <span className="header-subtitle">Intelligent Teaching Assistant</span>
            </div>
          </Link>
        </div>

        {role === 'teacher' && (
          <nav className="teacher-main-nav">
            <NavLink to="/teacher" end>
              <span>📊 Dashboard</span>
            </NavLink>
            <NavLink to="/class-management">
              <span>⚙️ Class Manager</span>
            </NavLink>
            <NavLink to="/mailbox">
              <span>📬 Mailbox</span>
              {unreadMailCount > 0 && (
                <span style={{
                  background: '#ef4444',
                  color: 'white',
                  borderRadius: '10px',
                  padding: '1px 6px',
                  fontSize: '0.7rem',
                  fontWeight: 'bold',
                  marginLeft: '2px'
                }}>
                  {unreadMailCount}
                </span>
              )}
            </NavLink>
            <NavLink to="/manage-prompts">
              <span>💡 AI Prompts</span>
            </NavLink>
          </nav>
        )}

        <div className="header-right" ref={menuRef}>
          <div 
            className="user-profile-trigger"
            onClick={() => setShowProfileMenu(!showProfileMenu)}
            role="button"
            tabIndex={0}
            title="Account Menu"
          >
            <div className="user-badge">
              <span className="user-email-text">{user.email}</span>
              <span className="user-role-pill">{role}</span>
            </div>
            <span className={`dropdown-arrow ${showProfileMenu ? 'open' : ''}`}>▾</span>
          </div>

          {showProfileMenu && (
            <div className="user-profile-menu">
              <div className="profile-menu-header">
                <span className="profile-menu-email">{user.email}</span>
                <span className="profile-menu-role">{role === 'teacher' ? '👨‍🏫 Teacher' : '🧑‍🎓 Student'}</span>
              </div>
              <div className="profile-menu-divider" />
              <button 
                type="button"
                className="profile-menu-item"
                onClick={() => {
                  setShowProfileMenu(false);
                  setShowChangePwdModal(true);
                }}
              >
                <span className="menu-item-icon">🔑</span>
                <span>Change Password</span>
              </button>
              <div className="profile-menu-divider" />
              <button 
                type="button"
                className="profile-menu-item profile-menu-logout"
                onClick={() => {
                  setShowProfileMenu(false);
                  onLogout();
                }}
              >
                <span className="menu-item-icon">🚪</span>
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <ChangePasswordModal 
        show={showChangePwdModal} 
        onClose={() => setShowChangePwdModal(false)} 
      />

      {/* Dynamic Context Breadcrumb for subpages */}
      {role === 'teacher' && location.pathname !== '/teacher' && (
        <div className="breadcrumb-bar">
          <Link to="/teacher">Dashboard</Link>
          <span className="breadcrumb-separator">/</span>
          {isClassPage ? (
            <>
              <span className="breadcrumb-current">Class: {className || 'Loading...'}</span>
            </>
          ) : location.pathname.startsWith('/class-management') ? (
            <span className="breadcrumb-current">Class Management</span>
          ) : location.pathname.startsWith('/mailbox') ? (
            <span className="breadcrumb-current">Mailbox</span>
          ) : location.pathname.startsWith('/manage-prompts') ? (
            <span className="breadcrumb-current">Prompt Management</span>
          ) : null}
        </div>
      )}
    </>
  );
};

export default App;

