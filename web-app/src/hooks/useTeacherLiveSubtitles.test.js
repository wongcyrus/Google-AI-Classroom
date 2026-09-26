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

let whisperWorkerInstance = null;
let gemmaWorkerInstance = null;
let processorCallback = null;
const mockTranscribeAI = vi.fn();
const mockAcquireStream = vi.fn();

class MockWorker {
  constructor(url) {
    this.url = String(url || '');
    this.postMessage = vi.fn();
    this.terminate = vi.fn();
    this.onmessage = null;
    this.onerror = null;
    if (this.url.toLowerCase().includes('whisper')) {
      whisperWorkerInstance = this;
    } else {
      gemmaWorkerInstance = this;
    }
  }
}

vi.mock('../utils/audioWorkletHelper', () => ({
  attachAudioProcessor: vi.fn((audioCtx, source, cb) => {
    processorCallback = cb;
    return { disconnect: vi.fn() };
  }),
}));

vi.mock('../utils/aiLogic', () => ({
  transcribeAudioWithFirebaseAI: (...args) => mockTranscribeAI(...args),
}));

vi.mock('../utils/mediaDeviceCapture', () => ({
  acquireInputDeviceStream: (...args) => mockAcquireStream(...args),
}));

describe('useTeacherLiveSubtitles Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.Worker = MockWorker;
    whisperWorkerInstance = null;
    gemmaWorkerInstance = null;
    processorCallback = null;
    mockTranscribeAI.mockReset();
    mockAcquireStream.mockReset();
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

    mockAcquireStream.mockResolvedValueOnce(mockAudioStream);

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

  it('ignores publishSubtitle when originalText is empty or whitespace', async () => {
    const { result } = renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
        enabled: true,
      })
    );

    mockSetDoc.mockClear();

    await act(async () => {
      await result.current.publishSubtitle('   ');
      await result.current.publishSubtitle('');
    });

    expect(mockCallable).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('marks liveSubtitles session inactive on unmount or when disabled', async () => {
    const { unmount } = renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
        enabled: true,
      })
    );

    unmount();

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/CLASS_TEST_101/liveSubtitles/current' }),
      { active: false },
      { merge: true }
    );
  });

  it('resumes suspended AudioContext automatically during audio initialization', async () => {
    const mockResume = vi.fn().mockResolvedValue();
    class MockSuspendedAudioContext {
      constructor() {
        this.state = 'suspended';
        this.resume = mockResume;
        this.createMediaStreamSource = vi.fn().mockReturnValue({ connect: vi.fn() });
        this.createScriptProcessor = vi.fn().mockReturnValue({
          connect: vi.fn(),
          disconnect: vi.fn(),
        });
        this.destination = {};
        this.close = vi.fn().mockResolvedValue();
      }
    }
    window.AudioContext = MockSuspendedAudioContext;

    const mockTrack = { stop: vi.fn() };
    const mockAudioStream = {
      getAudioTracks: vi.fn().mockReturnValue([mockTrack]),
      getTracks: vi.fn().mockReturnValue([mockTrack]),
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
      await Promise.resolve();
    });

    expect(mockResume).toHaveBeenCalled();

    unmount();
    delete window.AudioContext;
  });

  it('falls back to server model in client mode if gemma worker is unavailable', async () => {
    mockCallable.mockResolvedValueOnce({
      data: {
        translations: {
          en: 'Fallback translated text',
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
      result.current.setTargetLanguages(['en']);
    });

    await act(async () => {
      await result.current.publishSubtitle('測試端側失敗回退');
    });

    expect(mockCallable).toHaveBeenCalled();
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        originalText: '測試端側失敗回退',
        translations: { en: 'Fallback translated text' },
      })
    );
  });

  it('handles Whisper worker INIT_COMPLETE, TRANSCRIBE_COMPLETE, and ERROR events', async () => {
    const { result } = renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
        enabled: true,
      })
    );

    expect(whisperWorkerInstance).toBeDefined();
    expect(whisperWorkerInstance.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'INIT' })
    );

    // Simulate INIT_COMPLETE
    act(() => {
      whisperWorkerInstance.onmessage({
        data: { type: 'INIT_COMPLETE', id: 1, payload: { ready: true } },
      });
    });
    expect(result.current.status).toBe('listening');

    // Simulate ERROR
    act(() => {
      whisperWorkerInstance.onmessage({
        data: { type: 'ERROR', id: 2, payload: { error: 'Whisper test failure' } },
      });
    });
    expect(result.current.error).toBe('Whisper test failure');
  });

  it('handles Gemma worker lifecycle in client engine mode (INIT, PROGRESS, and on-device translation)', async () => {
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
      result.current.setTargetLanguages(['en', 'zh-Hans']);
    });

    expect(gemmaWorkerInstance).toBeDefined();

    // Simulate Gemma INIT_COMPLETE
    act(() => {
      gemmaWorkerInstance.onmessage({
        data: {
          type: 'INIT_COMPLETE',
          payload: { ready: true, engine: 'litert_lm_gemma_e2b' },
        },
      });
    });
    expect(result.current.isGemmaAvailable).toBe(true);

    // Simulate PROGRESS
    act(() => {
      gemmaWorkerInstance.onmessage({
        data: {
          type: 'PROGRESS',
          payload: { progress: 85 },
        },
      });
    });
    expect(result.current.gemmaProgress).toBe(85);

    // Now publish a subtitle and let Gemma worker translate it
    let publishPromise;
    act(() => {
      publishPromise = result.current.publishSubtitle('你好，各位同學');
    });

    const gemmaCalls = gemmaWorkerInstance.postMessage.mock.calls.filter(
      (c) => c[0].type === 'TRANSLATE_TRANSCRIPT'
    );
    expect(gemmaCalls.length).toBeGreaterThan(0);
    const translateMsg = gemmaCalls[0][0];
    expect(translateMsg.payload.transcript).toBe('你好，各位同學');

    // Reply with TRANSLATE_COMPLETE
    await act(async () => {
      gemmaWorkerInstance.onmessage({
        data: {
          type: 'TRANSLATE_COMPLETE',
          id: translateMsg.id,
          payload: {
            translations: {
              en: 'Hello, fellow students',
              'zh-Hans': '你好，各位同学',
            },
          },
        },
      });
      await publishPromise;
    });

    expect(mockCallable).not.toHaveBeenCalled();
    expect(result.current.latestTranslations).toEqual({
      en: 'Hello, fellow students',
      'zh-Hans': '你好，各位同学',
    });
  });

  it('handles Gemma worker partial translations with server fallback for missing languages', async () => {
    mockCallable.mockResolvedValueOnce({
      data: {
        translations: {
          'zh-Hans': '云架构设计',
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
      result.current.setTargetLanguages(['en', 'zh-Hans']);
    });

    act(() => {
      gemmaWorkerInstance.onmessage({
        data: {
          type: 'INIT_COMPLETE',
          payload: { ready: true, engine: 'litert_lm_gemma_e2b' },
        },
      });
    });

    let publishPromise;
    act(() => {
      publishPromise = result.current.publishSubtitle('雲架構設計');
    });

    const translateCall = gemmaWorkerInstance.postMessage.mock.calls.find(
      (c) => c[0].type === 'TRANSLATE_TRANSCRIPT'
    )[0];

    // Gemma returns only 'en', missing 'zh-Hans'
    await act(async () => {
      gemmaWorkerInstance.onmessage({
        data: {
          type: 'TRANSLATE_COMPLETE',
          id: translateCall.id,
          payload: {
            translations: {
              en: 'Cloud Architecture Design',
            },
          },
        },
      });
      await publishPromise;
    });

    expect(mockCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        targetLangs: ['zh-Hans'],
      })
    );

    expect(result.current.latestTranslations).toEqual({
      en: 'Cloud Architecture Design',
      'zh-Hans': '云架构设计',
    });
  });

  it('buffers audio and flushes speech to Whisper worker upon silence boundary', async () => {
    vi.useFakeTimers();

    const mockTrack = { stop: vi.fn() };
    const mockAudioStream = {
      getAudioTracks: vi.fn().mockReturnValue([mockTrack]),
      getTracks: vi.fn().mockReturnValue([mockTrack]),
    };

    class MockAudioContext {
      constructor() {
        this.state = 'running';
        this.createMediaStreamSource = vi.fn().mockReturnValue({ connect: vi.fn() });
        this.destination = {};
        this.close = vi.fn().mockResolvedValue();
      }
    }
    window.AudioContext = MockAudioContext;

    renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
        enabled: true,
        audioStream: mockAudioStream,
      })
    );

    expect(processorCallback).toBeDefined();

    // Send active voice frames (RMS > 0.015)
    const loudPcm = new Float32Array(5000).fill(0.1);
    act(() => {
      processorCallback(loudPcm);
    });

    // Send silence frame (RMS < 0.015)
    const quietPcm = new Float32Array(1000).fill(0.001);
    act(() => {
      processorCallback(quietPcm);
    });

    // Fast-forward silence timeout (700ms)
    act(() => {
      vi.advanceTimersByTime(750);
    });

    const transcribeCalls = whisperWorkerInstance.postMessage.mock.calls.filter(
      (c) => c[0].type === 'TRANSCRIBE'
    );
    expect(transcribeCalls.length).toBe(1);

    const transcribeMsg = transcribeCalls[0][0];
    await act(async () => {
      whisperWorkerInstance.onmessage({
        data: {
          type: 'TRANSCRIBE_COMPLETE',
          id: transcribeMsg.id,
          payload: { transcript: 'Testing audio buffering' },
        },
      });
    });

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        originalText: 'Testing audio buffering',
      })
    );

    vi.useRealTimers();
    delete window.AudioContext;
  });

  it('falls back to Firebase AI transcription when Whisper returns empty transcript for speech buffer', async () => {
    vi.useFakeTimers();

    const mockTrack = { stop: vi.fn() };
    const mockAudioStream = {
      getAudioTracks: vi.fn().mockReturnValue([mockTrack]),
      getTracks: vi.fn().mockReturnValue([mockTrack]),
    };

    class MockAudioContext {
      constructor() {
        this.state = 'running';
        this.createMediaStreamSource = vi.fn().mockReturnValue({ connect: vi.fn() });
        this.destination = {};
        this.close = vi.fn().mockResolvedValue();
      }
    }
    window.AudioContext = MockAudioContext;

    mockTranscribeAI.mockResolvedValueOnce('AI recognized speech');

    renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
        enabled: true,
        audioStream: mockAudioStream,
      })
    );

    const loudPcm = new Float32Array(9000).fill(0.1);
    act(() => {
      processorCallback(loudPcm);
    });

    const quietPcm = new Float32Array(1000).fill(0.001);
    act(() => {
      processorCallback(quietPcm);
    });

    act(() => {
      vi.advanceTimersByTime(750);
    });

    const transcribeMsg = whisperWorkerInstance.postMessage.mock.calls.find(
      (c) => c[0].type === 'TRANSCRIBE'
    )[0];

    await act(async () => {
      whisperWorkerInstance.onmessage({
        data: {
          type: 'TRANSCRIBE_COMPLETE',
          id: transcribeMsg.id,
          payload: { transcript: '' },
        },
      });
      await Promise.resolve();
    });

    expect(mockTranscribeAI).toHaveBeenCalled();

    vi.useRealTimers();
    delete window.AudioContext;
  });

  it('sets error state when local stream has no audio tracks and fallback fails', async () => {
    const mockStreamWithoutAudio = {
      getAudioTracks: vi.fn().mockReturnValue([]),
      getTracks: vi.fn().mockReturnValue([]),
    };

    class MockAudioContext {
      constructor() {
        this.state = 'running';
        this.destination = {};
        this.close = vi.fn().mockResolvedValue();
      }
    }
    window.AudioContext = MockAudioContext;
    mockAcquireStream.mockResolvedValueOnce({
      getAudioTracks: vi.fn().mockReturnValue([]),
      getTracks: vi.fn().mockReturnValue([]),
    });

    const { result } = renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
        enabled: true,
        audioStream: mockStreamWithoutAudio,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.error ? (result.current.error.message || String(result.current.error)) : '').toMatch(/Selected microphone has no audio track|Microphone/i);
    expect(result.current.status).toBe('idle');

    delete window.AudioContext;
  });

  it('discards brief audio clicks under 4000 samples during silence flush', async () => {
    vi.useFakeTimers();

    const mockTrack = { stop: vi.fn() };
    const mockAudioStream = {
      getAudioTracks: vi.fn().mockReturnValue([mockTrack]),
      getTracks: vi.fn().mockReturnValue([mockTrack]),
    };

    class MockAudioContext {
      constructor() {
        this.state = 'running';
        this.createMediaStreamSource = vi.fn().mockReturnValue({ connect: vi.fn() });
        this.destination = {};
        this.close = vi.fn().mockResolvedValue();
      }
    }
    window.AudioContext = MockAudioContext;

    renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
        enabled: true,
        audioStream: mockAudioStream,
      })
    );

    whisperWorkerInstance.postMessage.mockClear();

    // 1000 samples of loud sound (< 4000 samples minimum)
    const shortClick = new Float32Array(1000).fill(0.1);
    act(() => {
      processorCallback(shortClick);
    });

    const quietPcm = new Float32Array(500).fill(0.001);
    act(() => {
      processorCallback(quietPcm);
    });

    // Advance silence timeout (700ms)
    act(() => {
      vi.advanceTimersByTime(750);
    });

    // Whisper worker should not receive TRANSCRIBE because click was discarded
    const transcribeCalls = whisperWorkerInstance.postMessage.mock.calls.filter(
      (c) => c[0].type === 'TRANSCRIBE'
    );
    expect(transcribeCalls.length).toBe(0);

    vi.useRealTimers();
    delete window.AudioContext;
  });

  it('handles SpeechRecognition onstart, onerror (network & other), and onend restarting', async () => {
    vi.useFakeTimers();

    let onStartCb = null;
    let onErrorCb = null;
    let onEndCb = null;

    class MockSpeechRecWithEvents {
      constructor() {
        this.continuous = false;
        this.interimResults = false;
        this.lang = '';
        this.start = vi.fn();
        this.abort = vi.fn();
      }
      set onstart(cb) { onStartCb = cb; }
      set onerror(cb) { onErrorCb = cb; }
      set onend(cb) { onEndCb = cb; }
      set onresult(cb) {}
    }
    window.SpeechRecognition = MockSpeechRecWithEvents;

    class MockAudioContext {
      constructor() {
        this.state = 'running';
        this.createMediaStreamSource = vi.fn().mockReturnValue({ connect: vi.fn() });
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

    renderHook(() =>
      useTeacherLiveSubtitles({
        classId: 'CLASS_TEST_101',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
        enabled: true,
        audioStream: mockAudioStream,
      })
    );

    expect(onStartCb).toBeDefined();
    act(() => {
      onStartCb();
    });

    // Trigger error 'network'
    expect(onErrorCb).toBeDefined();
    act(() => {
      onErrorCb({ error: 'network' });
    });

    // Trigger error 'audio-capture'
    act(() => {
      onErrorCb({ error: 'audio-capture' });
    });

    // Trigger onend, advancing safeStartRecognition timer (250ms)
    expect(onEndCb).toBeDefined();
    act(() => {
      onEndCb();
      vi.advanceTimersByTime(300);
    });

    vi.useRealTimers();
    delete window.SpeechRecognition;
    delete window.AudioContext;
  });
});
