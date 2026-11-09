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

function createCancelledRequestError() {
  const err = new Error('Media device acquisition superseded by a newer request.');
  err.name = 'AbortError';
  err.isCancelledRequest = true;
  return err;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createCancelledRequestError();
  }
}

function isPermissionDeniedError(err) {
  return (
    err?.name === 'NotAllowedError' ||
    err?.name === 'PermissionDeniedError' ||
    (typeof err?.message === 'string' && /permission/i.test(err.message))
  );
}

function isDeviceBusyError(err) {
  if (err?.isCancelledRequest) return false;
  return (
    err?.name === 'NotReadableError' ||
    err?.name === 'TrackStartError' ||
    err?.name === 'AbortError' ||
    (typeof err?.message === 'string' && /could not start|device in use|busy/i.test(err.message))
  );
}

async function acquireSpecificDeviceStream(kind, targetDeviceId, trackConstraints = {}, signal = null) {
  throwIfAborted(signal);

  const tryGetUserMedia = async (constraints) => {
    throwIfAborted(signal);
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (signal?.aborted) {
      stopStream(stream);
      throw createCancelledRequestError();
    }
    const track = getInputTrack(stream, kind);
    const actualDeviceId = track?.getSettings?.().deviceId;
    if (
      actualDeviceId &&
      targetDeviceId &&
      targetDeviceId !== 'default' &&
      targetDeviceId !== '(default)' &&
      actualDeviceId !== targetDeviceId
    ) {
      stopStream(stream);
      throw new Error(`Device substitution rejected: requested "${targetDeviceId}" but received "${actualDeviceId}".`);
    }
    return stream;
  };

  const buildExactConstraints = (extraConstraints) => ({
    audio: kind === 'audio'
      ? { ...extraConstraints, deviceId: { exact: targetDeviceId } }
      : false,
    video: kind === 'video'
      ? { ...extraConstraints, deviceId: { exact: targetDeviceId } }
      : false,
  });

  try {
    return await tryGetUserMedia(buildExactConstraints(trackConstraints));
  } catch (exactErr) {
    if (exactErr?.isCancelledRequest || signal?.aborted || isPermissionDeniedError(exactErr)) {
      throw exactErr;
    }

    if (isDeviceBusyError(exactErr)) {
      // Hardware handle might still be releasing from a just-stopped stream; retry exact once after a brief delay
      const retryDelay = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test' ? 0 : 100;
      if (retryDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
      throwIfAborted(signal);
      return await tryGetUserMedia(buildExactConstraints(trackConstraints));
    }

    if (
      (exactErr?.name === 'OverconstrainedError' || exactErr?.name === 'ConstraintNotSatisfiedError') &&
      trackConstraints &&
      Object.keys(trackConstraints).length > 0
    ) {
      return await tryGetUserMedia(buildExactConstraints({}));
    }

    throw exactErr;
  }
}

async function acquireFirstAvailableFallbackDevice(kind, devices, excludedIds, trackConstraints = {}, signal = null) {
  for (const candidate of devices) {
    throwIfAborted(signal);
    const candidateId = candidate?.deviceId;
    if (!candidateId || candidateId === 'default' || candidateId === '(default)' || excludedIds.has(candidateId)) {
      continue;
    }
    excludedIds.add(candidateId);
    try {
      const stream = await acquireSpecificDeviceStream(kind, candidateId, trackConstraints, signal);
      storeDeviceIdentity(kind, candidate);
      return stream;
    } catch (candidateErr) {
      if (candidateErr?.isCancelledRequest || signal?.aborted || isPermissionDeniedError(candidateErr)) {
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
 * Requests permission without a device constraint when needed, then binds the selected input exactly.
 * When a video camera is explicitly selected (preferDirectDevice or permission already granted with labels),
 * binds the target camera directly so a busy default camera is never probed first.
 */
export async function acquireInputDeviceStream(kind, deviceId = '', trackConstraints = {}, options = {}) {
  if (kind !== 'audio' && kind !== 'video') {
    throw new TypeError(`Unsupported media input kind: ${kind}`);
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(`${kind === 'audio' ? 'Microphone' : 'Webcam'} is not supported by this browser.`);
  }

  const {
    signal = null,
    preferDirectDevice = false,
    allowFallback = true,
  } = options || {};

  throwIfAborted(signal);

  const hasExplicitDeviceId = Boolean(deviceId && deviceId !== 'default' && deviceId !== '(default)');
  const permissionConstraints = {
    audio: kind === 'audio' ? { ...trackConstraints } : false,
    video: kind === 'video' ? { ...trackConstraints } : false,
  };
  const devicesBeforePermission = deviceId ? await listInputDevices(kind) : [];
  throwIfAborted(signal);

  const hasKnownPrePermissionLabels = devicesBeforePermission.some(d => Boolean(d.label));
  const canBindVideoDirectly =
    kind === 'video' &&
    hasExplicitDeviceId &&
    (Boolean(preferDirectDevice) ||
      devicesBeforePermission.some(d => d.deviceId === deviceId && Boolean(d.label)));

  if (canBindVideoDirectly) {
    try {
      const directStream = await acquireSpecificDeviceStream(kind, deviceId, trackConstraints, signal);
      storeDeviceIdentity(
        kind,
        devicesBeforePermission.find(device => device.deviceId === deviceId) || { deviceId }
      );
      return directStream;
    } catch (directErr) {
      if (directErr?.isCancelledRequest || signal?.aborted || isPermissionDeniedError(directErr)) {
        throw directErr;
      }

      const isUnlabeledPrePermissionRotation =
        !hasKnownPrePermissionLabels &&
        (directErr?.name === 'OverconstrainedError' || directErr?.name === 'ConstraintNotSatisfiedError');

      if (!isUnlabeledPrePermissionRotation) {
        if (allowFallback) {
          console.warn(
            `[mediaDeviceCapture] Direct ${kind} binding for "${deviceId}" failed (${directErr?.name || 'Error'}: ${directErr?.message || 'device busy'}); trying fallback devices...`
          );
          const currentDevices = await listInputDevices(kind);
          const candidatePool = currentDevices.length > 0 ? currentDevices : devicesBeforePermission;
          const fallbackStream = await acquireFirstAvailableFallbackDevice(
            kind,
            candidatePool,
            new Set([deviceId]),
            trackConstraints,
            signal
          );
          if (fallbackStream) {
            return fallbackStream;
          }
        }
        throw directErr;
      }
    }
  }

  let permissionStream = null;
  let permissionError = null;

  try {
    throwIfAborted(signal);
    permissionStream = await navigator.mediaDevices.getUserMedia(permissionConstraints);
    if (signal?.aborted) {
      stopStream(permissionStream);
      throw createCancelledRequestError();
    }
  } catch (err) {
    if (err?.isCancelledRequest || signal?.aborted || isPermissionDeniedError(err)) {
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
    if (allowFallback) {
      const devicesAfterFail = await listInputDevices(kind);
      const fallbackStream = await acquireFirstAvailableFallbackDevice(
        kind,
        devicesAfterFail,
        new Set(),
        trackConstraints,
        signal
      );
      if (fallbackStream) {
        return fallbackStream;
      }
    }
    throw permissionError || new Error(`Unable to start ${kind} stream.`);
  }

  const devicesAfterPermission = await listInputDevices(kind);
  throwIfAborted(signal);
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
    const selectedStream = await acquireSpecificDeviceStream(kind, resolvedDeviceId, trackConstraints, signal);
    storeDeviceIdentity(
      kind,
      devicesAfterPermission.find(device => device.deviceId === resolvedDeviceId)
    );
    return selectedStream;
  } catch (targetErr) {
    if (targetErr?.isCancelledRequest || signal?.aborted || isPermissionDeniedError(targetErr)) {
      throw targetErr;
    }
    if (allowFallback) {
      console.warn(
        `[mediaDeviceCapture] Selected ${kind} device "${resolvedDeviceId}" failed (${targetErr?.name || 'Error'}); trying remaining available devices...`
      );
      const fallbackStream = await acquireFirstAvailableFallbackDevice(
        kind,
        devicesAfterPermission,
        new Set([resolvedDeviceId, deviceId]),
        trackConstraints,
        signal
      );
      if (fallbackStream) {
        return fallbackStream;
      }
    }
    throw targetErr || permissionError;
  }
}
