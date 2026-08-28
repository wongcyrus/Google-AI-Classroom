import { useState, useEffect, useRef } from 'react';
import { doc, getDoc, collection, onSnapshot, query, where, writeBatch, addDoc, serverTimestamp, orderBy, limit, getDocs } from 'firebase/firestore';
import { CSVLink } from 'react-csv';
import { db, auth } from '../firebase-config';
import './ClassManagement.css';

const CustomPropertiesManager = ({ selectedClass, studentEmails }) => {
  const [classProperties, setClassProperties] = useState([{ key: '', value: '' }]);

  const [propertyUploadJobs, setPropertyUploadJobs] = useState([]);
  const [downloadProps, setDownloadProps] = useState(null);
  const csvLink = useRef(null);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

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
        } else {
            setClassProperties([{ key: '', value: '' }]);
        }
    }
    fetchClassProperties();
  }, [selectedClass]);

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
      });

      return () => unsubscribe();
  }, [selectedClass]);

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
            const studentEmailList = studentEmails.split(/[\n,]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
            const data = studentEmailList.map(email => ({ StudentEmail: email }));
            const headers = ['StudentEmail']; // Only StudentEmail header
            setDownloadProps({ headers, data });
            setTimeout(() => {
                if (csvLink.current) {
                    csvLink.current.link.click();
                    setDownloadProps(null);
                }
            }, 100);
            return;
        }

        // If students are enrolled, download their existing, student-specific properties.
        
        // 1. Fetch all student-specific properties
        const propertiesCollectionRef = collection(db, 'classes', selectedClass, 'studentProperties');
        const propertiesSnapshot = await getDocs(propertiesCollectionRef);
        const studentPropertiesData = {}; // uid -> {prop: value}
        propertiesSnapshot.forEach(doc => {
            // Trim the doc ID to safeguard against whitespace issues.
            studentPropertiesData[doc.id.trim()] = doc.data();
        });

        // 2. Determine all possible property keys for headers ONLY from student-specific properties.
        const allPropertyKeys = new Set();
        Object.values(studentPropertiesData).forEach(props => {
            Object.keys(props).forEach(key => allPropertyKeys.add(key));
        });

        const headers = ['StudentEmail', ...Array.from(allPropertyKeys).sort()];

        // 3. Build data for each student using only their specific properties.
        const data = Object.entries(studentsMap).map(([uid, email]) => {
            const row = { StudentEmail: email };
            // Trim the UID from studentsMap to safeguard against whitespace issues.
            const studentProps = studentPropertiesData[uid.trim()] || {};
            
            headers.forEach(header => {
                if (header !== 'StudentEmail') {
                    row[header] = studentProps[header] ?? ''; // Use only student prop, or empty string.
                }
            });
            return row;
        });

        // Sort by email before generating the CSV
        data.sort((a, b) => a.StudentEmail.localeCompare(b.StudentEmail));

        setDownloadProps({ headers, data });
        setTimeout(() => {
            if (csvLink.current) {
                csvLink.current.link.click();
                setDownloadProps(null);
            }
        }, 100);

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
        setSuccessMessage("Successfully saved properties!");

    } catch (err) {
        setError("Failed to save properties: " + err.message);
        console.error(err);
    }
  };

  const handleStudentPropertiesCSVUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = null; // Reset file input

    const reader = new FileReader();
    reader.onload = async (e) => {
        const csvData = e.target.result;
        if (!selectedClass) {
            setError("Please select a class first.");
            return;
        }
        try {
            const jobsRef = collection(db, 'propertyUploadJobs');
            await addDoc(jobsRef, {
                classId: selectedClass,
                csvData,
                requesterUid: auth.currentUser.uid,
                status: 'pending',
                createdAt: serverTimestamp(),
            });
            setSuccessMessage("CSV uploaded for processing. Properties will be updated in the background.");
        } catch (err) {
            setError("Failed to upload CSV for processing. " + err.message);
        }
    };
    reader.readAsText(file);
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
          Upload a CSV with <code>StudentEmail</code> as the first column header to assign custom properties per student (e.g. <code>Group</code>, <code>DeskId</code>, <code>SpecialNeeds</code>).
        </p>
        
        <div className="csv-buttons" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', padding: '0.45rem 0.9rem' }}
            onClick={handleDownloadStudentTemplate}
          >
            📥 Export / Download Existing CSV
          </button>
          {downloadProps && (
            <CSVLink
              headers={downloadProps.headers}
              data={downloadProps.data}
              filename={`${selectedClass}-student-properties.csv`}
              style={{ display: "none" }}
              ref={csvLink}
              target="_blank"
            />
          )}

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
            📤 Choose CSV to Upload
            <input
              id="student-csv-upload-input"
              type="file"
              accept=".csv"
              onChange={handleStudentPropertiesCSVUpload}
              style={{ display: 'none' }}
            />
          </label>
        </div>

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