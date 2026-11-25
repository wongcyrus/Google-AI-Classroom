import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isInternalPropertyKey, handleProcessPropertyUpload } from './index.mjs';

describe('property_processing isInternalPropertyKey', () => {
  it('identifies internal system and operational prefixes', () => {
    assert.equal(isInternalPropertyKey('activeBingo'), true);
    assert.equal(isInternalPropertyKey('pendingRetryBingo'), true);
    assert.equal(isInternalPropertyKey('retryDelayMinutes'), true);
    assert.equal(isInternalPropertyKey('lastRetryDispatchedAt'), true);
    assert.equal(isInternalPropertyKey('lastAttentionCheck'), true);
    assert.equal(isInternalPropertyKey('lastActivityTime'), true);
    assert.equal(isInternalPropertyKey('passkeyStatus'), true);
    assert.equal(isInternalPropertyKey('passkeyResetAt'), true);
    assert.equal(isInternalPropertyKey('presenceScore'), true);
  });

  it('identifies exact internal system keys', () => {
    assert.equal(isInternalPropertyKey('examReadiness'), true);
    assert.equal(isInternalPropertyKey('passkeyBypass'), true);
    assert.equal(isInternalPropertyKey('strikeNumber'), true);
    assert.equal(isInternalPropertyKey('bingoStats'), true);
    assert.equal(isInternalPropertyKey('retryCancelledReason'), true);
    assert.equal(isInternalPropertyKey('createdAt'), true);
    assert.equal(isInternalPropertyKey('updatedAt'), true);
    assert.equal(isInternalPropertyKey('status'), true);
  });

  it('identifies student roster profile metadata to protect it from deletion', () => {
    assert.equal(isInternalPropertyKey('studentName'), true);
    assert.equal(isInternalPropertyKey('nickname'), true);
    assert.equal(isInternalPropertyKey('programme'), true);
    assert.equal(isInternalPropertyKey('program'), true);
    assert.equal(isInternalPropertyKey('studentClass'), true);
    assert.equal(isInternalPropertyKey('cohort'), true);
    assert.equal(isInternalPropertyKey('studentEmail'), true);
    assert.equal(isInternalPropertyKey('email'), true);
  });

  it('allows valid custom student properties', () => {
    assert.equal(isInternalPropertyKey('Key'), false);
    assert.equal(isInternalPropertyKey('CheckMark'), false);
    assert.equal(isInternalPropertyKey('Group'), false);
    assert.equal(isInternalPropertyKey('DeskId'), false);
    assert.equal(isInternalPropertyKey('SpecialNeeds'), false);
    assert.equal(isInternalPropertyKey('ProjectTopic'), false);
    assert.equal(isInternalPropertyKey('SeatNumber'), false);
  });
});

describe('property_processing handleProcessPropertyUpload authorization', () => {
  const createDeps = ({ classExists = true, classData = {}, requesterRecord = null } = {}) => {
    const updates = [];
    const batchSets = [];
    const mockDb = {
      collection: (colName) => {
        if (colName === 'classes') {
          return {
            doc: () => ({
              get: async () => ({ exists: classExists, data: () => classData }),
              collection: () => ({
                get: async () => ({ forEach: () => {} }),
                doc: (uid) => ({ id: uid }),
              }),
            }),
          };
        }
        return {};
      },
      batch: () => ({
        set: (ref, data, opts) => batchSets.push({ ref, data, opts }),
        commit: async () => {},
      }),
    };
    const mockAuth = {
      getUser: async () => requesterRecord || { uid: 'unknown', email: 'unknown@stu.vtc.edu.hk', customClaims: {} },
      getUsers: async () => ({ users: [] }),
    };
    const mockLogger = { info: () => {}, warn: () => {}, error: () => {} };
    const makeEvent = (jobData) => ({
      params: { jobId: 'job_1' },
      data: {
        data: () => jobData,
        ref: { update: async (payload) => updates.push(payload) },
      },
    });
    return { mockDb, mockAuth, mockLogger, makeEvent, updates, batchSets };
  };

  it('fails job when requester is a student or unrelated teacher not assigned to class', async () => {
    const { mockDb, mockAuth, mockLogger, makeEvent, updates, batchSets } = createDeps({
      classData: { ownerUid: 'teacher_1', teacherEmails: ['teacher1@vtc.edu.hk'], students: { s1: 's1@stu.vtc.edu.hk' } },
      requesterRecord: { uid: 'other_teacher', email: 'other@vtc.edu.hk', customClaims: { role: 'teacher' } },
    });

    await handleProcessPropertyUpload(
      makeEvent({
        classId: 'c1',
        requesterUid: 'other_teacher',
        csvData: 'StudentEmail,Group\ns1@stu.vtc.edu.hk,A\n',
      }),
      { db: mockDb, auth: mockAuth, logger: mockLogger }
    );

    const finalUpdate = updates[updates.length - 1];
    assert.equal(finalUpdate.status, 'failed');
    assert.match(finalUpdate.error, /Unauthorized/);
    assert.equal(batchSets.length, 0);
  });

  it('fails job when classId or requesterUid is missing', async () => {
    const { mockDb, mockAuth, mockLogger, makeEvent, updates, batchSets } = createDeps();

    await handleProcessPropertyUpload(
      makeEvent({ classId: 'c1', csvData: 'StudentEmail,Group\ns1@stu.vtc.edu.hk,A\n' }),
      { db: mockDb, auth: mockAuth, logger: mockLogger }
    );

    const finalUpdate = updates[updates.length - 1];
    assert.equal(finalUpdate.status, 'failed');
    assert.match(finalUpdate.error, /requesterUid/);
    assert.equal(batchSets.length, 0);
  });

  it('processes upload cleanly when requester is assigned teacher on class document', async () => {
    const { mockDb, mockAuth, mockLogger, makeEvent, updates, batchSets } = createDeps({
      classData: { ownerUid: 'teacher_1', students: { s1: 's1@stu.vtc.edu.hk' } },
    });

    await handleProcessPropertyUpload(
      makeEvent({
        classId: 'c1',
        requesterUid: 'teacher_1',
        csvData: 'StudentEmail,Group\ns1@stu.vtc.edu.hk,GroupB\n',
      }),
      { db: mockDb, auth: mockAuth, logger: mockLogger }
    );

    const finalUpdate = updates[updates.length - 1];
    assert.equal(finalUpdate.status, 'completed');
    assert.equal(finalUpdate.processedCount, 1);
    assert.equal(batchSets.length, 1);
    assert.deepEqual(batchSets[0].data, { Group: 'GroupB' });
  });
});
