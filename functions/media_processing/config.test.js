import { describe, it, expect } from 'vitest';
import { deriveUserRole, getAllowedEmailDomainsDescription, isPasskeySharingWhitelisted } from './config.js';

describe('media_processing config.js helper unit tests', () => {
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

  it('validates passkey sharing whitelist', () => {
    expect(isPasskeySharingWhitelisted(null)).toBe(false);
    expect(isPasskeySharingWhitelisted(123)).toBe(false);
    expect(isPasskeySharingWhitelisted('cywong@vtc.edu.hk')).toBe(true);
    expect(isPasskeySharingWhitelisted('t-cywong@stu.vtc.edu.hk')).toBe(true);
    expect(isPasskeySharingWhitelisted('stranger@other.com')).toBe(false);
  });
});
