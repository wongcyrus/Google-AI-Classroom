import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScheduleManager from './ScheduleManager';

describe('ScheduleManager Component Suite', () => {
  it('renders schedule manager inputs, validates start/end times and overlap', () => {
    const mockSetStartDate = vi.fn();
    const mockSetEndDate = vi.fn();
    const mockSetTimeZone = vi.fn();
    const mockSetClassSchedules = vi.fn();

    const classSchedules = [
      {
        startTime: '09:00',
        endTime: '11:00',
        days: ['Mon', 'Wed'],
      },
    ];

    const { rerender } = render(
      <ScheduleManager
        scheduleStartDate="2026-09-01"
        setScheduleStartDate={mockSetStartDate}
        scheduleEndDate="2026-12-31"
        setScheduleEndDate={mockSetEndDate}
        timeZone="Asia/Hong_Kong"
        setTimeZone={mockSetTimeZone}
        classSchedules={classSchedules}
        setClassSchedules={mockSetClassSchedules}
      />
    );

    expect(screen.getByText(/Mon, Wed: 9:00 AM - 11:00 AM/i)).toBeInTheDocument();

    // Remove existing schedule
    const removeBtn = screen.getByRole('button', { name: /Remove/i });
    fireEvent.click(removeBtn);
    expect(mockSetClassSchedules).toHaveBeenCalledWith([]);

    // Try adding without required fields
    const addBtn = screen.getByRole('button', { name: /Add Schedule/i });
    fireEvent.click(addBtn);
    expect(screen.getByText(/Please provide start time, end time, and at least one day/i)).toBeInTheDocument();

    // Select start time (09:00) which auto sets end time (11:00)
    const selectElements = screen.getAllByRole('combobox');
    const startTimeSelect = selectElements[1]; // 0 is timezone, 1 is start time, 2 is end time
    fireEvent.change(startTimeSelect, { target: { value: '09:00' } });

    // Select a day
    const monCheckbox = screen.getByRole('checkbox', { name: 'Mon' });
    fireEvent.click(monCheckbox);

    // Click Add Schedule -> should trigger overlap error because Mon 09:00 - 11:00 overlaps
    fireEvent.click(addBtn);
    expect(screen.getByText(/Schedule overlap or adjacent schedule detected/i)).toBeInTheDocument();

    // Toggle Mon off, toggle Fri on, and change start time to 14:00
    fireEvent.click(monCheckbox);
    const friCheckbox = screen.getByRole('checkbox', { name: 'Fri' });
    fireEvent.click(friCheckbox);
    fireEvent.change(startTimeSelect, { target: { value: '14:00' } });

    // Add schedule should succeed now
    fireEvent.click(addBtn);
    expect(mockSetClassSchedules).toHaveBeenCalledWith([
      ...classSchedules,
      { startTime: '14:00', endTime: '16:00', days: ['Fri'] },
    ]);
  });
});
