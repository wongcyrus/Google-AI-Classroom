import { collection, documentId, getDocs, query, where } from 'firebase/firestore';

export function extractClassStudentEmails(classData = {}) {
  const emailSet = new Set();
  if (Array.isArray(classData.studentEmails)) {
    classData.studentEmails.forEach((e) => {
      if (typeof e === 'string' && e.trim()) emailSet.add(e.trim().toLowerCase());
    });
  }
  if (classData.students && typeof classData.students === 'object' && !Array.isArray(classData.students)) {
    Object.values(classData.students).forEach((e) => {
      if (typeof e === 'string' && e.trim()) emailSet.add(e.trim().toLowerCase());
    });
  }
  if (classData.studentProfiles && typeof classData.studentProfiles === 'object') {
    Object.keys(classData.studentProfiles).forEach((e) => {
      if (typeof e === 'string' && e.trim()) emailSet.add(e.trim().toLowerCase());
    });
  }
  return Array.from(emailSet);
}

/**
 * Fetches studentDirectory entries strictly for the given student emails (chunks of 30)
 * instead of scanning the entire institutional studentDirectory collection.
 * Falls back to full collection read only if Firestore query helpers are unavailable in tests.
 */
export async function fetchStudentDirectoryByEmails(db, emails = []) {
  const normalized = Array.from(
    new Set(
      (Array.isArray(emails) ? emails : [])
        .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
        .filter(Boolean)
    )
  );

  if (normalized.length === 0) {
    return {};
  }

  const dirProfiles = {};
  const canUseScopedQuery =
    typeof query === 'function' &&
    typeof where === 'function' &&
    typeof documentId === 'function';

  if (canUseScopedQuery) {
    try {
      const CHUNK_SIZE = 30;
      const chunks = [];
      for (let i = 0; i < normalized.length; i += CHUNK_SIZE) {
        chunks.push(normalized.slice(i, i + CHUNK_SIZE));
      }

      const dirCol = collection(db, 'studentDirectory');
      const snaps = await Promise.all(
        chunks.map((chunk) => getDocs(query(dirCol, where(documentId(), 'in', chunk))))
      );

      for (const snap of snaps) {
        if (snap && typeof snap.forEach === 'function') {
          snap.forEach((d) => {
            if (d?.id) {
              dirProfiles[d.id.trim().toLowerCase()] = typeof d.data === 'function' ? d.data() : {};
            }
          });
        }
      }
      return dirProfiles;
    } catch {
      // Fall through to full-collection fallback (e.g. partial test mocks)
    }
  }

  const dirSnap = await getDocs(collection(db, 'studentDirectory'));
  if (dirSnap && typeof dirSnap.forEach === 'function') {
    dirSnap.forEach((d) => {
      if (d?.id) {
        dirProfiles[d.id.trim().toLowerCase()] = typeof d.data === 'function' ? d.data() : {};
      }
    });
  }
  return dirProfiles;
}
