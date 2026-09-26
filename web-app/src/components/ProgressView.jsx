import { useState, useMemo, useEffect } from 'react';
import { db } from '../firebase-config';
import { doc, getDoc, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import './SharedViews.css';
import usePaginatedQuery from '../hooks/useCollectionQuery';
import { exportToExcel } from '../utils/exportUtils';
import { getStudentDisplayName, getStudentProfile } from '../utils/studentDisplayUtils';

const ProgressView = ({ classId, startTime, endTime }) => {
  const [selectedStudentUid, setSelectedStudentUid] = useState(null);

  // --- Logic for Summary View ---
  const [students, setStudents] = useState([]);
  const [studentProfiles, setStudentProfiles] = useState({});
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [summaryPage, setSummaryPage] = useState(1);
  const itemsPerPage = 10;
  const [latestProgress, setLatestProgress] = useState([]);
  const [loadingProgress, setLoadingProgress] = useState(true);

  // 1. Fetch students for the class
  useEffect(() => {
    const fetchStudents = async () => {
      if (!classId) {
        setStudents([]);
        setLoadingStudents(false);
        return;
      }
      setLoadingStudents(true);
      try {
        const classRef = doc(db, 'classes', classId);
        const classSnap = await getDoc(classRef);
        if (classSnap.exists()) {
          const classData = classSnap.data();
          const studentMap = classData.students || {};
          const profiles = classData.studentProfiles || {};
          setStudentProfiles(profiles);
          const studentList = Object.entries(studentMap).map(([uid, email]) => {
            const prof = getStudentProfile(email, profiles);
            return {
              uid,
              email,
              displayName: getStudentDisplayName(email, profiles),
              studentClass: prof.studentClass || '',
              programme: prof.programme || ''
            };
          });
          setStudents(studentList);
        } else {
          setStudents([]);
        }
      } catch (error) {
        console.error("Error fetching students for class:", error);
        setStudents([]);
      }
      setLoadingStudents(false);
    };
    fetchStudents();
  }, [classId]);

  // 2. Paginate students
  const paginatedStudents = useMemo(() => {
    const pageStart = (summaryPage - 1) * itemsPerPage;
    const pageEnd = pageStart + itemsPerPage;
    return students.slice(pageStart, pageEnd);
  }, [students, summaryPage]);

  // 3. Fetch latest progress for paginated students
  useEffect(() => {
    const fetchLatestProgress = async () => {
      if (paginatedStudents.length === 0) {
        setLatestProgress([]);
        setLoadingProgress(false);
        return;
      }

      setLoadingProgress(true);
      try {
        const progressPromises = paginatedStudents.map(student => {
          let q = query(
            collection(db, 'progress'),
            where('classId', '==', classId),
            where('studentUid', '==', student.uid)
          );
          if (startTime) q = query(q, where('timestamp', '>=', new Date(startTime)));
          if (endTime) q = query(q, where('timestamp', '<=', new Date(endTime)));
          q = query(q, orderBy('timestamp', 'desc'), limit(1));
          return getDocs(q);
        });

        const snapshots = await Promise.all(progressPromises);
        const progressData = snapshots.map((snapshot, index) => {
          const student = paginatedStudents[index];
          const prof = getStudentProfile(student.email, studentProfiles);
          const displayName = getStudentDisplayName(student.email, studentProfiles);
          if (snapshot && !snapshot.empty && snapshot.docs && snapshot.docs[0]) {
            const doc = snapshot.docs[0];
            const data = doc.data ? (doc.data() || {}) : {};
            return {
              id: doc.id,
              ...data,
              studentEmail: data.studentEmail || student.email,
              displayName,
              studentClass: prof.studentClass || '',
              programme: prof.programme || ''
            };
          }
          return {
            id: student.uid, // fallback id
            studentUid: student.uid,
            studentEmail: student.email,
            displayName,
            studentClass: prof.studentClass || '',
            programme: prof.programme || '',
            progress: 'No progress recorded',
            timestamp: null,
          };
        });
        setLatestProgress(progressData);
      } catch (error) {
        console.error("Error fetching latest progress:", error);
        setLatestProgress([]);
      }
      setLoadingProgress(false);
    };

    fetchLatestProgress();
  }, [paginatedStudents, classId, startTime, endTime, studentProfiles]);


  // --- Logic for Detail View ---
  const detailViewExtraClauses = useMemo(() => {
    return selectedStudentUid ? [{ field: 'studentUid', op: '==', value: selectedStudentUid }] : [];
  }, [selectedStudentUid]);

  const {
    data: detailProgress,
    loading: detailLoading,
    page: detailPage,
    isLastPage: isDetailLastPage,
    fetchNextPage,
    fetchPrevPage,
    refetch: refetchDetail
  } = usePaginatedQuery(selectedStudentUid ? 'progress' : null, {
    classId,
    startTime,
    endTime,
    extraClauses: detailViewExtraClauses,
    orderByField: 'timestamp',
    orderByDirection: 'desc',
  });

  // Refetch detail view data when student changes
  useEffect(() => {
    if (selectedStudentUid) {
      refetchDetail();
    }
  }, [selectedStudentUid, refetchDetail]);


  const handleExportSummaryExcel = async () => {
    if (!latestProgress || latestProgress.length === 0) {
      alert("No progress data to export.");
      return;
    }
    const headers = ['Student Name', 'Student Email', 'Class / Cohort', 'Programme', 'Student UID', 'Latest Progress', 'Last Updated'];
    const rows = latestProgress.map(p => {
      const studentObj = students.find(s => s.uid === p.studentUid || s.email === p.studentEmail || s.email === p.email);
      const email = p.studentEmail || p.email || p.userEmail || studentObj?.email || (p.studentUid?.includes('@') ? p.studentUid : '');
      const prof = getStudentProfile(p, studentProfiles);
      const displayName = p.displayName || p.studentName || studentObj?.displayName || getStudentDisplayName(p, studentProfiles);
      const studentClass = prof.studentClass || p.studentClass || p.cohort || studentObj?.studentClass || '';
      const programme = prof.programme || p.programme || studentObj?.programme || '';
      const studentUid = p.studentUid || p.uid || studentObj?.uid || 'N/A';
      return [
        displayName,
        email || prof.email || 'N/A',
        studentClass,
        programme,
        studentUid,
        p.progress || 'No progress recorded',
        p.timestamp?.toDate ? p.timestamp.toDate().toISOString() : (p.timestamp || 'N/A')
      ];
    });
    const dateSuffix = new Date().toISOString().slice(0, 10);
    const filename = `Class_${classId}_Progress_Summary_Page_${summaryPage}_${dateSuffix}.xlsx`;
    await exportToExcel(headers, rows, filename);
  };

  const handleExportDetailExcel = async (studentEmail) => {
    if (!detailProgress || detailProgress.length === 0) {
      alert("No progress timeline entries to export.");
      return;
    }
    const studentObj = students.find(s => s.email === studentEmail || s.uid === selectedStudentUid);
    const prof = getStudentProfile(studentEmail || selectedStudentUid, studentProfiles);
    const displayName = studentObj?.displayName || getStudentDisplayName(studentEmail || selectedStudentUid, studentProfiles);
    const studentClass = prof.studentClass || studentObj?.studentClass || '';
    const programme = prof.programme || studentObj?.programme || '';
    const headers = ['Student Name', 'Student Email', 'Class / Cohort', 'Programme', 'Student UID', 'Progress Description', 'Timestamp'];
    const rows = detailProgress.map(p => [
      displayName,
      studentEmail || prof.email || selectedStudentUid || '',
      studentClass,
      programme,
      selectedStudentUid || prof.uid || 'N/A',
      p.progress || '',
      p.timestamp?.toDate ? p.timestamp.toDate().toISOString() : (p.timestamp || 'N/A')
    ]);
    const safeTag = (displayName || studentEmail || selectedStudentUid).replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `Class_${classId}_Progress_Timeline_${safeTag}.xlsx`;
    await exportToExcel(headers, rows, filename);
  };

  const renderDetailView = () => {
    const studentEmail = (detailProgress.length > 0 && detailProgress[0].studentEmail) || (students.find(s => s.uid === selectedStudentUid))?.email || selectedStudentUid;

    return (
      <div className="view-container">
        <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button onClick={() => setSelectedStudentUid(null)}>Back to Summary</button>
            <h3 style={{ margin: 0 }}>Progress for {studentEmail}</h3>
          </div>
          <button
            onClick={() => handleExportDetailExcel(studentEmail)}
            disabled={detailLoading || detailProgress.length === 0}
            style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', cursor: 'pointer', fontWeight: 600 }}
          >
            📥 Export Student Timeline (Excel)
          </button>
        </div>
        {detailLoading ? <p>Loading...</p> : (
          <>
            <ul className="progress-list">
              {detailProgress.map((p) => (
                <li key={p.id} className="progress-item">
                  <p><strong>Progress:</strong> {p.progress}</p>
                  <p><strong>Timestamp:</strong> {p.timestamp ? new Date(p.timestamp?.toDate()).toLocaleString() : 'N/A'}</p>
                </li>
              ))}
            </ul>
            <div className="pagination-controls">
              <button onClick={fetchPrevPage} disabled={detailLoading || detailPage <= 1}>
                Previous
              </button>
              <span>Page {detailPage}</span>
              <button onClick={fetchNextPage} disabled={detailLoading || isDetailLastPage}>
                Next
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderSummaryView = () => {
    const totalPages = Math.ceil(students.length / itemsPerPage);
    const loading = loadingStudents || loadingProgress;

    return (
      <div className="view-container">
        <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Student Progress Summary</h2>
          <button
            onClick={handleExportSummaryExcel}
            disabled={loading || latestProgress.length === 0}
            style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', cursor: 'pointer', fontWeight: 600 }}
          >
            📥 Export Progress Summary (Excel)
          </button>
        </div>

        {loading ? (
          <p>Loading progress...</p>
        ) : students.length === 0 ? (
          <p>No students in this class.</p>
        ) : (
          <>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Latest Progress</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {latestProgress.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => setSelectedStudentUid(p.studentUid)}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{p.displayName || p.studentEmail}</div>
                        {p.displayName && p.displayName !== p.studentEmail && (
                          <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{p.studentEmail}</div>
                        )}
                        {(p.studentClass || p.programme) && (
                          <div style={{ marginTop: '2px' }}>
                            <span style={{ fontSize: '0.72rem', background: '#e2e8f0', color: '#475569', padding: '1px 5px', borderRadius: '3px' }}>
                              {[p.studentClass, p.programme].filter(Boolean).join(' • ')}
                            </span>
                          </div>
                        )}
                      </td>
                      <td>{p.progress}</td>
                      <td>{p.timestamp ? new Date(p.timestamp?.toDate ? p.timestamp.toDate() : p.timestamp).toLocaleString() : 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination-controls">
              <button onClick={() => setSummaryPage(p => Math.max(1, p - 1))} disabled={summaryPage <= 1}>
                Previous
              </button>
              <span>Page {summaryPage} of {totalPages}</span>
              <button onClick={() => setSummaryPage(p => Math.min(totalPages, p + 1))} disabled={summaryPage >= totalPages}>
                Next
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="progress-view">
      {selectedStudentUid ? renderDetailView() : renderSummaryView()}
    </div>
  );
};

export default ProgressView;