import { useState, useEffect, useCallback } from 'react';
import { db, storage } from '../firebase-config';
import { collection, query, where, getDocs, writeBatch, orderBy, limit, startAfter, endBefore, limitToLast, doc, deleteDoc, getDoc } from 'firebase/firestore';
import { ref, deleteObject, getDownloadURL } from 'firebase/storage';
import { useParams } from 'react-router-dom';
import './SharedViews.css';
import DateRangeFilter from './DateRangeFilter';
import { useClassSchedule } from '../hooks/useClassSchedule';

import { getFunctions, httpsCallable } from 'firebase/functions';

const PAGE_SIZE = 10;

const DataManagementView = () => {
  const { classId } = useParams();
  
  const {
    lessons,
    selectedLesson,
    startTime,
    endTime,
    setStartTime,
    setEndTime,
    handleLessonChange,
  } = useClassSchedule(classId);

  // State for pagination
  const [zipJobs, setZipJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [page, setPage] = useState(1);
  const [firstDoc, setFirstDoc] = useState(null);
  const [lastDoc, setLastDoc] = useState(null);
  const [isLastPage, setIsLastPage] = useState(false);
  const [selectedZipJobs, setSelectedZipJobs] = useState(new Set());

  const fetchJobs = async (direction = 'first', newPage = 1) => {
    setLoadingJobs(true);
    const jobsCollectionRef = collection(db, 'zipJobs');
    let q = query(
      jobsCollectionRef,
      where('classId', '==', classId),
      where('startTime', '>=', new Date(startTime)),
      where('startTime', '<=', new Date(endTime)),
      orderBy('startTime', 'desc'),
      orderBy('createdAt', 'desc')
    );

    if (direction === 'first') {
      setIsLastPage(false);
    }

    switch (direction) {
      case 'next':
        q = query(q, startAfter(lastDoc), limit(PAGE_SIZE));
        break;
      case 'prev':
        q = query(q, endBefore(firstDoc), limitToLast(PAGE_SIZE));
        break;
      default: // first
        q = query(q, limit(PAGE_SIZE));
        break;
    }

    try {
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        setPage(newPage);
        setIsLastPage(snapshot.docs.length < PAGE_SIZE);
        const jobsData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        if (direction === 'prev') {
          jobsData.reverse();
        }
        setZipJobs(jobsData);
        setFirstDoc(snapshot.docs[0]);
        setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
      } else {
        setZipJobs([]);
        if (direction === 'next') setIsLastPage(true);
        if (direction === 'first') setPage(1);
      }
    } catch (error) {
      console.error("Error fetching zip jobs:", error);
    }
    setLoadingJobs(false);
  };

  useEffect(() => {
    if (classId) {
      fetchJobs('first', 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, startTime, endTime]);

  const handleNext = () => {
    if (!isLastPage) {
      fetchJobs('next', page + 1);
    }
  };

  const handlePrev = () => {
    if (page > 1) {
      fetchJobs('prev', page - 1);
    }
  };

  const handleSelectZipJob = (jobId) => {
    setSelectedZipJobs(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(jobId)) {
        newSelection.delete(jobId);
      } else {
        newSelection.add(jobId);
      }
      return newSelection;
    });
  };

  const handleSelectAllZipJobs = (e) => {
    if (e.target.checked) {
      const allJobIds = new Set(zipJobs.map(job => job.id));
      setSelectedZipJobs(allJobIds);
    } else {
      setSelectedZipJobs(new Set());
    }
  };

  const deleteZipJob = async (jobId) => {
    const jobDocRef = doc(db, 'zipJobs', jobId);
    const jobDocSnap = await getDoc(jobDocRef); // getDocs is for queries, getDoc is for single doc

    if (jobDocSnap.exists()) {
      const jobData = jobDocSnap.data();
      if (jobData.zipPath) {
        const storageRef = ref(storage, jobData.zipPath);
        await deleteObject(storageRef);
      }
    }
    await deleteDoc(jobDocRef);
  };

  const handleDeleteSelectedZipJobs = async () => {
    if (selectedZipJobs.size === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedZipJobs.size} selected jobs? This will also delete their associated zip files.`)) {
      return;
    }

    const errors = [];
    for (const jobId of selectedZipJobs) {
      try {
        await deleteZipJob(jobId);
      } catch (error) {
        console.error(`Failed to delete job ${jobId}`, error);
        errors.push(jobId);
      }
    }

    setSelectedZipJobs(new Set());
    if (errors.length > 0) {
      alert(`Failed to delete ${errors.length} jobs. See console for details.`);
    } else {
      alert(`Successfully deleted ${selectedZipJobs.size} jobs.`);
    }
    // Refetch data
    fetchJobs('first', 1);
  };

  const handleDeleteData = async () => {
    if (!startTime || !endTime) {
      alert('Please select a start and end date.');
      return;
    }

    const confirmation = window.confirm(
      'Are you sure you want to delete data in this date range? This will trigger a backend process and cannot be undone.'
    );
    if (!confirmation) return;

    const functions = getFunctions();
    const deleteFunction = httpsCallable(functions, 'deleteScreenshotsByDateRange');

    try {
      alert("Starting the deletion process. This may take some time. You can close this window.");
      const result = await deleteFunction({
        classId,
        startDate: startTime,
        endDate: endTime,
      });
      alert(result.data.message);
    } catch (error) {
      console.error("Error calling delete function: ", error);
      alert(`An error occurred: ${error.message}`);
    }
  };

  const handleDownloadZip = async (zipPath) => {
    try {
      const zipRef = ref(storage, zipPath);
      const downloadUrl = await getDownloadURL(zipRef);
      window.open(downloadUrl, '_blank');
    } catch (error) {
      console.error("Error getting download URL: ", error);
      alert(`Failed to get download link: ${error.message}`);
    }
  };

  return (
    <div className="view-container">
      <div className="view-header">
        <h2>Data Management</h2>
      </div>
      
      <div className="actions-container">
        <DateRangeFilter
          startTime={startTime}
          endTime={endTime}
          onStartTimeChange={setStartTime}
          onEndTimeChange={setEndTime}
          loading={loadingJobs}
          lessons={lessons}
          selectedLesson={selectedLesson}
          onLessonChange={handleLessonChange}
        />
        <button onClick={handleDeleteData}>Delete Screenshots in Range</button>
      </div>

      <hr style={{ margin: '20px 0' }} />

      <div>
        <h3>Video Archives (ZIP Jobs)</h3>
        <div className="actions-container" style={{ marginBottom: '10px' }}>
            <button onClick={handleDeleteSelectedZipJobs} disabled={selectedZipJobs.size === 0}>
                Delete Selected ({selectedZipJobs.size})
            </button>
        </div>
        <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" onChange={handleSelectAllZipJobs} /></th>
                  <th>Requested At</th>
                  <th>Status</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {loadingJobs && zipJobs.length === 0 ? (
                    <tr><td colSpan="4">Loading...</td></tr>
                ) : zipJobs.length > 0 ? (
                    zipJobs.map(job => (
                    <tr key={job.id}>
                        <td>
                            <input
                                type="checkbox"
                                checked={selectedZipJobs.has(job.id)}
                                onChange={() => handleSelectZipJob(job.id)}
                            />
                        </td>
                        <td>{job.createdAt?.toDate().toLocaleString()}</td>
                        <td>{job.status}</td>
                        <td>
                        {job.status === 'completed' && job.zipPath ? (
                            <button onClick={() => handleDownloadZip(job.zipPath)}>Download</button>
                        ) : (
                            <span>{job.status === 'failed' ? `Failed: ${job.error}` : 'Processing...'}</span>
                        )}
                        </td>
                    </tr>
                    ))
                ) : (
                    <tr><td colSpan="4">No video archive jobs found for this class.</td></tr>
                )}
              </tbody>
            </table>
        </div>
        <div className="pagination-controls">
            <button onClick={handlePrev} disabled={page <= 1 || loadingJobs}>
            Previous
            </button>
            <span>Page {page}</span>
            <button onClick={handleNext} disabled={isLastPage || loadingJobs}>
            Next
            </button>
        </div>
      </div>
    </div>
  );
};

export default DataManagementView;
