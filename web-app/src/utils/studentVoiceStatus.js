export function getStudentVoiceStatus(status) {
  return {
    liveTranscript: status?.liveTranscript || '',
    liveTranscriptTimestamp: status?.liveTranscriptTimestamp || null,
    speechLanguage: status?.speechLanguage || '',
    gemmaAlert: status?.gemmaAlert || null,
    gemmaSeverity: status?.gemmaSeverity || null,
    gemmaConfidence: status?.gemmaConfidence ?? null,
  };
}
