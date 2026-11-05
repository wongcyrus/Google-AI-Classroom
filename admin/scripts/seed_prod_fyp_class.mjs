import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const explicitProjectArg = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
const projectId = (explicitProjectArg || 'it114115-2627').trim();

// Sanitize ambient environment variables so Google SDKs never touch system default project
delete process.env.GCLOUD_PROJECT;
delete process.env.GOOGLE_CLOUD_PROJECT;
delete process.env.CLOUDSDK_CORE_PROJECT;
process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;

const app = initializeApp({ projectId }, `seed-fyp-${Date.now()}`);
const auth = getAuth(app);
const db = getFirestore(app);

const CLASS_ID = 'it114115-fyp-2627';
const GROUPING_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1cAikA_VoL0tSI6MoGiIF070B3GvE5QcO4IChGjRKYsk/edit?gid=0#gid=0';
const WEEKLY_LOG_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1mKWVAkdM0RedTQ2wjk1GMmh6bxNQ6S-A4YP-85s77Ps/edit?gid=1601202239#gid=1601202239';
const WEEKLY_LOG_CSV_EXPORT_URL =
  'https://docs.google.com/spreadsheets/d/1mKWVAkdM0RedTQ2wjk1GMmh6bxNQ6S-A4YP-85s77Ps/export?format=csv&gid=1601202239';

const isDevProject = projectId.includes('dev');

const TEACHERS = [
  { email: 'cywong@vtc.edu.hk', displayName: 'Cyrus Wong' },
  { email: 'kcheung@vtc.edu.hk', displayName: 'Kitson Cheung' },
  { email: 'kakaleung@vtc.edu.hk', displayName: 'Elka Leung' },
  { email: 'james.chan@vtc.edu.hk', displayName: 'James Chan' },
  { email: 'hli852@vtc.edu.hk', displayName: 'Harry Li' },
  ...(isDevProject
    ? [
        { email: 'teacher1@vtc.edu.hk', displayName: 'Demo Teacher 1' },
        { email: 'teacher2@vtc.edu.hk', displayName: 'Demo Teacher 2' },
        { email: 'teacher3@vtc.edu.hk', displayName: 'Demo Teacher 3' },
      ]
    : []),
];

// Chinese nicknames mapped from spreadsheet tabs ("Not in Group" gid=176958916 & "IT314115 Year 2&3" gid=302007501)
const CHINESE_NAME_BY_SID = {
  '250107201': '陳家俊',
  '250595462': '陳嘉軒',
  '250323388': '陳深',
  '250352974': '陳日進',
  '250384197': '陈枫伊',
  '250030740': '陳文軒',
  '250016155': '張曉彤',
  '250114972': '戴睿然',
  '250097891': '何浩宇',
  '250266200': '何雋軒',
  '250715175': '黃志鵬',
  '250024757': '關匡廷',
  '250216860': '李梓謙',
  '250018289': '李鎵宝',
  '250599067': '李劍鋒',
  '250267012': '李明臻',
  '250147211': '罗尔捷',
  '250349656': '吳逸靜',
  '250477390': '譚宇匡',
  '250280581': '黃俊豪',
  '250057659': '姚嘉俊',
  '250093818': '楊洋',
  '250322392': '张骏宁',
  '250320718': '张旋',
  '250325530': '陳卓文',
  '250044688': '陳珈銘',
  '250044707': '陳德楨',
  '250108351': '陳賢峰',
  '250250576': '陈星羽',
  '250294087': '周以謙',
  '250034726': '徐健強',
  '250105348': '郭雋庭',
  '250044572': '林奧深',
  '250018554': '羅威',
  '250031367': '李明謙',
  '250231955': '梁駿豪',
  '250392775': '李栢濂',
  '250047494': '吳錕洋',
  '250407166': '彭昊琛',
  '250103226': '蘇炳杰',
  '250214264': '戴卓宏',
  '250003922': '鄧騏瑋',
  '250016978': '鄧偉圖',
  '250114843': '丁家俊',
  '250437785': '蔡繼晟',
  '250131330': '黃詠濠',
  '250035133': '楊一',
  '250002058': '殷杰輝',
  '250235862': '袁景軒',
};

