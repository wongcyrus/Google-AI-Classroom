import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSet = vi.fn().mockResolvedValue({});
const mockAdd = vi.fn().mockResolvedValue({ id: 'msg_1' });

const mockDoc = vi.fn((id) => ({
  id: id || 'doc_123',
  set: mockSet,
  collection: mockCollection,
}));

const mockCollection = vi.fn((name) => ({
  doc: mockDoc,
  add: mockAdd,
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({
    collection: mockCollection,
    runTransaction: vi.fn(),
  })),
  FieldValue: {
    serverTimestamp: vi.fn(() => 'MOCK_TIMESTAMP'),
  },
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({
    getUser: vi.fn().mockResolvedValue({ email: 'student@school.edu' }),
  })),
}));

vi.mock('./ai.js', () => ({
  ai: {
    defineTool: vi.fn((config, fn) => fn),
    defineFlow: vi.fn((config, fn) => fn),
  },
  vertexAI: {
    model: vi.fn((m) => m),
  },
}));

import {
  recordAudioIrregularity,
  recordAudioAudit,
  sendMessageToStudent,
} from './aiTools.js';

describe('AI Invigilation Tools (aiTools.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordAudioIrregularity', () => {
    it('successfully creates an irregularity document for multi-speaker or audio cheat detection', async () => {
      const result = await recordAudioIrregularity({
        studentUid: 's1',
        studentEmail: 's1@school.edu',
        title: 'Multiple Voices Detected',
        message: 'Second speaker identified reading answer options.',
        audioPath: 'audio/class1/s1/rec.webm',
        classId: 'CLASS_1',
        speakerCount: 2,
        riskLevel: 'high',
        transcriptSnippet: 'Speaker 2: "Select B"',
      });

      expect(mockCollection).toHaveBeenCalledWith('irregularities');
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          studentUid: 's1',
          email: 's1@school.edu',
          title: 'Multiple Voices Detected',
          type: 'audio',
          speakerCount: 2,
          riskLevel: 'high',
          transcriptSnippet: 'Speaker 2: "Select B"',
        })
      );
      expect(result).toContain('Successfully recorded audio irregularity');
    });
  });

  describe('recordAudioAudit', () => {
    it('saves whole exam audio audit and transcript to class audio_audits subcollection', async () => {
      const result = await recordAudioAudit({
        classId: 'CLASS_1',
        studentUid: 's1',
        studentEmail: 's1@school.edu',
        verdict: 'clean_exam',
        speakerCount: 1,
        summary: 'No foreign voices detected throughout exam.',
        transcript: '[00:00 - 00:30] Speaker 1: "Testing audio mic."',
        audioUrl: 'gs://bucket/audio/combined.webm',
      });

      expect(mockCollection).toHaveBeenCalledWith('classes');
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'CLASS_1',
          studentUid: 's1',
          verdict: 'clean_exam',
          speakerCount: 1,
        }),
        { merge: true }
      );
      expect(result).toContain('Successfully saved audio audit');
    });
  });

  describe('sendMessageToStudent', () => {
    it('sends direct warning message into student messages subcollection', async () => {
      const result = await sendMessageToStudent({
        studentUid: 's1',
        message: 'Please refrain from speaking during exam.',
        classId: 'CLASS_1',
      });

      expect(mockCollection).toHaveBeenCalledWith('students');
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Please refrain from speaking during exam.',
          classId: 'CLASS_1',
        })
      );
      expect(result).toContain('Successfully sent message to student');
    });
  });
});
