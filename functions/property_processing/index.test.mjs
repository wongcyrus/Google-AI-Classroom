import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isInternalPropertyKey } from './index.mjs';

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
