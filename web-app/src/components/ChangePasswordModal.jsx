import React, { useState } from 'react';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth } from '../firebase-config';
import './ChangePasswordModal.css';

const ChangePasswordModal = ({ show, onClose }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!show) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    if (currentPassword === newPassword) {
      setError('New password must be different from current password.');
      return;
    }

    setLoading(true);

    try {
      const user = auth.currentUser;
      if (!user || !user.email) {
        throw new Error('No authenticated user session found.');
      }

      // Re-authenticate first to ensure secure session
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);

      // Update to new password
      await updatePassword(user, newPassword);

      setSuccess('Password updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      setTimeout(() => {
        setSuccess('');
        onClose();
      }, 1500);
    } catch (err) {
      console.error('Password update error:', err);
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Current password is incorrect. Please try again.');
      } else if (err.code === 'auth/weak-password') {
        setError('New password is too weak. Please use a stronger password.');
      } else {
        setError(err.message || 'Failed to update password. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;
    setError('');
    setSuccess('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    onClose();
  };

  return (
    <div className="pwd-modal-overlay" onClick={handleClose}>
      <div className="pwd-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="pwd-modal-header">
          <div className="pwd-modal-title">
            <span className="pwd-modal-icon">🔑</span>
            <h3>Change Password</h3>
          </div>
          <button className="pwd-modal-close-btn" onClick={handleClose} disabled={loading}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="pwd-modal-form">
          {error && <div className="pwd-alert pwd-alert-error">⚠️ {error}</div>}
          {success && <div className="pwd-alert pwd-alert-success">✅ {success}</div>}

          <div className="pwd-form-group">
            <label htmlFor="current-pwd">Current Password</label>
            <input
              id="current-pwd"
              type="password"
              placeholder="Enter your current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              disabled={loading || !!success}
              autoFocus
            />
          </div>

          <div className="pwd-form-group">
            <label htmlFor="new-pwd">New Password</label>
            <input
              id="new-pwd"
              type="password"
              placeholder="At least 6 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              disabled={loading || !!success}
            />
          </div>

          <div className="pwd-form-group">
            <label htmlFor="confirm-pwd">Confirm New Password</label>
            <input
              id="confirm-pwd"
              type="password"
              placeholder="Re-enter your new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={loading || !!success}
            />
          </div>

          <div className="pwd-modal-actions">
            <button
              type="button"
              className="pwd-btn pwd-btn-secondary"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="pwd-btn pwd-btn-primary"
              disabled={loading || !!success}
            >
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChangePasswordModal;
