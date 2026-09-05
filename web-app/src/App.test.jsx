import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from './App';
import { auth, db } from './firebase-config';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { getDoc, onSnapshot } from 'firebase/firestore';
import * as browserDetection from './utils/browserDetection';

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(),
  signOut: vi.fn(() => Promise.resolve()),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  onSnapshot: vi.fn(),
}));

vi.mock('./firebase-config', () => ({
  auth: {},
  db: {},
}));

vi.mock('./utils/browserDetection', () => ({
  isGoogleChrome: vi.fn(() => true),
  getBrowserName: vi.fn(() => 'Chrome'),
}));

vi.mock('./components/AuthComponent', () => ({
  default: () => <div data-testid="auth-page">Login / Auth Component</div>,
}));

vi.mock('./components/TeacherView', () => ({
  default: () => <div data-testid="teacher-view">Teacher Dashboard View</div>,
}));

vi.mock('./components/StudentView', () => ({
  default: () => <div data-testid="student-view">Student Exam Room View</div>,
}));

vi.mock('./components/ClassManagement', () => ({
  default: () => <div data-testid="class-mgmt-view">Class Management View</div>,
}));

vi.mock('./components/MailboxView', () => ({
  default: () => <div data-testid="mailbox-view">Mailbox View</div>,
}));

vi.mock('./components/EmailDetailView', () => ({
  default: () => <div data-testid="email-detail-view">Email Detail View</div>,
}));

vi.mock('./components/PromptManagement', () => ({
  default: () => <div data-testid="prompt-mgmt-view">Prompt Management View</div>,
}));

vi.mock('./components/ClassView', () => ({
  default: () => <div data-testid="class-view">Class View</div>,
}));

vi.mock('./components/ChangePasswordModal', () => ({
  default: ({ show, onClose }) => (show ? <div data-testid="change-pwd-modal"><button onClick={onClose}>Close Pwd Modal</button></div> : null),
}));

vi.mock('./assets/HKIIT_logo_RGB_horizontal.jpg', () => ({
  default: 'logo.jpg',
}));

describe('App & MainHeader Components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserDetection.isGoogleChrome.mockReturnValue(true);
    browserDetection.getBrowserName.mockReturnValue('Chrome');
    onSnapshot.mockReturnValue(vi.fn());
    getDoc.mockResolvedValue({ exists: () => false });
  });

  it('renders loading workspace initially then redirects unauthenticated user to login', async () => {
    let authCallback;
    onAuthStateChanged.mockImplementation((authInstance, cb) => {
      authCallback = cb;
      return vi.fn();
    });

    render(<App />);
    expect(screen.getByText('Loading workspace...')).toBeInTheDocument();

    // Trigger auth state null
    authCallback(null);

    expect(await screen.findByTestId('auth-page')).toBeInTheDocument();
  });

  it('renders teacher dashboard, navigation bar, and handles logout', async () => {
    const mockTeacher = {
      uid: 'teacher_1',
      email: 'teacher@school.edu',
      emailVerified: true,
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: { role: 'teacher' } }),
    };

    onAuthStateChanged.mockImplementation((authInstance, cb) => {
      cb(mockTeacher);
      return vi.fn();
    });

    onSnapshot.mockImplementation((q, cb) => {
      cb({ size: 3 }); // 3 unread emails
      return vi.fn();
    });

    render(<App />);

    expect(await screen.findByTestId('teacher-view')).toBeInTheDocument();
    expect(screen.getByText('Gemini AI Classroom')).toBeInTheDocument();
    expect(screen.getByText('📊 Dashboard')).toBeInTheDocument();
    expect(screen.getByText('⚙️ Class Manager')).toBeInTheDocument();
    expect(screen.getByText('📬 Mailbox')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // Unread badge

    // Open User profile dropdown
    const userTrigger = screen.getByTitle('Account Menu');
    fireEvent.click(userTrigger);

    expect(screen.getByText('👨‍🏫 Teacher')).toBeInTheDocument();

    // Open Change Password Modal
    const changePwdBtn = screen.getByText('Change Password');
    fireEvent.click(changePwdBtn);
    expect(screen.getByTestId('change-pwd-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Close Pwd Modal'));
    expect(screen.queryByTestId('change-pwd-modal')).not.toBeInTheDocument();

    // Sign out
    fireEvent.click(userTrigger);
    const signOutBtn = screen.getByText('Sign Out');
    fireEvent.click(signOutBtn);
    expect(signOut).toHaveBeenCalled();
  });

  it('renders student view when student logs in on Google Chrome', async () => {
    const mockStudent = {
      uid: 'student_1',
      email: 'student@school.edu',
      emailVerified: true,
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: { role: 'student' } }),
    };

    onAuthStateChanged.mockImplementation((authInstance, cb) => {
      cb(mockStudent);
      return vi.fn();
    });

    render(<App />);

    expect(await screen.findByTestId('student-view')).toBeInTheDocument();
    expect(screen.getByText('student@school.edu')).toBeInTheDocument();
    expect(screen.getByText('student')).toBeInTheDocument();
  });

  it('blocks student and forces sign out when logging in on non-Chrome browser', async () => {
    browserDetection.isGoogleChrome.mockReturnValue(false);
    browserDetection.getBrowserName.mockReturnValue('Safari');

    const mockStudent = {
      uid: 'student_safari',
      email: 'student@school.edu',
      emailVerified: true,
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: { role: 'student' } }),
    };

    onAuthStateChanged.mockImplementation((authInstance, cb) => {
      cb(mockStudent);
      return vi.fn();
    });

    render(<App />);

    expect(await screen.findByText(/Google Chrome Required/i)).toBeInTheDocument();
    expect(signOut).toHaveBeenCalled();
  });
});
