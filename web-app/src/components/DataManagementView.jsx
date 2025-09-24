
import { useState, useEffect } from 'react';
import { db, storage } from '../firebase-config';
import { collection, query, where, getDocs, writeBatch, orderBy, onSnapshot } from 'firebase/firestore';
import { ref, deleteObject, getDownloadURL } from 'firebase/storage';
import { useParams, Link } from 'react-router-dom';

const DataManagementView = () => {
  const { classId } = useParams();
  const [deleteStartDate, setDeleteStartDate] = useState('');
  const [deleteEndDate, setDeleteEndDate] = useState('');
  const [zipJobs, setZipJobs] = useState([]);

  useEffect(() => {
    const jobsQuery = query(
      collection(db, 'zipJobs'),
      where('classId', '==', classId),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(jobsQuery, (querySnapshot) => {
      const jobs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setZipJobs(jobs);
    });

    return () => unsubscribe();
  }, [classId]);

  const handleDeleteData = async () => {
    if (!deleteStartDate || !deleteEndDate) {
      alert('Please select a start and end date.');
      return;
    }

    const confirmation = window.confirm('Are you sure you want to delete data in this date range? This action cannot be undone.');
    if (!confirmation) return;

    const startDate = new Date(deleteStartDate);
    const endDate = new Date(deleteEndDate);
    endDate.setHours(23, 59, 59, 999); // Set to end of day

    const screenshotsQuery = query(
      collection(db, 'screenshots'),
      where('classId', '==', classId),
      where('timestamp', '>=', startDate),
      where('timestamp', '<=', endDate)
    );

    try {
      const querySnapshot = await getDocs(screenshotsQuery);
      const batch = writeBatch(db);

      for (const doc of querySnapshot.docs) {
        const screenshotData = doc.data();
        const imageRef = ref(storage, screenshotData.imagePath);

        try {
          await deleteObject(imageRef);
        } catch (error) {
            if (error.code !== 'storage/object-not-found') {
                console.error("Error deleting image from storage: ", error);
            }
        }

        batch.delete(doc.ref);
      }

      await batch.commit();
      alert('Data deleted successfully!');
    } catch (error) {
      console.error("Error deleting data: ", error);
      alert('An error occurred while deleting data.');
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
    <div>
      <div>
        <h3>Delete Screenshots by Date Range</h3>
        <input type="date" value={deleteStartDate} onChange={e => setDeleteStartDate(e.target.value)} />
        <input type="date" value={deleteEndDate} onChange={e => setDeleteEndDate(e.target.value)} />
        <button onClick={handleDeleteData}>Delete Data</button>
      </div>

      <hr style={{ margin: '20px 0' }} />

      <div>
        <h3>Video Archives (ZIP Jobs)</h3>
        {zipJobs.length === 0 ? (
          <p>No video archive jobs found for this class.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #ddd', padding: '8px' }}>Requested At</th>
                <th style={{ border: '1px solid #ddd', padding: '8px' }}>Status</th>
                <th style={{ border: '1px solid #ddd', padding: '8px' }}>Download</th>
              </tr>
            </thead>
            <tbody>
              {zipJobs.map(job => (
                <tr key={job.id}>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>{job.createdAt?.toDate().toLocaleString()}</td>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>{job.status}</td>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>
                    {job.status === 'completed' && job.zipPath ? (
                      <button onClick={() => handleDownloadZip(job.zipPath)}>Download</button>
                    ) : (
                      <span>{job.status === 'failed' ? `Failed: ${job.error}` : 'Processing...'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Link to="/teacher" className="back-link">Back to Teacher View</Link>
    </div>
  );
};

export default DataManagementView;
