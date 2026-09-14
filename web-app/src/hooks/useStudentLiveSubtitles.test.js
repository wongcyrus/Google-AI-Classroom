import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStudentLiveSubtitles } from './useStudentLiveSubtitles';

let snapshotCallback = null;

vi.mock('../firebase-config', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, ...segments) => ({ path: segments.join('/') })),
  onSnapshot: vi.fn((docRef, cb) => {
    snapshotCallback = cb;
    return vi.fn();
  }),
}));

describe('useStudentLiveSubtitles Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    snapshotCallback = null;
  });

  it('initializes with default preferences', () => {
    const { result } = renderHook(() =>
      useStudentLiveSubtitles({
        classId: 'CLASS_TEST_101',
      })
    );

    expect(result.current.active).toBe(false);
    expect(result.current.selectedLanguage).toBe('zh-Hant');
    expect(result.current.displayMode).toBe('bilingual');
    expect(result.current.fontSize).toBe('medium');
    expect(result.current.isVisible).toBe(true);
  });

  it('reacts to incoming liveSubtitles onSnapshot documents', () => {
    const { result } = renderHook(() =>
      useStudentLiveSubtitles({
        classId: 'CLASS_TEST_101',
      })
    );

    act(() => {
      snapshotCallback({
        exists: () => true,
        data: () => ({
          active: true,
          seq: 42,
          originalText: '今日講 Docker container',
          sourceLang: 'zh-HK',
          translations: {
            'zh-Hant': '今天講解 Docker 容器',
            'en': 'Today we cover Docker containers',
          },
          recentHistory: [
            { seq: 42, originalText: '今日講 Docker container' },
          ],
        }),
      });
    });

    expect(result.current.active).toBe(true);
    expect(result.current.seq).toBe(42);
    expect(result.current.originalText).toBe('今日講 Docker container');
    expect(result.current.currentTranslation).toBe('今天講解 Docker 容器');
  });

  it('updates translation when student changes selected language', () => {
    const { result } = renderHook(() =>
      useStudentLiveSubtitles({
        classId: 'CLASS_TEST_101',
      })
    );

    act(() => {
      snapshotCallback({
        exists: () => true,
        data: () => ({
          active: true,
          originalText: '今日講 Docker container',
          translations: {
            'zh-Hant': '今天講解 Docker 容器',
            'en': 'Today we cover Docker containers',
          },
        }),
      });
    });

    act(() => {
      result.current.setSelectedLanguage('en');
    });

    expect(result.current.selectedLanguage).toBe('en');
    expect(result.current.currentTranslation).toBe('Today we cover Docker containers');
    expect(localStorage.getItem('student_subtitle_lang')).toBe('en');
  });

  it('persists display mode and font size changes to localStorage', () => {
    const { result } = renderHook(() =>
      useStudentLiveSubtitles({
        classId: 'CLASS_TEST_101',
      })
    );

    act(() => {
      result.current.setDisplayMode('translation');
      result.current.setFontSize('large');
      result.current.setIsVisible(false);
    });

    expect(result.current.displayMode).toBe('translation');
    expect(localStorage.getItem('student_subtitle_mode')).toBe('translation');
    expect(result.current.fontSize).toBe('large');
    expect(localStorage.getItem('student_subtitle_font_size')).toBe('large');
    expect(result.current.isVisible).toBe(false);
    expect(localStorage.getItem('student_subtitle_visible')).toBe('false');
  });
});
