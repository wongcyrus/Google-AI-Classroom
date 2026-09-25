import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  requestSystemNotificationPermission,
  showSystemNotification,
  startTitleFlashing,
  triggerBingoNotification,
  playBingoChime,
} from './systemNotification';

describe('systemNotification Utility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('requestSystemNotificationPermission', () => {
    it('returns denied if Notification is not in window', async () => {
      const origNotif = window.Notification;
      delete window.Notification;
      const res = await requestSystemNotificationPermission();
      expect(res).toBe('denied');
      window.Notification = origNotif;
    });

    it('requests permission and returns result', async () => {
      window.Notification = {
        requestPermission: vi.fn().mockResolvedValue('granted'),
        permission: 'granted',
      };
      const res = await requestSystemNotificationPermission();
      expect(res).toBe('granted');
      expect(window.Notification.requestPermission).toHaveBeenCalled();
    });
  });

  describe('showSystemNotification', () => {
    it('returns false if Notification is not available', async () => {
      const origNotif = window.Notification;
      delete window.Notification;
      const res = await showSystemNotification({ title: 'Test' });
      expect(res).toBe(false);
      window.Notification = origNotif;
    });

    it('shows notification via serviceWorker if available', async () => {
      const mockShowNotification = vi.fn().mockResolvedValue();
      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          ready: Promise.resolve({
            showNotification: mockShowNotification,
          }),
        },
        configurable: true,
      });

      window.Notification = {
        permission: 'granted',
      };

      const res = await showSystemNotification({
        title: '🎯 Bingo Alert',
        body: '30s verification active',
        tag: 'bingo-check-1',
      });

      expect(res).toBe(true);
      expect(mockShowNotification).toHaveBeenCalledWith(
        '🎯 Bingo Alert',
        expect.objectContaining({
          body: '30s verification active',
          tag: 'bingo-check-1',
          requireInteraction: true,
        })
      );
    });

    it('falls back to window.Notification if service worker is unavailable', async () => {
      delete navigator.serviceWorker;

      const mockNotificationInstance = {
        close: vi.fn(),
      };
      function MockNotificationClass(title, options) {
        this.title = title;
        this.options = options;
        this.close = mockNotificationInstance.close;
        mockNotificationInstance.onclick = () => {};
        Object.assign(this, mockNotificationInstance);
        return this;
      }
      MockNotificationClass.permission = 'granted';
      window.Notification = MockNotificationClass;

      const onClickSpy = vi.fn();
      const res = await showSystemNotification({
        title: '🎯 Direct Alert',
        body: 'Click here',
        onClick: onClickSpy,
      });

      expect(res).toBe(true);
      expect(MockNotificationClass.permission).toBe('granted');
    });
  });

  describe('startTitleFlashing', () => {
    it('alternates document title and restores on stop', () => {
      document.title = 'Original Classroom Tab';
      const stop = startTitleFlashing('🚨 [BINGO ACTIVE CHECK] 🚨', 500);

      expect(document.title).toBe('Original Classroom Tab');

      vi.advanceTimersByTime(500);
      expect(document.title).toBe('🚨 [BINGO ACTIVE CHECK] 🚨');

      vi.advanceTimersByTime(500);
      expect(document.title).toBe('Original Classroom Tab');

      stop();
      expect(document.title).toBe('Original Classroom Tab');

      vi.advanceTimersByTime(1000);
      expect(document.title).toBe('Original Classroom Tab');
    });
  });

  describe('triggerBingoNotification', () => {
    it('triggers sound chime, vibration, notification, and tab flashing', () => {
      const mockVibrate = vi.fn();
      Object.defineProperty(navigator, 'vibrate', {
        value: mockVibrate,
        configurable: true,
      });

      window.Notification = {
        permission: 'granted',
      };

      const mockChallenge = {
        bingoId: 'b_999',
        timeLimitSeconds: 25,
      };

      const stop = triggerBingoNotification(mockChallenge);
      expect(typeof stop).toBe('function');
      expect(mockVibrate).toHaveBeenCalledWith([300, 150, 300, 150, 300]);

      stop();
    });
  });

  describe('playBingoChime', () => {
    it('safely handles missing or suspended AudioContext without throwing', () => {
      expect(() => playBingoChime()).not.toThrow();

      const mockOsc = {
        type: '',
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      const mockGain = {
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      };

      function MockAudioContext() {
        this.state = 'suspended';
        this.currentTime = 0;
        this.resume = vi.fn().mockResolvedValue();
        this.createOscillator = vi.fn().mockReturnValue(mockOsc);
        this.createGain = vi.fn().mockReturnValue(mockGain);
        this.destination = {};
      }
      window.AudioContext = MockAudioContext;

      expect(() => playBingoChime()).not.toThrow();
      expect(mockOsc.start).toHaveBeenCalled();
    });
  });
});
