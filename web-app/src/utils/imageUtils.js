/**
 * Calculates constrained dimensions capped at a maximum width while maintaining aspect ratio
 * and ensuring both dimensions are even numbers (required for H.264 video encoding).
 */
export const calculateConstrainedDimensions = (width, height, maxWidth = 1920) => {
  if (!width || !height || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  let targetWidth = width;
  let targetHeight = height;

  if (targetWidth > maxWidth) {
    targetHeight = Math.round((targetHeight * maxWidth) / targetWidth);
    targetWidth = maxWidth;
  }

  // Ensure dimensions are even
  if (targetWidth % 2 !== 0) targetWidth--;
  if (targetHeight % 2 !== 0) targetHeight--;

  return { width: targetWidth, height: targetHeight };
};

/**
 * Calculates geometric downscale factor when an image exceeds max size bytes.
 */
export const calculateDownscaleFactor = (blobSize, maxSizeBytes) => {
  if (!blobSize || !maxSizeBytes || blobSize <= maxSizeBytes) {
    return 1.0;
  }
  return Math.sqrt(maxSizeBytes / blobSize) * 0.9;
};

/**
 * Calculates expiration timestamp from retention days.
 */
export const calculateExpirationDate = (retentionDays, fromDate = new Date()) => {
  const days = Number(retentionDays) || 30;
  return new Date(fromDate.getTime() + days * 24 * 60 * 60 * 1000);
};
