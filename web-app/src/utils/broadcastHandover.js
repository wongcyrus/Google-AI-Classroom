/**
 * broadcastHandover.js
 *
 * 1. In-memory handover bridge that preserves live MediaStream instances
 *    (screenStream + micStream) and broadcast settings when a teacher switches
 *    from one class session to the next in a back-to-back lecture/event,
 *    eliminating any need to re-prompt `navigator.mediaDevices.getDisplayMedia`.
 *
 * 2. Out-of-tab Teacher OS System Notification & Web Audio Chime utilities
 *    so teachers lecturing fullscreen in PowerPoint / Keynote / Terminal
 *    are immediately alerted if their microphone is muted/silent or if their
 *    next scheduled session is starting.
 */

const HANDOVER_TTL_MS = 30 * 1000; // 30 seconds max validity across route transition

let pendingHandover = null;

/**
 * Checks whether a MediaStream has at least one live track of the given kind.
 * @param {MediaStream|null} stream
 * @param {'video'|'audio'} [kind]
 * @returns {boolean}
 */
export function isMediaStreamLive(stream, kind) {
  if (!stream) return false;
  try {
    const tracks =
      kind === 'video'
        ? stream.getVideoTracks?.()
        : kind === 'audio'
          ? stream.getAudioTracks?.()
          : stream.getTracks?.();
    if (!Array.isArray(tracks) || tracks.length === 0) return false;
    return tracks.some((t) => t && t.readyState === 'live');
  } catch {
    return false;
  }
}

/**
 * Stores a pending broadcast handover before navigating from `fromClassId` to `targetClassId`.
 * @param {Object} payload
 */
export function setPendingBroadcastHandover(payload) {
  if (!payload || !payload.targetClassId) return null;
  pendingHandover = {
    ...payload,
    createdAt: Date.now(),
  };
  return pendingHandover;
}

/**
 * Peeks at the pending broadcast handover without consuming it.
 * Automatically expires entries older than HANDOVER_TTL_MS.
 */
export function peekPendingBroadcastHandover(targetClassId = null) {
  if (!pendingHandover) return null;
  if (Date.now() - pendingHandover.createdAt > HANDOVER_TTL_MS) {
    pendingHandover = null;
    return null;
  }
  if (targetClassId && pendingHandover.targetClassId !== targetClassId) {
    return null;
  }
  return pendingHandover;
}

/**
 * Consumes and clears the pending broadcast handover for `targetClassId`.
 * @param {string} targetClassId
 * @returns {Object|null}
 */
export function consumePendingBroadcastHandover(targetClassId) {
  const matched = peekPendingBroadcastHandover(targetClassId);
  if (!matched) return null;
  pendingHandover = null;
  return matched;
}

/**
 * Clears any pending handover and optionally stops its streams if aborted.
 * @param {boolean} [stopTracks=false]
 */
export function clearPendingBroadcastHandover(stopTracks = false) {
  if (pendingHandover && stopTracks) {
    const { screenStream, micStream } = pendingHandover;
    [screenStream, micStream].forEach((s) => {
      try {
        s?.getTracks?.()?.forEach((t) => {
          try {
            t.stop();
          } catch {}
        });
      } catch {}
    });
  }
  pendingHandover = null;
}

/**
 * Plays a gentle, non-jarring Web Audio API two-tone alert chime so a teacher
 * presenting fullscreen in PowerPoint/Keynote hears the alert even if the OS
 * suppresses visual notification toasts during presentation mode.
 *
 * @param {'silence'|'handover'} [type='silence']
 */
export function playTeacherAlertChime(type = 'silence') {
  if (typeof window === 'undefined') return false;
  try {
    const mutedPref = localStorage.getItem('teacher_broadcast_mute_alert_chime');
    if (mutedPref === 'true') return false;
  } catch {}

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return false;

  try {
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes =
      type === 'handover'
        ? [
            { freq: 523.25, start: 0, dur: 0.14 }, // C5
            { freq: 659.25, start: 0.16, dur: 0.22 }, // E5
          ]
        : [
            { freq: 587.33, start: 0, dur: 0.16 }, // D5
            { freq: 440.0, start: 0.2, dur: 0.26 }, // A4 (attention descending chime)
          ];

    notes.forEach(({ freq, start, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + start);

      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.18, now + start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    });

    setTimeout(() => {
      try {
        if (ctx.state !== 'closed') ctx.close();
      } catch {}
    }, 800);

    return true;
  } catch {
    return false;
  }
}

/**
 * Dispatches an OS-level desktop/system notification so a teacher lecturing
 * outside the browser (e.g. in PowerPoint, PDF slides, or terminal) sees the
 * alert banner on top of their presentation screen.
 *
 * Uses both Service Worker `show-notification` and the direct `window.Notification`
 * constructor fallback.
 */
export async function sendTeacherSystemNotification({
  title,
  body,
  tag = 'teacher-broadcast-alert',
  data = {},
  playChime = false,
  chimeType = 'silence',
  onClick = null,
}) {
  if (playChime) {
    playTeacherAlertChime(chimeType);
  }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  try {
    if (Notification.permission === 'default') {
      await Notification.requestPermission().catch(() => {});
    }
  } catch {}

  if (Notification.permission !== 'granted') {
    return false;
  }

  let shownViaSw = false;
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('sw-timeout')), 1200)),
      ]);
      if (registration?.showNotification) {
        await registration.showNotification(title, {
          body,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag,
          requireInteraction: true,
          renotify: true,
          vibrate: [300, 150, 300],
          data,
        });
        shownViaSw = true;
      } else if (registration?.active?.postMessage) {
        registration.active.postMessage({
          type: 'show-notification',
          title,
          body,
          tag,
          requireInteraction: true,
          renotify: true,
          data,
        });
        shownViaSw = true;
      }
    } catch {
      shownViaSw = false;
    }
  }

  if (!shownViaSw) {
    try {
      const existing = activeWindowNotificationsByTag.get(tag);
      if (existing) {
        try { existing.close?.(); } catch {}
      }
      const notif = new window.Notification(title, {
        body,
        icon: '/favicon.ico',
        tag,
        requireInteraction: true,
        data,
      });
      activeWindowNotificationsByTag.set(tag, notif);
      notif.onclick = () => {
        try {
          window.focus();
          if (typeof onClick === 'function') onClick(data);
          notif.close();
          activeWindowNotificationsByTag.delete(tag);
        } catch {}
      };
      return true;
    } catch {
      return false;
    }
  }

  return true;
}

const activeWindowNotificationsByTag = new Map();

/**
 * Closes any active OS system notification matching `tag`.
 * @param {string} tag
 */
export async function closeTeacherSystemNotification(tag) {
  const existingWinNotif = activeWindowNotificationsByTag.get(tag);
  if (existingWinNotif) {
    try {
      existingWinNotif.close?.();
    } catch {}
    activeWindowNotificationsByTag.delete(tag);
  }

  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('sw-timeout')), 1000)),
    ]);
    if (registration?.getNotifications) {
      const list = await registration.getNotifications({ tag });
      list.forEach((n) => {
        try {
          n.close();
        } catch {}
      });
    }
  } catch {}
}
