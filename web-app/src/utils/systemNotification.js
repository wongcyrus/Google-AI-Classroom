/**
 * Centralized System & Browser Notification Utility
 * Provides cross-platform OS notifications (via Service Worker & Notification API),
 * background tab flashing, audio alerts, and hardware vibration.
 */

/**
 * Clean Web Audio API chime (crisp multi-tone presence ping).
 * Safe against autoplay policy (catches unhandled AudioContext errors).
 */
export function playBingoChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx || typeof AudioCtx !== 'function') return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume?.().catch(() => {});
    }

    const now = ctx.currentTime || 0;
    const osc1 = ctx.createOscillator?.();
    const gain1 = ctx.createGain?.();
    if (!osc1 || !gain1) return;

    // Pleasant 3-tone presence chime: D5 (587Hz) -> A5 (880Hz) -> D6 (1175Hz)
    osc1.type = 'sine';
    if (osc1.frequency?.setValueAtTime) {
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.setValueAtTime(880, now + 0.12); // A5
      osc1.frequency.setValueAtTime(1174.66, now + 0.24); // D6
    }

    if (gain1.gain?.setValueAtTime) {
      gain1.gain.setValueAtTime(0.35, now);
      gain1.gain.exponentialRampToValueAtTime?.(0.001, now + 0.65);
    }

    osc1.connect?.(gain1);
    gain1.connect?.(ctx.destination);

    osc1.start?.(now);
    osc1.stop?.(now + 0.65);
  } catch (err) {
    // Silent catch for autoplay restrictions or test mock environments
  }
}

/**
 * Requests browser notification permission if not yet decided.
 * @returns {Promise<NotificationPermission>}
 */
export async function requestSystemNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  try {
    if (typeof window.Notification.requestPermission === 'function') {
      const perm = await window.Notification.requestPermission();
      return perm;
    }
    return window.Notification.permission || 'denied';
  } catch (err) {
    console.warn('[systemNotification] Error requesting permission:', err);
    return window.Notification.permission || 'denied';
  }
}

/**
 * Shows an OS-level system notification via Service Worker or Window Notification API.
 * @param {Object} options
 * @param {string} options.title
 * @param {string} options.body
 * @param {string} [options.icon]
 * @param {string} [options.badge]
 * @param {string} [options.tag]
 * @param {boolean} [options.requireInteraction=true]
 * @param {boolean} [options.renotify=true]
 * @param {number[]} [options.vibrate]
 * @param {any} [options.data]
 * @param {Function} [options.onClick]
 * @returns {Promise<boolean>}
 */
export async function showSystemNotification({
  title = 'Classroom Alert',
  body = '',
  icon = '/favicon.ico',
  badge = '/favicon.ico',
  tag = 'classroom-alert',
  requireInteraction = true,
  renotify = true,
  vibrate = [300, 150, 300, 150, 300],
  data = {},
  onClick = null,
} = {}) {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  // If permission is default, attempt prompt
  let perm = window.Notification.permission;
  if (perm === 'default') {
    perm = await requestSystemNotificationPermission();
  }

  if (perm !== 'granted') {
    return false;
  }

  let notificationShown = false;

  // 1. Prefer Service Worker registration for persistent OS notifications
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      if (registration && typeof registration.showNotification === 'function') {
        await registration.showNotification(title, {
          body,
          icon,
          badge,
          tag,
          requireInteraction,
          renotify,
          vibrate,
          data,
        });
        notificationShown = true;
      }
    } catch (swErr) {
      console.debug('[systemNotification] ServiceWorker notification error, falling back:', swErr);
    }
  }

  // 2. Fallback to standard Window Notification if Service Worker did not trigger
  if (!notificationShown && typeof window.Notification === 'function') {
    try {
      const notif = new window.Notification(title, {
        body,
        icon,
        badge,
        tag,
        requireInteraction,
        renotify,
        vibrate,
        data,
      });

      notif.onclick = () => {
        try {
          window.focus();
        } catch (_) {}
        if (typeof onClick === 'function') {
          onClick();
        }
        notif.close?.();
      };
      notificationShown = true;
    } catch (notifErr) {
      console.warn('[systemNotification] Window Notification error:', notifErr);
    }
  }

  return notificationShown;
}

/**
 * Starts flashing the document title to attract user attention when tab is in background.
 * @param {string} alertTitle
 * @param {number} [intervalMs=1000]
 * @returns {Function} stopFlashing cleanup function
 */
export function startTitleFlashing(alertTitle, intervalMs = 1000) {
  if (typeof document === 'undefined') return () => {};

  const originalTitle = document.title;
  let isAlertState = false;

  const intervalId = setInterval(() => {
    try {
      document.title = isAlertState ? originalTitle : alertTitle;
      isAlertState = !isAlertState;
    } catch (_) {}
  }, intervalMs);

  let stopped = false;
  const stopFlashing = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(intervalId);
    try {
      document.title = originalTitle;
    } catch (_) {}
  };

  return stopFlashing;
}

/**
 * Full multi-channel attention trigger when a Bingo Presence Check arrives:
 * 1. Web Audio chime
 * 2. Hardware vibration
 * 3. OS System Notification (requireInteraction: true)
 * 4. Background tab title flashing
 *
 * @param {Object} challenge
 * @param {Function} [onAnswerClick]
 * @returns {Function} cleanup function to stop flashing
 */
export function triggerBingoNotification(challenge, onAnswerClick = null) {
  const timeLimit = challenge?.timeLimitSeconds || 30;
  const bingoId = challenge?.bingoId || 'active';

  // 1. Play Web Audio Chime
  try {
    playBingoChime();
  } catch (_) {}

  // 2. Hardware Vibration (mobile / Android)
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([300, 150, 300, 150, 300]);
    } catch (_) {}
  }

  // 3. System Notification
  showSystemNotification({
    title: '🎯 Action Required: Bingo Presence Check!',
    body: `Class presence challenge active (${timeLimit}s). Click here to respond!`,
    tag: `bingo-check-${bingoId}`,
    requireInteraction: true,
    renotify: true,
    vibrate: [300, 150, 300, 150, 300],
    onClick: onAnswerClick,
  });

  // 4. Background Tab Title Flashing
  const stopTitleFlashing = startTitleFlashing(
    `🚨 [BINGO CHECK! ANSWER NOW] ⏳ ${timeLimit}s 🚨`,
    1000
  );

  return stopTitleFlashing;
}
