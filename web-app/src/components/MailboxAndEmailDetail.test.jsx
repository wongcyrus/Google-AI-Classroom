import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MailboxView from './MailboxView';
import EmailDetailView from './EmailDetailView';
import { auth, db, storage } from '../firebase-config';
import { onSnapshot, getDoc, updateDoc } from 'firebase/firestore';
import { getDownloadURL } from 'firebase/storage';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  onSnapshot: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  updateDoc: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  getDownloadURL: vi.fn(),
}));

vi.mock('../firebase-config', () => ({
  auth: { currentUser: null },
  db: {},
  storage: {},
}));

describe('MailboxView & EmailDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('MailboxView', () => {
    it('shows empty list when unauthenticated', async () => {
      auth.currentUser = null;
      render(
        <MemoryRouter>
          <MailboxView />
        </MemoryRouter>
      );
      expect(await screen.findByText('You have no mail.')).toBeInTheDocument();
    });

    it('renders list of emails including unread and read status', async () => {
      auth.currentUser = { email: 'teacher@school.edu' };
      onSnapshot.mockImplementation((q, onNext) => {
        onNext({
          docs: [
            {
              id: 'mail-1',
              data: () => ({
                title: 'Incident Dossier Ready',
                to: 'teacher@school.edu',
                read: false,
                createdAt: { seconds: 1725450000 },
                message: { subject: 'Dossier Alert' },
              }),
            },
            {
              id: 'mail-2',
              data: () => ({
                title: 'Class Summary Report',
                to: 'teacher@school.edu',
                read: true,
                createdAt: { seconds: 1725440000 },
                message: { subject: 'Weekly summary' },
              }),
            },
          ],
        });
        return vi.fn();
      });

      render(
        <MemoryRouter>
          <MailboxView />
        </MemoryRouter>
      );

      expect(await screen.findByText('Incident Dossier Ready')).toBeInTheDocument();
      expect(screen.getByText('Class Summary Report')).toBeInTheDocument();
    });

    it('handles query snapshot error gracefully', async () => {
      auth.currentUser = { email: 'teacher@school.edu' };
      onSnapshot.mockImplementation((q, onNext, onError) => {
        onError(new Error('Permission denied'));
        return vi.fn();
      });

      render(
        <MemoryRouter>
          <MailboxView />
        </MemoryRouter>
      );

      expect(await screen.findByText('You have no mail.')).toBeInTheDocument();
    });
  });

  describe('EmailDetailView', () => {
    it('handles non-existent email', async () => {
      getDoc.mockResolvedValueOnce({
        exists: () => false,
      });

      render(
        <MemoryRouter initialEntries={['/mailbox/unknown']}>
          <Routes>
            <Route path="/mailbox/:emailId" element={<EmailDetailView />} />
          </Routes>
        </MemoryRouter>
      );

      expect(await screen.findByText('Email not found.')).toBeInTheDocument();
    });

    it('renders email details, marks unread email as read, and resolves attachments', async () => {
      getDoc.mockResolvedValueOnce({
        exists: () => true,
        id: 'mail-123',
        data: () => ({
          title: 'Suspicious Activity Detected',
          to: 'teacher@school.edu',
          read: false,
          createdAt: { seconds: 1725450000 },
          message: {
            subject: 'Review needed for student s1',
            html: '<p>Student changed tabs multiple times.</p>',
          },
          attachments: [
            { name: 'evidence.pdf', key: 'reports/evidence.pdf' },
          ],
        }),
      });

      getDownloadURL.mockResolvedValueOnce('https://storage.mock/evidence.pdf');

      render(
        <MemoryRouter initialEntries={['/mailbox/mail-123']}>
          <Routes>
            <Route path="/mailbox/:emailId" element={<EmailDetailView />} />
          </Routes>
        </MemoryRouter>
      );

      expect(await screen.findByText('Suspicious Activity Detected')).toBeInTheDocument();
      expect(screen.getByText(/teacher@school.edu/)).toBeInTheDocument();
      expect(screen.getByText('Review needed for student s1')).toBeInTheDocument();
      expect(screen.getByText('Student changed tabs multiple times.')).toBeInTheDocument();

      // Marked read
      expect(updateDoc).toHaveBeenCalled();

      // Attachment rendered
      expect(await screen.findByRole('link', { name: 'evidence.pdf' })).toHaveAttribute('href', 'https://storage.mock/evidence.pdf');
    });

    it('handles attachment download URL error gracefully', async () => {
      getDoc.mockResolvedValueOnce({
        exists: () => true,
        id: 'mail-456',
        data: () => ({
          title: 'Report with Broken Attachment',
          to: 'teacher@school.edu',
          read: true,
          message: { html: 'Broken attachment test' },
          attachments: [
            { name: 'missing.zip', key: 'reports/missing.zip' },
          ],
        }),
      });

      getDownloadURL.mockRejectedValueOnce(new Error('File not found'));

      render(
        <MemoryRouter initialEntries={['/mailbox/mail-456']}>
          <Routes>
            <Route path="/mailbox/:emailId" element={<EmailDetailView />} />
          </Routes>
        </MemoryRouter>
      );

      expect(await screen.findByText(/Could not get download URL/)).toBeInTheDocument();
    });
  });
});
