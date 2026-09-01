import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireInputDeviceStream } from './mediaDeviceCapture';

function createStream(kind, deviceId) {
  const track = {
    stop: vi.fn(),
    getSettings: () => ({ deviceId }),
  };
  return {
    track,
    stream: {
      getTracks: () => [track],
      getAudioTracks: () => kind === 'audio' ? [track] : [],
      getVideoTracks: () => kind === 'video' ? [track] : [],
    },
  };
}

describe('acquireInputDeviceStream', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests generic camera permission before binding a selected camera exactly', async () => {
    const permission = createStream('video', 'default-camera');
    const selected = createStream('video', 'usb-camera');
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(permission.stream)
      .mockResolvedValueOnce(selected.stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    const result = await acquireInputDeviceStream('video', 'usb-camera');

    expect(getUserMedia).toHaveBeenNthCalledWith(1, { audio: false, video: {} });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: false,
      video: { deviceId: { exact: 'usb-camera' } },
    });
    expect(permission.track.stop).toHaveBeenCalled();
    expect(result).toBe(selected.stream);
  });

  it('binds a selected microphone exactly instead of accepting the default', async () => {
    const permission = createStream('audio', 'default-mic');
    const selected = createStream('audio', 'usb-mic');
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(permission.stream)
      .mockResolvedValueOnce(selected.stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    const result = await acquireInputDeviceStream('audio', 'usb-mic', {
      echoCancellation: true,
    });

    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      audio: { echoCancellation: true },
      video: false,
    });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: {
        echoCancellation: true,
        deviceId: { exact: 'usb-mic' },
      },
      video: false,
    });
    expect(result).toBe(selected.stream);
  });

  it('returns the permission stream when it already uses the selected device', async () => {
    const selected = createStream('audio', 'usb-mic');
    const getUserMedia = vi.fn().mockResolvedValue(selected.stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    const result = await acquireInputDeviceStream('audio', 'usb-mic');

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(result).toBe(selected.stream);
    expect(selected.track.stop).not.toHaveBeenCalled();
  });
});

