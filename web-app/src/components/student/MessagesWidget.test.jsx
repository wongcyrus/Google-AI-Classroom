import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MessagesWidget from './MessagesWidget';

describe('MessagesWidget Component', () => {
  it('renders empty message when no recent messages exist', () => {
    render(<MessagesWidget recentMessages={[]} />);

    expect(screen.getByText(/My Recent Messages/i)).toBeInTheDocument();
    expect(screen.getByText(/You have no recent messages/i)).toBeInTheDocument();
  });

  it('renders messages and handles load more and collapse', () => {
    const mockMessages = [
      { id: '1', message: 'Welcome to exam session', timestamp: new Date('2026-09-01T10:00:00Z') },
      { id: '2', message: 'Please keep webcam centered', timestamp: { toDate: () => new Date('2026-09-01T10:05:00Z') } },
      { id: '3', message: '5 minutes remaining', timestamp: 1788220800000 },
      { id: '4', message: 'Time is up, submit work', timestamp: '2026-09-01T10:15:00Z' },
      { id: '5', message: 'Session concluded', timestamp: null },
    ];

    render(<MessagesWidget recentMessages={mockMessages} />);

    expect(screen.getByText('5 messages')).toBeInTheDocument();
    expect(screen.getByText('Welcome to exam session')).toBeInTheDocument();
    expect(screen.getByText('Please keep webcam centered')).toBeInTheDocument();
    expect(screen.getByText('5 minutes remaining')).toBeInTheDocument();
    expect(screen.queryByText('Time is up, submit work')).not.toBeInTheDocument();

    // Click Load More
    const loadMoreBtn = screen.getByRole('button', { name: /Load More/i });
    fireEvent.click(loadMoreBtn);

    expect(screen.getByText('Time is up, submit work')).toBeInTheDocument();
    expect(screen.getByText('Session concluded')).toBeInTheDocument();

    // Click Collapse
    const collapseBtn = screen.getByRole('button', { name: /Show Fewer/i });
    fireEvent.click(collapseBtn);

    expect(screen.queryByText('Time is up, submit work')).not.toBeInTheDocument();
  });
});
