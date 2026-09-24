import React, { useState } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase-config';
import './UnenrolledStudentView.css';

/**
 * Dedicated view shown to students who have signed in but are not yet enrolled
 * in any active class roster. Provides clear status, quick email copying for instructors,
 * a real-time live listener indicator, and self-service account actions.
 */
const UnenrolledStudentView = ({ user, onRefresh, onSignOut }) => {
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const studentEmail = user?.email || 'Unknown Email';

  const handleCopyEmail = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(studentEmail);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = studentEmail;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.warn('Failed to copy email:', err);
    }
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    if (onRefresh) {
      await onRefresh();
    } else {
      window.location.reload();
    }
    setTimeout(() => setIsRefreshing(false), 1200);
  };

  const handleSignOutClick = async () => {
    if (onSignOut) {
      onSignOut();
    } else {
      try {
        await signOut(auth);
      } catch (err) {
        console.error('Error signing out:', err);
      }
    }
  };

  return (
    <div className="unenrolled-view-container" data-testid="unenrolled-student-view">
      <div className="unenrolled-view-card">
        {/* Header & Status */}
        <div className="unenrolled-header">
          <div className="unenrolled-icon-wrapper">
            <span role="img" aria-label="School">🏫</span>
          </div>
          <h1 className="unenrolled-title">Welcome to Google AI Classroom Assistant</h1>
          <p className="unenrolled-subtitle">
            You are signed in with your student account, but you haven't been enrolled in any classroom rosters yet.
          </p>
          <div className="unenrolled-status-badge">
            <span className="status-pulse-dot" />
            <span>Awaiting Instructor Enrollment</span>
          </div>
        </div>

        {/* Email Address Sharing Card */}
        <div className="unenrolled-email-box">
          <div className="email-box-label">Your Registered Student Email</div>
          <div className="email-box-content">
            <span className="email-address-text" title={studentEmail}>
              {studentEmail}
            </span>
            <button
              type="button"
              onClick={handleCopyEmail}
              className={`btn-copy-email ${copied ? 'copied' : ''}`}
              title="Copy your email address to clipboard"
            >
              {copied ? '✓ Copied!' : '📋 Copy Email'}
            </button>
          </div>
          <p className="email-box-hint">
            💡 <strong>Share this address with your instructor:</strong> Your teacher or teaching assistant needs to add this exact email to the classroom roster.
          </p>
        </div>

        {/* Real-time Listener Indicator */}
        <div className="unenrolled-listener-banner">
          <span className="listener-banner-icon">📡</span>
          <div>
            <h4 className="listener-banner-title">Live Automatic Enrollment Active</h4>
            <p className="listener-banner-desc">
              This page actively listens for roster updates in real-time. As soon as your teacher adds you to a class, you will be automatically connected without needing to log out.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="unenrolled-actions">
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="btn-refresh-status"
          >
            {isRefreshing ? '🔄 Checking...' : '🔄 Check Status Now'}
          </button>
          <button
            type="button"
            onClick={handleSignOutClick}
            className="btn-signout-unenrolled"
          >
            🚪 Sign Out / Switch Account
          </button>
        </div>

        {/* Device & System Readiness Tips */}
        <div className="unenrolled-tips-card">
          <div className="tips-title">
            <span>⚙️</span>
            <span>What to prepare before your first class session:</span>
          </div>
          <div className="tips-grid">
            <div className="tip-item">
              <div className="tip-item-icon">🌐</div>
              <div className="tip-item-title">Google Chrome</div>
              <div>Required for proctored invigilation & screen capture.</div>
            </div>
            <div className="tip-item">
              <div className="tip-item-icon">📷</div>
              <div className="tip-item-title">Webcam & Mic</div>
              <div>Have your camera and microphone connected and ready.</div>
            </div>
            <div className="tip-item">
              <div className="tip-item-icon">⚡</div>
              <div className="tip-item-title">Permissions</div>
              <div>Allow browser permissions when prompted during class entry.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnenrolledStudentView;
