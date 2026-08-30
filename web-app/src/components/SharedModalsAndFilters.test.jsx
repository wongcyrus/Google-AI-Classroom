import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Modal from './Modal';
import DateRangeFilter from './DateRangeFilter';
import MessagesView from './MessagesView';
import StudentsGrid from './monitor/StudentsGrid';

vi.mock('../hooks/useCollectionQuery', () => ({
  default: vi.fn((path) => {
    if (path) {
      return {
        data: [
          {
            id: 'msg_1',
            message: 'Classroom session started',
            timestamp: { toDate: () => new Date('2026-08-29T10:00:00Z') },
          },
        ],
        loading: false,
        page: 1,
        isLastPage: true,
        fetchNextPage: vi.fn(),
        fetchPrevPage: vi.fn(),
      };
    }
    return { data: [], loading: false, page: 1, isLastPage: true, fetchNextPage: vi.fn(), fetchPrevPage: vi.fn() };
  }),
}));

describe('Shared UI Components & Views', () => {
  describe('Modal Component', () => {
    it('returns null when show is false', () => {
      const { container } = render(<Modal show={false} onClose={vi.fn()} title="Test Modal">Content</Modal>);
      expect(container.firstChild).toBeNull();
    });

    it('renders modal title and content when show is true', () => {
      const onClose = vi.fn();
      render(
        <Modal show={true} onClose={onClose} title="Security Alert">
          <div>Modal Details</div>
        </Modal>
      );
      expect(screen.getByText('Security Alert')).toBeInTheDocument();
      expect(screen.getByText('Modal Details')).toBeInTheDocument();

      // Click close button
      const closeBtn = screen.getByRole('button', { name: '✕' });
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('DateRangeFilter Component', () => {
    it('handles start, end date changes and search click', () => {
      const onStartTimeChange = vi.fn();
      const onEndTimeChange = vi.fn();
      const onSearch = vi.fn();

      render(
        <DateRangeFilter
          startTime="2026-08-29T09:00"
          endTime="2026-08-29T11:00"
          onStartTimeChange={onStartTimeChange}
          onEndTimeChange={onEndTimeChange}
          onSearch={onSearch}
          timezone="America/New_York"
        />
      );

      const fromInput = screen.getByLabelText(/From:/i);
      const toInput = screen.getByLabelText(/To:/i);
      fireEvent.change(fromInput, { target: { value: '2026-08-29T10:00' } });
      fireEvent.change(toInput, { target: { value: '2026-08-29T12:00' } });
      expect(onStartTimeChange).toHaveBeenCalledWith('2026-08-29T10:00');
      expect(onEndTimeChange).toHaveBeenCalledWith('2026-08-29T12:00');

      const searchBtn = screen.getByRole('button', { name: 'Search' });
      fireEvent.click(searchBtn);
      expect(onSearch).toHaveBeenCalled();
      expect(screen.getByText(/Timezone: America\/New York/i)).toBeInTheDocument();
    });
  });

  describe('MessagesView Component', () => {
    it('renders teacher notification records and pagination', () => {
      render(<MessagesView user={{ uid: 'teacher_123' }} classId="CLASS_A" />);
      expect(screen.getByText('Notifications')).toBeInTheDocument();
      expect(screen.getByText('Classroom session started')).toBeInTheDocument();
    });
  });

  describe('StudentsGrid Component', () => {
    const mockStudents = [
      { id: 's1', email: 's1@school.edu', isSharing: true },
      { id: 's2', email: 's2@school.edu', isSharing: false },
    ];
    const mockScreenshots = {
      s1: { url: 'https://test.local/s1.jpg', timestamp: new Date() },
    };

    it('renders active sharing students in live monitoring mode', () => {
      const handleStudentClick = vi.fn();
      render(
        <StudentsGrid
          students={mockStudents}
          screenshots={mockScreenshots}
          now={new Date()}
          isPaused={false}
          frameRate={15}
          handleStudentClick={handleStudentClick}
          selectedChannel="both"
        />
      );

      expect(screen.getByText('s1@school.edu')).toBeInTheDocument();
      expect(screen.queryByText('s2@school.edu')).toBeNull(); // not sharing
    });

    it('renders all students from classList when reviewTime is provided', () => {
      const uidMap = new Map([
        ['s1', 's1@school.edu'],
        ['s2', 's2@school.edu'],
      ]);
      render(
        <StudentsGrid
          reviewTime={new Date().toISOString()}
          classList={['s1', 's2']}
          uidToEmailMap={uidMap}
          screenshots={mockScreenshots}
          students={mockStudents}
          now={new Date()}
          isPaused={false}
          frameRate={15}
          handleStudentClick={vi.fn()}
        />
      );

      expect(screen.getByText('s1@school.edu')).toBeInTheDocument();
      expect(screen.getByText('s2@school.edu')).toBeInTheDocument();
    });
  });
});
