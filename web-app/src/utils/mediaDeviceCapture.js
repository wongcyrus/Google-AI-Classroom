function stopStream(stream) {
  stream?.getTracks?.().forEach(track => track.stop());
}

function getInputTrack(stream, kind) {
  const tracks = kind === 'audio'
    ? stream?.getAudioTracks?.()
    : stream?.getVideoTracks?.();
  return tracks?.[0] || null;
}

/**
 * Requests permission without a device constraint, then binds the selected input exactly.
 * This prevents an exact constraint from blocking Chrome's initial permission prompt while
 * ensuring an ideal constraint cannot silently substitute the default device.
 */
export async function acquireInputDeviceStream(kind, deviceId = '', trackConstraints = {}) {
  if (kind !== 'audio' && kind !== 'video') {
    throw new TypeError(`Unsupported media input kind: ${kind}`);
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(`${kind === 'audio' ? 'Microphone' : 'Webcam'} is not supported by this browser.`);
  }

  const permissionConstraints = {
    audio: kind === 'audio' ? { ...trackConstraints } : false,
    video: kind === 'video' ? { ...trackConstraints } : false,
  };
  const permissionStream = await navigator.mediaDevices.getUserMedia(permissionConstraints);

  if (!deviceId) {
    return permissionStream;
  }

  const permissionTrack = getInputTrack(permissionStream, kind);
  const actualDeviceId = permissionTrack?.getSettings?.().deviceId;
  if (actualDeviceId === deviceId) {
    return permissionStream;
  }

  try {
    const selectedStream = await navigator.mediaDevices.getUserMedia({
      audio: kind === 'audio'
        ? { ...trackConstraints, deviceId: { exact: deviceId } }
        : false,
      video: kind === 'video'
        ? { ...trackConstraints, deviceId: { exact: deviceId } }
        : false,
    });
    stopStream(permissionStream);
    return selectedStream;
  } catch (error) {
    stopStream(permissionStream);
    throw error;
  }
}

