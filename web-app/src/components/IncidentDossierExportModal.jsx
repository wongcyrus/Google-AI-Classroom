import React, { useState, useEffect } from 'react';
import { db } from '../firebase-config';
import { collection, addDoc, doc, onSnapshot, serverTimestamp } from 'firebase/firestore';

/**
 * Modal to configure and trigger asynchronous Formal Incident Dossier generation (.docx & .csv)
 * Strictly scoped per-session / time-period.
 */
export default function IncidentDossierExportModal({
  isOpen,
  onClose,
  classId,
  user,
  students = [],
  currentSessionStartTime,
  currentSessionEndTime,
}) {
  // Time period filters
  const [timePreset, setTimePreset] = useState('session'); // 'session' | '1h' | '3h' | 'custom'
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Format & inclusion options
  const [exportFormat, setExportFormat] = useState('both'); // 'docx' | 'csv' | 'both'
  const [includeScreenshots, setIncludeScreenshots] = useState(true);
  const [includeAudioTranscripts, setIncludeAudioTranscripts] = useState(true);
  const [includeGazeLogs, setIncludeGazeLogs] = useState(true);

  // Student filtering
  const [selectedStudentFilter, setSelectedStudentFilter] = useState('all'); // 'all' | 'specific'
  const [selectedStudentUids, setSelectedStudentUids] = useState([]);

  // Notification Email
  const [sendEmailNotification, setSendEmailNotification] = useState(true);
  const [notificationEmail, setNotificationEmail] = useState(user?.email || '');

  // Active Job State
  const [activeJobId, setActiveJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null); // 'pending' | 'processing' | 'completed' | 'failed'
  const [jobResult, setJobResult] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Initialize custom datetime defaults
  useEffect(() => {
    if (isOpen) {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      setCustomEnd(now.toISOString().slice(0, 16));
      setCustomStart(oneHourAgo.toISOString().slice(0, 16));
      if (user?.email && !notificationEmail) {
        setNotificationEmail(user.email);
      }
    }
  }, [isOpen, user, notificationEmail]);

  // Subscribe to active job updates
  useEffect(() => {
    if (!activeJobId) return;

    const jobDocRef = doc(db, 'reportJobs', activeJobId);
    const unsubscribe = onSnapshot(jobDocRef, (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      setJobStatus(data.status);
      if (data.status === 'completed') {
        setJobResult(data);
      } else if (data.status === 'failed') {
        setErrorMessage(data.error || 'Report generation failed');
      }
    });

    return () => unsubscribe();
  }, [activeJobId]);

  if (!isOpen) return null;

  const calculateTimeRange = () => {
    const now = new Date();
    if (timePreset === '1h') {
      return {
        start: new Date(now.getTime() - 60 * 60 * 1000),
        end: now,
      };
    } else if (timePreset === '3h') {
      return {
        start: new Date(now.getTime() - 3 * 60 * 60 * 1000),
        end: now,
      };
    } else if (timePreset === 'custom') {
      return {
        start: customStart ? new Date(customStart) : new Date(now.getTime() - 60 * 60 * 1000),
        end: customEnd ? new Date(customEnd) : now,
      };
    } else {
      // Default: current session
      return {
        start: currentSessionStartTime ? new Date(currentSessionStartTime) : new Date(now.getTime() - 2 * 60 * 60 * 1000),
        end: currentSessionEndTime ? new Date(currentSessionEndTime) : now,
      };
    }
  };

  const handleStartExport = async (e) => {
    e.preventDefault();
    if (!classId) return;

    setIsSubmitting(true);
    setErrorMessage('');
    setJobResult(null);

    try {
      const { start, end } = calculateTimeRange();

      const newJobRef = await addDoc(collection(db, 'reportJobs'), {
        classId,
        startTime: start,
        endTime: end,
        format: exportFormat,
        includeScreenshots,
        includeAudioTranscripts,
        includeGazeLogs,
        studentUids: selectedStudentFilter === 'specific' ? selectedStudentUids : null,
        requesterUid: user?.uid || '',
        requesterEmail: sendEmailNotification ? notificationEmail : null,
        status: 'pending',
        createdAt: serverTimestamp(),
      });

      setActiveJobId(newJobRef.id);
      setJobStatus('pending');
    } catch (err) {
      console.error('Failed to submit report job:', err);
      setErrorMessage(err.message || 'Failed to submit report generation request');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStudentCheckbox = (uid) => {
    setSelectedStudentUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem',
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          backgroundColor: '#1e293b',
          color: '#f8fafc',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '2rem',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0 }}>
              📄 Export Formal Exam Incident Dossier
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: '0.25rem 0 0 0' }}>
              Generate official Microsoft Word (.docx) & CSV incident reports with time filters
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1.5rem',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        {/* --- FORM OR ACTIVE JOB STATUS --- */}
        {!activeJobId ? (
          <form onSubmit={handleStartExport}>
            {/* 1. Time Period Scoping */}
            <div style={{ marginBottom: '1.25rem', padding: '1rem', backgroundColor: '#0f172a', borderRadius: '10px' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                ⏱️ 1. Examination Period Filter
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
                {[
                  { id: 'session', label: 'Current Session' },
                  { id: '1h', label: 'Past 1 Hour' },
                  { id: '3h', label: 'Past 3 Hours' },
                  { id: 'custom', label: 'Custom Range' },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setTimePreset(p.id)}
                    style={{
                      padding: '0.5rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: '600',
                      border: '1px solid #334155',
                      backgroundColor: timePreset === p.id ? '#2563eb' : '#1e293b',
                      color: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {timePreset === 'custom' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Start Time</span>
                    <input
                      type="datetime-local"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.4rem',
                        borderRadius: '6px',
                        backgroundColor: '#1e293b',
                        color: '#fff',
                        border: '1px solid #475569',
                      }}
                      required
                    />
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>End Time</span>
                    <input
                      type="datetime-local"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.4rem',
                        borderRadius: '6px',
                        backgroundColor: '#1e293b',
                        color: '#fff',
                        border: '1px solid #475569',
                      }}
                      required
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 2. Format Selection */}
            <div style={{ marginBottom: '1.25rem', padding: '1rem', backgroundColor: '#0f172a', borderRadius: '10px' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                📁 2. Export Format
              </label>
              <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.875rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="exportFormat"
                    value="both"
                    checked={exportFormat === 'both'}
                    onChange={(e) => setExportFormat(e.target.value)}
                  />
                  <span>Both (.docx + .csv) [Recommended]</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="exportFormat"
                    value="docx"
                    checked={exportFormat === 'docx'}
                    onChange={(e) => setExportFormat(e.target.value)}
                  />
                  <span>MS Word (.docx only)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="exportFormat"
                    value="csv"
                    checked={exportFormat === 'csv'}
                    onChange={(e) => setExportFormat(e.target.value)}
                  />
                  <span>CSV Log (.csv only)</span>
                </label>
              </div>
            </div>

            {/* 3. Evidence & Artifact Inclusions */}
            <div style={{ marginBottom: '1.25rem', padding: '1rem', backgroundColor: '#0f172a', borderRadius: '10px' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                🔍 3. Include Evidence & Telemetry
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', fontSize: '0.85rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={includeScreenshots}
                    onChange={(e) => setIncludeScreenshots(e.target.checked)}
                  />
                  <span>📸 Screenshot Evidence</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={includeAudioTranscripts}
                    onChange={(e) => setIncludeAudioTranscripts(e.target.checked)}
                  />
                  <span>🎙️ Audio Transcripts</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={includeGazeLogs}
                    onChange={(e) => setIncludeGazeLogs(e.target.checked)}
                  />
                  <span>👁️ Gaze & Head Pose</span>
                </label>
              </div>
            </div>

            {/* 4. Student Scope Filter */}
            <div style={{ marginBottom: '1.25rem', padding: '1rem', backgroundColor: '#0f172a', borderRadius: '10px' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                👥 4. Student Scope
              </label>
              <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="studentScope"
                    value="all"
                    checked={selectedStudentFilter === 'all'}
                    onChange={() => setSelectedStudentFilter('all')}
                  />
                  <span>All Students in Class ({students.length})</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="studentScope"
                    value="specific"
                    checked={selectedStudentFilter === 'specific'}
                    onChange={() => setSelectedStudentFilter('specific')}
                  />
                  <span>Select Specific Students</span>
                </label>
              </div>

              {selectedStudentFilter === 'specific' && (
                <div style={{ maxHeight: '120px', overflowY: 'auto', backgroundColor: '#1e293b', padding: '0.5rem', borderRadius: '6px' }}>
                  {students.map((s) => (
                    <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', padding: '0.2rem 0', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selectedStudentUids.includes(s.id)}
                        onChange={() => handleStudentCheckbox(s.id)}
                      />
                      <span>{s.name || s.email} ({s.email})</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* 5. Email Notification Toggle */}
            <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#0f172a', borderRadius: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: 'bold', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={sendEmailNotification}
                  onChange={(e) => setSendEmailNotification(e.target.checked)}
                />
                <span>📧 Email me download links when ready (Cloud 9-min worker)</span>
              </label>
              {sendEmailNotification && (
                <input
                  type="email"
                  value={notificationEmail}
                  onChange={(e) => setNotificationEmail(e.target.value)}
                  placeholder="instructor@example.com"
                  style={{
                    width: '100%',
                    marginTop: '0.5rem',
                    padding: '0.4rem',
                    borderRadius: '6px',
                    backgroundColor: '#1e293b',
                    color: '#fff',
                    border: '1px solid #475569',
                    fontSize: '0.85rem',
                  }}
                  required
                />
              )}
            </div>

            {errorMessage && (
              <p style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '1rem' }}>
                ⚠️ {errorMessage}
              </p>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '0.6rem 1.2rem',
                  borderRadius: '8px',
                  backgroundColor: '#334155',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                style={{
                  padding: '0.6rem 1.75rem',
                  borderRadius: '8px',
                  backgroundColor: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 'bold',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                {isSubmitting ? 'Submitting...' : '🚀 Generate Official Dossier'}
              </button>
            </div>
          </form>
        ) : (
          /* Active Job Progress View */
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            {jobStatus === 'completed' && jobResult ? (
              <div>
                <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>✅</div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: '0 0 0.5rem 0' }}>
                  Incident Dossier Generated Successfully!
                </h3>
                <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1.5rem' }}>
                  Summarized {jobResult.summary?.totalStudents || 0} students and {jobResult.summary?.totalIrregularities || 0} flagged incidents.
                </p>

                <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
                  {jobResult.docxUrl && (
                    <a
                      href={jobResult.docxUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                      style={{
                        padding: '0.75rem 1.5rem',
                        borderRadius: '8px',
                        backgroundColor: '#1d4ed8',
                        color: '#fff',
                        textDecoration: 'none',
                        fontWeight: 'bold',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      📄 Download Word Dossier (.docx)
                    </a>
                  )}

                  {jobResult.csvUrl && (
                    <a
                      href={jobResult.csvUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                      style={{
                        padding: '0.75rem 1.5rem',
                        borderRadius: '8px',
                        backgroundColor: '#059669',
                        color: '#fff',
                        textDecoration: 'none',
                        fontWeight: 'bold',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      📊 Download Incident Log (.csv)
                    </a>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setActiveJobId(null);
                    onClose();
                  }}
                  style={{
                    padding: '0.5rem 1.5rem',
                    borderRadius: '6px',
                    backgroundColor: '#334155',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Done
                </button>
              </div>
            ) : jobStatus === 'failed' ? (
              <div>
                <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>❌</div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#ef4444' }}>
                  Report Generation Failed
                </h3>
                <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1.5rem' }}>
                  {errorMessage}
                </p>
                <button
                  type="button"
                  onClick={() => setActiveJobId(null)}
                  style={{
                    padding: '0.5rem 1.25rem',
                    borderRadius: '6px',
                    backgroundColor: '#2563eb',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Try Again
                </button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>⏳</div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: '0 0 0.5rem 0' }}>
                  Generating Incident Dossier in Background...
                </h3>
                <p style={{ fontSize: '0.85rem', color: '#94a3b8', maxWidth: '400px', margin: '0 auto 1.5rem auto' }}>
                  Our Cloud Function is compiling student telemetry, audio transcripts, and screenshot evidence. An email notification will also be sent.
                </p>
                <div style={{ display: 'inline-block', padding: '0.4rem 1rem', borderRadius: '999px', backgroundColor: '#0f172a', fontSize: '0.8rem', color: '#38bdf8', border: '1px solid #334155' }}>
                  Status: {jobStatus === 'processing' ? 'Processing & Packaging .docx / .csv...' : 'Queued...'}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