const FYP_GROUPS = [
  // ================= IT114115 Year 2 (A01 - A11) =================
  {
    id: 'grp_a01',
    name: 'A01',
    cohort: 'IT114115 Year 2',
    projectTopic:
      'A project topic related to CECS (Childcare, Elderly and Community Services) — CECS - ChildCare',
    supervisorEmail: 'kcheung@vtc.edu.hk',
    supervisorName: 'Kitson Cheung / Elka Leung',
    coSupervisorEmails: ['kakaleung@vtc.edu.hk', 'cywong@vtc.edu.hk'],
    assessorEmail: 'cywong@vtc.edu.hk',
    assessorName: 'Cyrus Wong',
    students: [
      { sid: '250107201', name: 'CHAN Ka Chun', classCode: 'IT114115/2A', role: 'Leader' },
      { sid: '250349656', name: 'NG YAT CHING', classCode: 'IT114115/2A', role: 'Member' },
      { sid: '250016155', name: 'Cheung Hiu Tung', classCode: 'IT114115/2A', role: 'Member' },
      { sid: '250131330', name: 'Wong Wing Ho', classCode: 'IT114115/2A', role: 'Member' },
    ],
  },
  {
    id: 'grp_a02',
    name: 'A02',
    cohort: 'IT114115 Year 2',
    projectTopic:
      'A Cloud-Based Digital Companion with Emotional Early Warning for Vulnerable Groups (Daily companionship through chat, with voice and emotion analysis for early risk alerts)',
    supervisorEmail: 'kcheung@vtc.edu.hk',
    supervisorName: 'Kitson Cheung / Elka Leung',
    coSupervisorEmails: ['kakaleung@vtc.edu.hk', 'cywong@vtc.edu.hk'],
    assessorEmail: 'cywong@vtc.edu.hk',
    assessorName: 'Cyrus Wong',
    students: [
      { sid: '250114972', name: 'DAI RUIRAN', classCode: 'IT114115/2A', role: 'Leader' },
      { sid: '250384197', name: 'CHEN Fengyi', classCode: 'IT114115/2A', role: 'Member' },
      { sid: '250320718', name: 'ZHANG XUAN', classCode: 'IT114115/2A', role: 'Member' },
    ],
  },
  {
    id: 'grp_a03',
    name: 'A03',
    cohort: 'IT114115 Year 2',
    projectTopic:
      'An Automated Cloud-Assisted Mobile Safety Monitoring System Utilizing Multi-Stage AI Verification for Elderly and Child Care',
    supervisorEmail: 'james.chan@vtc.edu.hk',
    supervisorName: 'James Chan',
    coSupervisorEmails: ['cywong@vtc.edu.hk'],
    assessorEmail: 'cywong@vtc.edu.hk',
    assessorName: 'Cyrus Wong',
    students: [
      { sid: '250280581', name: 'Wong Chun Ho', classCode: 'IT114115/2A', role: 'Leader' },
      { sid: '250715175', name: 'HUANG ZHIPENG', classCode: 'IT114115/2A', role: 'Member' },
      { sid: '250267012', name: 'Li Ming Chun', classCode: 'IT114115/2A', role: 'Member' },
      { sid: '250093818', name: 'YEUNG Yeung', classCode: 'IT114115/2A', role: 'Member' },
    ],
  },
  {
    id: 'grp_a04',
    name: 'A04',
    cohort: 'IT114115 Year 2',
    projectTopic: 'AI Music Learning Platform — beyond music score sharing',
    supervisorEmail: 'kcheung@vtc.edu.hk',
    supervisorName: 'Kitson Cheung / Elka Leung',
    coSupervisorEmails: ['kakaleung@vtc.edu.hk', 'cywong@vtc.edu.hk'],
    assessorEmail: 'cywong@vtc.edu.hk',
    assessorName: 'Cyrus Wong',
    students: [
      { sid: '250407166', name: 'Pang Ho Sum', classCode: 'IT114115/2A', role: 'Leader' },
      { sid: '250016978', name: 'Tang Wai To', classCode: 'IT114115/2A', role: 'Member' },
      { sid: '250214264', name: 'Tai Check Wang Jeffrey', classCode: 'IT114115/2A', role: 'Member' },
      { sid: '250044572', name: 'Lam Ou Sum', classCode: 'IT114115/2A', role: 'Member' },
    ],
  },
  {
    id: 'grp_a05',
    name: 'A05',
    cohort: 'IT114115 Year 2',
    projectTopic: 'Open Data Hackathon 2026',
    supervisorEmail: 'hli852@vtc.edu.hk',
    supervisorName: 'Harry Li',
    coSupervisorEmails: ['cywong@vtc.edu.hk'],
    assessorEmail: 'cywong@vtc.edu.hk',
    assessorName: 'Cyrus Wong',
    students: [
      { sid: '250325530', name: 'Chan Cheuk Man Jimmy', classCode: 'IT114115/2A', role: 'Leader' },
      { sid: '250108351', name: 'Chan Yin Fung', classCode: 'IT114115/2A', role: 'Member' },
      { sid: '250034726', name: 'CHUI Kin Keung Kenny', classCode: 'IT114115/2B', role: 'Member' },
      { sid: '250294087', name: 'Chow Yee Him', classCode: 'IT114115/2A', role: 'Member' },
    ],
  },
  {
    id: 'grp_a06',
    name: 'A06',
    cohort: 'IT114115 Year 2',
    projectTopic:
      'A Cloud-Based Multimodal System for Companionship and Family Support (Using a Raspberry Pi–Based Robot)',
    supervisorEmail: 'james.chan@vtc.edu.hk',
    supervisorName: 'James Chan',
    coSupervisorEmails: ['cywong@vtc.edu.hk'],
    assessorEmail: 'cywong@vtc.edu.hk',
    assessorName: 'Cyrus Wong',
    students: [
      { sid: '250147211', name: 'LUO ERJIE', classCode: 'IT114115/2A', role: 'Leader' },
      { sid: '250322392', name: 'ZHANG JUNNING', classCode: 'IT114115/2A', role: 'Member' },
      { sid: '250030740', name: 'CHEN Man Hin', classCode: 'IT114115/2A', role: 'Member' },
      { sid: '250097891', name: 'HE HAO YU', classCode: 'IT114115/2A', role: 'Member' },
    ],
  },
  {
    id: 'grp_a07',
    name: 'A07',
    cohort: 'IT114115 Year 2',
    projectTopic: 'Dangerous Puppy Alarm',
    supervisorEmail: 'hli852@vtc.edu.hk',
    supervisorName: 'Harry Li',
    coSupervisorEmails: ['cywong@vtc.edu.hk'],
    assessorEmail: 'cywong@vtc.edu.hk',
    assessorName: 'Cyrus Wong',
    students: [
      { sid: '250266200', name: 'HO Chun Hin', classCode: 'IT114115/2B', role: 'Leader' },
      { sid: '250024757', name: 'KWAN Hong Ting', classCode: 'IT114115/2B', role: 'Member' },
      { sid: '250235862', name: 'YUEN King Hin', classCode: 'IT114115/2B', role: 'Member' },
      { sid: '250352974', name: 'Chan Yat Chun', classCode: 'IT114115/2B', role: 'Member' },
    ],
  },
  {
    id: 'grp_a08',
    name: 'A08',
    cohort: 'IT114115 Year 2',
    projectTopic: 'Bus Information System',
    supervisorEmail: 'hli852@vtc.edu.hk',
    supervisorName: 'Harry Li',
    coSupervisorEmails: ['cywong@vtc.edu.hk'],
    assessorEmail: 'cywong@vtc.edu.hk',
    assessorName: 'Cyrus Wong',
    students: [
      { sid: '250057659', name: 'Yao Ka Chun', classCode: 'IT114115/2B', role: 'Leader' },
      { sid: '250477390', name: 'Tam Yu Hong', classCode: 'IT114115/2B', role: 'Member' },
      { sid: '250595462', name: 'Chan Ka Hin', classCode: 'IT114115/2B', role: 'Member' },
    ],
  },
  {
    id: 'grp_a09',
    name: 'A09',
    cohort: 'IT114115 Year 2',
    projectTopic: 'Assistive Tool for SEN student',
    supervisorEmail: 'kakaleung@vtc.edu.hk',
    supervisorName: 'Elka Leung',
    coSupervisorEmails: ['cywong@vtc.edu.hk'],
    assessorEmail: 'cywong@vtc.edu.hk',
    assessorName: 'Cyrus Wong',
    students: [
      { sid: '250103226', name: 'So Ping Kit', classCode: 'IT114115/2B', role: 'Leader' },
      { sid: '250035133', name: 'Yeung Yat', classCode: 'IT114115/2B', role: 'Member' },
      { sid: '250047494', name: 'Ng Kwan Yeung', classCode: 'IT114115/2B', role: 'Member' },
      { sid: '250231955', name: 'Leung Chun Ho Jason', classCode: 'IT114115/2B', role: 'Member' },
    ],
  },
  {
    id: 'grp_a10',
    name: 'A10',
    cohort: 'IT114115 Year 2',
    projectTopic: 'Stock/Delivery monitoring',
    supervisorEmail: 'hli852@vtc.edu.hk',
    supervisorName: 'Harry Li',
    coSupervisorEmails: ['cywong@vtc.edu.hk'],
    assessorEmail: 'cywong@vtc.edu.hk',
    assessorName: 'Cyrus Wong',
    students: [
      { sid: '250114843', name: 'Ting Ka Chun', classCode: 'IT114115/2B', role: 'Leader' },
      { sid: '250437785', name: 'Tsoi Kai Shing', classCode: 'IT114115/2B', role: 'Member' },
      { sid: '250002058', name: 'Yan Kit Fai', classCode: 'IT114115/2B', role: 'Member' },
    ],
  },
  {
    id: 'grp_a11',
    name: 'A11',
    cohort: 'IT114115 Year 2',
    projectTopic: 'HealthTech + IOT (Heart rate, Ox, Temp)',
    supervisorEmail: 'james.chan@vtc.edu.hk',
    supervisorName: 'James Chan',
    coSupervisorEmails: ['cywong@vtc.edu.hk'],
    assessorEmail: 'cywong@vtc.edu.hk',
    assessorName: 'Cyrus Wong',
    students: [
      { sid: '250044688', name: 'CHAN Ka Ming', classCode: 'IT114115/2B', role: 'Leader' },
      { sid: '250018289', name: 'LI Jia Bao', classCode: 'IT114115/2B', role: 'Member' },
      { sid: '250216860', name: 'LEE Tsz Him', classCode: 'IT114115/2B', role: 'Member' },
      { sid: '250105348', name: 'KWOK Chun Ting', classCode: 'IT114115/2B', role: 'Member' },
    ],
  },

  // ================= IT314115 Year 2&3 (L01 - L04, E01 - E02) =================
  {
    id: 'grp_l01',
    name: 'L01',
    cohort: 'IT314115 Year 3 (EL3A)',
    projectTopic: 'AI weather adaptive life planning',
    supervisorEmail: 'kcheung@vtc.edu.hk',
    supervisorName: 'Kitson Cheung',
    coSupervisorEmails: ['cywong@vtc.edu.hk'],
    assessorEmail: 'cywong@vtc.edu.hk',
    assessorName: 'Cyrus Wong',
    students: [
      { sid: '240060771', name: 'CHAN Kwan Lam', classCode: 'IT314115/EL3A', role: 'Leader' },
      { sid: '240207539', name: 'LAU Ka Chun', classCode: 'IT314115/EL3A', role: 'Member' },
      { sid: '240075803', name: 'NGAN Ka Ho Alex', classCode: 'IT314115/EL3A', role: 'Member' },
      { sid: '240000701', name: 'HUI Hiu Tung', classCode: 'IT314115/EL3A', role: 'Member' },
    ],
  },
  {
    id: 'grp_l02',
    name: 'L02',
    cohort: 'IT314115 Year 3 (EL3A)',
    projectTopic: 'Mr. Typing',
    supervisorEmail: 'kcheung@vtc.edu.hk',
    supervisorName: 'Kitson Cheung',
    coSupervisorEmails: ['cywong@vtc.edu.hk'],
    assessorEmail: 'cywong@vtc.edu.hk',
    assessorName: 'Cyrus Wong',
    students: [
      { sid: '240021898', name: 'NG Cheuk Nam', classCode: 'IT314115/EL3A', role: 'Leader' },
      { sid: '240032089', name: 'CHENG Ho Hin', classCode: 'IT314115/EL3A', role: 'Member' },
      { sid: '240118973', name: 'SUN Ming Ho', classCode: 'IT314115/EL3A', role: 'Member' },
      { sid: '240016495', name: 'YUEN Ka Ho', classCode: 'IT314115/EL3A', role: 'Member' },
    ],
  },
  {
    id: 'grp_l03',
    name: 'L03',
    cohort: 'IT314115 Year 3 (EL3A)',
    projectTopic: 'AI Vet',
    supervisorEmail: 'kcheung@vtc.edu.hk',
    supervisorName: 'Kitson Cheung',
    coSupervisorEmails: ['cywong@vtc.edu.hk'],
    assessorEmail: 'cywong@vtc.edu.hk',
    assessorName: 'Cyrus Wong',
    students: [
      { sid: '240115749', name: 'CHEUNG Hon Chung Klaus', classCode: 'IT314115/EL3A', role: 'Leader' },
      { sid: '240395638', name: 'KWAN Chung Yeung', classCode: 'IT314115/EL3A', role: 'Member' },
      { sid: '240133915', name: 'YIP Tik Hei', classCode: 'IT314115/EL3A', role: 'Member' },
      { sid: '240064849', name: 'Leung Kwun Ho', classCode: 'IT314115/EL3A', role: 'Member' },
    ],
  },
  {
    id: 'grp_l04',
    name: 'L04',
    cohort: 'IT314115 Year 3 (EL3A)',
    projectTopic: 'Last Minute AI PPT Generator',
    supervisorEmail: 'kcheung@vtc.edu.hk',
    supervisorName: 'Kitson Cheung',
    coSupervisorEmails: ['cywong@vtc.edu.hk'],
    assessorEmail: 'cywong@vtc.edu.hk',
    assessorName: 'Cyrus Wong',
    students: [
      { sid: '240096780', name: 'LI Yixun', classCode: 'IT314115/EL3A', role: 'Leader' },
      { sid: '240068431', name: 'LAM Ka Lok', classCode: 'IT314115/EL3A', role: 'Member' },
      { sid: '240070125', name: 'KONG Tsz Yik', classCode: 'IT314115/EL3A', role: 'Member' },
      { sid: '240054518', name: 'WAN Ka Yu', classCode: 'IT314115/EL3A', role: 'Member' },
    ],
  },
  {
    id: 'grp_e01',
    name: 'E01',
    cohort: 'IT314115 Year 2 (EL2A — EMSD)',
    projectTopic: 'Earn & Learn Industry Project (EMSD)',
    supervisorEmail: 'kcheung@vtc.edu.hk',
    supervisorName: 'Kitson Cheung',
    coSupervisorEmails: ['cywong@vtc.edu.hk'],
    assessorEmail: 'cywong@vtc.edu.hk',
    assessorName: 'Cyrus Wong',
    students: [
      { sid: '250392775', name: 'LI Pak Lim', classCode: 'IT314115/EL2A', role: 'Leader' },
      { sid: '250599067', name: 'LI Kim Fung', classCode: 'IT314115/EL2A', role: 'Member' },
      { sid: '250031367', name: 'LEE Ming Him', classCode: 'IT314115/EL2A', role: 'Member' },
      { sid: '250003922', name: 'TANG Ki Wai', classCode: 'IT314115/EL2A', role: 'Member' },
    ],
  },
  {
    id: 'grp_e02',
    name: 'E02',
    cohort: 'IT314115 Year 2 (EL2A — HKT)',
    projectTopic: 'Earn & Learn Industry Project (HKT)',
    supervisorEmail: 'kcheung@vtc.edu.hk',
    supervisorName: 'Kitson Cheung',
    coSupervisorEmails: ['cywong@vtc.edu.hk'],
    assessorEmail: 'cywong@vtc.edu.hk',
    assessorName: 'Cyrus Wong',
    students: [
      { sid: '250323388', name: 'CHAN Sham Jayson', classCode: 'IT314115/EL2A', role: 'Leader' },
      { sid: '250044707', name: 'CHAN Tak Ching', classCode: 'IT314115/EL2A', role: 'Member' },
      { sid: '250250576', name: 'CHEN Sing Yu', classCode: 'IT314115/EL2A', role: 'Member' },
      { sid: '250018554', name: 'LAW Wai', classCode: 'IT314115/EL2A', role: 'Member' },
    ],
  },
];

function splitCsvRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseFormResponses2Csv(csvText, semesterStartMondayStr, hydratedGroups) {
  const lines = String(csvText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return {
      entries: [],
      weeks: [],
      groupNames: [],
      summary: { totalEntries: 0, genuineCount: 0, vagueCount: 0, suspectedAiCount: 0, inactiveNoCount: 0 },
    };
  }

  const startMonday = new Date(`${semesterStartMondayStr}T00:00:00+08:00`);
  const groupBySid = new Map();
  const nameBySid = new Map();
  const supervisorByGroup = new Map();

  for (const grp of hydratedGroups) {
    supervisorByGroup.set(grp.name.toUpperCase(), {
      email: grp.supervisorEmail,
      name: grp.supervisorName,
    });
    for (const m of grp.members) {
      groupBySid.set(m.studentId, grp.name.toUpperCase());
      nameBySid.set(m.studentId, m.name);
    }
  }

  const rawRows = lines.slice(1).map((line) => splitCsvRow(line));
  const entries = [];
  const weekSet = new Set();
  const groupSet = new Set(hydratedGroups.map((g) => g.name.toUpperCase()));

  let genuineCount = 0;
  let vagueCount = 0;
  let suspectedAiCount = 0;
  let inactiveNoCount = 0;

  for (const cells of rawRows) {
    const timestamp = cells[0] || '';
    const rawGroup = String(cells[1] || '').trim().toUpperCase();
    const rawName = String(cells[2] || '').trim();
    const rawSidDigits = String(cells[3] || '').replace(/\D/g, '');
    const rawSup = String(cells[4] || '').trim();
    const doingStr = String(cells[5] || '').trim().toLowerCase();
    const workDone = String(cells[6] || '').trim();
    const unfinished = String(cells[7] || '').trim();
    const nextPlan = String(cells[8] || '').trim();
    const inactiveReason = String(cells[9] || '').trim();

    if (!timestamp && !rawSidDigits && !rawName) continue;

    // Heal 8-digit or 9-digit typo if a known 9-digit SID matches by name
    let sid = rawSidDigits;
    if (!groupBySid.has(sid) && rawName) {
      for (const [knownSid, knownName] of nameBySid.entries()) {
        if (knownName.toLowerCase().includes(rawName.toLowerCase())) {
          sid = knownSid;
          break;
        }
      }
    }
    if (!sid) continue;

    const email = `${sid}@stu.vtc.edu.hk`;
    const groupId = groupBySid.get(sid) || (rawGroup.match(/^[ALE]\d{2}$/) ? rawGroup : 'UNASSIGNED');
    if (groupId !== 'UNASSIGNED') groupSet.add(groupId);

    const parsedDate = new Date(timestamp);
    let weekNumber = 1;
    if (!Number.isNaN(parsedDate.getTime()) && !Number.isNaN(startMonday.getTime())) {
      const diffDays = Math.floor((parsedDate.getTime() - startMonday.getTime()) / (1000 * 60 * 60 * 24));
      weekNumber = Math.max(1, Math.min(40, Math.floor(diffDays / 7) + 1));
    }
    weekSet.add(weekNumber);

    const isDoingSomething = doingStr === 'yes' || doingStr === 'true' || doingStr === 'y';
    let qualityStatus = 'genuine';
    let qualityScore = 8;
    let qualityReason = 'Specific technical progress and next-week plan recorded.';
    let suggestedChallengeQuestions = [
      `Can you demonstrate the working implementation of "${workDone.slice(0, 80)}" on your screen right now?`,
    ];

    if (!isDoingSomething) {
      qualityStatus = 'inactive_no';
      qualityScore = 2;
      qualityReason = `Student reported "No" work this week (${inactiveReason || 'no reason given'}).`;
      inactiveNoCount++;
      suggestedChallengeQuestions = [
        `You reported "No" progress in Week ${weekNumber} (${inactiveReason || 'no reason'}). What concrete task will you complete and demo by next week?`,
      ];
    } else if (workDone.length < 15 || /^(done|ok|yes|nothing|same|n\/a|nil|finish|finished|working)$/i.test(workDone)) {
      qualityStatus = 'vague_useless';
      qualityScore = 2;
      qualityReason = `Vague or one-word log ("${workDone}") without verifiable technical detail.`;
      vagueCount++;
      suggestedChallengeQuestions = [
        `[Challenge Vague Log] Your Week ${weekNumber} log only states "${workDone}". Please open your IDE/Git history and show the exact files you modified.`,
      ];
    } else {
      genuineCount++;
    }

    entries.push({
      timestamp,
      weekNumber,
      groupId,
      studentId: sid,
      email,
      studentName: nameBySid.get(sid) || rawName || sid,
      supervisor: supervisorByGroup.get(groupId)?.name || rawSup || '',
      isDoingSomething,
      workDone,
      unfinished,
      nextPlan,
      inactiveReason,
      qualityStatus,
      qualityScore,
      qualityReason,
      suggestedChallengeQuestions,
    });
  }

  const weeks = [...weekSet].sort((a, b) => a - b);
  const groupNames = [...groupSet].sort();

  return {
    entries,
    weeks,
    groupNames,
    summary: {
      totalEntries: entries.length,
      genuineCount,
      vagueCount,
      suspectedAiCount,
      inactiveNoCount,
    },
  };
}

