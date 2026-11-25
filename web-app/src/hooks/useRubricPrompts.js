import { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase-config';
import { subscribeSharedPrompts } from './sharedPromptsStore';

export const useRubricPrompts = (user) => {
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
    const filtered = rawPrompts.filter(
      (p) => p.category === 'rubrics' ||
             p.applyTo?.includes('Lab Rubric Milestones') ||
             p.applyTo?.includes('Task Milestones Extraction') ||
             (p.category === 'videos' && (p.name || '').toLowerCase().includes('rubric'))
    );
    filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return filtered;
  }, [uid, rawPrompts]);
};
