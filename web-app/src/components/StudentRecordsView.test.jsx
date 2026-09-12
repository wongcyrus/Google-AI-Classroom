import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import StudentRecordsView, { isRecordInLesson, parseTimeMs, isExamRecord } from './StudentRecordsView';

vi.mock('../firebase-config', () => ({
  db: {},
  storage: {},
  functions: {},
}));

const mockHttpsCallable = vi.fn();
vi.mock('firebase/functions', () => ({
  httpsCallable: (...args) => mockHttpsCallable(...args),
}));

const mockGetDownloadURL = vi.fn().mockResolvedValue('https://storage.mock/video.mp4');
vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  getDownloadURL: (...args) => mockGetDownloadURL(...args),
}));

const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, col, id) => ({ id, col })),
  collection: vi.fn((db, ...path) => ({ path })),
  query: vi.fn((...args) => ({ args })),
  where: vi.fn((field, op, val) => ({ field, op, val })),
  getDoc: (...args) => mockGetDoc(...args),
  getDocs: (...args) => mockGetDocs(...args),
}));

vi.mock('./VideoPlayerModal', () => ({
  default: ({ show, onClose, videoUrl }) =>
    show ? (
      <div data-testid="video-player-modal">
        <span>Video URL: {videoUrl}</span>
        <button onClick={onClose}>Close Player</button>
      </div>
    ) : null,
}));

