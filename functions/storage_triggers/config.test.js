import { describe, it, expect } from 'vitest';
import { deriveUserRole, getAllowedEmailDomainsDescription } from './config.js';

describe('config.js helper unit tests in storage_triggers', () => {
  it('correctly derives user roles and handles invalid/empty inputs', () => {
    expect(deriveUserRole(null)).toBeNull();
    expect(deriveUserRole('')).toBeNull();
    expect(deriveUserRole('noatsign')).toBeNull();
    expect(deriveUserRole('invalid@unknown.com')).toBeNull();

    expect(deriveUserRole('student@stu.vtc.edu.hk')).toBe('student');
    expect(deriveUserRole('teacher@vtc.edu.hk')).toBe('teacher');
  });

  it('formats allowed email domains description', () => {
    const desc = getAllowedEmailDomainsDescription();
    expect(typeof desc).toBe('string');
    expect(desc.length).toBeGreaterThan(0);
  });
});
