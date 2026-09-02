import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioSetup, normalizeTranscript, calculatePhraseMatchScore } from './useAudioSetup';

describe('useAudioSetup & Transcript Helper Utilities', () => {
  describe('normalizeTranscript', () => {
    it('lowercases, strips punctuation, and trims extra whitespace', () => {
      expect(normalizeTranscript('  Hello, World! 123...  ')).toBe('hello world 123');
      expect(normalizeTranscript('Test-Case #1: Good Morning?')).toBe('testcase 1 good morning');
      expect(normalizeTranscript('')).toBe('');
      expect(normalizeTranscript(null)).toBe('');
    });
  });

  describe('calculatePhraseMatchScore', () => {
    it('returns 1.0 if recognized contains full expected phrase', () => {
      const exp = 'microphone is working';
      const rec = 'yes my microphone is working properly';
      expect(calculatePhraseMatchScore(exp, rec)).toBe(1.0);
    });

    it('returns word overlap ratio if partially matched', () => {
      const exp = 'student mic is active';
      const rec = 'student mic is muted';
      // 3 of 4 words match: student, mic, is
      expect(calculatePhraseMatchScore(exp, rec)).toBe(0.75);
    });

    it('returns 0 if completely disjoint or empty', () => {
      expect(calculatePhraseMatchScore('alpha beta', 'gamma delta')).toBe(0);
      expect(calculatePhraseMatchScore('', 'something')).toBe(0);
      expect(calculatePhraseMatchScore('something', '')).toBe(0);
    });
  });

  describe('useAudioSetup Hook', () => {
    let originalMediaDevices;
    let originalAudioContext;

    beforeEach(() => {
      originalMediaDevices = navigator.mediaDevices;
      originalAudioContext = window.AudioContext;

      // Mock navigator.mediaDevices
      const mockStream = {
        getTracks: vi.fn(() => [{ stop: vi.fn(), readyState: 'live', enabled: true }]),
        getAudioTracks: vi.fn(() => [{ stop: vi.fn(), readyState: 'live', enabled: true }]),
      };

      navigator.mediaDevices = {
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: 'audioinput', deviceId: 'mic-1', label: 'Internal Mic' },
          { kind: 'audioinput', deviceId: 'mic-2', label: 'USB Headset Mic' },
          { kind: 'videoinput', deviceId: 'cam-1', label: 'Face Cam' },
        ]),
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };

      // Mock Web Audio API
      class MockAudioContext {
        constructor() {
          this.state = 'running';
        }
        createMediaStreamSource() {
          return { connect: vi.fn() };
        }
        createAnalyser() {
          return {
            fftSize: 256,
            smoothingTimeConstant: 0.8,
            frequencyBinCount: 128,
            getByteFrequencyData: vi.fn((arr) => {
              arr.fill(32); // produces non-zero volume
            }),
          };
        }
        close() {
          return Promise.resolve();
        }
        resume() {
          return Promise.resolve();
        }
      }

      window.AudioContext = MockAudioContext;
    });

    afterEach(() => {
      navigator.mediaDevices = originalMediaDevices;
      window.AudioContext = originalAudioContext;
      vi.clearAllMocks();
    });

    it('enumerates audio input devices on mount', async () => {
      const { result } = renderHook(() => useAudioSetup({ studentUid: 'student_999' }));

      // Wait for async device enumeration
      await act(async () => {
        await new Promise(r => setTimeout(r, 20));
      });

      expect(result.current.audioDevices.length).toBe(2);
      expect(result.current.audioDevices[0].deviceId).toBe('mic-1');
      expect(result.current.challengePhrase).toContain('student');
    });

    it('starts audio stream and sets up volume analysis', async () => {
      const { result } = renderHook(() => useAudioSetup({ studentUid: 'test_student' }));

      await act(async () => {
        await result.current.startStream('mic-1');
      });

      expect(navigator.mediaDevices.getUserMedia).toHaveBeenNthCalledWith(1, {
        audio: {},
        video: false,
      });
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenNthCalledWith(2, {
        audio: { deviceId: { exact: 'mic-1' } },
        video: false,
      });
      expect(result.current.stream).toBeTruthy();
    });

    it('gracefully handles getUserMedia rejection with error state', async () => {
      navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(new Error('Permission Denied'));

      const { result } = renderHook(() => useAudioSetup());

      await act(async () => {
        await result.current.startStream('mic-1');
      });

      expect(result.current.error).toBe('Permission Denied');
      expect(result.current.stream).toBeNull();
    });

    it('performs voice challenge verification on selected stream', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useAudioSetup({ studentUid: 'test_student' }));

      await act(async () => {
        await result.current.startStream('device-1');
      });

      await act(async () => {
        result.current.startSttVerification();
      });

      expect(result.current.isListeningStt).toBe(true);

      // Fast-forward interval
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      act(() => {
        result.current.stopSttVerification();
      });
      expect(result.current.isListeningStt).toBe(false);

      vi.useRealTimers();
    });

    it('updates selectedDeviceId and starts stream', async () => {
      const { result } = renderHook(() => useAudioSetup({ studentUid: 'test_student' }));

      act(() => {
        result.current.setSelectedDeviceId('mic-2');
      });
      expect(result.current.selectedDeviceId).toBe('mic-2');

      await act(async () => {
        await result.current.startStream('mic-2');
      });
      expect(result.current.stream).toBeTruthy();
    });

    it('runs 3-second audio playback loopback test', async () => {
      let recorderInstance;
      class MockMediaRecorder {
        constructor(stream, opts) {
          this.stream = stream;
          this.opts = opts;
          this.state = 'inactive';
          recorderInstance = this;
        }
        start() {
          this.state = 'recording';
        }
        stop() {
          this.state = 'inactive';
          if (this.ondataavailable) {
            this.ondataavailable({ data: new Blob(['pcm'], { type: 'audio/webm' }) });
          }
          if (this.onstop) {
            this.onstop();
          }
        }
      }
      globalThis.MediaRecorder = MockMediaRecorder;
      globalThis.MediaRecorder.isTypeSupported = vi.fn().mockReturnValue(true);

      globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/test-audio');
      globalThis.URL.revokeObjectURL = vi.fn();

      const mockAudioPlay = vi.fn().mockResolvedValue();
      globalThis.Audio = class {
        constructor(src) {
          this.src = src;
          this.play = mockAudioPlay;
        }
      };

      const { result } = renderHook(() => useAudioSetup({ studentUid: 'test_student' }));

      await act(async () => {
        await result.current.startStream('mic-1');
      });

      await act(async () => {
        await result.current.startPlaybackTest();
      });

      expect(result.current.isRecordingPlayback).toBe(true);

      // Stop recorder
      act(() => {
        recorderInstance.stop();
      });

      expect(result.current.isRecordingPlayback).toBe(false);
      expect(result.current.playbackAudioUrl).toBe('blob:http://localhost/test-audio');
    });
  });
});
