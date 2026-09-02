import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useClientLiteRTGemma } from './useClientLiteRTGemma';
import * as gemmaLoader from '../utils/gemmaLiteRTLoader';
import * as firestore from 'firebase/firestore';

// Mock Firebase Firestore
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  collection: vi.fn(),
  addDoc: vi.fn().mockResolvedValue({ id: 'mock-irreg-id' }),
  serverTimestamp: vi.fn(() => 'MOCK_TIMESTAMP'),
}));

// Mock Firebase Config
vi.mock('../firebase-config', () => ({
  db: {},
}));

let mockWorkerInstance = null;

class MockWorker {
  constructor(...args) {
    this.constructorArgs = args;
    this.postMessage = vi.fn();
    this.terminate = vi.fn();
    this.onmessage = null;
    this.onerror = null;
    mockWorkerInstance = this;
  }
}

async function initializeGemma(result) {
  let preloadPromise;
  act(() => {
    preloadPromise = result.current.preloadGemmaModel();
  });
  const initCalls = mockWorkerInstance.postMessage.mock.calls
    .filter(call => call[0].type === 'INIT');
  const initCall = initCalls[initCalls.length - 1][0];

  await act(async () => {
    mockWorkerInstance.onmessage({
      data: {
        type: 'INIT_COMPLETE',
        id: initCall.id,
        payload: {
          ready: true,
          delegate: 'webgpu',
          cached: false,
          engine: 'litert_lm_gemma_e2b',
        },
      },
    });
    await preloadPromise;
  });
}

