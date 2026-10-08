import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase-config';

export const useTranslationPrompts = (user, applyToFilter = null) => {
  const [translationPrompts, setTranslationPrompts] = useState([]);

  useEffect(() => {
    if (!user) {
      setTranslationPrompts([]);
      return;
    }
    const { uid } = user;

    const unsubscribers = [];
    let publicPrompts = [], privatePrompts = [], sharedPrompts = [];

    const combineAndSetPrompts = () => {
      const all = [...publicPrompts, ...privatePrompts, ...sharedPrompts];
      const unique = Array.from(new Map(all.map(p => [p.id, p])).values());
      let filtered;
      if (applyToFilter === 'Lecture Subtitle Translation' || applyToFilter === 'Lecture Subtitles & Chapters') {
        filtered = unique.filter(p =>
          p.category === 'translations' &&
          !p.name?.toLowerCase().includes('live') &&
          !p.name?.toLowerCase().includes('real-time') &&
          !p.name?.toLowerCase().includes('rolling') &&
          (
            p.applyTo?.includes('Lecture Subtitle Translation') ||
            p.applyTo?.includes('Lecture Subtitles & Chapters') ||
            p.name?.toLowerCase().includes('lecture subtitle') ||
            p.name?.toLowerCase().includes('lecture translation')
          )
        );
      } else if (applyToFilter === 'Live Subtitles & Translation') {
        filtered = unique.filter(p =>
          p.category === 'translations' && (
            p.applyTo?.includes('Live Subtitles & Translation') ||
            (!p.applyTo?.includes('Lecture Subtitles & Chapters') && !p.applyTo?.includes('Lecture Subtitle Translation'))
          ) &&
          !p.applyTo?.includes('Lecture Subtitles & Chapters') &&
          !p.applyTo?.includes('Lecture Subtitle Translation')
        );
      } else if (applyToFilter) {
        filtered = unique.filter(p => p.applyTo?.includes(applyToFilter));
      } else {
        filtered = unique.filter(p => p.category === 'translations');
      }
      filtered.sort((a, b) => a.name.localeCompare(b.name));
      setTranslationPrompts(filtered);
    };

    const promptsCollectionRef = collection(db, 'prompts');

    const qPublic = query(promptsCollectionRef, where('accessLevel', '==', 'public'));
    unsubscribers.push(onSnapshot(qPublic, snapshot => {
      publicPrompts = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      combineAndSetPrompts();
    }));

    const qOwner = query(promptsCollectionRef, where('owner', '==', uid));
    unsubscribers.push(onSnapshot(qOwner, snapshot => {
      privatePrompts = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      combineAndSetPrompts();
    }));

    const qShared = query(promptsCollectionRef, where('sharedWith', 'array-contains', uid));
    unsubscribers.push(onSnapshot(qShared, snapshot => {
      sharedPrompts = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      combineAndSetPrompts();
    }));

    return () => unsubscribers.forEach(unsub => unsub());
  }, [user, applyToFilter]);

  return translationPrompts;
};