function buildProfilesForFirestore(parsedLogData, hydratedGroups) {
  const entriesByEmail = new Map();
  for (const e of parsedLogData.entries) {
    if (!entriesByEmail.has(e.email)) {
      entriesByEmail.set(e.email, []);
    }
    entriesByEmail.get(e.email).push(e);
  }

  const allStudentsMap = new Map();
  for (const grp of hydratedGroups) {
    for (const m of grp.members) {
      allStudentsMap.set(m.email, {
        key: m.email,
        uid: m.uid,
        email: m.email,
        studentId: m.studentId,
        name: m.name,
        groupId: grp.id,
        groupName: grp.name,
        groupCode: grp.name,
        supervisorEmail: grp.supervisorEmail,
        supervisorName: grp.supervisorName,
      });
    }
  }

  for (const e of parsedLogData.entries) {
    if (!allStudentsMap.has(e.email)) {
      allStudentsMap.set(e.email, {
        key: e.email,
        uid: e.email,
        email: e.email,
        studentId: e.studentId,
        name: e.studentName,
        groupId: `grp_${e.groupId.toLowerCase()}`,
        groupName: e.groupId,
        groupCode: e.groupId,
        supervisorEmail: 'cywong@vtc.edu.hk',
        supervisorName: e.supervisor || 'Supervisor',
      });
    }
  }

  const activeWeeksCount = parsedLogData.weeks.length;
  const profiles = [];

  for (const [email, stu] of allStudentsMap.entries()) {
    const stuEntries = (entriesByEmail.get(email) || []).sort((a, b) => a.weekNumber - b.weekNumber);
    // Keep latest entry per week
    const latestByWeek = new Map();
    for (const e of stuEntries) {
      latestByWeek.set(e.weekNumber, e);
    }

    const weeklyTimeline = parsedLogData.weeks.map((wk) => {
      const logEntry = latestByWeek.get(wk) || null;
      return {
        weekNumber: wk,
        submitted: Boolean(logEntry),
        logEntry,
        logQualityStatus: logEntry ? logEntry.qualityStatus : 'missing',
        logQualityScore: logEntry ? logEntry.qualityScore : 0,
        challengeQuestions: logEntry ? logEntry.suggestedChallengeQuestions : [],
        attendanceStatus: 'no_meeting',
        meetingsCount: 0,
      };
    });

    const submittedLogs = [...latestByWeek.values()];
    const totalWeeksSubmitted = submittedLogs.length;
    const activeYesWeeks = submittedLogs.filter((l) => l.isDoingSomething).length;
    const inactiveNoWeeks = submittedLogs.filter((l) => !l.isDoingSomething).length;
    const genuineLogsCount = submittedLogs.filter((l) => l.qualityStatus === 'genuine').length;
    const vagueLogsCount = submittedLogs.filter((l) => l.qualityStatus === 'vague_useless').length;
    const suspectedAiLogsCount = submittedLogs.filter((l) => l.qualityStatus === 'suspected_ai_fake').length;
    const missingWeeksCount = Math.max(0, activeWeeksCount - totalWeeksSubmitted);
    const submissionRatePct =
      activeWeeksCount > 0 ? Math.round((totalWeeksSubmitted / activeWeeksCount) * 100) : 0;

    const avgLogQualityScore =
      totalWeeksSubmitted > 0
        ? Number(
            (
              submittedLogs.reduce((sum, l) => sum + (Number(l.qualityScore) || 0), 0) /
              totalWeeksSubmitted
            ).toFixed(1)
          )
        : 0;

    const logQualityGrade =
      avgLogQualityScore >= 8
        ? 'A (High-Quality Logs)'
        : avgLogQualityScore >= 6.5
        ? 'B (Good)'
        : avgLogQualityScore >= 5
        ? 'C (Needs Detail)'
        : totalWeeksSubmitted > 0
        ? 'D (Low / Vague Logs)'
        : 'N/A (No Logs Yet)';

    const riskFlags = [];
    if (vagueLogsCount > 0) riskFlags.push(`🔴 ${vagueLogsCount} Vague Log(s)`);
    if (inactiveNoWeeks >= 2) riskFlags.push(`⚪ ${inactiveNoWeeks} Inactive ("No") Weeks`);
    if (missingWeeksCount >= 2) riskFlags.push(`⚠️ ${missingWeeksCount} Missing Weeks`);

    profiles.push({
      ...stu,
      totalWeeksSubmitted,
      activeYesWeeks,
      inactiveNoWeeks,
      genuineLogsCount,
      vagueLogsCount,
      suspectedAiLogsCount,
      missingWeeksCount,
      submissionRatePct,
      avgLogQualityScore,
      logQualityGrade,
      meetingsHeld: 0,
      meetingsAttended: 0,
      meetingAttendancePct: null,
      verifiedTasksCount: 0,
      riskFlags,
      weeklyTimeline,
      ingestedWeeklyLogs: stuEntries,
    });
  }

  return profiles;
}

