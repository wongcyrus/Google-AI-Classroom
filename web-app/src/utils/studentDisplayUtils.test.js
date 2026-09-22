import { describe, it, expect } from 'vitest';
import {
  normalizeStudentEmail,
  getStudentProfile,
  getStudentDisplayName,
  formatStudentIdentity,
  parseStudentRosterCsv,
  parseStudentRosterRows,
  parseStudentRosterFile,
  generateStudentRosterTemplateCsv,
  generateStudentRosterTemplateExcel,
  exportStudentRosterCsv,
  exportStudentRosterExcel,
  readTextFileWithEncoding,
} from './studentDisplayUtils';

describe('studentDisplayUtils Utility', () => {
  describe('normalizeStudentEmail', () => {
    it('trims whitespace and converts to lowercase', () => {
      expect(normalizeStudentEmail('  Alice.Chan@VTC.Edu.HK  ')).toBe('alice.chan@vtc.edu.hk');
      expect(normalizeStudentEmail('BOB@GMAIL.COM')).toBe('bob@gmail.com');
    });

    it('handles non-string or falsy input gracefully', () => {
      expect(normalizeStudentEmail('')).toBe('');
      expect(normalizeStudentEmail(null)).toBe('');
      expect(normalizeStudentEmail(undefined)).toBe('');
      expect(normalizeStudentEmail(12345)).toBe('');
    });
  });

  describe('getStudentProfile and formatStudentIdentity', () => {
    const profileMap = {
      'chan.tm@vtc.edu.hk': {
        studentName: 'Chan Tai Man',
        nickname: 'David',
        programme: 'Higher Diploma in Software Engineering',
        studentClass: 'IT114115/1A',
      },
      'wong.ky@vtc.edu.hk': {
        studentName: 'Wong Ka Yan',
        nickname: 'Kelly',
        programme: '',
        studentClass: 'IT114115/1B',
      },
    };

    it('resolves full profile with studentName from email and profileMap', () => {
      const profile = getStudentProfile('Chan.TM@VTC.EDU.HK', profileMap);
      expect(profile.studentName).toBe('Chan Tai Man');
      expect(profile.nickname).toBe('David');
      expect(profile.programme).toBe('Higher Diploma in Software Engineering');
      expect(profile.studentClass).toBe('IT114115/1A');
    });

    it('resolves profile directly embedded in student object', () => {
      const studentObj = {
        email: 'direct@school.edu',
        studentName: 'Alex Smith',
        nickname: 'Al',
        studentClass: 'SE101-A',
      };
      const profile = getStudentProfile(studentObj, {});
      expect(profile.studentName).toBe('Alex Smith');
      expect(profile.nickname).toBe('Al');
      expect(profile.studentClass).toBe('SE101-A');
    });

    it('returns empty string fallbacks when student is not found in profileMap', () => {
      const profile = getStudentProfile('unknown@school.edu', profileMap);
      expect(profile.email).toBe('unknown@school.edu');
      expect(profile.studentName).toBe('');
      expect(profile.nickname).toBe('');
      expect(profile.programme).toBe('');
      expect(profile.studentClass).toBe('');
    });

    it('formats student identity with displayName and hasCustomProfile flag', () => {
      const identity = formatStudentIdentity('chan.tm@vtc.edu.hk', profileMap);
      expect(identity.displayName).toBe('David (Chan Tai Man)');
      expect(identity.fullName).toBe('Chan Tai Man');
      expect(identity.hasCustomProfile).toBe(true);

      const emptyIdentity = formatStudentIdentity('empty@school.edu', profileMap);
      expect(emptyIdentity.displayName).toBe('empty@school.edu');
      expect(emptyIdentity.hasCustomProfile).toBe(false);
    });
  });

  describe('getStudentDisplayName - Multi-Tier Fallback Hierarchy', () => {
    const sampleProfiles = {
      // 1. Nickname + Student Name
      'david@school.edu': {
        studentName: 'Chan Tai Man',
        nickname: 'David',
      },
      // 2. Student Name Only (No Nickname)
      'kelly@school.edu': {
        studentName: 'Wong Ka Yan',
        nickname: '',
      },
      // 3. Nickname Only (No Student Name)
      'sam@school.edu': {
        studentName: '',
        nickname: 'Sammy',
      },
      // 4. Partial with whitespace
      'spacey@school.edu': {
        studentName: '   ',
        nickname: '  Spike  ',
      },
    };

    it('Tier 1: Formats Nickname + Student Name when both exist', () => {
      expect(getStudentDisplayName('david@school.edu', sampleProfiles)).toBe('David (Chan Tai Man)');
    });

    it('Tier 2: Formats Student Name when no nickname is present', () => {
      expect(getStudentDisplayName('kelly@school.edu', sampleProfiles)).toBe('Wong Ka Yan');
    });

    it('Tier 3: Formats Nickname only when no student name is present', () => {
      expect(getStudentDisplayName('sam@school.edu', sampleProfiles)).toBe('Sammy');
    });

    it('Tier 3.1: Trims whitespace around nickname properly', () => {
      expect(getStudentDisplayName('spacey@school.edu', sampleProfiles)).toBe('Spike');
    });

    it('Tier 4: Falls back to student.name if present and distinct from email', () => {
      const studentObj = {
        email: 'fallback@school.edu',
        name: 'Custom Registered Student',
      };
      expect(getStudentDisplayName(studentObj, {})).toBe('Custom Registered Student');
    });

    it('Tier 5: Falls back to email address when no profile metadata exists', () => {
      expect(getStudentDisplayName('raw.email@school.edu', {})).toBe('raw.email@school.edu');
    });

    it('Handles null / undefined input gracefully', () => {
      expect(getStudentDisplayName('', {})).toBe('Unknown Student');
      expect(getStudentDisplayName(null, {})).toBe('Unknown Student');
      expect(getStudentDisplayName(undefined, {})).toBe('Unknown Student');
    });
  });

  describe('parseStudentRosterCsv', () => {
    it('parses standard CSV with StudentName header and maps data correctly', () => {
      const csv = `StudentEmail,StudentName,Nickname,Programme,Class
230123456@stu.vtc.edu.hk,Chan Tai Man,David,HD in Software Engineering,IT114115/1A
230987654@stu.vtc.edu.hk,Wong Ka Yan,Kelly,HD in Software Engineering,IT114115/1B`;

      const result = parseStudentRosterCsv(csv);
      expect(result.totalParsed).toBe(2);
      expect(result.students).toHaveLength(2);
      expect(result.emailList).toEqual([
        '230123456@stu.vtc.edu.hk',
        '230987654@stu.vtc.edu.hk',
      ]);

      const s1 = result.students[0];
      expect(s1.email).toBe('230123456@stu.vtc.edu.hk');
      expect(s1.studentName).toBe('Chan Tai Man');
      expect(s1.nickname).toBe('David');
      expect(s1.programme).toBe('HD in Software Engineering');
      expect(s1.studentClass).toBe('IT114115/1A');
      expect(s1.displayName).toBe('David (Chan Tai Man)');
      expect(s1.hasProfile).toBe(true);

      expect(result.profilesMap['230123456@stu.vtc.edu.hk']).toBeDefined();
      expect(result.profilesMap['230123456@stu.vtc.edu.hk'].studentName).toBe('Chan Tai Man');
      expect(result.profilesMap['230123456@stu.vtc.edu.hk'].nickname).toBe('David');
    });

    it('handles partial profiles where students lack some or all non-email fields', () => {
      const csv = `StudentEmail,StudentName,Nickname,Programme,Class
full@school.edu,Chan Tai Man,David,HDSE,IT114115/1A
name_only@school.edu,Wong Ka Yan,,,IT114115/1B
nick_only@school.edu,,Kelly,,
email_only@school.edu,,,,`;

      const result = parseStudentRosterCsv(csv);
      expect(result.totalParsed).toBe(4);
      expect(result.invalidRows).toHaveLength(0);

      const [full, nameOnly, nickOnly, emailOnly] = result.students;
      expect(full.displayName).toBe('David (Chan Tai Man)');
      expect(nameOnly.displayName).toBe('Wong Ka Yan');
      expect(nickOnly.displayName).toBe('Kelly');
      expect(emailOnly.displayName).toBe('email_only@school.edu');

      expect(full.hasProfile).toBe(true);
      expect(nameOnly.hasProfile).toBe(true);
      expect(nickOnly.hasProfile).toBe(true);
      expect(emailOnly.hasProfile).toBe(false);
    });

    it('supports flexible header aliases and case insensitivity', () => {
      const csv = `email,name,preferred_name,major,cohort
student1@school.edu,Alice Chow,Ali,BSc Computer Science,CS-2026-A`;

      const result = parseStudentRosterCsv(csv);
      expect(result.totalParsed).toBe(1);
      const s = result.students[0];
      expect(s.email).toBe('student1@school.edu');
      expect(s.studentName).toBe('Alice Chow');
      expect(s.nickname).toBe('Ali');
      expect(s.programme).toBe('BSc Computer Science');
      expect(s.studentClass).toBe('CS-2026-A');
      expect(s.displayName).toBe('Ali (Alice Chow)');
    });

    it('supports tab-separated values (TSV) pasted directly from Excel or Sheets', () => {
      const tsv = `StudentEmail\tStudentName\tNickname\tProgramme\tClass
student_tsv@school.edu\tBob Jones\tBobby\tMultimedia\tMM-101`;

      const result = parseStudentRosterCsv(tsv);
      expect(result.totalParsed).toBe(1);
      expect(result.students[0].email).toBe('student_tsv@school.edu');
      expect(result.students[0].studentName).toBe('Bob Jones');
      expect(result.students[0].nickname).toBe('Bobby');
      expect(result.students[0].studentClass).toBe('MM-101');
    });

    it('handles quoted cells with commas and quotes properly', () => {
      const csv = `StudentEmail,StudentName,Nickname,Programme,Class
complex@school.edu,"O'Connor, John Jr.",Johnny,"Engineering, Software & Cloud","IT-101, Group B"`;

      const result = parseStudentRosterCsv(csv);
      expect(result.totalParsed).toBe(1);
      const s = result.students[0];
      expect(s.studentName).toBe("O'Connor, John Jr.");
      expect(s.programme).toBe('Engineering, Software & Cloud');
      expect(s.studentClass).toBe('IT-101, Group B');
    });

    it('strips UTF-8 BOM automatically from Windows Excel exported CSVs', () => {
      const bomCsv = '\uFEFFStudentEmail,StudentName\r\nalice@school.edu,Alice Chan';
      const result = parseStudentRosterCsv(bomCsv);
      expect(result.totalParsed).toBe(1);
      expect(result.students[0].email).toBe('alice@school.edu');
      expect(result.students[0].studentName).toBe('Alice Chan');
    });

    it('identifies and records invalid rows without crashing', () => {
      const csv = `StudentEmail,StudentName
valid@school.edu,Valid User
not-an-email,Invalid User
,EmptyEmailUser`;

      const result = parseStudentRosterCsv(csv);
      expect(result.totalParsed).toBe(1);
      expect(result.invalidRows).toHaveLength(2);
      expect(result.invalidRows[0].reason).toContain('Invalid email address format');
      expect(result.invalidRows[1].reason).toContain('Missing email address');
    });

    it('handles empty string or null input gracefully', () => {
      expect(parseStudentRosterCsv('')).toEqual({
        students: [],
        profilesMap: {},
        emailList: [],
        invalidRows: [],
        totalParsed: 0,
      });
      expect(parseStudentRosterCsv(null)).toEqual({
        students: [],
        profilesMap: {},
        emailList: [],
        invalidRows: [],
        totalParsed: 0,
      });
    });
  });

  describe('generateStudentRosterTemplateCsv and exportStudentRosterCsv', () => {
    it('generates downloadable template with English headers, Unicode BOM, and Chinese nickname examples', () => {
      const template = generateStudentRosterTemplateCsv();
      // Must start with UTF-8 BOM \uFEFF for Microsoft Excel Unicode support
      expect(template.startsWith('\uFEFF')).toBe(true);
      // Header MUST be strictly English
      expect(template).toContain('StudentEmail,StudentName,Nickname,Programme,Class');
      // Example row with Chinese nickname
      expect(template).toContain('Chan Tai Man,大文');
      expect(template).toContain('Wong Ka Yan,阿欣');
      expect(template).toContain('230123456@stu.vtc.edu.hk');
      expect(template).toContain('IT114115/1A');
    });

    it('exports current roster with English headers, Unicode BOM, and Chinese nicknames', () => {
      const emails = ['alice@school.edu', 'chan@school.edu', 'bob@school.edu'];
      const profiles = {
        'alice@school.edu': {
          studentName: 'Alice Chan',
          nickname: 'Ali',
          programme: 'HD in Software Engineering, VTC',
          studentClass: 'IT114115/1A',
        },
        'chan@school.edu': {
          studentName: 'Chan Tai Man',
          nickname: '大文',
          programme: '軟體工程高級文憑',
          studentClass: 'IT114115/1A',
        },
        'bob@school.edu': {
          studentName: '',
          nickname: '',
          programme: '',
          studentClass: '',
        },
      };

      const exported = exportStudentRosterCsv(emails, profiles, 'IT114115-DEV');
      // Starts with BOM
      expect(exported.startsWith('\uFEFF')).toBe(true);
      // English-only headers
      expect(exported).toContain('StudentEmail,StudentName,Nickname,Programme,Class,CourseID');
      expect(exported).toContain('alice@school.edu,Alice Chan,Ali,"HD in Software Engineering, VTC",IT114115/1A,IT114115-DEV');
      expect(exported).toContain('chan@school.edu,Chan Tai Man,大文,軟體工程高級文憑,IT114115/1A,IT114115-DEV');
      expect(exported).toContain('bob@school.edu,,,,,IT114115-DEV');

      // Roundtrip parsing preserves Chinese characters perfectly
      const parsed = parseStudentRosterCsv(exported);
      expect(parsed.students).toHaveLength(3);
      const chanStudent = parsed.students.find(s => s.email === 'chan@school.edu');
      expect(chanStudent.studentName).toBe('Chan Tai Man');
      expect(chanStudent.nickname).toBe('大文');
      expect(chanStudent.programme).toBe('軟體工程高級文憑');
      expect(chanStudent.displayName).toBe('大文 (Chan Tai Man)');
    });
  });

  describe('readTextFileWithEncoding', () => {
    it('returns empty string for null/empty file', async () => {
      expect(await readTextFileWithEncoding(null)).toBe('');
      expect(await readTextFileWithEncoding(new Blob([]))).toBe('');
    });

    it('decodes UTF-8 file with Chinese nickname and name', async () => {
      const content = 'StudentEmail,StudentName,Nickname\n230123456@stu.vtc.edu.hk,Chan Tai Man,大文';
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
      const decoded = await readTextFileWithEncoding(blob);
      expect(decoded).toBe(content);
    });

    it('decodes UTF-8 file containing UTF-8 BOM', async () => {
      const content = '\uFEFFStudentEmail,StudentName,Nickname\n230123456@stu.vtc.edu.hk,Chan Tai Man,大文';
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
      const decoded = await readTextFileWithEncoding(blob);
      expect(decoded).toContain('大文');
    });

    it('decodes UTF-16LE encoded file with BOM', async () => {
      const text = 'StudentEmail,Nickname\n230123456@stu.vtc.edu.hk,大文';
      // UTF-16LE BOM: 0xFF, 0xFE
      const buffer = new ArrayBuffer(2 + text.length * 2);
      const view = new DataView(buffer);
      view.setUint8(0, 0xFF);
      view.setUint8(1, 0xFE);
      for (let i = 0; i < text.length; i++) {
        view.setUint16(2 + i * 2, text.charCodeAt(i), true);
      }
      const blob = new Blob([buffer]);
      const decoded = await readTextFileWithEncoding(blob);
      expect(decoded).toContain('大文');
      const parsed = parseStudentRosterCsv(decoded);
      expect(parsed.students[0].nickname).toBe('大文');
    });

    it('decodes multi-line UTF-8 CSV containing Traditional and Simplified Chinese characters', async () => {
      const text = 'StudentEmail,StudentName,Nickname,Programme,Class\n230123456@stu.vtc.edu.hk,Chan Tai Man,大文,雲端計算,IT114115/1A\n230987654@stu.vtc.edu.hk,Zhang Wei,小伟,软件工程,IT114115/1B';
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const decoded = await readTextFileWithEncoding(blob);
      expect(decoded).toContain('大文');
      expect(decoded).toContain('小伟');
      const parsed = parseStudentRosterCsv(decoded);
      expect(parsed.students).toHaveLength(2);
      expect(parsed.students[0].nickname).toBe('大文');
      expect(parsed.students[1].nickname).toBe('小伟');
    });
  });

  describe('Excel (.xlsx) Roster Functionality', () => {
    it('generates a valid Excel template Blob with Chinese examples', async () => {
      const blob = await generateStudentRosterTemplateExcel();
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toContain('spreadsheetml.sheet');

      const file = new File([blob], 'template.xlsx', { type: blob.type });
      const result = await parseStudentRosterFile(file);
      expect(result.totalParsed).toBeGreaterThanOrEqual(4);
      expect(result.students.some(s => s.nickname === '大文')).toBe(true);
      expect(result.students.some(s => s.nickname === '阿欣')).toBe(true);
    });

    it('exports class roster to Excel (.xlsx) and parses it back with 100% fidelity', async () => {
      const emails = ['230111222@stu.vtc.edu.hk', '230333444@stu.vtc.edu.hk'];
      const profiles = {
        '230111222@stu.vtc.edu.hk': {
          studentName: 'Chan Tai Man',
          nickname: '大文',
          programme: 'Software Engineering',
          studentClass: 'SE-1A',
        },
        '230333444@stu.vtc.edu.hk': {
          studentName: 'Wong Ka Yan',
          nickname: '阿欣',
          programme: 'Cloud & AI',
          studentClass: 'AI-1B',
        },
      };

      const blob = await exportStudentRosterExcel(emails, profiles, 'TEST-CLASS');
      expect(blob).toBeInstanceOf(Blob);

      const file = new File([blob], 'test_roster.xlsx', { type: blob.type });
      const parsed = await parseStudentRosterFile(file);
      expect(parsed.totalParsed).toBe(2);
      expect(parsed.students[0].email).toBe('230111222@stu.vtc.edu.hk');
      expect(parsed.students[0].studentName).toBe('Chan Tai Man');
      expect(parsed.students[0].nickname).toBe('大文');
      expect(parsed.students[1].email).toBe('230333444@stu.vtc.edu.hk');
      expect(parsed.students[1].nickname).toBe('阿欣');
    });

    it('parses 2D array of rows directly using parseStudentRosterRows', () => {
      const rows = [
        ['StudentEmail', 'StudentName', 'Nickname', 'Programme', 'Class'],
        ['student@vtc.edu.hk', 'Wong Tai Sin', '大仙', 'Computing', 'IT101'],
      ];
      const result = parseStudentRosterRows(rows);
      expect(result.totalParsed).toBe(1);
      expect(result.students[0].nickname).toBe('大仙');
      expect(result.profilesMap['student@vtc.edu.hk'].studentName).toBe('Wong Tai Sin');
    });
  });
});

