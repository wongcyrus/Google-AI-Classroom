import { useEffect } from 'react';

const activeSessionKeys = new Set();
export const ACTIVE_SESSION_EVENT = 'classroom-active-session-change';

function notifySessionChange() {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent(ACTIVE_SESSION_EVENT, {
        detail: { active: activeSessionKeys.size > 0, count: activeSessionKeys.size },
      })
    );
  }
}

export function setActiveClassroomSession(key, isActive) {
  if (!key) return;
  const hadActive = activeSessionKeys.has(key);
  if (isActive && !hadActive) {
    activeSessionKeys.add(key);
    notifySessionChange();
  } else if (!isActive && hadActive) {
    activeSessionKeys.delete(key);
    notifySessionChange();
  }
}

export function hasActiveClassroomSession() {
  return activeSessionKeys.size > 0;
}

export function clearActiveClassroomSessions() {
  if (activeSessionKeys.size > 0) {
    activeSessionKeys.clear();
    notifySessionChange();
  }
}

export function useActiveClassroomSession(isActive, key) {
  useEffect(() => {
    setActiveClassroomSession(key, Boolean(isActive));
    return () => {
      setActiveClassroomSession(key, false);
    };
  }, [isActive, key]);
}