describe('useClientLiteRTGemma Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkerInstance = null;
    globalThis.Worker = MockWorker;
    vi.spyOn(gemmaLoader, 'isGemmaModelCached').mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with idle state and instantiates web worker', () => {
    const { result } = renderHook(() =>
      useClientLiteRTGemma({
        classId: 'CLASS_TEST',
        studentUid: 'student_123',
        studentEmail: 'student@test.com',
        enabled: false,
      })
    );

    expect(result.current.status).toBe('idle');
    expect(result.current.loadingProgress).toBe(0);
    expect(mockWorkerInstance).not.toBeNull();
    expect(mockWorkerInstance.constructorArgs).toHaveLength(1);
  });

  it('loads E2B only after an explicit student preload action', async () => {
    const { result } = renderHook(() =>
      useClientLiteRTGemma({
        classId: 'CLASS_TEST',
        studentUid: 'student_123',
        enabled: true,
      })
    );

    expect(mockWorkerInstance.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'INIT' })
    );

    let evaluationResult;
    await act(async () => {
      evaluationResult = await result.current.evaluateTranscript('Let me think aloud.');
    });
    expect(mockWorkerInstance.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'INIT' })
    );
    expect(mockWorkerInstance.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'EVALUATE_TRANSCRIPT' })
    );
    expect(evaluationResult).toBeNull();
  });

  it('handles preloadGemmaModel by sending INIT message to worker', async () => {
    vi.spyOn(gemmaLoader, 'isGemmaModelCached').mockResolvedValue(true);

    const { result } = renderHook(() =>
      useClientLiteRTGemma({
        classId: 'CLASS_TEST',
        studentUid: 'student_123',
        enabled: false,
      })
    );

    let preloadPromise;
    act(() => {
      preloadPromise = result.current.preloadGemmaModel();
    });

    expect(result.current.status).toBe('loading');
    expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'INIT',
      })
    );

    const initCall = mockWorkerInstance.postMessage.mock.calls.find(c => c[0].type === 'INIT');
    const reqId = initCall[0].id;

    // Simulate worker INIT_COMPLETE response
    await act(async () => {
      mockWorkerInstance.onmessage({
        data: {
          type: 'INIT_COMPLETE',
          id: reqId,
          payload: {
            ready: true,
            delegate: 'webgpu',
            cached: true,
            engine: 'litert_lm_gemma_e2b',
          },
        },
      });
      await preloadPromise;
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.delegateUsed).toBe('webgpu');
    expect(result.current.engine).toBe('litert_lm_gemma_e2b');
  });

  it('reports failed initialization as unavailable and allows retry', async () => {
    const { result } = renderHook(() =>
      useClientLiteRTGemma({
        classId: 'CLASS_TEST',
        studentUid: 'student_123',
        enabled: false,
      })
    );

    let preloadPromise;
    act(() => {
      preloadPromise = result.current.preloadGemmaModel();
    });
    const initCall = mockWorkerInstance.postMessage.mock.calls.find(c => c[0].type === 'INIT');

    await act(async () => {
      mockWorkerInstance.onmessage({
        data: {
          type: 'INIT_COMPLETE',
          id: initCall[0].id,
          payload: {
            ready: false,
            delegate: 'webgpu',
            cached: false,
            engine: 'unavailable',
            unavailableReason: 'WebGPU is unavailable on this device',
          },
        },
      });
      await preloadPromise;
    });

    expect(result.current.status).toBe('unavailable');
    expect(result.current.isModelCached).toBe(false);
    expect(result.current.engine).toBe('unavailable');
    expect(result.current.unavailableReason).toBe('WebGPU is unavailable on this device');

    let retryPromise;
    act(() => {
      retryPromise = result.current.preloadGemmaModel();
    });
    const initCalls = mockWorkerInstance.postMessage.mock.calls
      .filter(call => call[0].type === 'INIT');
    expect(initCalls).toHaveLength(2);

    await act(async () => {
      mockWorkerInstance.onmessage({
        data: {
          type: 'INIT_COMPLETE',
          id: initCalls[1][0].id,
          payload: {
            ready: true,
            delegate: 'webgpu',
            cached: false,
            engine: 'litert_lm_gemma_e2b',
          },
        },
      });
      await retryPromise;
    });
    expect(result.current.engine).toBe('litert_lm_gemma_e2b');
  });

  it('evaluates transcript and logs violation to Firestore when isViolation is true', async () => {
    const { result } = renderHook(() =>
      useClientLiteRTGemma({
        classId: 'CLASS_TEST',
        studentUid: 'student_123',
        studentEmail: 'student@test.com',
        enabled: false,
      })
    );

    await initializeGemma(result);

    let evalPromise;
    act(() => {
      evalPromise = result.current.evaluateTranscript('What did you choose for question 3?');
    });

    expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'EVALUATE_TRANSCRIPT',
        payload: expect.objectContaining({
          transcript: 'What did you choose for question 3?',
        }),
      })
    );

    let overlappingResult;
    await act(async () => {
      overlappingResult = await result.current.evaluateTranscript('Give me the next answer too');
    });
    expect(overlappingResult).toBeNull();
    expect(
      mockWorkerInstance.postMessage.mock.calls
        .filter(call => call[0].type === 'EVALUATE_TRANSCRIPT')
    ).toHaveLength(1);

    const evalCall = mockWorkerInstance.postMessage.mock.calls.find(c => c[0].type === 'EVALUATE_TRANSCRIPT');
    const reqId = evalCall[0].id;

    // Simulate worker EVALUATION_COMPLETE response with violation
    await act(async () => {
      mockWorkerInstance.onmessage({
        data: {
          type: 'EVALUATION_COMPLETE',
          id: reqId,
          payload: {
            isViolation: true,
            category: 'COLLUSION_EXAM',
            severity: 'critical',
            confidence: 0.98,
            evidence: 'question 3',
            rationale: 'Discussing exam question',
            transcript: 'What did you choose for question 3?',
            studentUid: 'student_123',
            classId: 'CLASS_TEST',
            engine: 'litert_lm_gemma_e2b',
          },
        },
      });
      await evalPromise;
    });

    // Verify Firestore irregularity creation
    expect(firestore.addDoc).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        classId: 'CLASS_TEST',
        studentUid: 'student_123',
        studentEmail: 'student@test.com',
        category: 'COLLUSION_EXAM',
        severity: 'critical',
        confidence: 0.98,
        source: 'on_device_gemma',
      })
    );

    // Verify Firestore status telemetry update
    expect(firestore.setDoc).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        gemmaAlert: 'COLLUSION_EXAM',
        gemmaSeverity: 'critical',
        gemmaConfidence: 0.98,
      }),
      { merge: true }
    );
  });

  it('evaluates benign transcript without logging irregularity', async () => {
    const { result } = renderHook(() =>
      useClientLiteRTGemma({
        classId: 'CLASS_TEST',
        studentUid: 'student_123',
        studentEmail: 'student@test.com',
        enabled: false,
      })
    );

    await initializeGemma(result);

    let evalPromise;
    act(() => {
      evalPromise = result.current.evaluateTranscript('Teacher, my screen is blank');
    });

    const evalCall = mockWorkerInstance.postMessage.mock.calls.find(c => c[0].type === 'EVALUATE_TRANSCRIPT');
    const reqId = evalCall[0].id;

    await act(async () => {
      mockWorkerInstance.onmessage({
        data: {
          type: 'EVALUATION_COMPLETE',
          id: reqId,
          payload: {
            isViolation: false,
            category: 'LEGITIMATE_INQUIRY',
            severity: 'none',
            confidence: 0.94,
            transcript: 'Teacher, my screen is blank',
            engine: 'litert_lm_gemma_e2b',
          },
        },
      });
      await evalPromise;
    });

    // Irregularity should NOT be added
    expect(firestore.addDoc).not.toHaveBeenCalled();

    // Status document should clear gemmaAlert
    expect(firestore.setDoc).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        gemmaAlert: null,
        gemmaSeverity: null,
      }),
      { merge: true }
    );
  });

  it('rejects evaluation results that are not produced by Gemma E2B', async () => {
    const { result } = renderHook(() =>
      useClientLiteRTGemma({
        classId: 'CLASS_TEST',
        studentUid: 'student_123',
      })
    );
    await initializeGemma(result);

    let evalPromise;
    act(() => {
      evalPromise = result.current.evaluateTranscript('Tell me the answer');
    });
    const evalCall = mockWorkerInstance.postMessage.mock.calls
      .find(call => call[0].type === 'EVALUATE_TRANSCRIPT');

    let evaluation;
    await act(async () => {
      mockWorkerInstance.onmessage({
        data: {
          type: 'EVALUATION_COMPLETE',
          id: evalCall[0].id,
          payload: {
            isViolation: true,
            category: 'COLLUSION_EXAM',
            severity: 'critical',
            confidence: 0.99,
            engine: 'rules',
          },
        },
      });
      evaluation = await evalPromise;
    });

    expect(evaluation).toBeNull();
    expect(firestore.addDoc).not.toHaveBeenCalled();
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('handles empty transcript gracefully without sending to worker', async () => {
    const { result } = renderHook(() =>
      useClientLiteRTGemma({
        classId: 'CLASS_TEST',
        studentUid: 'student_123',
        enabled: false,
      })
    );

    let res;
    await act(async () => {
      res = await result.current.evaluateTranscript('   ');
    });

    expect(res).toBeNull();
    expect(mockWorkerInstance.postMessage).not.toHaveBeenCalled();
  });
});
