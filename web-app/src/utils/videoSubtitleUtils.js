/**
 * videoSubtitleUtils.js
 * Utilities for lecture video player modes and multilingual WebVTT subtitle tracks.
 */

export const SUBTITLE_LANGUAGES = [
  { code: 'en', label: 'English', icon: '🇬🇧', bcp47: 'en' },
  { code: 'zh-Hant', label: '繁體中文', icon: '🇭🇰', bcp47: 'zh-Hant' },
  { code: 'zh-Hans', label: '简体中文', icon: '🇨🇳', bcp47: 'zh-Hans' },
  { code: 'ja', label: '日本語', icon: '🇯🇵', bcp47: 'ja' },
  { code: 'ko', label: '한국어', icon: '🇰🇷', bcp47: 'ko' },
  { code: 'es', label: 'Español', icon: '🇪🇸', bcp47: 'es' },
  { code: 'fr', label: 'Français', icon: '🇫🇷', bcp47: 'fr' },
  { code: 'de', label: 'Deutsch', icon: '🇩🇪', bcp47: 'de' },
  { code: 'vi', label: 'Tiếng Việt', icon: '🇻🇳', bcp47: 'vi' },
  { code: 'id', label: 'Bahasa Indonesia', icon: '🇮🇩', bcp47: 'id' },
  { code: 'original', label: '原文 (粵/英)', icon: '🎙️', bcp47: 'zh' },
];

/**
 * Returns the best default subtitle language for a recording based on available VTT files.
 * Defaults to 'en' if present, then 'zh-Hant', 'zh-Hans', 'original', 'ja', or first available.
 * Returns 'off' if no subtitle tracks are present.
 */
export const getInitialSubtitleLang = (vttUrls) => {
  if (!vttUrls || typeof vttUrls !== 'object') return 'off';
  const keys = Object.keys(vttUrls);
  if (keys.length === 0) return 'off';

  if (vttUrls.en) return 'en';
  if (vttUrls['zh-Hant']) return 'zh-Hant';
  if (vttUrls['zh-Hans']) return 'zh-Hans';
  if (vttUrls.original) return 'original';
  if (vttUrls.ja) return 'ja';
  return keys[0];
};

/**
 * Formats a subtitle language code into a user-friendly label with emoji flag.
 */
export const getSubtitleLanguageLabel = (langCode) => {
  if (!langCode || langCode === 'off') return 'Off (關閉)';
  const found = SUBTITLE_LANGUAGES.find((l) => l.code === langCode);
  if (found) return `${found.icon} ${found.label}`;
  return langCode.toUpperCase();
};

/**
 * Determines whether a given TextTrack in HTML5 video matches the target language code.
 */
export const isTrackMatch = (track, targetLang) => {
  if (!track || !targetLang || targetLang === 'off') return false;
  const lang = (track.language || '').toLowerCase();
  const label = (track.label || '').toLowerCase();

  if (targetLang === 'en') {
    return lang.startsWith('en') || label.includes('english');
  }
  if (targetLang === 'zh-Hant') {
    return (
      lang === 'zh-hant' ||
      lang === 'zh-tw' ||
      lang === 'zh-hk' ||
      label.includes('traditional') ||
      label.includes('繁體')
    );
  }
  if (targetLang === 'zh-Hans') {
    return (
      lang === 'zh-hans' ||
      lang === 'zh-cn' ||
      label.includes('simplified') ||
      label.includes('简体')
    );
  }
  if (targetLang === 'ja') {
    return lang.startsWith('ja') || label.includes('japan') || label.includes('日本語');
  }
  if (targetLang === 'ko') {
    return lang.startsWith('ko') || label.includes('korean') || label.includes('한국어');
  }
  if (targetLang === 'es') {
    return lang.startsWith('es') || label.includes('spanish') || label.includes('español');
  }
  if (targetLang === 'fr') {
    return lang.startsWith('fr') || label.includes('french') || label.includes('français');
  }
  if (targetLang === 'de') {
    return lang.startsWith('de') || label.includes('german') || label.includes('deutsch');
  }
  if (targetLang === 'vi') {
    return lang.startsWith('vi') || label.includes('vietnamese') || label.includes('tiếng việt');
  }
  if (targetLang === 'id') {
    return lang.startsWith('id') || label.includes('indonesian') || label.includes('bahasa');
  }
  if (targetLang === 'original') {
    return (
      lang === 'original' ||
      lang === 'zh' ||
      lang === 'yue' ||
      lang === 'zh-yue' ||
      label.includes('original') ||
      label.includes('原文')
    );
  }
  return lang === targetLang.toLowerCase();
};

