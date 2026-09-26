import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import TasksManagementView from './TasksManagementView';
import TaskEditorModal from './TaskEditorModal';
import TaskGradingMatrixView from './TaskGradingMatrixView';
import StudentTaskWorkspaceModal from './StudentTaskWorkspaceModal';
import StudentTaskFeedbackView from './StudentTaskFeedbackView';

// Mock Firebase Functions
const mockExtractTaskDemoSteps = vi.fn().mockResolvedValue({
  data: {
    title: 'Extracted Docker Task',
    description: 'Extracted overview of Docker challenge',
    steps: [
      { stepNumber: 1, title: 'Step 1: Write Dockerfile', description: 'Desc 1', points: 40 },
      { stepNumber: 2, title: 'Step 2: Build Image', description: 'Desc 2', points: 60 },
    ],
  },
});

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(),
  httpsCallable: vi.fn(() => (...args) => mockExtractTaskDemoSteps(...args)),
}));

// Mock Firebase Firestore
const mockOnSnapshot = vi.fn();
const mockSetDoc = vi.fn().mockResolvedValue(true);
const mockUpdateDoc = vi.fn().mockResolvedValue(true);
const mockDeleteDoc = vi.fn().mockResolvedValue(true);

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  collection: vi.fn((db, ...path) => ({ path, id: path[path.length - 1] })),
  doc: vi.fn((dbOrCol, ...path) => {
    if (typeof dbOrCol === 'object' && dbOrCol.path) {
      return { path: [...dbOrCol.path, ...path], id: 'generated-doc-id' };
    }
    return { path, id: path[path.length - 1] };
  }),
  query: vi.fn((col, ...clauses) => col),
  where: vi.fn(() => ({})),
  onSnapshot: (...args) => mockOnSnapshot(...args),
  setDoc: (...args) => mockSetDoc(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
  deleteDoc: (...args) => mockDeleteDoc(...args),
}));

// Mock Google Drive Hook
const mockBackupTaskVideosToDrive = vi.fn().mockResolvedValue({ successCount: 1, failedCount: 0 });
const mockConnectGdrive = vi.fn().mockResolvedValue(true);
vi.mock('../../hooks/useGoogleDrive', () => ({
  useGoogleDrive: vi.fn(() => ({
    isConnected: true,
    connectedUser: { email: 'teacher@vtc.edu.hk', name: 'Teacher' },
    baseFolderName: 'Classroom Archives',
    connect: mockConnectGdrive,
    backupTaskVideosToDrive: mockBackupTaskVideosToDrive,
  })),
}));

// Mock Export Utils
const mockExportTaskGradingToExcel = vi.fn();
vi.mock('../../utils/exportUtils', () => ({
  exportTaskGradingToExcel: (...args) => mockExportTaskGradingToExcel(...args),
}));

// Mock Rubric Prompts Library Hook
vi.mock('../../hooks/useRubricPrompts', () => ({
  useRubricPrompts: vi.fn(() => [
    {
      id: 'prompt_docker_rubric',
      name: 'Hands-on Lab Demonstration Rubric Extractor',
      category: 'rubrics',
      accessLevel: 'public',
      promptText: 'Extract chronological lab steps with terminal verification.',
    },
    {
      id: 'prompt_swe_rubric',
      name: 'Software Engineering Project Milestone Extractor',
      category: 'rubrics',
      accessLevel: 'private',
      promptText: 'Extract git and test milestones.',
    },
  ]),
}));

