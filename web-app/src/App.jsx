
import { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase-config';
import AuthComponent from './components/AuthComponent';
import TeacherView from './components/TeacherView';
import StudentView from './components/StudentView';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [unverifiedUser, setUnverifiedUser] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        if (currentUser.emailVerified) {
          setUser(currentUser);
          setUnverifiedUser(null);
          setError('');
          currentUser.getIdTokenResult().then((idTokenResult) => {
            if (idTokenResult.claims.teacher) {
              setRole('teacher');
            } else {
              setRole('student');
            }
          });
          if (currentUser.email.endsWith('@stu.vtc.edu.hk') || currentUser.email.endsWith('@vtc.edu.hk')) {
            const studentRef = doc(db, 'students', currentUser.uid);
            getDoc(studentRef).then((docSnap) => {
              if (!docSnap.exists()) {
                setDoc(studentRef, { email: currentUser.email });
              }
            });
          }
        } else {
          setUser(null);
          setRole(null);
          setUnverifiedUser(currentUser);
          setError("Please verify your email before logging in.");
        }
      } else {
        setUser(null);
        setRole(null);
        setUnverifiedUser(null);
      }
    });
    return () => unsubscribe();
  }, []);

  return (
    <div className="App">
      {error && <p className="error">{error}</p>}
      {user ? (
        role === 'teacher' ? <TeacherView user={user} /> : <StudentView user={user} />
      ) : (
        <AuthComponent unverifiedUser={unverifiedUser} />
      )}
    </div>
  );
}

export default App;
