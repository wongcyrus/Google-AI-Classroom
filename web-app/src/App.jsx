
import { useState, useRef, useEffect } from 'react';
// Import the initialized services and the required functions from Firebase SDKs
import { auth, db, storage } from './firebase-config';
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  onSnapshot,
} from 'firebase/firestore';
import {
  ref,
  uploadString,
  getDownloadURL,
  getMetadata,
} from 'firebase/storage';

import './App.css';

function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [screenshotInterval, setScreenshotInterval] = useState(null);
  const [unverifiedUser, setUnverifiedUser] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        if (currentUser.emailVerified) {
          // User is signed in and email is verified.
          setUser(currentUser);
          setUnverifiedUser(null);
          setError('');
          currentUser.getIdTokenResult().then((idTokenResult) => {
            setRole(idTokenResult.claims.role);
          });
          // Student-specific logic
          if (currentUser.email.endsWith('@stu.vtc.edu.hk') || currentUser.email.endsWith('@vtc.edu.hk')) {
            const studentRef = doc(db, 'students', currentUser.uid);
            getDoc(studentRef).then((docSnap) => {
              if (!docSnap.exists()) {
                setDoc(studentRef, { email: currentUser.email });
              }
            });
          }
        } else {
          // User is signed in, but email is not verified.
          setUser(null);
          setRole(null);
          setUnverifiedUser(currentUser);
          setError("Please verify your email before logging in.");
        }
      } else {
        // User is signed out.
        setUser(null);
        setRole(null);
        setUnverifiedUser(null);
      }
    });
    return () => unsubscribe(); // Cleanup subscription on unmount
  }, []);

  const handleRegister = () => {
    if (!email.endsWith('@stu.vtc.edu.hk') && !email.endsWith('@vtc.edu.hk')) {
      setError('Only emails ending with @stu.vtc.edu.hk or @vtc.edu.hk are allowed.');
      return;
    }
    createUserWithEmailAndPassword(auth, email, password)
      .then((userCredential) => {
        sendEmailVerification(userCredential.user)
          .then(() => {
            setMessage('Registration successful. A verification email has been sent. Please verify your email before logging in.');
          })
          .catch((error) => {
            setError("Error sending verification email: " + error.message);
          });
      })
      .catch((error) => {
        setError(error.message);
      });
  };

  const handleLogin = () => {
    // signInWithEmailAndPassword will trigger onAuthStateChanged, which handles all logic.
    signInWithEmailAndPassword(auth, email, password)
      .then(() => {
        // Clear local messages, onAuthStateChanged will set new ones if needed.
        setMessage('');
        setError('');
      })
      .catch((error) => {
        // Handle login-specific errors like wrong password
        setError(error.message);
      });
  };

  const handleResendVerificationEmail = () => {
    if (unverifiedUser) {
      sendEmailVerification(unverifiedUser)
        .then(() => {
          setMessage('A new verification email has been sent. Please check your inbox.');
          setError('');
        })
        .catch((error) => {
          setError('Error resending verification email: ' + error.message);
        });
    }
  };

  const handleLogout = () => {
    signOut(auth);
  };

  const handleForgotPassword = () => {
    if (!email) {
      setError('Please enter your email address to reset your password.');
      return;
    }
    sendPasswordResetEmail(auth, email)
      .then(() => {
        setMessage('Password reset email sent. Please check your inbox.');
      })
      .catch((error) => {
        setError(error.message);
      });
  };

  const handleScreenShare = async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      videoRef.current.srcObject = screenStream;
      setStream(screenStream);

      const interval = setInterval(() => {
        captureScreenshot(screenStream);
      }, 5000); // Capture every 5 seconds
      setScreenshotInterval(interval);
    } catch (err) {
      console.error("Error: " + err);
    }
  };

  const stopScreenShare = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setStream(null);
    }
    if (screenshotInterval) {
      clearInterval(screenshotInterval);
      setScreenshotInterval(null);
    }
  };

  const captureScreenshot = (screenStream) => {
    const video = document.createElement('video');
    video.srcObject = screenStream;
    video.play();
    video.onloadeddata = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg');
      
      const screenshotRef = ref(storage, `screenshots/${user.uid}/screenshot.jpg`);
      uploadString(screenshotRef, dataUrl, 'data_url').then(() => {
        console.log('Screenshot uploaded');
      });
      video.remove();
    };
  };

  const TeacherView = () => {
    const [students, setStudents] = useState([]);

    useEffect(() => {
      const q = collection(db, 'students');
      const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const studentsData = [];
        querySnapshot.forEach((doc) => {
          studentsData.push({ id: doc.id, ...doc.data() });
        });
        setStudents(studentsData);
      });
      return () => unsubscribe();
    }, []);

    const StudentScreen = ({ student }) => {
      const [screenshotUrl, setScreenshotUrl] = useState(null);
      const [lastUpdated, setLastUpdated] = useState(null);

      useEffect(() => {
        const screenshotRef = ref(storage, `screenshots/${student.id}/screenshot.jpg`);

        const updateScreenshot = () => {
          getMetadata(screenshotRef).then(metadata => {
            if (lastUpdated !== metadata.updated) {
                getDownloadURL(screenshotRef).then(url => {
                    setScreenshotUrl(url);
                    setLastUpdated(metadata.updated);
                });
            }
          }).catch(error => {
              if (error.code === 'storage/object-not-found') {
                  // This is expected, not an error to display
              } else {
                  console.error(error);
              }
              setScreenshotUrl(null);
          });
        };

        const interval = setInterval(updateScreenshot, 5000);
        updateScreenshot();

        return () => clearInterval(interval);
      }, [student.id, lastUpdated]);

      return (
        <div className="student-screen">
          <h2>{student.email}</h2>
          {screenshotUrl ? (
            <img src={screenshotUrl} alt={`Screenshot from ${student.email}`} />
          ) : (
            <p>No screenshot available</p>
          )}
        </div>
      );
    };

    return (
      <div>
        <h1>Teacher View</h1>
        <div className="student-screens">
          {students.map(student => (
            <StudentScreen key={student.id} student={student} />
          ))}
        </div>
        <button onClick={handleLogout}>Logout</button>
      </div>
    );
  };

  const StudentView = () => (
    <div>
      <h1>Welcome, {user.email}</h1>
      <div className="card">
        <video ref={videoRef} autoPlay style={{ width: '100%',
        height: 'auto',
        border: '1px solid black' }}></video>
        <br/>
        <button onClick={handleScreenShare}>Share Screen</button>
        <button onClick={stopScreenShare}>Stop Sharing</button>
      </div>
      <button onClick={handleLogout}>Logout</button>
    </div>
  )

  return (
    <div className="App">
      {user ? (
        role === 'teacher' ? <TeacherView /> : <StudentView />
      ) : (
        <div>
          <h1>Student Registration</h1>
          <div className="card">
            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button onClick={handleRegister}>Register</button>
            <button onClick={handleLogin}>Login</button>
            {unverifiedUser && (
                <button onClick={handleResendVerificationEmail}>Resend Verification Email</button>
            )}
            <button onClick={handleForgotPassword}>Forgot Password</button>
            {error && <p className="error">{error}</p>}
            {message && <p className="message">{message}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
