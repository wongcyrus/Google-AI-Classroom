/**
 * audioWorkletHelper.js
 *
 * Modern AudioWorkletNode manager for real-time PCM audio streaming.
 * Replaces deprecated ScriptProcessorNode with an off-thread AudioWorkletProcessor in modern browsers,
 * preventing UI thread jank, frame drops, and Chrome deprecation warnings.
 * Gracefully and synchronously falls back to ScriptProcessorNode for test mocks and legacy environments.
 */

import { downsamplePcmTo16k } from './audioDecoder';

const WORKLET_PROCESSOR_CODE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      this.port.postMessage(input[0]);
    }
    return true;
  }
}
registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
`;

const workletModuleMap = new WeakMap();

function ensureWorkletModuleLoaded(audioCtx) {
  if (!audioCtx || typeof audioCtx !== 'object') {
    return Promise.reject(new Error('Invalid AudioContext'));
  }
  let promise = workletModuleMap.get(audioCtx);
  if (!promise) {
    promise = (async () => {
      const blob = new Blob([WORKLET_PROCESSOR_CODE], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      try {
        await audioCtx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
    workletModuleMap.set(audioCtx, promise);
  }
  return promise;
}

/**
 * Attaches a PCM audio processor to an existing Web Audio source node.
 * Automatically downsamples to 16kHz and dispatches Float32Array PCM chunks to onPcmChunk.
 *
 * @param {AudioContext} audioCtx
 * @param {AudioNode} sourceNode
 * @param {(pcmChunk: Float32Array) => void} onPcmChunk
 * @returns {{ disconnect: () => void }}
 */
export function attachAudioProcessor(audioCtx, sourceNode, onPcmChunk) {
  let isClosed = false;
  let workletNode = null;
  let scriptNode = null;
  let muteNode = null;

  if (typeof audioCtx?.createGain === 'function') {
    muteNode = audioCtx.createGain();
    muteNode.gain.value = 0;
  }

  const attachScriptProcessorFallback = () => {
    if (isClosed || scriptNode || typeof audioCtx?.createScriptProcessor !== 'function') {
      return false;
    }
    try {
      scriptNode = audioCtx.createScriptProcessor(4096, 1, 1);
      scriptNode.onaudioprocess = (e) => {
        if (isClosed) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16k = downsamplePcmTo16k(inputData, audioCtx.sampleRate, 16000);
        onPcmChunk(pcm16k);
      };

      sourceNode.connect(scriptNode);
      if (muteNode) {
        scriptNode.connect(muteNode);
        muteNode.connect(audioCtx.destination);
      } else {
        scriptNode.connect(audioCtx.destination);
      }
      return true;
    } catch (scriptErr) {
      console.debug('[AudioWorkletHelper] ScriptProcessor fallback error:', scriptErr);
      return false;
    }
  };

  // 1. Modern AudioWorklet path (active in Chrome/Edge/Safari/Firefox with audioWorklet support)
  if (
    typeof AudioWorkletNode !== 'undefined' &&
    audioCtx?.audioWorklet &&
    typeof audioCtx.audioWorklet.addModule === 'function' &&
    typeof URL !== 'undefined' &&
    typeof Blob !== 'undefined'
  ) {
    ensureWorkletModuleLoaded(audioCtx).then(() => {
      if (isClosed) return;
      try {
        workletNode = new AudioWorkletNode(audioCtx, 'pcm-capture-processor');
        workletNode.port.onmessage = (event) => {
          if (isClosed) return;
          const inputData = event.data;
          if (!inputData || inputData.length === 0) return;
          const pcm16k = downsamplePcmTo16k(inputData, audioCtx.sampleRate, 16000);
          onPcmChunk(pcm16k);
        };

        sourceNode.connect(workletNode);
        if (muteNode) {
          workletNode.connect(muteNode);
          muteNode.connect(audioCtx.destination);
        } else {
          workletNode.connect(audioCtx.destination);
        }
      } catch (workletErr) {
        console.debug('[AudioWorkletHelper] Worklet instantiate fallback to ScriptProcessor:', workletErr);
        attachScriptProcessorFallback();
      }
    }).catch((workletLoadErr) => {
      console.debug('[AudioWorkletHelper] Worklet addModule fallback to ScriptProcessor:', workletLoadErr);
      workletModuleMap.delete(audioCtx);
      attachScriptProcessorFallback();
    });

    return {
      disconnect: () => {
        isClosed = true;
        try {
          if (workletNode) {
            sourceNode.disconnect(workletNode);
            workletNode.disconnect();
            workletNode.port.onmessage = null;
          }
          if (scriptNode) {
            sourceNode.disconnect(scriptNode);
            scriptNode.disconnect();
            scriptNode.onaudioprocess = null;
          }
          muteNode?.disconnect();
        } catch {}
      },
    };
  }

  // 2. Synchronous fallback path for test mocks (Vitest/Jest) and legacy environments
  if (attachScriptProcessorFallback()) {
    return {
      disconnect: () => {
        isClosed = true;
        try {
          sourceNode.disconnect(scriptNode);
          scriptNode.disconnect();
          muteNode?.disconnect();
          scriptNode.onaudioprocess = null;
        } catch {}
      },
    };
  }

  return { disconnect: () => {} };
}

