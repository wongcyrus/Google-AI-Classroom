import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db, storage } from '../firebase-config';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import './IrregularitiesView.css';

const IrregularitiesView = () => {
  const [irregularities, setIrregularities] = useState([]);
  const [imageUrls, setImageUrls] = useState({});
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    const irregularitiesCollectionRef = collection(db, 'irregularities');
    let q = query(irregularitiesCollectionRef, orderBy('timestamp', 'desc'));

    if (startDate && endDate) {
      q = query(
        irregularitiesCollectionRef,
        where('timestamp', '>=', new Date(startDate)),
        where('timestamp', '<=', new Date(endDate)),
        orderBy('timestamp', 'desc')
      );
    } else if (startDate) {
      q = query(
        irregularitiesCollectionRef,
        where('timestamp', '>=', new Date(startDate)),
        orderBy('timestamp', 'desc')
      );
    } else if (endDate) {
      q = query(
        irregularitiesCollectionRef,
        where('timestamp', '<=', new Date(endDate)),
        orderBy('timestamp', 'desc')
      );
    }

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const irregularitiesData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      setIrregularities(irregularitiesData);

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
    });

    return () => unsubscribe();
  }, [startDate, endDate]);

  const exportToCSV = () => {
    const headers = ['Email', 'Title', 'Message', 'Image URL', 'Timestamp'];
    const rows = irregularities.map(item => [
      item.email,
      item.title,
      item.message,
      imageUrls[item.id] || item.imageUrl,
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
            {irregularities.map(item => (
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
                    <span>Loading...</span>
                  )}
                </td>
                <td>{item.timestamp.toDate().toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default IrregularitiesView;
