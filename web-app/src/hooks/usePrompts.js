
import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase-config';

export const usePrompts = () => {
  const [prompts, setPrompts] = useState([]);
  const [filteredPrompts, setFilteredPrompts] = useState([]);
  const [promptFilter, setPromptFilter] = useState('all');

  // Effect to fetch prompts
  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPrompts([]);
        return;
    }
    const { uid } = currentUser;

    const unsubscribers = [];
    let publicPrompts = [], privatePrompts = [], sharedPrompts = [];

    const combineAndSetPrompts = () => {
        const all = [...publicPrompts, ...privatePrompts, ...sharedPrompts];
        const unique = Array.from(new Map(all.map(p => [p.id, p])).values());
        const imagePrompts = unique.filter(p => p.category === 'images');
        imagePrompts.sort((a, b) => a.name.localeCompare(b.name));
        setPrompts(imagePrompts);
    };

    const qPublic = query(collection(db, 'prompts'), where('accessLevel', '==', 'public'));
    unsubscribers.push(onSnapshot(qPublic, snapshot => {
        publicPrompts = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        combineAndSetPrompts();
    }));

    const qOwner = query(collection(db, 'prompts'), where('owner', '==', uid));
    unsubscribers.push(onSnapshot(qOwner, snapshot => {
        privatePrompts = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        combineAndSetPrompts();
    }));

    const qShared = query(collection(db, 'prompts'), where('sharedWith', 'array-contains', uid));
    unsubscribers.push(onSnapshot(qShared, snapshot => {
        sharedPrompts = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        combineAndSetPrompts();
    }));

    return () => unsubscribers.forEach(unsub => unsub());
  }, []);

  useEffect(() => {
    const { uid } = auth.currentUser || {};
    if (!uid) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFilteredPrompts([]);
        return;
    }
    let newFilteredPrompts = [];
    if (promptFilter === 'all') {
        newFilteredPrompts = prompts;
    } else if (promptFilter === 'public') {
        newFilteredPrompts = prompts.filter(p => p.accessLevel === 'public');
    } else if (promptFilter === 'private') {
        newFilteredPrompts = prompts.filter(p => p.owner === uid && p.accessLevel === 'private');
    } else if (promptFilter === 'shared') {
        newFilteredPrompts = prompts.filter(p => p.accessLevel === 'shared');
    }
    setFilteredPrompts(newFilteredPrompts);
  }, [prompts, promptFilter]);

  return { prompts, filteredPrompts, promptFilter, setPromptFilter };
};