describe('Tasks Component Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /* =========================================================================
     1. TasksManagementView
     ========================================================================= */
  describe('TasksManagementView', () => {
    const mockSchedule = [
      { id: 'lesson_1', title: 'Week 1: Introduction to Docker', date: '2026-09-25' },
    ];
    const mockVideos = ['lectures/docker_demo.mp4', 'lectures/git_demo.mp4'];
    const mockStudents = ['alice@vtc.edu.hk', 'bob@vtc.edu.hk'];

    it('renders loading state initially and then empty state when no tasks exist', () => {
      let snapshotCallback;
      mockOnSnapshot.mockImplementationOnce((ref, onNext) => {
        snapshotCallback = onNext;
        return vi.fn();
      });

      render(
        <TasksManagementView
          classId="class_101"
          classSchedule={mockSchedule}
          availableVideos={mockVideos}
          enrolledStudents={mockStudents}
        />
      );

      expect(screen.getByText(/Loading tasks\.\.\./i)).toBeInTheDocument();

      // Trigger empty snapshot
      act(() => {
        snapshotCallback({ docs: [] });
      });

      expect(screen.getByText(/No Practical Tasks Created Yet/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /\+ Create First Task/i })).toBeInTheDocument();
    });

    it('renders tasks grid with badges, deadlines, and handles status toggling, editing, and deletion', async () => {
      let snapshotCallback;
      mockOnSnapshot.mockImplementationOnce((ref, onNext) => {
        snapshotCallback = onNext;
        return vi.fn();
      });

      const sampleTasks = [
        {
          id: 'task_hw_1',
          title: 'NodeJS API Homework',
          description: 'Build Express routes for CRUD.',
          maxScore: 100,
          scheduleMode: 'homework',
          status: 'published',
          constraints: {
            timing: {
              timeLimitMinutes: 45,
              deadline: { toDate: () => new Date('2026-10-01T23:59:00Z') },
            },
            attempts: { maxAttempts: 2 },
          },
        },
        {
          id: 'task_inclass_2',
          title: 'Docker Live Lab',
          description: 'Live in-class containerization test.',
          maxScore: 50,
          scheduleMode: 'in_class',
          status: 'closed',
          constraints: {
            timing: {
              timeLimitMinutes: 30,
              deadline: '2026-10-05T12:00:00Z',
            },
            attempts: { maxAttempts: 1 },
          },
        },
        {
          id: 'task_flex_3',
          title: 'Flexible Git Challenge',
          scheduleMode: 'flexible',
          status: 'published',
        },
      ];

      render(
        <TasksManagementView
          classId="class_101"
          classSchedule={mockSchedule}
          availableVideos={mockVideos}
          enrolledStudents={mockStudents}
        />
      );

      act(() => {
        snapshotCallback({
          docs: sampleTasks.map((t) => ({ id: t.id, data: () => t })),
        });
      });

      // Verify task cards rendered with correct badges
      expect(screen.getByText('NodeJS API Homework')).toBeInTheDocument();
      expect(screen.getByText('🏠 Homework')).toBeInTheDocument();
      expect(screen.getByText('Docker Live Lab')).toBeInTheDocument();
      expect(screen.getByText('🏫 In-Class')).toBeInTheDocument();
      expect(screen.getByText('Flexible Git Challenge')).toBeInTheDocument();
      expect(screen.getByText('🔄 Flexible')).toBeInTheDocument();

      // Test Status Toggle (lock/unlock)
      const toggleButtons = screen.getAllByTitle(/Close task|Activate task/i);
      fireEvent.click(toggleButtons[0]); // Toggle first task from published to closed
      await waitFor(() => {
        expect(mockUpdateDoc).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ status: 'closed' })
        );
      });

      // Test Edit Task button
      const editButtons = screen.getAllByTitle(/Edit task/i);
      fireEvent.click(editButtons[0]);
      expect(screen.getByText(/Edit Practical Task/i)).toBeInTheDocument();
      expect(screen.getByDisplayValue('NodeJS API Homework')).toBeInTheDocument();

      // Close editor modal
      fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

      // Test Delete Task button with confirm
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const deleteButtons = screen.getAllByTitle(/Delete task/i);
      fireEvent.click(deleteButtons[0]);
      await waitFor(() => {
        expect(mockDeleteDoc).toHaveBeenCalled();
      });
      confirmSpy.mockRestore();
    });

    it('navigates to TaskGradingMatrixView, handles score override, and navigates back', async () => {
      let tasksCallback;
      let subsCallback;
      mockOnSnapshot.mockImplementation((ref, onNext) => {
        if (ref.path.includes('submissions')) {
          subsCallback = onNext;
        } else {
          tasksCallback = onNext;
        }
        return vi.fn();
      });

      const sampleTask = {
        id: 'task_grading_1',
        title: 'Kubernetes Pod Deployment',
        maxScore: 100,
        scheduleMode: 'in_class',
        status: 'published',
        rubricSteps: [{ stepNumber: 1, title: 'Apply manifest', points: 100 }],
      };

      render(
        <TasksManagementView
          classId="class_101"
          classSchedule={mockSchedule}
          availableVideos={mockVideos}
          enrolledStudents={['student1@vtc.edu.hk']}
          studentProfiles={{
            'student1@vtc.edu.hk': { uid: 'student_uid_1', studentName: 'Ken Lau' },
          }}
        />
      );

      act(() => {
        tasksCallback({
          docs: [{ id: sampleTask.id, data: () => sampleTask }],
        });
      });

      // Click Grading Matrix button
      fireEvent.click(screen.getByRole('button', { name: /Grading Matrix/i }));

      // Now inside TaskGradingMatrixView
      expect(screen.getByText('Kubernetes Pod Deployment')).toBeInTheDocument();
      expect(screen.getByText('Ken Lau')).toBeInTheDocument();

      // Emit submission snapshot
      if (subsCallback) {
        act(() => {
          subsCallback({
            docs: [
              {
                id: 'student_uid_1',
                data: () => ({
                  studentUid: 'student_uid_1',
                  email: 'student1@vtc.edu.hk',
                  status: 'evaluated',
                  effectiveScore: 85,
                  evaluation: { finalScore: 85, stepResults: [] },
                }),
              },
            ],
          });
        });
      }

      // Test navigating back to Tasks List
      fireEvent.click(screen.getByRole('button', { name: /Back to Tasks List/i }));
      expect(screen.getByText(/Practical Tasks & Homework/i)).toBeInTheDocument();
    });

    it('creates new task and calls setDoc with published status', async () => {
      mockOnSnapshot.mockImplementationOnce((ref, onNext) => {
        onNext({ docs: [] });
        return vi.fn();
      });

      render(
        <TasksManagementView
          classId="class_101"
          classSchedule={mockSchedule}
          availableVideos={mockVideos}
          enrolledStudents={mockStudents}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /\+?\s*Create Practical Task/i }));
      expect(screen.getByRole('heading', { name: /Create Practical Task/i })).toBeInTheDocument();

      // Enter task title
      const titleInput = screen.getByPlaceholderText(/e\.g\., Dockerizing Node\.js/i);
      fireEvent.change(titleInput, { target: { value: 'New Test Challenge' } });

      // Add a milestone on Tab 3
      fireEvent.click(screen.getByRole('button', { name: /3\. Rubric Milestones/i }));
      fireEvent.click(screen.getByRole('button', { name: /Add Milestone Manually/i }));

      // Save
      fireEvent.click(screen.getByRole('button', { name: /4\. Constraints & Policies/i }));
      fireEvent.click(screen.getByRole('button', { name: /Publish Task/i }));

      await waitFor(() => {
        expect(mockSetDoc).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            title: 'New Test Challenge',
            status: 'published',
          })
        );
      });
    });
  });

  /* =========================================================================
     2. TaskEditorModal
     ========================================================================= */
  describe('TaskEditorModal', () => {
    const mockSchedule = [
      { id: 'lesson_101', title: 'Lesson 1: Intro', date: '2026-09-25' },
    ];
    const mockVideos = ['demos/docker_demo.mp4', 'demos/flask_demo.mp4'];

    it('handles Tab 1 fields and scheduleMode switching', () => {
      render(
        <TaskEditorModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
          classId="class_1"
          classSchedule={mockSchedule}
          availableVideos={mockVideos}
        />
      );

      // Change schedule mode to in_class
      const modeSelect = screen.getByLabelText(/Scheduling Mode/i);
      fireEvent.change(modeSelect, { target: { value: 'in_class' } });
      expect(screen.getByLabelText(/Linked Timetable Lesson/i)).toBeInTheDocument();

      // Select lesson
      const lessonSelect = screen.getByLabelText(/Linked Timetable Lesson/i);
      fireEvent.change(lessonSelect, { target: { value: 'lesson_101' } });
      expect(lessonSelect.value).toBe('lesson_101');
    });

    it('handles Tab 2: Gemini demo video rubric extraction with success and error', async () => {
      render(
        <TaskEditorModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
          classId="class_1"
          classSchedule={mockSchedule}
          availableVideos={mockVideos}
        />
      );

      // Navigate to Tab 2
      fireEvent.click(screen.getByRole('button', { name: /2\. Demo Video & AI/i }));

      // Switch to library mode and select demo video
      fireEvent.click(screen.getByRole('button', { name: /Teacher Lectures \/ Cloud/i }));
      const videoSelect = screen.getByDisplayValue(/Select a teacher lecture recording/i);
      fireEvent.change(videoSelect, { target: { value: 'demos/docker_demo.mp4' } });

      // Enter teacher guidance
      const promptInput = screen.getByPlaceholderText(/Describe how Gemini should break down/i);
      fireEvent.change(promptInput, { target: { value: 'Verify docker run port mapping' } });

      // Click Analyze Video
      const analyzeBtn = screen.getByRole('button', { name: /Synthesize Rubric Milestones with Gemini/i });
      fireEvent.click(analyzeBtn);

      await waitFor(() => {
        expect(mockExtractTaskDemoSteps).toHaveBeenCalledWith(
          expect.objectContaining({
            classId: 'class_1',
            demoVideoPath: 'demos/docker_demo.mp4',
            promptGuidelines: 'Verify docker run port mapping',
          })
        );
        expect(screen.getByText(/Gemini successfully extracted 2 rubric milestones!/i)).toBeInTheDocument();
      });

      // Test extraction failure
      mockExtractTaskDemoSteps.mockRejectedValueOnce(new Error('Quota exceeded'));
      fireEvent.click(analyzeBtn);

      await waitFor(() => {
        expect(screen.getByText(/Gemini step extraction failed: Quota exceeded/i)).toBeInTheDocument();
      });
    });

    it('handles Tab 2: selecting rubric prompt from AI library and synthesizing milestones', async () => {
      render(
        <TaskEditorModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
          classId="class_1"
          classSchedule={mockSchedule}
          availableVideos={mockVideos}
        />
      );

      // Navigate to Tab 2
      fireEvent.click(screen.getByRole('button', { name: /2\. Demo Video & AI/i }));

      // Select demo video
      fireEvent.click(screen.getByRole('button', { name: /Teacher Lectures \/ Cloud/i }));
      const videoSelect = screen.getByDisplayValue(/Select a teacher lecture recording/i);
      fireEvent.change(videoSelect, { target: { value: 'demos/docker_demo.mp4' } });

      // Verify AI Prompts count badge
      expect(screen.getByText(/2 Prompts Available/i)).toBeInTheDocument();

      // Select a prompt from library
      const promptSelect = screen.getByLabelText(/AI Rubric Prompt \(from AI Prompts Library\)/i);
      fireEvent.change(promptSelect, { target: { value: 'prompt_docker_rubric' } });

      // Verify preview
      expect(screen.getByText(/Prompt Template Details:/i)).toBeInTheDocument();
      expect(screen.getByText(/Extract chronological lab steps/i)).toBeInTheDocument();

      // Expand preview
      fireEvent.click(screen.getByRole('button', { name: /View Full Prompt/i }));
      expect(screen.getByRole('button', { name: /Collapse Preview/i })).toBeInTheDocument();

      // Enter optional specific teacher guidance
      const guidanceInput = screen.getByPlaceholderText(/Pay special attention to terminal command flags/i);
      fireEvent.change(guidanceInput, { target: { value: 'Check port 3000 mapping' } });

      // Click Synthesize
      const synthesizeBtn = screen.getByRole('button', { name: /Synthesize Rubric Milestones with Gemini/i });
      fireEvent.click(synthesizeBtn);

      await waitFor(() => {
        expect(mockExtractTaskDemoSteps).toHaveBeenCalledWith(
          expect.objectContaining({
            classId: 'class_1',
            demoVideoPath: 'demos/docker_demo.mp4',
            promptText: 'Extract chronological lab steps with terminal verification.',
            promptGuidelines: 'Check port 3000 mapping',
          })
        );
      });
    });

    it('handles Tab 2: public YouTube link with thumbnail preview and removal', async () => {
      const mockClose = vi.fn();
      render(
        <TaskEditorModal
          isOpen={true}
          onClose={mockClose}
          onSave={vi.fn()}
          classId="class_1"
          classSchedule={mockSchedule}
          availableVideos={mockVideos}
        />
      );

      // Navigate to Tab 2
      fireEvent.click(screen.getByRole('button', { name: /2\. Demo Video & AI/i }));

      // Enter a valid YouTube link
      const ytInput = screen.getByPlaceholderText(/https:\/\/www\.youtube\.com\/watch\?v=\.\.\./i);
      fireEvent.change(ytInput, { target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } });

      // Expect thumbnail and ID badge to render
      expect(screen.getByText(/Valid YouTube Reference/i)).toBeInTheDocument();
      expect(screen.getByText(/ID: dQw4w9WgXcQ/i)).toBeInTheDocument();

      // Expect active video card with Remove button
      expect(screen.getByRole('button', { name: /Remove/i })).toBeInTheDocument();

      // Remove video
      fireEvent.click(screen.getByRole('button', { name: /Remove/i }));
      expect(screen.queryByText(/ID: dQw4w9WgXcQ/i)).not.toBeInTheDocument();

      // Verify Cancel and Close buttons invoke onClose
      const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelBtn);
      expect(mockClose).toHaveBeenCalledTimes(1);

      const closeBtn = screen.getByRole('button', { name: /Close modal/i });
      fireEvent.click(closeBtn);
      expect(mockClose).toHaveBeenCalledTimes(2);
    });

    it('handles Tab 3: adding, modifying, and deleting rubric milestones', () => {
      render(
        <TaskEditorModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
          classId="class_1"
        />
      );

      // Navigate to Tab 3
      fireEvent.click(screen.getByRole('button', { name: /3\. Rubric Milestones/i }));
      expect(screen.getByText(/No Rubric Milestones Defined Yet/i)).toBeInTheDocument();

      // Add Step using manual button
      const addManualBtn = screen.getByRole('button', { name: /Add Milestone Manually/i });
      fireEvent.click(addManualBtn);
      expect(screen.getByDisplayValue(/Milestone 1/i)).toBeInTheDocument();

      // Add second step
      const addStepBtn = screen.getByRole('button', { name: /\+\s*Add Milestone/i });
      fireEvent.click(addStepBtn);
      expect(screen.getByDisplayValue(/Milestone 2/i)).toBeInTheDocument();

      // Modify Step title and points
      const milestoneInputs = screen.getAllByPlaceholderText(/Milestone Title/i);
      fireEvent.change(milestoneInputs[milestoneInputs.length - 1], {
        target: { value: 'Custom Clean Up Step' },
      });
      expect(screen.getByDisplayValue('Custom Clean Up Step')).toBeInTheDocument();

      // Delete a step
      const deleteStepButtons = screen.getAllByTitle(/Remove step/i);
      fireEvent.click(deleteStepButtons[0]);
      expect(screen.queryByDisplayValue('Milestone 1')).not.toBeInTheDocument();
    });

    it('handles Tab 4: configuring constraints and submitting payload', async () => {
      const mockOnSave = vi.fn();
      render(
        <TaskEditorModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={mockOnSave}
          classId="class_1"
        />
      );

      // Set title on Tab 1
      fireEvent.change(screen.getByPlaceholderText(/e\.g\., Dockerizing Node\.js/i), {
        target: { value: 'Full Stack Docker Task' },
      });

      // Add milestone on Tab 3
      fireEvent.click(screen.getByRole('button', { name: /3\. Rubric Milestones/i }));
      fireEvent.click(screen.getByRole('button', { name: /Add Milestone Manually/i }));

      // Navigate to Tab 4
      fireEvent.click(screen.getByRole('button', { name: /4\. Constraints & Policies/i }));

      // Change time limit
      const timeLimitInput = screen.getByLabelText(/Time Limit \(Minutes\)/i);
      fireEvent.change(timeLimitInput, { target: { value: '60' } });

      // Change max attempts
      const attemptsSelect = screen.getByLabelText(/Max Attempts Allowed/i);
      fireEvent.change(attemptsSelect, { target: { value: '3' } });

      // Save
      fireEvent.click(screen.getByRole('button', { name: /Publish Task/i }));

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Full Stack Docker Task',
            constraints: expect.objectContaining({
              timing: expect.objectContaining({ timeLimitMinutes: 60 }),
              attempts: expect.objectContaining({ maxAttempts: 3 }),
            }),
          })
        );
      });
    });

    it('handles Tab 4: late policy, scoring strategy, retry cooldown, dual camera, feedback release, and footer step navigation', async () => {
      const mockOnSave = vi.fn();
      render(
        <TaskEditorModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={mockOnSave}
          classId="class_1"
        />
      );

      // Verify footer wizard navigation from Tab 1 to Tab 2 to Tab 3 to Tab 4
      const nextBtn = screen.getByRole('button', { name: /Next Step →/i });
      fireEvent.click(nextBtn); // to demo
      expect(screen.getByText(/Public YouTube Link/i)).toBeInTheDocument();

      fireEvent.click(nextBtn); // to rubric
      expect(screen.getByRole('button', { name: /Add Milestone Manually/i })).toBeInTheDocument();

      fireEvent.click(nextBtn); // to constraints
      expect(screen.getByText(/Late Submission Policy/i)).toBeInTheDocument();

      // Now on Tab 4: test footer Previous button navigation back
      expect(screen.getByRole('button', { name: /← Previous/i })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /← Previous/i })); // goes to rubric
      expect(screen.getByRole('button', { name: /Add Milestone Manually/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /← Previous/i })); // goes to demo
      expect(screen.getByText(/Public YouTube Link/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /← Previous/i })); // goes to basic
      fireEvent.change(screen.getByPlaceholderText(/e\.g\., Dockerizing Node\.js/i), {
        target: { value: 'Advanced Distributed Systems Task' },
      });

      // Jump directly to Tab 4
      fireEvent.click(screen.getByRole('button', { name: /4\. Constraints & Policies/i }));

      // Late policy
      const latePolicySelect = screen.getByDisplayValue(/Allow with Late Flag/i);
      fireEvent.change(latePolicySelect, { target: { value: 'strictly_closed' } });

      // Scoring strategy
      const scoringSelect = screen.getByDisplayValue(/Keep Highest Score/i);
      fireEvent.change(scoringSelect, { target: { value: 'latest' } });

      // Retry cooldown
      const cooldownInput = screen.getByDisplayValue('15');
      fireEvent.change(cooldownInput, { target: { value: '30' } });

      // Required media channels
      const channelSelect = screen.getByDisplayValue(/Screen Share Only/i);
      fireEvent.change(channelSelect, { target: { value: 'dual_screen_webcam' } });

      // Feedback release policy
      const feedbackSelect = screen.getByDisplayValue(/Immediate/i);
      fireEvent.change(feedbackSelect, { target: { value: 'after_deadline' } });

      // Add a milestone so task can be published
      fireEvent.click(screen.getByRole('button', { name: /3\. Rubric Milestones/i }));
      fireEvent.click(screen.getByRole('button', { name: /Add Milestone Manually/i }));

      // Save and publish
      fireEvent.click(screen.getByRole('button', { name: /4\. Constraints & Policies/i }));
      fireEvent.click(screen.getByRole('button', { name: /Publish Task/i }));

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Advanced Distributed Systems Task',
            constraints: expect.objectContaining({
              timing: expect.objectContaining({ latePolicy: 'strictly_closed' }),
              attempts: expect.objectContaining({
                scoringStrategy: 'latest',
                retryCooldownMinutes: 30,
              }),
              proctoring: expect.objectContaining({
                requiredChannel: 'dual_screen_webcam',
              }),
              feedbackRelease: expect.objectContaining({
                policy: 'after_deadline',
              }),
            }),
          })
        );
      });
    });

    it('validates empty title and displays error alert', async () => {
      render(
        <TaskEditorModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
          classId="class_1"
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /4\. Constraints & Policies/i }));
      fireEvent.click(screen.getByRole('button', { name: /Publish Task/i }));

      expect(screen.getByText(/Please provide a task title\./i)).toBeInTheDocument();
    });
  });

  /* =========================================================================
     3. TaskGradingMatrixView
     ========================================================================= */
  describe('TaskGradingMatrixView', () => {
    const mockTask = {
      id: 'task_grading_full',
      title: 'Full Stack Lab Exam',
      maxScore: 100,
      rubricSteps: [
        { stepNumber: 1, title: 'Environment Config', points: 30 },
        { stepNumber: 2, title: 'Database Migrations', points: 70 },
      ],
    };

    const mockEnrolled = ['alice@vtc.edu.hk', 'bob@vtc.edu.hk', 'charlie@vtc.edu.hk'];
    const mockProfiles = {
      'alice@vtc.edu.hk': { uid: 'alice_uid', studentName: 'Alice Chan' },
      'bob@vtc.edu.hk': { uid: 'bob_uid', studentName: 'Bob Wong' },
      'charlie@vtc.edu.hk': { uid: 'charlie_uid', studentName: 'Charlie Lee' },
    };

    const mockSubmissions = [
      {
        studentUid: 'alice_uid',
        email: 'alice@vtc.edu.hk',
        status: 'evaluated',
        effectiveScore: 92,
        attemptsCount: 1,
        evaluation: {
          finalScore: 92,
          overallSummary: 'High proficiency in migrations.',
          stepResults: [
            { stepNumber: 1, title: 'Environment Config', status: 'completed', scoreAwarded: 30 },
            { stepNumber: 2, title: 'Database Migrations', status: 'completed', scoreAwarded: 62 },
          ],
        },
      },
      {
        studentUid: 'bob_uid',
        email: 'bob@vtc.edu.hk',
        status: 'in_progress',
        effectiveScore: null,
        attemptsCount: 1,
      },
    ];

    it('filters students by search term and status filters', () => {
      render(
        <TaskGradingMatrixView
          task={mockTask}
          submissions={mockSubmissions}
          enrolledStudents={mockEnrolled}
          studentProfiles={mockProfiles}
          onBack={vi.fn()}
        />
      );

      // Search student
      const searchInput = screen.getByPlaceholderText(/Search student, email, cohort\.\.\./i);
      fireEvent.change(searchInput, { target: { value: 'Alice' } });

      expect(screen.getByText('Alice Chan')).toBeInTheDocument();
      expect(screen.queryByText('Bob Wong')).not.toBeInTheDocument();

      // Clear search and filter by status 'missing'
      fireEvent.change(searchInput, { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: 'missing' }));

      expect(screen.getByText('Charlie Lee')).toBeInTheDocument();
      expect(screen.queryByText('Alice Chan')).not.toBeInTheDocument();
    });

    it('handles teacher manual score override and inspect modal', async () => {
      const mockSaveOverride = vi.fn();
      render(
        <TaskGradingMatrixView
          task={mockTask}
          submissions={mockSubmissions}
          enrolledStudents={mockEnrolled}
          studentProfiles={mockProfiles}
          onBack={vi.fn()}
          onSaveOverride={mockSaveOverride}
        />
      );

      // Start override edit for Alice
      const overrideButtons = screen.getAllByTitle(/Override score/i);
      fireEvent.click(overrideButtons[0]);

      // Type new manual score
      const scoreInput = screen.getByDisplayValue('92');
      fireEvent.change(scoreInput, { target: { value: '98' } });

      // Save override
      const saveBtn = screen.getByTitle('Save');
      fireEvent.click(saveBtn);

      expect(mockSaveOverride).toHaveBeenCalledWith(
        'alice_uid',
        expect.objectContaining({ manualScore: 98 })
      );

      // Test Inspect Modal
      const inspectButtons = screen.getAllByRole('button', { name: /Inspect 🔍/i });
      fireEvent.click(inspectButtons[0]);

      expect(screen.getByText(/High proficiency in migrations\./i)).toBeInTheDocument();
      expect(screen.getByText(/Step 2: Database Migrations/i)).toBeInTheDocument();

      // Close Inspect Modal
      fireEvent.click(screen.getAllByRole('button', { name: /Close/i })[0]);
      expect(screen.queryByText(/High proficiency in migrations\./i)).not.toBeInTheDocument();
    });

    it('handles triggering single evaluation and batch Grade All Pending', async () => {
      const mockTriggerEval = vi.fn().mockResolvedValue({ success: true, queued: true });
      const pendingSubmissions = [
        ...mockSubmissions,
        {
          studentUid: 'charlie_uid',
          email: 'charlie@vtc.edu.hk',
          status: 'compiling_complete',
          effectiveScore: null,
          attemptsCount: 1,
        },
      ];

      vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.spyOn(window, 'alert').mockImplementation(() => {});

      render(
        <TaskGradingMatrixView
          task={mockTask}
          submissions={pendingSubmissions}
          enrolledStudents={mockEnrolled}
          studentProfiles={mockProfiles}
          onBack={vi.fn()}
          onTriggerEvaluation={mockTriggerEval}
        />
      );

      // Verify "Ready to Grade" badge is displayed for compiling_complete
      expect(screen.getByText(/Ready to Grade/i)).toBeInTheDocument();

      // Click Grade on Charlie
      const gradeBtn = screen.getByTitle(/Grade with Gemini/i);
      fireEvent.click(gradeBtn);

      await waitFor(() => {
        expect(mockTriggerEval).toHaveBeenCalledWith('charlie_uid', 1);
      });

      // Click Grade All Pending
      const gradeAllBtn = screen.getByRole('button', { name: /Grade All Pending/i });
      fireEvent.click(gradeAllBtn);

      await waitFor(() => {
        expect(mockTriggerEval).toHaveBeenCalled();
      });
    });

    it('renders Google Drive backup action and triggers backupTaskVideosToDrive', async () => {
      const submissionsWithVideos = [
        {
          studentUid: 'alice_uid',
          email: 'alice@vtc.edu.hk',
          status: 'evaluated',
          effectiveScore: 92,
          attemptsCount: 1,
          compiledVideoPath: 'classes/class_1/tasks/task_1/videos/alice_attempt_1.mp4',
          driveWebViewLink: 'https://drive.google.com/file/d/test-drive-alice/view',
          driveFolderPath: 'Classroom Archives / IT114115-A / Tasks / Full Stack Lab Exam / Students / alice@vtc.edu.hk',
        },
        {
          studentUid: 'bob_uid',
          email: 'bob@vtc.edu.hk',
          status: 'compiling_complete',
          effectiveScore: null,
          attemptsCount: 1,
          compiledVideoPath: 'classes/class_1/tasks/task_1/videos/bob_attempt_1.mp4',
        },
      ];

      render(
        <TaskGradingMatrixView
          task={mockTask}
          classId="class_101"
          className="IT114115-A"
          submissions={submissionsWithVideos}
          enrolledStudents={mockEnrolled}
          studentProfiles={mockProfiles}
          onBack={vi.fn()}
        />
      );

      // Verify Google Drive destination display
      expect(screen.getByText(/Classroom Archives \/ IT114115-A \/ Tasks \/ Full Stack Lab Exam/i)).toBeInTheDocument();

      // Check Alice has Drive badge link
      const driveLink = screen.getByRole('link', { name: /Drive ↗/i });
      expect(driveLink).toHaveAttribute('href', 'https://drive.google.com/file/d/test-drive-alice/view');
      expect(driveLink).toHaveAttribute('target', '_blank');

      // Check Bob has Backup button
      const singleBackupButtons = screen.getAllByRole('button', { name: /☁️ Backup/i });
      expect(singleBackupButtons.length).toBeGreaterThan(0);

      // Check Top Header Backup Button
      const headerBackupBtn = screen.getByRole('button', { name: /Backup Task Videos \(2\)/i });
      expect(headerBackupBtn).toBeInTheDocument();

      // Trigger Batch Backup
      fireEvent.click(headerBackupBtn);

      await waitFor(() => {
        expect(mockBackupTaskVideosToDrive).toHaveBeenCalledWith(
          expect.objectContaining({
            classId: 'class_101',
            className: 'IT114115-A',
            task: mockTask,
            baseFolder: 'Classroom Archives',
          })
        );
      });
    });
  });

  /* =========================================================================
     4. StudentTaskFeedbackView
     ========================================================================= */
  describe('StudentTaskFeedbackView', () => {
    const mockTask = {
      title: 'Docker Deployment Assessment',
      maxScore: 100,
    };

    const mockSubmission = {
      attemptsCount: 2,
      effectiveScore: 88,
      teacherOverride: {
        manualScore: 92,
        teacherComment: 'Great recovery in attempt 2.',
      },
      evaluation: {
        finalScore: 88,
        overallSummary: 'Good performance overall with clean code structure.',
        stepResults: [
          {
            stepNumber: 1,
            title: 'Dockerfile creation',
            status: 'completed',
            scoreAwarded: 50,
            feedback: 'Optimized multistage build.',
            timestampInVideo: '02:15',
          },
          {
            stepNumber: 2,
            title: 'Container healthcheck',
            status: 'partial',
            scoreAwarded: 42,
            feedback: 'Healthcheck interval slightly high.',
            timestampInVideo: '01:10:00', // HH:MM:SS format
          },
        ],
        strengths: ['Effective layer caching', 'Secure user directive'],
        deviationsOrErrors: ['Port 80 instead of 3000 initially tested'],
      },
    };

    it('renders empty fallback when task or submission is missing', () => {
      render(<StudentTaskFeedbackView task={null} submission={null} />);
      expect(screen.getByText(/No task or evaluation details found\./i)).toBeInTheDocument();
    });

    it('renders grades, teacher comments, step checklists, and video jump buttons', () => {
      const mockOnBack = vi.fn();
      render(
        <StudentTaskFeedbackView
          task={mockTask}
          submission={mockSubmission}
          onBack={mockOnBack}
          videoPlaybackUrl="https://mock.storage/video.mp4"
        />
      );

      expect(screen.getByText('Docker Deployment Assessment')).toBeInTheDocument();
      expect(screen.getByText('92')).toBeInTheDocument(); // Manual override score
      expect(screen.getByText(/Great recovery in attempt 2\./i)).toBeInTheDocument();
      expect(screen.getByText(/Effective layer caching/i)).toBeInTheDocument();
      expect(screen.getByText(/Port 80 instead of 3000 initially tested/i)).toBeInTheDocument();

      // Test Jump to timestamp button (02:15)
      const jumpButtons = screen.getAllByRole('button', { name: /Jump to/i });
      expect(jumpButtons).toHaveLength(2);
      fireEvent.click(jumpButtons[0]);
      fireEvent.click(jumpButtons[1]);

      // Test back navigation
      fireEvent.click(screen.getByRole('button', { name: /← Back to My Tasks/i }));
      expect(mockOnBack).toHaveBeenCalled();
    });
  });

  /* =========================================================================
     5. StudentTaskWorkspaceModal
     ========================================================================= */
  describe('StudentTaskWorkspaceModal', () => {
    const mockTask = {
      id: 'task_ws_1',
      title: 'Real-time Socket Lab',
      maxScore: 100,
      description: 'Implement WebSocket chat server.',
      constraints: {
        timing: { timeLimitMinutes: 45, autoSubmitOnExpiry: true },
        attempts: { maxAttempts: 3 },
      },
      rubricSteps: [{ stepNumber: 1, title: 'Server up', points: 100 }],
    };

    it('handles screen sharing rejection gracefully with an alert', async () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      global.navigator.mediaDevices = {
        getDisplayMedia: vi.fn().mockRejectedValue(new Error('Permission denied')),
      };

      render(
        <StudentTaskWorkspaceModal
          isOpen={true}
          onClose={vi.fn()}
          task={mockTask}
          submission={null}
        />
      );

      const startBtn = screen.getByRole('button', { name: /Start Task Challenge/i });
      fireEvent.click(startBtn);

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(
          expect.stringContaining('Screen sharing is required')
        );
      });
      alertSpy.mockRestore();
    });

    it('reuses existingScreenStream and triggers onFinishAttempt when student completes task', async () => {
      const mockStream = {
        getVideoTracks: () => [{ onended: null }],
      };
      const mockOnStart = vi.fn();
      const mockOnFinish = vi.fn().mockResolvedValue({
        finalScore: 95,
        overallSummary: 'Task verified.',
      });

      render(
        <StudentTaskWorkspaceModal
          isOpen={true}
          onClose={vi.fn()}
          task={mockTask}
          submission={null}
          existingScreenStream={mockStream}
          onStartAttempt={mockOnStart}
          onFinishAttempt={mockOnFinish}
        />
      );

      // Start Attempt with existing screen stream
      fireEvent.click(screen.getByRole('button', { name: /Start Task Challenge/i }));

      await waitFor(() => {
        expect(mockOnStart).toHaveBeenCalledWith(
          'task_ws_1',
          expect.objectContaining({ attemptNumber: 1 })
        );
      });

      // Now in Active state, finish task attempt
      const submitBtn = screen.getByRole('button', { name: /Finish & Submit/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockOnFinish).toHaveBeenCalledWith(
          'task_ws_1',
          expect.objectContaining({ attemptNumber: 1 })
        );
        expect(screen.getByText(/Attempt Submitted Successfully!/i)).toBeInTheDocument();
      });
    });

    it('resumes active attempt directly into workspace without pre-flight screen', () => {
      const inProgressSubmission = {
        status: 'in_progress',
        attemptsCount: 1,
        activeAttempt: {
          attemptNumber: 1,
          startedAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
          status: 'in_progress',
        },
      };

      render(
        <StudentTaskWorkspaceModal
          isOpen={true}
          onClose={vi.fn()}
          task={mockTask}
          submission={inProgressSubmission}
        />
      );

      // Should be directly in active session
      expect(screen.getByRole('button', { name: /Finish & Submit/i })).toBeInTheDocument();
      expect(screen.queryByText(/Pre-Flight Checklist/i)).not.toBeInTheDocument();
    });
  });
});
