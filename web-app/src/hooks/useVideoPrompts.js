import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase-config';

export const useVideoPrompts = (user) => {
  const [videoPrompts, setVideoPrompts] = useState([]);

  useEffect(() => {
    if (!user) {
      setVideoPrompts([]);
      return;
    }
    const { uid } = user;

    const unsubscribers = [];
    let publicPrompts = [], privatePrompts = [], sharedPrompts = [];

    const combineAndSetPrompts = () => {
      const all = [...publicPrompts, ...privatePrompts, ...sharedPrompts];
      const unique = Array.from(new Map(all.map(p => [p.id, p])).values());
      const filtered = unique.filter(p => p.category === 'videos');
      filtered.sort((a, b) => a.name.localeCompare(b.name));
      setVideoPrompts(filtered);
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
  }, [user]);

  return videoPrompts;
};
