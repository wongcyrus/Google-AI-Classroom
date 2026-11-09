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

const warnedMissingDevices = new Set();

export function resetWarnedMissingDevices() {
  warnedMissingDevices.clear();
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

function isPermissionDeniedError(err) {
  return (
    err?.name === 'NotAllowedError' ||
    err?.name === 'PermissionDeniedError' ||
    (typeof err?.message === 'string' && /permission/i.test(err.message))
  );
}

function isDeviceBusyError(err) {
  return (
    err?.name === 'NotReadableError' ||
    err?.name === 'TrackStartError' ||
    err?.name === 'AbortError' ||
    (typeof err?.message === 'string' && /could not start|device in use|busy/i.test(err.message))
  );
}

async function acquireSpecificDeviceStream(kind, targetDeviceId, trackConstraints = {}) {
  const tryGetUserMedia = async (constraints) => {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const track = getInputTrack(stream, kind);
    const actualDeviceId = track?.getSettings?.().deviceId;
    // Reject silent device substitution: if a specific device was requested, ensure
    // the browser did not silently fall back to an unintended device (such as the default camera in use by OBS).
    if (actualDeviceId && targetDeviceId && targetDeviceId !== 'default' && targetDeviceId !== '(default)' && actualDeviceId !== targetDeviceId) {
      stopStream(stream);
      throw new Error(`Device substitution rejected: requested "${targetDeviceId}" but received "${actualDeviceId}".`);
    }
    return stream;
  };

  try {
    return await tryGetUserMedia({
      audio: kind === 'audio'
        ? { ...trackConstraints, deviceId: { exact: targetDeviceId } }
        : false,
      video: kind === 'video'
        ? { ...trackConstraints, deviceId: { exact: targetDeviceId } }
        : false,
    });
  } catch (exactErr) {
    if (isPermissionDeniedError(exactErr)) {
      throw exactErr;
    }
    if (isDeviceBusyError(exactErr)) {
      // Hardware handle might still be releasing; retry once after a short grace period
      const retryDelay = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test' ? 0 : 120;
      if (retryDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
      try {
        return await tryGetUserMedia({
          audio: kind === 'audio'
            ? { ...trackConstraints, deviceId: { exact: targetDeviceId } }
            : false,
          video: kind === 'video'
            ? { ...trackConstraints, deviceId: { exact: targetDeviceId } }
            : false,
        });
      } catch (retryExactErr) {
        if (isPermissionDeniedError(retryExactErr)) throw retryExactErr;
      }
    }

    console.warn(`[mediaDeviceCapture] Exact ${kind} constraint failed on device; retrying with direct deviceId:`, exactErr);
    try {
      return await tryGetUserMedia({
        audio: kind === 'audio'
          ? { ...trackConstraints, deviceId: targetDeviceId }
          : false,
        video: kind === 'video'
          ? { ...trackConstraints, deviceId: targetDeviceId }
          : false,
      });
    } catch (directErr) {
      if (isPermissionDeniedError(directErr)) {
        throw directErr;
      }
      console.warn(`[mediaDeviceCapture] Direct ${kind} constraint failed; retrying with ideal constraint:`, directErr);
      return await tryGetUserMedia({
        audio: kind === 'audio'
          ? { ...trackConstraints, deviceId: { ideal: targetDeviceId } }
          : false,
        video: kind === 'video'
          ? { ...trackConstraints, deviceId: { ideal: targetDeviceId } }
          : false,
      });
    }
  }
}

async function acquireFirstAvailableFallbackDevice(kind, devices, excludedIds, trackConstraints = {}) {
  for (const candidate of devices) {
    const candidateId = candidate?.deviceId;
    if (!candidateId || candidateId === 'default' || candidateId === '(default)' || excludedIds.has(candidateId)) {
      continue;
    }
    excludedIds.add(candidateId);
    try {
      const stream = await acquireSpecificDeviceStream(kind, candidateId, trackConstraints);
      storeDeviceIdentity(kind, candidate);
      return stream;
    } catch (candidateErr) {
      if (isPermissionDeniedError(candidateErr)) {
        throw candidateErr;
      }
      console.warn(
        `[mediaDeviceCapture] Fallback ${kind} device "${candidate.label || candidateId}" unavailable:`,
        candidateErr
      );
    }
  }
  return null;
}

/**
 * Requests permission without a device constraint, then binds the selected input exactly.
 * This prevents an exact constraint from blocking Chrome's initial permission prompt while
 * ensuring an ideal constraint cannot silently substitute the default device.
 * If the default device is locked/in-use by another application (e.g. OBS), gracefully
 * bypasses the locked default device and binds the requested or next available device.
 */
export async function acquireInputDeviceStream(kind, deviceId = '', trackConstraints = {}) {
  if (kind !== 'audio' && kind !== 'video') {
    throw new TypeError(`Unsupported media input kind: ${kind}`);
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(`${kind === 'audio' ? 'Microphone' : 'Webcam'} is not supported by this browser.`);
  }

  const hasExplicitDeviceId = Boolean(deviceId && deviceId !== 'default' && deviceId !== '(default)');
  const permissionConstraints = {
    audio: kind === 'audio' ? { ...trackConstraints } : false,
    video: kind === 'video' ? { ...trackConstraints } : false,
  };
  const devicesBeforePermission = deviceId ? await listInputDevices(kind) : [];

  let permissionStream = null;
  let permissionError = null;

  try {
    permissionStream = await navigator.mediaDevices.getUserMedia(permissionConstraints);
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      throw err;
    }
    permissionError = err;
    console.warn(
      `[mediaDeviceCapture] Generic ${kind} stream could not be opened (${err?.name || 'Error'}: ${err?.message || 'device busy'}); attempting target or fallback device...`
    );
  }

  if (!hasExplicitDeviceId) {
    if (permissionStream) {
      return permissionStream;
    }
    const devicesAfterFail = await listInputDevices(kind);
    const fallbackStream = await acquireFirstAvailableFallbackDevice(
      kind,
      devicesAfterFail,
      new Set(),
      trackConstraints
    );
    if (fallbackStream) {
      return fallbackStream;
    }
    throw permissionError || new Error(`Unable to start ${kind} stream.`);
  }

  const devicesAfterPermission = await listInputDevices(kind);
  const storedIdentity = readStoredDeviceIdentity(kind, deviceId);
  const resolvedDeviceId = resolveDeviceId(
    deviceId,
    devicesBeforePermission,
    devicesAfterPermission,
    storedIdentity
  );

  if (permissionStream) {
    const permissionTrack = getInputTrack(permissionStream, kind);
    const actualDeviceId = permissionTrack?.getSettings?.().deviceId;
    if (
      actualDeviceId === resolvedDeviceId ||
      resolvedDeviceId === 'default' ||
      resolvedDeviceId === '(default)' ||
      (!actualDeviceId && devicesAfterPermission.length === 1)
    ) {
      storeDeviceIdentity(
        kind,
        devicesAfterPermission.find(device => device.deviceId === resolvedDeviceId) ||
          devicesAfterPermission[0]
      );
      return permissionStream;
    }
    if (
      devicesAfterPermission.length > 0 &&
      !devicesAfterPermission.some(device => device.deviceId === resolvedDeviceId)
    ) {
      const fallbackDevice =
        devicesAfterPermission.find(device => device.deviceId === actualDeviceId) ||
        devicesAfterPermission[0];
      if (fallbackDevice) {
        storeDeviceIdentity(kind, fallbackDevice);
      }
      const warnKey = `${kind}:${resolvedDeviceId}`;
      if (!warnedMissingDevices.has(warnKey)) {
        warnedMissingDevices.add(warnKey);
        console.warn(
          `[mediaDeviceCapture] Selected ${kind} device is no longer available; using the current default device.`
        );
      }
      return permissionStream;
    }

    // Some camera/mobile audio drivers cannot open a second device while the permission stream is active.
    stopStream(permissionStream);
    // Yield thread for hardware media drivers (e.g. Linux V4L2 and macOS AVFoundation) to release hardware handles
    const releaseDelay = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test' ? 0 : 60;
    if (releaseDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, releaseDelay));
    }
  }

  try {
    const selectedStream = await acquireSpecificDeviceStream(kind, resolvedDeviceId, trackConstraints);
    storeDeviceIdentity(
      kind,
      devicesAfterPermission.find(device => device.deviceId === resolvedDeviceId)
    );
    return selectedStream;
  } catch (targetErr) {
    if (isPermissionDeniedError(targetErr)) {
      throw targetErr;
    }
    console.warn(
      `[mediaDeviceCapture] Selected ${kind} device "${resolvedDeviceId}" failed (${targetErr?.name || 'Error'}); trying remaining available devices...`
    );
    const fallbackStream = await acquireFirstAvailableFallbackDevice(
      kind,
      devicesAfterPermission,
      new Set([resolvedDeviceId, deviceId]),
      trackConstraints
    );
    if (fallbackStream) {
      return fallbackStream;
    }
    throw targetErr || permissionError;
  }
}

