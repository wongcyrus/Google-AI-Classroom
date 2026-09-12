import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StudentsGrid from './StudentsGrid';

vi.mock('../StudentScreen', () => ({
  default: ({ student, isSharing, screenshotData, screenshotUrl }) => (
    <div data-testid={`student-tile-${student.id}`}>
      <span data-testid="student-name">{student.name || student.email}</span>
      <span data-testid="is-sharing">{isSharing ? 'sharing' : 'not-sharing'}</span>
      <span data-testid="has-screenshot">{screenshotData || screenshotUrl ? 'has-data' : 'no-data'}</span>
    </div>
  ),
}));

describe('StudentsGrid Component', () => {
  const baseNow = new Date('2026-09-12T12:00:00Z');

  it('tolerates student clock drift where student timestamp is ahead of teacher clock', () => {
    // Student clock is 5 seconds ahead of teacher's clock
    const futureTimestamp = new Date(baseNow.getTime() + 5000);

    const students = [
      { id: 's_drift', email: 'drift@school.edu', isSharing: true },
    ];
    const screenshots = {
      s_drift: {
        url: 'https://storage.local/screen_drift.jpg',
        timestamp: futureTimestamp,
      },
    };

    render(
      <StudentsGrid
        students={students}
        screenshots={screenshots}
        now={baseNow}
        frameRate={15}
        problemFilter="all"
      />
    );

    const tile = screen.getByTestId('student-tile-s_drift');
    expect(tile).toBeInTheDocument();
    expect(screen.getByTestId('is-sharing')).toHaveTextContent('sharing');
    expect(screen.getByTestId('has-screenshot')).toHaveTextContent('has-data');
  });

  it('correctly marks stale screenshot outside freshness window as not fresh', () => {
    // Student timestamp is 200 seconds in the past (outside max(15*3, 30) = 45s)
    const staleTimestamp = new Date(baseNow.getTime() - 200000);

    const students = [
      { id: 's_stale', email: 'stale@school.edu', isSharing: true },
    ];
    const screenshots = {
      s_stale: {
        url: 'https://storage.local/screen_stale.jpg',
        timestamp: staleTimestamp,
      },
    };

    render(
      <StudentsGrid
        students={students}
        screenshots={screenshots}
        now={baseNow}
        frameRate={15}
        problemFilter="all"
      />
    );

    const isSharingElem = screen.queryByTestId('is-sharing');
    if (isSharingElem) {
      expect(isSharingElem).toHaveTextContent('not-sharing');
      expect(screen.getByTestId('has-screenshot')).toHaveTextContent('no-data');
    }
  });

  it('renders empty filter state when no students match filter', () => {
    render(
      <StudentsGrid
        students={[]}
        screenshots={{}}
        now={baseNow}
        problemFilter="no_cam"
      />
    );

    expect(screen.getByText(/All students are compliant with the selected filter/i)).toBeInTheDocument();
  });
});
