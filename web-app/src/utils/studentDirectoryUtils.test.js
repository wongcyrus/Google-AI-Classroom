import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDocs, query, where, documentId } from 'firebase/firestore';
import { extractClassStudentEmails, fetchStudentDirectoryByEmails } from './studentDirectoryUtils';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ path: name })),
  documentId: vi.fn(() => '__name__'),
  where: vi.fn((field, op, val) => ({ field, op, val })),
  query: vi.fn((col, ...constraints) => ({ col, constraints })),
  getDocs: vi.fn(),
}));

describe('studentDirectoryUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extractClassStudentEmails deduplicates and normalizes emails from all class fields', () => {
    const emails = extractClassStudentEmails({
      studentEmails: [' Alice@stu.vtc.edu.hk ', 'bob@stu.vtc.edu.hk'],
      students: { u1: 'alice@stu.vtc.edu.hk', u2: 'carol@stu.vtc.edu.hk' },
      studentProfiles: { 'BOB@stu.vtc.edu.hk': { studentName: 'Bob' } },
    });
    expect(emails).toEqual([
      'alice@stu.vtc.edu.hk',
      'bob@stu.vtc.edu.hk',
      'carol@stu.vtc.edu.hk',
    ]);
  });

  it('returns empty object with zero Firestore reads when emails list is empty', async () => {
    const res = await fetchStudentDirectoryByEmails({}, []);
    expect(res).toEqual({});
    expect(getDocs).not.toHaveBeenCalled();
  });

  it('chunks queries into batches of 30 using documentId() in', async () => {
    const emails = Array.from({ length: 35 }, (_, i) => `s${i}@stu.vtc.edu.hk`);
    getDocs.mockResolvedValue({
      forEach: (cb) => {
        cb({ id: 's0@stu.vtc.edu.hk', data: () => ({ studentName: 'Student 0' }) });
      },
    });

    const res = await fetchStudentDirectoryByEmails({}, emails);
    expect(documentId).toHaveBeenCalled();
    expect(where).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledTimes(2);
    expect(getDocs).toHaveBeenCalledTimes(2);
    expect(res['s0@stu.vtc.edu.hk']).toEqual({ studentName: 'Student 0' });
  });
});
