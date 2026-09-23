import { describe, it, expect } from 'vitest';
import {
  canStartTask,
  calculateRemainingTime,
  formatRemainingTime,
  resolveEffectiveScore,
} from './taskConstraintUtils';

describe('taskConstraintUtils', () => {
  describe('canStartTask', () => {
    const baseTask = {
      id: 'task_1',
      status: 'published',
      constraints: {
        timing: {
          availableFrom: new Date('2026-09-20T00:00:00Z'),
          deadline: new Date('2026-09-25T23:59:59Z'),
          timeLimitMinutes: 45,
          latePolicy: 'strictly_closed',
        },
        attempts: {
          maxAttempts: 2,
          retryCooldownMinutes: 15,
        },
      },
    };

    it('returns false if task not found', () => {
      const res = canStartTask(null, null);
      expect(res.allowed).toBe(false);
      expect(res.code).toBe('TASK_NOT_FOUND');
    });

    it('returns false if task is in draft mode', () => {
      const res = canStartTask({ ...baseTask, status: 'draft' }, null);
      expect(res.allowed).toBe(false);
      expect(res.code).toBe('TASK_DRAFT');
    });

    it('returns false if task is closed', () => {
      const res = canStartTask({ ...baseTask, status: 'closed' }, null);
      expect(res.allowed).toBe(false);
      expect(res.code).toBe('TASK_CLOSED');
    });

    it('returns false if before availableFrom', () => {
      const beforeNow = new Date('2026-09-19T12:00:00Z');
      const res = canStartTask(baseTask, null, beforeNow);
      expect(res.allowed).toBe(false);
      expect(res.code).toBe('NOT_YET_AVAILABLE');
    });

    it('allows resuming an in-progress attempt', () => {
      const now = new Date('2026-09-21T10:00:00Z');
      const sub = {
        status: 'in_progress',
        activeAttempt: { attemptNumber: 1, startedAt: now },
      };
      const res = canStartTask(baseTask, sub, now);
      expect(res.allowed).toBe(true);
      expect(res.isResume).toBe(true);
    });

    it('returns false if after deadline and late policy is strictly closed', () => {
      const afterDeadline = new Date('2026-09-26T10:00:00Z');
      const res = canStartTask(baseTask, null, afterDeadline);
      expect(res.allowed).toBe(false);
      expect(res.code).toBe('DEADLINE_PASSED');
    });

    it('allows starting after deadline if latePolicy is allow_with_flag', () => {
      const lateTask = {
        ...baseTask,
        constraints: {
          ...baseTask.constraints,
          timing: {
            ...baseTask.constraints.timing,
            latePolicy: 'allow_with_flag',
          },
        },
      };
      const afterDeadline = new Date('2026-09-26T10:00:00Z');
      const res = canStartTask(lateTask, null, afterDeadline);
      expect(res.allowed).toBe(true);
    });

    it('returns false if max attempts exhausted', () => {
      const now = new Date('2026-09-21T10:00:00Z');
      const sub = { attemptsCount: 2 };
      const res = canStartTask(baseTask, sub, now);
      expect(res.allowed).toBe(false);
      expect(res.code).toBe('MAX_ATTEMPTS_EXHAUSTED');
    });

    it('returns false if retry cooldown period is active', () => {
      const now = new Date('2026-09-21T10:05:00Z');
      const sub = {
        attemptsCount: 1,
        lastSubmittedAt: new Date('2026-09-21T10:00:00Z'), // 5 mins ago, cooldown is 15 mins
      };
      const res = canStartTask(baseTask, sub, now);
      expect(res.allowed).toBe(false);
      expect(res.code).toBe('COOLDOWN_ACTIVE');
    });

    it('allows starting if within window, attempts remain, and cooldown passed', () => {
      const now = new Date('2026-09-21T10:20:00Z');
      const sub = {
        attemptsCount: 1,
        lastSubmittedAt: new Date('2026-09-21T10:00:00Z'), // 20 mins ago
      };
      const res = canStartTask(baseTask, sub, now);
      expect(res.allowed).toBe(true);
      expect(res.code).toBe('CAN_START');
    });
  });

  describe('calculateRemainingTime and formatRemainingTime', () => {
    it('handles unlimited or null time limits', () => {
      const res = calculateRemainingTime({ startedAt: new Date() }, 0);
      expect(res.remainingSeconds).toBe(Infinity);
      expect(res.isExpired).toBe(false);
    });

    it('calculates remaining seconds accurately', () => {
      const startedAt = new Date('2026-09-21T10:00:00Z');
      const now = new Date('2026-09-21T10:15:00Z'); // 15 mins passed of 45 mins
      const res = calculateRemainingTime({ startedAt }, 45, now);
      expect(res.remainingSeconds).toBe(30 * 60);
      expect(res.isExpired).toBe(false);
      expect(res.percentageUsed).toBe(33);
      expect(formatRemainingTime(res.remainingSeconds)).toBe('30:00');
    });

    it('detects expiration when time passes limit', () => {
      const startedAt = new Date('2026-09-21T10:00:00Z');
      const now = new Date('2026-09-21T10:50:00Z'); // 50 mins passed of 45 mins
      const res = calculateRemainingTime({ startedAt }, 45, now);
      expect(res.remainingSeconds).toBe(0);
      expect(res.isExpired).toBe(true);
      expect(formatRemainingTime(res.remainingSeconds)).toBe('00:00');
    });

    it('formats hours properly', () => {
      expect(formatRemainingTime(3665)).toBe('01:01:05');
    });
  });

  describe('resolveEffectiveScore', () => {
    const attempts = [
      { attemptNumber: 1, evaluation: { finalScore: 60 } },
      { attemptNumber: 2, evaluation: { finalScore: 90 } },
      { attemptNumber: 3, evaluation: { finalScore: 75 } },
    ];

    it('resolves highest score by default', () => {
      const res = resolveEffectiveScore(attempts, 'highest');
      expect(res.effectiveScore).toBe(90);
      expect(res.chosenAttempt.attemptNumber).toBe(2);
    });

    it('resolves latest score when strategy is latest', () => {
      const res = resolveEffectiveScore(attempts, 'latest');
      expect(res.effectiveScore).toBe(75);
      expect(res.chosenAttempt.attemptNumber).toBe(3);
    });

    it('resolves average score when strategy is average', () => {
      const res = resolveEffectiveScore(attempts, 'average');
      expect(res.effectiveScore).toBe(75); // (60+90+75)/3 = 75
    });

    it('handles empty attempts safely', () => {
      const res = resolveEffectiveScore([], 'highest');
      expect(res.effectiveScore).toBe(0);
      expect(res.chosenAttempt).toBe(null);
    });
  });
});
