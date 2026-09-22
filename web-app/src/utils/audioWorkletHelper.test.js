import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attachAudioProcessor } from './audioWorkletHelper';

describe('audioWorkletHelper Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses modern AudioWorkletNode path when available', async () => {
    let messageHandler = null;
    const mockWorkletPort = {
      onmessage: null,
      postMessage: vi.fn(),
    };

    class MockAudioWorkletNode {
      constructor(ctx, name) {
        this.ctx = ctx;
        this.name = name;
        this.port = mockWorkletPort;
        this.connect = vi.fn();
        this.disconnect = vi.fn();
      }
    }

    // Set globals
    globalThis.AudioWorkletNode = MockAudioWorkletNode;
    globalThis.URL = {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    };

    const mockSourceNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    const mockDestination = {};
    const mockMuteNode = {
      gain: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    const mockAudioCtx = {
      sampleRate: 48000,
      destination: mockDestination,
      createGain: vi.fn(() => mockMuteNode),
      audioWorklet: {
        addModule: vi.fn().mockResolvedValue(undefined),
      },
    };

    const onPcmChunk = vi.fn();
    const handle = attachAudioProcessor(mockAudioCtx, mockSourceNode, onPcmChunk);

    expect(handle).toHaveProperty('disconnect');
    expect(mockAudioCtx.audioWorklet.addModule).toHaveBeenCalledWith('blob:mock-url');

    // Wait for addModule promise to resolve
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockSourceNode.connect).toHaveBeenCalled();
    expect(mockWorkletPort.onmessage).toBeDefined();

    // Trigger audio message event
    const fakePcm = new Float32Array([0.1, -0.2, 0.3, -0.4]);
    mockWorkletPort.onmessage({ data: fakePcm });

    expect(onPcmChunk).toHaveBeenCalled();

    // Disconnect
    handle.disconnect();
    expect(mockSourceNode.disconnect).toHaveBeenCalled();
  });

  it('falls back to ScriptProcessorNode when AudioWorkletNode is not supported', () => {
    const originalAudioWorkletNode = globalThis.AudioWorkletNode;
    delete globalThis.AudioWorkletNode;

    const mockScriptNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null,
    };

    const mockSourceNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    const mockAudioCtx = {
      sampleRate: 48000,
      destination: {},
      createGain: vi.fn(() => ({
        gain: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      createScriptProcessor: vi.fn(() => mockScriptNode),
    };

    const onPcmChunk = vi.fn();
    const handle = attachAudioProcessor(mockAudioCtx, mockSourceNode, onPcmChunk);

    expect(mockAudioCtx.createScriptProcessor).toHaveBeenCalledWith(4096, 1, 1);
    expect(mockSourceNode.connect).toHaveBeenCalledWith(mockScriptNode);

    // Simulate audioprocess event
    const fakeData = new Float32Array([0.05, -0.05, 0.1, -0.1]);
    mockScriptNode.onaudioprocess({
      inputBuffer: {
        getChannelData: () => fakeData,
      },
    });

    expect(onPcmChunk).toHaveBeenCalled();

    // Disconnect
    handle.disconnect();
    expect(mockScriptNode.disconnect).toHaveBeenCalled();

    globalThis.AudioWorkletNode = originalAudioWorkletNode;
  });

  it('returns no-op disconnect when neither AudioWorklet nor ScriptProcessor are supported', () => {
    const originalAudioWorkletNode = globalThis.AudioWorkletNode;
    delete globalThis.AudioWorkletNode;

    const mockAudioCtx = {};
    const mockSourceNode = {};

    const handle = attachAudioProcessor(mockAudioCtx, mockSourceNode, vi.fn());
    expect(handle).toHaveProperty('disconnect');
    expect(() => handle.disconnect()).not.toThrow();

    globalThis.AudioWorkletNode = originalAudioWorkletNode;
  });
});
