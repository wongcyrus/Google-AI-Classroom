import { useState } from 'react';
import { db, storage } from '../firebase-config';
import { doc, deleteDoc, getDoc } from 'firebase/firestore';
import { ref, deleteObject, getDownloadURL } from 'firebase/storage';
import './SharedViews.css';

import { getFunctions, httpsCallable } from 'firebase/functions';

import usePaginatedQuery from '../hooks/useCollectionQuery';

const DataManagementView = ({ classId, startTime, endTime, filterField }) => {
  const [selectedZipJobs, setSelectedZipJobs] = useState(new Set());

  const { 
    data: zipJobs, 
    loading: loadingJobs, 
    page, 
    isLastPage, 
    fetchNextPage, 
    fetchPrevPage, 
    refetch 
  } = usePaginatedQuery('zipJobs', {
    classId,
    startTime,
    endTime,
    filterField: filterField,
    orderByField: filterField
  });

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
    const jobDocSnap = await getDoc(jobDocRef);

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
    refetch();
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
            <button onClick={fetchPrevPage} disabled={page <= 1 || loadingJobs}>
            Previous
            </button>
            <span>Page {page}</span>
            <button onClick={fetchNextPage} disabled={isLastPage || loadingJobs}>
            Next
            </button>
        </div>
      </div>
    </div>
  );
};

export default DataManagementView;
