import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useClientLiteRTWhisper } from "./useClientLiteRTWhisper";
import * as whisperLoader from "../utils/webAiLiteRTLoader";
import * as firestore from "firebase/firestore";

// Mock Firebase Firestore
vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  collection: vi.fn(),
  addDoc: vi.fn().mockResolvedValue({ id: "mock-audio-doc-id" }),
  serverTimestamp: vi.fn(() => "MOCK_TIMESTAMP"),
}));

// Mock Firebase Config
vi.mock("../firebase-config", () => ({
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

describe("useClientLiteRTWhisper Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkerInstance = null;
    globalThis.Worker = MockWorker;
    vi.spyOn(whisperLoader, "isWhisperModelCached").mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes with idle state and creates web worker", () => {
    const { result } = renderHook(() =>
      useClientLiteRTWhisper({
        classId: "CLASS_TEST",
        studentUid: "student_123",
        enabled: false,
      })
    );

    expect(result.current.status).toBe("idle");
    expect(result.current.loadingProgress).toBe(0);
    expect(mockWorkerInstance).not.toBeNull();
    expect(mockWorkerInstance.constructorArgs).toHaveLength(1);
  });

  it("deduplicates concurrent model initialization requests", async () => {
    const { result } = renderHook(() =>
      useClientLiteRTWhisper({
        classId: "CLASS_TEST",
        studentUid: "student_123",
        enabled: false,
      })
    );

    let firstPromise;
    let secondPromise;
    act(() => {
      firstPromise = result.current.preloadModel();
      secondPromise = result.current.preloadModel();
    });

    const initCalls = mockWorkerInstance.postMessage.mock.calls
      .filter(call => call[0].type === "INIT");
    expect(initCalls).toHaveLength(1);
    expect(firstPromise).toBe(secondPromise);

    await act(async () => {
      mockWorkerInstance.onmessage({
        data: {
          type: "INIT_COMPLETE",
          id: initCalls[0][0].id,
          payload: { ready: true, delegate: "wasm", cached: true },
        },
      });
      await Promise.all([firstPromise, secondPromise]);
    });
  });

  it("handles preloadModel by sending INIT message to worker", async () => {
    const { result } = renderHook(() =>
      useClientLiteRTWhisper({
        classId: "CLASS_TEST",
        studentUid: "student_123",
        enabled: false,
      })
    );

    let preloadPromise;
    act(() => {
      preloadPromise = result.current.preloadModel();
    });

    expect(result.current.status).toBe("loading");
    expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "INIT",
      })
    );

    const initCall = mockWorkerInstance.postMessage.mock.calls.find(c => c[0].type === "INIT");
    const reqId = initCall[0].id;

    await act(async () => {
      mockWorkerInstance.onmessage({
        data: {
          type: "INIT_COMPLETE",
          id: reqId,
          payload: { ready: true, delegate: "wasm", cached: true },
        },
      });
      await preloadPromise;
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.delegateUsed).toBe("wasm");
  });

  it("transcribes audio chunk, invokes onTranscript callback, and logs transcript telemetry", async () => {
    const mockOnTranscript = vi.fn();
    const { result } = renderHook(() =>
      useClientLiteRTWhisper({
        classId: "CLASS_TEST",
        studentUid: "student_123",
        speechLanguage: "zh-HK",
        onTranscript: mockOnTranscript,
        enabled: false,
      })
    );

    // 1. Ready worker
    let preloadPromise;
    act(() => {
      preloadPromise = result.current.preloadModel();
    });
    const initCall = mockWorkerInstance.postMessage.mock.calls.find(c => c[0].type === "INIT");
    await act(async () => {
      mockWorkerInstance.onmessage({
        data: {
          type: "INIT_COMPLETE",
          id: initCall[0].id,
          payload: { ready: true, delegate: "wasm", cached: true },
        },
      });
      await preloadPromise;
    });

    // 2. Transcribe chunk
    const fakePcm = new Float32Array(16000); // 1s audio
    let transcribePromise;
    act(() => {
      transcribePromise = result.current.transcribeAudioChunk(fakePcm, { audioPath: "audio/test.webm" });
    });

    const transCall = mockWorkerInstance.postMessage.mock.calls.find(c => c[0].type === "TRANSCRIBE");
    expect(transCall).toBeDefined();
    expect(transCall[0].payload).toMatchObject({
      language: "zh-HK",
      audioPath: "audio/test.webm",
    });

    const reqId = transCall[0].id;

    await act(async () => {
      mockWorkerInstance.onmessage({
        data: {
          type: "TRANSCRIBE_COMPLETE",
          id: reqId,
          payload: {
            transcript: "呢題揀邊個答案呀",
            language: "cantonese",
            duration: 1.0,
            confidence: 0.95,
          },
        },
      });
      await transcribePromise;
    });

    expect(result.current.latestTranscript).toBe("呢題揀邊個答案呀");
    expect(mockOnTranscript).toHaveBeenCalledWith(
      "呢題揀邊個答案呀",
      expect.objectContaining({
        language: "cantonese",
      })
    );

    // Verify Firestore status telemetry updated
    expect(firestore.setDoc).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        liveTranscript: "呢題揀邊個答案呀",
        speechLanguage: "cantonese",
      }),
      { merge: true }
    );
  });

  it("attaches live audio processor to selected microphone audioStream", () => {
    const mockAudioTrack = { readyState: "live", stop: vi.fn() };
    const mockAudioStream = {
      getAudioTracks: vi.fn(() => [mockAudioTrack]),
    };
    const replacementAudioTrack = { readyState: "live", stop: vi.fn() };
    const replacementAudioStream = {
      getAudioTracks: vi.fn(() => [replacementAudioTrack]),
    };

    const mockSource = { connect: vi.fn(), disconnect: vi.fn() };
    const mockProcessor = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null,
    };
    const mockGain = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: { value: 0 },
    };

    class MockAudioContext {
      constructor() {
        this.state = "running";
        this.sampleRate = 48000;
        this.createMediaStreamSource = vi.fn(() => mockSource);
        this.createScriptProcessor = vi.fn(() => mockProcessor);
        this.createGain = vi.fn(() => mockGain);
        this.destination = {};
        this.close = vi.fn().mockResolvedValue(undefined);
        mockAudioContextInstance = this;
        mockAudioContextInstances.push(this);
      }
    }

    let mockAudioContextInstance = null;
    const mockAudioContextInstances = [];
    globalThis.AudioContext = MockAudioContext;

    let hookResult;
    act(() => {
      hookResult = renderHook(
        ({ audioStream, deviceId }) =>
          useClientLiteRTWhisper({
            classId: "CLASS_TEST",
            studentUid: "student_123",
            enabled: true,
            audioStream,
            deviceId,
          }),
        {
          initialProps: {
            audioStream: mockAudioStream,
            deviceId: "usb-headset-mic",
          },
        }
      );
    });

    expect(mockAudioContextInstance).not.toBeNull();
    expect(mockAudioContextInstance.createMediaStreamSource).toHaveBeenCalledWith(mockAudioStream);
    expect(mockAudioContextInstance.createScriptProcessor).toHaveBeenCalledWith(4096, 1, 1);
    expect(mockProcessor.connect).toHaveBeenCalledWith(mockGain);
    expect(mockGain.connect).toHaveBeenCalledWith(mockAudioContextInstance.destination);

    act(() => {
      hookResult.rerender({
        audioStream: replacementAudioStream,
        deviceId: "webcam-mic",
      });
    });
    expect(mockSource.disconnect).toHaveBeenCalled();
    expect(mockAudioContextInstances).toHaveLength(2);
    expect(mockAudioContextInstance.createMediaStreamSource)
      .toHaveBeenCalledWith(replacementAudioStream);

    // Clean up
    act(() => {
      hookResult.unmount();
    });
    expect(mockProcessor.disconnect).toHaveBeenCalled();
    expect(mockSource.disconnect).toHaveBeenCalled();
    expect(mockAudioContextInstance.close).toHaveBeenCalled();
  });

  it("waits for the recorder stream instead of requesting microphone permission", async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    renderHook(() =>
      useClientLiteRTWhisper({
        classId: "CLASS_TEST",
        studentUid: "student_123",
        enabled: true,
        audioStream: null,
        deviceId: "persisted-mic",
      })
    );

    await waitFor(() => {
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "INIT" })
      );
    });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("starts browser speech recognition with the recorder's selected track", () => {
    const selectedTrack = {
      kind: "audio",
      readyState: "live",
      getSettings: vi.fn(() => ({ deviceId: "selected-webcam-mic" })),
    };
    const selectedStream = {
      getAudioTracks: vi.fn(() => [selectedTrack]),
    };
    const replacementTrack = {
      kind: "audio",
      readyState: "live",
      getSettings: vi.fn(() => ({ deviceId: "selected-headset-mic" })),
    };
    const replacementStream = {
      getAudioTracks: vi.fn(() => [replacementTrack]),
    };
    const start = vi.fn();
    const abort = vi.fn();
    const speechRecognition = vi.fn(function MockSpeechRecognition() {
      this.start = start;
      this.abort = abort;
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: speechRecognition,
    });

    const { rerender, unmount } = renderHook(
      ({ audioStream, deviceId }) =>
        useClientLiteRTWhisper({
          classId: "CLASS_TEST",
          studentUid: "student_123",
          enabled: true,
          audioStream,
          deviceId,
        }),
      {
        initialProps: {
          audioStream: selectedStream,
          deviceId: "selected-webcam-mic",
        },
      }
    );

    expect(speechRecognition).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(selectedTrack);
    rerender({
      audioStream: replacementStream,
      deviceId: "selected-headset-mic",
    });
    expect(abort).toHaveBeenCalledOnce();
    expect(speechRecognition).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenLastCalledWith(replacementTrack);
    unmount();
    expect(abort).toHaveBeenCalledTimes(2);
    delete window.webkitSpeechRecognition;
  });
});
