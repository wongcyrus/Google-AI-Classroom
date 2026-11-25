import { writeBatch } from 'firebase/firestore';

export const DEFAULT_FIRESTORE_BATCH_LIMIT = 450;

/**
 * Splits an array into chunks of at most `size` items.
 * @template T
 * @param {T[]} items
 * @param {number} [size=30]
 * @returns {T[][]}
 */
export function chunkArray(items = [], size = 30) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const safeSize = Math.max(1, Number(size) || 30);
  const chunks = [];
  for (let i = 0; i < items.length; i += safeSize) {
    chunks.push(items.slice(i, i + safeSize));
  }
  return chunks;
}

/**
 * Executes an arbitrary number of Firestore write operations across chunked writeBatch commits
 * so no single batch ever exceeds Firestore's 500-operation hard limit.
 *
 * Each operation object supports:
 *   { type: 'set' | 'update' | 'delete', ref: DocumentReference, data?: object, options?: object }
 * (defaults to type: 'set' if omitted).
 *
 * @param {import('firebase/firestore').Firestore} db
 * @param {Array<{ type?: 'set'|'update'|'delete', ref: any, data?: any, options?: any }>} ops
 * @param {number} [chunkSize=450]
 * @returns {Promise<number>} Number of committed operations
 */
export async function commitBatchChunks(db, ops = [], chunkSize = DEFAULT_FIRESTORE_BATCH_LIMIT) {
  if (!Array.isArray(ops) || ops.length === 0) {
    return 0;
  }

  const safeLimit = Math.min(499, Math.max(1, Number(chunkSize) || DEFAULT_FIRESTORE_BATCH_LIMIT));
  const chunks = chunkArray(ops, safeLimit);

  for (const chunk of chunks) {
    const batch = writeBatch(db);
    for (const op of chunk) {
      if (!op || !op.ref) continue;
      const opType = op.type || 'set';
      if (opType === 'delete') {
        batch.delete(op.ref);
      } else if (opType === 'update') {
        batch.update(op.ref, op.data);
      } else if (op.options !== undefined) {
        batch.set(op.ref, op.data, op.options);
      } else {
        batch.set(op.ref, op.data);
      }
    }
    await batch.commit();
  }

  return ops.length;
}
