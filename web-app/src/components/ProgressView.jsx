import { useState, useMemo, useEffect } from 'react';
import { db } from '../firebase-config';
import { doc, getDoc, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import './SharedViews.css';
import usePaginatedQuery from '../hooks/useCollectionQuery';

const ProgressView = ({ classId, startTime, endTime }) => {
  const [selectedStudentUid, setSelectedStudentUid] = useState(null);

  // --- Logic for Summary View ---
  const [students, setStudents] = useState([]);
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
          const studentList = Object.entries(studentMap).map(([uid, email]) => ({ uid, email }));
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
          if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            return { id: doc.id, ...doc.data() };
          }
          return {
            id: student.uid, // fallback id
            studentUid: student.uid,
            studentEmail: student.email,
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
  }, [paginatedStudents, classId, startTime, endTime]);


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


  const renderDetailView = () => {
    const studentEmail = (detailProgress.length > 0 && detailProgress[0].studentEmail) || (students.find(s => s.uid === selectedStudentUid))?.email || selectedStudentUid;

    return (
      <div className="view-container">
        <div className="view-header">
            <button onClick={() => setSelectedStudentUid(null)}>Back to Summary</button>
            <h3>Progress for {studentEmail}</h3>
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
        <div className="view-header">
          <h2>Student Progress Summary</h2>
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
                      <td>{p.studentEmail}</td>
                      <td>{p.progress}</td>
                      <td>{p.timestamp ? new Date(p.timestamp?.toDate()).toLocaleString() : 'N/A'}</td>
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