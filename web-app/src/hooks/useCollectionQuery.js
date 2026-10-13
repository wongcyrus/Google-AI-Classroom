import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../firebase-config';
import { collection, query, where, orderBy, getDocs, limit, startAfter } from 'firebase/firestore';

const EMPTY_ARRAY = [];

const usePaginatedQuery = (collectionPath, {
  classId,
  startTime,
  endTime,
  filterField = 'timestamp',
  orderByField = 'timestamp',
  orderByDirection = 'desc',
  pageSize = 10,
  extraClauses = EMPTY_ARRAY,
}) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [firstVisible, setFirstVisible] = useState(null);
  const [lastVisible, setLastVisible] = useState(null);
  const [isLastPage, setIsLastPage] = useState(false);
  const [page, setPage] = useState(1);
  const pageCursorsRef = useRef([null]);

  const buildQuery = useCallback(() => {
    if (!collectionPath) return null;
    let q = query(collection(db, collectionPath));

    if (classId) {
      q = query(q, where('classId', '==', classId));
    }
    if (startTime) {
      q = query(q, where(filterField, '>=', new Date(startTime)));
    }
    if (endTime) {
      q = query(q, where(filterField, '<=', new Date(endTime)));
    }

    extraClauses.forEach(clause => {
      q = query(q, where(clause.field, clause.op, clause.value));
    });

    q = query(q, orderBy(orderByField, orderByDirection));
    
    return q;
  }, [collectionPath, classId, startTime, endTime, filterField, orderByField, orderByDirection, extraClauses]);

  const fetchPage = useCallback(async (pageQuery) => {
    if (!pageQuery) return;
    setLoading(true);
    setError(null);
    try {
      const documentSnapshots = await getDocs(pageQuery);
      const fetchedData = documentSnapshots.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      setData(fetchedData);
      setFirstVisible(documentSnapshots.docs[0] || null);
      setLastVisible(documentSnapshots.docs[documentSnapshots.docs.length - 1] || null);
      
      if (documentSnapshots.docs.length < pageSize) {
        setIsLastPage(true);
      } else {
        setIsLastPage(false);
      }

    } catch (err) {
      console.error(`Error fetching from ${collectionPath}:`, err);
      setError(err);
      alert(
        `Failed to fetch data from '${collectionPath}'. A required database index is likely missing. ` +
        'Please check the browser console for an error message from Firestore that includes a link to create the index.'
      );
    }
    setLoading(false);
  }, [collectionPath, pageSize]);

  const fetchFirstPage = useCallback(() => {
    const q = buildQuery();
    pageCursorsRef.current = [null];
    setPage(1);
    fetchPage(query(q, limit(pageSize)));
  }, [buildQuery, fetchPage, pageSize]);

  const fetchNextPage = () => {
    if (lastVisible && !isLastPage) {
      const q = buildQuery();
      const nextPage = page + 1;
      pageCursorsRef.current[nextPage - 1] = lastVisible;
      setPage(nextPage);
      fetchPage(query(q, startAfter(lastVisible), limit(pageSize)));
    }
  };

  const fetchPrevPage = () => {
    if (page > 1) {
      const q = buildQuery();
      const prevPage = page - 1;
      const prevCursor = pageCursorsRef.current[prevPage - 1];
      setPage(prevPage);
      if (prevCursor) {
        fetchPage(query(q, startAfter(prevCursor), limit(pageSize)));
      } else {
        fetchPage(query(q, limit(pageSize)));
      }
    }
  };

  // Effect to fetch data when filters change
  useEffect(() => {
    if (collectionPath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchFirstPage();
    } else {
      setData([]);
      setLoading(false);
    }
  }, [collectionPath, classId, startTime, endTime, fetchFirstPage]);

  return { data, loading, error, page, isLastPage, fetchNextPage, fetchPrevPage, refetch: fetchFirstPage };
};

export default usePaginatedQuery;