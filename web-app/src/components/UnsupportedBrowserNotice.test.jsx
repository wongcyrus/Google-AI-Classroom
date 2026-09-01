import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UnsupportedBrowserNotice from './UnsupportedBrowserNotice';

describe('UnsupportedBrowserNotice Component', () => {
  it('renders Google Chrome Required heading and detected browser name', () => {
    render(<UnsupportedBrowserNotice detectedBrowser="Apple Safari" />);

    expect(screen.getByText(/Google Chrome Required/i)).toBeInTheDocument();
    expect(screen.getByText(/Apple Safari/i)).toBeInTheDocument();
    expect(screen.getByText(/all students are strictly required to use Google Chrome/i)).toBeInTheDocument();
  });

  it('renders download Chrome link with correct target and URL', () => {
    render(<UnsupportedBrowserNotice detectedBrowser="Mozilla Firefox" />);

    const downloadLink = screen.getByRole('link', { name: /Download Google Chrome/i });
    expect(downloadLink).toBeInTheDocument();
    expect(downloadLink).toHaveAttribute('href', 'https://www.google.com/chrome/');
    expect(downloadLink).toHaveAttribute('target', '_blank');
  });

  it('calls onBackToLogin callback when Go to Login Page button is clicked', () => {
    const onBackToLogin = vi.fn();
    render(<UnsupportedBrowserNotice detectedBrowser="Microsoft Edge" onBackToLogin={onBackToLogin} />);

    const backBtn = screen.getByRole('button', { name: /Go to Login Page/i });
    expect(backBtn).toBeInTheDocument();

    fireEvent.click(backBtn);
    expect(onBackToLogin).toHaveBeenCalledTimes(1);
  });
});
