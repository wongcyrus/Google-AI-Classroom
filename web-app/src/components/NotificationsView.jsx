import { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase-config';
import { collection, query, where, orderBy, limit, getDocs, startAfter, endBefore, limitToLast } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import './SharedViews.css';
import DateRangeFilter from './DateRangeFilter';
import { useClassSchedule } from '../hooks/useClassSchedule';

import usePaginatedQuery from '../hooks/useCollectionQuery';

const NotificationsView = ({ user, classId, startTime, endTime }) => {
  const collectionPath = user ? `teachers/${user.uid}/messages` : null;

  const { 
    data: messages, 
    loading, 
    page, 
    isLastPage, 
    fetchNextPage, 
    fetchPrevPage 
  } = usePaginatedQuery(collectionPath, { classId, startTime, endTime });

  const handleNext = () => {
    if (!isLastPage) {
        setPage(p => p + 1);
        fetchMessages('next');
    }
  };

  const handlePrev = () => {
      if (page > 1) {
          setPage(p => p - 1);
          fetchMessages('prev');
      }
  };

  return (
    <div className="view-container">
        <div className="view-header">
            <h2>Notifications</h2>
        </div>

        <div className="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Timestamp</th>
                        <th>Message</th>
                    </tr>
                </thead>
                <tbody>
                    {loading ? (
                        <tr><td colSpan="2">Loading...</td></tr>
                    ) : messages.length > 0 ? (
                        messages.map(msg => (
                            <tr key={msg.id}>
                                <td>{new Date(msg.timestamp?.toDate()).toLocaleString()}</td>
                                <td>{msg.message}</td>
                            </tr>
                        ))
                    ) : (
                        <tr><td colSpan="2">No notifications match the current filter.</td></tr>
                    )}
                </tbody>
            </table>
        </div>
        <div className="pagination-controls">
            <button onClick={fetchPrevPage} disabled={loading || page <= 1}>
            Previous
            </button>
            <span>Page {page}</span>
            <button onClick={fetchNextPage} disabled={loading || isLastPage}>
            Next
            </button>
        </div>
    </div>
  );
};

export default NotificationsView;
