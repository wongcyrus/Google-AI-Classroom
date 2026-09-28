import { useState, useEffect } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  sendPasswordResetEmail,
  signOut,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import QRCode from 'qrcode';
import { auth, functions, db } from '../firebase-config';
import { isGoogleChrome, getBrowserName, isHandheldPhone } from '../utils/browserDetection';
import { isValidInstitutionalEmail, isStudentEmail, deriveRoleFromEmail, getAllowedDomainsDescription } from '../utils/domainConfig';
import './AuthComponent.css';

const AuthComponent = ({ unverifiedUser }) => {
  const isMobile = isHandheldPhone();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [localUnverifiedUser, setLocalUnverifiedUser] = useState(null);

  // Cross-device Mobile Passkey QR Login state (Default to QR on Desktop/Tablet, Password on Handheld Phone)
  const [activeTab, setActiveTab] = useState(() => (isHandheldPhone() ? 'password' : 'qr'));
  const [qrSessionId, setQrSessionId] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrTimeLeft, setQrTimeLeft] = useState(90);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrStatus, setQrStatus] = useState('idle'); // 'idle' | 'waiting' | 'authorized' | 'expired' | 'error'
  const [qrError, setQrError] = useState('');

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

  const handleRegister = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (isLoading) return;

    const cleanEmail = email.trim().toLowerCase();
    if (!isValidInstitutionalEmail(cleanEmail)) {
      setError(`Only emails ending with ${getAllowedDomainsDescription()} are allowed.`);
      return;
    }

    if (isStudentEmail(cleanEmail) && !isChrome) {
      setError(`Google Chrome is strictly required for students. Detected: ${detectedBrowser}. Please switch to Google Chrome.`);
      return;
    }

    setIsLoading(true);
    setError('');
    setMessage('');

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
      setLocalUnverifiedUser(userCredential.user);
      await sendEmailVerification(userCredential.user);
      // Immediately sign out unverified account so that subsequent sign-in is clean and triggers auth observers
      await signOut(auth);
      setMessage('Registration successful. A verification email has been sent. Please check your email inbox, verify your account, and then sign in.');
    } catch (err) {
      if (err.code === 'auth/too-many-requests') {
        setError('Too many requests. Please wait a moment before trying again.');
      } else {
        setError(err.message || 'Registration failed.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (isLoading) return;

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError('Please enter your email address.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }

    if (isStudentEmail(cleanEmail) && !isChrome) {
      setError(`Google Chrome is strictly required for students. Detected: ${detectedBrowser}. Please reopen this page in Google Chrome.`);
      return;
    }

    setIsLoading(true);
    setError('');
    setMessage('');

    try {
      const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, password);
      const loggedInUser = userCredential?.user;

      // Ensure freshest emailVerified status from Firebase backend
      if (loggedInUser && typeof loggedInUser.reload === 'function') {
        await loggedInUser.reload();
      }

      if (loggedInUser && !loggedInUser.emailVerified) {
        setLocalUnverifiedUser(loggedInUser);
        setError('Please verify your email address before logging in. Check your inbox for the verification email.');
        await signOut(auth);
        return;
      }

      // Force-refresh ID token so role custom claims and emailVerified are refreshed
      if (loggedInUser && typeof loggedInUser.getIdTokenResult === 'function') {
        await loggedInUser.getIdTokenResult(true);
      }
      // Successful verified login will be observed by onAuthStateChanged / onIdTokenChanged in App.jsx
    } catch (err) {
      if (err.code === 'auth/invalid-credential') {
        setError('Login failed. Please check your email and password.');
        setMessage('If you were recently added to a class, you might need to set your password first. Use the "Forgot Password" link.');
      } else if (err.code === 'auth/too-many-requests') {
        setError('Too many login attempts. Your account or network has been temporarily blocked by Firebase for security. Please wait 1-2 minutes before trying again, or reset your password.');
      } else {
        setError(err.message || 'Login failed. Please check your credentials and try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendVerificationEmail = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (isLoading || cooldown > 0) return;

    const targetUser = unverifiedUser || localUnverifiedUser;
    if (targetUser) {
      setIsLoading(true);
      setError('');
      try {
        await sendEmailVerification(targetUser);
        setMessage('A new verification email has been sent. Please check your inbox.');
        setCooldown(60);
      } catch (err) {
        if (err.code === 'auth/too-many-requests') {
          setError('Too many requests. Please wait before requesting another verification email.');
        } else {
          setError('Error resending verification email: ' + err.message);
        }
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleForgotPassword = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (isLoading) return;

    if (!email) {
      setError('Please enter your email address to reset your password.');
      return;
    }

    setIsLoading(true);
    setError('');
    setMessage('');

    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMessage('Password reset email sent. Please check your inbox.');
    } catch (err) {
      if (err.code === 'auth/too-many-requests') {
        setError('Too many requests. Please wait a moment before trying again.');
      } else {
        setError(err.message || 'Failed to send password reset email.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const initiateQrSession = async () => {
    if (!functions) return;
    setQrLoading(true);
    setQrError('');
    setQrStatus('waiting');
    setQrTimeLeft(90);
    try {
      const initFn = httpsCallable(functions, 'initiateDesktopLoginSession');
      const res = await initFn({ clientRpId: window.location.hostname });
      const { sessionId, expiresAtMillis, qrUrl } = res.data || {};
      if (!sessionId) throw new Error('Could not create desktop login session.');

      setQrSessionId(sessionId);
      const fullUrl = `${window.location.origin}${qrUrl}`;
      const dataUrl = await QRCode.toDataURL(fullUrl, {
        width: 240,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
      });
      setQrDataUrl(dataUrl);
      const remainingSec = Math.max(0, Math.round((expiresAtMillis - Date.now()) / 1000));
      setQrTimeLeft(remainingSec || 90);
    } catch (err) {
      console.error('[AuthComponent] Error initiating QR session:', err);
      setQrError(err.message || 'Failed to initialize QR code.');
      setQrStatus('error');
    } finally {
      setQrLoading(false);
    }
  };

  useEffect(() => {
    if (!qrSessionId || activeTab !== 'qr' || !db) return;

    const unsub = onSnapshot(doc(db, `loginSessions/${qrSessionId}`), async (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.status === 'authorized' && data.customToken) {
        setQrStatus('authorized');
        setMessage('Mobile passkey verified! Signing in to lab PC...');
        try {
          await signInWithCustomToken(auth, data.customToken);
        } catch (signInErr) {
          console.error('[AuthComponent] Custom token sign-in error:', signInErr);
          setError('Failed to authenticate with token. Please try again.');
        }
      } else if (data.status === 'expired') {
        setQrStatus('expired');
      }
    });

    return () => unsub();
  }, [qrSessionId, activeTab]);

  useEffect(() => {
    if (activeTab !== 'qr' || qrStatus !== 'waiting' || qrTimeLeft <= 0) return;
    const interval = setInterval(() => {
      setQrTimeLeft((prev) => {
        if (prev <= 1) {
          setQrStatus('expired');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [activeTab, qrStatus, qrTimeLeft]);

  // Auto-initiate QR session on Desktop when activeTab is 'qr'
  useEffect(() => {
    if (!isMobile && activeTab === 'qr' && !qrSessionId && !qrLoading) {
      initiateQrSession();
    }
  }, [isMobile, activeTab, qrSessionId, qrLoading]);

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-icon-badge">🔐</div>
          <h2>Welcome Back</h2>
          <p className="auth-subtitle">Sign in to your classroom account or register</p>
        </div>

        {!isMobile && (
          <div className="auth-tab-nav" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'qr'}
              className={`auth-tab-btn ${activeTab === 'qr' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('qr');
                if (!qrSessionId || qrStatus === 'expired') {
                  initiateQrSession();
                }
              }}
            >
              📱 Scan QR Code (Lab PC)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'password'}
              className={`auth-tab-btn ${activeTab === 'password' ? 'active' : ''}`}
              onClick={() => setActiveTab('password')}
            >
              ✉️ Email & Password
            </button>
          </div>
        )}

        {!isMobile && activeTab === 'qr' && (
          <div className="auth-qr-section">
            <div className="auth-qr-instructions">
              <strong>Scan with your mobile phone camera</strong>
              <p>Touch Face ID or Fingerprint on your phone to instantly sign in on this lab desktop.</p>
            </div>

            <div className="auth-qr-display-box">
              {qrLoading ? (
                <div className="auth-qr-placeholder">
                  <div className="auth-spinner" />
                  <p>Generating secure QR code...</p>
                </div>
              ) : qrStatus === 'expired' ? (
                <div className="auth-qr-placeholder">
                  <p style={{ color: '#ef4444', fontWeight: 600 }}>QR Code Expired</p>
                  <p style={{ fontSize: '0.8rem', color: '#64748b' }}>Sessions expire after 90 seconds for your security.</p>
                  <button type="button" className="auth-submit-btn" onClick={initiateQrSession}>
                    🔄 Refresh QR Code
                  </button>
                </div>
              ) : qrDataUrl ? (
                <div className="auth-qr-img-wrapper">
                  <img src={qrDataUrl} alt="Desktop Login QR Code" className="auth-qr-img" />
                  <div className="auth-qr-timer">
                    ⏱️ Expires in: <strong>{qrTimeLeft}s</strong>
                  </div>
                </div>
              ) : qrError ? (
                <div className="auth-qr-placeholder">
                  <p style={{ color: '#ef4444' }}>{qrError}</p>
                  <button type="button" className="auth-submit-btn" onClick={initiateQrSession}>
                    🔄 Retry
                  </button>
                </div>
              ) : null}
            </div>

            <div className="auth-qr-shared-pc-note">
              <span>🔒</span>
              <div>
                <strong>Shared Lab PC Security</strong>: Passkeys reside strictly within your personal phone hardware. No credentials are saved on this public desktop machine.
              </div>
            </div>

            <button
              type="button"
              className="auth-qr-switch-btn"
              onClick={() => setActiveTab('password')}
            >
              Prefer Email & Password? Switch tab
            </button>
          </div>
        )}

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
        
        <form className="auth-form" onSubmit={handleLogin} style={{ display: activeTab === 'password' ? 'flex' : 'none' }}>
          <div className="auth-field">
            <label htmlFor="auth-email">Email Address</label>
            <input
              id="auth-email"
              type="email"
              placeholder={`user${getAllowedDomainsDescription()}`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              required
            />
            {email.trim().includes('@') && (
              <div className="auth-email-hint" style={{ marginTop: '0.35rem', fontSize: '0.78rem', color: '#94a3b8' }}>
                {deriveRoleFromEmail(email.trim()) === 'student' && (
                  <span style={{ color: '#38bdf8' }}>🎓 Recognized as Student account</span>
                )}
                {deriveRoleFromEmail(email.trim()) === 'teacher' && (
                  <span style={{ color: '#34d399' }}>👨‍🏫 Recognized as Teacher account</span>
                )}
                {deriveRoleFromEmail(email.trim()) === null && (
                  <span style={{ color: '#f87171' }}>⚠️ Domain not recognized ({getAllowedDomainsDescription()})</span>
                )}
              </div>
            )}
          </div>

          <div className="auth-field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              required
            />
          </div>

          <div className="auth-buttons-stack">
            <div className="auth-primary-actions">
              <button 
                type="submit" 
                className="auth-submit-btn" 
                disabled={isLoading}
                aria-busy={isLoading}
              >
                {isLoading ? (
                  <span className="auth-btn-loading">
                    <span className="auth-spinner" aria-hidden="true" />
                    Signing In...
                  </span>
                ) : (
                  'Sign In'
                )}
              </button>
              <button 
                type="button" 
                onClick={handleRegister} 
                className="auth-register-btn secondary-btn"
                disabled={isLoading}
              >
                Register
              </button>
            </div>

            <button 
              type="button" 
              onClick={handleForgotPassword} 
              className="forgot-password-button"
              disabled={isLoading}
            >
              Forgot Password?
            </button>

            {(unverifiedUser || localUnverifiedUser) && (
              <button 
                type="button" 
                onClick={handleResendVerificationEmail} 
                disabled={cooldown > 0 || isLoading}
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