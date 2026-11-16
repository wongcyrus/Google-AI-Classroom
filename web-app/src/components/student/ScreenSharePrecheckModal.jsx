import React from 'react';
import NativeDialog from '../NativeDialog';
import './ScreenSharePrecheckModal.css';

export default function ScreenSharePrecheckModal({
  isOpen,
  requireFullScreenOnly = true,
  isAudioEnabled = false,
  onConfirm,
  onCancel,
}) {
  if (!isOpen) return null;

  return (
    <NativeDialog
      isOpen={isOpen}
      onClose={onCancel}
      ariaLabel="Before You Share Your Screen"
      className="screen-share-precheck-dialog"
    >
      <div className="precheck-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="precheck-modal-header">
          <div className="precheck-title-wrap">
            <span className="precheck-icon" aria-hidden="true">🖥️</span>
            <div>
              <h3>Before You Share Your Screen</h3>
              <p className="precheck-subtitle">
                Please review these quick steps before the browser picker opens
              </p>
            </div>
          </div>
          <button
            type="button"
            className="precheck-close-btn"
            onClick={onCancel}
            aria-label="Close"
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className="precheck-modal-body">
          {requireFullScreenOnly && (
            <div className="precheck-warning-banner" role="alert">
              <span className="precheck-banner-icon" aria-hidden="true">⚠️</span>
              <div>
                <strong>Entire Screen Required</strong>
                <p>
                  Sharing a single <strong>Window</strong> or <strong>Browser Tab</strong> will be
                  automatically rejected and may be flagged for instructor review.
                </p>
              </div>
            </div>
          )}

          <div className="precheck-section">
            <h4>How to select your screen in the next popup:</h4>
            <ol className="precheck-steps-list">
              <li>
                <span className="step-num">1</span>
                <span>
                  Click the <strong>&ldquo;Entire Screen&rdquo;</strong> tab at the top of the popup
                  (not &ldquo;Window&rdquo; or &ldquo;Tab&rdquo;).
                </span>
              </li>
              <li>
                <span className="step-num">2</span>
                <span>
                  <strong>Click your screen preview thumbnail</strong> so the{' '}
                  <strong>Share</strong> button becomes active.
                </span>
              </li>
              <li>
                <span className="step-num">3</span>
                <span>
                  Click <strong>&ldquo;Share&rdquo;</strong> to start streaming.
                </span>
              </li>
            </ol>
          </div>

          <div className="precheck-privacy-box">
            <h4>🔒 Privacy &amp; Focus Checklist</h4>
            <ul>
              <li>
                Close personal chats, email, or sensitive tabs — your{' '}
                <strong>entire screen</strong> will be visible to your instructor.
              </li>
              <li>
                Exit personal messaging apps (WhatsApp, Discord, etc.) before sharing, while keeping
                classroom notifications enabled for Bingo and instructor alerts.
              </li>
              {isAudioEnabled && (
                <li>
                  🎙️ <strong>Microphone is enabled</strong> and will be captured with your session.
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="precheck-modal-footer">
          <button
            type="button"
            className="precheck-btn-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="precheck-btn-confirm"
            onClick={onConfirm}
            data-testid="confirm-screen-share-precheck"
          >
            Continue &amp; Select Entire Screen
          </button>
        </div>
      </div>
    </NativeDialog>
  );
}
