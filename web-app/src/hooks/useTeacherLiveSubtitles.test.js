import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTeacherLiveSubtitles } from './useTeacherLiveSubtitles';

const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockCallable = vi.fn();

vi.mock('../firebase-config', () => ({
  db: {},
  functions: {},
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, ...segments) => ({ path: segments.join('/') })),
  setDoc: (...args) => mockSetDoc(...args),
  serverTimestamp: vi.fn(() => 'MOCK_TIMESTAMP'),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => mockCallable),
}));

vi.mock('../utils/webAiLiteRTLoader', () => ({
  isWhisperModelCached: vi.fn().mockResolvedValue(true),
}));

vi.mock('../utils/audioDecoder', () => ({
  downsamplePcmTo16k: vi.fn((input) => new Float32Array(input)),
}));

const mockLiveSessionInstance = {
  connect: vi.fn().mockResolvedValue(),
  sendAudioChunk: vi.fn().mockResolvedValue(),
  close: vi.fn().mockResolvedValue(),
  isConnected: vi.fn().mockReturnValue(true),
};

vi.mock('../utils/aiLogic', () => ({
  createLiveSubtitleSession: vi.fn((options) => {
    mockLiveSessionInstance.options = options;
    return mockLiveSessionInstance;
  }),
}));

describe('useTeacherLiveSubtitles Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('initializes with default speech settings and exposes engine toggles', () => {
    const { result } = renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        enabled: false,
      })
    );

    expect(result.current.speechLanguage).toBe('zh-HK');
    expect(result.current.engineMode).toBe('server');
    expect(result.current.targetLanguages).toEqual(['zh-Hant', 'en']);
  });

  it('persists engineMode and language changes to localStorage', () => {
    const { result } = renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        enabled: false,
      })
    );

    act(() => {
      result.current.setEngineMode('client');
      result.current.setSpeechLanguage('zh-CN');
      result.current.setTargetLanguages(['zh-Hant', 'ja']);
    });

    expect(result.current.engineMode).toBe('client');
    expect(localStorage.getItem('teacher_subtitle_engine_mode')).toBe('client');
    expect(result.current.speechLanguage).toBe('zh-CN');
    expect(localStorage.getItem('teacher_subtitle_source_lang')).toBe('zh-CN');
    expect(result.current.targetLanguages).toEqual(['zh-Hant', 'ja']);
  });

  it('translates via Cloud Function in server mode and publishes to Firestore', async () => {
    mockCallable.mockResolvedValueOnce({
      data: {
        translations: {
          'zh-Hant': '今天我們使用 React Hooks',
          'en': 'Today we use React Hooks',
        },
      },
    });

    const { result } = renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@school.edu',
        enabled: true,
      })
    );

    await act(async () => {
      await result.current.publishSubtitle('今日我哋用 React Hooks');
    });

    expect(mockCallable).toHaveBeenCalledWith(expect.objectContaining({
      classId: 'CLASS_TEST_101',
      text: '今日我哋用 React Hooks',
      sourceLang: 'zh-HK',
    }));

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/CLASS_TEST_101/liveSubtitles/current' }),
      expect.objectContaining({
        seq: 1,
        originalText: '今日我哋用 React Hooks',
        translations: {
          'zh-Hant': '今天我們使用 React Hooks',
          'en': 'Today we use React Hooks',
        },
        engine: 'server',
        active: true,
      })
    );
  });

  it('uses window.Translator in client mode when available', async () => {
    const mockTranslator = {
      translate: vi.fn().mockResolvedValue('Today we use React Hooks (Local Nano)'),
    };
    window.Translator = {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn().mockResolvedValue(mockTranslator),
    };

    const { result } = renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        enabled: true,
      })
    );

    act(() => {
      result.current.setEngineMode('client');
    });

    await act(async () => {
      await result.current.publishSubtitle('今日我哋用 React Hooks');
    });

    expect(window.Translator.create).toHaveBeenCalled();
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        engine: 'client',
        originalText: '今日我哋用 React Hooks',
      })
    );

    delete window.Translator;
  });

  it('connects to Firebase AI Logic Live session in firebase_live mode and streams subtitles', async () => {
    localStorage.setItem('teacher_subtitle_engine_mode', 'firebase_live');

    const { result } = renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        enabled: true,
      })
    );

    expect(result.current.engineMode).toBe('firebase_live');

    // Manually publish or trigger through live session
    await act(async () => {
      await result.current.publishSubtitle(
        '今日介紹 Firebase AI Logic',
        { en: 'Today introducing Firebase AI Logic' },
        true
      );
    });

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        engine: 'firebase_live',
        originalText: '今日介紹 Firebase AI Logic',
        translations: { en: 'Today introducing Firebase AI Logic' },
        active: true,
      })
    );
  });

  it('aborts capture and live session setup if teacherEmail is a student email', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'student_1',
        teacherEmail: 'student@stu.vtc.edu.hk',
        enabled: true,
      })
    );

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('User is not an authorized instructor')
    );

    consoleWarnSpy.mockRestore();
  });
});

