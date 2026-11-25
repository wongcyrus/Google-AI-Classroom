import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDoc = vi.fn((db, ...segments) => ({ db, path: segments.join('/') }));
const mockOnSnapshot = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: (...args) => mockDoc(...args),
  onSnapshot: (...args) => mockOnSnapshot(...args),
}));

import { subscribeDocShared } from './sharedFirestoreListeners';

describe('sharedFirestoreListeners (subscribeDocShared)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shares a single onSnapshot listener across multiple subscribers and unsubscribes at ref-count 0', () => {
    const db = { name: 'db-main' };
    const underlyingUnsub = vi.fn();
    let capturedOnNext;

    mockOnSnapshot.mockImplementation((_ref, onNext) => {
      capturedOnNext = onNext;
      return underlyingUnsub;
    });

    const cb1 = vi.fn();
    const cb2 = vi.fn();

    const unsub1 = subscribeDocShared(db, 'studentPasskeys/u1', cb1);
    const unsub2 = subscribeDocShared(db, ['studentPasskeys', 'u1'], cb2);

    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);

    const snap1 = { exists: () => true, data: () => ({ ok: 1 }) };
    capturedOnNext(snap1);

    expect(cb1).toHaveBeenCalledWith(snap1);
    expect(cb2).toHaveBeenCalledWith(snap1);

    // Late 3rd subscriber immediately receives the latest cached snapshot without a new onSnapshot
    const cb3 = vi.fn();
    const unsub3 = subscribeDocShared(db, 'studentPasskeys/u1', cb3);
    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
    expect(cb3).toHaveBeenCalledWith(snap1);

    // Unsubscribing 1 & 2 leaves 3 active
    unsub1();
    unsub2();
    expect(underlyingUnsub).not.toHaveBeenCalled();

    // Idempotent duplicate unsub1 does not decrement twice
    unsub1();
    expect(underlyingUnsub).not.toHaveBeenCalled();

    // Last subscriber unsubscribes -> tears down underlying listener
    unsub3();
    expect(underlyingUnsub).toHaveBeenCalledTimes(1);

    // Re-subscribing after ref-count 0 creates a fresh listener
    const cb4 = vi.fn();
    const unsub4 = subscribeDocShared(db, 'studentPasskeys/u1', cb4);
    expect(mockOnSnapshot).toHaveBeenCalledTimes(2);
    unsub4();
  });

  it('isolates listeners across distinct db instances and forwards errors', () => {
    const dbA = { name: 'db-A' };
    const dbB = { name: 'db-B' };
    const unsubA = vi.fn();
    const unsubB = vi.fn();
    let errHandlerA;

    mockOnSnapshot
      .mockImplementationOnce((_ref, _onNext, onError) => {
        errHandlerA = onError;
        return unsubA;
      })
      .mockImplementationOnce(() => unsubB);

    const onErr1 = vi.fn();
    const onErr2 = vi.fn();
    const u1 = subscribeDocShared(dbA, 'system_config/loginPolicy', vi.fn(), onErr1);
    const u2 = subscribeDocShared(dbB, 'system_config/loginPolicy', vi.fn(), onErr2);

    expect(mockOnSnapshot).toHaveBeenCalledTimes(2);

    const boom = new Error('permission-denied');
    errHandlerA(boom);
    expect(onErr1).toHaveBeenCalledWith(boom);
    expect(onErr2).not.toHaveBeenCalled();

    // Late error subscriber receives cached error
    const onErrLate = vi.fn();
    const u3 = subscribeDocShared(dbA, 'system_config/loginPolicy', vi.fn(), onErrLate);
    expect(onErrLate).toHaveBeenCalledWith(boom);

    u1();
    u2();
    u3();
    expect(unsubA).toHaveBeenCalledTimes(1);
    expect(unsubB).toHaveBeenCalledTimes(1);
  });

  it('uses custom createDocRef factory when provided', () => {
    const db = { name: 'db-custom' };
    const customRef = { path: 'classes/c1/studentProperties/u1', custom: true };
    const unsub = vi.fn();
    mockOnSnapshot.mockReturnValue(unsub);

    const release = subscribeDocShared(
      db,
      'classes/c1/studentProperties/u1',
      vi.fn(),
      undefined,
      () => customRef
    );

    expect(mockOnSnapshot).toHaveBeenCalledWith(customRef, expect.any(Function), expect.any(Function));
    release();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
