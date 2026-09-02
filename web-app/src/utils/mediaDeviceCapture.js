function stopStream(stream) {
  stream?.getTracks?.().forEach(track => track.stop());
}

function getInputTrack(stream, kind) {
  const tracks = kind === 'audio'
    ? stream?.getAudioTracks?.()
    : stream?.getVideoTracks?.();
  return tracks?.[0] || null;
}

async function listInputDevices(kind) {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputKind = kind === 'audio' ? 'audioinput' : 'videoinput';
    return devices.filter(device => device.kind === inputKind);
  } catch {
    return [];
  }
}

function getIdentityStorageKey(kind) {
  return `preferred_${kind}_input_identity`;
}

function readStoredDeviceIdentity(kind, deviceId) {
  try {
    const stored = JSON.parse(localStorage.getItem(getIdentityStorageKey(kind)) || 'null');
    return stored?.deviceId === deviceId ? stored : null;
  } catch {
    return null;
  }
}

function storeDeviceIdentity(kind, device) {
  if (!device?.deviceId) return;
  try {
    localStorage.setItem(getIdentityStorageKey(kind), JSON.stringify({
      deviceId: device.deviceId,
      groupId: device.groupId || '',
      label: device.label || '',
    }));
  } catch {
    // Device capture still works when storage is unavailable.
  }
}

function resolveDeviceId(deviceId, beforePermission, afterPermission, storedIdentity) {
  if (afterPermission.some(device => device.deviceId === deviceId)) {
    return deviceId;
  }

  const previousDevice =
    beforePermission.find(device => device.deviceId === deviceId) ||
    storedIdentity;
  if (!previousDevice) return deviceId;

  const matchingDevice = afterPermission.find(device =>
    (previousDevice.groupId && device.groupId === previousDevice.groupId) ||
    (previousDevice.label && device.label === previousDevice.label)
  );
  return matchingDevice?.deviceId || deviceId;
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
  const devicesBeforePermission = deviceId ? await listInputDevices(kind) : [];
  const permissionStream = await navigator.mediaDevices.getUserMedia(permissionConstraints);

  if (!deviceId) {
    return permissionStream;
  }

  const devicesAfterPermission = await listInputDevices(kind);
  const storedIdentity = readStoredDeviceIdentity(kind, deviceId);
  const resolvedDeviceId = resolveDeviceId(
    deviceId,
    devicesBeforePermission,
    devicesAfterPermission,
    storedIdentity
  );
  const permissionTrack = getInputTrack(permissionStream, kind);
  const actualDeviceId = permissionTrack?.getSettings?.().deviceId;
  if (actualDeviceId === resolvedDeviceId) {
    storeDeviceIdentity(
      kind,
      devicesAfterPermission.find(device => device.deviceId === resolvedDeviceId)
    );
    return permissionStream;
  }
  if (
    devicesAfterPermission.length > 0 &&
    !devicesAfterPermission.some(device => device.deviceId === resolvedDeviceId)
  ) {
    console.warn(
      `[mediaDeviceCapture] Selected ${kind} device is no longer available; using the current default device.`
    );
    return permissionStream;
  }

  // Some camera drivers cannot open a second device while the permission stream is active.
  stopStream(permissionStream);
  const selectedStream = await navigator.mediaDevices.getUserMedia({
    audio: kind === 'audio'
      ? { ...trackConstraints, deviceId: { exact: resolvedDeviceId } }
      : false,
    video: kind === 'video'
      ? { ...trackConstraints, deviceId: { exact: resolvedDeviceId } }
      : false,
  });
  storeDeviceIdentity(
    kind,
    devicesAfterPermission.find(device => device.deviceId === resolvedDeviceId)
  );
  return selectedStream;
}
