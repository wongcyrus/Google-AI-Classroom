import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import ScheduleChangeModal from './ScheduleChangeModal';

describe('ScheduleChangeModal Component', () => {
  const mockPastLessons = [
    { start: new Date('2026-09-24T07:00:00Z'), end: new Date('2026-09-24T09:00:00Z'), index: 3 },
    { start: new Date('2026-09-17T07:00:00Z'), end: new Date('2026-09-17T09:00:00Z'), index: 2 },
    { start: new Date('2026-09-10T07:00:00Z'), end: new Date('2026-09-10T09:00:00Z'), index: 1 },
  ];

  const mockExistingSchedule = {
    startDate: '2026-09-03',
    endDate: '2026-12-25',
    timeZone: 'Asia/Hong_Kong',
    timeSlots: [{ days: ['Thu'], startTime: '15:00', endTime: '17:00' }],
  };

  const mockNewSchedule = {
    startDate: '2026-09-25',
    endDate: '2026-12-25',
    timeZone: 'Asia/Hong_Kong',
    timeSlots: [{ days: ['Fri'], startTime: '10:00', endTime: '12:00' }],
  };

  it('renders nothing when show is false', () => {
    const { container } = render(
      <ScheduleChangeModal
        show={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        pastLessons={mockPastLessons}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders warning banner with past lesson count and date range when show is true', () => {
    render(
      <ScheduleChangeModal
        show={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        pastLessons={mockPastLessons}
        existingSchedule={mockExistingSchedule}
        newSchedule={mockNewSchedule}
      />
    );

    expect(screen.getByText(/Class Timetable Change Safeguard/i)).toBeInTheDocument();
    expect(screen.getByText(/3 completed lessons have/i)).toBeInTheDocument();
    expect(screen.getByText(/Recommended/i)).toBeInTheDocument();
  });

  it('defaults to archive_and_apply and confirms when clicking action button', () => {
    const mockConfirm = vi.fn();
    render(
      <ScheduleChangeModal
        show={true}
        onClose={vi.fn()}
        onConfirm={mockConfirm}
        pastLessons={mockPastLessons}
        existingSchedule={mockExistingSchedule}
        newSchedule={mockNewSchedule}
      />
    );

    const confirmBtn = screen.getByRole('button', { name: /Apply & Preserve History/i });
    fireEvent.click(confirmBtn);

    expect(mockConfirm).toHaveBeenCalledWith({
      action: 'archive_and_apply',
    });
  });

  it('allows selecting overwrite option and confirms overwrite action', () => {
    const mockConfirm = vi.fn();
    render(
      <ScheduleChangeModal
        show={true}
        onClose={vi.fn()}
        onConfirm={mockConfirm}
        pastLessons={mockPastLessons}
        existingSchedule={mockExistingSchedule}
        newSchedule={mockNewSchedule}
      />
    );

    const overwriteRadio = screen.getByLabelText(/Overwrite Entire Schedule/i);
    fireEvent.click(overwriteRadio);

    const confirmBtn = screen.getByRole('button', { name: /Overwrite Entire Schedule/i });
    fireEvent.click(confirmBtn);

    expect(mockConfirm).toHaveBeenCalledWith({
      action: 'overwrite',
    });
  });

  it('calls onClose when clicking Cancel button', () => {
    const mockClose = vi.fn();
    render(
      <ScheduleChangeModal
        show={true}
        onClose={mockClose}
        onConfirm={vi.fn()}
        pastLessons={mockPastLessons}
      />
    );

    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
