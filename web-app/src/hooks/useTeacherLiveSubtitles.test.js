import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTeacherLiveSubtitles } from './useTeacherLiveSubtitles';

const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockCallable = vi.fn();

vi.mock('../firebase-config', () => ({
  db: {},
  functions: {},
}));

const mockAddDoc = vi.fn().mockResolvedValue({ id: 'job_123' });

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, ...segments) => ({ path: segments.join('/') })),
  collection: vi.fn((db, path) => ({ path })),
  setDoc: (...args) => mockSetDoc(...args),
  addDoc: (...args) => mockAddDoc(...args),
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
    expect(result.current.targetLanguages).toEqual(['zh-Hans', 'en']);
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

  it('aborts capture if teacherEmail is a student email', () => {
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

  it('guards against video-only stream (0 audio tracks) and falls back to acquireInputDeviceStream without crashing createMediaStreamSource', async () => {
    const mockAudioTrack = { stop: vi.fn() };
    const mockAudioStream = {
      getAudioTracks: vi.fn().mockReturnValue([mockAudioTrack]),
      getTracks: vi.fn().mockReturnValue([mockAudioTrack]),
    };

    const mockScreenStreamWithoutAudio = {
      getVideoTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]),
      getAudioTracks: vi.fn().mockReturnValue([]),
      getTracks: vi.fn().mockReturnValue([]),
    };

    const mockCreateMediaStreamSource = vi.fn().mockImplementation((stream) => {
      if (!stream || stream.getAudioTracks().length === 0) {
        throw new Error("Failed to execute 'createMediaStreamSource' on 'AudioContext': MediaStream has no audio track");
      }
      return { connect: vi.fn() };
    });

    class MockAudioContext {
      constructor() {
        this.state = 'running';
        this.createMediaStreamSource = mockCreateMediaStreamSource;
        this.createScriptProcessor = vi.fn().mockReturnValue({
          connect: vi.fn(),
          disconnect: vi.fn(),
        });
        this.destination = {};
        this.close = vi.fn().mockResolvedValue();
      }
    }
    window.AudioContext = MockAudioContext;

    const { result, unmount } = renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
        enabled: true,
        audioStream: mockScreenStreamWithoutAudio,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.error).toBeNull();

    unmount();
    delete window.AudioContext;
  });

  it('handles Web Speech Recognition events properly and publishes final transcripts', async () => {
    let onResultCallback = null;
    let onEndCallback = null;

    class MockSpeechRecognition {
      constructor() {
        this.continuous = false;
        this.interimResults = false;
        this.lang = '';
        this.start = vi.fn();
        this.abort = vi.fn();
      }
      set onresult(cb) {
        onResultCallback = cb;
      }
      set onend(cb) {
        onEndCallback = cb;
      }
      set onerror(cb) {}
    }
    window.SpeechRecognition = MockSpeechRecognition;

    mockCallable.mockResolvedValueOnce({
      data: {
        translations: {
          'zh-Hans': '今天上课',
          'en': 'Class today',
        },
      },
    });

    class MockAudioContext {
      constructor() {
        this.state = 'running';
        this.createMediaStreamSource = vi.fn().mockReturnValue({ connect: vi.fn() });
        this.createScriptProcessor = vi.fn().mockReturnValue({
          connect: vi.fn(),
          disconnect: vi.fn(),
        });
        this.destination = {};
        this.close = vi.fn().mockResolvedValue();
      }
    }
    window.AudioContext = MockAudioContext;

    const mockTrack = { stop: vi.fn() };
    const mockAudioStream = {
      getAudioTracks: vi.fn().mockReturnValue([mockTrack]),
      getTracks: vi.fn().mockReturnValue([mockTrack]),
    };

    const { result, unmount } = renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
        enabled: true,
        audioStream: mockAudioStream,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(onResultCallback).toBeDefined();

    await act(async () => {
      onResultCallback({
        resultIndex: 0,
        results: [
          Object.assign([{ transcript: '今日上堂' }], { isFinal: true }),
        ],
      });
    });

    expect(result.current.latestTranscript).toBe('今日上堂');

    unmount();
    delete window.SpeechRecognition;
    delete window.AudioContext;

    delete window.SpeechRecognition;
  });

  it('passes preceding subtitle history into subsequent translation requests', async () => {
    mockCallable.mockResolvedValue({
      data: {
        translations: { 'en': 'Translation' },
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
      await result.current.publishSubtitle('First sentence of lecture.');
    });

    await act(async () => {
      await result.current.publishSubtitle('Second sentence referring to it.');
    });

    expect(mockCallable).toHaveBeenLastCalledWith(expect.objectContaining({
      classId: 'CLASS_TEST_101',
      text: 'Second sentence referring to it.',
      historyText: ['First sentence of lecture.'],
    }));
  });

  it('falls back to original text for each target language if server translation throws an error', async () => {
    mockCallable.mockRejectedValueOnce(new Error('Gemini API quota exceeded'));

    const { result } = renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
        enabled: true,
        targetLanguages: ['en', 'zh-Hans'],
      })
    );

    await act(async () => {
      await result.current.publishSubtitle('測試伺服器錯誤降級');
    });

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        originalText: '測試伺服器錯誤降級',
        translations: {
          en: '測試伺服器錯誤降級',
          'zh-Hans': '測試伺服器錯誤降級',
        },
      })
    );
    expect(result.current.status).toBe('listening');
  });
});
