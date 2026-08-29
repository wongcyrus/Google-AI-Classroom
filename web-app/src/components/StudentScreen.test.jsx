import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import StudentScreen from './StudentScreen';

describe('StudentScreen Component', () => {
  const mockStudent = { name: 'Alice Wong', email: 'alice@school.edu' };

  it('renders student name and "Not Sharing" placeholder when disconnected', () => {
    render(<StudentScreen student={mockStudent} isSharing={false} screenshotUrl={null} />);
    
    expect(screen.getByText('Alice Wong')).toBeInTheDocument();
    expect(screen.getByText('Not Sharing')).toBeInTheDocument();
  });

  it('renders "Connecting..." placeholder when isSharing is true but no image is yet received', () => {
    render(<StudentScreen student={mockStudent} isSharing={true} screenshotUrl={null} />);
    
    expect(screen.getByText('Connecting...')).toBeInTheDocument();
  });

  it('renders screenshot image element when screenshotUrl is provided', () => {
    const url = 'https://storage.googleapis.com/test-bucket/test.jpg';
    render(<StudentScreen student={mockStudent} isSharing={true} screenshotUrl={url} />);
    
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', url);
    expect(img.getAttribute('alt')).toContain('alice@school.edu');
  });

  it('triggers onClick handler when card is clicked', () => {
    const onClick = vi.fn();
    render(<StudentScreen student={mockStudent} isSharing={false} screenshotUrl={null} onClick={onClick} />);
    
    fireEvent.click(screen.getByText('Alice Wong'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
