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

  it('handles live session streaming callbacks (usage, transcript, chunk, turn complete, error)', async () => {
    localStorage.setItem('teacher_subtitle_engine_mode', 'firebase_live');
    window.AudioContext = vi.fn().mockImplementation(function () {
      return {
        state: 'running',
        createMediaStreamSource: vi.fn().mockReturnValue({
          connect: vi.fn(),
          disconnect: vi.fn(),
        }),
        createScriptProcessor: vi.fn().mockReturnValue({
          connect: vi.fn(),
          disconnect: vi.fn(),
          onaudioprocess: null,
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };
    });

    const mockTrack = { stop: vi.fn() };
    const mockAudioStream = {
      getTracks: vi.fn().mockReturnValue([mockTrack]),
      getAudioTracks: vi.fn().mockReturnValue([mockTrack]),
    };

    const { result } = renderHook(() =>
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

    expect(mockLiveSessionInstance.options).toBeDefined();

    act(() => {
      mockLiveSessionInstance.options.onUsageUpdate({ totalTokens: 80, durationSeconds: 15 });
      mockLiveSessionInstance.options.onOriginalTranscript('即時廣東話語音');
      mockLiveSessionInstance.options.onTranslatedChunk('Real-time Cantonese speech');
    });

    expect(result.current.liveUsageStats).toEqual({ totalTokens: 80, durationSeconds: 15 });
    expect(result.current.latestTranscript).toBe('即時廣東話語音');
    expect(result.current.latestTranslations).toEqual({ 'zh-Hans': 'Real-time Cantonese speech' });

    await act(async () => {
      mockLiveSessionInstance.options.onTurnComplete();
    });

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        originalText: '即時廣東話語音',
        translations: { 'zh-Hans': 'Real-time Cantonese speech' },
      })
    );

    act(() => {
      mockLiveSessionInstance.options.onError(new Error('Sample stream notice'));
    });

    delete window.AudioContext;
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

  it('exposes languagePairStatuses and initializes availability', async () => {
    window.Translator = {
      availability: vi.fn().mockImplementation(async ({ targetLanguage }) => {
        return targetLanguage === 'en' ? 'readily' : 'no';
      }),
      create: vi.fn(),
    };

    const { result } = renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
        enabled: false,
      })
    );

    await waitFor(() => {
      expect(result.current.languagePairStatuses).toBeDefined();
    });

    delete window.Translator;
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

    const mediaCaptureModule = await import('../utils/mediaDeviceCapture');
    const acquireSpy = vi.spyOn(mediaCaptureModule, 'acquireInputDeviceStream')
      .mockResolvedValue(mockAudioStream);

    renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
        enabled: true,
        audioStream: mockScreenStreamWithoutAudio,
        deviceId: 'custom-mic-id',
      })
    );

    await waitFor(() => {
      expect(acquireSpy).toHaveBeenCalledWith('audio', 'custom-mic-id', expect.any(Object));
      expect(mockCreateMediaStreamSource).toHaveBeenCalledWith(mockAudioStream);
    });

    acquireSpy.mockRestore();
    delete window.AudioContext;
  });

  it('forwards custom courseContext and subtitlePrompt to translateTeacherSpeech in server mode', async () => {
    mockCallable.mockResolvedValueOnce({
      data: {
        translations: {
          'zh-Hant': '今天我們討論護理流程',
          'en': 'Today we discuss nursing procedures',
        },
      },
    });

    const { result } = renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_NURSING_101',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
        enabled: true,
        courseContext: 'Healthcare, Nursing & Medical Sciences',
        subtitlePrompt: { promptText: 'Keep medical acronyms like CPR in English.' },
      })
    );

    await act(async () => {
      await result.current.publishSubtitle('今日講下護理流程');
    });

    expect(mockCallable).toHaveBeenCalledWith(expect.objectContaining({
      classId: 'CLASS_NURSING_101',
      text: '今日講下護理流程',
      context: 'Healthcare, Nursing & Medical Sciences',
      customPrompt: 'Keep medical acronyms like CPR in English.',
    }));

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        engine: 'server',
        originalText: '今日講下護理流程',
        translations: {
          'zh-Hant': '今天我們討論護理流程',
          'en': 'Today we discuss nursing procedures',
        },
      })
    );
  });

  it('translates via on-device Gemma worker in client mode when worker is ready', async () => {
    class MockGemmaWorker {
      constructor() {
        MockGemmaWorker.instance = this;
        this.onmessage = null;
        // Simulate immediate initialization complete
        setTimeout(() => {
          if (this.onmessage) {
            this.onmessage({
              data: {
                type: 'INIT_COMPLETE',
                id: 1,
                payload: { ready: true, engine: 'litert_lm_gemma_e2b' },
              },
            });
          }
        }, 10);
      }
      postMessage(msg) {
        if (msg.type === 'TRANSLATE_TRANSCRIPT') {
          setTimeout(() => {
            if (this.onmessage) {
              this.onmessage({
                data: {
                  type: 'TRANSLATE_COMPLETE',
                  id: msg.id,
                  payload: {
                    translations: {
                      'zh-Hans': '今天演示 Gemma 本地翻译',
                      'en': 'Today demonstrating Gemma local translation',
                    },
                    sourceLang: msg.payload.sourceLang,
                    targetLangs: msg.payload.targetLangs,
                  },
                },
              });
            }
          }, 10);
        }
      }
      terminate() {}
    }

    const originalWorker = window.Worker;
    window.Worker = MockGemmaWorker;

    const { result } = renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_AI_101',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
        enabled: true,
        courseContext: 'Artificial Intelligence & Machine Learning',
      })
    );

    act(() => {
      result.current.setEngineMode('client');
    });

    await waitFor(() => {
      expect(result.current.isGemmaAvailable).toBe(true);
    });

    await act(async () => {
      await result.current.publishSubtitle('今日演示 Gemma 本地翻譯');
    });

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        engine: 'client',
        originalText: '今日演示 Gemma 本地翻譯',
        translations: {
          'zh-Hans': '今天演示 Gemma 本地翻译',
          'en': 'Today demonstrating Gemma local translation',
        },
      })
    );

    window.Worker = originalWorker;
  });

  it('falls back to server mode on App Check Live failure without mutating localStorage preference', async () => {
    localStorage.setItem('teacher_subtitle_engine_mode', 'firebase_live');

    mockLiveSessionInstance.connect.mockRejectedValueOnce(
      new Error("AI: Server connection handshake failed. Reason: 'Firebase App Check token is invalid.'")
    );

    const mockAudioStream = {
      getAudioTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]),
      getVideoTracks: vi.fn().mockReturnValue([]),
      getTracks: vi.fn().mockReturnValue([]),
    };

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

    const { result } = renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_LIVE_101',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
        enabled: true,
        audioStream: mockAudioStream,
      })
    );

    await waitFor(() => {
      expect(result.current.engineMode).toBe('server');
    });

    // Stored preference in localStorage should remain 'firebase_live'
    expect(localStorage.getItem('teacher_subtitle_engine_mode')).toBe('firebase_live');
    expect(result.current.error).toContain('Firebase Live is restricted by App Check');

    delete window.AudioContext;
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

  it('logs aiJob and closes live session upon unmounting during active live stream', async () => {
    localStorage.setItem('teacher_subtitle_engine_mode', 'firebase_live');
    window.AudioContext = vi.fn().mockImplementation(function () {
      return {
        state: 'running',
        createMediaStreamSource: vi.fn().mockReturnValue({
          connect: vi.fn(),
          disconnect: vi.fn(),
        }),
        createScriptProcessor: vi.fn().mockReturnValue({
          connect: vi.fn(),
          disconnect: vi.fn(),
          onaudioprocess: null,
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };
    });

    mockLiveSessionInstance.getSessionUsage = vi.fn().mockReturnValue({
      totalTokens: 120,
      durationSeconds: 25,
      audioTokens: 100,
      outputTokens: 20,
      estimatedCostUsd: 0.002,
      modelUsed: 'gemini-3.1-flash-live-preview',
    });

    const mockTrack = { stop: vi.fn() };
    const mockAudioStream = {
      getTracks: vi.fn().mockReturnValue([mockTrack]),
      getAudioTracks: vi.fn().mockReturnValue([mockTrack]),
    };

    const { unmount } = renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
        enabled: true,
        audioStream: mockAudioStream,
      })
    );

    await act(async () => {
      // allow setupAudio effect to resolve
      await Promise.resolve();
    });

    act(() => {
      unmount();
    });

    expect(mockAddDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'aiJobs' }),
      expect.objectContaining({
        jobType: 'liveSubtitleStream',
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        status: 'completed',
        durationSeconds: 25,
      })
    );
    expect(mockLiveSessionInstance.close).toHaveBeenCalled();

    delete window.AudioContext;
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

  it('performs partial server fallback when Chrome translator only supports some target languages', async () => {
    window.Translator = {
      availability: vi.fn().mockImplementation(async ({ targetLanguage }) => {
        return targetLanguage === 'en' ? 'readily' : 'no';
      }),
      create: vi.fn().mockImplementation(async ({ targetLanguage }) => {
        if (targetLanguage === 'en') {
          return {
            translate: vi.fn().mockResolvedValue('English translation from Chrome'),
            destroy: vi.fn(),
          };
        }
        throw new Error('Language not supported by Chrome');
      }),
    };

    mockCallable.mockResolvedValueOnce({
      data: {
        translations: {
          ja: 'Japanese translation from Gemini',
        },
      },
    });

    const { result } = renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
        enabled: true,
      })
    );

    act(() => {
      result.current.setEngineMode('client');
      result.current.setTargetLanguages(['en', 'ja']);
    });

    await act(async () => {
      await result.current.publishSubtitle('混合翻譯測試');
    });

    expect(mockCallable).toHaveBeenCalledWith(expect.objectContaining({
      targetLangs: ['ja'],
    }));

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        translations: expect.objectContaining({
          en: expect.any(String),
          ja: 'Japanese translation from Gemini',
        }),
      })
    );

    delete window.Translator;
  });
});



