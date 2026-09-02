const VOICE_AI_MODES = new Set([
  'hybrid',
  'client_only',
  'cloud_only',
  'disabled',
]);

export function normalizeVoiceAiMode(mode) {
  return VOICE_AI_MODES.has(mode) ? mode : 'hybrid';
}

export function allowsLocalVoiceAi(mode) {
  const normalizedMode = normalizeVoiceAiMode(mode);
  return normalizedMode === 'hybrid' || normalizedMode === 'client_only';
}

export function allowsCloudVoiceAi(mode) {
  const normalizedMode = normalizeVoiceAiMode(mode);
  return normalizedMode === 'hybrid' || normalizedMode === 'cloud_only';
}

export function shouldRunCloudVoiceFallback({
  mode,
  fallbackRate = 1,
  strideIndex,
  hasLocalTranscript,
  hasAudioUrl,
}) {
  if (!allowsCloudVoiceAi(mode) || hasLocalTranscript || !hasAudioUrl) {
    return false;
  }

  const cadence = Math.max(1, Number.parseInt(fallbackRate, 10) || 1);
  const chunkIndex = Number.parseInt(strideIndex, 10);
  return !Number.isFinite(chunkIndex) || chunkIndex % cadence === 0;
}
