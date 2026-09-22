import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  pcmFloat32ToBase64,
  pcmFloat32ToWavBase64,
  transcribeAudioWithFirebaseAI,
  createLiveSubtitleSession,
  getFirebaseAI,
  resetTranscribeCooldown,
  resetFirebaseAIInstance,
  resetUnsupportedModels,
  DEFAULT_TRANSCRIBE_MODELS,
  DEFAULT_LIVE_MODEL,
  CANDIDATE_LIVE_MODELS,
} from './aiLogic';

const mockLiveSession = {
  isClosed: false,
  sendAudioRealtime: vi.fn().mockResolvedValue(),
  receive: vi.fn(),
  close: vi.fn().mockResolvedValue()
};

const mockGetLiveGenerativeModel = vi.fn().mockReturnValue({
  connect: vi.fn().mockResolvedValue(mockLiveSession)
});

const mockGenerateContent = vi.fn().mockResolvedValue({
  response: { text: () => 'Hello students' }
});

const mockGetGenerativeModel = vi.fn().mockReturnValue({
  generateContent: mockGenerateContent
});

vi.mock('firebase/ai', () => ({
  getAI: vi.fn((app, options) => ({ backend: options?.backend })),
  GoogleAIBackend: vi.fn(function() { this.backendType = 'GOOGLE_AI'; }),
  AgentPlatformBackend: vi.fn(function(loc) { this.backendType = 'AGENT_PLATFORM'; this.location = loc; }),
  VertexAIBackend: vi.fn(function(loc) { this.backendType = 'VERTEX_AI'; this.location = loc; }),
  getLiveGenerativeModel: (...args) => mockGetLiveGenerativeModel(...args),
  getGenerativeModel: (...args) => mockGetGenerativeModel(...args),
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
    resetTranscribeCooldown();
    resetFirebaseAIInstance();
    resetUnsupportedModels();
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
      expect(ai.backend.backendType).toBe('AGENT_PLATFORM');
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

    it('falls back to secondary models when primary live model connection fails', async () => {
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
        expect.objectContaining({ model: 'gemini-3.5-transcribe-live-preview' })
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

    it('aborts candidate retry loop immediately on App Check token invalid failure', async () => {
      mockGetLiveGenerativeModel.mockReturnValue({
        connect: vi.fn().mockRejectedValue(new Error("Reason: 'Firebase App Check token is invalid.'"))
      });

      const session = createLiveSubtitleSession({
        targetLanguage: 'en',
        currentUser: { email: 'teacher@staff.vtc.edu.hk' }
      });

      await expect(session.connect()).rejects.toThrow(/Firebase App Check token is invalid/);
      expect(mockGetLiveGenerativeModel).toHaveBeenCalledTimes(1);
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

  describe('pcmFloat32ToWavBase64 and transcribeAudioWithFirebaseAI', () => {
    it('converts Float32Array PCM to valid WAV base64 string', () => {
      const pcm = new Float32Array([0, 0.5, -0.5, 1, -1]);
      const base64 = pcmFloat32ToWavBase64(pcm, 16000);
      expect(base64).toBeTruthy();
      expect(typeof base64).toBe('string');
      // Empty input returns empty string
      expect(pcmFloat32ToWavBase64(null)).toBe('');
      expect(pcmFloat32ToWavBase64(new Float32Array([]))).toBe('');
    });

    it('transcribes audio via Firebase AI Logic using gemini-3.8-flash', async () => {
      const pcm = new Float32Array(16000);
      const transcript = await transcribeAudioWithFirebaseAI(pcm, 16000, 'zh-HK');
      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          model: 'gemini-3.8-flash'
        })
      );
      expect(transcript).toBe('Hello students');
    });

    it('handles empty audio gracefully without calling generative model', async () => {
      const transcript = await transcribeAudioWithFirebaseAI(null);
      expect(transcript).toBe('');
    });

    it('prunes 404 / unsupported models so they are skipped on subsequent calls', async () => {
      // First model throws 404 Publisher model not found
      mockGenerateContent
        .mockRejectedValueOnce(new Error('[404] Publisher model projects/.../gemini-3.8-flash was not found'))
        .mockResolvedValueOnce({
          response: { text: () => 'Fallback success' }
        });

      const pcm = new Float32Array(16000);
      const transcript1 = await transcribeAudioWithFirebaseAI(pcm, 16000, 'zh-HK');
      expect(transcript1).toBe('Fallback success');
      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ model: 'gemini-3.8-flash' })
      );
      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ model: 'gemini-3.5-flash-lite' })
      );

      // Subsequent call should skip gemini-3.8-flash completely and call gemini-3.5-flash-lite directly
      mockGetGenerativeModel.mockClear();
      mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => 'Second call success' }
      });

      const transcript2 = await transcribeAudioWithFirebaseAI(pcm, 16000, 'zh-HK');
      expect(transcript2).toBe('Second call success');
      expect(mockGetGenerativeModel).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ model: 'gemini-3.8-flash' })
      );
      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ model: 'gemini-3.5-flash-lite' })
      );
    });

    it('trips circuit breaker on 429 / depleted credits and pauses subsequent calls', async () => {
      mockGenerateContent.mockRejectedValueOnce(
        new Error('[429] Your prepayment credits are depleted. Please manage billing.')
      );

      const pcm = new Float32Array(16000);
      const transcript1 = await transcribeAudioWithFirebaseAI(pcm, 16000, 'zh-HK');
      expect(transcript1).toBe('');

      // Should not call subsequent models because project billing is depleted
      expect(mockGetGenerativeModel).toHaveBeenCalledTimes(1);

      // Second call during cooldown should immediately return empty without calling getGenerativeModel
      mockGetGenerativeModel.mockClear();
      const transcript2 = await transcribeAudioWithFirebaseAI(pcm, 16000, 'zh-HK');
      expect(transcript2).toBe('');
      expect(mockGetGenerativeModel).not.toHaveBeenCalled();
    });

    it('contains only active supported models in DEFAULT_TRANSCRIBE_MODELS', () => {
      expect(DEFAULT_TRANSCRIBE_MODELS).toEqual([
        'gemini-3.8-flash',
        'gemini-3.5-flash-lite'
      ]);
      expect(DEFAULT_TRANSCRIBE_MODELS.some((m) => m.includes('2.5'))).toBe(false);
    });

    it('uses only Gemini 3 generation models for live streaming with no 2.5 models', () => {
      expect(DEFAULT_LIVE_MODEL).toBe('gemini-3.1-flash-live-preview');
      expect(CANDIDATE_LIVE_MODELS).toContain('gemini-3.1-flash-live-preview');
      expect(CANDIDATE_LIVE_MODELS.some((m) => m.includes('2.5'))).toBe(false);
    });
  });

  describe('getFirebaseAI backend initialization', () => {
    it('defaults to AgentPlatformBackend with global location for GCP Cloud Billing', () => {
      const ai = getFirebaseAI();
      expect(ai).toBeTruthy();
      expect(ai.backend.backendType).toBe('AGENT_PLATFORM');
      expect(ai.backend.location).toBe('global');
    });

    it('initializes GoogleAIBackend when explicitly requested', () => {
      const ai = getFirebaseAI('google_ai');
      expect(ai).toBeTruthy();
      expect(ai.backend.backendType).toBe('GOOGLE_AI');
    });

    it('allows resetting instance to switch backend cleanly', () => {
      const aiVertex = getFirebaseAI('vertex');
      expect(aiVertex.backend.backendType).toBe('AGENT_PLATFORM');

      resetFirebaseAIInstance();

      const aiGoogle = getFirebaseAI('google_ai');
      expect(aiGoogle.backend.backendType).toBe('GOOGLE_AI');
    });
  });
});



