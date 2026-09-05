import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AlertsWidget from './AlertsWidget';

describe('AlertsWidget Component', () => {
  it('renders empty alert message when no irregularities are present', () => {
    render(<AlertsWidget recentIrregularities={[]} ipAddress="127.0.0.1" />);

    expect(screen.getByText(/My Recent Alerts/i)).toBeInTheDocument();
    expect(screen.getByText(/You have no recent alerts/i)).toBeInTheDocument();
    expect(screen.getByText(/127\.0\.0\.1/i)).toBeInTheDocument();
  });

  it('renders alerts and handles load more and collapse', () => {
    const mockAlerts = [
      { id: '1', title: 'Suspicious Tab', description: 'Opened secondary tab', severity: 'warning', timestamp: new Date('2026-09-01T10:00:00Z') },
      { id: '2', type: 'Multiple Faces', description: null, severity: 'critical', timestamp: { toDate: () => new Date('2026-09-01T10:05:00Z') } },
      { id: '3', title: 'Audio Spike', description: 'Voice detected', severity: 'info', timestamp: 1788220800000 },
      { id: '4', title: 'Window Blur', description: 'Lost focus', severity: 'warning', timestamp: '2026-09-01T10:15:00Z' },
      { id: '5', title: 'No Face Detected', description: 'Student stepped away', severity: 'critical', timestamp: null },
    ];

    render(<AlertsWidget recentIrregularities={mockAlerts} ipAddress="192.168.1.50" />);

    expect(screen.getByText('5 alerts')).toBeInTheDocument();
    expect(screen.getByText('Suspicious Tab')).toBeInTheDocument();
    expect(screen.getByText('Multiple Faces')).toBeInTheDocument();
    expect(screen.getByText('Audio Spike')).toBeInTheDocument();
    expect(screen.queryByText('Window Blur')).not.toBeInTheDocument();

    // Click Load More
    const loadMoreBtn = screen.getByRole('button', { name: /Load More/i });
    fireEvent.click(loadMoreBtn);

    expect(screen.getByText('Window Blur')).toBeInTheDocument();
    expect(screen.getByText('No Face Detected')).toBeInTheDocument();

    // Click Collapse
    const collapseBtn = screen.getByRole('button', { name: /Show Fewer/i });
    fireEvent.click(collapseBtn);

    expect(screen.queryByText('Window Blur')).not.toBeInTheDocument();
  });
});
