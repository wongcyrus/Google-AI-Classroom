import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUpdateUsage } = vi.hoisted(() => ({
  mockUpdateUsage: vi.fn().mockResolvedValue(true),
}));

vi.mock('./quotaManagement.js', () => ({
  updateUsage: mockUpdateUsage,
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn((opts, handler) => handler),
}));

import { onAiJobCreated } from './quotaTriggers.js';

describe('onAiJobCreated (functions/ai_flows/quotaTriggers.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early when event data snapshot is missing', async () => {
    const result = await onAiJobCreated({ data: null });
    expect(result).toBeUndefined();
    expect(mockUpdateUsage).not.toHaveBeenCalled();
  });

  it('updates usage when classId is present and cost > 0', async () => {
    const event = {
      data: {
        data: () => ({
          classId: 'CLASS_1',
          cost: 0.05,
        }),
      },
    };

    await onAiJobCreated(event);
    expect(mockUpdateUsage).toHaveBeenCalledWith('CLASS_1', 0.05);
  });

  it('does not update usage if cost is 0 or negative', async () => {
    await onAiJobCreated({
      data: {
        data: () => ({ classId: 'CLASS_1', cost: 0 }),
      },
    });
    expect(mockUpdateUsage).not.toHaveBeenCalled();

    await onAiJobCreated({
      data: {
        data: () => ({ classId: 'CLASS_1', cost: -0.01 }),
      },
    });
    expect(mockUpdateUsage).not.toHaveBeenCalled();
  });

  it('does not update usage if classId is missing', async () => {
    await onAiJobCreated({
      data: {
        data: () => ({ cost: 0.05 }),
      },
    });
    expect(mockUpdateUsage).not.toHaveBeenCalled();
  });
});
