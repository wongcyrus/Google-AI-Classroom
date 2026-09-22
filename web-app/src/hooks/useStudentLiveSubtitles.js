/**
 * useStudentLiveSubtitles.js
 * 
 * Custom hook for students to subscribe to teacher live subtitles in real time.
 * Listens to classes/{classId}/liveSubtitles/current via Firestore onSnapshot.
 * Provides student-level controls for display language, display mode (bilingual,
 * translation only, or original Cantonese only), font size, and visibility.
 * 
 * Dynamically computes available translated languages from the teacher's published
 * translations and targetLanguages, defaulting to Simplified Chinese (zh-Hans) and English (en).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase-config';

export const LANGUAGE_LABELS = {
  'zh-Hans': '简体中文',
  'zh-CN': '简体中文',
  'en': 'English',
  'zh-Hant': '繁體中文',
  'zh-HK': '繁體中文',
  'zh-TW': '繁體中文',
  'ja': '日本語',
  'ko': '한국어',
  'es': 'Español',
  'fr': 'Français',
  'de': 'Deutsch',
  'vi': 'Tiếng Việt',
  'id': 'Bahasa Indonesia',
  'th': 'ไทย',
  'pt': 'Português',
  'ar': 'العربية',
  'hi': 'हिन्दी',
};

export function getLanguageLabel(code) {
  if (!code) return '';
  return LANGUAGE_LABELS[code] || code;
}

export function useStudentLiveSubtitles({
  classId,
  defaultLanguage = 'zh-Hans',
}) {
  const [active, setActive] = useState(false);
  const [originalText, setOriginalText] = useState('');
  const [sourceLang, setSourceLang] = useState('zh-HK');
  const [translations, setTranslations] = useState({});
  const [targetLanguages, setTargetLanguages] = useState(['zh-Hans', 'en']);
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
        if (Array.isArray(data.targetLanguages) && data.targetLanguages.length > 0) {
          setTargetLanguages(data.targetLanguages);
        }
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

  // Compute available translated languages from teacher's active translations & targetLanguages
  const availableLanguages = useMemo(() => {
    const codes = new Set();

    // 1. Languages with actual translation output from teacher
    if (translations && typeof translations === 'object') {
      Object.keys(translations).forEach((k) => {
        if (translations[k]) codes.add(k);
      });
    }

    // 2. Languages configured as targets by teacher
    if (Array.isArray(targetLanguages)) {
      targetLanguages.forEach((k) => codes.add(k));
    }

    // 3. Fallback defaults: Simplified Chinese and English
    if (codes.size === 0) {
      codes.add('zh-Hans');
      codes.add('en');
    }

    // Order: zh-Hans first, en second, then remaining
    const orderedCodes = [];
    if (codes.has('zh-Hans')) {
      orderedCodes.push('zh-Hans');
      codes.delete('zh-Hans');
    }
    if (codes.has('en')) {
      orderedCodes.push('en');
      codes.delete('en');
    }
    codes.forEach((c) => orderedCodes.push(c));

    return orderedCodes.map((code) => ({
      code,
      label: getLanguageLabel(code),
    }));
  }, [translations, targetLanguages]);

  // If current selectedLanguage is not in teacher's availableLanguages, auto-switch to first available (zh-Hans or en)
  useEffect(() => {
    if (availableLanguages.length > 0) {
      const exists = availableLanguages.some((l) => l.code === selectedLanguage);
      if (!exists) {
        const fallback = availableLanguages.find((l) => l.code === 'zh-Hans')?.code ||
          availableLanguages.find((l) => l.code === 'en')?.code ||
          availableLanguages[0].code;
        setSelectedLanguageState(fallback);
      }
    }
  }, [availableLanguages, selectedLanguage]);

  // Determine current active translated text based on student preference
  const currentTranslation = translations[selectedLanguage] ||
    translations['zh-Hans'] ||
    translations['en'] ||
    translations['zh-Hant'] ||
    translations['zh'] ||
    Object.values(translations)[0] ||
    '';

  return {
    active,
    originalText,
    sourceLang,
    translations,
    availableLanguages,
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
