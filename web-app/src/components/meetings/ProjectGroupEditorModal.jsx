import React, { useState, useMemo, useRef, useEffect } from 'react';
import NativeDialog from '../NativeDialog';
import {
  parseProjectGroupsText,
  parseProjectGroupsFile,
  downloadProjectGroupTemplateExcel,
  exportProjectGroupsExcel,
  autoSplitStudentsIntoGroups,
} from '../../utils/projectGroupUtils';
import { normalizeStudentEmail } from '../../utils/studentDisplayUtils';

export default function ProjectGroupEditorModal({
  isOpen,
  onClose,
  classId,
  existingGroups = [],
  enrolledStudents = [],
  studentProfiles = {},
  classTeachers = [],
  currentUserEmail = '',
  currentUserName = '',
  onSaveGroups,
}) {
  const [activeTab, setActiveTab] = useState('visual'); // 'visual' | 'import'
  const [draftGroups, setDraftGroups] = useState([]);
  const [unassignedSearch, setUnassignedSearch] = useState('');
  const [autoSplitSize, setAutoSplitSize] = useState(4);
  const [selectedTargetGroupIdx, setSelectedTargetGroupIdx] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  // Batch Import tab state
  const [importText, setImportText] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [parsedPreview, setParsedPreview] = useState(null);
  const [importError, setImportError] = useState('');
  const [importMode, setImportMode] = useState('merge'); // 'merge' | 'replace'
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      const cloned = (Array.isArray(existingGroups) ? existingGroups : []).map((g) => ({
        id: g.id || `grp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: g.name || 'Group',
        projectTopic: g.projectTopic || '',
        supervisorEmail: g.supervisorEmail || currentUserEmail || '',
        supervisorName: g.supervisorName || currentUserName || '',
        members: Array.isArray(g.members) ? g.members.map((m) => ({ ...m })) : [],
      }));
      setDraftGroups(cloned);
      setSelectedTargetGroupIdx(0);
      setImportError('');
    }
  }, [isOpen, existingGroups, currentUserEmail, currentUserName]);

  const assignedEmailsSet = useMemo(() => {
    const set = new Set();
    draftGroups.forEach((g) => {
      (g.members || []).forEach((m) => {
        const email = normalizeStudentEmail(m.email);
        if (email) set.add(email);
      });
    });
    return set;
  }, [draftGroups]);

  const unassignedStudents = useMemo(() => {
    const list = (Array.isArray(enrolledStudents) ? enrolledStudents : []).filter((s) => {
      const email = normalizeStudentEmail(s.email);
      return email && !assignedEmailsSet.has(email);
    });
    const q = unassignedSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (s) =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q)
    );
  }, [enrolledStudents, assignedEmailsSet, unassignedSearch]);

  if (!isOpen) return null;

  const handleAddGroup = () => {
    const nextNum = draftGroups.length + 1;
    const newGrp = {
      id: `grp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: `Group ${nextNum}`,
      projectTopic: '',
      supervisorEmail: currentUserEmail || '',
      supervisorName: currentUserName || '',
      members: [],
    };
    setDraftGroups((prev) => {
      const updated = [...prev, newGrp];
      setSelectedTargetGroupIdx(updated.length - 1);
      return updated;
    });
  };

  const handleRemoveGroup = (idx) => {
    setDraftGroups((prev) => prev.filter((_, i) => i !== idx));
    setSelectedTargetGroupIdx((prev) => Math.max(0, prev - 1));
  };

  const handleUpdateGroupField = (idx, field, value) => {
    setDraftGroups((prev) =>
      prev.map((g, i) => (i === idx ? { ...g, [field]: value } : g))
    );
  };

  const handleAssignStudentToGroup = (student, targetIdx = selectedTargetGroupIdx) => {
    let effectiveIdx = targetIdx;
    let currentList = draftGroups;
    if (currentList.length === 0) {
      const firstGrp = {
        id: `grp_${Date.now()}_1`,
        name: 'Group 1',
        projectTopic: '',
        supervisorEmail: currentUserEmail || '',
        supervisorName: currentUserName || '',
        members: [],
      };
      currentList = [firstGrp];
      effectiveIdx = 0;
    } else if (effectiveIdx < 0 || effectiveIdx >= currentList.length) {
      effectiveIdx = 0;
    }

    const email = normalizeStudentEmail(student.email);
    setDraftGroups(
      currentList.map((g, idx) => {
        if (idx !== effectiveIdx) return g;
        if (g.members.some((m) => normalizeStudentEmail(m.email) === email)) return g;
        return {
          ...g,
          members: [
            ...g.members,
            {
              uid: student.uid || email,
              email,
              name: student.name || student.studentName || email.split('@')[0],
              role: g.members.length === 0 ? 'Leader' : 'Member',
            },
          ],
        };
      })
    );
  };

  const handleRemoveMember = (groupIdx, memberEmail) => {
    const clean = normalizeStudentEmail(memberEmail);
    setDraftGroups((prev) =>
      prev.map((g, idx) =>
        idx === groupIdx
          ? { ...g, members: g.members.filter((m) => normalizeStudentEmail(m.email) !== clean) }
          : g
      )
    );
  };

  const handleToggleMemberRole = (groupIdx, memberEmail) => {
    const clean = normalizeStudentEmail(memberEmail);
    setDraftGroups((prev) =>
      prev.map((g, idx) =>
        idx === groupIdx
          ? {
              ...g,
              members: g.members.map((m) =>
                normalizeStudentEmail(m.email) === clean
                  ? { ...m, role: m.role === 'Leader' ? 'Member' : 'Leader' }
                  : m
              ),
            }
          : g
      )
    );
  };

  const handleMoveMember = (fromGroupIdx, member, toGroupIdx) => {
    const targetIdx = Number(toGroupIdx);
    if (Number.isNaN(targetIdx) || targetIdx === fromGroupIdx || targetIdx < 0 || targetIdx >= draftGroups.length) {
      return;
    }
    const clean = normalizeStudentEmail(member.email);
    setDraftGroups((prev) =>
      prev.map((g, idx) => {
        if (idx === fromGroupIdx) {
          return { ...g, members: g.members.filter((m) => normalizeStudentEmail(m.email) !== clean) };
        }
        if (idx === targetIdx) {
          if (g.members.some((m) => normalizeStudentEmail(m.email) === clean)) return g;
          return { ...g, members: [...g.members, { ...member }] };
        }
        return g;
      })
    );
  };

  const handleAutoSplitUnassigned = () => {
    if (unassignedStudents.length === 0) return;
    const newGroups = autoSplitStudentsIntoGroups({
      unassignedStudents,
      existingGroupsCount: draftGroups.length,
      groupSize: autoSplitSize,
      supervisorEmail: currentUserEmail || '',
      supervisorName: currentUserName || '',
    }).map((g, idx) => ({
      ...g,
      id: `grp_${Date.now()}_split_${idx}`,
    }));

    setDraftGroups((prev) => [...prev, ...newGroups]);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportError('');
    try {
      const result = await parseProjectGroupsFile(file, {
        existingProfiles: studentProfiles,
        defaultSupervisorEmail: currentUserEmail,
        defaultSupervisorName: currentUserName,
      });
      setParsedPreview(result);
      const previewLines = [
        `# Imported ${result.groups.length} groups (${result.totalStudents} students) from ${file.name}`,
        'GroupName,ProjectTopic,SupervisorEmail,StudentEmail,StudentName,Role',
        ...result.groups.flatMap((g) =>
          (g.members || []).map(
            (m) => `${g.name},${g.projectTopic || ''},${g.supervisorEmail || ''},${m.email},${m.name || ''},${m.role || 'Member'}`
          )
        ),
      ];
      setImportText(previewLines.join('\n'));
    } catch (err) {
      setImportError(`Failed to parse file: ${err.message}`);
    }
    e.target.value = '';
  };

  const handleImportTextChange = (e) => {
    const text = e.target.value;
    setImportText(text);
    setImportError('');
    if (!text.trim()) {
      setParsedPreview(null);
      return;
    }
    try {
      const result = parseProjectGroupsText(text, {
        existingProfiles: studentProfiles,
        defaultSupervisorEmail: currentUserEmail,
        defaultSupervisorName: currentUserName,
      });
      setParsedPreview(result);
    } catch (err) {
      setImportError(err.message);
    }
  };

  const handleApplyImportedGroups = () => {
    if (!parsedPreview || !Array.isArray(parsedPreview.groups) || parsedPreview.groups.length === 0) {
      setImportError('Please upload a valid Excel/CSV file or paste group rows first.');
      return;
    }

    if (importMode === 'replace') {
      const replaced = parsedPreview.groups.map((g, idx) => ({
        ...g,
        id: `grp_${Date.now()}_imp_${idx}`,
      }));
      setDraftGroups(replaced);
    } else {
      // Merge by group name (case-insensitive)
      setDraftGroups((prev) => {
        const merged = [...prev];
        parsedPreview.groups.forEach((impGrp, idx) => {
          const matchIdx = merged.findIndex(
            (existing) => (existing.name || '').toLowerCase().trim() === (impGrp.name || '').toLowerCase().trim()
          );
          if (matchIdx >= 0) {
            const target = merged[matchIdx];
            const memberMap = new Map();
            (target.members || []).forEach((m) => memberMap.set(normalizeStudentEmail(m.email), m));
            (impGrp.members || []).forEach((m) => memberMap.set(normalizeStudentEmail(m.email), m));
            merged[matchIdx] = {
              ...target,
              projectTopic: impGrp.projectTopic || target.projectTopic,
              supervisorEmail: impGrp.supervisorEmail || target.supervisorEmail,
              members: [...memberMap.values()],
            };
          } else {
            merged.push({
              ...impGrp,
              id: `grp_${Date.now()}_imp_${idx}`,
            });
          }
        });
        return merged;
      });
    }

    setActiveTab('visual');
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSaveGroups(draftGroups);
      onClose();
    } catch (err) {
      alert(`Failed to save project groups: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <NativeDialog
      isOpen={true}
      onClose={onClose}
      closeOnBackdropClick={false}
      className="project-group-modal-backdrop"
      ariaLabel="Manage and Import Project Groups"
    >
      <div className="project-group-modal-content">
        <div className="project-group-modal-header">
          <div>
            <h3>👥 Manage & Import Project Groups ({draftGroups.length} Groups)</h3>
            <p className="project-group-modal-subtitle">
              Persistent student groupings and assigned supervisors for parallel weekly project meetings.
            </p>
          </div>
          <button type="button" className="btn-close-modal" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="project-group-modal-tabs">
          <button
            type="button"
            className={`project-group-tab-btn ${activeTab === 'visual' ? 'active' : ''}`}
            onClick={() => setActiveTab('visual')}
          >
            👥 Visual Group Manager ({draftGroups.length} Groups • {unassignedStudents.length} Unassigned)
          </button>
          <button
            type="button"
            className={`project-group-tab-btn ${activeTab === 'import' ? 'active' : ''}`}
            onClick={() => setActiveTab('import')}
          >
            📥 Batch Import / Export (.xlsx, .csv, Paste)
          </button>
        </div>

        {activeTab === 'visual' ? (
          <div className="project-group-visual-grid">
            {/* Left Column: Unassigned Students Pool */}
            <div className="unassigned-pool-panel">
              <div className="unassigned-pool-header">
                <h4>🙋 Unassigned Students ({unassignedStudents.length})</h4>
                <div className="auto-split-bar">
                  <label htmlFor="auto-split-size-input">Size:</label>
                  <input
                    id="auto-split-size-input"
                    type="number"
                    min={1}
                    max={15}
                    value={autoSplitSize}
                    onChange={(e) => setAutoSplitSize(Math.max(1, Number(e.target.value) || 4))}
                    style={{ width: '52px', padding: '4px 6px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                  />
                  <button
                    type="button"
                    className="btn-auto-split"
                    disabled={unassignedStudents.length === 0}
                    onClick={handleAutoSplitUnassigned}
                    title="Automatically divide all unassigned students into new groups"
                  >
                    ⚡ Auto-Split into Groups
                  </button>
                </div>
              </div>

              <input
                type="text"
                placeholder="🔍 Search unassigned student..."
                value={unassignedSearch}
                onChange={(e) => setUnassignedSearch(e.target.value)}
                className="unassigned-search-input"
              />

              {draftGroups.length > 0 && (
                <div style={{ fontSize: '0.78rem', color: '#475569', marginBottom: '8px' }}>
                  Click a student below to add to:{' '}
                  <select
                    aria-label="Target group for quick student assignment"
                    value={selectedTargetGroupIdx}
                    onChange={(e) => setSelectedTargetGroupIdx(Number(e.target.value))}
                    style={{ padding: '2px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontWeight: 600 }}
                  >
                    {draftGroups.map((g, i) => (
                      <option key={g.id || i} value={i}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="unassigned-students-list">
                {unassignedStudents.length === 0 ? (
                  <div className="empty-unassigned-note">
                    ✅ All enrolled students are assigned to a Project Group!
                  </div>
                ) : (
                  unassignedStudents.map((stu) => (
                    <div
                      key={stu.email}
                      className="unassigned-student-item"
                      onClick={() => handleAssignStudentToGroup(stu, selectedTargetGroupIdx)}
                      title="Click to assign student to selected group"
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#1e293b' }}>{stu.name || stu.email}</div>
                      </div>
                      <span className="btn-quick-assign">➕ Add</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Right Column: Project Group Cards */}
            <div className="group-cards-panel">
              <div className="group-cards-toolbar">
                <button type="button" className="btn-new-project-group" onClick={handleAddGroup}>
                  ➕ Create New Group
                </button>
                <button
                  type="button"
                  className="btn-export-groups"
                  onClick={() => exportProjectGroupsExcel({ classId, groups: draftGroups })}
                  disabled={draftGroups.length === 0}
                >
                  📤 Export Groups (.xlsx)
                </button>
              </div>

              {draftGroups.length === 0 ? (
                <div className="empty-groups-placeholder">
                  <p>No Project Groups created yet.</p>
                  <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
                    Click <strong>"➕ Create New Group"</strong>, <strong>"⚡ Auto-Split into Groups"</strong>, or switch to the{' '}
                    <strong>"📥 Batch Import"</strong> tab to upload an Excel sheet.
                  </p>
                </div>
              ) : (
                <div className="group-cards-scroll">
                  {draftGroups.map((grp, grpIdx) => (
                    <div
                      key={grp.id || grpIdx}
                      className={`project-group-edit-card ${selectedTargetGroupIdx === grpIdx ? 'selected-target' : ''}`}
                      onClick={() => setSelectedTargetGroupIdx(grpIdx)}
                    >
                      <div className="project-group-card-top">
                        <input
                          type="text"
                          aria-label={`Group ${grpIdx + 1} Name`}
                          value={grp.name}
                          onChange={(e) => handleUpdateGroupField(grpIdx, 'name', e.target.value)}
                          placeholder="Group Name (e.g. Group 1)"
                          className="group-name-input"
                        />
                        <input
                          type="text"
                          aria-label={`Group ${grpIdx + 1} Project Topic`}
                          value={grp.projectTopic || ''}
                          onChange={(e) => handleUpdateGroupField(grpIdx, 'projectTopic', e.target.value)}
                          placeholder="📌 Project Topic / Capstone Title..."
                          className="group-topic-input"
                        />
                        <button
                          type="button"
                          className="btn-delete-group-card"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveGroup(grpIdx);
                          }}
                          title="Delete this group"
                        >
                          🗑️
                        </button>
                      </div>

                      <div className="project-group-supervisor-row">
                        <label>👨‍🏫 Supervisor Teacher:</label>
                        {classTeachers.length > 0 ? (
                          <select
                            aria-label={`Supervisor for ${grp.name}`}
                            value={grp.supervisorEmail || ''}
                            onChange={(e) => handleUpdateGroupField(grpIdx, 'supervisorEmail', e.target.value)}
                          >
                            {!classTeachers.includes(grp.supervisorEmail) && grp.supervisorEmail && (
                              <option value={grp.supervisorEmail}>{grp.supervisorEmail}</option>
                            )}
                            {classTeachers.map((tEmail) => (
                              <option key={tEmail} value={tEmail}>
                                {tEmail}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="email"
                            value={grp.supervisorEmail || ''}
                            onChange={(e) => handleUpdateGroupField(grpIdx, 'supervisorEmail', e.target.value)}
                            placeholder="supervisor@vtc.edu.hk"
                          />
                        )}
                      </div>

                      <div className="project-group-members-list">
                        {(grp.members || []).length === 0 ? (
                          <div style={{ fontSize: '0.8rem', color: '#94a3b8', padding: '6px 0' }}>
                            No members assigned yet — click a student from the left pool to add.
                          </div>
                        ) : (
                          grp.members.map((m) => (
                            <div key={m.email} className="group-member-chip-row">
                              <div className="group-member-identity">
                                <button
                                  type="button"
                                  className={`btn-role-badge ${m.role === 'Leader' ? 'is-leader' : ''}`}
                                  onClick={() => handleToggleMemberRole(grpIdx, m.email)}
                                  title="Click to toggle Leader / Member role"
                                >
                                  {m.role === 'Leader' ? '⭐ Leader' : '👤 Member'}
                                </button>
                                <span style={{ fontWeight: 600, fontSize: '0.84rem' }}>{m.name || m.email}</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {draftGroups.length > 1 && (
                                  <select
                                    aria-label={`Move ${m.name} to another group`}
                                    value=""
                                    onChange={(e) => handleMoveMember(grpIdx, m, e.target.value)}
                                    style={{ fontSize: '0.74rem', padding: '2px 4px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                                  >
                                    <option value="" disabled>
                                      Move to ▾
                                    </option>
                                    {draftGroups.map((otherGrp, otherIdx) =>
                                      otherIdx !== grpIdx ? (
                                        <option key={otherGrp.id || otherIdx} value={otherIdx}>
                                          {otherGrp.name}
                                        </option>
                                      ) : null
                                    )}
                                  </select>
                                )}
                                <button
                                  type="button"
                                  className="btn-remove-member"
                                  onClick={() => handleRemoveMember(grpIdx, m.email)}
                                  title="Remove from group"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Batch Import / Export Tab */
          <div className="project-group-import-panel">
            <div className="import-actions-banner">
              <div>
                <strong>1. Download Pre-Filled Class Roster Template (.xlsx)</strong>
                <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: '#475569' }}>
                  Pre-populated with all enrolled students in <strong>{classId}</strong>. Just fill in{' '}
                  <code>GroupName</code>, <code>ProjectTopic</code>, and <code>SupervisorEmail</code> in Excel!
                </p>
              </div>
              <button
                type="button"
                className="btn-download-group-template"
                onClick={() =>
                  downloadProjectGroupTemplateExcel({
                    classId,
                    enrolledStudents,
                    existingGroups: draftGroups,
                    defaultSupervisorEmail: currentUserEmail,
                  })
                }
              >
                📄 Download Roster Template (.xlsx)
              </button>
            </div>

            <div className="import-upload-row">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.tsv"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                className="btn-upload-group-file"
                onClick={() => fileInputRef.current?.click()}
              >
                📤 Upload Excel (.xlsx) or CSV File
              </button>
              {importFileName && <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>📎 {importFileName}</span>}

              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.84rem' }}>
                <label>
                  <input
                    type="radio"
                    name="groupImportMode"
                    checked={importMode === 'merge'}
                    onChange={() => setImportMode('merge')}
                  />{' '}
                  Merge / Update Existing Groups
                </label>
                <label>
                  <input
                    type="radio"
                    name="groupImportMode"
                    checked={importMode === 'replace'}
                    onChange={() => setImportMode('replace')}
                  />{' '}
                  Replace All Groups
                </label>
              </div>
            </div>

            <textarea
              aria-label="Paste project groups CSV or Excel rows"
              rows={7}
              value={importText}
              onChange={handleImportTextChange}
              placeholder={
                'Paste rows from Excel / Google Sheets or CSV here:\nGroupName,ProjectTopic,SupervisorEmail,StudentEmail,StudentName,Role\nGroup 1,AI Smart Inventory,cywong@vtc.edu.hk,alice@stu.vtc.edu.hk,Alice Chan,Leader\nGroup 1,AI Smart Inventory,cywong@vtc.edu.hk,bob@stu.vtc.edu.hk,Bob Lee,Member'
              }
              className="group-import-textarea"
            />

            {importError && <div className="group-import-error">⚠️ {importError}</div>}

            {parsedPreview && (
              <div className="group-import-preview-box">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <strong>
                    ✅ Preview: {parsedPreview.groups.length} Project Group(s) • {parsedPreview.totalStudents} Student(s)
                  </strong>
                  <button type="button" className="btn-apply-import" onClick={handleApplyImportedGroups}>
                    📥 Apply {parsedPreview.groups.length} Group(s) to Editor
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {parsedPreview.groups.map((g, i) => (
                    <span
                      key={i}
                      style={{
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        color: '#1e40af',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                      }}
                    >
                      📁 {g.name} ({g.members.length} members{g.supervisorEmail ? ` • ${g.supervisorEmail}` : ''})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="project-group-modal-footer">
          <button type="button" className="btn-cancel-modal" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-save-groups-primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? '⏳ Saving Groups...' : `💾 Save Project Groups (${draftGroups.length})`}
          </button>
        </div>
      </div>
    </NativeDialog>
  );
}
