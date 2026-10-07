import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { startRegistration } from '@simplewebauthn/browser';
import { auth, functions } from '../../firebase-config';
import { getOrCreateDeviceFingerprint } from '../../utils/deviceFingerprint';
import { normalizePasskeyError, checkPlatformAuthenticatorAvailable } from '../../utils/passkeyErrorUtils';
import { isAndroidDevice, isIOSDevice, getBrowserName } from '../../utils/browserDetection';

/**
 * PasskeyPasswordFallbackForm
 * 
 * In-situ fallback for students who scan a routine or lecture attendance QR code
 * without a pre-registered passkey on their personal smartphone.
 * 
 * Authenticates with email + password, enrolls native biometric passkey on-the-fly,
 * and passes control back to the parent view to complete attendance seamlessly.
 */
export default function PasskeyPasswordFallbackForm({
  initialEmail = '',
  title = 'Register Phone Passkey',
  subtitle = 'Log in with your classroom account password once to enable 1-second Face ID / Fingerprint check-in on this device.',
  submitLabel = 'Log In & Register Passkey',
  onSuccess,
  onCancel,
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submittingStep, setSubmittingStep] = useState('idle'); // 'idle' | 'logging_in' | 'prompting_biometrics' | 'saving_passkey' | 'completing'
  const [errorMessage, setErrorMessage] = useState('');
  const [errorDetails, setErrorDetails] = useState(null);

  const isAndroid = isAndroidDevice();
  const isIOS = isIOSDevice();
  const detectedBrowser = getBrowserName();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMessage('Please enter both your email and password.');
      return;
    }

    setErrorMessage('');
    setErrorDetails(null);

    // Pre-flight check for screen lock / biometrics on device
    const isBioAvailable = await checkPlatformAuthenticatorAvailable();
    if (!isBioAvailable && isAndroid) {
      const diag = normalizePasskeyError('provider not found', { isAndroid: true });
      setErrorDetails(diag);
      setErrorMessage(diag.message);
      return;
    }

    try {
      // Step 1: Verify student credentials via Firebase Auth
      setSubmittingStep('logging_in');
      let userCredential;
      try {
        userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
      } catch (authErr) {
        console.error('[PasskeyPasswordFallbackForm] Firebase Auth sign-in failed:', authErr);
        const code = authErr.code || '';
        if (
          code === 'auth/wrong-password' ||
          code === 'auth/invalid-credential' ||
          code === 'auth/invalid-login-credentials' ||
          code === 'auth/user-not-found'
        ) {
          throw new Error('Incorrect email or password. Please verify your classroom account credentials.');
        } else if (code === 'auth/too-many-requests') {
          throw new Error('Too many failed login attempts. Please wait a moment before trying again.');
        } else if (code === 'auth/network-request-failed') {
          throw new Error('Network error. Please check your internet connection.');
        }
        throw new Error(authErr.message || 'Authentication failed.');
      }

      // Step 2: Request WebAuthn registration options for this authenticated user session
      setSubmittingStep('prompting_biometrics');
      const getOptionsFn = httpsCallable(functions, 'getPasskeyRegistrationOptions');
      const optionsRes = await getOptionsFn({
        clientRpId: window.location.hostname,
      });

      const options = optionsRes.data;
      if (!options) {
        throw new Error('Could not obtain passkey registration options from server.');
      }

      // Step 3: Trigger native OS biometric enrollment (Face ID / Fingerprint / Touch ID)
      let attestationResponse;
      try {
        attestationResponse = await startRegistration({ optionsJSON: options });
      } catch (biometricErr) {
        const diag = normalizePasskeyError(biometricErr, { isAndroid, isIOS, browserName: detectedBrowser });
        if (diag.type === 'user_cancelled') {
          setSubmittingStep('idle');
          setErrorMessage('Biometric enrollment prompt was cancelled. Tap the button to try again.');
          return;
        }
        throw biometricErr;
      }

      // Step 4: Verify and bind the passkey with 1-phone = 1-student hardware lock on server
      setSubmittingStep('saving_passkey');
      const userAgent = navigator.userAgent || '';
      let detectedModel = 'Mobile Phone';
      if (/iPhone/i.test(userAgent)) detectedModel = 'Apple iPhone';
      else if (/iPad/i.test(userAgent)) detectedModel = 'Apple iPad';
      else if (/Android/i.test(userAgent)) detectedModel = 'Android Device';

      const deviceFingerprint = getOrCreateDeviceFingerprint();
      const verifyFn = httpsCallable(functions, 'verifyPasskeyRegistration');
      const verifyRes = await verifyFn({
        attestationResponse,
        clientRpId: window.location.hostname,
        deviceModel: detectedModel,
        deviceFingerprint,
      });

      if (!verifyRes.data?.verified) {
        throw new Error('Registration could not be verified by server.');
      }

      // Step 5: Notify parent view to complete attendance
      setSubmittingStep('completing');
      if (onSuccess) {
        await onSuccess({
          studentUid: userCredential.user.uid,
          studentEmail: userCredential.user.email || email.trim(),
          deviceModel: detectedModel,
        });
      }
    } catch (err) {
      console.error('[PasskeyPasswordFallbackForm] Error during passkey onboarding:', err);
      setSubmittingStep('idle');
      const diag = normalizePasskeyError(err, { isAndroid, isIOS, browserName: detectedBrowser });
      setErrorDetails(diag);
      setErrorMessage(diag.message || err.message || 'Failed to register passkey. Please try again.');
    }
  };

  const isSubmitting = submittingStep !== 'idle';

  return (
    <div style={{ width: '100%' }}>
      <div className="passkey-icon-badge">🔐</div>
      <h1 className="passkey-title">{title}</h1>
      <p className="passkey-subtitle">{subtitle}</p>

      {errorDetails ? (
        <div className="passkey-alert passkey-alert-error" style={{ textAlign: 'left', lineHeight: 1.5, marginBottom: '1.25rem' }}>
          <strong style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.95rem' }}>
            ⚠️ {errorDetails.title}
          </strong>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem' }}>{errorDetails.message}</p>
          {errorDetails.resolutionSteps?.length > 0 && (
            <ol style={{ margin: '0.25rem 0 0 1.25rem', padding: 0, fontSize: '0.825rem' }}>
              {errorDetails.resolutionSteps.map((step, idx) => (
                <li key={idx} style={{ marginBottom: '0.25rem' }}>{step}</li>
              ))}
            </ol>
          )}
        </div>
      ) : errorMessage ? (
        <div className="passkey-alert passkey-alert-error">
          {errorMessage}
        </div>
      ) : null}

      {isSubmitting && (
        <div className="passkey-step-box">
          <div className="passkey-step-title">
            <span className="passkey-spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} />
            {submittingStep === 'logging_in' && 'Step 1 of 3: Verifying account credentials...'}
            {submittingStep === 'prompting_biometrics' && 'Step 2 of 3: Enroll Biometrics on your phone...'}
            {submittingStep === 'saving_passkey' && 'Step 3 of 3: Binding passkey to your student account...'}
            {submittingStep === 'completing' && 'Finalizing attendance check...'}
          </div>
          <p className="passkey-step-desc">
            {submittingStep === 'logging_in' && 'Connecting to classroom authentication service...'}
            {submittingStep === 'prompting_biometrics' && 'Please confirm Face ID, Fingerprint, or Screen Lock when prompted.'}
            {submittingStep === 'saving_passkey' && 'Enforcing physical smartphone hardware security lock...'}
            {submittingStep === 'completing' && 'Recording your attendance verification for this lesson...'}
          </p>
        </div>
      )}

      <form className="passkey-fallback-form" onSubmit={handleSubmit}>
        <div>
          <label className="passkey-input-label" htmlFor="fallback-email">
            Student Email
          </label>
          <div className="passkey-input-wrapper">
            <input
              id="fallback-email"
              type="email"
              className="passkey-input-field"
              placeholder="e.g. 230012345@stu.vtc.edu.hk"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
              autoComplete="username email"
              required
            />
          </div>
        </div>

        <div>
          <label className="passkey-input-label" htmlFor="fallback-password">
            Account Password
          </label>
          <div className="passkey-input-wrapper">
            <input
              id="fallback-password"
              type={showPassword ? 'text' : 'password'}
              className="passkey-input-field"
              placeholder="Enter your classroom password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="passkey-eye-toggle"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {showPassword ? '👁️' : '👁️‍🗨️'}
            </button>
          </div>
        </div>

        <button
          type="submit"
          className="passkey-btn passkey-btn-primary"
          style={{ marginTop: '0.5rem' }}
          disabled={isSubmitting || !email.trim() || !password}
        >
          {isSubmitting ? (
            <>
              <span className="passkey-spinner" />
              <span>Setting Up Passkey...</span>
            </>
          ) : (
            <>
              <span>🔑</span>
              <span>{submitLabel}</span>
            </>
          )}
        </button>

        {onCancel && (
          <button
            type="button"
            className="passkey-btn passkey-btn-secondary"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Back to Biometric Scan
          </button>
        )}
      </form>
    </div>
  );
}
