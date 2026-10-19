import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Banner from './Banner';

describe('Banner Component', () => {
  it('returns null and does not render when message is empty or null', () => {
    const { container } = render(<Banner message="" onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders message and triggers onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<Banner message="Class starts in 5 minutes!" onClose={onClose} />);

    expect(screen.getByText('Class starts in 5 minutes!')).toBeInTheDocument();
    
    const closeBtn = screen.getByRole('button');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders URLs in banner messages as clickable links with target="_blank"', () => {
    render(
      <Banner
        message="📢 Open https://it114115-2627.web.app/quiz now!"
        onClose={vi.fn()}
      />
    );

    const link = screen.getByRole('link', { name: 'https://it114115-2627.web.app/quiz' });
    expect(link).toHaveAttribute('href', 'https://it114115-2627.web.app/quiz');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
