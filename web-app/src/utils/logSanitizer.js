/**
 * Sanitizes class document data before console logging.
 * Strips sensitive privacy fields (student emails, student UID maps, teacher emails, IP restrictions)
 * and retains non-sensitive metadata (class name, schedule, capture settings, AI configs, exam flags).
 *
 * @param {Record<string, any> | null | undefined} classData
 * @returns {Record<string, any> | null}
 */
export function sanitizeClassDataForLog(classData) {
  if (!classData || typeof classData !== 'object') {
    return null;
  }

  const {
    studentEmails,
    students,
    teacherEmails,
    teachers,
    ipRestrictions,
    ...nonSensitiveData
  } = classData;

  const enrolledStudentCount = Array.isArray(studentEmails)
    ? studentEmails.length
    : students && typeof students === 'object' && !Array.isArray(students)
      ? Object.keys(students).length
      : Array.isArray(students)
        ? students.length
        : 0;

  const teacherCount = Array.isArray(teacherEmails)
    ? teacherEmails.length
    : teachers && typeof teachers === 'object' && !Array.isArray(teachers)
      ? Object.keys(teachers).length
      : Array.isArray(teachers)
        ? teachers.length
        : 0;

  return {
    ...nonSensitiveData,
    enrolledStudentCount,
    teacherCount,
  };
}
