import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pcmFloat32ToBase64, createLiveSubtitleSession, getFirebaseAI } from './aiLogic';

const mockLiveSession = {
  isClosed: false,
  sendAudioRealtime: vi.fn().mockResolvedValue(),
  receive: vi.fn(),
  close: vi.fn().mockResolvedValue()
};

const mockGetLiveGenerativeModel = vi.fn().mockReturnValue({
  connect: vi.fn().mockResolvedValue(mockLiveSession)
});

vi.mock('firebase/ai', () => ({
  getAI: vi.fn(() => ({ backend: 'google_ai' })),
  GoogleAIBackend: vi.fn(),
  getLiveGenerativeModel: (...args) => mockGetLiveGenerativeModel(...args),
  Modality: {
    TEXT: 'TEXT',
    AUDIO: 'AUDIO'
  },
  ResponseModality: {
    TEXT: 'TEXT',
    AUDIO: 'AUDIO'
  }
}));

vi.mock('../firebase-config', () => ({
  app: { name: '[DEFAULT]', options: { apiKey: 'test-api-key' } },
  auth: { currentUser: { email: 'teacher@vtc.edu.hk' } }
}));

describe('Firebase AI Logic - aiLogic.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLiveSession.isClosed = false;
    mockGetLiveGenerativeModel.mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(mockLiveSession)
    }));
  });

  describe('pcmFloat32ToBase64', () => {
    it('returns empty string for null, undefined, or empty Float32Array', () => {
      expect(pcmFloat32ToBase64(null)).toBe('');
      expect(pcmFloat32ToBase64(undefined)).toBe('');
      expect(pcmFloat32ToBase64(new Float32Array([]))).toBe('');
    });

    it('converts Float32 audio samples to 16-bit PCM little-endian Base64', () => {
      const samples = new Float32Array([0.0, 0.5, -0.5, 1.0, -1.0]);
      const base64 = pcmFloat32ToBase64(samples);
      expect(typeof base64).toBe('string');
      expect(base64.length).toBeGreaterThan(0);

      // Decode base64 to verify 10 bytes (5 samples * 2 bytes)
      const binary = atob(base64);
      expect(binary.length).toBe(10);
    });
  });

  describe('getFirebaseAI', () => {
    it('initializes and returns the singleton Firebase AI instance', () => {
      const ai = getFirebaseAI();
      expect(ai).toBeDefined();
      expect(ai.backend).toBe('google_ai');
    });
  });

  describe('createLiveSubtitleSession', () => {
    it('creates session and connects to LiveGenerativeModel with correct configuration', async () => {
      async function* emptyGenerator() {}
      mockLiveSession.receive.mockReturnValue(emptyGenerator());

      const onOriginalTranscript = vi.fn();
      const onTranslatedChunk = vi.fn();
      const onTurnComplete = vi.fn();

      const session = createLiveSubtitleSession({
        targetLanguage: 'en',
        onOriginalTranscript,
        onTranslatedChunk,
        onTurnComplete
      });

      expect(session.isConnected()).toBe(false);

      await session.connect();

      expect(mockGetLiveGenerativeModel).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          model: 'gemini-3.1-flash-live-preview',
          generationConfig: expect.objectContaining({
            responseModalities: ['TEXT'],
            inputAudioTranscription: {}
          })
        })
      );

      expect(session.isConnected()).toBe(true);
    });

    it('falls back to gemini-2.5-flash-native-audio-preview-12-2025 when primary model connection fails', async () => {
      async function* emptyGenerator() {}
      mockLiveSession.receive.mockReturnValue(emptyGenerator());

      mockGetLiveGenerativeModel.mockImplementation((ai, config) => {
        if (config.model === 'gemini-3.1-flash-live-preview') {
          return {
            connect: vi.fn().mockRejectedValue(new Error('Model unavailable in region'))
          };
        }
        return {
          connect: vi.fn().mockResolvedValue(mockLiveSession)
        };
      });

      const session = createLiveSubtitleSession({
        targetLanguage: 'en'
      });

      await session.connect();

      expect(mockGetLiveGenerativeModel).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ model: 'gemini-3.1-flash-live-preview' })
      );
      expect(mockGetLiveGenerativeModel).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ model: 'gemini-2.5-flash-native-audio-preview-12-2025' })
      );
      expect(session.isConnected()).toBe(true);
    });

    it('streams incoming serverContent to onOriginalTranscript, onTranslatedChunk, and onTurnComplete', async () => {
      async function* mockStream() {
        yield {
          type: 'serverContent',
          inputTranscription: { text: '今日我哋學 React' }
        };
        yield {
          type: 'serverContent',
          modelTurn: {
            parts: [{ text: 'Today ' }, { text: 'we learn React' }]
          }
        };
        yield {
          type: 'serverContent',
          turnComplete: true
        };
      }

      mockLiveSession.receive.mockReturnValue(mockStream());

      const onOriginalTranscript = vi.fn();
      const onTranslatedChunk = vi.fn();
      const onTurnComplete = vi.fn();

      const session = createLiveSubtitleSession({
        targetLanguage: 'en',
        onOriginalTranscript,
        onTranslatedChunk,
        onTurnComplete
      });

      await session.connect();

      // Wait a microtask tick for async generator loop
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onOriginalTranscript).toHaveBeenCalledWith('今日我哋學 React');
      expect(onTranslatedChunk).toHaveBeenCalledWith('Today ');
      expect(onTranslatedChunk).toHaveBeenCalledWith('we learn React');
      expect(onTurnComplete).toHaveBeenCalled();
    });

    it('sends audio chunk via sendAudioRealtime when connected', async () => {
      async function* emptyGenerator() {}
      mockLiveSession.receive.mockReturnValue(emptyGenerator());

      const session = createLiveSubtitleSession({ targetLanguage: 'en' });
      await session.connect();

      const samples = new Float32Array([0.1, 0.2, 0.3]);
      await session.sendAudioChunk(samples);

      expect(mockLiveSession.sendAudioRealtime).toHaveBeenCalledWith(
        expect.objectContaining({
          mimeType: 'audio/pcm;rate=16000',
          data: expect.any(String)
        })
      );
    });

    it('closes the live session and updates isConnected state', async () => {
      async function* emptyGenerator() {}
      mockLiveSession.receive.mockReturnValue(emptyGenerator());

      const session = createLiveSubtitleSession({ targetLanguage: 'en' });
      await session.connect();
      expect(session.isConnected()).toBe(true);

      await session.close();
      expect(mockLiveSession.close).toHaveBeenCalled();
      expect(session.isConnected()).toBe(false);
    });

    it('blocks student account from connecting to Gemini Live subtitle session', async () => {
      const session = createLiveSubtitleSession({
        targetLanguage: 'en',
        currentUser: { email: 'student@stu.vtc.edu.hk' }
      });

      await expect(session.connect()).rejects.toThrow(
        /Unauthorized: Gemini Live subtitle broadcast can only be initiated by verified instructors/i
      );
    });

    it('permits verified teacher account to connect to Gemini Live subtitle session', async () => {
      async function* emptyGenerator() {}
      mockLiveSession.receive.mockReturnValue(emptyGenerator());

      const session = createLiveSubtitleSession({
        targetLanguage: 'en',
        currentUser: { email: 'teacher@staff.vtc.edu.hk' }
      });

      await expect(session.connect()).resolves.not.toThrow();
      expect(session.isConnected()).toBe(true);
    });

    it('tracks token usage and calculates estimated USD cost from streaming', async () => {
      async function* emptyGenerator() {}
      mockLiveSession.receive.mockReturnValue(emptyGenerator());

      const onUsageUpdate = vi.fn();
      const session = createLiveSubtitleSession({
        targetLanguage: 'en',
        onUsageUpdate
      });

      await session.connect();

      // Send 16,000 samples (1 second of audio @ 16kHz)
      const samples = new Float32Array(16000);
      await session.sendAudioChunk(samples);

      const usage = session.getSessionUsage();
      expect(usage.durationSeconds).toBeGreaterThanOrEqual(0);
      expect(usage.audioTokens).toBe(28); // 1 sec * 28 tokens/sec
      expect(usage.estimatedCostUsd).toBeGreaterThan(0);
      expect(usage.modelUsed).toBe('gemini-3.1-flash-live-preview');
    });

    it('intercepts server usageMetadata from stream and updates telemetry', async () => {
      async function* mockServerStream() {
        yield {
          usageMetadata: {
            promptTokenCount: 10000,
            candidatesTokenCount: 1000
          }
        };
      }
      mockLiveSession.receive.mockReturnValue(mockServerStream());

      const onUsageUpdate = vi.fn();
      const session = createLiveSubtitleSession({
        targetLanguage: 'en',
        onUsageUpdate
      });

      await session.connect();

      // Wait a tick for async generator loop
      await new Promise((resolve) => setTimeout(resolve, 20));

      const usage = session.getSessionUsage();
      expect(usage.audioTokens).toBe(10000);
      expect(usage.outputTokens).toBe(1000);
      expect(usage.totalTokens).toBe(11000);
      // Cost: (10000/1M * 0.60) + (1000/1M * 2.50) = 0.006 + 0.0025 = 0.0085 USD
      expect(usage.estimatedCostUsd).toBe(0.0085);
      expect(onUsageUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          audioTokens: 10000,
          outputTokens: 1000,
          estimatedCostUsd: 0.0085
        })
      );
    });
  });
});


