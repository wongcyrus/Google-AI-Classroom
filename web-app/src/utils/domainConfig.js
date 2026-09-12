// Centralized institutional domain configuration
export const TEACHER_DOMAINS = (import.meta.env.VITE_TEACHER_DOMAINS || 'vtc.edu.hk')
  .split(',')
  .map(d => d.trim().toLowerCase().replace(/^@/, ''))
  .filter(Boolean);

export const STUDENT_DOMAINS = (import.meta.env.VITE_STUDENT_DOMAINS || 'stu.vtc.edu.hk')
  .split(',')
  .map(d => d.trim().toLowerCase().replace(/^@/, ''))
  .filter(Boolean);

export const INSTITUTION_NAME = import.meta.env.VITE_INSTITUTION_NAME || 'VTC';

export const STUDENT_USERNAME_REGEX = import.meta.env.VITE_STUDENT_USERNAME_REGEX
  ? new RegExp(import.meta.env.VITE_STUDENT_USERNAME_REGEX, 'i')
  : null;

export const TEACHER_USERNAME_REGEX = import.meta.env.VITE_TEACHER_USERNAME_REGEX
  ? new RegExp(import.meta.env.VITE_TEACHER_USERNAME_REGEX, 'i')
  : null;

export const DEFAULT_TO_STUDENT = import.meta.env.VITE_DEFAULT_TO_STUDENT !== 'false';

/**
 * Extracts username from email address.
 * @param {string} email
 * @returns {string}
 */
export function getEmailUsername(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return '';
  const clean = email.trim().toLowerCase();
  const atIndex = clean.lastIndexOf('@');
  return clean.substring(0, atIndex);
}

/**
 * Extracts and cleans the domain from an email address.
 * @param {string} email
 * @returns {string}
 */
export function getEmailDomain(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return '';
  const clean = email.trim().toLowerCase();
  const atIndex = clean.lastIndexOf('@');
  return clean.substring(atIndex + 1);
}

const matchesDomain = (domain, targetDomain) => targetDomain === '*' || domain === targetDomain || domain.endsWith('.' + targetDomain);

/**
 * Checks if username matches student pattern.
 * @param {string} username
 * @returns {boolean}
 */
export function isStudentUsername(username) {
  return Boolean(STUDENT_USERNAME_REGEX && STUDENT_USERNAME_REGEX.test(username));
}

/**
 * Checks if username matches teacher pattern.
 * @param {string} username
 * @returns {boolean}
 */
export function isTeacherUsername(username) {
  return Boolean(TEACHER_USERNAME_REGEX && TEACHER_USERNAME_REGEX.test(username));
}

/**
 * Derives role ('teacher' | 'student' | null) from email address.
 * Evaluates username regex patterns, domain boundaries, and zero-trust fallbacks.
 * @param {string} email
 * @returns {'teacher' | 'student' | null}
 */
export function deriveRoleFromEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return null;
  const username = getEmailUsername(email);
  const domain = getEmailDomain(email);
  if (!username || !domain) return null;

  const isStudentDom = STUDENT_DOMAINS.some(target => matchesDomain(domain, target));
  const isTeacherDom = TEACHER_DOMAINS.some(target => matchesDomain(domain, target));

  if (!isStudentDom && !isTeacherDom) return null;

  // 1. Username Regex check takes precedence if configured
  if (isStudentUsername(username)) return 'student';
  if (isTeacherUsername(username)) return 'teacher';

  // 2. Same-domain check
  const exactStudentDom = STUDENT_DOMAINS.some(d => d === '*' || domain === d);
  const exactTeacherDom = TEACHER_DOMAINS.some(d => d === '*' || domain === d);
  if (exactStudentDom && exactTeacherDom) {
    return DEFAULT_TO_STUDENT ? 'student' : null;
  }

  // 3. Subdomain hierarchy (student subdomains win over parent teacher domains)
  if (isStudentDom) return 'student';
  if (isTeacherDom) return 'teacher';

  return DEFAULT_TO_STUDENT ? 'student' : null;
}

/**
 * Checks if an email belongs to a student domain or role.
 * @param {string} email
 * @returns {boolean}
 */
export function isStudentEmail(email) {
  return deriveRoleFromEmail(email) === 'student';
}

/**
 * Checks if an email belongs to a teacher domain or role.
 * @param {string} email
 * @returns {boolean}
 */
export function isTeacherEmail(email) {
  return deriveRoleFromEmail(email) === 'teacher';
}

/**
 * Validates if an email is an authorized institutional email.
 * @param {string} email
 * @returns {boolean}
 */
export function isValidInstitutionalEmail(email) {
  return deriveRoleFromEmail(email) !== null;
}

/**
 * Returns formatted human-readable list of allowed domains for UI validation and placeholders.
 * @returns {string} e.g. "@stu.vtc.edu.hk or @vtc.edu.hk"
 */
export function getAllowedDomainsDescription() {
  const allDomains = [...STUDENT_DOMAINS, ...TEACHER_DOMAINS].map(d => d === '*' ? '* (any domain)' : `@${d}`);
  return [...new Set(allDomains)].join(' or ');
}
