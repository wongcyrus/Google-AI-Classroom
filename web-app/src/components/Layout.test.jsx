import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import Layout from './Layout';
import { useNotifications } from '../hooks/useNotifications';
import { updateDoc } from 'firebase/firestore';

vi.mock('../hooks/useNotifications', () => ({
  useNotifications: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, col, id) => ({ id })),
  updateDoc: vi.fn(() => Promise.resolve()),
}));

vi.mock('../firebase-config', () => ({
  db: {},
}));

vi.mock('../assets/logo.jpg', () => ({
  default: 'logo.jpg',
}));

describe('Layout Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children, title, and banner correctly', () => {
    useNotifications.mockReturnValue({ notifications: [], unreadCount: 0 });

    render(
      <Layout title="Exam Dashboard" banner="test-banner.png">
        <div data-testid="child-content">Main Workspace Content</div>
      </Layout>
    );

    expect(screen.getByText('Exam Dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.getByAltText('Banner')).toHaveAttribute('src', 'test-banner.png');
  });

  it('displays notification count and toggles dropdown marking unread items as read', async () => {
    const mockNotifs = [
      { id: 'notif-1', message: 'Low battery alert', read: false, createdAt: { toDate: () => new Date('2026-09-01') } },
      { id: 'notif-2', message: 'Exam submitted', read: true, createdAt: { toDate: () => new Date('2026-09-01') } },
    ];
    useNotifications.mockReturnValue({
      notifications: mockNotifs,
      unreadCount: 1,
    });

    render(
      <Layout title="Exam Dashboard">
        <div>Content</div>
      </Layout>
    );

    // Unread count badge
    expect(screen.getByText('1')).toBeInTheDocument();

    // Click bell icon
    const bell = screen.getByText('1').closest('div');
    fireEvent.click(bell);

    // Dropdown open
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Low battery alert')).toBeInTheDocument();
    expect(screen.getByText('Exam submitted')).toBeInTheDocument();

    // Checked updateDoc called for unread notification
    expect(updateDoc).toHaveBeenCalled();

    // Click outside closes dropdown
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });
});
