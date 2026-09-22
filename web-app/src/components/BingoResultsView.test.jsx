import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BingoResultsView from './BingoResultsView';
import * as exportUtils from '../utils/exportUtils';

let mockSnapshotCallback = null;

function triggerSnapshot(dataList = []) {
  act(() => {
    if (mockSnapshotCallback) {
      mockSnapshotCallback({
        forEach: (fn) => dataList.forEach((r) => fn({ id: r.id, data: () => r })),
      });
    }
  });
}

vi.mock('../firebase-config', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
  getDocs: vi.fn().mockResolvedValue({ forEach: vi.fn() }),
  onSnapshot: vi.fn((ref, callback, errCallback) => {
    mockSnapshotCallback = callback;
    return () => {};
  }),
}));

describe('BingoResultsView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleRecords = [
    {
      id: 'bingo_1',
      studentUid: 'student_1',
      studentEmail: 'student1@stu.vtc.edu.hk',
      question: 'What port is standard for HTTPS?',
      options: ['80', '443', '22', '8080'],
      correctIndex: 1,
      selectedIndex: 1,
      selectedOptionText: '443',
      result: 'passed',
      responseTimeSec: 4.5,
      questionSource: 'question_bank',
      strikeNumber: 1,
      windowFocused: true,
      issuedAtMillis: 1789640000000,
    },
    {
      id: 'bingo_2',
      studentUid: 'student_2',
      studentEmail: 'student2@stu.vtc.edu.hk',
      question: 'What port is standard for HTTPS?',
      options: ['80', '443', '22', '8080'],
      correctIndex: 1,
      selectedIndex: 0,
      selectedOptionText: '80',
      result: 'failed_incorrect',
      responseTimeSec: 8.2,
      questionSource: 'question_bank',
      strikeNumber: 1,
      windowFocused: true,
      issuedAtMillis: 1789640001000,
    },
    {
      id: 'bingo_3',
      studentUid: 'student_3',
      studentEmail: 'student3@stu.vtc.edu.hk',
      question: 'What port is standard for HTTPS?',
      options: ['80', '443', '22', '8080'],
      correctIndex: 1,
      selectedIndex: null,
      selectedOptionText: null,
      result: 'missed_timeout',
      responseTimeSec: 45,
      questionSource: 'question_bank',
      strikeNumber: 2,
      windowFocused: false,
      issuedAtMillis: 1789640002000,
    },
  ];

  it('renders loading state initially before records arrive', () => {
    render(<BingoResultsView classId="IT114115-Demo" />);
    expect(screen.getByText(/Loading Bingo Challenges.../i)).toBeInTheDocument();
  });

  it('renders empty state when snapshot returns 0 records', () => {
    render(<BingoResultsView classId="IT114115-Demo" />);
    
    // Simulate empty Firestore snapshot
    triggerSnapshot([]);

    expect(screen.getByText(/No Bingo Challenges Recorded Yet/i)).toBeInTheDocument();
  });

  it('renders KPI summary cards correctly for incoming challenges', () => {
    render(<BingoResultsView classId="IT114115-Demo" />);

    // Feed sample records
    triggerSnapshot(sampleRecords);

    // Check KPI values
    expect(screen.getAllByText('3').length).toBeGreaterThan(0); // Total challenged
    expect(screen.getAllByText('33%').length).toBe(2); // Pass rate (1 of 3) and Timeout rate (1 of 3)
    expect(screen.getAllByText(/Verified Present/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Incorrect Choice/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Timed Out/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/OS Window Focus/i)).toBeInTheDocument();
  });

  it('renders question and correct answer option highlighted in green', () => {
    render(<BingoResultsView classId="IT114115-Demo" />);

    triggerSnapshot(sampleRecords);

    // Question text
    expect(screen.getByText('What port is standard for HTTPS?')).toBeInTheDocument();

    // Correct answer badge
    expect(screen.getByText(/✓ Correct Answer/i)).toBeInTheDocument();

    // Options exist
    expect(screen.getAllByText('80').length).toBeGreaterThan(0);
    expect(screen.getAllByText('443').length).toBeGreaterThan(0);
    expect(screen.getByText('22')).toBeInTheDocument();
    expect(screen.getByText('8080')).toBeInTheDocument();
  });

  it('renders student table with answers, latency, focus status, and strikes', () => {
    render(<BingoResultsView classId="IT114115-Demo" />);

    triggerSnapshot(sampleRecords);

    expect(screen.getByText('student1@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.getByText('student2@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.getByText('student3@stu.vtc.edu.hk')).toBeInTheDocument();

    // Result badges
    expect(screen.getAllByText('✅ Verified Present').length).toBeGreaterThan(0);
    expect(screen.getAllByText('❌ Incorrect Choice').length).toBeGreaterThan(0);
    expect(screen.getAllByText('⚠️ Timed Out').length).toBeGreaterThan(0);

    // Strike indicators
    expect(screen.getAllByText('Strike 1').length).toBe(2);
    expect(screen.getByText('🚨 Strike 2 (Deduction)')).toBeInTheDocument();

    // Latency
    expect(screen.getByText('4.5s')).toBeInTheDocument();
    expect(screen.getByText('8.2s')).toBeInTheDocument();
  });

  it('filters students by search input', () => {
    render(<BingoResultsView classId="IT114115-Demo" />);

    triggerSnapshot(sampleRecords);

    const searchInput = screen.getByPlaceholderText(/Search student email or UID/i);
    fireEvent.change(searchInput, { target: { value: 'student2' } });

    expect(screen.queryByText('student1@stu.vtc.edu.hk')).not.toBeInTheDocument();
    expect(screen.getByText('student2@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.queryByText('student3@stu.vtc.edu.hk')).not.toBeInTheDocument();
  });

  it('filters students by status tab (Timed Out)', () => {
    render(<BingoResultsView classId="IT114115-Demo" />);

    triggerSnapshot(sampleRecords);

    const timeoutBtn = screen.getByRole('button', { name: /Timed Out/i });
    fireEvent.click(timeoutBtn);

    expect(screen.queryByText('student1@stu.vtc.edu.hk')).not.toBeInTheDocument();
    expect(screen.queryByText('student2@stu.vtc.edu.hk')).not.toBeInTheDocument();
    expect(screen.getByText('student3@stu.vtc.edu.hk')).toBeInTheDocument();
  });

  it('exports filtered data to Excel when export button is clicked', () => {
    const exportSpy = vi.spyOn(exportUtils, 'exportToExcel').mockImplementation(() => {});

    render(<BingoResultsView classId="IT114115-Demo" />);

    triggerSnapshot(sampleRecords);

    const exportBtn = screen.getByRole('button', { name: /Export (Excel|CSV)/i });
    fireEvent.click(exportBtn);

    expect(exportSpy).toHaveBeenCalledTimes(1);
    const [headers, rows, filename] = exportSpy.mock.calls[0];

    expect(headers).toContain('Question');
    expect(headers).toContain('Correct Answer');
    expect(headers).toContain('Student Selected Option');
    expect(headers).toContain('Result Status');
    expect(rows.length).toBe(3);
    expect(filename).toContain('bingo-report-IT114115-Demo');
    expect(filename).toMatch(/\.xlsx$/);
  });

  it('displays screenshot preview and opens lightbox when clicked', () => {
    const recordsWithScreen = [
      {
        ...sampleRecords[0],
        screenshotUrl: 'https://example.com/slide.png',
        observedEvidence: 'Slide showed TCP port 443 in diagram.',
      },
    ];

    render(<BingoResultsView classId="IT114115-Demo" />);

    triggerSnapshot(recordsWithScreen);

    const img = screen.getByAltText('Captured Vision Reference');
    expect(img).toBeInTheDocument();
    expect(screen.getByText(/Slide showed TCP port 443 in diagram/i)).toBeInTheDocument();

    // Click to open lightbox
    fireEvent.click(img);
    expect(screen.getByAltText('Enlarged Vision Screenshot')).toBeInTheDocument();

    // Close lightbox
    const closeBtn = screen.getByText('✕ Close');
    fireEvent.click(closeBtn);
    expect(screen.queryByAltText('Enlarged Vision Screenshot')).not.toBeInTheDocument();
  });

  it('filters challenges by selected lesson time window', () => {
    const lessonStart = new Date('2026-09-17T09:00:00.000Z');
    const lessonEnd = new Date('2026-09-17T11:00:00.000Z');
    const lessons = [
      { start: lessonStart, end: lessonEnd },
    ];

    const recordsAcrossDays = [
      {
        ...sampleRecords[0],
        id: 'record_lesson1',
        issuedAtMillis: new Date('2026-09-17T09:30:00.000Z').getTime(), // Inside lesson window
      },
      {
        ...sampleRecords[1],
        id: 'record_other_day',
        studentEmail: 'otherday@stu.vtc.edu.hk',
        issuedAtMillis: new Date('2026-09-18T14:00:00.000Z').getTime(), // Next day, outside window
      },
    ];

    render(
      <BingoResultsView
        classId="IT114115-Demo"
        lessons={lessons}
        selectedLesson={lessonStart.toISOString()}
        startTime="2026-09-17T09:00"
        endTime="2026-09-17T11:00"
      />
    );

    triggerSnapshot(recordsAcrossDays);

    // Should only show the record from 2026-09-17
    expect(screen.getByText('student1@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.queryByText('otherday@stu.vtc.edu.hk')).not.toBeInTheDocument();

    // Verify Lesson Scope Banner
    expect(screen.getByTestId('bingo-lesson-banner')).toBeInTheDocument();
    expect(screen.getByText(/1 student response across 1 challenge/i)).toBeInTheDocument();
    expect(screen.getByText(/2 total recorded across all dates/i)).toBeInTheDocument();
  });

  it('shows lesson empty state when selected lesson has no challenges and allows resetting to all lessons', () => {
    const lessonStart = new Date('2026-09-17T09:00:00.000Z');
    const lessonEnd = new Date('2026-09-17T11:00:00.000Z');
    const lessons = [{ start: lessonStart, end: lessonEnd }];
    const handleLessonChange = vi.fn();

    const pastRecords = [
      {
        ...sampleRecords[0],
        issuedAtMillis: new Date('2026-09-10T09:30:00.000Z').getTime(), // 7 days earlier
      },
    ];

    render(
      <BingoResultsView
        classId="IT114115-Demo"
        lessons={lessons}
        selectedLesson={lessonStart.toISOString()}
        handleLessonChange={handleLessonChange}
      />
    );

    triggerSnapshot(pastRecords);

    // Empty state should render
    expect(screen.getByTestId('bingo-lesson-empty')).toBeInTheDocument();
    expect(screen.getByText(/No Bingo Checks Recorded in this Lesson/i)).toBeInTheDocument();
    expect(screen.getByText(/There are 1 total verification records available in other class sessions/i)).toBeInTheDocument();

    // Reset button calls handleLessonChange with empty value
    const resetBtn = screen.getByRole('button', { name: /View All Lessons/i });
    fireEvent.click(resetBtn);
    expect(handleLessonChange).toHaveBeenCalledWith({ target: { value: '' } });
  });

  it('does not render duplicate lesson dropdown and follows parent lesson filter', () => {
    const lessonStart1 = new Date('2026-09-17T09:00:00.000Z');
    const lessonEnd1 = new Date('2026-09-17T11:00:00.000Z');
    const lessonStart2 = new Date('2026-09-15T09:00:00.000Z');
    const lessonEnd2 = new Date('2026-09-15T11:00:00.000Z');
    const lessons = [
      { start: lessonStart1, end: lessonEnd1 },
      { start: lessonStart2, end: lessonEnd2 },
    ];
    const handleLessonChange = vi.fn();

    const { rerender } = render(
      <BingoResultsView
        classId="IT114115-Demo"
        lessons={lessons}
        selectedLesson=""
        handleLessonChange={handleLessonChange}
      />
    );

    triggerSnapshot(sampleRecords);

    // Verify duplicate dropdown is not rendered in child view
    expect(screen.queryByLabelText(/Filter by Lesson/i)).toBeNull();
    expect(screen.getByText(/All Recorded Sessions/i)).toBeInTheDocument();

    // Rerender with parent selectedLesson
    rerender(
      <BingoResultsView
        classId="IT114115-Demo"
        lessons={lessons}
        selectedLesson={lessonStart1.toISOString()}
        handleLessonChange={handleLessonChange}
      />
    );

    // Verify banner updates to follow the parent lesson selection
    expect(screen.getByTestId('bingo-lesson-banner')).toBeInTheDocument();
  });

  it('filters by status tabs and previews AI vision screenshot in lightbox', () => {
    const recordsWithEvidence = [
      {
        ...sampleRecords[0],
        screenshotUrl: 'https://example.com/ai-shot.jpg',
        observedEvidence: 'Docker container port configuration on screen',
      },
      {
        ...sampleRecords[1],
        screenshotUrl: 'https://example.com/ai-shot.jpg',
        observedEvidence: 'Docker container port configuration on screen',
      },
    ];

    render(
      <BingoResultsView
        classId="IT114115-Demo"
      />
    );

    triggerSnapshot(recordsWithEvidence);

    // Status filter tabs
    const passedTab = screen.getByRole('button', { name: /Passed \(1\)/i });
    fireEvent.click(passedTab);
    expect(screen.getByText('student1@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.queryByText('student2@stu.vtc.edu.hk')).not.toBeInTheDocument();

    const incorrectTab = screen.getByRole('button', { name: /Incorrect \(1\)/i });
    fireEvent.click(incorrectTab);
    expect(screen.getByText('student2@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.queryByText('student1@stu.vtc.edu.hk')).not.toBeInTheDocument();

    const allTab = screen.getByRole('button', { name: /All \(2\)/i });
    fireEvent.click(allTab);
    expect(screen.getByText('student1@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.getByText('student2@stu.vtc.edu.hk')).toBeInTheDocument();

    // AI vision screenshot lightbox
    const evidenceImg = screen.getByAltText('Captured Vision Reference');
    fireEvent.click(evidenceImg);

    expect(screen.getByAltText('Enlarged Vision Screenshot')).toBeInTheDocument();

    const closeLightboxBtn = screen.getByRole('button', { name: /✕ Close/i });
    fireEvent.click(closeLightboxBtn);

    expect(screen.queryByAltText('Enlarged Vision Screenshot')).not.toBeInTheDocument();

    // Reopen and click overlay backdrop to close
    fireEvent.click(evidenceImg);
    const overlay = document.querySelector('.bingo-lightbox-overlay');
    fireEvent.click(overlay);
    expect(screen.queryByAltText('Enlarged Vision Screenshot')).not.toBeInTheDocument();

    // Round select dropdown
    const roundSelect = screen.getByLabelText(/Filter Round:/i);
    fireEvent.change(roundSelect, { target: { value: 'all' } });

    // Student search input
    const searchInput = screen.getByPlaceholderText(/Search student email or UID/i);
    fireEvent.change(searchInput, { target: { value: 'student1' } });
    expect(screen.getByText('student1@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.queryByText('student2@stu.vtc.edu.hk')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: '' } });
  });

  it('filters by pending status tab when pending records exist', () => {
    const recordsWithPending = [
      ...sampleRecords,
      {
        id: 'bingo_pending',
        studentUid: 'student_99',
        studentEmail: 'student99@stu.vtc.edu.hk',
        question: 'What port is standard for HTTPS?',
        options: ['80', '443', '22', '8080'],
        correctIndex: 1,
        result: 'pending',
        issuedAtMillis: 1789640002000,
      },
    ];

    render(
      <BingoResultsView
        classId="IT114115-Demo"
      />
    );

    triggerSnapshot(recordsWithPending);

    const pendingTab = screen.getByRole('button', { name: /Pending \(1\)/i });
    fireEvent.click(pendingTab);

    expect(screen.getByText('student99@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.queryByText('student1@stu.vtc.edu.hk')).not.toBeInTheDocument();
  });
});