/**
 * Programmatically activates the specified subtitle language track on an HTML5 video element
 * while disabling all other tracks.
 */
export const applySubtitleTrack = (videoElement, targetLang, mode = 'showing') => {
  if (!videoElement || !videoElement.textTracks) return null;
  const tracks = videoElement.textTracks;
  let matchedTrack = null;

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    if (!targetLang || targetLang === 'off') {
      if (track.mode !== 'disabled') {
        track.mode = 'disabled';
      }
      continue;
    }

    if (isTrackMatch(track, targetLang)) {
      if (track.mode !== mode) {
        track.mode = mode;
      }
      matchedTrack = track;
    } else {
      if (track.mode !== 'disabled') {
        track.mode = 'disabled';
      }
    }
  }

  return matchedTrack;
};

/**
 * Detects the currently showing TextTrack and returns its normalized language code, or 'off'.
 */
export const getActiveSubtitleLang = (videoElement) => {
  if (!videoElement || !videoElement.textTracks) return 'off';
  const tracks = videoElement.textTracks;
  for (let i = 0; i < tracks.length; i++) {
    if (tracks[i].mode === 'showing') {
      for (const lang of SUBTITLE_LANGUAGES) {
        if (isTrackMatch(tracks[i], lang.code)) {
          return lang.code;
        }
      }
      return tracks[i].language || 'on';
    }
  }
  return 'off';
};

/**
 * Determines the optimal initial player mode ('youtube' | 'cloud' | 'drive').
 * Prioritizes 'cloud' over 'drive' when CC subtitles (vttUrls) exist, because Google Drive's
 * preview iframe does NOT support external WebVTT subtitle tracks.
 */
export const determineDefaultPlayerMode = (recording) => {
  if (!recording) return 'cloud';
  if (recording.youtubeVideoId) {
    return 'youtube';
  }
  const hasSubtitles =
    recording.vttUrls &&
    typeof recording.vttUrls === 'object' &&
    Object.keys(recording.vttUrls).length > 0;

  if (recording.videoUrl && hasSubtitles) {
    return 'cloud';
  }
  if (recording.driveFileId) {
    return 'drive';
  }
  return 'cloud';
};

/**
 * Detects if an HTML5 video element playing a WebM stream has a truncated or missing duration
 * due to missing EBML container headers, and probes the true duration by seeking near the end.
 *
 * An optional onComplete callback is invoked once the duration has been resolved and
 * video.currentTime is safely reset to 0 (or immediately if no seek was necessary).
 * This ensures external TextTracks (<track>) and subtitles are attached cleanly
 * without losing sync during the probe seek.
 *
 * @param {HTMLVideoElement} video
 * @param {number} expectedDurationInSeconds
 * @param {Function} [onComplete]
 */
export const fixWebmPlaybackDuration = (video, expectedDurationInSeconds = 0, onComplete) => {
  if (!video) return;

  const currentSrc = video.currentSrc || video.src || video.querySelector?.('source')?.src || 'current_video';
  if (video._webmFixedSrc && video._webmFixedSrc === currentSrc) {
    onComplete?.(video);
    return;
  }

  const expected = Number(expectedDurationInSeconds || 0);
  const current = video.duration;

  // Check if browser duration is missing or truncated:
  // 1. Infinity, NaN, or 0
  // 2. Or if we have a known duration (> 10s) and the browser's duration is significantly smaller
  //    (e.g., browser reports 45s because it only read the first cluster, while true duration is 2211s / ~36min)
  const isTruncated =
    !isFinite(current) ||
    isNaN(current) ||
    current === 0 ||
    (expected > 10 && current < expected - 10);

  if (!isTruncated) {
    video._webmFixedSrc = currentSrc;
    onComplete?.(video);
    return;
  }

  // Prevent multiple concurrent seeks or repeated runs on the same element
  if (video._isFixingWebmDuration) return;
  video._isFixingWebmDuration = true;

  // Guard: If user has already navigated or played beyond initial load (> 2s), do not disrupt playback
  if (video.currentTime > 2) {
    video._isFixingWebmDuration = false;
    video._webmFixedSrc = currentSrc;
    onComplete?.(video);
    return;
  }

  const prevMuted = video.muted;
  const prevTime = video.currentTime;
  const wasPlaying = !video.paused;

  // Temporarily mute to prevent audio glitches during probe seek
  video.muted = true;

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(safetyTimeout);
    video.removeEventListener('seeked', onEndSeeked);
    video.removeEventListener('error', onError);
    video.muted = prevMuted;
    video._isFixingWebmDuration = false;
    video._webmFixedSrc = currentSrc;
    onComplete?.(video);
  };

  const onError = () => {
    cleanup();
  };

  const onStartSeeked = () => {
    video.removeEventListener('seeked', onStartSeeked);
    cleanup();
    if (wasPlaying || video.autoplay) {
      video.play().catch(() => {});
    }
  };

  const onEndSeeked = () => {
    // End reached: duration is now known and updated by the browser demuxer
    video.removeEventListener('seeked', onEndSeeked);
    video.addEventListener('seeked', onStartSeeked, { once: true });
    // Seek back to start or previous position
    try {
      video.currentTime = (prevTime > 0 && prevTime < (video.duration || 1e101)) ? prevTime : 0;
    } catch (e) {
      cleanup();
    }
  };

  // Safety fallback in case network stalls (5 seconds)
  const safetyTimeout = setTimeout(() => {
    if (video.currentTime > 5) {
      try { video.currentTime = 0; } catch (e) {}
    }
    cleanup();
  }, 5000);

  video.addEventListener('seeked', onEndSeeked, { once: true });
  video.addEventListener('error', onError, { once: true });

  try {
    // Seeking to 1e101 forces Chromium's WebM demuxer to inspect the final cluster and discover true duration
    video.currentTime = 1e101;
  } catch (err) {
    cleanup();
  }
};

