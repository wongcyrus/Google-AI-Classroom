import { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase-config';
import { subscribeSharedPrompts } from './sharedPromptsStore';

export const useVideoPrompts = (user) => {
  const uid = user?.uid || null;
  const [rawPrompts, setRawPrompts] = useState([]);

  useEffect(() => {
    if (!uid) return;
    return subscribeSharedPrompts(db, uid, (uniquePrompts) => {
      setRawPrompts(uniquePrompts);
    });
  }, [uid]);

  return useMemo(() => {
    if (!uid) return [];
    const filtered = rawPrompts.filter((p) => p.category === 'videos');
    filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return filtered;
  }, [uid, rawPrompts]);
};
