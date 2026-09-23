import React from 'react';

/**
 * DriveBackupProgressModal
 * Displays batch streaming progress when archiving student videos into Google Drive.
 */
export default function DriveBackupProgressModal({
  show,
  onClose,
  onCancel,
  isProcessing,
  totalVideos,
  completedCount,
  failedCount,
  currentVideo,
  currentPercentage = 0,
  baseFolderName = 'Classroom Archives',
  videoStatuses = [],
}) {
  if (!show) return null;

  const overallPercent = totalVideos > 0 ? Math.round((completedCount / totalVideos) * 100) : 0;

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px',
      }}
    >
      <div
        className="modal-content"
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '620px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid #f1f5f9',
            background: 'linear-gradient(135deg, #f8fafc 0%, #ffffff 100%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.5rem' }}>📁</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#0f172a' }}>
                Google Drive Student Video Backup
              </h3>
              <p style={{ margin: '3px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
                Archiving into Google Drive: <strong>{baseFolderName}</strong> / [Class] / [Lesson] / Students / [Student]
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {/* Overall Batch Progress */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
              <span>Overall Progress ({completedCount} / {totalVideos} completed)</span>
              <span>{overallPercent}%</span>
            </div>
            <div style={{ width: '100%', height: '10px', backgroundColor: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${overallPercent}%`,
                  height: '100%',
                  backgroundColor: '#2563eb',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>

          {/* Current File Streaming Progress (if uploading) */}
          {isProcessing && currentVideo && (
            <div
              style={{
                padding: '14px 16px',
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '10px',
                marginBottom: '20px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                  <span className="animate-spin" style={{ display: 'inline-block', fontSize: '1rem' }}>⏳</span>
                  <span
                    style={{
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      color: '#166534',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={currentVideo.studentEmail}
                  >
                    Uploading: {currentVideo.studentEmail || 'Student Video'}
                  </span>
                </div>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#166534' }}>
                  {currentPercentage}%
                </span>
              </div>
              <div style={{ width: '100%', height: '6px', backgroundColor: '#dcfce7', borderRadius: '999px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${currentPercentage}%`,
                    height: '100%',
                    backgroundColor: '#16a34a',
                    transition: 'width 0.2s ease',
                  }}
                />
              </div>
            </div>
          )}

          {/* Video Item Details List */}
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '8px' }}>
            Batch Items Status:
          </div>
          <div
            style={{
              maxHeight: '220px',
              overflowY: 'auto',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '6px 0',
              backgroundColor: '#fafafa',
            }}
          >
            {videoStatuses.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontSize: '0.82rem' }}>
                Preparing backup queue...
              </div>
            ) : (
              videoStatuses.map((item, idx) => {
                const isItemUploading = item.status === 'uploading';
                const isItemSuccess = item.status === 'success';
                const isItemError = item.status === 'error';

                return (
                  <div
                    key={item.id || idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 14px',
                      borderBottom: idx < videoStatuses.length - 1 ? '1px solid #f1f5f9' : 'none',
                      backgroundColor: isItemUploading ? '#eff6ff' : 'transparent',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                      <span>
                        {isItemSuccess && '✅'}
                        {isItemError && '❌'}
                        {isItemUploading && '🔄'}
                        {!isItemSuccess && !isItemError && !isItemUploading && '⏳'}
                      </span>
                      <span
                        style={{
                          fontSize: '0.82rem',
                          color: isItemError ? '#b91c1c' : '#334155',
                          fontWeight: isItemUploading ? 600 : 400,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '320px',
                        }}
                      >
                        {item.studentEmail || item.id}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {isItemSuccess && item.webViewLink && (
                        <a
                          href={item.webViewLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: '0.78rem',
                            color: '#2563eb',
                            textDecoration: 'none',
                            fontWeight: 600,
                          }}
                        >
                          View in Drive ↗
                        </a>
                      )}
                      {isItemError && (
                        <span style={{ fontSize: '0.75rem', color: '#ef4444' }} title={item.error}>
                          Failed
                        </span>
                      )}
                      {isItemUploading && (
                        <span style={{ fontSize: '0.78rem', color: '#2563eb', fontWeight: 600 }}>
                          {item.percentage || 0}%
                        </span>
                      )}
                      {!isItemSuccess && !isItemError && !isItemUploading && (
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Pending</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #f1f5f9',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
            background: '#f8fafc',
          }}
        >
          {isProcessing ? (
            <button
              onClick={onCancel}
              style={{
                padding: '8px 18px',
                borderRadius: '8px',
                backgroundColor: '#ef4444',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.86rem',
                cursor: 'pointer',
              }}
            >
              Cancel Backup
            </button>
          ) : (
            <button
              onClick={onClose}
              style={{
                padding: '8px 20px',
                borderRadius: '8px',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.86rem',
                cursor: 'pointer',
              }}
            >
              Done / Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
