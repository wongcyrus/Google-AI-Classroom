import { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase-config';
import {
  DEFAULT_LECTURE_TRANSLATION_PROMPT,
  DEFAULT_LIVE_SUBTITLE_TRANSLATION_PROMPT,
} from '../constants/promptRegistry';
import { subscribeSharedPrompts } from './sharedPromptsStore';

const filterAndSortTranslationPrompts = (uniquePrompts, applyToFilter) => {
  const unique = [...uniquePrompts];
  if (applyToFilter === 'Lecture Subtitle Translation' || applyToFilter === 'Lecture Subtitles & Chapters') {
    if (!unique.some((p) => p.id === DEFAULT_LECTURE_TRANSLATION_PROMPT.id || p.name === DEFAULT_LECTURE_TRANSLATION_PROMPT.name)) {
      unique.unshift(DEFAULT_LECTURE_TRANSLATION_PROMPT);
    }
  } else if (applyToFilter === 'Live Subtitles & Translation') {
    if (!unique.some((p) => p.id === DEFAULT_LIVE_SUBTITLE_TRANSLATION_PROMPT.id || p.name === DEFAULT_LIVE_SUBTITLE_TRANSLATION_PROMPT.name)) {
      unique.unshift(DEFAULT_LIVE_SUBTITLE_TRANSLATION_PROMPT);
    }
  }
  let filtered;
  if (applyToFilter === 'Lecture Subtitle Translation' || applyToFilter === 'Lecture Subtitles & Chapters') {
    filtered = unique.filter((p) =>
      p.category === 'translations' &&
      !p.name?.toLowerCase().includes('live') &&
      !p.name?.toLowerCase().includes('real-time') &&
      !p.name?.toLowerCase().includes('rolling') &&
      !p.name?.toLowerCase().includes('gemma') &&
      !p.name?.toLowerCase().includes('on-device') &&
      (
        p.applyTo?.includes('Lecture Subtitle Translation') ||
        p.applyTo?.includes('Lecture Subtitles & Chapters') ||
        p.name?.toLowerCase().includes('lecture subtitle') ||
        p.name?.toLowerCase().includes('lecture translation') ||
        p.name?.toLowerCase().includes('whole-lecture')
      )
    );
  } else if (applyToFilter === 'Live Subtitles & Translation') {
    filtered = unique.filter((p) =>
      p.category === 'translations' &&
      !p.applyTo?.includes('Lecture Subtitles & Chapters') &&
      !p.applyTo?.includes('Lecture Subtitle Translation') &&
      !p.name?.toLowerCase().includes('whole-lecture') &&
      !p.name?.toLowerCase().includes('gemma') &&
      !p.name?.toLowerCase().includes('on-device') &&
      (
        p.applyTo?.includes('Live Subtitles & Translation') ||
        p.name?.toLowerCase().includes('live subtitle') ||
        p.name?.toLowerCase().includes('bilingual lecture & technical') ||
        p.name?.toLowerCase().includes('live speech') ||
        p.name?.toLowerCase().includes('live translation')
      )
    );
  } else if (applyToFilter) {
    filtered = unique.filter((p) => p.applyTo?.includes(applyToFilter));
  } else {
    filtered = unique.filter((p) => p.category === 'translations');
  }
  filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return filtered;
};

export const useTranslationPrompts = (user, applyToFilter = null, options = {}) => {
  const { enabled = true } = options || {};
  const [rawPrompts, setRawPrompts] = useState([]);
  const uid = user?.uid || null;

  useEffect(() => {
    if (!enabled || !uid) return;
    return subscribeSharedPrompts(db, uid, (uniquePrompts) => {
      setRawPrompts(uniquePrompts);
    });
  }, [uid, enabled]);

  return useMemo(() => {
    if (!enabled || !uid) return [];
    return filterAndSortTranslationPrompts(rawPrompts, applyToFilter);
  }, [enabled, uid, rawPrompts, applyToFilter]);
};

