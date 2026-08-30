/**
 * Transcript Merger and Overlap Reconciliation Utility
 * Merges successive overlapping audio transcripts (from a sliding/moving window)
 * into a single unified, chronological dialogue stream with zero repetition.
 */

/**
 * Normalizes text for comparison.
 */
export function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Converts formatted timestamp string "MM:SS" or "HH:MM:SS" to total seconds.
 */
export function timeStringToSeconds(timeStr) {
  if (typeof timeStr === 'number') return timeStr;
  if (!timeStr) return 0;

  const parts = timeStr.split(':').map(p => parseFloat(p) || 0);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parseFloat(timeStr) || 0;
}

/**
 * Formats seconds into "MM:SS" format.
 */
export function secondsToTimeString(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(mins)}:${pad(secs)}`;
}

/**
 * Merges a new overlapping transcript segment array into an existing session transcript.
 * Deduplicates overlapping dialogue turns based on absolute session timestamps and text similarity.
 *
 * @param {Array} existingSegments Array of existing dialogue turns: [{ startTime, endTime, speaker, text, absoluteStartSec }]
 * @param {Array} newSegments Array of new turns from current moving window: [{ startTime, endTime, speaker, text }]
 * @param {number} windowStartSec Absolute start time of the new window in seconds.
 * @param {number} strideSec The sliding stride duration in seconds (e.g. 15s).
 * @returns {Array} Updated consolidated dialogue turn array.
 */
export function mergeSlidingTranscripts(existingSegments = [], newSegments = [], windowStartSec = 0, strideSec = 15) {
  if (!newSegments || newSegments.length === 0) {
    return [...existingSegments];
  }

  // 1. Convert new segment relative times to absolute session seconds
  const preparedNewSegments = newSegments.map((seg, idx) => {
    const relStart = timeStringToSeconds(seg.startTime);
    const relEnd = timeStringToSeconds(seg.endTime);
    const absStart = windowStartSec + relStart;
    const absEnd = windowStartSec + relEnd;

    return {
      ...seg,
      id: seg.id || `turn_${Math.round(absStart * 1000)}_${idx}`,
      absoluteStartSec: absStart,
      absoluteEndSec: absEnd,
      displayStart: secondsToTimeString(absStart),
      displayEnd: secondsToTimeString(absEnd),
    };
  });

  if (existingSegments.length === 0) {
    return preparedNewSegments;
  }

  const merged = [...existingSegments];

  // 2. Determine boundary threshold: segments in existing list prior to windowStartSec are fully locked
  for (const newSeg of preparedNewSegments) {
    // Check if an existing segment in the overlap zone (within 3 seconds) has high text overlap
    const normNewText = normalizeText(newSeg.text);
    if (!normNewText) continue;

    const duplicateIndex = merged.findIndex((existSeg) => {
      const timeDiff = Math.abs(existSeg.absoluteStartSec - newSeg.absoluteStartSec);
      if (timeDiff > 4.0) return false;

      const normExistText = normalizeText(existSeg.text);
      return (
        normExistText === normNewText ||
        normExistText.includes(normNewText) ||
        normNewText.includes(normExistText)
      );
    });

    if (duplicateIndex !== -1) {
      // If the new segment has longer/more complete text (healed boundary cut), replace it
      if (newSeg.text.length > merged[duplicateIndex].text.length) {
        merged[duplicateIndex] = {
          ...merged[duplicateIndex],
          text: newSeg.text,
          absoluteEndSec: Math.max(merged[duplicateIndex].absoluteEndSec, newSeg.absoluteEndSec),
          displayEnd: secondsToTimeString(Math.max(merged[duplicateIndex].absoluteEndSec, newSeg.absoluteEndSec)),
        };
      }
    } else {
      // Insert in chronological order
      const insertIndex = merged.findIndex(s => s.absoluteStartSec > newSeg.absoluteStartSec);
      if (insertIndex === -1) {
        merged.push(newSeg);
      } else {
        merged.splice(insertIndex, 0, newSeg);
      }
    }
  }

  return merged;
}
