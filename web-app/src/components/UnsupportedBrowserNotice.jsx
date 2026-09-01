import React from 'react';
import './UnsupportedBrowserNotice.css';
import hkiitLogo from '../assets/HKIIT_logo_RGB_horizontal.jpg';
import { getBrowserName } from '../utils/browserDetection';

const UnsupportedBrowserNotice = ({ detectedBrowser, onBackToLogin }) => {
  const browserName = detectedBrowser || getBrowserName();

  return (
    <div className="unsupported-browser-container">
      <div className="unsupported-browser-card">
        <div className="unsupported-browser-header">
          <img src={hkiitLogo} alt="HKIIT Logo" className="unsupported-logo" />
        </div>

        <div className="unsupported-browser-body">
          <div className="unsupported-browser-icon-badge" aria-hidden="true">
            🌐
          </div>

          <h1 className="unsupported-browser-title">Google Chrome Required</h1>

          <div className="unsupported-browser-alert-pill">
            <span>Detected Browser: <strong>{browserName}</strong> (Unsupported for Students)</span>
          </div>

          <p className="unsupported-browser-description">
            To ensure secure examination integrity, on-device LiteRT AI proctoring, WebRTC audio/video capture, and screen sharing compliance, <strong>all students are strictly required to use Google Chrome</strong>.
          </p>

          <p className="unsupported-browser-subtext">
            You have been automatically logged out for your safety. Please copy this URL and open it inside Google Chrome.
          </p>

          <div className="unsupported-browser-actions">
            <a
              href="https://www.google.com/chrome/"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-download-chrome"
              id="download-chrome-btn"
            >
              📥 Download Google Chrome
            </a>

            {onBackToLogin && (
              <button
                type="button"
                onClick={onBackToLogin}
                className="btn-back-login"
                id="back-to-login-btn"
              >
                🔄 Go to Login Page
              </button>
            )}
          </div>
        </div>

        <div className="unsupported-browser-footer">
          <span>Gemini AI Classroom Assistant • Examination & Invigilation System</span>
        </div>
      </div>
    </div>
  );
};

export default UnsupportedBrowserNotice;
