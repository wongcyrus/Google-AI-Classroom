import React from 'react';

/**
 * Identifies internal system/operational keys that should not be displayed in student properties.
 * Excludes Bingo state machine fields, presence retries, and internal tracking metadata.
 */
export const isInternalPropertyKey = (key) => {
  if (!key || typeof key !== 'string') return true;
  const internalPrefixes = [
    'activeBingo',
    'pendingRetry',
    'priorMissed',
    'retryBingo',
    'retryDelay',
    'lastRetry',
    'lastBingo',
  ];
  if (internalPrefixes.some((prefix) => key === prefix || key.startsWith(prefix))) {
    return true;
  }
  if (key === 'strikeNumber' || key === 'bingoStats' || key === 'examReadiness') {
    return true;
  }
  return false;
};

/**
 * Formats a property value safely into a human-readable string or status badge.
 * Handles nested objects (like examReadiness), Firestore Timestamps, arrays, and booleans.
 */
export const formatPropertyValue = (key, value) => {
  if (value === null || value === undefined) return '—';

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'object') {
    // Special handling for Exam Readiness object
    if (key === 'examReadiness') {
      if (value.isReady) {
        return '✅ Verified (Ready)';
      }
      return '⚠️ Incomplete';
    }

    // Firestore Timestamp
    if (typeof value.toDate === 'function') {
      return value.toDate().toLocaleString();
    }
    if (typeof value.seconds === 'number') {
      return new Date(value.seconds * 1000).toLocaleString();
    }

    // Arrays
    if (Array.isArray(value)) {
      return value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ');
    }

    // Generic nested object
    try {
      const entries = Object.entries(value);
      if (entries.length === 0) return '{}';
      return entries
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(' | ');
    } catch {
      return JSON.stringify(value);
    }
  }

  return String(value);
};

const PropertiesWidget = ({ classProperties = {}, myProperties = {} }) => {
  const visibleClassProperties = Object.entries(classProperties || {}).filter(
    ([key]) => !isInternalPropertyKey(key)
  );
  const visibleMyProperties = Object.entries(myProperties || {}).filter(
    ([key]) => !isInternalPropertyKey(key)
  );

  return (
    <div className="properties-widget">
      <h2>Class Properties</h2>
      {visibleClassProperties.length > 0 ? (
        <div className="properties-list">
          {visibleClassProperties.map(([key, value]) => (
            <div key={key} className="property-item">
              <p className="property-key">{key}</p>
              <p className="property-value">{formatPropertyValue(key, value)}</p>
            </div>
          ))}
        </div>
      ) : (
        <p>No class-wide properties defined.</p>
      )}

      {visibleMyProperties.length > 0 && (
        <>
          <h2 style={{ marginTop: '20px' }}>My Properties</h2>
          <div className="properties-list">
            {visibleMyProperties.map(([key, value]) => (
              <div key={key} className="property-item">
                <p className="property-key">{key}</p>
                <p className="property-value">{formatPropertyValue(key, value)}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default PropertiesWidget;
