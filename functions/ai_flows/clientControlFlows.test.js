import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSet = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn(() => ({ set: mockSet }));

vi.mock('./firebase.js', () => ({}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({ doc: mockDoc })),
}));

import { handleTriggerClientRefresh } from './clientControlFlows.js';

describe('handleTriggerClientRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated callers', async () => {
    await expect(handleTriggerClientRefresh({ auth: null, data: {} }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects student callers', async () => {
    await expect(
      handleTriggerClientRefresh({
        auth: { uid: 'stu-1', token: { role: 'student', email: 's123@stu.vtc.edu.hk' } },
        data: { mode: 'prompt' },
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects invalid refresh modes', async () => {
    await expect(
      handleTriggerClientRefresh({
        auth: { uid: 't-1', token: { role: 'teacher', email: 'prof@vtc.edu.hk' } },
        data: { mode: 'reboot_all' },
      })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('defaults to safe prompt mode and writes system_config/clientControl', async () => {
    const result = await handleTriggerClientRefresh({
      auth: { uid: 't-1', token: { role: 'teacher', email: 'prof@vtc.edu.hk' } },
      data: { message: '  Bug fix deployed  ' },
    });

    expect(mockDoc).toHaveBeenCalledWith('system_config/clientControl');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'prompt',
        message: 'Bug fix deployed',
        triggeredBy: 'prof@vtc.edu.hk',
        forceReloadBefore: expect.any(Number),
        updatedAt: expect.any(String),
      }),
      { merge: true }
    );
    expect(result.success).toBe(true);
    expect(result.mode).toBe('prompt');
  });

  it('supports force_idle and force_now modes for teachers', async () => {
    const resIdle = await handleTriggerClientRefresh({
      auth: { uid: 't-1', token: { email: 'prof@vtc.edu.hk' } },
      data: { mode: 'force_idle' },
    });
    expect(resIdle.mode).toBe('force_idle');

    const resNow = await handleTriggerClientRefresh({
      auth: { uid: 'admin-1', token: { role: 'admin', email: 'admin@vtc.edu.hk' } },
      data: { mode: 'force_now' },
    });
    expect(resNow.mode).toBe('force_now');
  });
});
