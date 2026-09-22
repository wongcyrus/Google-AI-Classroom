import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAdd, mockCollection, mockDoc, mockGet, mockSet } = vi.hoisted(() => {
  const mockAdd = vi.fn();
  const mockGet = vi.fn();
  const mockSet = vi.fn();
  const mockDoc = vi.fn();
  const mockCollection = vi.fn();
  return { mockAdd, mockCollection, mockDoc, mockGet, mockSet };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: mockCollection,
  }),
  FieldValue: {
    serverTimestamp: () => 'MOCK_TIMESTAMP',
    increment: (n) => ({ increment: n }),
  },
}));

import { logJob } from './jobLogger.js';
import { checkQuota, updateUsage } from './quotaManagement.js';

describe('jobLogger and quotaManagement Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('logJob', () => {
    it('filters out undefined fields and saves job with server timestamp', async () => {
      mockAdd.mockResolvedValueOnce({ id: 'new_job_123' });
      mockCollection.mockReturnValue({ add: mockAdd });

      const result = await logJob({
        classId: 'CLASS_1',
        cost: 0.05,
        unusedField: undefined,
      });

      expect(mockCollection).toHaveBeenCalledWith('aiJobs');
      expect(mockAdd).toHaveBeenCalledWith({
        classId: 'CLASS_1',
        cost: 0.05,
        timestamp: 'MOCK_TIMESTAMP',
      });
      expect(result).toBe('new_job_123');
    });
  });

  describe('checkQuota', () => {
    it('returns false when classId is missing', async () => {
      const result = await checkQuota(null, 1.0);
      expect(result).toBe(false);
    });

    it('returns true when class and aiMeta exist and usage is within quota', async () => {
      const mockClassGet = vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ aiQuota: 20 }),
      });
      const mockAiMetaGet = vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ aiUsedQuota: 5 }),
      });

      const mockAiMetaDoc = { get: mockAiMetaGet };
      const mockClassDoc = {
        get: mockClassGet,
        collection: vi.fn().mockReturnValue({ doc: vi.fn().mockReturnValue(mockAiMetaDoc) }),
      };

      mockCollection.mockReturnValue({ doc: vi.fn().mockReturnValue(mockClassDoc) });

      const result = await checkQuota('CLASS_1', 2.0);
      expect(result).toBe(true);
    });

    it('returns false when usage + estimatedCost exceeds quota', async () => {
      const mockClassGet = vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ aiQuota: 10 }),
      });
      const mockAiMetaGet = vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ aiUsedQuota: 9.5 }),
      });

      const mockAiMetaDoc = { get: mockAiMetaGet };
      const mockClassDoc = {
        get: mockClassGet,
        collection: vi.fn().mockReturnValue({ doc: vi.fn().mockReturnValue(mockAiMetaDoc) }),
      };

      mockCollection.mockReturnValue({ doc: vi.fn().mockReturnValue(mockClassDoc) });

      const result = await checkQuota('CLASS_1', 1.0);
      expect(result).toBe(false);
    });

    it('uses default quota $10 if class document does not exist', async () => {
      const mockClassGet = vi.fn().mockResolvedValue({
        exists: false,
      });
      const mockAiMetaGet = vi.fn().mockResolvedValue({
        exists: false,
      });

      const mockAiMetaDoc = { get: mockAiMetaGet };
      const mockClassDoc = {
        get: mockClassGet,
        collection: vi.fn().mockReturnValue({ doc: vi.fn().mockReturnValue(mockAiMetaDoc) }),
      };

      mockCollection.mockReturnValue({ doc: vi.fn().mockReturnValue(mockClassDoc) });

      const result = await checkQuota('CLASS_NON_EXISTENT', 5.0);
      expect(result).toBe(true);
    });
  });

  describe('updateUsage', () => {
    it('returns immediately without error if classId is missing or cost <= 0', async () => {
      await updateUsage(null, 1.0);
      await updateUsage('CLASS_1', 0);
      await updateUsage('CLASS_1', -5);
      expect(mockCollection).not.toHaveBeenCalled();
    });

    it('increments aiUsedQuota on both class document and metadata/ai document', async () => {
      const mockSetClass = vi.fn().mockResolvedValue();
      const mockSetMeta = vi.fn().mockResolvedValue();

      const mockAiMetaDoc = { set: mockSetMeta };
      const mockClassDoc = {
        set: mockSetClass,
        collection: vi.fn().mockReturnValue({ doc: vi.fn().mockReturnValue(mockAiMetaDoc) }),
      };

      mockCollection.mockReturnValue({ doc: vi.fn().mockReturnValue(mockClassDoc) });

      await updateUsage('CLASS_1', 0.25);

      expect(mockSetMeta).toHaveBeenCalledWith(
        { aiUsedQuota: { increment: 0.25 } },
        { merge: true }
      );
      expect(mockSetClass).toHaveBeenCalledWith(
        { aiUsedQuota: { increment: 0.25 } },
        { merge: true }
      );
    });
  });
});
