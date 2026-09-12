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

/**
 * Extracts and cleans the domain from an email address.
 * @param {string} email
 * @returns {string}
 */
export function getEmailDomain(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return '';
  return email.trim().toLowerCase().substring(email.lastIndexOf('@') + 1);
}

const matchesDomain = (domain, targetDomain) => domain === targetDomain || domain.endsWith('.' + targetDomain);

/**
 * Checks if an email belongs to a student domain.
 * @param {string} email
 * @returns {boolean}
 */
export function isStudentEmail(email) {
  const domain = getEmailDomain(email);
  if (!domain) return false;
  return STUDENT_DOMAINS.some(target => matchesDomain(domain, target));
}

/**
 * Checks if an email belongs to a teacher domain.
 * Evaluates student domains first to prevent subdomains (e.g. stu.vtc.edu.hk) from matching the parent domain.
 * @param {string} email
 * @returns {boolean}
 */
export function isTeacherEmail(email) {
  const domain = getEmailDomain(email);
  if (!domain) return false;
  if (isStudentEmail(email)) return false;
  return TEACHER_DOMAINS.some(target => matchesDomain(domain, target));
}

/**
 * Derives role ('teacher' | 'student' | null) from email address.
 * @param {string} email
 * @returns {'teacher' | 'student' | null}
 */
export function deriveRoleFromEmail(email) {
  if (isStudentEmail(email)) return 'student';
  if (isTeacherEmail(email)) return 'teacher';
  return null;
}

/**
 * Validates if an email is an authorized institutional email.
 * @param {string} email
 * @returns {boolean}
 */
export function isValidInstitutionalEmail(email) {
  return isStudentEmail(email) || isTeacherEmail(email);
}

/**
 * Returns formatted human-readable list of allowed domains for UI validation and placeholders.
 * @returns {string} e.g. "@stu.vtc.edu.hk or @vtc.edu.hk"
 */
export function getAllowedDomainsDescription() {
  const allDomains = [...STUDENT_DOMAINS, ...TEACHER_DOMAINS].map(d => `@${d}`);
  return allDomains.join(' or ');
}
