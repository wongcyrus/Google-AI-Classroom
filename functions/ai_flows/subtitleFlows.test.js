import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGenerateWithResilience } = vi.hoisted(() => ({
  mockGenerateWithResilience: vi.fn(),
}));

vi.mock('./analysisFlows.js', () => ({
  generateWithResilience: mockGenerateWithResilience,
}));

vi.mock('./firebase.js', () => ({}));
vi.mock('firebase-admin/firestore', () => {
  const mockDoc = {
    get: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
  };
  return {
    getFirestore: vi.fn(() => ({
      doc: vi.fn(() => mockDoc),
      collection: vi.fn(() => ({
        doc: vi.fn(() => mockDoc),
        add: vi.fn(),
      })),
    })),
    FieldValue: {
      serverTimestamp: vi.fn(() => 'MOCK_TIMESTAMP'),
    },
  };
});

vi.mock('./ai.js', () => ({
  ai: {
    generate: vi.fn(),
  },
  vertexAI: {
    model: vi.fn(m => ({ name: m })),
  },
}));

vi.mock('./quotaManagement.js', () => ({
  checkQuota: vi.fn().mockResolvedValue(true),
}));

vi.mock('./cost.js', () => ({
  estimateCost: vi.fn().mockReturnValue(0.0001),
  calculateCost: vi.fn().mockReturnValue(0.00012),
}));

vi.mock('./jobLogger.js', () => ({
  logJob: vi.fn().mockResolvedValue(undefined),
}));

import { translateTeacherSpeech, SUPPORTED_SUBTITLE_LANGUAGES } from './subtitleFlows.js';
import { checkQuota } from './quotaManagement.js';
import { logJob } from './jobLogger.js';

describe('subtitleFlows: translateTeacherSpeech', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes supported subtitle language dictionary', () => {
    expect(SUPPORTED_SUBTITLE_LANGUAGES['zh-Hant']).toContain('Traditional Chinese');
    expect(SUPPORTED_SUBTITLE_LANGUAGES['en']).toBe('English');
    expect(SUPPORTED_SUBTITLE_LANGUAGES['zh-Hans']).toContain('Simplified Chinese');
  });

  it('returns empty translation without AI invocation when text is empty or whitespace', async () => {
    const result = await translateTeacherSpeech({
      classId: 'CLASS_TEST_101',
      teacherUid: 'teacher_1',
      text: '   ',
    });

    expect(result.originalText).toBe('');
    expect(result.translations).toEqual({});
    expect(result.cost).toBe(0);
  });

  it('translates Cantonese speech with code-switching and returns normalized targets', async () => {
    const mockOutput = {
      detectedSourceLang: 'zh-HK',
      translations: {
        'zh-Hant': '今天我們使用 useEffect 訂閱 Firestore 快照',
        'en': 'Today we use useEffect to subscribe to the Firestore snapshot',
      },
    };

    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        output: mockOutput,
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 40 },
      },
      modelUsed: 'gemini-3.5-flash-lite',
    });

    const result = await translateTeacherSpeech({
      classId: 'CLASS_TEST_101',
      teacherUid: 'teacher_1',
      teacherEmail: 'teacher@vtc.edu.hk',
      text: '今日我哋用 useEffect subscribe Firestore snapshot',
      sourceLang: 'zh-HK',
      targetLangs: ['zh-Hant', 'en'],
      context: 'React & Firebase Lab',
    });

    expect(result.originalText).toBe('今日我哋用 useEffect subscribe Firestore snapshot');
    expect(result.sourceLang).toBe('zh-HK');
    expect(result.translations['zh-Hant']).toBe('今天我們使用 useEffect 訂閱 Firestore 快照');
    expect(result.translations['en']).toBe('Today we use useEffect to subscribe to the Firestore snapshot');
    expect(result.modelUsed).toBe('gemini-3.5-flash-lite');
    expect(logJob).toHaveBeenCalledWith(expect.objectContaining({
      classId: 'CLASS_TEST_101',
      jobType: 'translateTeacherSpeech',
      status: 'completed',
    }));
  });

  it('blocks translation and logs quota failure when quota is exceeded', async () => {
    vi.mocked(checkQuota).mockResolvedValueOnce(false);

    await expect(translateTeacherSpeech({
      classId: 'CLASS_OVER_QUOTA',
      teacherUid: 'teacher_1',
      text: 'Testing quota enforcement',
    })).rejects.toThrow(/Classroom AI quota exceeded/i);

    expect(logJob).toHaveBeenCalledWith(expect.objectContaining({
      classId: 'CLASS_OVER_QUOTA',
      status: 'blocked-by-quota',
    }));
  });
});
