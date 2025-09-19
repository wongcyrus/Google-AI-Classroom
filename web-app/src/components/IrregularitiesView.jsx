import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db, storage } from '../firebase-config';
import { collection, query, where, orderBy, limit, getDocs, startAfter, endBefore, limitToLast } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import './IrregularitiesView.css';

const IrregularitiesView = () => {
  const [irregularities, setIrregularities] = useState([]);
  const [imageUrls, setImageUrls] = useState({});
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [lastDoc, setLastDoc] = useState(null);
  const [firstDoc, setFirstDoc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [isLastPage, setIsLastPage] = useState(false);

  const PAGE_SIZE = 10;

  useEffect(() => {
    handlePageChange(1, 'first');
  }, [startDate, endDate]);

  const handlePageChange = async (newPage, direction) => {
    setLoading(true);
    const irregularitiesCollectionRef = collection(db, 'irregularities');
    let q = query(irregularitiesCollectionRef, orderBy('timestamp', 'desc'));

    // Apply date filters
    if (startDate) q = query(q, where('timestamp', '>=', new Date(startDate)));
    if (endDate) q = query(q, where('timestamp', '<=', new Date(endDate)));

    // Reset last page status on first page load
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
        setIrregularities(irregularitiesData);
        setFirstDoc(snapshot.docs[0]);
        setLastDoc(snapshot.docs[snapshot.docs.length - 1]);

        // Fetch image URLs
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
        setImageUrls(urls);
      } else {
        if (direction === 'next') {
          setIsLastPage(true);
        }
      }
    } catch (error) {
      console.error("Error fetching irregularities:", error);
    }
    setLoading(false);
  };

  const handleNext = () => {
    if (!isLastPage) {
      handlePageChange(page + 1, 'next');
    }
  };

  const handlePrev = () => {
    if (page > 1) {
      handlePageChange(page - 1, 'prev');
    }
  };

  const exportToCSV = async () => {
    setLoading(true);
    const irregularitiesCollectionRef = collection(db, 'irregularities');
    let q = query(irregularitiesCollectionRef, orderBy('timestamp', 'desc'));

    // Apply date filters
    if (startDate) q = query(q, where('timestamp', '>=', new Date(startDate)));
    if (endDate) q = query(q, where('timestamp', '<=', new Date(endDate)));

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
        item.imageUrl, // Use stored path directly
        item.timestamp.toDate().toLocaleString(),
      ].map(value => {
        const str = String(value).replace(/"/g, '""');
        return `"${str}"`;
      }));

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
    <div className="irregularities-view-container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2>Irregularities Report</h2>
        <Link to="/teacher">Back to Dashboard</Link>
      </div>
      <div className="filters-and-actions">
        <div className="date-filters">
          <label>From:</label>
          <input type="datetime-local" value={startDate} onChange={e => setStartDate(e.target.value)} />
          <label>To:</label>
          <input type="datetime-local" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
        <div className="actions">
          <button onClick={exportToCSV}>Export as CSV</button>
          <button onClick={printReport}>Print</button>
        </div>
      </div>
      <div className="irregularities-table-container">
        <table className="irregularities-table">
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
            {loading ? (
              <tr><td colSpan="5">Loading...</td></tr>
            ) : (
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
