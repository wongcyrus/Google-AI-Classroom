import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from './App';
import { auth, db } from './firebase-config';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { getDoc, onSnapshot } from 'firebase/firestore';
import * as browserDetection from './utils/browserDetection';

vi.mock('firebase/auth', () => {
  const onAuthStateChanged = vi.fn();
  return {
    onAuthStateChanged,
    onIdTokenChanged: onAuthStateChanged,
    signOut: vi.fn(() => Promise.resolve()),
  };
});

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
  appCheck: null,
}));

vi.mock('./utils/browserDetection', () => ({
  isGoogleChrome: vi.fn(() => true),
  getBrowserName: vi.fn(() => 'Chrome'),
  isMobileDevice: vi.fn(() => false),
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

vi.mock('./components/StudentRecordsView', () => ({
  default: () => <div data-testid="student-records-view">Student Personal Records View</div>,
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

vi.mock('./components/public/PublicLiveView', () => ({
  default: () => <div data-testid="public-live-view">Public Live View</div>,
}));

vi.mock('./assets/HKIIT_logo_RGB_horizontal.jpg', () => ({
  default: 'logo.jpg',
}));

describe('App & MainHeader Components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/');
    browserDetection.isGoogleChrome.mockReturnValue(true);
    browserDetection.getBrowserName.mockReturnValue('Chrome');
    browserDetection.isMobileDevice.mockReturnValue(false);
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
    expect(screen.getByRole('link', { name: /Higher Diploma in Cloud and Data Centre Administration/i })).toBeInTheDocument();
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
    expect(screen.getByText('Google AI Classroom')).toBeInTheDocument();
    expect(screen.getByText('📊 Dashboard')).toBeInTheDocument();
    expect(screen.getByText('⚙️ Class Manager')).toBeInTheDocument();
    expect(screen.getByText('📬 Mailbox')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // Unread badge

    // Footer promotion check
    const footerLink = screen.getByRole('link', { name: /Higher Diploma in Cloud and Data Centre Administration/i });
    expect(footerLink).toBeInTheDocument();
    expect(footerLink).toHaveAttribute('href', 'https://www.vtc.edu.hk/admission/en/programme/it114115-higher-diploma-in-cloud-and-data-centre-administration/');
    expect(footerLink).toHaveAttribute('target', '_blank');
    expect(footerLink).toHaveAttribute('rel', 'noopener noreferrer');

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
    expect(screen.getByText(/Live Session/i)).toBeInTheDocument();
    expect(screen.getByText(/My Records/i)).toBeInTheDocument();

    // Toggle profile menu
    const userTrigger = screen.getByTitle('Account Menu');
    fireEvent.click(userTrigger);
    expect(screen.getByText('🧑‍🎓 Student')).toBeInTheDocument();

    // Click outside to close
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('🧑‍🎓 Student')).not.toBeInTheDocument();

    // Reopen and click My Records inside menu
    fireEvent.click(userTrigger);
    const menuRecordsItems = screen.getAllByText('My Records');
    fireEvent.click(menuRecordsItems[menuRecordsItems.length - 1]);
    expect(screen.queryByText('🧑‍🎓 Student')).not.toBeInTheDocument();
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

  it('allows student login and views companion on mobile devices even without Google Chrome', async () => {
    browserDetection.isGoogleChrome.mockReturnValue(false);
    browserDetection.isMobileDevice.mockReturnValue(true);

    const mockMobileStudent = {
      uid: 'student_mobile',
      email: 'student_mobile@school.edu',
      emailVerified: true,
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: { role: 'student' } }),
    };

    onAuthStateChanged.mockImplementation((authInstance, cb) => {
      cb(mockMobileStudent);
      return vi.fn();
    });

    render(<App />);

    expect(await screen.findByTestId('student-view')).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('omits desktop MainHeader and app-footer when student is in mobile view', async () => {
    browserDetection.isMobileDevice.mockReturnValue(true);

    const mockMobileStudent = {
      uid: 'student_mobile',
      email: 'student_mobile@school.edu',
      emailVerified: true,
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: { role: 'student' } }),
    };

    onAuthStateChanged.mockImplementation((authInstance, cb) => {
      cb(mockMobileStudent);
      return vi.fn();
    });

    render(<App />);

    expect(await screen.findByTestId('student-view')).toBeInTheDocument();
    // Desktop MainHeader elements and footer should NOT be rendered
    expect(screen.queryByTitle('Account Menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Higher Diploma in Cloud and Data Centre Administration/i })).not.toBeInTheDocument();
  });

  it('renders breadcrumb bar when teacher navigates to subpages', async () => {
    window.history.pushState({}, 'Class Mgmt', '/class-management');

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

    render(<App />);

    expect(await screen.findByTestId('class-mgmt-view')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Class Management')).toBeInTheDocument();

    // Navigate to manage-prompts
    const promptNavLink = screen.getByText('💡 AI Prompts');
    fireEvent.click(promptNavLink);
    expect(await screen.findByTestId('prompt-mgmt-view')).toBeInTheDocument();
    expect(screen.getByText('Prompt Management')).toBeInTheDocument();

    // Reset URL
    window.history.pushState({}, 'Dashboard', '/teacher');
  });

  it('resolves class name via getDoc and displays unread mail count in teacher navigation', async () => {
    window.history.pushState({}, 'Class Details', '/class/CLASS_DEV_999');

    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ name: 'Cloud Native Computing' }),
    });

    onSnapshot.mockImplementationOnce((q, onNext, onError) => {
      onNext({ size: 4 });
      if (onError) onError(new Error('Sample listener notice'));
      return vi.fn();
    });

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

    render(<App />);

    expect(await screen.findByTestId('class-view')).toBeInTheDocument();
    expect(await screen.findByText(/Cloud Native Computing/i)).toBeInTheDocument();
    // Unread mail badge
    expect(screen.getByText('4')).toBeInTheDocument();

    window.history.pushState({}, 'Dashboard', '/teacher');
  });

  it('falls back to classId in breadcrumb when getDoc rejects', async () => {
    window.history.pushState({}, 'Class Details', '/class/FALLBACK_CLASS_01');
    getDoc.mockRejectedValueOnce(new Error('Network offline'));

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

    render(<App />);

    expect(await screen.findByTestId('class-view')).toBeInTheDocument();
    expect(await screen.findByText(/FALLBACK_CLASS_01/i)).toBeInTheDocument();

    window.history.pushState({}, 'Dashboard', '/teacher');
  });

  it('renders PublicLiveView on /live/:classId without requiring authentication and hides navigation headers', async () => {
    window.history.pushState({}, 'Public Live Talk', '/live/PUBLIC_SESSION_42');

    onAuthStateChanged.mockImplementation((authInstance, cb) => {
      cb(null);
      return vi.fn();
    });

    render(<App />);

    expect(await screen.findByTestId('public-live-view')).toBeInTheDocument();
    expect(screen.queryByAltText(/HKIIT Logo/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('auth-page')).not.toBeInTheDocument();

    window.history.pushState({}, 'Dashboard', '/');
  });
});

