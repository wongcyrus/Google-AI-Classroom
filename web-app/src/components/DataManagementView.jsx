import { useState, useEffect, useCallback } from 'react';
import { db, storage } from '../firebase-config';
import { collection, query, where, getDocs, writeBatch, orderBy, limit, startAfter, endBefore, limitToLast } from 'firebase/firestore';
import { ref, deleteObject, getDownloadURL } from 'firebase/storage';
import { useParams } from 'react-router-dom';
import './SharedViews.css';

import { getFunctions, httpsCallable } from 'firebase/functions';

const PAGE_SIZE = 10;

const DataManagementView = () => {
  const { classId } = useParams();
  const [deleteStartDate, setDeleteStartDate] = useState('');
  const [deleteEndDate, setDeleteEndDate] = useState('');
  
  // State for pagination
  const [zipJobs, setZipJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [page, setPage] = useState(1);
  const [firstDoc, setFirstDoc] = useState(null);
  const [lastDoc, setLastDoc] = useState(null);
  const [isLastPage, setIsLastPage] = useState(false);

  const fetchJobs = useCallback(async (direction = 'first', newPage = 1) => {
    setLoadingJobs(true);
    const jobsCollectionRef = collection(db, 'zipJobs');
    let q = query(
      jobsCollectionRef,
      where('classId', '==', classId),
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
  }, [classId, lastDoc, firstDoc]);

  useEffect(() => {
    if (classId) {
      fetchJobs('first', 1);
    }
  }, [classId]);

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

  const handleDeleteData = async () => {
    if (!deleteStartDate || !deleteEndDate) {
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
        startDate: deleteStartDate,
        endDate: deleteEndDate,
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
        <div>
            <h4>Delete Screenshots by Date Range</h4>
            <input type="date" value={deleteStartDate} onChange={e => setDeleteStartDate(e.target.value)} />
            <input type="date" value={deleteEndDate} onChange={e => setDeleteEndDate(e.target.value)} />
            <button onClick={handleDeleteData}>Delete Data</button>
        </div>
      </div>

      <hr style={{ margin: '20px 0' }} />

      <div>
        <h3>Video Archives (ZIP Jobs)</h3>
        <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Requested At</th>
                  <th>Status</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {loadingJobs && zipJobs.length === 0 ? (
                    <tr><td colSpan="3">Loading...</td></tr>
                ) : zipJobs.length > 0 ? (
                    zipJobs.map(job => (
                    <tr key={job.id}>
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
                    <tr><td colSpan="3">No video archive jobs found for this class.</td></tr>
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