describe('StudentRecordsView Component', () => {
  const mockUser = {
    uid: 'student-test-123',
    email: 'student@vtc.edu.hk',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock for getDoc: profile has classes ['CLASS_A']
    mockGetDoc.mockImplementation(async (docRef) => {
      if (docRef.col === 'studentProfiles' || docRef.id === 'student-test-123') {
        return {
          exists: () => true,
          data: () => ({ classes: ['CLASS_A'] }),
        };
      }
      if (docRef.col === 'classes' || docRef.id === 'CLASS_A') {
        return {
          exists: () => true,
          id: 'CLASS_A',
          data: () => ({ name: 'Cloud Computing 101' }),
        };
      }
      return { exists: () => false };
    });

    // Default mock for getDocs
    mockGetDocs.mockImplementation(async (queryOrCol) => {
      const args = queryOrCol?.args || [];
      const colPath = queryOrCol?.path || (args[0]?.path);

      if (colPath && colPath.includes('videoJobs')) {
        return {
          docs: [
            {
              id: 'job_1',
              data: () => ({
                classId: 'CLASS_A',
                studentUid: 'student-test-123',
                videoPath: 'videos/CLASS_A/job_1.mp4',
                status: 'completed',
                duration: 120,
                size: 1048576,
                startTime: '2026-09-12T10:00:00Z',
              }),
            },
          ],
        };
      }

      if (colPath && colPath.includes('irregularities')) {
        return {
          docs: [
            {
              id: 'irreg_1',
              data: () => ({
                classId: 'CLASS_A',
                studentUid: 'student-test-123',
                type: 'LOOKING AWAY',
                severity: 'medium',
                reason: 'Gaze direction deviated from monitor',
                timestamp: '2026-09-12T10:15:00Z',
                metadata: { details: 'Gaze yaw +32 deg' },
              }),
            },
          ],
        };
      }

      if (colPath && colPath.includes('audio')) {
        return {
          docs: [
            {
              id: 'audio_1',
              data: () => ({
                classId: 'CLASS_A',
                studentUid: 'student-test-123',
                language: '廣東話',
                transcript: '唔該老師，我想問個問題關於Docker配置。',
                timestamp: '2026-09-12T10:20:00Z',
              }),
            },
          ],
        };
      }

      if (colPath && colPath.includes('performanceMetrics')) {
        return {
          docs: [
            {
              id: 'metric_1',
              data: () => ({
                classId: 'CLASS_A',
                studentUid: 'student-test-123',
                taskName: 'Kubernetes Pod Deployment',
                status: 'completed',
                durationMinutes: 25,
                stepDetails: 'Step 3: Service Exposure completed',
                timestamp: '2026-09-12T10:30:00Z',
              }),
            },
          ],
        };
      }

      if (colPath && colPath.includes('progress')) {
        return {
          docs: [
            {
              id: 'prog_1',
              data: () => ({
                classId: 'CLASS_A',
                studentUid: 'student-test-123',
                taskName: 'Kubernetes Pod Deployment',
                currentStep: 3,
                totalSteps: 4,
                feedback: 'Completed 3 of 4 lab steps successfully.',
                timestamp: '2026-09-12T10:45:00Z',
              }),
            },
          ],
        };
      }

      if (colPath && colPath.includes('aiJobs')) {
        return {
          docs: [
            {
              id: 'ai_1',
              data: () => ({
                classId: 'CLASS_A',
                studentUid: 'student-test-123',
                taskName: 'Kubernetes Pod Deployment',
                status: 'completed',
                result: 'Excellent container configuration.',
                timestamp: '2026-09-12T10:55:00Z',
              }),
            },
          ],
        };
      }

      if (colPath && colPath.includes('lessons')) {
        return {
          docs: [
            {
              id: 'lesson_1',
              data: () => ({
                startTime: '2026-09-12T09:00:00Z',
                endTime: '2026-09-12T10:00:00Z',
                generalSummary: 'Comprehensive introduction to Docker containers.',
                generalFeedback: 'Class engaged actively in lab tasks.',
                students: {
                  'student-test-123': {
                    sharedScreenMinutes: 55,
                    workingMinutes: 48,
                    attendance: [1, 1, 1, 1, 0, 1],
                    feedback: 'Active participation throughout the lab session.',
                  },
                },
              }),
            },
          ],
        };
      }

      return { docs: [] };
    });
  });

  it('renders student records view title and summary KPI counters', async () => {
    render(<StudentRecordsView user={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText('My Classroom Records')).toBeInTheDocument();
    });

    // Check KPI counters
    await waitFor(() => {
      expect(screen.getByText('Recorded Videos')).toBeInTheDocument();
      expect(screen.getByText('Lab Tasks Completed')).toBeInTheDocument();
      expect(screen.getByText('Proctoring Flags')).toBeInTheDocument();
      expect(screen.getByText('AI Estimated Working')).toBeInTheDocument();
    });
  });

  it('renders compiled video recordings tab and triggers video playback modal', async () => {
    mockHttpsCallable.mockReturnValue(vi.fn().mockResolvedValue({ data: { url: 'https://cdn.signed/video.mp4' } }));

    render(<StudentRecordsView user={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText('Session Video Screencasts')).toBeInTheDocument();
    });

    // Verify video job row is rendered
    expect(screen.getByText('CLASS_A')).toBeInTheDocument();
    expect(screen.getByText('2m 0s')).toBeInTheDocument();

    const watchBtn = screen.getByText('▶ Watch');
    fireEvent.click(watchBtn);

    await waitFor(() => {
      expect(screen.getByTestId('video-player-modal')).toBeInTheDocument();
      expect(screen.getByText('Close Player')).toBeInTheDocument();
    });

    // Close modal
    fireEvent.click(screen.getByText('Close Player'));
    await waitFor(() => {
      expect(screen.queryByTestId('video-player-modal')).not.toBeInTheDocument();
    });
  });

  it('switches to Attendance tab and displays the 3 distinct ratios and minute-by-minute timeline', async () => {
    render(<StudentRecordsView user={mockUser} />);

    const attendanceTab = await screen.findByRole('tab', { name: /Attendance & Lessons/i });
    fireEvent.click(attendanceTab);

    await waitFor(() => {
      expect(screen.getByText('Attendance & Lesson Participation')).toBeInTheDocument();
      expect(screen.getByText('Active participation throughout the lab session.')).toBeInTheDocument();
    });

    // Verify the 3 Core Ratios are rendered
    expect(screen.getByText('1. Attendance Presence')).toBeInTheDocument();
    expect(screen.getByText('2. Screen Sharing Ratio')).toBeInTheDocument();
    expect(screen.getByText('3. AI Working Minutes')).toBeInTheDocument();

    // Verify numeric breakdowns in the ratio cards
    expect(screen.getByText(/55 min of 60 min shared/i)).toBeInTheDocument();
    expect(screen.getByText(/48 min of 60 min working/i)).toBeInTheDocument();

    // Verify minute-by-minute timeline grid
    expect(screen.getByText(/Minute-by-Minute Attendance Timeline/i)).toBeInTheDocument();
    expect(screen.getByText('Present (Active)')).toBeInTheDocument();
    expect(screen.getByText('Inactive / Absent')).toBeInTheDocument();
  });

  it('toggles between Per Lesson Breakdown and All Lessons Summary in Attendance tab', async () => {
    render(<StudentRecordsView user={mockUser} />);

    const attendanceTab = await screen.findByRole('tab', { name: /Attendance & Lessons/i });
    fireEvent.click(attendanceTab);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Per Lesson Breakdown/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /All Lessons Summary/i })).toBeInTheDocument();
    });

    // Switch to All Lessons Summary view
    const allLessonsBtn = screen.getByRole('button', { name: /All Lessons Summary/i });
    fireEvent.click(allLessonsBtn);

    await waitFor(() => {
      expect(screen.getByText('Cumulative Attendance')).toBeInTheDocument();
      expect(screen.getByText('Screen Sharing Rate')).toBeInTheDocument();
      expect(screen.getByText('AI Working Rate')).toBeInTheDocument();
      expect(screen.getByText('Sessions Attended')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Inspect Lesson/i })).toBeInTheDocument();
    });

    // Click Inspect Lesson to switch back to Per Lesson view
    const inspectBtn = screen.getByRole('button', { name: /Inspect Lesson/i });
    fireEvent.click(inspectBtn);

    await waitFor(() => {
      expect(screen.getByText('1. Attendance Presence')).toBeInTheDocument();
    });
  });

  it('switches to Tasks tab and renders performance metrics and AI job results', async () => {
    render(<StudentRecordsView user={mockUser} />);

    const tasksTab = await screen.findByRole('tab', { name: /Tasks & AI Progress/i });
    fireEvent.click(tasksTab);

    await waitFor(() => {
      expect(screen.getByText('Completed Lab Tasks & Progress')).toBeInTheDocument();
      expect(screen.getByText('Kubernetes Pod Deployment')).toBeInTheDocument();
      expect(screen.getByText('Completed 3 of 4 lab steps successfully.')).toBeInTheDocument();
      expect(screen.getByText('Excellent container configuration.')).toBeInTheDocument();
    });
  });

  it('switches to Integrity & Alerts tab and displays irregularity logs', async () => {
    render(<StudentRecordsView user={mockUser} />);

    const irregTab = await screen.findByRole('tab', { name: /Integrity & Alerts/i });
    fireEvent.click(irregTab);

    await waitFor(() => {
      expect(screen.getByText('Invigilation & Proctoring Logs')).toBeInTheDocument();
      expect(screen.getByText('LOOKING AWAY')).toBeInTheDocument();
      expect(screen.getByText('Gaze direction deviated from monitor')).toBeInTheDocument();
      expect(screen.getByText(/Gaze yaw \+32 deg/)).toBeInTheDocument();
    });
  });

  it('switches to Audio Transcripts tab and displays speech transcripts', async () => {
    render(<StudentRecordsView user={mockUser} />);

    const audioTab = await screen.findByRole('tab', { name: /Audio Transcripts/i });
    fireEvent.click(audioTab);

    await waitFor(() => {
      expect(screen.getByText('Monitored Audio Transcripts')).toBeInTheDocument();
      expect(screen.getByText(/唔該老師，我想問個問題/)).toBeInTheDocument();
      expect(screen.getByText('廣東話')).toBeInTheDocument();
    });
  });

  it('enforces strict single-class scoping without any "all" classes fallback', async () => {
    render(<StudentRecordsView user={mockUser} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Class:/i)).toBeInTheDocument();
    });

    const select = screen.getByLabelText(/Class:/i);
    expect(select.value).toBe('CLASS_A');

    // Confirm that there is NO "all" option mixing up data
    const allOption = screen.queryByRole('option', { name: /All Enrolled Classes/i });
    expect(allOption).not.toBeInTheDocument();
  });

  it('enforces disabled screen recordings policy and displays security banner and locked buttons', async () => {
    mockGetDoc.mockImplementation(async (docRef) => {
      if (docRef.col === 'studentProfiles' || docRef.id === 'student-test-123') {
        return { exists: () => true, data: () => ({ classes: ['CLASS_EXAM'] }) };
      }
      if (docRef.col === 'classes' || docRef.id === 'CLASS_EXAM') {
        return {
          exists: () => true,
          id: 'CLASS_EXAM',
          data: () => ({
            name: 'Midterm Exam Class',
            studentRecordingsPolicy: 'disabled',
          }),
        };
      }
      return { exists: () => false };
    });

    mockGetDocs.mockImplementation(async (queryOrCol) => {
      const args = queryOrCol?.args || [];
      const colPath = queryOrCol?.path || (args[0]?.path);
      if (colPath && colPath.includes('videoJobs')) {
        return {
          docs: [
            {
              id: 'job_exam_1',
              data: () => ({
                classId: 'CLASS_EXAM',
                studentUid: 'student-test-123',
                videoPath: 'videos/CLASS_EXAM/job_1.mp4',
                status: 'completed',
                duration: 180,
                size: 2048576,
                startTime: '2026-09-12T10:00:00Z',
              }),
            },
          ],
        };
      }
      return { docs: [] };
    });

    render(<StudentRecordsView user={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText(/Midterm Exam Class \(CLASS_EXAM\)/i)).toBeInTheDocument();
    });

    // Verify security banner
    await waitFor(() => {
      expect(screen.getByText(/Assessment Integrity Active: Screen Recordings Disabled/i)).toBeInTheDocument();
    });

    // Verify locked badge and locked button
    expect(screen.getByText(/Restricted \(Test Material\)/i)).toBeInTheDocument();
    const lockedBtn = screen.getByRole('button', { name: /Locked/i });
    expect(lockedBtn).toBeInTheDocument();
    expect(lockedBtn).toBeDisabled();

    // Verify Watch button does not exist for this locked video
    expect(screen.queryByRole('button', { name: /▶ Watch/i })).not.toBeInTheDocument();
  });

  it('enforces delayed_release policy when release date is in the future', async () => {
    const futureDate = '2030-01-01T00:00:00Z';
    mockGetDoc.mockImplementation(async (docRef) => {
      if (docRef.col === 'studentProfiles' || docRef.id === 'student-test-123') {
        return { exists: () => true, data: () => ({ classes: ['CLASS_DELAY'] }) };
      }
      if (docRef.col === 'classes' || docRef.id === 'CLASS_DELAY') {
        return {
          exists: () => true,
          id: 'CLASS_DELAY',
          data: () => ({
            name: 'Final Project Exam',
            studentRecordingsPolicy: 'delayed_release',
            studentRecordingsReleaseDate: futureDate,
          }),
        };
      }
      return { exists: () => false };
    });

    mockGetDocs.mockImplementation(async (queryOrCol) => {
      const args = queryOrCol?.args || [];
      const colPath = queryOrCol?.path || (args[0]?.path);
      if (colPath && colPath.includes('videoJobs')) {
        return {
          docs: [
            {
              id: 'job_delayed_1',
              data: () => ({
                classId: 'CLASS_DELAY',
                studentUid: 'student-test-123',
                videoPath: 'videos/CLASS_DELAY/job_1.mp4',
                status: 'completed',
                duration: 120,
                size: 1048576,
              }),
            },
          ],
        };
      }
      return { docs: [] };
    });

    render(<StudentRecordsView user={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText(/Final Project Exam \(CLASS_DELAY\)/i)).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText(/Scheduled Post-Exam Release/i)).toBeInTheDocument();
    });

    const lockedBtn = screen.getByRole('button', { name: /Locked/i });
    expect(lockedBtn).toBeInTheDocument();
    expect(lockedBtn).toBeDisabled();
  });

  it('strictly excludes videos from defined exam periods and displays assessment integrity notice', async () => {
    mockGetDoc.mockImplementation(async (docRef) => {
      if (docRef.col === 'studentProfiles' || docRef.id === 'student-test-123') {
        return { exists: () => true, data: () => ({ classes: ['CLASS_MIXED'] }) };
      }
      if (docRef.col === 'classes' || docRef.id === 'CLASS_MIXED') {
        return {
          exists: () => true,
          id: 'CLASS_MIXED',
          data: () => ({
            name: 'Hybrid Lab & Exam Class',
            examPeriods: [
              {
                id: 'ep1',
                name: 'Midterm Examination',
                startDate: '2026-10-25T14:00:00Z',
                endDate: '2026-10-25T16:00:00Z',
              },
            ],
          }),
        };
      }
      return { exists: () => false };
    });

    mockGetDocs.mockImplementation(async (queryOrCol) => {
      const args = queryOrCol?.args || [];
      const colPath = queryOrCol?.path || (args[0]?.path);
      if (colPath && colPath.includes('videoJobs')) {
        return {
          docs: [
            {
              id: 'job_regular',
              data: () => ({
                classId: 'CLASS_MIXED',
                studentUid: 'student-test-123',
                videoPath: 'videos/CLASS_MIXED/job_regular.mp4',
                status: 'completed',
                duration: 120,
                size: 1048576,
                startTime: '2026-10-20T14:00:00Z',
                isExam: false,
              }),
            },
            {
              id: 'job_exam',
              data: () => ({
                classId: 'CLASS_MIXED',
                studentUid: 'student-test-123',
                videoPath: 'videos/CLASS_MIXED/job_exam.mp4',
                status: 'completed',
                duration: 180,
                size: 2048576,
                startTime: '2026-10-25T14:30:00Z',
                isExam: true,
              }),
            },
          ],
        };
      }
      return { docs: [] };
    });

    render(<StudentRecordsView user={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText(/Hybrid Lab & Exam Class \(CLASS_MIXED\)/i)).toBeInTheDocument();
    });

    // Verify assessment integrity banner is shown
    await waitFor(() => {
      expect(screen.getByText(/Assessment Integrity: Exam Period Recordings Restricted/i)).toBeInTheDocument();
      expect(screen.getByText(/withheld from student view to protect assessment questions/i)).toBeInTheDocument();
    });

    // Regular job is shown with Watch button
    expect(screen.getByRole('button', { name: /▶ Watch/i })).toBeInTheDocument();

    // Exam job is strictly excluded from the table
    expect(screen.queryByText('3m 0s')).not.toBeInTheDocument();
  });

  describe('isRecordInLesson matching logic', () => {
    const lesson = {
      lessonId: 'lesson_w1',
      classId: 'CLASS_A',
      startTime: '2026-09-01T09:00:00Z',
      endTime: '2026-09-01T10:00:00Z',
      duration: 60,
    };

    it('matches by direct lessonId', () => {
      expect(isRecordInLesson({ lessonId: 'lesson_w1', classId: 'CLASS_A' }, lesson)).toBe(true);
      expect(isRecordInLesson({ lessonId: 'lesson_w2', classId: 'CLASS_A' }, lesson)).toBe(false);
    });

    it('rejects if classId does not match', () => {
      expect(isRecordInLesson({ lessonId: 'lesson_w1', classId: 'CLASS_B' }, lesson)).toBe(false);
    });

    it('matches records falling within start and end time buffer', () => {
      // 10 minutes before start (within 30m pre-buffer)
      expect(isRecordInLesson({ timestamp: '2026-09-01T08:50:00Z', classId: 'CLASS_A' }, lesson)).toBe(true);
      // In the middle of lesson
      expect(isRecordInLesson({ timestamp: '2026-09-01T09:30:00Z', classId: 'CLASS_A' }, lesson)).toBe(true);
      // 40 minutes after lesson end (within 60m post-buffer)
      expect(isRecordInLesson({ timestamp: '2026-09-01T10:40:00Z', classId: 'CLASS_A' }, lesson)).toBe(true);
      // 2 hours before start (outside window)
      expect(isRecordInLesson({ timestamp: '2026-09-01T07:00:00Z', classId: 'CLASS_A' }, lesson)).toBe(false);
      // Next week (outside window)
      expect(isRecordInLesson({ timestamp: '2026-09-08T09:30:00Z', classId: 'CLASS_A' }, lesson)).toBe(false);
    });
  });

  it('filters all tabs (videos, tasks, alerts, audio) to the selected lesson and allows viewing all lessons', async () => {
    // Setup two lessons a week apart with records in each
    mockGetDoc.mockImplementation(async (docRef) => {
      if (docRef.col === 'studentProfiles' || docRef.id === 'student-test-123') {
        return {
          exists: () => true,
          data: () => ({ classes: ['CLASS_FILTER_TEST'] }),
        };
      }
      if (docRef.col === 'classes' || docRef.id === 'CLASS_FILTER_TEST') {
        return {
          exists: () => true,
          id: 'CLASS_FILTER_TEST',
          data: () => ({ name: 'Filter Verification Class' }),
        };
      }
      return { exists: () => false };
    });

    mockGetDocs.mockImplementation(async (queryOrCol) => {
      const args = queryOrCol?.args || [];
      const colPath = queryOrCol?.path || (args[0]?.path);

      if (colPath && colPath.includes('lessons')) {
        return {
          docs: [
            {
              id: 'lesson_sept_08',
              data: () => ({
                classId: 'CLASS_FILTER_TEST',
                startTime: '2026-09-08T09:00:00Z',
                endTime: '2026-09-08T10:00:00Z',
                duration: 60,
                students: {
                  'student-test-123': {
                    sharedScreenMinutes: 45,
                    workingMinutes: 40,
                    attendance: [1, 1, 1],
                  },
                },
              }),
            },
            {
              id: 'lesson_sept_01',
              data: () => ({
                classId: 'CLASS_FILTER_TEST',
                startTime: '2026-09-01T09:00:00Z',
                endTime: '2026-09-01T10:00:00Z',
                duration: 60,
                students: {
                  'student-test-123': {
                    sharedScreenMinutes: 50,
                    workingMinutes: 45,
                    attendance: [1, 1, 1],
                  },
                },
              }),
            },
          ],
        };
      }

      if (colPath && colPath.includes('videoJobs')) {
        return {
          docs: [
            {
              id: 'video_sept_08',
              data: () => ({
                classId: 'CLASS_FILTER_TEST',
                studentUid: 'student-test-123',
                videoPath: 'videos/CLASS_FILTER_TEST/sept08.mp4',
                status: 'completed',
                duration: 300,
                size: 3000000,
                startTime: '2026-09-08T09:10:00Z',
              }),
            },
            {
              id: 'video_sept_01',
              data: () => ({
                classId: 'CLASS_FILTER_TEST',
                studentUid: 'student-test-123',
                videoPath: 'videos/CLASS_FILTER_TEST/sept01.mp4',
                status: 'completed',
                duration: 180,
                size: 2000000,
                startTime: '2026-09-01T09:15:00Z',
              }),
            },
          ],
        };
      }

      if (colPath && colPath.includes('performanceMetrics')) {
        return {
          docs: [
            {
              id: 'metric_sept_08',
              data: () => ({
                classId: 'CLASS_FILTER_TEST',
                studentUid: 'student-test-123',
                taskName: 'Week 2: Advanced Cloud Deploy',
                status: 'completed',
                timestamp: '2026-09-08T09:40:00Z',
              }),
            },
            {
              id: 'metric_sept_01',
              data: () => ({
                classId: 'CLASS_FILTER_TEST',
                studentUid: 'student-test-123',
                taskName: 'Week 1: Basic Intro Lab',
                status: 'completed',
                timestamp: '2026-09-01T09:40:00Z',
              }),
            },
          ],
        };
      }

      if (colPath && colPath.includes('irregularities')) {
        return {
          docs: [
            {
              id: 'irreg_sept_08',
              data: () => ({
                classId: 'CLASS_FILTER_TEST',
                studentUid: 'student-test-123',
                type: 'LOOKING AWAY WEEK 2',
                severity: 'medium',
                reason: 'Week 2 glance away',
                timestamp: '2026-09-08T09:25:00Z',
              }),
            },
            {
              id: 'irreg_sept_01',
              data: () => ({
                classId: 'CLASS_FILTER_TEST',
                studentUid: 'student-test-123',
                type: 'LOOKING AWAY WEEK 1',
                severity: 'medium',
                reason: 'Week 1 glance away',
                timestamp: '2026-09-01T09:25:00Z',
              }),
            },
          ],
        };
      }

      if (colPath && colPath.includes('audio')) {
        return {
          docs: [
            {
              id: 'audio_sept_08',
              data: () => ({
                classId: 'CLASS_FILTER_TEST',
                studentUid: 'student-test-123',
                transcript: 'Week 2 audio question about Terraform',
                timestamp: '2026-09-08T09:35:00Z',
              }),
            },
            {
              id: 'audio_sept_01',
              data: () => ({
                classId: 'CLASS_FILTER_TEST',
                studentUid: 'student-test-123',
                transcript: 'Week 1 audio question about Docker basics',
                timestamp: '2026-09-01T09:35:00Z',
              }),
            },
          ],
        };
      }

      return { docs: [] };
    });

    render(<StudentRecordsView user={mockUser} />);

    // Initially, defaults to latest lesson (Sept 8)
    await waitFor(() => {
      expect(screen.getAllByText(/Filter Verification Class/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Showing records for lesson:/i)).toBeInTheDocument();
    });

    // In Videos tab: Week 2 video (5m 0s) is visible; Week 1 (3m 0s) is filtered out
    expect(screen.getByText('5m 0s')).toBeInTheDocument();
    expect(screen.queryByText('3m 0s')).not.toBeInTheDocument();

    // In Tasks tab:
    const tasksTab = screen.getByRole('tab', { name: /Tasks & AI Progress/i });
    fireEvent.click(tasksTab);
    await waitFor(() => {
      expect(screen.getByText('Week 2: Advanced Cloud Deploy')).toBeInTheDocument();
      expect(screen.queryByText('Week 1: Basic Intro Lab')).not.toBeInTheDocument();
    });

    // In Integrity tab:
    const alertsTab = screen.getByRole('tab', { name: /Integrity & Alerts/i });
    fireEvent.click(alertsTab);
    await waitFor(() => {
      expect(screen.getByText('LOOKING AWAY WEEK 2')).toBeInTheDocument();
      expect(screen.queryByText('LOOKING AWAY WEEK 1')).not.toBeInTheDocument();
    });

    // In Audio tab:
    const audioTab = screen.getByRole('tab', { name: /Audio Transcripts/i });
    fireEvent.click(audioTab);
    await waitFor(() => {
      expect(screen.getByText(/Week 2 audio question about Terraform/i)).toBeInTheDocument();
      expect(screen.queryByText(/Week 1 audio question about Docker basics/i)).not.toBeInTheDocument();
    });

    // Now switch to "All Lessons / Full Semester"
    const lessonSelector = screen.getByLabelText(/Lesson \/ Date:/i);
    fireEvent.change(lessonSelector, { target: { value: 'all' } });

    // Audio tab should now show both week 1 and week 2 audio
    await waitFor(() => {
      expect(screen.getByText(/Week 2 audio question about Terraform/i)).toBeInTheDocument();
      expect(screen.getByText(/Week 1 audio question about Docker basics/i)).toBeInTheDocument();
    });

    // Switch back to Tasks tab: both tasks should be visible
    fireEvent.click(tasksTab);
    await waitFor(() => {
      expect(screen.getByText('Week 2: Advanced Cloud Deploy')).toBeInTheDocument();
      expect(screen.getByText('Week 1: Basic Intro Lab')).toBeInTheDocument();
    });
  });

  it('generates scheduled lessons from class schedule even when no lesson documents exist in Firestore subcollection', async () => {
    mockGetDoc.mockImplementation(async (docRef) => {
      if (docRef.col === 'studentProfiles' || docRef.id === 'student-test-123') {
        return {
          exists: () => true,
          data: () => ({ classes: ['CLASS_SCHEDULED'] }),
        };
      }
      if (docRef.id === 'CLASS_SCHEDULED') {
        return {
          exists: () => true,
          id: 'CLASS_SCHEDULED',
          data: () => ({
            name: 'Daily Schedule Demo',
            schedule: {
              startDate: '2026-09-01',
              endDate: '2026-09-03',
              timeZone: 'UTC',
              timeSlots: [
                { days: ['Tue', 'Wed', 'Thu'], startTime: '09:00', endTime: '10:00' },
              ],
            },
          }),
        };
      }
      return { exists: () => false };
    });

    // No lesson documents in subcollection
    mockGetDocs.mockImplementation(async (queryOrCol) => {
      return { docs: [] };
    });

    render(<StudentRecordsView user={mockUser} />);

    await waitFor(() => {
      expect(screen.getAllByText(/Daily Schedule Demo/i).length).toBeGreaterThan(0);
    });

    // Dropdown should be populated with generated scheduled lessons
    await waitFor(() => {
      const lessonSelector = screen.getByLabelText(/Lesson \/ Date:/i);
      expect(lessonSelector).toBeInTheDocument();
      // Should have "All Lessons" option + 3 scheduled days
      expect(lessonSelector.children.length).toBe(4);
    });
  });

  it('synthesizes discovered lessons for all student screencasts ensuring dropdown shows all 3 lessons when screens have 3 recordings', async () => {
    mockGetDoc.mockImplementation(async (docRef) => {
      if (docRef.col === 'studentProfiles' || docRef.id === 'student-test-123') {
        return {
          exists: () => true,
          data: () => ({ classes: ['CLASS_3_SCREENS'] }),
        };
      }
      if (docRef.id === 'CLASS_3_SCREENS') {
        return {
          exists: () => true,
          id: 'CLASS_3_SCREENS',
          data: () => ({
            name: 'Demo Class 3 Screens',
            schedule: null, // No fixed schedule
          }),
        };
      }
      return { exists: () => false };
    });

    // Only 1 lesson document in Firestore subcollection (Sept 1)
    mockGetDocs.mockImplementation(async (queryOrCol) => {
      const args = queryOrCol?.args || [];
      const colPath = queryOrCol?.path || (args[0]?.path);

      if (colPath && colPath.includes('videoJobs')) {
        return {
          docs: [
            {
              id: 'job_sep1',
              data: () => ({
                classId: 'CLASS_3_SCREENS',
                studentUid: 'student-test-123',
                status: 'completed',
                duration: 120,
                startTime: '2026-09-01T10:00:00Z',
              }),
            },
            {
              id: 'job_sep4',
              data: () => ({
                classId: 'CLASS_3_SCREENS',
                studentUid: 'student-test-123',
                status: 'completed',
                duration: 180,
                startTime: '2026-09-04T10:00:00Z',
              }),
            },
            {
              id: 'job_sep8',
              data: () => ({
                classId: 'CLASS_3_SCREENS',
                studentUid: 'student-test-123',
                status: 'completed',
                duration: 240,
                startTime: '2026-09-08T10:00:00Z',
              }),
            },
          ],
        };
      }

      if (colPath && colPath.includes('lessons')) {
        return {
          docs: [
            {
              id: 'lesson_doc_sep1',
              data: () => ({
                startTime: '2026-09-01T10:00:00Z',
                endTime: '2026-09-01T11:00:00Z',
                students: {
                  'student-test-123': {
                    attendance: [1, 1],
                    sharedScreenMinutes: 2,
                    workingMinutes: 2,
                  },
                },
              }),
            },
          ],
        };
      }

      return { docs: [] };
    });

    render(<StudentRecordsView user={mockUser} />);

    await waitFor(() => {
      expect(screen.getAllByText(/Demo Class 3 Screens/i).length).toBeGreaterThan(0);
    });

    // The dropdown MUST have all 3 lessons (Sept 8, Sept 4, Sept 1) + All Lessons option
    await waitFor(() => {
      const lessonSelector = screen.getByLabelText(/Lesson \/ Date:/i);
      expect(lessonSelector).toBeInTheDocument();
      // Total options = 1 ("All Lessons (3)") + 3 lesson options = 4 options
      expect(lessonSelector.children.length).toBe(4);
      expect(screen.getByText(/All Lessons \/ Full Semester \(3\)/i)).toBeInTheDocument();
    });

    // Selecting each lesson displays the corresponding screen recording
    const lessonSelector = screen.getByLabelText(/Lesson \/ Date:/i);
    
    // Switch to All Lessons
    fireEvent.change(lessonSelector, { target: { value: 'all' } });
    await waitFor(() => {
      expect(screen.getByText('2m 0s')).toBeInTheDocument();
      expect(screen.getByText('3m 0s')).toBeInTheDocument();
      expect(screen.getByText('4m 0s')).toBeInTheDocument();
    });
  });

  it('includes lessons even if student has no studentEntry yet without dropping them from the lesson list', async () => {
    mockGetDoc.mockImplementation(async (docRef) => {
      if (docRef.col === 'studentProfiles' || docRef.id === 'student-test-123') {
        return {
          exists: () => true,
          data: () => ({ classes: ['CLASS_ABSENT'] }),
        };
      }
      if (docRef.id === 'CLASS_ABSENT') {
        return {
          exists: () => true,
          id: 'CLASS_ABSENT',
          data: () => ({ name: 'Attendance Test Class' }),
        };
      }
      return { exists: () => false };
    });

    // Lesson doc has other students, but NOT student-test-123
    mockGetDocs.mockImplementation(async (queryOrCol) => {
      const args = queryOrCol?.args || [];
      const colPath = queryOrCol?.path || (args[0]?.path);

      if (colPath && colPath.includes('lessons')) {
        return {
          docs: [
            {
              id: 'lesson_other_student_only',
              data: () => ({
                startTime: '2026-09-02T09:00:00Z',
                endTime: '2026-09-02T10:00:00Z',
                students: {
                  'other-student-999': {
                    attendance: [1, 1],
                  },
                },
              }),
            },
          ],
        };
      }
      return { docs: [] };
    });

    render(<StudentRecordsView user={mockUser} />);

    await waitFor(() => {
      expect(screen.getAllByText(/Attendance Test Class/i).length).toBeGreaterThan(0);
    });

    // The lesson must NOT be dropped, it must appear in the dropdown and show 0% attendance
    await waitFor(() => {
      const lessonSelector = screen.getByLabelText(/Lesson \/ Date:/i);
      expect(lessonSelector).toBeInTheDocument();
      expect(lessonSelector.children.length).toBe(2); // "All Lessons (1)" + 1 lesson
    });

    // Switch to Attendance tab
    const attTab = screen.getByRole('tab', { name: /Attendance & Lessons/i });
    fireEvent.click(attTab);

    await waitFor(() => {
      expect(screen.getAllByText('0.00%').length).toBeGreaterThan(0);
      expect(screen.getByText(/🔴 Absent/i)).toBeInTheDocument();
    });
  });

  describe('isExamRecord helper and exam privacy safeguards', () => {
    const classWithExams = {
      id: 'CLASS_ASSESSMENT',
      name: 'Assessment Guarded Class',
      examPeriods: [
        {
          id: 'exam_1',
          name: 'Midterm Exam',
          startDate: '2026-11-15T14:00:00Z',
          endDate: '2026-11-15T16:00:00Z',
        },
      ],
    };

    it('returns true when record explicitly has isExam flag or lessonType=exam', () => {
      expect(isExamRecord({ isExam: true }, classWithExams)).toBe(true);
      expect(isExamRecord({ lessonType: 'exam' }, classWithExams)).toBe(true);
      expect(isExamRecord({ isExam: true }, null)).toBe(true);
      expect(isExamRecord({ lessonType: 'exam' }, null)).toBe(true);
    });

    it('returns true when record timestamp falls within class examPeriods', () => {
      // startTime in exam period
      expect(isExamRecord({ startTime: '2026-11-15T14:30:00Z' }, classWithExams)).toBe(true);
      // createdAt in exam period
      expect(isExamRecord({ createdAt: '2026-11-15T15:00:00Z' }, classWithExams)).toBe(true);
      // timestamp in exam period
      expect(isExamRecord({ timestamp: '2026-11-15T15:59:00Z' }, classWithExams)).toBe(true);
    });

    it('returns false for records outside exam periods', () => {
      // 10 minutes before exam
      expect(isExamRecord({ startTime: '2026-11-15T13:50:00Z' }, classWithExams)).toBe(false);
      // 10 minutes after exam
      expect(isExamRecord({ startTime: '2026-11-15T16:10:00Z' }, classWithExams)).toBe(false);
      // completely different date
      expect(isExamRecord({ startTime: '2026-11-10T14:00:00Z' }, classWithExams)).toBe(false);
    });

    it('handles edge cases safely without errors', () => {
      expect(isExamRecord(null, classWithExams)).toBe(false);
      expect(isExamRecord({}, classWithExams)).toBe(false);
      expect(isExamRecord({ startTime: 'invalid-date' }, classWithExams)).toBe(false);
      expect(isExamRecord({ startTime: '2026-11-15T14:30:00Z' }, {})).toBe(false);
      expect(isExamRecord({ startTime: '2026-11-15T14:30:00Z' }, { examPeriods: [] })).toBe(false);
    });

    it('strictly prevents exam recordings from synthesizing discovered lessons in the dropdown', async () => {
      mockGetDoc.mockImplementation(async (docRef) => {
        if (docRef.col === 'studentProfiles' || docRef.id === 'student-test-123') {
          return { exists: () => true, data: () => ({ classes: ['CLASS_EXAM_SYNTH'] }) };
        }
        if (docRef.id === 'CLASS_EXAM_SYNTH') {
          return {
            exists: () => true,
            id: 'CLASS_EXAM_SYNTH',
            data: () => ({
              name: 'Exam Synth Test Class',
              examPeriods: [
                {
                  id: 'ep_nov',
                  name: 'Term Test',
                  startDate: '2026-11-20T10:00:00Z',
                  endDate: '2026-11-20T12:00:00Z',
                },
              ],
            }),
          };
        }
        return { exists: () => false };
      });

      mockGetDocs.mockImplementation(async (queryOrCol) => {
        const args = queryOrCol?.args || [];
        const colPath = queryOrCol?.path || (args[0]?.path);

        if (colPath && colPath.includes('videoJobs')) {
          return {
            docs: [
              {
                id: 'job_regular_lab',
                data: () => ({
                  classId: 'CLASS_EXAM_SYNTH',
                  studentUid: 'student-test-123',
                  status: 'completed',
                  duration: 120,
                  startTime: '2026-11-10T10:00:00Z',
                  isExam: false,
                }),
              },
              {
                id: 'job_exam_session',
                data: () => ({
                  classId: 'CLASS_EXAM_SYNTH',
                  studentUid: 'student-test-123',
                  status: 'completed',
                  duration: 120,
                  startTime: '2026-11-20T10:30:00Z',
                  isExam: true,
                }),
              },
            ],
          };
        }

        // 0 lesson docs in Firestore
        return { docs: [] };
      });

      render(<StudentRecordsView user={mockUser} />);

      await waitFor(() => {
        expect(screen.getAllByText(/Exam Synth Test Class/i).length).toBeGreaterThan(0);
      });

      // Regular lab creates 1 synthetic lesson.
      // Exam session MUST NOT create a synthetic lesson!
      // Total dropdown options should be 2: "All Lessons (1)" + 1 regular lesson.
      await waitFor(() => {
        const selector = screen.getByLabelText(/Lesson \/ Date:/i);
        expect(selector).toBeInTheDocument();
        expect(selector.children.length).toBe(2);
        expect(screen.getByText(/All Lessons \/ Full Semester \(1\)/i)).toBeInTheDocument();
      });
    });
  });
});

