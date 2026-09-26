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
    expect(result.current.selectedLanguage).toBe('zh-Hans');
    expect(result.current.availableLanguages).toEqual([
      { code: 'zh-Hans', label: '简体中文' },
      { code: 'en', label: 'English' },
    ]);
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
            'zh-Hans': '今天讲解 Docker 容器',
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
    expect(result.current.currentTranslation).toBe('今天讲解 Docker 容器');
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

  it('handles falsy classId and snapshot not existing', () => {
    const { result: resNoClass } = renderHook(() =>
      useStudentLiveSubtitles({
        classId: '',
      })
    );
    expect(resNoClass.current.active).toBe(false);

    const { result: resWithClass } = renderHook(() =>
      useStudentLiveSubtitles({
        classId: 'CLASS_NOT_FOUND',
      })
    );

    act(() => {
      snapshotCallback({
        exists: () => false,
      });
    });

    expect(resWithClass.current.active).toBe(false);
  });

  it('auto-switches student language if current choice is not available in teacher stream', () => {
    localStorage.setItem('student_subtitle_lang', 'fr');

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
          originalText: 'Bonjour',
          targetLanguages: ['ja', 'ko'],
          translations: {
            ja: 'こんにちは',
            ko: '안녕하세요',
          },
        }),
      });
    });

    expect(result.current.availableLanguages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ja', label: '日本語' }),
        expect.objectContaining({ code: 'ko', label: '한국어' }),
      ])
    );
    // Automatically switches to first available target language since 'fr' is not provided
    expect(['ja', 'ko']).toContain(result.current.selectedLanguage);
  });

  it('falls back through translation priorities when selected language text is missing', () => {
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
          originalText: 'Sample speech',
          translations: {
            'zh-Hant': '繁體中文樣本',
          },
        }),
      });
    });

    // Student selected 'zh-Hans', but only 'zh-Hant' was provided -> fallback to zh-Hant
    expect(result.current.currentTranslation).toBe('繁體中文樣本');
  });

  it('subscribes to engine and recentHistory metadata and handles error callback gracefully', async () => {
    let errorCallback = null;
    const mockUnsub = vi.fn();
    const { onSnapshot } = vi.mocked(await import('firebase/firestore'));
    onSnapshot.mockImplementationOnce((ref, nextCb, errCb) => {
      errorCallback = errCb;
      return mockUnsub;
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result, unmount } = renderHook(() =>
      useStudentLiveSubtitles({
        classId: 'CLASS_TEST_ERR',
      })
    );

    act(() => {
      errorCallback(new Error('Firestore stream disconnected'));
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[useStudentLiveSubtitles] Subtitle listener error:'),
      expect.any(Error)
    );

    unmount();
    expect(mockUnsub).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
