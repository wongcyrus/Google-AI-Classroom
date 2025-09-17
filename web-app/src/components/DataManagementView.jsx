
import { useState, useEffect } from 'react';
import { db, storage } from '../firebase-config';
import { collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { useParams, Link } from 'react-router-dom';

const DataManagementView = ({ setTitle }) => {
  const { classId } = useParams();
  const [deleteStartDate, setDeleteStartDate] = useState('');
  const [deleteEndDate, setDeleteEndDate] = useState('');

  useEffect(() => {
    setTitle(`Data Management: ${classId}`);
  }, [classId, setTitle]);

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

  return (
    <div>
      <div>
        <h3>Delete Screenshots by Date Range</h3>
        <input type="date" value={deleteStartDate} onChange={e => setDeleteStartDate(e.target.value)} />
        <input type="date" value={deleteEndDate} onChange={e => setDeleteEndDate(e.target.value)} />
        <button onClick={handleDeleteData}>Delete Data</button>
      </div>

      <hr />
      <Link to="/teacher"><button>Back to Teacher View</button></Link>
    </div>
  );
};

export default DataManagementView;
