import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, collection, onSnapshot, query, where, writeBatch, addDoc, serverTimestamp, orderBy, limit, getDocs, deleteField } from 'firebase/firestore';
import { db, auth } from '../firebase-config';
import { isInternalPropertyKey } from './student/PropertiesWidget';
import { exportToExcel, readExcelFile, generateCsvContent } from '../utils/exportUtils';
import './ClassManagement.css';

const getSnapshotDocs = (snap) => {
  if (!snap) return [];
  if (Array.isArray(snap)) return snap;
  if (Array.isArray(snap.docs)) return snap.docs;
  const list = [];
  if (typeof snap.forEach === 'function') {
    snap.forEach(d => list.push(d));
  }
  return list;
};

const getDocData = (docSnap) => (typeof docSnap?.data === 'function' ? docSnap.data() : (docSnap?.data || {}));

const CustomPropertiesManager = ({ selectedClass, studentEmails }) => {
  const [classProperties, setClassProperties] = useState([{ key: '', value: '' }]);

  const [propertyUploadJobs, setPropertyUploadJobs] = useState([]);
  const [detectedStudentProperties, setDetectedStudentProperties] = useState([]);
  const [loadingProperties, setLoadingProperties] = useState(false);
  const [syncMode, setSyncMode] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  // Fetch detected custom properties for enrolled students
  const fetchStudentPropertiesStats = useCallback(async (classId) => {
    if (!classId) {
      setDetectedStudentProperties([]);
      return;
    }
    setLoadingProperties(true);
    try {
      const propertiesCollectionRef = collection(db, 'classes', classId, 'studentProperties');
      const propertiesSnapshot = await getDocs(propertiesCollectionRef);
      const keyCounts = {};

      getSnapshotDocs(propertiesSnapshot).forEach(docSnap => {
        const data = getDocData(docSnap);
        Object.entries(data).forEach(([key, val]) => {
          if (!isInternalPropertyKey(key) && val !== undefined && val !== null && String(val).trim() !== '') {
            keyCounts[key] = (keyCounts[key] || 0) + 1;
          }
        });
      });

      const stats = Object.entries(keyCounts)
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => a.key.localeCompare(b.key));

      setDetectedStudentProperties(stats);
    } catch (err) {
      console.warn('[CustomPropertiesManager] Failed to fetch student property stats:', err);
    } finally {
      setLoadingProperties(false);
    }
  }, []);

  useEffect(() => {
    const fetchClassProperties = async () => {
      if (selectedClass) {
        const classPropsRef = doc(db, 'classes', selectedClass, 'classProperties', 'config');
        const classPropsSnap = await getDoc(classPropsRef);
        if (classPropsSnap.exists()) {
          const propsData = classPropsSnap.data();
          const propsArray = Object.entries(propsData).map(([key, value]) => ({ key, value }));
          setClassProperties(propsArray.length > 0 ? propsArray : [{ key: '', value: '' }]);
        } else {
          setClassProperties([{ key: '', value: '' }]);
        }
        fetchStudentPropertiesStats(selectedClass);
      } else {
        setClassProperties([{ key: '', value: '' }]);
        setDetectedStudentProperties([]);
      }
    };
    fetchClassProperties();
  }, [selectedClass, fetchStudentPropertiesStats]);

  // Listen for property upload jobs
  useEffect(() => {
    if (!selectedClass) {
      setPropertyUploadJobs([]);
      return;
    }

    const jobsRef = collection(db, 'propertyUploadJobs');
    const q = query(jobsRef, where('classId', '==', selectedClass), orderBy('createdAt', 'desc'), limit(5));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const jobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPropertyUploadJobs(jobs);
      if (jobs.some(j => j.status === 'completed' || j.status === 'completed_with_errors')) {
        fetchStudentPropertiesStats(selectedClass);
      }
    }, (err) => {
      console.warn('[CustomPropertiesManager] Error subscribing to upload jobs:', err);
    });

    return () => unsubscribe();
  }, [selectedClass, fetchStudentPropertiesStats]);

  const handleDownloadStudentTemplate = async () => {
    if (!selectedClass) {
      alert("Please select a class first.");
      return;
    }

    try {
      // Fetch the class document to get the student list (UID -> email map)
      const classRef = doc(db, 'classes', selectedClass);
      const classSnap = await getDoc(classRef);
      if (!classSnap.exists()) {
        throw new Error("Could not find the selected class data.");
      }
      const classData = classSnap.data();
      const studentsMap = classData.students || {};

      // If no students are enrolled, download a template with just the StudentEmail header.
      if (Object.keys(studentsMap).length === 0) {
        const studentEmailList = (studentEmails || '').split(/[\n,]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
        const headers = ['StudentEmail'];
        const rows = studentEmailList.map(email => [email]);
        await exportToExcel(headers, rows, `${selectedClass}-student-properties.xlsx`);
        return;
      }

      // If students are enrolled, download their existing, student-specific properties.
      const propertiesCollectionRef = collection(db, 'classes', selectedClass, 'studentProperties');
      const propertiesSnapshot = await getDocs(propertiesCollectionRef);
      const studentPropertiesData = {}; // uid -> {prop: value}
      getSnapshotDocs(propertiesSnapshot).forEach(doc => {
        studentPropertiesData[doc.id.trim()] = getDocData(doc);
      });

      // Determine all possible property keys for headers ONLY from non-internal student-specific properties.
      const allPropertyKeys = new Set();
      Object.values(studentPropertiesData).forEach(props => {
        Object.keys(props).forEach(key => {
          if (!isInternalPropertyKey(key)) {
            allPropertyKeys.add(key);
          }
        });
      });

      const headers = ['StudentEmail', ...Array.from(allPropertyKeys).sort()];

      // Build rows for each student using only their specific properties.
      const sortedEntries = Object.entries(studentsMap).sort((a, b) => (a[1] || '').localeCompare(b[1] || ''));
      const rows = sortedEntries.map(([uid, email]) => {
        const studentProps = studentPropertiesData[uid.trim()] || {};
        return headers.map(header => {
          if (header === 'StudentEmail') return email;
          return studentProps[header] ?? '';
        });
      });

      await exportToExcel(headers, rows, `${selectedClass}-student-properties.xlsx`);

    } catch (err) {
      console.error("Error preparing student properties for download:", err);
      alert("Failed to prepare student properties for download: " + err.message);
    }
  };

  const handlePropertyChange = (index, field, value) => {
    const updated = [...classProperties];
    updated[index][field] = value;
    setClassProperties(updated);
  };

  const addPropertyRow = () => {
    setClassProperties([...classProperties, { key: '', value: '' }]);
  };

  const removePropertyRow = (index) => {
    setClassProperties(classProperties.filter((_, i) => i !== index));
  };

  const handleSaveProperties = async () => {
    if (!selectedClass) {
      setError("Please select a class first.");
      return;
    }
    setError(null);
    setSuccessMessage('');

    try {
      const batch = writeBatch(db);

      // Save class-wide properties
      const classPropsRef = doc(db, 'classes', selectedClass, 'classProperties', 'config');
      const classPropsMap = classProperties.reduce((acc, prop) => {
        if (prop.key.trim()) {
          acc[prop.key.trim()] = prop.value;
        }
        return acc;
      }, {});
      batch.set(classPropsRef, classPropsMap);

      await batch.commit();
      setSuccessMessage("Successfully saved class-wide properties!");

    } catch (err) {
      setError("Failed to save properties: " + err.message);
      console.error(err);
    }
  };

  // Direct deletion of an individual custom property across all students in the class
  const handleDeleteStudentPropertyKey = async (propKey) => {
    if (!selectedClass || !propKey) return;
    const confirmed = window.confirm(
      `Are you sure you want to delete the custom property "${propKey}" from all students in class ${selectedClass}? This cannot be undone.`
    );
    if (!confirmed) return;

    setError(null);
    setSuccessMessage('');
    try {
      const propertiesCollectionRef = collection(db, 'classes', selectedClass, 'studentProperties');
      const propertiesSnapshot = await getDocs(propertiesCollectionRef);

      const docsToUpdate = [];
      getSnapshotDocs(propertiesSnapshot).forEach(docSnap => {
        const data = getDocData(docSnap);
        if (data[propKey] !== undefined) {
          docsToUpdate.push(docSnap.id);
        }
      });

      if (docsToUpdate.length === 0) {
        setSuccessMessage(`No students had property "${propKey}".`);
        await fetchStudentPropertiesStats(selectedClass);
        return;
      }

      const BATCH_SIZE = 450;
      for (let i = 0; i < docsToUpdate.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = docsToUpdate.slice(i, i + BATCH_SIZE);
        chunk.forEach(uid => {
          const docRef = doc(db, 'classes', selectedClass, 'studentProperties', uid);
          batch.update(docRef, { [propKey]: deleteField() });
        });
        await batch.commit();
      }

      setSuccessMessage(`Successfully deleted custom property "${propKey}" from ${docsToUpdate.length} student(s)!`);
      await fetchStudentPropertiesStats(selectedClass);
    } catch (err) {
      console.error('Failed to delete property:', err);
      setError(`Failed to delete property "${propKey}": ` + err.message);
    }
  };

  // Clear all student-specific custom properties across all students in the class
  const handleClearAllStudentProperties = async () => {
    if (!selectedClass) return;
    const confirmed = window.confirm(
      `Are you sure you want to remove ALL student-specific custom properties for class ${selectedClass}? Internal system data (exam readiness, passkey status) will NOT be affected.`
    );
    if (!confirmed) return;

    setError(null);
    setSuccessMessage('');
    try {
      const propertiesCollectionRef = collection(db, 'classes', selectedClass, 'studentProperties');
      const propertiesSnapshot = await getDocs(propertiesCollectionRef);

      const updates = [];
      getSnapshotDocs(propertiesSnapshot).forEach(docSnap => {
        const data = getDocData(docSnap);
        const keysToDelete = Object.keys(data).filter(k => !isInternalPropertyKey(k));
        if (keysToDelete.length > 0) {
          updates.push({ id: docSnap.id, keysToDelete });
        }
      });

      if (updates.length === 0) {
        setSuccessMessage('No custom properties to clear.');
        return;
      }

      const BATCH_SIZE = 450;
      for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = updates.slice(i, i + BATCH_SIZE);
        chunk.forEach(({ id, keysToDelete }) => {
          const docRef = doc(db, 'classes', selectedClass, 'studentProperties', id);
          const payload = {};
          keysToDelete.forEach(k => {
            payload[k] = deleteField();
          });
          batch.update(docRef, payload);
        });
        await batch.commit();
      }

      setSuccessMessage(`Successfully cleared all custom properties across ${updates.length} student(s)!`);
      await fetchStudentPropertiesStats(selectedClass);
    } catch (err) {
      console.error('Failed to clear properties:', err);
      setError('Failed to clear custom properties: ' + err.message);
    }
  };

  const handleStudentPropertiesCSVUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = null; // Reset file input

    if (!selectedClass) {
      setError("Please select a class first.");
      return;
    }

    setError(null);
    setSuccessMessage('');

    try {
      const fileName = (file.name || '').toLowerCase();
      if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
        throw new Error('Please upload an Excel spreadsheet (.xlsx or .xls). CSV files are not supported.');
      }
      const rows = await readExcelFile(file);
      if (!rows || rows.length === 0) {
        throw new Error('The selected Excel file appears to be empty.');
      }
      const headers = rows[0] || [];
      const dataRows = rows.slice(1) || [];
      const csvData = generateCsvContent(headers, dataRows);

      const jobsRef = collection(db, 'propertyUploadJobs');
      await addDoc(jobsRef, {
        classId: selectedClass,
        csvData,
        mode: syncMode ? 'sync' : 'merge',
        requesterUid: auth.currentUser.uid,
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      setSuccessMessage("Properties file uploaded for processing. Removed columns and empty cells will be updated in the background.");
    } catch (err) {
      setError("Failed to upload file for processing. " + err.message);
    }
  };

  return (
    <div className="manage-selected-class-properties" style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border, #e2e8f0)', paddingTop: '1rem' }}>
      {error && <div className="error-banner" style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '6px', fontSize: '0.9rem' }}>⚠️ {error}</div>}
      {successMessage && <div className="success-banner" style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '6px', fontSize: '0.9rem' }}>✅ {successMessage}</div>}

      {/* Class-wide Properties */}
      <div style={{ marginBottom: '1.5rem', backgroundColor: 'var(--color-bg-secondary, #f8fafc)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--color-border, #e2e8f0)' }}>
        <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-main, #1e293b)' }}>
          🏷️ Class-wide Custom Properties
        </h4>
        <p className="input-hint" style={{ marginBottom: '0.75rem' }}>
          Key-value pairs applicable to all students and AI prompts for this class.
        </p>
        <div className="properties-table">
          {classProperties.map((prop, index) => (
            <div key={index} className="property-row" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Property Key (e.g., CourseCode)"
                value={prop.key}
                onChange={(e) => handlePropertyChange(index, 'key', e.target.value)}
                style={{ flex: 1 }}
              />
              <input
                type="text"
                placeholder="Value (e.g., CS101)"
                value={prop.value}
                onChange={(e) => handlePropertyChange(index, 'value', e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: '0.4rem 0.75rem', color: '#ef4444', borderColor: '#fca5a5' }}
                onClick={() => removePropertyRow(index)}
                title="Remove Property"
              >
                🗑️
              </button>
            </div>
          ))}
        </div>
        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
            onClick={addPropertyRow}
          >
            ➕ Add Property Field
          </button>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem', fontWeight: 600 }}
            onClick={handleSaveProperties}
          >
            💾 Save Class-wide Properties
          </button>
        </div>
      </div>

      {/* Student-specific Properties via CSV */}
      <div style={{ backgroundColor: 'var(--color-bg-secondary, #f8fafc)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--color-border, #e2e8f0)' }}>
        <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-main, #1e293b)' }}>
          📊 Student-specific Properties (CSV Upload / Export)
        </h4>
        <p className="input-hint" style={{ marginBottom: '0.75rem' }}>
          Upload an Excel spreadsheet with <code>StudentEmail</code> as the first column header to assign custom properties per student (e.g. <code>Group</code>, <code>DeskId</code>, <code>SpecialNeeds</code>).
        </p>

        {/* Active Student Properties List */}
        <div style={{ marginTop: '0.5rem', marginBottom: '1rem', padding: '0.75rem', backgroundColor: 'var(--color-surface, #ffffff)', borderRadius: '6px', border: '1px solid var(--color-border, #e2e8f0)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-main, #1e293b)' }}>
              Active Student Custom Properties ({detectedStudentProperties.length})
            </span>
            {detectedStudentProperties.length > 0 && (
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem', color: '#dc2626', borderColor: '#fca5a5' }}
                onClick={handleClearAllStudentProperties}
                title="Remove all custom properties across all students in this class"
              >
                🗑️ Clear All Student Properties
              </button>
            )}
          </div>

          {detectedStudentProperties.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {detectedStudentProperties.map(({ key, count }) => (
                <div
                  key={key}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    backgroundColor: 'var(--color-bg-secondary, #f1f5f9)',
                    padding: '0.3rem 0.65rem',
                    borderRadius: '16px',
                    fontSize: '0.82rem',
                    border: '1px solid var(--color-border, #cbd5e1)'
                  }}
                >
                  <span style={{ fontWeight: 600, color: 'var(--color-text-main, #334155)' }}>{key}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #64748b)' }}>({count} student{count > 1 ? 's' : ''})</span>
                  <button
                    type="button"
                    onClick={() => handleDeleteStudentPropertyKey(key)}
                    title={`Delete property "${key}" from all students`}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '0 2px',
                      color: '#ef4444',
                      fontSize: '0.85rem',
                      display: 'inline-flex',
                      alignItems: 'center'
                    }}
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-muted, #94a3b8)' }}>
              {loadingProperties ? 'Loading active student properties...' : 'No student-specific custom properties currently assigned.'}
            </p>
          )}
        </div>

        {/* Sync Mode Toggle */}
        <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            id="sync-mode-checkbox"
            checked={syncMode}
            onChange={(e) => setSyncMode(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <label htmlFor="sync-mode-checkbox" style={{ fontSize: '0.82rem', color: 'var(--color-text-main, #334155)', cursor: 'pointer' }}>
            <strong>Replace & Sync mode:</strong> Automatically delete columns removed from spreadsheet and clear blank cells.
          </label>
        </div>
        
        <div className="csv-buttons" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', padding: '0.45rem 0.9rem' }}
            onClick={handleDownloadStudentTemplate}
          >
            📥 Export / Download Existing Excel
          </button>

          <label
            htmlFor="student-csv-upload-input"
            className="btn-secondary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.85rem',
              padding: '0.45rem 0.9rem',
              cursor: 'pointer',
              margin: 0,
              backgroundColor: 'var(--color-primary, #6366f1)',
              color: 'white',
              borderColor: 'transparent'
            }}
          >
            📤 Choose Excel (.xlsx) to Upload
            <input
              id="student-csv-upload-input"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleStudentPropertiesCSVUpload}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        <p className="input-hint" style={{ marginTop: '0.6rem', marginBottom: '0.75rem' }}>
          💡 <em>Tip: To remove a property, delete its column from the downloaded Excel spreadsheet and upload it back, or click 🗑️ next to any property above.</em>
        </p>

        {/* Recent Upload Jobs */}
        <div style={{ marginTop: '1rem', borderTop: '1px dashed var(--color-border, #cbd5e1)', paddingTop: '0.75rem' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-muted, #64748b)' }}>Recent Upload Jobs:</label>
          <div className="jobs-list" style={{ marginTop: '0.35rem' }}>
            {propertyUploadJobs.length > 0 ? propertyUploadJobs.map(job => (
              <div key={job.id} style={{ fontSize: '0.82rem', padding: '0.4rem 0.6rem', backgroundColor: 'var(--color-surface, #ffffff)', borderRadius: '4px', border: '1px solid var(--color-border, #e2e8f0)', marginBottom: '0.35rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{job.createdAt?.toDate ? job.createdAt.toDate().toLocaleString() : 'Just now'}</span>
                  <span style={{
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    backgroundColor: job.status === 'completed' ? '#dcfce7' : job.status === 'failed' ? '#fee2e2' : '#e0e7ff',
                    color: job.status === 'completed' ? '#166534' : job.status === 'failed' ? '#991b1b' : '#3730a3'
                  }}>
                    {job.status}
                  </span>
                </div>
                {(job.status === 'completed' || job.status === 'completed_with_errors') && typeof job.totalRows === 'number' && (
                  <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted, #64748b)' }}>
                    Processed: {job.processedCount || 0}/{job.totalRows}.
                    {job.notFoundCount > 0 && ` (${job.notFoundCount} emails not enrolled)`}
                  </p>
                )}
                {job.error && <p style={{ margin: '4px 0 0', color: '#b91c1c', fontSize: '0.78rem' }}>Error: {job.error}</p>}
              </div>
            )) : <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #94a3b8)', margin: '0.2rem 0' }}>No recent upload jobs.</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomPropertiesManager;