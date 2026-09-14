/**
 * useStudentLiveSubtitles.js
 * 
 * Custom hook for students to subscribe to teacher live subtitles in real time.
 * Listens to classes/{classId}/liveSubtitles/current via Firestore onSnapshot.
 * Provides student-level controls for display language, display mode (bilingual,
 * translation only, or original Cantonese only), font size, and visibility.
 */

import { useState, useEffect, useCallback } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase-config';

export function useStudentLiveSubtitles({
  classId,
  defaultLanguage = 'zh-Hant',
}) {
  const [active, setActive] = useState(false);
  const [originalText, setOriginalText] = useState('');
  const [sourceLang, setSourceLang] = useState('zh-HK');
  const [translations, setTranslations] = useState({});
  const [seq, setSeq] = useState(0);
  const [recentHistory, setRecentHistory] = useState([]);
  const [engine, setEngine] = useState('server');

  // Student preferences
  const [selectedLanguage, setSelectedLanguageState] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('student_subtitle_lang') || defaultLanguage;
    }
    return defaultLanguage;
  });

  const [displayMode, setDisplayModeState] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('student_subtitle_mode') || 'bilingual'; // 'bilingual' | 'translation' | 'original'
    }
    return 'bilingual';
  });

  const [fontSize, setFontSizeState] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('student_subtitle_font_size') || 'medium'; // 'small' | 'medium' | 'large'
    }
    return 'medium';
  });

  const [isVisible, setIsVisibleState] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('student_subtitle_visible') !== 'false';
    }
    return true;
  });

  const setSelectedLanguage = useCallback((lang) => {
    setSelectedLanguageState(lang);
    if (typeof window !== 'undefined') {
      localStorage.setItem('student_subtitle_lang', lang);
    }
  }, []);

  const setDisplayMode = useCallback((mode) => {
    setDisplayModeState(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('student_subtitle_mode', mode);
    }
  }, []);

  const setFontSize = useCallback((size) => {
    setFontSizeState(size);
    if (typeof window !== 'undefined') {
      localStorage.setItem('student_subtitle_font_size', size);
    }
  }, []);

  const setIsVisible = useCallback((visible) => {
    setIsVisibleState(visible);
    if (typeof window !== 'undefined') {
      localStorage.setItem('student_subtitle_visible', String(visible));
    }
  }, []);

  // Subscribe to liveSubtitles/current
  useEffect(() => {
    if (!classId) {
      setActive(false);
      return;
    }

    const subDocRef = doc(db, 'classes', classId, 'liveSubtitles', 'current');
    const unsubscribe = onSnapshot(
      subDocRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setActive(false);
          return;
        }

        const data = snapshot.data() || {};
        setActive(Boolean(data.active));
        if (data.originalText !== undefined) setOriginalText(data.originalText || '');
        if (data.sourceLang) setSourceLang(data.sourceLang);
        if (data.translations) setTranslations(data.translations);
        if (data.seq !== undefined) setSeq(data.seq);
        if (data.engine) setEngine(data.engine);
        if (Array.isArray(data.recentHistory)) setRecentHistory(data.recentHistory);
      },
      (err) => {
        console.warn('[useStudentLiveSubtitles] Subtitle listener error:', err);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [classId]);

  // Determine current active translated text based on student preference
  const currentTranslation = translations[selectedLanguage] ||
    translations['zh-Hant'] ||
    translations['zh'] ||
    Object.values(translations)[0] ||
    '';

  return {
    active,
    originalText,
    sourceLang,
    translations,
    currentTranslation,
    seq,
    recentHistory,
    engine,
    selectedLanguage,
    setSelectedLanguage,
    displayMode,
    setDisplayMode,
    fontSize,
    setFontSize,
    isVisible,
    setIsVisible,
  };
}