/**
 * Prevents premature video playback termination when Chrome fires the 'ended' event
 * early because of truncated WebM cluster duration headers.
 *
 * @param {Event} event
 * @param {number} expectedDurationInSeconds
 */
export const handleVideoEndedGuard = (event, expectedDurationInSeconds = 0) => {
  const video = event?.currentTarget;
  if (!video) return;

  // If currently running probe seek, do not interpret end as premature playback stop
  if (video._isFixingWebmDuration) return;

  const expected = Number(expectedDurationInSeconds || 0);
  const currentTime = video.currentTime || 0;

  // If the video stopped when it is significantly before the known lecture length:
  if (expected > 30 && currentTime < expected - 15) {
    console.warn(`[handleVideoEndedGuard] Premature video end at ${currentTime.toFixed(1)}s (expected ~${expected}s). Resuming playback...`);
    video.currentTime = currentTime + 0.1;
    video.play().catch((err) => {
      console.warn('[handleVideoEndedGuard] Could not auto-resume:', err);
    });
  }
};

/**
 * Parses a WebVTT timestamp (HH:MM:SS.mmm or MM:SS.mmm) into seconds as a float.
 */
export const parseVttTimestamp = (ts) => {
  if (!ts || typeof ts !== 'string') return NaN;
  const clean = ts.trim().split(/\s+/)[0]; // strip out cue positioning e.g. "align:start"
  const parts = clean.split(':');
  if (parts.length === 3) {
    const hrs = parseFloat(parts[0]);
    const mins = parseFloat(parts[1]);
    const secs = parseFloat(parts[2]);
    return hrs * 3600 + mins * 60 + secs;
  } else if (parts.length === 2) {
    const mins = parseFloat(parts[0]);
    const secs = parseFloat(parts[1]);
    return mins * 60 + secs;
  }
  return NaN;
};

/**
 * Parses raw WebVTT content into an array of cue objects: [{ start, end, text }].
 */
export const parseWebVTT = (vttText) => {
  if (!vttText || typeof vttText !== 'string') return [];
  const lines = vttText.split(/\r?\n/);
  const cues = [];
  let i = 0;

  // Find and parse cues
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.includes('-->')) {
      const arrowParts = line.split('-->');
      const start = parseVttTimestamp(arrowParts[0]);
      const end = parseVttTimestamp(arrowParts[1]);

      i++;
      const textLines = [];
      while (i < lines.length && lines[i].trim() !== '') {
        const textLine = lines[i].trim();
        if (!textLine.startsWith('NOTE')) {
          textLines.push(textLine);
        }
        i++;
      }

      if (!isNaN(start) && !isNaN(end) && textLines.length > 0) {
        cues.push({
          start,
          end,
          text: textLines.join('\n'),
        });
      }
    }
    i++;
  }

  return cues;
};

/**
 * Finds the active cue text for a given video playback timestamp in seconds.
 */
export const findActiveCue = (cues, currentTimeInSeconds) => {
  if (!Array.isArray(cues) || cues.length === 0 || typeof currentTimeInSeconds !== 'number') {
    return '';
  }
  const cue = cues.find(
    (c) => currentTimeInSeconds >= c.start - 0.05 && currentTimeInSeconds <= c.end + 0.05
  );
  return cue ? cue.text : '';
};

