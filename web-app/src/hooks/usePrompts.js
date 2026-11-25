
import { useState, useEffect, useMemo } from 'react';
import { db, auth } from '../firebase-config';
import { DEFAULT_BINGO_TEACHER_SCREEN_PROMPT } from '../constants/promptRegistry';
import { subscribeSharedPrompts } from './sharedPromptsStore';

const filterAndSortImagePrompts = (uniquePrompts, applyToFilter) => {
  const unique = [...uniquePrompts];
  if (applyToFilter === 'Classroom Bingo Questions' || applyToFilter === 'bingo') {
    if (!unique.some((p) => p.id === DEFAULT_BINGO_TEACHER_SCREEN_PROMPT.id || p.name === DEFAULT_BINGO_TEACHER_SCREEN_PROMPT.name)) {
      unique.unshift(DEFAULT_BINGO_TEACHER_SCREEN_PROMPT);
    }
  }
  let imagePrompts;

  if (applyToFilter === 'Classroom Bingo Questions' || applyToFilter === 'bingo') {
    imagePrompts = unique.filter((p) =>
      (p.category === 'images' || !p.category) && (
        p.applyTo?.includes('Classroom Bingo Questions') ||
        p.name?.toLowerCase().includes('bingo')
      )
    );
  } else if (applyToFilter === 'Per Image' || applyToFilter === 'invigilation') {
    imagePrompts = unique.filter((p) =>
      p.category === 'images' &&
      !p.name?.toLowerCase().includes('bingo') &&
      !p.applyTo?.includes('Classroom Bingo Questions') &&
      (!p.applyTo || p.applyTo.includes('Per Image') || p.applyTo.includes('All Images'))
    );
  } else if (applyToFilter === 'All Images') {
    imagePrompts = unique.filter((p) =>
      p.category === 'images' &&
      !p.name?.toLowerCase().includes('bingo') &&
      !p.applyTo?.includes('Classroom Bingo Questions') &&
      (!p.applyTo || p.applyTo.includes('All Images'))
    );
  } else if (applyToFilter) {
    imagePrompts = unique.filter((p) => p.category === 'images' && p.applyTo?.includes(applyToFilter));
  } else {
    imagePrompts = unique.filter((p) => p.category === 'images');
  }

  imagePrompts.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return imagePrompts;
};

export const usePrompts = (applyToFilter = null) => {
  const currentUid = auth.currentUser?.uid || null;
  const [rawPrompts, setRawPrompts] = useState([]);
  const [promptFilter, setPromptFilter] = useState('all');

  useEffect(() => {
    if (!currentUid) return;
    return subscribeSharedPrompts(db, currentUid, (uniquePrompts) => {
      setRawPrompts(uniquePrompts);
    });
  }, [currentUid]);

  const prompts = useMemo(() => {
    if (!currentUid) return [];
    return filterAndSortImagePrompts(rawPrompts, applyToFilter);
  }, [currentUid, rawPrompts, applyToFilter]);

  const filteredPrompts = useMemo(() => {
    if (!currentUid) return [];
    if (promptFilter === 'all') return prompts;
    if (promptFilter === 'public') return prompts.filter((p) => p.accessLevel === 'public');
    if (promptFilter === 'private') return prompts.filter((p) => p.owner === currentUid && p.accessLevel === 'private');
    if (promptFilter === 'shared') return prompts.filter((p) => p.accessLevel === 'shared');
    return [];
  }, [currentUid, prompts, promptFilter]);

  return { prompts, filteredPrompts, promptFilter, setPromptFilter };
};
