import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isMediaStreamLive,
  setPendingBroadcastHandover,
  peekPendingBroadcastHandover,
  consumePendingBroadcastHandover,
  clearPendingBroadcastHandover,
  playTeacherAlertChime,
  sendTeacherSystemNotification,
  closeTeacherSystemNotification,
} from './broadcastHandover';

describe('broadcastHandover utilities', () => {
  beforeEach(() => {
    clearPendingBroadcastHandover(false);
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isMediaStreamLive', () => {
    it('returns true when stream has at least one live track of the requested kind', () => {
      const mockStream = {
        getVideoTracks: () => [{ readyState: 'live' }],
        getAudioTracks: () => [{ readyState: 'ended' }],
        getTracks: () => [{ readyState: 'live' }, { readyState: 'ended' }],
      };

      expect(isMediaStreamLive(mockStream, 'video')).toBe(true);
      expect(isMediaStreamLive(mockStream, 'audio')).toBe(false);
      expect(isMediaStreamLive(mockStream)).toBe(true);
      expect(isMediaStreamLive(null)).toBe(false);
      expect(isMediaStreamLive({ getTracks: () => { throw new Error('bad stream'); } })).toBe(false);
    });
  });

  describe('Pending Broadcast Handover Bridge', () => {
    it('stores, peeks, and consumes a pending broadcast handover for the matching targetClassId', () => {
      const mockScreenStream = {
        getVideoTracks: () => [{ readyState: 'live', stop: vi.fn() }],
        getTracks: () => [{ readyState: 'live', stop: vi.fn() }],
      };
      const mockMicStream = {
        getAudioTracks: () => [{ readyState: 'live', stop: vi.fn() }],
        getTracks: () => [{ readyState: 'live', stop: vi.fn() }],
      };

      setPendingBroadcastHandover({
        fromClassId: 'CLASS_SESSION_1',
        targetClassId: 'CLASS_SESSION_2',
        screenStream: mockScreenStream,
        micStream: mockMicStream,
        options: { resolution: '1080p', enableSubtitles: true },
      });

      // Mismatched class returns null without consuming
      expect(peekPendingBroadcastHandover('OTHER_CLASS')).toBeNull();

      // Matching class peeks and then consumes once
      const peeked = peekPendingBroadcastHandover('CLASS_SESSION_2');
      expect(peeked).not.toBeNull();
      expect(peeked.fromClassId).toBe('CLASS_SESSION_1');
      expect(peeked.screenStream).toBe(mockScreenStream);

      const consumed = consumePendingBroadcastHandover('CLASS_SESSION_2');
      expect(consumed).not.toBeNull();
      expect(consumed.options.resolution).toBe('1080p');

      // Second consume returns null
      expect(consumePendingBroadcastHandover('CLASS_SESSION_2')).toBeNull();
    });

    it('expires pending handover entries older than TTL', () => {
      vi.useFakeTimers();
      setPendingBroadcastHandover({
        fromClassId: 'CLASS_1',
        targetClassId: 'CLASS_2',
      });

      vi.advanceTimersByTime(31000);
      expect(peekPendingBroadcastHandover('CLASS_2')).toBeNull();
    });

    it('stops underlying tracks when clearPendingBroadcastHandover(true) is called', () => {
      const stopVideo = vi.fn();
      const stopAudio = vi.fn();
      setPendingBroadcastHandover({
        fromClassId: 'CLASS_1',
        targetClassId: 'CLASS_2',
        screenStream: { getTracks: () => [{ stop: stopVideo }] },
        micStream: { getTracks: () => [{ stop: stopAudio }] },
      });

      clearPendingBroadcastHandover(true);
      expect(stopVideo).toHaveBeenCalledTimes(1);
      expect(stopAudio).toHaveBeenCalledTimes(1);
      expect(peekPendingBroadcastHandover('CLASS_2')).toBeNull();
    });
  });

  describe('Out-of-Tab Teacher OS Notification & Audio Chime', () => {
    it('plays Web Audio two-tone chime unless muted in localStorage', () => {
      const startSpy = vi.fn();
      const stopSpy = vi.fn();
      class MockAudioContext {
        constructor() {
          this.currentTime = 0;
          this.state = 'running';
          this.destination = {};
          this.close = vi.fn();
        }
        createOscillator() {
          return {
            type: 'sine',
            frequency: { setValueAtTime: vi.fn() },
            connect: vi.fn(),
            start: startSpy,
            stop: stopSpy,
          };
        }
        createGain() {
          return {
            gain: {
              setValueAtTime: vi.fn(),
              exponentialRampToValueAtTime: vi.fn(),
            },
            connect: vi.fn(),
          };
        }
      }
      window.AudioContext = MockAudioContext;

      expect(playTeacherAlertChime('silence')).toBe(true);
      expect(startSpy).toHaveBeenCalledTimes(2);

      // Muted preference suppresses chime
      localStorage.setItem('teacher_broadcast_mute_alert_chime', 'true');
      expect(playTeacherAlertChime('silence')).toBe(false);

      delete window.AudioContext;
    });

    it('dispatches OS desktop notification via window.Notification fallback and closes it by tag', async () => {
      const closeSpy = vi.fn();
      const createdNotifications = [];
      class MockNotification {
        static permission = 'granted';
        static requestPermission = vi.fn().mockResolvedValue('granted');
        constructor(title, options) {
          this.title = title;
          this.options = options;
          this.close = closeSpy;
          createdNotifications.push(this);
        }
      }
      window.Notification = MockNotification;

      const sent = await sendTeacherSystemNotification({
        title: '⚠️ Mic Appears Muted or Silent',
        body: 'No voice activity detected for 45s while broadcasting.',
        tag: 'teacher-mic-silent-warning',
        playChime: false,
      });

      expect(sent).toBe(true);
      expect(createdNotifications).toHaveLength(1);
      expect(createdNotifications[0].title).toBe('⚠️ Mic Appears Muted or Silent');

      await closeTeacherSystemNotification('teacher-mic-silent-warning');
      expect(closeSpy).toHaveBeenCalled();

      delete window.Notification;
    });

    it('handles handover chime, AudioContext close timeout, ServiceWorker notifications, and notification onclick callbacks', async () => {
      vi.useFakeTimers();
      const closeAudioSpy = vi.fn();
      class MockAudioContext {
        constructor() {
          this.currentTime = 0;
          this.state = 'running';
          this.destination = {};
          this.close = closeAudioSpy;
        }
        createOscillator() {
          return {
            type: 'sine',
            frequency: { setValueAtTime: vi.fn() },
            connect: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
          };
        }
        createGain() {
          return {
            gain: {
              setValueAtTime: vi.fn(),
              exponentialRampToValueAtTime: vi.fn(),
            },
            connect: vi.fn(),
          };
        }
      }
      window.AudioContext = MockAudioContext;

      expect(playTeacherAlertChime('handover')).toBe(true);
      vi.advanceTimersByTime(900);
      expect(closeAudioSpy).toHaveBeenCalled();

      // Test AudioContext throwing error
      window.AudioContext = function () {
        throw new Error('AudioContext blocked');
      };
      expect(playTeacherAlertChime('silence')).toBe(false);
      delete window.AudioContext;
      vi.useRealTimers();

      // Test Notification permission request + onclick callback + replacing duplicate tag
      const closeSpy = vi.fn();
      const focusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {});
      const createdNotifications = [];
      class MockNotification {
        static permission = 'default';
        static requestPermission = vi.fn().mockImplementation(async () => {
          MockNotification.permission = 'granted';
          return 'granted';
        });
        constructor(title, options) {
          this.title = title;
          this.options = options;
          this.close = closeSpy;
          createdNotifications.push(this);
        }
      }
      window.Notification = MockNotification;

      const onClickSpy = vi.fn();
      await sendTeacherSystemNotification({
        title: 'First Alert',
        body: 'Body 1',
        tag: 'dup-tag',
        data: { targetClassId: 'C2' },
        playChime: true,
        onClick: onClickSpy,
      });
      await sendTeacherSystemNotification({
        title: 'Second Alert',
        body: 'Body 2',
        tag: 'dup-tag',
        data: { targetClassId: 'C2' },
        onClick: onClickSpy,
      });

      expect(createdNotifications).toHaveLength(2);
      expect(closeSpy).toHaveBeenCalledTimes(1); // First notification closed when replaced

      // Trigger onclick on second notification
      createdNotifications[1].onclick();
      expect(focusSpy).toHaveBeenCalled();
      expect(onClickSpy).toHaveBeenCalledWith({ targetClassId: 'C2' });

      // Test ServiceWorker showNotification and getNotifications paths
      const swShowNotification = vi.fn().mockResolvedValue();
      const swNotifClose = vi.fn();
      const swGetNotifications = vi.fn().mockResolvedValue([{ close: swNotifClose }]);
      const origSw = navigator.serviceWorker;
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          ready: Promise.resolve({
            showNotification: swShowNotification,
            getNotifications: swGetNotifications,
          }),
        },
      });

      const sentSw = await sendTeacherSystemNotification({
        title: 'SW Alert',
        body: 'Via Service Worker',
        tag: 'sw-tag',
      });
      expect(sentSw).toBe(true);
      expect(swShowNotification).toHaveBeenCalled();

      await closeTeacherSystemNotification('sw-tag');
      expect(swGetNotifications).toHaveBeenCalledWith({ tag: 'sw-tag' });
      expect(swNotifClose).toHaveBeenCalled();

      // Test ServiceWorker active.postMessage fallback when showNotification is absent
      const postMessageSpy = vi.fn();
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          ready: Promise.resolve({
            active: { postMessage: postMessageSpy },
          }),
        },
      });
      const sentPost = await sendTeacherSystemNotification({
        title: 'SW PostMessage Alert',
        body: 'Via postMessage',
        tag: 'sw-post-tag',
      });
      expect(sentPost).toBe(true);
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'show-notification', title: 'SW PostMessage Alert' })
      );

      if (origSw !== undefined) {
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: origSw });
      } else {
        delete navigator.serviceWorker;
      }
      focusSpy.mockRestore();
      delete window.Notification;
    });
  });
});
