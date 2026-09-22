/**
 * Utility functions for Student Identity, Roster Parsing, Display Formatting, and Partial-Profile Fallbacks.
 * 
 * Supports:
 * - Parsing batch roster CSV/TSV/pasted text with case-insensitive, alias-friendly headers:
 *   (StudentEmail, FirstName, LastName, Nickname, Programme, Class [Cohort]).
 * - Multi-tier graceful fallback for students without complete profile metadata.
 * - Single-point-of-truth display name formatting across teacher and student views.
 */

/**
 * Normalizes an email address by trimming whitespace and converting to lowercase.
 * @param {string} email 
 * @returns {string}
 */
export const normalizeStudentEmail = (email) => {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
};

/**
 * Retrieves the normalized student profile from a profileMap or student object.
 * @param {string|object} studentOrEmail 
 * @param {object} profileMap - Map of normalized email -> profile object
 * @returns {object} { email, firstName, lastName, nickname, programme, studentClass }
 */
export const getStudentProfile = (studentOrEmail, profileMap = {}) => {
  let email = '';
  let directProfile = null;

  if (typeof studentOrEmail === 'string') {
    email = normalizeStudentEmail(studentOrEmail);
  } else if (studentOrEmail && typeof studentOrEmail === 'object') {
    email = normalizeStudentEmail(
      studentOrEmail.email ||
      studentOrEmail.studentEmail ||
      studentOrEmail.userEmail ||
      ''
    );
    if (studentOrEmail.profile && typeof studentOrEmail.profile === 'object') {
      directProfile = studentOrEmail.profile;
    } else {
      // Check if student object itself carries profile fields
      const { firstName, lastName, nickname, programme, studentClass } = studentOrEmail;
      if (firstName || lastName || nickname || programme || studentClass) {
        directProfile = { firstName, lastName, nickname, programme, studentClass };
      }
    }
  }

  const mapProfile = (email && profileMap && typeof profileMap === 'object')
    ? (profileMap[email] || null)
    : null;

  const merged = {
    email,
    firstName: (directProfile?.firstName || mapProfile?.firstName || '').trim(),
    lastName: (directProfile?.lastName || mapProfile?.lastName || '').trim(),
    nickname: (directProfile?.nickname || mapProfile?.nickname || '').trim(),
    programme: (directProfile?.programme || mapProfile?.programme || '').trim(),
    studentClass: (directProfile?.studentClass || directProfile?.class || mapProfile?.studentClass || mapProfile?.class || '').trim(),
  };

  return merged;
};

/**
 * Resolves a human-friendly display name for a student with robust multi-tier fallback.
 * 
 * Hierarchy:
 * 1. Nickname + Full Name: `Nickname (Last First)` (e.g. "David (Chan Tai Man)")
 * 2. Full Name Only: `Last First` (e.g. "Chan Tai Man")
 * 3. Nickname Only: `Nickname` (e.g. "David")
 * 4. Status/Custom Name: `student.name` if present and distinct from email
 * 5. Fallback: Normalized email address (e.g. "student@school.edu") or 'Unknown Student'
 * 
 * @param {string|object} studentOrEmail 
 * @param {object} profileMap 
 * @param {object} options - { nameOrder: 'surname_first' | 'given_first' }
 * @returns {string}
 */
export const getStudentDisplayName = (studentOrEmail, profileMap = {}, options = {}) => {
  const profile = getStudentProfile(studentOrEmail, profileMap);
  const { firstName, lastName, nickname, email } = profile;
  const nameOrder = options.nameOrder || 'surname_first';

  // Construct full name portion
  let fullName = '';
  if (lastName && firstName) {
    fullName = nameOrder === 'surname_first' ? `${lastName} ${firstName}` : `${firstName} ${lastName}`;
  } else if (lastName) {
    fullName = lastName;
  } else if (firstName) {
    fullName = firstName;
  }

  // Tier 1: Nickname + Full Name
  if (nickname && fullName) {
    return `${nickname} (${fullName})`;
  }

  // Tier 2: Full Name Only
  if (fullName) {
    return fullName;
  }

  // Tier 3: Nickname Only
  if (nickname) {
    return nickname;
  }

  // Tier 4: Existing student.name if distinct from email
  if (typeof studentOrEmail === 'object' && studentOrEmail?.name) {
    const rawName = String(studentOrEmail.name).trim();
    if (rawName && rawName.toLowerCase() !== email.toLowerCase()) {
      return rawName;
    }
  }

  // Tier 5: Email or fallback
  if (email) {
    return email;
  }

  return 'Unknown Student';
};

