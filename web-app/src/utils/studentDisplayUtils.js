/**
 * Utility functions for Student Identity, Roster Parsing, Display Formatting, and Partial-Profile Fallbacks.
 * 
 * Supports:
 * - Parsing batch roster CSV/TSV/pasted text with case-insensitive, alias-friendly headers:
 *   (StudentEmail, StudentName, Nickname, Programme, Class [Cohort]).
 * - Multi-tier graceful fallback for students without complete profile metadata.
 * - Single-point-of-truth display name formatting across teacher and student views.
 */

import { exportToExcel, readExcelFile } from './exportUtils';

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
 * @returns {object} { email, studentName, nickname, programme, studentClass }
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
      const { studentName, name, nickname, programme, studentClass } = studentOrEmail;
      if (studentName || name || nickname || programme || studentClass) {
        directProfile = {
          studentName: studentName || name,
          nickname,
          programme,
          studentClass,
        };
      }
    }
  }

  const mapProfile = (email && profileMap && typeof profileMap === 'object')
    ? (profileMap[email] || null)
    : null;

  const studentName = (directProfile?.studentName || directProfile?.name || mapProfile?.studentName || mapProfile?.name || '').trim();

  const merged = {
    email,
    studentName,
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
 * 1. Nickname + Student Name: `Nickname (Student Name)` (e.g. "David (Chan Tai Man)")
 * 2. Student Name Only: `Student Name` (e.g. "Chan Tai Man")
 * 3. Nickname Only: `Nickname` (e.g. "David")
 * 4. Status/Custom Name: `student.name` if present and distinct from email
 * 5. Fallback: Normalized email address (e.g. "student@school.edu") or 'Unknown Student'
 * 
 * @param {string|object} studentOrEmail 
 * @param {object} profileMap 
 * @returns {string}
 */
export const getStudentDisplayName = (studentOrEmail, profileMap = {}) => {
  const profile = getStudentProfile(studentOrEmail, profileMap);
  const { studentName, nickname, email } = profile;

  // Tier 1: Nickname + Student Name
  if (nickname && studentName) {
    return `${nickname} (${studentName})`;
  }

  // Tier 2: Student Name Only
  if (studentName) {
    return studentName;
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
    profile.studentName || profile.nickname || profile.programme || profile.studentClass
  );

  return {
    ...profile,
    displayName,
    fullName: profile.studentName,
    hasCustomProfile,
  };
};

/**
 * Parses raw CSV, TSV, or spreadsheet copy-paste text into a validated roster of students.
 * 
 * Supports case-insensitive header aliases:
 * - Email: 'studentemail', 'email', 'studentmail', 'mail', 'emailaddress'
 * - Student Name: 'studentname', 'name', 'fullname', 'student_name', 'student', 'chinesename'
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

  // Strip UTF-8 / UTF-16 BOM if exported by Windows Excel or Unicode text editors
  const sanitizedText = rawText.replace(/^[\uFEFF\uFFFE]/, '');

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

  const rawRows = lines.map(line => parseLine(line, delimiter));
  return parseStudentRosterRows(rawRows);
};

/**
 * Parses a 2D array of spreadsheet rows (from Excel or CSV) into validated student profiles.
 * Supports case-insensitive header aliases and positional fallbacks.
 * 
 * @param {Array<Array<*>>} rawRows 
 * @returns {object} { students, profilesMap, emailList, invalidRows, totalParsed }
 */
export const parseStudentRosterRows = (rawRows = []) => {
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return { students: [], profilesMap: {}, emailList: [], invalidRows: [], totalParsed: 0 };
  }

  // Filter out empty rows
  const rows = rawRows.filter(row => Array.isArray(row) && row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== ''));
  if (rows.length === 0) {
    return { students: [], profilesMap: {}, emailList: [], invalidRows: [], totalParsed: 0 };
  }

  const rawHeaderCells = rows[0].map(h => String(h ?? '').trim());
  const normalizedHeaders = rawHeaderCells.map(h => h.toLowerCase().replace(/[\s_\-]/g, ''));

  // Header alias map
  const ALIASES = {
    email: ['studentemail', 'email', 'studentmail', 'mail', 'emailaddress'],
    studentName: ['studentname', 'name', 'fullname', 'student_name', 'student', 'chinesename'],
    nickname: ['nickname', 'nick', 'preferredname', 'displayname', 'preferred_name'],
    programme: ['programme', 'program', 'major', 'course', 'department', 'curriculum'],
    studentClass: ['class', 'studentclass', 'cohort', 'classgroup', 'group', 'tutorialgroup', 'section', 'stream'],
  };

  const getColIndex = (key) => {
    const candidateAliases = ALIASES[key];
    return normalizedHeaders.findIndex(h => candidateAliases.includes(h));
  };

  const emailCol = getColIndex('email');
  const studentNameCol = getColIndex('studentName');
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

  for (let r = startRowIndex; r < rows.length; r++) {
    const cells = rows[r].map(c => String(c ?? '').trim());

    let email = '';
    let studentName = '';
    let nickname = '';
    let programme = '';
    let studentClass = '';

    if (hasHeaderRow) {
      email = cells[emailCol] || '';
      if (studentNameCol !== -1) {
        studentName = cells[studentNameCol] || '';
      }
      nickname = nicknameCol !== -1 ? (cells[nicknameCol] || '') : '';
      programme = programmeCol !== -1 ? (cells[programmeCol] || '') : '';
      studentClass = studentClassCol !== -1 ? (cells[studentClassCol] || '') : '';
    } else {
      // Positional fallback: Email, StudentName, Nickname, Programme, Class
      email = cells[0] || '';
      studentName = cells[1] || '';
      nickname = cells[2] || '';
      programme = cells[3] || '';
      studentClass = cells[4] || '';
    }

    const cleanEmail = normalizeStudentEmail(email);

    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      invalidRows.push({
        line: r + 1,
        raw: cells.join(', '),
        reason: cleanEmail ? `Invalid email address format: "${cleanEmail}"` : 'Missing email address',
      });
      continue;
    }

    const cleanName = studentName.trim();
    const cleanNick = nickname.trim();
    const cleanProg = programme.trim();
    const cleanClass = studentClass.trim();

    const hasProfile = Boolean(cleanName || cleanNick || cleanProg || cleanClass);

    const studentRecord = {
      email: cleanEmail,
      studentName: cleanName,
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
        studentName: cleanName,
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
 * Universal file parser for student rosters.
 * Seamlessly parses Microsoft Excel (.xlsx / .xls) and legacy CSV/TSV files.
 * 
 * @param {File|Blob} file 
 * @returns {Promise<object>} Parsed roster result
 */
export const parseStudentRosterFile = async (file) => {
  if (!file) {
    return { students: [], profilesMap: {}, emailList: [], invalidRows: [], totalParsed: 0 };
  }

  const fileName = (file.name || '').toLowerCase();
  const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

  if (isExcel) {
    try {
      const rows = await readExcelFile(file);
      if (rows && rows.length > 0) {
        return parseStudentRosterRows(rows);
      }
    } catch (err) {
      console.warn('Failed to parse Excel file, attempting text decoder fallback:', err);
    }
  }

  // Fallback to text reading (supports CSV, TSV, or raw text)
  const text = await readTextFileWithEncoding(file);
  return parseStudentRosterCsv(text);
};

/**
 * Generates and downloads a Microsoft Excel (.xlsx) template for student roster batch import.
 * Features English headers, column auto-formatting, and realistic example rows with Chinese names.
 * 
 * @returns {Promise<Blob>}
 */
export const generateStudentRosterTemplateExcel = async () => {
  const headers = ['StudentEmail', 'StudentName', 'Nickname', 'Programme', 'Class'];
  const examples = [
    ['230123456@stu.vtc.edu.hk', 'Chan Tai Man', '大文', 'Higher Diploma in Software Engineering', 'IT114115/1A'],
    ['230987654@stu.vtc.edu.hk', 'Wong Ka Yan', '阿欣', 'Higher Diploma in Software Engineering', 'IT114115/1B'],
    ['230555666@stu.vtc.edu.hk', 'Lee Siu Ming', 'David', 'Higher Diploma in Cloud & Data Centre Admin', 'IT114115/1A'],
    ['alex.smith@school.edu', 'Alex Smith', 'Alex', '', 'SE101-Cohort2'],
    ['email.only@school.edu', '', '', '', ''],
  ];

  return exportToExcel(headers, examples, 'student_roster_template.xlsx');
};

/**
 * Serializes and exports the current class roster to a genuine Microsoft Excel (.xlsx) spreadsheet.
 * 
 * @param {string[]} studentEmails 
 * @param {object} studentProfiles 
 * @param {string} classId 
 * @returns {Promise<Blob>}
 */
export const exportStudentRosterExcel = async (studentEmails = [], studentProfiles = {}, classId = '') => {
  const headers = ['StudentEmail', 'StudentName', 'Nickname', 'Programme', 'Class', 'CourseID'];
  const emails = Array.isArray(studentEmails) ? studentEmails : [];
  const rows = [];

  emails.forEach((email) => {
    const cleanEmail = normalizeStudentEmail(email);
    if (!cleanEmail) return;

    const prof = studentProfiles[cleanEmail] || {};
    rows.push([
      cleanEmail,
      prof.studentName || '',
      prof.nickname || '',
      prof.programme || '',
      prof.studentClass || '',
      classId || '',
    ]);
  });

  const activeExportId = (classId || 'class').trim().toLowerCase();
  return exportToExcel(headers, rows, `${activeExportId}_student_roster.xlsx`);
};

/**
 * Generates a ready-to-download CSV template with header and illustrative example rows.
 * Kept for backward compatibility.
 * 
 * @returns {string} RFC-4180 CSV string starting with UTF-8 BOM
 */
export const generateStudentRosterTemplateCsv = () => {
  const headers = ['StudentEmail', 'StudentName', 'Nickname', 'Programme', 'Class'];
  const examples = [
    ['230123456@stu.vtc.edu.hk', 'Chan Tai Man', '大文', 'Higher Diploma in Software Engineering', 'IT114115/1A'],
    ['230987654@stu.vtc.edu.hk', 'Wong Ka Yan', '阿欣', 'Higher Diploma in Software Engineering', 'IT114115/1B'],
    ['230555666@stu.vtc.edu.hk', 'Lee Siu Ming', 'David', 'Higher Diploma in Cloud & Data Centre Admin', 'IT114115/1A'],
    ['alex.smith@school.edu', 'Alex Smith', 'Alex', '', 'SE101-Cohort2'],
    ['email.only@school.edu', '', '', '', ''],
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

  return '\uFEFF' + rows.join('\r\n');
};

/**
 * Serializes the current class roster to an RFC-4180 CSV string.
 * Kept for backward compatibility.
 * 
 * @param {string[]} studentEmails 
 * @param {object} studentProfiles 
 * @param {string} classId 
 * @returns {string} RFC-4180 CSV string starting with UTF-8 BOM
 */
export const exportStudentRosterCsv = (studentEmails = [], studentProfiles = {}, classId = '') => {
  const headers = ['StudentEmail', 'StudentName', 'Nickname', 'Programme', 'Class', 'CourseID'];

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
      escapeCell(prof.studentName || ''),
      escapeCell(prof.nickname || ''),
      escapeCell(prof.programme || ''),
      escapeCell(prof.studentClass || ''),
      escapeCell(classId || ''),
    ];
    rows.push(row.join(','));
  });

  return '\uFEFF' + rows.join('\r\n');
};

/**
 * Reads a File or Blob with standard Unicode encoding detection.
 * Prioritizes:
 * 1. UTF-16 LE / BE BOM detection.
 * 2. Standard UTF-8 (RFC-4180 / modern web standard).
 * 
 * @param {Blob|File} file 
 * @returns {Promise<string>} Decoded Unicode text content
 */
export const readTextFileWithEncoding = async (file) => {
  if (!file) return '';

  let buffer;
  if (typeof file.arrayBuffer === 'function') {
    buffer = await file.arrayBuffer();
  } else if (typeof FileReader !== 'undefined') {
    buffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result);
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(file);
    });
  } else {
    return '';
  }

  if (!buffer || buffer.byteLength === 0) return '';
  const bytes = new Uint8Array(buffer);

  // 1. Check for UTF-16 LE BOM (FF FE) or BE BOM (FE FF)
  if (bytes.length >= 2) {
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return new TextDecoder('utf-16le').decode(buffer);
    }
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return new TextDecoder('utf-16be').decode(buffer);
    }
  }

  // 2. Standard UTF-8 Unicode decode (per RFC-4180 standard)
  return new TextDecoder('utf-8').decode(buffer);
};
