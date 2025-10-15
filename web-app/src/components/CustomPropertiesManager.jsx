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
    <div className="manage-selected-class">
        {error && <div className="error-message">{error}</div>}
        {successMessage && <div className="success-message">{successMessage}</div>}
      <hr />
      <h3>Custom Properties</h3>
      <div className="form-group">
          <label>Class-wide Properties</label>
          <div className="properties-table">
              {classProperties.map((prop, index) => (
                  <div key={index} className="property-row">
                      <input
                          type="text"
                          placeholder="Key"
                          value={prop.key}
                          onChange={(e) => handlePropertyChange(index, 'key', e.target.value)}
                      />
                      <input
                          type="text"
                          placeholder="Value"
                          value={prop.value}
                          onChange={(e) => handlePropertyChange(index, 'value', e.target.value)}
                      />
                      <button type="button" onClick={() => removePropertyRow(index)}>Remove</button>
                  </div>
              ))}
          </div>
          <button type="button" onClick={addPropertyRow}>Add Property</button>
      </div>

      <div className="form-group">
          <label>Student-specific Properties (via CSV)</label>
          <p className="input-hint">
              Upload a CSV with `StudentEmail` as the first column header. The system will process it in the background.
          </p>
          <div className="csv-buttons">
              <button type="button" onClick={handleDownloadStudentTemplate}>Download Existing Properties</button>
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
              <label htmlFor="csv-upload" className="button-like-label">Upload CSV</label>
              <input id="csv-upload" type="file" accept=".csv" onChange={handleStudentPropertiesCSVUpload} style={{ display: 'none' }} />
          </div>
      </div>

      <div className="form-group">
          <label>Recent Upload Jobs</label>
          <div className="jobs-list">
              {propertyUploadJobs.length > 0 ? propertyUploadJobs.map(job => (
                  <div key={job.id} className="job-item">
                      <span>{job.createdAt?.toDate().toLocaleString()} - <strong>{job.status}</strong></span>
                      {(job.status === 'completed' || job.status === 'completed_with_errors') && typeof job.totalRows === 'number' && (
                        <p className="job-details" style={{ margin: '4px 0 0', fontSize: '0.9em', color: '#666' }}>
                            Processed: {job.processedCount || 0}/{job.totalRows}.
                            {job.notFoundCount > 0 && ` Not Found: ${job.notFoundCount}.`}
                        </p>
                      )}
                      {job.error && <p className="error-message">{job.error}</p>}
                  </div>
              )) : <p>No recent uploads.</p>}
          </div>
      </div>

      <button onClick={handleSaveProperties}>Save Properties</button>
    </div>
  );
};

export default CustomPropertiesManager;