async function getOrCreateUserPreservingPassword(email, role, displayName) {
  try {
    const existing = await auth.getUserByEmail(email);
    const currentClaims = existing.customClaims || {};
    if (currentClaims.role !== role) {
      await auth.setCustomUserClaims(existing.uid, { ...currentClaims, role });
    }
    return existing;
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      const defaultPassword = process.env.DEFAULT_STUDENT_PASSWORD || 'IT114115';
      console.log(`✨ Creating new Auth user: ${email} (${role}) — ${displayName}`);
      const created = await auth.createUser({
        email,
        password: defaultPassword,
        emailVerified: true,
        displayName,
      });
      await auth.setCustomUserClaims(created.uid, { role });
      return created;
    }
    throw err;
  }
}

async function main() {
  console.log(`\n===================================================================`);
  console.log(`🚀 Provisioning Final Year Project Class in Project: ${projectId}`);
  console.log(`   Class ID: ${CLASS_ID}`);
  console.log(`   Schedule: 2026-09-01 to 2027-05-04 (Wed 08:30–12:30 HKT)`);
  console.log(`===================================================================\n`);

  // 1. Resolve Teachers
  const teacherMap = {};
  const teacherUidByEmail = {};
  const teacherEmails = [];
  for (const t of TEACHERS) {
    const email = t.email.toLowerCase();
    teacherEmails.push(email);
    const tUser = await getOrCreateUserPreservingPassword(email, 'teacher', t.displayName);
    teacherMap[tUser.uid] = email;
    teacherUidByEmail[email] = tUser.uid;
    console.log(`👨‍🏫 Teacher ready: ${t.displayName} <${email}> (UID: ${tUser.uid})`);
  }

  // 2. Resolve All 65 Students & Build Group Member Rosters
  const studentMap = {};
  const studentEmails = [];
  const studentProfilesMap = {};
  const studentAuthRecords = [];
  const hydratedGroups = [];

  for (const grp of FYP_GROUPS) {
    const hydratedMembers = [];
    for (const stu of grp.students) {
      const sid = String(stu.sid).trim();
      const email = `${sid}@stu.vtc.edu.hk`;
      const zhName = CHINESE_NAME_BY_SID[sid] || '';
      const fullDisplayName = zhName ? `${stu.name} (${zhName})` : stu.name;
      const programme = stu.classCode.startsWith('IT314115')
        ? 'HD in Cloud and Data Centre Administration (Earn & Learn IT314115)'
        : 'HD in Cloud and Data Centre Administration (IT114115)';

      const sUser = await getOrCreateUserPreservingPassword(email, 'student', fullDisplayName);
      studentMap[sUser.uid] = email;
      if (!studentEmails.includes(email)) {
        studentEmails.push(email);
      }

      studentProfilesMap[email] = {
        uid: sUser.uid,
        email,
        studentId: sid,
        studentName: fullDisplayName,
        nickname: zhName || stu.name,
        programme,
        studentClass: stu.classCode,
        projectGroup: grp.name,
      };

      studentAuthRecords.push({
        uid: sUser.uid,
        email,
        studentId: sid,
        studentName: fullDisplayName,
        nickname: zhName || stu.name,
        programme,
        studentClass: stu.classCode,
        projectGroup: grp.name,
      });

      hydratedMembers.push({
        uid: sUser.uid,
        email,
        studentId: sid,
        name: fullDisplayName,
        studentClass: stu.classCode,
        role: stu.role || 'Member',
      });
    }

    hydratedGroups.push({
      ...grp,
      supervisorUid: teacherUidByEmail[grp.supervisorEmail] || '',
      members: hydratedMembers,
    });
  }

  console.log(`\n✅ Resolved ${hydratedGroups.length} Project Groups and ${studentEmails.length} Students.`);

  // 3. Fetch & Parse Live Weekly Log Sheet (Form Responses 2) to Backfill Student Contribution Profiles
  // Start date 2026-09-01 (Tuesday) -> Week 1 Monday is 2026-08-31
  const semesterStartMonday = '2026-08-31';

  console.log(`\n📥 Fetching Weekly Log Sheet CSV from Form Responses 2...`);
  const csvRes = await fetch(WEEKLY_LOG_CSV_EXPORT_URL);
  if (!csvRes.ok) {
    throw new Error(`Failed to fetch Weekly Log CSV: HTTP ${csvRes.status}`);
  }
  const rawCsvText = await csvRes.text();

  const parsedLogData = parseFormResponses2Csv(rawCsvText, semesterStartMonday, hydratedGroups);
  const builtProfiles = buildProfilesForFirestore(parsedLogData, hydratedGroups);

  const lastEntryTimestamp =
    parsedLogData.entries.length > 0
      ? parsedLogData.entries[parsedLogData.entries.length - 1].timestamp || ''
      : '';
  const csvSignature = `${parsedLogData.entries.length}__${lastEntryTimestamp}`;

  console.log(
    `📊 Parsed ${parsedLogData.summary.totalEntries} Weekly Logs across Weeks [${parsedLogData.weeks.join(', ')}] for ${builtProfiles.length} Student Profiles.`
  );

  // 4. Write Class Document to Firestore
  const classPayload = {
    name: 'IT114115 / IT314115 Final Year Project (AY2026-27)',
    programme: 'HD in Cloud and Data Centre Administration (IT114115 Year 2 & IT314115 Year 2&3)',
    ownerEmail: 'cywong@vtc.edu.hk',
    teacherEmail: 'cywong@vtc.edu.hk',
    teacherEmails,
    studentEmails,
    teachers: teacherMap,
    students: studentMap,
    studentProfiles: studentProfilesMap,
    retentionDays: 180,
    videoRetentionDays: 365,
    storageQuota: 20 * 1024 * 1024 * 1024,
    aiQuota: 200,
    schedule: {
      startDate: '2026-09-01',
      endDate: '2027-05-04',
      timeZone: 'Asia/Hong_Kong',
      timeSlots: [{ startTime: '08:30', endTime: '12:30', days: ['Wed'] }],
    },
    ipRestrictions: [],
    automaticCapture: false,
    automaticCombine: false,
    isCapturing: false,
    frameRate: 15,
    imageQuality: 50,
    maxImageSize: 0.1 * 1024 * 1024,
    captureMode: 'dual',
    aiModel: 'gemini-3.5-flash-lite',
    requireFullScreenOnly: false,
    enableAudioInvigilation: false,
    projectGroupingSheetUrl: GROUPING_SHEET_URL,
    projectLogSheetUrl: WEEKLY_LOG_SHEET_URL,
    projectLogLastSyncedAt: new Date().toISOString(),
    projectLogSummary: {
      ...parsedLogData.summary,
      weeks: parsedLogData.weeks,
      groupCount: hydratedGroups.length,
      studentProfileCount: builtProfiles.length,
      lastEntryTimestamp,
      csvSignature,
    },
    updatedAt: FieldValue.serverTimestamp(),
  };

  await db.collection('classes').doc(CLASS_ID).set(classPayload, { merge: true });
  console.log(`✅ Saved Class Document: classes/${CLASS_ID}`);

  // 5. Link Class to teacherProfiles & studentProfiles
  const profileBatch = db.batch();
  for (const tUid of Object.keys(teacherMap)) {
    profileBatch.set(
      db.collection('teacherProfiles').doc(tUid),
      {
        classes: FieldValue.arrayUnion(CLASS_ID),
        email: teacherMap[tUid],
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  for (const s of studentAuthRecords) {
    profileBatch.set(
      db.collection('studentProfiles').doc(s.uid),
      {
        classes: FieldValue.arrayUnion(CLASS_ID),
        email: s.email,
        studentId: s.studentId,
        studentName: s.studentName,
        nickname: s.nickname,
        programme: s.programme,
        studentClass: s.studentClass,
        projectGroup: s.projectGroup,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  await profileBatch.commit();
  console.log(`✅ Linked ${Object.keys(teacherMap).length} teachers and ${studentAuthRecords.length} students to ${CLASS_ID}.`);

  // 6. Write 17 Project Groups into classes/{CLASS_ID}/projectGroups/{groupId}
  const groupsBatch = db.batch();
  for (const grp of hydratedGroups) {
    groupsBatch.set(
      db.collection(`classes/${CLASS_ID}/projectGroups`).doc(grp.id),
      {
        name: grp.name,
        cohort: grp.cohort,
        projectTopic: grp.projectTopic,
        supervisorEmail: grp.supervisorEmail,
        supervisorName: grp.supervisorName,
        supervisorUid: grp.supervisorUid,
        coSupervisorEmails: [
          ...new Set([
            ...(grp.coSupervisorEmails || []),
            ...(isDevProject
              ? ['teacher1@vtc.edu.hk', 'teacher2@vtc.edu.hk', 'teacher3@vtc.edu.hk']
              : []),
          ]),
        ],
        assessorEmail: grp.assessorEmail || 'cywong@vtc.edu.hk',
        assessorName: grp.assessorName || 'Cyrus Wong',
        members: grp.members,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  await groupsBatch.commit();
  console.log(`✅ Created ${hydratedGroups.length} Project Groups in classes/${CLASS_ID}/projectGroups.`);

  // 7. Write Backfilled Student Contribution Profiles into classes/{CLASS_ID}/projectStudentProfiles/{email}
  const studentProfilesBatch = db.batch();
  let backfilledCount = 0;
  for (const prof of builtProfiles) {
    studentProfilesBatch.set(
      db.collection(`classes/${CLASS_ID}/projectStudentProfiles`).doc(prof.email),
      {
        ...prof,
        lastSyncedAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    backfilledCount++;
  }
  await studentProfilesBatch.commit();
  console.log(
    `✅ Backfilled ${backfilledCount} Student Contribution Profiles in classes/${CLASS_ID}/projectStudentProfiles.\n`
  );
}

main()
  .then(() => {
    console.log('🎉 Final Year Project Class provisioning in Production complete!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Error provisioning FYP Class:', err);
    process.exit(1);
  });
