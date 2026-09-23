/**
 * Utilities for task constraints, deadline calculations, and scoring resolution.
 */

/**
 * Validates whether a student can start or resume a task.
 * 
 * @param {Object} task The task definition object.
 * @param {Object|null} submission The student's root submission object.
 * @param {Date} [userNow=new Date()] The current timestamp.
 * @returns {{ allowed: boolean, reason?: string, code?: string, activeAttempt?: Object }}
 */
export const canStartTask = (task, submission, userNow = new Date()) => {
  if (!task) {
    return { allowed: false, reason: 'Task definition not found.', code: 'TASK_NOT_FOUND' };
  }

  if (task.status === 'draft') {
    return { allowed: false, reason: 'This task is currently in draft mode and not yet published.', code: 'TASK_DRAFT' };
  }

  if (task.status === 'closed') {
    return { allowed: false, reason: 'This task has been closed by the instructor.', code: 'TASK_CLOSED' };
  }

  const nowTime = userNow instanceof Date ? userNow.getTime() : new Date(userNow).getTime();
  const constraints = task.constraints || {};
  const timing = constraints.timing || {};
  const attempts = constraints.attempts || {};

  // 1. Availability Window Check
  if (timing.availableFrom) {
    const availTime = timing.availableFrom.toDate ? timing.availableFrom.toDate().getTime() : new Date(timing.availableFrom).getTime();
    if (nowTime < availTime) {
      return { 
        allowed: false, 
        reason: `Task is not yet available. It opens at ${new Date(availTime).toLocaleString()}.`, 
        code: 'NOT_YET_AVAILABLE' 
      };
    }
  }

  // 2. Active in-progress attempt check (allow resuming)
  if (submission && submission.status === 'in_progress' && submission.activeAttempt) {
    return { 
      allowed: true, 
      isResume: true,
      activeAttempt: submission.activeAttempt,
      code: 'RESUME_IN_PROGRESS' 
    };
  }

  // 3. Deadline and Late Policy Check
  if (timing.deadline) {
    const deadlineTime = timing.deadline.toDate ? timing.deadline.toDate().getTime() : new Date(timing.deadline).getTime();
    const graceMs = (timing.gracePeriodMinutes || 0) * 60 * 1000;
    const effectiveCutoff = deadlineTime + graceMs;

    if (nowTime > effectiveCutoff) {
      if (timing.latePolicy === 'strictly_closed' || !timing.latePolicy) {
        return { 
          allowed: false, 
          reason: `The submission deadline (${new Date(deadlineTime).toLocaleString()}) has passed. Late submissions are not accepted.`, 
          code: 'DEADLINE_PASSED' 
        };
      }
    }
  }

  // 4. Max Attempts Check
  const maxAttempts = typeof attempts.maxAttempts === 'number' ? attempts.maxAttempts : 1;
  const usedAttempts = submission?.attemptsCount || 0;

  if (maxAttempts > 0 && usedAttempts >= maxAttempts) {
    return { 
      allowed: false, 
      reason: `You have reached the maximum allowed attempts (${maxAttempts}).`, 
      code: 'MAX_ATTEMPTS_EXHAUSTED' 
    };
  }

  // 5. Cooldown Period Check between attempts
  const cooldownMinutes = attempts.retryCooldownMinutes || 0;
  if (cooldownMinutes > 0 && submission?.lastSubmittedAt) {
    const lastSubTime = submission.lastSubmittedAt.toDate ? submission.lastSubmittedAt.toDate().getTime() : new Date(submission.lastSubmittedAt).getTime();
    const cooldownMs = cooldownMinutes * 60 * 1000;
    const nextEligibleTime = lastSubTime + cooldownMs;

    if (nowTime < nextEligibleTime) {
      const waitMinutes = Math.ceil((nextEligibleTime - nowTime) / 60000);
      return { 
        allowed: false, 
        reason: `Cooldown active. Please wait ${waitMinutes} more minute(s) before attempting again.`, 
        code: 'COOLDOWN_ACTIVE',
        retryAvailableAt: new Date(nextEligibleTime)
      };
    }
  }

  return { allowed: true, code: 'CAN_START' };
};

/**
 * Calculates remaining time in seconds for an active attempt.
 * 
 * @param {Object} attempt The attempt record with startedAt.
 * @param {number} timeLimitMinutes The limit in minutes (0 or null = unlimited).
 * @param {Date} [userNow=new Date()] The current timestamp.
 * @returns {{ remainingSeconds: number, isExpired: boolean, percentageUsed: number }}
 */
export const calculateRemainingTime = (attempt, timeLimitMinutes, userNow = new Date()) => {
  if (!attempt || !attempt.startedAt || !timeLimitMinutes || timeLimitMinutes <= 0) {
    return { remainingSeconds: Infinity, isExpired: false, percentageUsed: 0 };
  }

  const startTime = attempt.startedAt.toDate ? attempt.startedAt.toDate().getTime() : new Date(attempt.startedAt).getTime();
  const nowTime = userNow instanceof Date ? userNow.getTime() : new Date(userNow).getTime();
  const totalAllowedSeconds = timeLimitMinutes * 60;
  const elapsedSeconds = Math.max(0, Math.floor((nowTime - startTime) / 1000));
  const remainingSeconds = Math.max(0, totalAllowedSeconds - elapsedSeconds);
  const percentageUsed = Math.min(100, Math.round((elapsedSeconds / totalAllowedSeconds) * 100));

  return {
    remainingSeconds,
    isExpired: remainingSeconds <= 0,
    percentageUsed
  };
};

/**
 * Formats seconds into MM:SS or HH:MM:SS.
 * 
 * @param {number} totalSeconds
 * @returns {string}
 */
export const formatRemainingTime = (totalSeconds) => {
  if (!isFinite(totalSeconds) || totalSeconds <= 0) return '00:00';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * Resolves the effective score across multiple attempts based on scoringStrategy.
 * 
 * @param {Array<Object>} attempts Array of completed attempt records.
 * @param {'highest'|'latest'|'average'} [strategy='highest']
 * @returns {{ effectiveScore: number, bestScore: number, latestScore: number, chosenAttempt: Object|null }}
 */
export const resolveEffectiveScore = (attempts = [], strategy = 'highest') => {
  const evaluatedAttempts = attempts.filter((a) => a && a.evaluation && typeof a.evaluation.finalScore === 'number');

  if (evaluatedAttempts.length === 0) {
    return { effectiveScore: 0, bestScore: 0, latestScore: 0, chosenAttempt: null };
  }

  // Sort by attemptNumber ascending
  const sorted = [...evaluatedAttempts].sort((a, b) => (a.attemptNumber || 0) - (b.attemptNumber || 0));
  const latestAttempt = sorted[sorted.length - 1];
  const latestScore = latestAttempt.evaluation.finalScore;

  let bestAttempt = sorted[0];
  let bestScore = bestAttempt.evaluation.finalScore;

  sorted.forEach((att) => {
    if (att.evaluation.finalScore > bestScore) {
      bestScore = att.evaluation.finalScore;
      bestAttempt = att;
    }
  });

  let effectiveScore = bestScore;
  let chosenAttempt = bestAttempt;

  if (strategy === 'latest') {
    effectiveScore = latestScore;
    chosenAttempt = latestAttempt;
  } else if (strategy === 'average') {
    const sum = sorted.reduce((acc, att) => acc + att.evaluation.finalScore, 0);
    effectiveScore = Math.round((sum / sorted.length) * 10) / 10;
  }

  return {
    effectiveScore,
    bestScore,
    latestScore,
    chosenAttempt
  };
};
