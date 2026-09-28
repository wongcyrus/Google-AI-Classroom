import React, { useState, useMemo } from 'react';
import StudentBadge from './common/StudentBadge';
import { exportStudentRosterExcel } from '../utils/studentDisplayUtils';
import './EnrolledRosterModal.css';

/**
 * EnrolledRosterModal
 *
 * Fullscreen / Enlarged modal dialog displaying the enrolled student roster
 * with multi-attribute filtering, column sorting, search, passkey status management,
 * and export/copy utilities.
 */
const EnrolledRosterModal = ({
  show,
  onClose,
  className = '',
  classId = '',
  emailList = [],
  resolvedProfilesMap = {},
  registeredPasskeysMap = {},
  resettingPasskeys = {},
  onResetPasskey,
  passkeyResetSuccess = '',
  onClearPasskeyResetSuccess,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [passkeyFilter, setPasskeyFilter] = useState('all'); // 'all' | 'linked' | 'unlinked'
  const [profileFilter, setProfileFilter] = useState('all'); // 'all' | 'has_profile' | 'missing_profile' | 'directory'
  const [cohortFilter, setCohortFilter] = useState('all');
  const [sortColumn, setSortColumn] = useState('displayName'); // 'displayName' | 'email' | 'studentName' | 'studentClass' | 'programme' | 'passkey'
  const [sortDirection, setSortDirection] = useState('asc'); // 'asc' | 'desc'
  const [copiedNotification, setCopiedNotification] = useState('');

  // Extract unique cohorts from resolved profiles
  const uniqueCohorts = useMemo(() => {
    const cohorts = new Set();
    emailList.forEach(email => {
      const prof = resolvedProfilesMap[email] || {};
      if (prof.studentClass && prof.studentClass.trim()) {
        cohorts.add(prof.studentClass.trim());
      }
    });
    return Array.from(cohorts).sort();
  }, [emailList, resolvedProfilesMap]);

  // Overall Statistics
  const stats = useMemo(() => {
    let withProfile = 0;
    let linkedPasskeys = 0;
    let directoryEnriched = 0;

    emailList.forEach(email => {
      const norm = (email || '').toLowerCase();
      const prof = resolvedProfilesMap[email] || {};
      if (prof.studentName || prof.nickname) {
        withProfile++;
      }
      if (prof._fromDirectory) {
        directoryEnriched++;
      }
      if (registeredPasskeysMap[norm] || (prof.uid && registeredPasskeysMap[prof.uid])) {
        linkedPasskeys++;
      }
    });

    return {
      total: emailList.length,
      withProfile,
      linkedPasskeys,
      unlinkedPasskeys: emailList.length - linkedPasskeys,
      directoryEnriched,
    };
  }, [emailList, resolvedProfilesMap, registeredPasskeysMap]);

  // Handle column sort toggle
  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Filtered and Sorted Student List
  const filteredStudents = useMemo(() => {
    const query = (searchTerm || '').trim().toLowerCase();

    const filtered = emailList.filter(email => {
      const norm = (email || '').toLowerCase();
      const prof = resolvedProfilesMap[email] || {};
      const studentName = (prof.studentName || '').toLowerCase();
      const nickname = (prof.nickname || '').toLowerCase();
      const studentClass = (prof.studentClass || '').toLowerCase();
      const programme = (prof.programme || '').toLowerCase();
      const isPasskeyLinked = Boolean(registeredPasskeysMap[norm] || (prof.uid && registeredPasskeysMap[prof.uid]));
      const hasProfileMeta = Boolean(prof.studentName || prof.nickname);

      // Search query filter
      if (query) {
        const matchesQuery =
          norm.includes(query) ||
          studentName.includes(query) ||
          nickname.includes(query) ||
          studentClass.includes(query) ||
          programme.includes(query);
        if (!matchesQuery) return false;
      }

      // Passkey filter
      if (passkeyFilter === 'linked' && !isPasskeyLinked) return false;
      if (passkeyFilter === 'unlinked' && isPasskeyLinked) return false;

      // Profile filter
      if (profileFilter === 'has_profile' && !hasProfileMeta) return false;
      if (profileFilter === 'missing_profile' && hasProfileMeta) return false;
      if (profileFilter === 'directory' && !prof._fromDirectory) return false;

      // Cohort filter
      if (cohortFilter !== 'all' && (prof.studentClass || '').trim() !== cohortFilter) {
        return false;
      }

      return true;
    });

    // Sort items
    filtered.sort((a, b) => {
      const profA = resolvedProfilesMap[a] || {};
      const profB = resolvedProfilesMap[b] || {};
      const normA = (a || '').toLowerCase();
      const normB = (b || '').toLowerCase();

      let valA = '';
      let valB = '';

      switch (sortColumn) {
        case 'email':
          valA = normA;
          valB = normB;
          break;
        case 'studentName':
          valA = (profA.studentName || '').toLowerCase();
          valB = (profB.studentName || '').toLowerCase();
          break;
        case 'studentClass':
          valA = (profA.studentClass || '').toLowerCase();
          valB = (profB.studentClass || '').toLowerCase();
          break;
        case 'programme':
          valA = (profA.programme || '').toLowerCase();
          valB = (profB.programme || '').toLowerCase();
          break;
        case 'passkey': {
          const passA = Boolean(registeredPasskeysMap[normA] || (profA.uid && registeredPasskeysMap[profA.uid])) ? 1 : 0;
          const passB = Boolean(registeredPasskeysMap[normB] || (profB.uid && registeredPasskeysMap[profB.uid])) ? 1 : 0;
          return sortDirection === 'asc' ? passB - passA : passA - passB;
        }
        case 'displayName':
        default:
          valA = (profA.nickname || profA.studentName || normA).toLowerCase();
          valB = (profB.nickname || profB.studentName || normB).toLowerCase();
          break;
      }

      const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
      return sortDirection === 'asc' ? cmp : -cmp;
    });

    return filtered;
  }, [
    emailList,
    resolvedProfilesMap,
    registeredPasskeysMap,
    searchTerm,
    passkeyFilter,
    profileFilter,
    cohortFilter,
    sortColumn,
    sortDirection,
  ]);

  const hasActiveFilters = Boolean(
    searchTerm.trim() ||
    passkeyFilter !== 'all' ||
    profileFilter !== 'all' ||
    cohortFilter !== 'all'
  );

  const handleClearFilters = () => {
    setSearchTerm('');
    setPasskeyFilter('all');
    setProfileFilter('all');
    setCohortFilter('all');
  };

  const handleCopyEmails = async () => {
    try {
      const emailsText = filteredStudents.join('\n');
      await navigator.clipboard.writeText(emailsText);
      setCopiedNotification(`Copied ${filteredStudents.length} email(s) to clipboard!`);
      setTimeout(() => setCopiedNotification(''), 3500);
    } catch (err) {
      console.error('Failed to copy emails:', err);
    }
  };

  const handleExportFilteredExcel = async () => {
    try {
      const exportProfiles = {};
      filteredStudents.forEach(email => {
        exportProfiles[email] = resolvedProfilesMap[email] || {};
      });
      const blob = await exportStudentRosterExcel(filteredStudents, exportProfiles, classId || 'Class');
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Student_Roster_${classId || 'Class'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export roster Excel:', err);
      alert(`Export failed: ${err.message || 'Unknown error'}`);
    }
  };

  if (!show) return null;

  return (
    <div className="roster-modal-backdrop" onClick={onClose} data-testid="enrolled-roster-modal">
      <div className="roster-modal-container" onClick={e => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="roster-modal-header">
          <div>
            <h3>
              <span>📋 Enrolled Roster Details</span>
              {className && <span style={{ fontSize: '0.95rem', fontWeight: 500, color: 'var(--color-text-muted, #64748b)' }}>— {className}</span>}
            </h3>
            <div className="roster-header-chips" style={{ marginTop: '0.4rem' }}>
              <span className="roster-chip roster-chip-info" title="Total students registered in this class roster">
                👥 {stats.total} Total Students
              </span>
              <span className="roster-chip roster-chip-success" title="Students with full display name or nickname">
                🏷️ {stats.withProfile}/{stats.total} Profile Metadata
              </span>
              <span className="roster-chip roster-chip-warning" title="Students with mobile passkeys registered on hardware">
                📱 {stats.linkedPasskeys}/{stats.total} Passkeys Linked
              </span>
              {stats.directoryEnriched > 0 && (
                <span className="roster-chip roster-chip-purple" title="Students whose names were automatically retrieved from institutional directory">
                  ✨ {stats.directoryEnriched} Auto-filled Directory
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="roster-close-btn"
            onClick={onClose}
            aria-label="Close"
            title="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Toolbar & Filters */}
        <div className="roster-modal-toolbar">
          <div className="roster-filter-controls">
            {/* Search Input */}
            <div className="roster-search-box">
              <input
                type="text"
                className="roster-search-input"
                placeholder="🔍 Search name, email, cohort..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                aria-label="Search student roster"
                data-testid="roster-search-input"
              />
              {searchTerm && (
                <button
                  type="button"
                  className="roster-search-clear"
                  onClick={() => setSearchTerm('')}
                  title="Clear search text"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Passkey Filter */}
            <select
              className="roster-select-filter"
              value={passkeyFilter}
              onChange={e => setPasskeyFilter(e.target.value)}
              aria-label="Filter by Passkey Status"
              data-testid="roster-filter-passkey"
            >
              <option value="all">All Passkey Statuses</option>
              <option value="linked">📱 Linked Only ({stats.linkedPasskeys})</option>
              <option value="unlinked">⏳ Not Registered ({stats.unlinkedPasskeys})</option>
            </select>

            {/* Profile Filter */}
            <select
              className="roster-select-filter"
              value={profileFilter}
              onChange={e => setProfileFilter(e.target.value)}
              aria-label="Filter by Profile Status"
              data-testid="roster-filter-profile"
            >
              <option value="all">All Profiles</option>
              <option value="has_profile">✅ Has Metadata ({stats.withProfile})</option>
              <option value="missing_profile">⚠️ Missing Profile ({stats.total - stats.withProfile})</option>
              {stats.directoryEnriched > 0 && (
                <option value="directory">✨ Directory Auto-filled ({stats.directoryEnriched})</option>
              )}
            </select>

            {/* Cohort Filter */}
            {uniqueCohorts.length > 0 && (
              <select
                className="roster-select-filter"
                value={cohortFilter}
                onChange={e => setCohortFilter(e.target.value)}
                aria-label="Filter by Cohort / Class"
                data-testid="roster-filter-cohort"
              >
                <option value="all">All Cohorts ({uniqueCohorts.length})</option>
                {uniqueCohorts.map(cohort => (
                  <option key={cohort} value={cohort}>
                    {cohort}
                  </option>
                ))}
              </select>
            )}

            {/* Clear Filters Button */}
            {hasActiveFilters && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={handleClearFilters}
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                data-testid="btn-clear-roster-filters"
              >
                ✕ Reset Filters
              </button>
            )}
          </div>

          {/* Action Buttons */}
          <div className="roster-toolbar-actions">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={handleCopyEmails}
              disabled={filteredStudents.length === 0}
              title="Copy filtered student email list to clipboard"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
              data-testid="btn-roster-copy-emails"
            >
              📋 Copy Emails ({filteredStudents.length})
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={handleExportFilteredExcel}
              disabled={filteredStudents.length === 0}
              title="Export current filtered roster to standard Excel format"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
              data-testid="btn-roster-export-excel"
            >
              📤 Export Excel
            </button>
          </div>
        </div>

        {/* Copy Notification Toast */}
        {copiedNotification && (
          <div className="roster-alert-bar" style={{ backgroundColor: '#e0f2fe', color: '#0369a1', borderColor: '#bae6fd' }}>
            <span>📋 {copiedNotification}</span>
            <button
              type="button"
              onClick={() => setCopiedNotification('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Passkey Reset Success Alert */}
        {passkeyResetSuccess && (
          <div className="roster-alert-bar">
            <span>✅ {passkeyResetSuccess}</span>
            {onClearPasskeyResetSuccess && (
              <button
                type="button"
                onClick={onClearPasskeyResetSuccess}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* Roster Table */}
        <div className="roster-modal-body">
          {filteredStudents.length === 0 ? (
            <div className="roster-empty-state">
              <div style={{ fontSize: '2rem' }}>🔍</div>
              <p>No students match your filter criteria.</p>
              {hasActiveFilters && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={handleClearFilters}
                  style={{ marginTop: '0.75rem' }}
                >
                  Clear Filters
                </button>
              )}
            </div>
          ) : (
            <table className="roster-table" data-testid="enrolled-roster-table">
              <thead>
                <tr>
                  <th
                    className={`sortable ${sortColumn === 'displayName' ? 'sorted' : ''}`}
                    onClick={() => handleSort('displayName')}
                    title="Click to sort by Student Display Name"
                  >
                    Student Display Name
                    <span className="roster-sort-icon">
                      {sortColumn === 'displayName' ? (sortDirection === 'asc' ? '▲' : '▼') : '⇅'}
                    </span>
                  </th>
                  <th
                    className={`sortable ${sortColumn === 'email' ? 'sorted' : ''}`}
                    onClick={() => handleSort('email')}
                    title="Click to sort by Email"
                  >
                    Email
                    <span className="roster-sort-icon">
                      {sortColumn === 'email' ? (sortDirection === 'asc' ? '▲' : '▼') : '⇅'}
                    </span>
                  </th>
                  <th
                    className={`sortable ${sortColumn === 'studentName' ? 'sorted' : ''}`}
                    onClick={() => handleSort('studentName')}
                    title="Click to sort by Full Legal Name"
                  >
                    Student Name
                    <span className="roster-sort-icon">
                      {sortColumn === 'studentName' ? (sortDirection === 'asc' ? '▲' : '▼') : '⇅'}
                    </span>
                  </th>
                  <th
                    className={`sortable ${sortColumn === 'studentClass' ? 'sorted' : ''}`}
                    onClick={() => handleSort('studentClass')}
                    title="Click to sort by Class / Cohort"
                  >
                    Class / Cohort
                    <span className="roster-sort-icon">
                      {sortColumn === 'studentClass' ? (sortDirection === 'asc' ? '▲' : '▼') : '⇅'}
                    </span>
                  </th>
                  <th
                    className={`sortable ${sortColumn === 'programme' ? 'sorted' : ''}`}
                    onClick={() => handleSort('programme')}
                    title="Click to sort by Programme"
                  >
                    Programme
                    <span className="roster-sort-icon">
                      {sortColumn === 'programme' ? (sortDirection === 'asc' ? '▲' : '▼') : '⇅'}
                    </span>
                  </th>
                  <th
                    className={`sortable ${sortColumn === 'passkey' ? 'sorted' : ''}`}
                    onClick={() => handleSort('passkey')}
                    style={{ textAlign: 'center' }}
                    title="Click to sort by Phone Passkey Registration Status"
                  >
                    Phone Passkey
                    <span className="roster-sort-icon">
                      {sortColumn === 'passkey' ? (sortDirection === 'asc' ? '▲' : '▼') : '⇅'}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((email, idx) => {
                  const prof = resolvedProfilesMap[email] || {};
                  const resolvedStudentName = prof.studentName || '';
                  const norm = (email || '').toLowerCase();
                  const passkey = registeredPasskeysMap[norm] || (prof.uid && registeredPasskeysMap[prof.uid]);

                  return (
                    <tr key={`${email}-${idx}`}>
                      <td>
                        <StudentBadge student={{ email, ...prof }} showCohort={false} size="sm" />
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: '#334155' }}>
                        {email}
                      </td>
                      <td>
                        {resolvedStudentName ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{ fontWeight: 500 }}>{resolvedStudentName}</span>
                            {prof._fromDirectory && (
                              <span
                                title="Auto-filled from institutional student directory (provided by another class)"
                                style={{
                                  fontSize: '0.68rem',
                                  fontWeight: 600,
                                  padding: '0.05rem 0.35rem',
                                  borderRadius: '4px',
                                  backgroundColor: '#e0e7ff',
                                  color: '#4338ca',
                                }}
                              >
                                ✨ Directory
                              </span>
                            )}
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>—</span>
                        )}
                      </td>
                      <td>
                        {prof.studentClass ? (
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '0.1rem 0.45rem',
                              fontSize: '0.74rem',
                              fontWeight: 700,
                              borderRadius: '9999px',
                              backgroundColor: 'rgba(99, 102, 241, 0.12)',
                              color: 'var(--color-primary, #6366f1)',
                              border: '1px solid rgba(99, 102, 241, 0.25)',
                            }}
                          >
                            {prof.studentClass}
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>—</span>
                        )}
                      </td>
                      <td style={{ color: '#475569' }}>
                        {prof.programme || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {passkey ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                            <span
                              style={{
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                padding: '0.12rem 0.45rem',
                                borderRadius: '9999px',
                                backgroundColor: '#dcfce7',
                                color: '#15803d',
                                border: '1px solid #bbf7d0',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                              }}
                              title={`Registered on ${passkey.deviceModel || 'Mobile Device'}`}
                            >
                              📱 Linked
                            </span>
                            {onResetPasskey && (
                              <button
                                type="button"
                                className="btn-secondary btn-sm"
                                style={{
                                  fontSize: '0.72rem',
                                  padding: '0.15rem 0.45rem',
                                  color: '#b91c1c',
                                  borderColor: '#fca5a5',
                                  background: '#fff',
                                  cursor: 'pointer',
                                }}
                                onClick={() => onResetPasskey(email, resolvedStudentName)}
                                disabled={Boolean(resettingPasskeys[email])}
                                data-testid={`btn-modal-reset-passkey-${email.replace(/[@.]/g, '_')}`}
                                title="Unlink phone passkey if student replaced their device"
                              >
                                {resettingPasskeys[email] ? 'Resetting...' : '🔄 Reset'}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              padding: '0.12rem 0.45rem',
                              borderRadius: '9999px',
                              backgroundColor: '#fef3c7',
                              color: '#b45309',
                              border: '1px solid #fde68a',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                            }}
                            title="Student has not registered a passkey on their mobile device yet"
                          >
                            ⏳ Not Registered
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Modal Footer */}
        <div className="roster-modal-footer">
          <div className="roster-footer-stats">
            <span>
              Showing <strong>{filteredStudents.length}</strong> of <strong>{emailList.length}</strong> enrolled students
            </span>
            {hasActiveFilters && (
              <span style={{ color: '#6366f1', fontWeight: 600 }}>
                (Filters active)
              </span>
            )}
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            style={{ padding: '0.45rem 1.25rem', fontSize: '0.88rem' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default EnrolledRosterModal;