/**
 * Extracts a structured student identity object for UI badges, cards, and tooltips.
 * @param {string|object} studentOrEmail 
 * @param {object} profileMap 
 * @returns {object}
 */
export const formatStudentIdentity = (studentOrEmail, profileMap = {}) => {
  const profile = getStudentProfile(studentOrEmail, profileMap);
  const displayName = getStudentDisplayName(studentOrEmail, profileMap);
  const hasCustomProfile = Boolean(
    profile.firstName || profile.lastName || profile.nickname || profile.programme || profile.studentClass
  );

  let fullName = '';
  if (profile.lastName && profile.firstName) {
    fullName = `${profile.lastName} ${profile.firstName}`;
  } else {
    fullName = profile.lastName || profile.firstName || '';
  }

  return {
    ...profile,
    displayName,
    fullName,
    hasCustomProfile,
  };
};

/**
 * Parses raw CSV, TSV, or spreadsheet copy-paste text into a validated roster of students.
 * 
 * Supports case-insensitive header aliases:
 * - Email: 'studentemail', 'email', 'student_email', 'mail'
 * - First Name: 'firstname', 'first_name', 'givenname', 'given_name'
 * - Last Name: 'lastname', 'last_name', 'surname', 'familyname', 'family_name'
 * - Nickname: 'nickname', 'nick_name', 'preferredname', 'preferred_name'
 * - Programme: 'programme', 'program', 'major', 'department'
 * - Class (Cohort): 'class', 'studentclass', 'student_class', 'classgroup', 'cohort', 'group', 'tutorialgroup'
 * 
 * @param {string} rawText 
 * @returns {object} { students, profilesMap, emailList, invalidRows, totalParsed }
 */
