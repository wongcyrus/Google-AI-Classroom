/**
 * Utility functions for Student Identity, Roster Parsing, Display Formatting, and Partial-Profile Fallbacks.
 * 
 * Supports:
 * - Parsing batch roster CSV/TSV/pasted text with case-insensitive, alias-friendly headers:
 *   (StudentEmail, StudentName, Nickname, Programme, Class [Cohort]).
 * - Multi-tier graceful fallback for students without complete profile metadata.
 * - Single-point-of-truth display name formatting across teacher and student views.
 */

import { useState, useEffect, useCallback } from 'react';
import { exportToExcel, readExcelFile } from './exportUtils';

/**
 * Checks whether Masked Privacy Mode is currently active.
 * Default is TRUE (Masked) unless explicitly set to 'false' in localStorage.
 * @param {object|boolean} [options={}]
 * @returns {boolean}
 */
export const isPrivacyModeActive = (options = {}) => {
  if (typeof options === 'boolean') return options;
  if (options && typeof options.privacyMode === 'boolean') return options.privacyMode;

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const saved = window.localStorage.getItem('teacher_privacy_mode');
      return saved !== 'false';
    } catch {
      return true;
    }
  }
  return true;
};

/**
 * Sets Masked Privacy Mode and broadcasts the change across all UI components.
 * @param {boolean} enabled
 */
export const setPrivacyMode = (enabled) => {
  const active = Boolean(enabled);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem('teacher_privacy_mode', active ? 'true' : 'false');
      window.dispatchEvent(new CustomEvent('teacher_privacy_mode_changed', { detail: { privacyMode: active } }));
    } catch {}
  }
};

/**
 * Toggles Masked Privacy Mode and broadcasts the change.
 * Prompts user confirmation only before turning OFF (to prevent accidental exposure of full names).
 * @param {boolean} [skipConfirm=false]
 * @returns {boolean}
 */
export const togglePrivacyMode = (skipConfirm = false) => {
  const current = isPrivacyModeActive();
  const next = !current;
  const shouldSkip = skipConfirm === true;

  // Confirmation is required only before turning OFF privacy mode (revealing unmasked names)
  if (!shouldSkip && current && !next && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    const message = '⚠️ Turn Privacy Mode OFF?\n\nThis will reveal full student names and IDs on screen. If you are projecting or sharing your screen, sensitive student information will be visible.\n\nAre you sure you want to reveal full student names?';

    const confirmed = window.confirm(message);
    if (!confirmed) {
      return current;
    }
  }

  setPrivacyMode(next);
  return next;
};

/**
 * React hook to synchronize Privacy Mode state across all tabs, headers, and views.
 * @returns {[boolean, (skipConfirm?: boolean) => void]}
 */
