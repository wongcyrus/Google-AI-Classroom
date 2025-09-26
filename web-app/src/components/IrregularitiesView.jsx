import React, { useState, useEffect, useCallback } from 'react';
import { db, storage } from '../firebase-config';
import { useParams } from 'react-router-dom';
import { collection, query, where, orderBy, limit, getDocs, startAfter, endBefore, limitToLast } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import './SharedViews.css';
import DateRangeFilter from './DateRangeFilter';
import { useClassSchedule } from '../hooks/useClassSchedule';

const IrregularitiesView = () => {
  const { classId } = useParams();
  const [irregularities, setIrregularities] = useState([]);
  const [imageUrls, setImageUrls] = useState({});
  const {
    lessons,
    selectedLesson,
    startTime,
    endTime,
    setStartTime,
    setEndTime,
    handleLessonChange,
  } = useClassSchedule(classId);

  const [lastDoc, setLastDoc] = useState(null);
  const [firstDoc, setFirstDoc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [isLastPage, setIsLastPage] = useState(false);

  const PAGE_SIZE = 10;

  const fetchIrregularities = useCallback(async (direction = 'first', newPage = 1) => {
    if (!classId) return;
    setLoading(true);
    const irregularitiesCollectionRef = collection(db, 'irregularities');
    let q = query(irregularitiesCollectionRef, orderBy('timestamp', 'desc'));

    q = query(q, where('classId', '==', classId));
    if (startTime) q = query(q, where('timestamp', '>=', new Date(startTime)));
    if (endTime) q = query(q, where('timestamp', '<=', new Date(endTime)));

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
        const irregularitiesData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        if (direction === 'prev') {
          irregularitiesData.reverse();
        }
        setIrregularities(irregularitiesData);
        setFirstDoc(snapshot.docs[0]);
        setLastDoc(snapshot.docs[snapshot.docs.length - 1]);

        const urls = {};
        for (const item of irregularitiesData) {
          if (item.imageUrl) {
            try {
              const storageRef = ref(storage, item.imageUrl);
              const url = await getDownloadURL(storageRef);
              urls[item.id] = url;
            } catch (error) {
              console.error("Error getting download URL:", error);
            }
          }
        }
        setImageUrls(prev => ({ ...prev, ...urls }));
      } else {
        setIrregularities([]);
        if (direction === 'next') setIsLastPage(true);
        if (direction === 'first') setPage(1);
      }
    } catch (error) {
      console.error("Error fetching irregularities:", error);
    }
    setLoading(false);
  }, [classId, startTime, endTime, lastDoc, firstDoc]);

  useEffect(() => {
    fetchIrregularities('first', 1);
  }, [classId, startTime, endTime]);

  const handleNext = () => {
    if (!isLastPage) {
      fetchIrregularities('next', page + 1);
    }
  };

  const handlePrev = () => {
    if (page > 1) {
      fetchIrregularities('prev', page - 1);
    }
  };

  const exportToCSV = async () => {
    if (!classId) return;
    setLoading(true);
    const irregularitiesCollectionRef = collection(db, 'irregularities');
    let q = query(irregularitiesCollectionRef, orderBy('timestamp', 'desc'));

    q = query(q, where('classId', '==', classId));
    if (startTime) q = query(q, where('timestamp', '>=', new Date(startTime)));
    if (endTime) q = query(q, where('timestamp', '<=', new Date(endTime)));

    try {
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        alert("No data to export for the selected date range.");
        setLoading(false);
        return;
      }

      const allIrregularities = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));

      const headers = ['Email', 'Title', 'Message', 'Image Path', 'Timestamp'];
      const rows = allIrregularities.map(item => [
        item.email,
        item.title,
        item.message,
        item.imageUrl,
        item.timestamp.toDate().toLocaleString(),
      ].map(value => `"${String(value).replace(/"/g, '""')}"`));

      let csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + rows.map(e => e.join(",")).join("\n");

      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", "irregularities.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (error) {
      console.error("Error fetching all irregularities for export:", error);
      alert("Failed to export data.");
    }
    setLoading(false);
  };

  const printReport = () => {
    window.print();
  };

  return (
    <div className="view-container">
      <div className="view-header">
        <h2>Irregularities Report</h2>
      </div>
      <div className="actions-container">
        <DateRangeFilter 
          startTime={startTime}
          endTime={endTime}
          onStartTimeChange={setStartTime}
          onEndTimeChange={setEndTime}
          loading={loading}
          lessons={lessons}
          selectedLesson={selectedLesson}
          onLessonChange={handleLessonChange}
        />
        <div className="actions">
          <button onClick={exportToCSV} disabled={loading}>Export as CSV</button>
          <button onClick={printReport} disabled={loading}>Print</button>
        </div>
      </div>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Title</th>
              <th>Message</th>
              <th>Image</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {loading && irregularities.length === 0 ? (
              <tr><td colSpan="5">Loading...</td></tr>
            ) : irregularities.length > 0 ? (
              irregularities.map(item => (
                <tr key={item.id}>
                  <td>{item.email}</td>
                  <td>{item.title}</td>
                  <td>{item.message}</td>
                  <td>
                    {imageUrls[item.id] ? (
                      <a href={imageUrls[item.id]} target="_blank" rel="noopener noreferrer">
                        <img src={imageUrls[item.id]} alt="Irregularity" style={{ width: '100px', height: 'auto' }} />
                      </a>
                    ) : (
                      <span>No Image</span>
                    )}
                  </td>
                  <td>{item.timestamp.toDate().toLocaleString()}</td>
                </tr>
              ))
            ) : (
              <tr><td colSpan="5">No irregularities found for the selected criteria.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="pagination-controls">
        <button onClick={handlePrev} disabled={page <= 1 || loading}>
          Previous
        </button>
        <span>Page {page}</span>
        <button onClick={handleNext} disabled={isLastPage || loading}>
          Next
        </button>
      </div>
    </div>
  );
};

export default IrregularitiesView;