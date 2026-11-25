/**
 * Shared Firebase/Firestore/Storage permanent error classifiers.
 * Kept separate from offlineBufferManager so offline-queue mocks never break error checks.
 */

export function isPermanentAuthOrRulesError(err) {
  if (!err) return false;
  const code = String(err.code || '').toLowerCase();
  const msg = String(err.message || '');
  return (
    code === 'permission-denied' ||
    code === 'unauthenticated' ||
    code === 'storage/unauthorized' ||
    code === 'storage/unauthenticated' ||
    /missing or insufficient permissions|permission[-_ ]denied|storage\/unauthorized|user is not authorized/i.test(msg)
  );
}