export const usePrivacyMode = () => {
  const [privacyMode, setLocalPrivacyMode] = useState(isPrivacyModeActive);

  useEffect(() => {
    const handleUpdate = (e) => {
      const next = typeof e?.detail?.privacyMode === 'boolean' ? e.detail.privacyMode : isPrivacyModeActive();
      setLocalPrivacyMode(next);
    };

    window.addEventListener('teacher_privacy_mode_changed', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener('teacher_privacy_mode_changed', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  const toggle = useCallback((eOrSkip) => {
    const skip = eOrSkip === true;
    const next = togglePrivacyMode(skip);
    setLocalPrivacyMode(next);
  }, []);

  return [privacyMode, toggle];
};

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
 * Masks a Student ID so only the last 4 characters are visible (e.g. "990000101" -> "***0101").
 * Enforces privacy by preventing full Student ID exposure alongside Student Name and Email.
 * @param {string|number} studentId
 * @returns {string}
 */
export const maskStudentId = (studentId) => {
  const raw = String(studentId ?? '').trim();
  if (!raw) return '';
  if (raw.length <= 4) {
    return `***${raw.slice(-1)}`;
  }
  return `***${raw.slice(-4)}`;
};

/**
 * Masks an email address local-part for privacy-safe secondary display
 * (e.g. "990000101@stu.vtc.edu.hk" -> "***0101@stu.vtc.edu.hk", "alice.chan@school.edu" -> "al***@school.edu").
 * @param {string} email
 * @returns {string}
 */
export const maskStudentEmail = (email) => {
  const clean = normalizeStudentEmail(email);
  if (!clean || !clean.includes('@')) return clean;
  const [local, domain] = clean.split('@');
  if (!local) return clean;
  if (/^\d{5,}$/.test(local)) {
    return `***${local.slice(-4)}@${domain}`;
  }
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  return `${local.slice(0, 2)}***@${domain}`;
};

/**
 * Masks a Chinese name per standard HK/institutional privacy conventions:
 * 2 characters: "羅晉" -> "羅*"
 * 3 characters: "陳正洋" -> "陳*洋"
 * 4 characters: "歐陽梓樂" -> "歐**樂"
 * @param {string} str
 * @returns {string}
 */
export const maskChineseName = (str) => {
  if (!str) return '';
  const chars = Array.from(str.trim());
  if (chars.length <= 1) return str;
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars[chars.length - 1]}`;
};

/**
 * Masks an English word by keeping the first letter and replacing the rest with asterisks:
 * "Ching" -> "C****"
 * @param {string} word
 * @returns {string}
 */
export const maskEnglishWord = (word) => {
  const clean = word.replace(/[^a-zA-Z]/g, '');
  if (!clean) return word;
  if (clean.length <= 1) return word;
  return `${clean[0]}${'*'.repeat(clean.length - 1)}`;
};

/**
 * Centrally masks a student display name, nickname, or full name for public/projector privacy:
 * - "CHAN,Ching Yeung" -> "C***,C**** Y****"
 * - "陳正洋" -> "陳*洋"
 * - "陳正洋 (CHAN,Ching Yeung)" -> "陳*洋 (C***,C**** Y****)"
 * - "David (Chan Tai Man)" -> "D**** (C*** T** M**)"
 * - "260047062@stu.vtc.edu.hk" -> "Student ***7062"
 * @param {string} name
 * @returns {string}
 */
export const maskStudentName = (name) => {
  if (!name || typeof name !== 'string') return '';
  const trimmed = name.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('Student ***')) {
    return trimmed;
  }

  if (trimmed.includes('@')) {
    const idMatch = trimmed.match(/\d{5,}/);
    return idMatch ? `Student ***${idMatch[0].slice(-4)}` : `${trimmed.split('@')[0].slice(0, 2)}***`;
  }

  // Check if contains parenthesized part: Nickname (Full Name)
  const parenMatch = trimmed.match(/^([^(]+)\s*\(([^)]+)\)$/);
  if (parenMatch) {
    const part1 = parenMatch[1].trim();
    const part2 = parenMatch[2].trim();
    return `${maskStudentName(part1)} (${maskStudentName(part2)})`;
  }

  // Pure CJK
  if (/^[\u4e00-\u9fa5]+$/.test(trimmed)) {
    return maskChineseName(trimmed);
  }

  // Mixed or English
  return trimmed
    .split(/([\s,]+)/)
    .map((token) => {
      if (/^[\s,]+$/.test(token)) return token;
      if (/^[\u4e00-\u9fa5]+$/.test(token)) return maskChineseName(token);
      return maskEnglishWord(token);
    })
    .join('');
};

/**
 * Retrieves the normalized student profile from a profileMap or student object.
 * @param {string|object} studentOrEmail 
 * @param {object} profileMap - Map of normalized email -> profile object
 * @returns {object} { email, studentName, nickname, programme, studentClass }
 */
export const getStudentProfile = (studentOrEmail, profileMap = {}) => {
  let email = '';
  let uid = '';
  let directProfile = null;

  if (typeof studentOrEmail === 'string') {
    const raw = studentOrEmail.trim();
    if (raw.includes('@')) {
      email = normalizeStudentEmail(raw);
    } else {
      uid = raw;
    }
  } else if (studentOrEmail && typeof studentOrEmail === 'object') {
    email = normalizeStudentEmail(
      studentOrEmail.email ||
      studentOrEmail.studentEmail ||
      studentOrEmail.userEmail ||
      studentOrEmail.studentMail ||
      studentOrEmail.mail ||
      studentOrEmail.user?.email ||
      studentOrEmail.authorEmail ||
      ''
    );
    uid = String(
      studentOrEmail.studentUid ||
      studentOrEmail.uid ||
      studentOrEmail.userId ||
      studentOrEmail.id ||
      ''
    ).trim();

    if (studentOrEmail.profile && typeof studentOrEmail.profile === 'object') {
      directProfile = studentOrEmail.profile;
    } else {
      // Check if student object itself carries profile fields
      const {
        studentName,
        displayName,
        name,
        fullname,
        fullName,
        chineseName,
        nickname,
        programme,
        program,
        studentClass,
        cohort,
        className
      } = studentOrEmail;

      if (studentName || displayName || name || fullname || fullName || chineseName || nickname || programme || program || studentClass || cohort || className) {
        directProfile = {
          studentName: studentName || displayName || name || fullname || fullName || chineseName,
          nickname,
          programme: programme || program,
          studentClass: studentClass || cohort || className,
        };
      }
    }
  }

  // Look up profile in profileMap by email (case-insensitive), raw key, UID, or searching values
  let mapProfile = null;
  if (profileMap && typeof profileMap === 'object') {
    if (email) {
      mapProfile = profileMap[email] || profileMap[email.toLowerCase()] || null;
    }
    if (!mapProfile && uid) {
      mapProfile = profileMap[uid] || null;
    }
    if (!mapProfile) {
      // Search values of profileMap
      const values = Object.values(profileMap);
      mapProfile = values.find(p => {
        if (!p || typeof p !== 'object') return false;
        const pEmail = normalizeStudentEmail(p.email || p.studentEmail || p.userEmail);
        const pUid = String(p.uid || p.studentUid || p.userId || p.id || '').trim();
        return (email && pEmail === email) || (uid && pUid === uid);
      }) || null;
    }
  }

  const isEmailLike = (val) => !val || typeof val !== 'string' || val.includes('@') || (email && val.trim().toLowerCase() === email.toLowerCase());

  const rawMapName = (
    mapProfile?.studentName ||
    mapProfile?.displayName ||
    mapProfile?.name ||
    mapProfile?.fullname ||
    mapProfile?.fullName ||
    mapProfile?.chineseName ||
    ''
  ).trim();

  const rawDirectName = (
    directProfile?.studentName ||
    directProfile?.displayName ||
    directProfile?.name ||
    directProfile?.fullname ||
    directProfile?.fullName ||
    directProfile?.chineseName ||
    ''
  ).trim();

  // Prefer official mapProfile roster name; ignore any direct name that is just the student's email
  const studentName = (!isEmailLike(rawMapName) ? rawMapName : (!isEmailLike(rawDirectName) ? rawDirectName : '')).trim();

  const rawMapNick = (mapProfile?.nickname || '').trim();
  const rawDirectNick = (directProfile?.nickname || '').trim();
  const nickname = (!isEmailLike(rawMapNick) ? rawMapNick : (!isEmailLike(rawDirectNick) ? rawDirectNick : '')).trim();

  const programme = (
    directProfile?.programme ||
    directProfile?.program ||
    mapProfile?.programme ||
    mapProfile?.program ||
    ''
  ).trim();

  const studentClass = (
    directProfile?.studentClass ||
    directProfile?.class ||
    directProfile?.cohort ||
    directProfile?.className ||
    mapProfile?.studentClass ||
    mapProfile?.class ||
    mapProfile?.cohort ||
    mapProfile?.className ||
    ''
  ).trim();

  const resolvedEmail = email || normalizeStudentEmail(mapProfile?.email || mapProfile?.studentEmail || '');

  const merged = {
    email: resolvedEmail,
    uid: uid || mapProfile?.uid || mapProfile?.studentUid || '',
    studentName,
    nickname,
    programme,
    studentClass,
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
 * 4. Status/Custom Name: `student.displayName` / `student.name` if present and distinct from email
 * 5. Fallback: Normalized email address (e.g. "student@school.edu"), UID, or 'Unknown Student'
 * 
 * @param {string|object} studentOrEmail 
 * @param {object} profileMap 
 * @param {object|boolean} [options={}] - Options object or boolean privacyMode flag. e.g. { privacyMode: true }
 * @returns {string}
 */
export const getStudentDisplayName = (studentOrEmail, profileMap = {}, options = {}) => {
  const isPrivacy = isPrivacyModeActive(options);

  const profile = getStudentProfile(studentOrEmail, profileMap);
  const { studentName, nickname, email, uid } = profile;

  let rawDisplay = '';

  // Tier 1: Nickname + Student Name
  if (nickname && studentName) {
    rawDisplay = `${nickname} (${studentName})`;
  } else if (studentName) {
    // Tier 2: Student Name Only
    rawDisplay = studentName;
  } else if (nickname) {
    // Tier 3: Nickname Only
    rawDisplay = nickname;
  } else if (typeof studentOrEmail === 'object' && studentOrEmail) {
    // Tier 4: Existing student.displayName / student.name if distinct from email
    const rawName = String(studentOrEmail.displayName || studentOrEmail.name || '').trim();
    if (rawName && !rawName.includes('@') && rawName.toLowerCase() !== email.toLowerCase() && rawName.toLowerCase() !== uid.toLowerCase()) {
      rawDisplay = rawName;
    }
  }

  if (rawDisplay) {
    return isPrivacy ? maskStudentName(rawDisplay) : rawDisplay;
  }

  // Tier 5: Email or fallback
  if (email) {
    return isPrivacy ? maskStudentName(email) : email;
  }

  if (uid) {
    return isPrivacy ? (uid.length > 4 ? `Student ***${uid.slice(-4)}` : `Student ***${uid}`) : uid;
  }

  return 'Unknown Student';
};

/**
 * Extracts a structured student identity object for UI badges, cards, and tooltips.
 * @param {string|object} studentOrEmail 
 * @param {object} profileMap 
 * @param {object|boolean} [options={}]
 * @returns {object}
 */
export const formatStudentIdentity = (studentOrEmail, profileMap = {}, options = {}) => {
  const isPrivacy = isPrivacyModeActive(options);
  const profile = getStudentProfile(studentOrEmail, profileMap);
  const displayName = getStudentDisplayName(studentOrEmail, profileMap, options);
  const hasCustomProfile = Boolean(
    profile.studentName || profile.nickname || profile.programme || profile.studentClass
  );

  return {
    ...profile,
    displayName,
    fullName: isPrivacy ? (profile.studentName ? maskStudentName(profile.studentName) : '') : profile.studentName,
    nickname: isPrivacy ? (profile.nickname ? maskStudentName(profile.nickname) : '') : profile.nickname,
    email: isPrivacy ? maskStudentEmail(profile.email) : profile.email,
    maskedEmail: maskStudentEmail(profile.email),
    maskedStudentId: maskStudentId(profile.studentId || profile.email?.split('@')[0] || ''),
    hasCustomProfile,
    isPrivacyMode: isPrivacy,
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
  const normalizedHeaders = rawHeaderCells.map(h => h.toLowerCase().replace(/[\s_-]/g, ''));

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

    studentRecord.displayName = getStudentDisplayName(studentRecord, {}, { privacyMode: false });

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

  if (!isExcel) {
    throw new Error('Only Microsoft Excel files (.xlsx, .xls) are supported.');
  }

  const rows = await readExcelFile(file);
  if (!rows || rows.length === 0) {
    return { students: [], profilesMap: {}, emailList: [], invalidRows: [], totalParsed: 0 };
  }
  return parseStudentRosterRows(rows);
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

    const prof = getStudentProfile(cleanEmail, studentProfiles);
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