export const parseStudentRosterCsv = (rawText) => {
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    return {
      students: [],
      profilesMap: {},
      emailList: [],
      invalidRows: [],
      totalParsed: 0,
    };
  }

  // Strip UTF-8 BOM if exported by Windows Excel
  const sanitizedText = rawText.replace(/^\uFEFF/, '');

  // Helper to split CSV line into cells respecting quotes (RFC-4180)
  const parseLine = (line, delimiter = ',') => {
    const cells = [];
    let cur = '';
    let inQuotes = false;

    const pushCell = (raw) => {
      let val = raw.trim();
      if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
        val = val.slice(1, -1).replace(/""/g, '"');
      }
      cells.push(val.trim());
    };

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++; // Skip escaped double quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        pushCell(cur);
        cur = '';
      } else {
        cur += char;
      }
    }
    pushCell(cur);
    return cells;
  };

  // Determine line delimiter
  const lines = sanitizedText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { students: [], profilesMap: {}, emailList: [], invalidRows: [], totalParsed: 0 };
  }

  // Detect delimiter (tab vs comma vs semicolon)
  const firstLine = lines[0];
  let delimiter = ',';
  if (firstLine.includes('\t')) {
    delimiter = '\t';
  } else if (firstLine.includes(';') && !firstLine.includes(',')) {
    delimiter = ';';
  }

  const rawHeaderCells = parseLine(firstLine, delimiter);
  const normalizedHeaders = rawHeaderCells.map(h => h.toLowerCase().replace(/[\s_\-]/g, ''));

  // Header alias map
  const ALIASES = {
    email: ['studentemail', 'email', 'studentmail', 'mail', 'emailaddress'],
    firstName: ['firstname', 'givenname', 'fname', 'first'],
    lastName: ['lastname', 'surname', 'familyname', 'lname', 'last'],
    nickname: ['nickname', 'nick', 'preferredname', 'displayname', 'englishname'],
    programme: ['programme', 'program', 'major', 'course', 'department', 'curriculum'],
    studentClass: ['class', 'studentclass', 'cohort', 'classgroup', 'group', 'tutorialgroup', 'section', 'stream'],
  };

  const getColIndex = (key) => {
    const candidateAliases = ALIASES[key];
    return normalizedHeaders.findIndex(h => candidateAliases.includes(h));
  };

  const emailCol = getColIndex('email');
  const firstNameCol = getColIndex('firstName');
  const lastNameCol = getColIndex('lastName');
  const nicknameCol = getColIndex('nickname');
  const programmeCol = getColIndex('programme');
  const studentClassCol = getColIndex('studentClass');

  const hasHeaderRow = emailCol !== -1;
  const startRowIndex = hasHeaderRow ? 1 : 0;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const students = [];
  const profilesMap = {};
  const emailSet = new Set();
  const invalidRows = [];

  for (let r = startRowIndex; r < lines.length; r++) {
    const line = lines[r];
    const cells = parseLine(line, delimiter);

    let email = '';
    let firstName = '';
    let lastName = '';
    let nickname = '';
    let programme = '';
    let studentClass = '';

    if (hasHeaderRow) {
      email = cells[emailCol] || '';
      firstName = firstNameCol !== -1 ? (cells[firstNameCol] || '') : '';
      lastName = lastNameCol !== -1 ? (cells[lastNameCol] || '') : '';
      nickname = nicknameCol !== -1 ? (cells[nicknameCol] || '') : '';
      programme = programmeCol !== -1 ? (cells[programmeCol] || '') : '';
      studentClass = studentClassCol !== -1 ? (cells[studentClassCol] || '') : '';
    } else {
      // Positional fallback: Email, FirstName, LastName, Nickname, Programme, Class
      email = cells[0] || '';
      firstName = cells[1] || '';
      lastName = cells[2] || '';
      nickname = cells[3] || '';
      programme = cells[4] || '';
      studentClass = cells[5] || '';
    }

    const cleanEmail = normalizeStudentEmail(email);

    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      invalidRows.push({
        line: r + 1,
        raw: line,
        reason: cleanEmail ? `Invalid email address format: "${cleanEmail}"` : 'Missing email address',
      });
      continue;
    }

    const cleanFirst = firstName.trim();
    const cleanLast = lastName.trim();
    const cleanNick = nickname.trim();
    const cleanProg = programme.trim();
    const cleanClass = studentClass.trim();

    const hasProfile = Boolean(cleanFirst || cleanLast || cleanNick || cleanProg || cleanClass);

    const studentRecord = {
      email: cleanEmail,
      firstName: cleanFirst,
      lastName: cleanLast,
      nickname: cleanNick,
      programme: cleanProg,
      studentClass: cleanClass,
      hasProfile,
    };

    studentRecord.displayName = getStudentDisplayName(studentRecord);

    students.push(studentRecord);
    emailSet.add(cleanEmail);

    if (hasProfile) {
      profilesMap[cleanEmail] = {
        firstName: cleanFirst,
        lastName: cleanLast,
        nickname: cleanNick,
        programme: cleanProg,
        studentClass: cleanClass,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  return {
    students,
    profilesMap,
    emailList: Array.from(emailSet),
    invalidRows,
    totalParsed: students.length,
  };
};

/**
 * Generates a ready-to-download CSV template with header and illustrative example rows.
 * @returns {string}
 */
export const generateStudentRosterTemplateCsv = () => {
  const headers = ['StudentEmail', 'FirstName', 'LastName', 'Nickname', 'Programme', 'Class'];
  const examples = [
    ['230123456@stu.vtc.edu.hk', 'Tai Man', 'Chan', 'David', 'Higher Diploma in Software Engineering', 'IT114115/1A'],
    ['230987654@stu.vtc.edu.hk', 'Ka Yan', 'Wong', 'Kelly', 'Higher Diploma in Software Engineering', 'IT114115/1B'],
    ['230555666@stu.vtc.edu.hk', 'Siu Ming', 'Lee', '', 'Higher Diploma in Cloud & Data Centre Admin', 'IT114115/1A'],
    ['alex.smith@school.edu', '', '', 'Alex', '', 'SE101-Cohort2'],
    ['email.only@school.edu', '', '', '', '', ''],
  ];

  const escapeCell = (val) => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const rows = [
    headers.join(','),
    ...examples.map(ex => ex.map(escapeCell).join(',')),
  ];

  return rows.join('\r\n');
};

/**
 * Serializes the current class roster (emails + profiles) to an RFC-4180 CSV string.
 * @param {string[]} studentEmails 
 * @param {object} studentProfiles 
 * @param {string} classId 
 * @returns {string}
 */
export const exportStudentRosterCsv = (studentEmails = [], studentProfiles = {}, classId = '') => {
  const headers = ['StudentEmail', 'FirstName', 'LastName', 'Nickname', 'Programme', 'Class', 'CourseID'];

  const escapeCell = (val) => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const rows = [headers.join(',')];

  const emails = Array.isArray(studentEmails) ? studentEmails : [];
  emails.forEach((email) => {
    const cleanEmail = normalizeStudentEmail(email);
    if (!cleanEmail) return;

    const prof = studentProfiles[cleanEmail] || {};
    const row = [
      escapeCell(cleanEmail),
      escapeCell(prof.firstName || ''),
      escapeCell(prof.lastName || ''),
      escapeCell(prof.nickname || ''),
      escapeCell(prof.programme || ''),
      escapeCell(prof.studentClass || ''),
      escapeCell(classId || ''),
    ];
    rows.push(row.join(','));
  });

  return rows.join('\r\n');
};
