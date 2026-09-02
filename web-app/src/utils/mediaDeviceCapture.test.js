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
    localStorage.clear();
  });

  it('requests generic camera permission before binding a selected camera exactly', async () => {
    const permission = createStream('video', 'default-camera');
    const selected = createStream('video', 'usb-camera');
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(permission.stream)
      .mockImplementationOnce(async () => {
        expect(permission.track.stop).toHaveBeenCalled();
        return selected.stream;
      });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia,
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: 'videoinput', deviceId: 'default-camera' },
          { kind: 'videoinput', deviceId: 'usb-camera' },
        ]),
      },
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
      value: {
        getUserMedia,
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: 'audioinput', deviceId: 'default-mic' },
          { kind: 'audioinput', deviceId: 'usb-mic' },
        ]),
      },
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
      value: {
        getUserMedia,
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: 'audioinput', deviceId: 'usb-mic' },
        ]),
      },
    });

    const result = await acquireInputDeviceStream('audio', 'usb-mic');

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(result).toBe(selected.stream);
    expect(selected.track.stop).not.toHaveBeenCalled();
  });

  it('reconciles a selected camera when Chrome rotates its device ID after permission', async () => {
    const permission = createStream('video', 'new-default');
    const selected = createStream('video', 'new-usb');
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(permission.stream)
      .mockResolvedValueOnce(selected.stream);
    const enumerateDevices = vi.fn()
      .mockResolvedValueOnce([
        { kind: 'videoinput', deviceId: 'old-default', groupId: 'group-default', label: '' },
        { kind: 'videoinput', deviceId: 'old-usb', groupId: 'group-usb', label: '' },
      ])
      .mockResolvedValueOnce([
        { kind: 'videoinput', deviceId: 'new-default', groupId: 'group-default', label: 'Camera 1' },
        { kind: 'videoinput', deviceId: 'new-usb', groupId: 'group-usb', label: 'Camera 2' },
      ]);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia, enumerateDevices },
    });

    await acquireInputDeviceStream('video', 'old-usb');

    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: false,
      video: { deviceId: { exact: 'new-usb' } },
    });
  });

  it('uses the permission stream when a persisted microphone is no longer available', async () => {
    const permission = createStream('audio', 'current-default');
    const getUserMedia = vi.fn().mockResolvedValue(permission.stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia,
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: 'audioinput', deviceId: 'current-default' },
        ]),
      },
    });

    const result = await acquireInputDeviceStream('audio', 'disconnected-mic');

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(permission.track.stop).not.toHaveBeenCalled();
    expect(result).toBe(permission.stream);
  });

  it('reconciles a rotated microphone ID from its persisted physical identity', async () => {
    localStorage.setItem('preferred_audio_input_identity', JSON.stringify({
      deviceId: 'old-usb-id',
      groupId: 'jabra-group',
      label: 'Jabra Headset Microphone',
    }));
    const permission = createStream('audio', 'current-default');
    const selected = createStream('audio', 'new-usb-id');
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(permission.stream)
      .mockResolvedValueOnce(selected.stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia,
        enumerateDevices: vi.fn().mockResolvedValue([
          {
            kind: 'audioinput',
            deviceId: 'new-usb-id',
            groupId: 'jabra-group',
            label: 'Jabra Headset Microphone',
          },
          {
            kind: 'audioinput',
            deviceId: 'current-default',
            groupId: 'default-group',
            label: 'Built-in Microphone',
          },
        ]),
      },
    });

    const result = await acquireInputDeviceStream('audio', 'old-usb-id');

    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: { deviceId: { exact: 'new-usb-id' } },
      video: false,
    });
    expect(result).toBe(selected.stream);
    expect(JSON.parse(localStorage.getItem('preferred_audio_input_identity'))).toMatchObject({
      deviceId: 'new-usb-id',
      groupId: 'jabra-group',
    });
  });
});
