import React, { useState, useRef } from 'react';
import {
  parseStudentRosterCsv,
  generateStudentRosterTemplateCsv,
  readTextFileWithEncoding,
  normalizeStudentEmail,
} from '../utils/studentDisplayUtils';
import StudentBadge from './common/StudentBadge';
import './BatchStudentUploadModal.css';

/**
 * Modal dialog for batch uploading or pasting student rosters.
 * Supports: Student Name, Nickname (including Chinese), Programme, and Student Class (Cohort).
 * Accommodates students with partial or missing profile fields.
 */
const BatchStudentUploadModal = ({
  isOpen,
  onClose,
  onApply,
  existingEmails = [],
  existingProfiles = {},
  classId = '',
}) => {
  const [inputText, setInputText] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsedData, setParsedData] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [importMode, setImportMode] = useState('merge'); // 'merge' | 'replace'
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const handleDownloadTemplate = () => {
    const templateContent = generateStudentRosterTemplateCsv();
    const blob = new Blob([templateContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'student_roster_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setParseError(null);

    try {
      const content = await readTextFileWithEncoding(file);
      setInputText(content);
      processRosterText(content);
    } catch (err) {
      console.error('Error reading roster file:', err);
      setParseError('Failed to read selected file. Please ensure it is a valid CSV or text file.');
    }
    e.target.value = '';
  };

  const handleTextChange = (e) => {
    const text = e.target.value;
    setInputText(text);
    if (fileName) setFileName(''); // clear file name if manually edited
    processRosterText(text);
  };

  const processRosterText = (text) => {
    setParseError(null);
    if (!text || !text.trim()) {
      setParsedData(null);
      return;
    }

    try {
      const result = parseStudentRosterCsv(text);
      if (result.students.length === 0 && result.invalidRows.length > 0) {
        setParseError(`Could not find valid student emails. Example: ${result.invalidRows[0].reason}`);
      }
      setParsedData(result);
    } catch (err) {
      console.error('Error parsing roster text:', err);
      setParseError(`Parsing error: ${err.message}`);
      setParsedData(null);
    }
  };

  const handleApply = () => {
    if (!parsedData || parsedData.students.length === 0) {
      alert('Please upload or paste valid student roster data before applying.');
      return;
    }

    let finalEmails = [];
    let finalProfiles = {};

    if (importMode === 'replace') {
      finalEmails = [...parsedData.emailList];
      finalProfiles = { ...parsedData.profilesMap };
    } else {
      // Merge mode
      const rawExisting = Array.isArray(existingEmails)
        ? existingEmails
        : String(existingEmails).split(/[\n,]+/).map(normalizeStudentEmail).filter(Boolean);

      const emailSet = new Set(rawExisting.map(normalizeStudentEmail).filter(Boolean));
      parsedData.emailList.forEach(e => emailSet.add(e));
      finalEmails = Array.from(emailSet);

      finalProfiles = {
        ...existingProfiles,
        ...parsedData.profilesMap,
      };
    }

    onApply({
      studentEmails: finalEmails,
      studentProfiles: finalProfiles,
      addedCount: parsedData.students.length,
    });
    onClose();
  };

  const counts = parsedData ? {
    total: parsedData.students.length,
    full: parsedData.students.filter(s => s.studentName && s.studentClass).length,
    partial: parsedData.students.filter(s => s.hasProfile && !(s.studentName && s.studentClass)).length,
    emailOnly: parsedData.students.filter(s => !s.hasProfile).length,
    invalid: parsedData.invalidRows.length,
  } : null;

  return (
    <div className="batch-roster-modal-backdrop" onClick={onClose}>
      <div className="batch-roster-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="batch-roster-header">
          <div>
            <h3>👥 Batch Upload Student Roster</h3>
            <p className="batch-roster-subtitle">
              Import student name, nickname, programme, and student class (cohort).
            </p>
          </div>
          <button type="button" className="batch-roster-close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Action / Help Banner */}
        <div className="batch-roster-toolbar">
          <div className="batch-roster-actions-left">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={handleDownloadTemplate}
              title="Download standard CSV template with sample columns"
            >
              📥 Download CSV Template
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => fileInputRef.current?.click()}
            >
              📂 Choose File (.csv, .tsv, .txt)
            </button>
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv,.tsv,.txt"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            {fileName && <span className="batch-roster-filename">📄 {fileName}</span>}
          </div>

          <div className="batch-roster-mode-selector">
            <label className="mode-radio-label">
              <input
                type="radio"
                name="importMode"
                value="merge"
                checked={importMode === 'merge'}
                onChange={() => setImportMode('merge')}
              />
              <span>Merge with existing</span>
            </label>
            <label className="mode-radio-label">
              <input
                type="radio"
                name="importMode"
                value="replace"
                checked={importMode === 'replace'}
                onChange={() => setImportMode('replace')}
              />
              <span>Replace entire roster</span>
            </label>
          </div>
        </div>

        {/* Input Textarea for Paste or Drag-Drop */}
        <div className="batch-roster-input-section">
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-main, #334155)' }}>
            Paste CSV / TSV Rows or Spreadsheet Cells Below:
          </label>
          <textarea
            className="batch-roster-textarea"
            rows="5"
            placeholder={`StudentEmail,StudentName,Nickname,Programme,Class
230123456@stu.vtc.edu.hk,Chan Tai Man,大文,Higher Diploma in Software Engineering,IT114115/1A
230987654@stu.vtc.edu.hk,Wong Ka Yan,阿欣,Higher Diploma in Software Engineering,IT114115/1B`}
            value={inputText}
            onChange={handleTextChange}
          />
          <p className="batch-roster-hint">
            💡 <em>Note:</em> Headers are <strong>English only</strong>. Unicode characters (including Chinese names and Chinese nicknames) are fully supported across CSV export and import. Students missing names or cohorts will gracefully fall back to email or nickname.
          </p>
        </div>

        {/* Parse Status / Summary Alert */}
        {parseError && (
          <div className="batch-roster-alert alert-error">
            ⚠️ {parseError}
          </div>
        )}

        {counts && (
          <div className="batch-roster-alert alert-success">
            <strong>✅ Parsed {counts.total} student{counts.total !== 1 ? 's' : ''}:</strong>
            {' '}{counts.full} complete profile{counts.full !== 1 ? 's' : ''},
            {' '}{counts.partial} partial,
            {' '}{counts.emailOnly} email-only (graceful fallback).
            {counts.invalid > 0 && ` (${counts.invalid} invalid rows skipped)`}
          </div>
        )}

        {/* Live Preview Table */}
        {parsedData && parsedData.students.length > 0 && (
          <div className="batch-roster-preview-section">
            <h4 style={{ margin: '0 0 0.4rem 0', fontSize: '0.9rem', color: 'var(--color-text-main, #334155)' }}>
              Live Roster Preview ({parsedData.students.length} students):
            </h4>
            <div className="batch-roster-table-wrapper">
              <table className="batch-roster-preview-table">
                <thead>
                  <tr>
                    <th>Display Name Preview</th>
                    <th>Email</th>
                    <th>Student Name</th>
                    <th>Nickname</th>
                    <th>Cohort / Class</th>
                    <th>Programme</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedData.students.map((student, idx) => (
                    <tr key={idx} className={!student.hasProfile ? 'row-email-only' : ''}>
                      <td>
                        <StudentBadge student={student} showCohort={true} size="sm" />
                      </td>
                      <td><code>{student.email}</code></td>
                      <td>{student.studentName || student.fullName || <span className="muted-dash">—</span>}</td>
                      <td>{student.nickname || <span className="muted-dash">—</span>}</td>
                      <td>
                        {student.studentClass ? (
                          <span className="preview-cohort-pill">{student.studentClass}</span>
                        ) : (
                          <span className="muted-dash">—</span>
                        )}
                      </td>
                      <td style={{ maxWidth: '180px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {student.programme || <span className="muted-dash">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="batch-roster-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleApply}
            disabled={!parsedData || parsedData.students.length === 0}
          >
            Apply to Class Roster ({parsedData?.students?.length || 0})
          </button>
        </div>
      </div>
    </div>
  );
};

export default BatchStudentUploadModal;
