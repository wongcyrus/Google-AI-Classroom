import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase-config';

export const useAudioPrompts = (user, applyToFilter = null) => {
  const [audioPrompts, setAudioPrompts] = useState([]);

  useEffect(() => {
    if (!user) {
      return;
    }
    const { uid } = user;

    const unsubscribers = [];
    let publicPrompts = [], privatePrompts = [], sharedPrompts = [];

    const combineAndSetPrompts = () => {
      const all = [...publicPrompts, ...privatePrompts, ...sharedPrompts];
      const unique = Array.from(new Map(all.map(p => [p.id, p])).values());
      let filtered;
      if (applyToFilter === 'Lecture STT & Chapters') {
        filtered = unique.filter(p =>
          p.category === 'audios' &&
          !p.name?.toLowerCase().includes('real-time') &&
          !p.name?.toLowerCase().includes('live') &&
          !p.name?.toLowerCase().includes('rolling') &&
          (
            p.applyTo?.includes('Lecture STT & Chapters') ||
            (p.name?.toLowerCase().includes('lecture') && (p.name?.includes('Speech-to-Text') || p.name?.includes('Chapters') || p.name?.includes('STT')))
          )
        );
      } else if (applyToFilter === 'Live Subtitles & Translation') {
        // Exclusively Live Subtitles & Translation (never whole lecture recording prompts)
        filtered = unique.filter(p =>
          (p.applyTo?.includes('Live Subtitles & Translation') || (p.category === 'translations' && !p.applyTo?.includes('Lecture Subtitles & Chapters'))) &&
          !p.applyTo?.includes('Lecture Subtitles & Chapters') &&
          !p.applyTo?.includes('Lecture STT & Chapters')
        );
      } else if (applyToFilter === 'Lecture Subtitles & Chapters') {
        filtered = unique.filter(p =>
          p.applyTo?.includes('Lecture Subtitles & Chapters')
        );
      } else {
        filtered = unique.filter(p => p.category === 'audios');
        if (applyToFilter) {
          filtered = filtered.filter(p => !p.applyTo || p.applyTo.includes(applyToFilter));
        }
      }
      filtered.sort((a, b) => a.name.localeCompare(b.name));
      setAudioPrompts(filtered);
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

  return audioPrompts;
};
