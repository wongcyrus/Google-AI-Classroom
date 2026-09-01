import { useState, useEffect } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth } from '../firebase-config';
import { isGoogleChrome, getBrowserName } from '../utils/browserDetection';
import './AuthComponent.css';

const AuthComponent = ({ unverifiedUser }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [cooldown, setCooldown] = useState(0);

  const isChrome = isGoogleChrome();
  const detectedBrowser = getBrowserName();

  useEffect(() => {
    let timer;
    if (cooldown > 0) {
      timer = setInterval(() => {
        setCooldown((prevCooldown) => prevCooldown - 1);
      }, 1000);
    }
    return () => {
      clearInterval(timer);
    };
  }, [cooldown]);

  const handleRegister = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.endsWith('@stu.vtc.edu.hk') && !cleanEmail.endsWith('@vtc.edu.hk')) {
      setError('Only emails ending with @stu.vtc.edu.hk or @vtc.edu.hk are allowed.');
      return;
    }

    if (cleanEmail.endsWith('@stu.vtc.edu.hk') && !isChrome) {
      setError(`Google Chrome is strictly required for students. Detected: ${detectedBrowser}. Please switch to Google Chrome.`);
      return;
    }

    createUserWithEmailAndPassword(auth, cleanEmail, password)
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

  const handleLogin = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    
    if (cleanEmail.endsWith('@stu.vtc.edu.hk') && !isChrome) {
      setError(`Google Chrome is strictly required for students. Detected: ${detectedBrowser}. Please reopen this page in Google Chrome.`);
      return;
    }

    signInWithEmailAndPassword(auth, cleanEmail, password)
      .then(() => {
        setMessage('');
        setError('');
      })
      .catch((error) => {
        if (error.code === 'auth/invalid-credential') {
          setError('Login failed. Please check your email and password.');
          setMessage('If you were recently added to a class, you might need to set your password first. Use the "Forgot Password" link.');
        } else {
          setError(error.message);
        }
      });
  };

  const handleResendVerificationEmail = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (unverifiedUser && cooldown === 0) {
      sendEmailVerification(unverifiedUser)
        .then(() => {
          setMessage('A new verification email has been sent. Please check your inbox.');
          setError('');
          setCooldown(60);
        })
        .catch((error) => {
          setError('Error resending verification email: ' + error.message);
        });
    }
  };

  const handleForgotPassword = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!email) {
      setError('Please enter your email address to reset your password.');
      return;
    }
    sendPasswordResetEmail(auth, email.trim())
      .then(() => {
        setMessage('Password reset email sent. Please check your inbox.');
      })
      .catch((error) => {
        setError(error.message);
      });
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-icon-badge">🔐</div>
          <h2>Welcome Back</h2>
          <p className="auth-subtitle">Sign in to your classroom account or register</p>
        </div>

        {!isChrome && (
          <div className="auth-browser-warning" role="alert" style={{
            background: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            margin: '0 0 1.25rem 0',
            fontSize: '0.825rem',
            color: '#fbbf24',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            lineHeight: '1.4'
          }}>
            <span>⚠️</span>
            <div>
              <strong>Students: Google Chrome Required.</strong> You are currently using {detectedBrowser}. Students must use Google Chrome to join proctored sessions.
            </div>
          </div>
        )}
        
        <form className="auth-form" onSubmit={handleLogin}>
          <div className="auth-field">
            <label htmlFor="auth-email">Email Address</label>
            <input
              id="auth-email"
              type="email"
              placeholder="user@stu.vtc.edu.hk or @vtc.edu.hk"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="auth-field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="auth-buttons-stack">
            <div className="auth-primary-actions">
              <button type="submit" className="auth-submit-btn">
                Sign In
              </button>
              <button type="button" onClick={handleRegister} className="auth-register-btn secondary-btn">
                Register
              </button>
            </div>

            <button 
              type="button" 
              onClick={handleForgotPassword} 
              className="forgot-password-button"
            >
              Forgot Password?
            </button>

            {unverifiedUser && (
              <button 
                type="button"
                onClick={handleResendVerificationEmail} 
                disabled={cooldown > 0}
                className="resend-verification-button"
              >
                {cooldown > 0 ? `Resend Verification (${cooldown}s)` : 'Resend Verification Email'}
              </button>
            )}
          </div>
        </form>

        {(error || message) && (
          <div className="message-container">
            {error && <div className="auth-alert error-alert">⚠️ {error}</div>}
            {message && <div className="auth-alert info-alert">ℹ️ {message}</div>}
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthComponent;