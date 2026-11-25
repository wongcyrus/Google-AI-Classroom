import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Sidebar from './Sidebar';

describe('Sidebar Component', () => {
  const mockClassProps = { classId: 'CLASS_101', name: 'Software Architecture' };
  const mockMyProps = { Seat: 'Lab PC 12' };
  const mockIrregularities = [{ id: 'irr_1', type: 'tab_switch', timestamp: Date.now() }];
  const mockMessages = [{ id: 'msg_1', message: 'Please pay attention to demo', timestamp: Date.now() }];

  it('renders Class Info, Messages, and Alerts tabs without Live Lecture Transcript', () => {
    render(
      <Sidebar
        classProperties={mockClassProps}
        myProperties={mockMyProps}
        recentIrregularities={mockIrregularities}
        ipAddress="192.168.1.100"
        recentMessages={mockMessages}
      />
    );

    expect(screen.getByRole('tab', { name: /All Panels/i })).toHaveClass('active');
    expect(screen.getByRole('tab', { name: /Class Info/i })).not.toHaveClass('active');
    expect(screen.getByRole('tab', { name: /Messages/i })).not.toHaveClass('active');
    expect(screen.getByRole('tab', { name: /Alerts/i })).not.toHaveClass('active');
    expect(screen.queryByRole('tab', { name: /Transcript/i })).not.toBeInTheDocument();

    expect(screen.queryByText(/Live Lecture Transcript/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Listening for instructor lecture speech/i)).not.toBeInTheDocument();

    // All three panels visible in 'all' mode
    expect(screen.getByText('Class Properties')).toBeVisible();
    expect(screen.getByText('My Recent Messages')).toBeVisible();
    expect(screen.getByText('My Recent Alerts')).toBeVisible();
  });

  it('switches internal tab when clicking tab buttons and toggles panel visibility', () => {
    render(
      <Sidebar
        classProperties={mockClassProps}
        myProperties={mockMyProps}
        recentIrregularities={mockIrregularities}
        ipAddress="192.168.1.100"
        recentMessages={mockMessages}
      />
    );

    // Click Messages tab
    fireEvent.click(screen.getByRole('tab', { name: /Messages/i }));
    expect(screen.getByRole('tab', { name: /Messages/i })).toHaveClass('active');
    expect(screen.getByRole('tab', { name: /All Panels/i })).not.toHaveClass('active');
    expect(screen.getByText('My Recent Messages')).toBeVisible();
    expect(screen.getByText('Class Properties')).not.toBeVisible();
    expect(screen.getByText('My Recent Alerts')).not.toBeVisible();

    // Click Class Info tab
    fireEvent.click(screen.getByRole('tab', { name: /Class Info/i }));
    expect(screen.getByRole('tab', { name: /Class Info/i })).toHaveClass('active');
    expect(screen.getByText('Class Properties')).toBeVisible();
    expect(screen.getByText('My Recent Messages')).not.toBeVisible();

    // Click Alerts tab
    fireEvent.click(screen.getByRole('tab', { name: /Alerts/i }));
    expect(screen.getByRole('tab', { name: /Alerts/i })).toHaveClass('active');
    expect(screen.getByText('My Recent Alerts')).toBeVisible();
    expect(screen.getByText('My Recent Messages')).not.toBeVisible();

    // Click All Panels tab
    fireEvent.click(screen.getByRole('tab', { name: /All Panels/i }));
    expect(screen.getByRole('tab', { name: /All Panels/i })).toHaveClass('active');
    expect(screen.getByText('Class Properties')).toBeVisible();
    expect(screen.getByText('My Recent Messages')).toBeVisible();
    expect(screen.getByText('My Recent Alerts')).toBeVisible();
  });

  it('honors external activeTab and triggers onTabChange callback', () => {
    const handleTabChange = vi.fn();

    const { rerender } = render(
      <Sidebar
        activeTab="properties"
        onTabChange={handleTabChange}
        classProperties={mockClassProps}
        myProperties={mockMyProps}
      />
    );

    expect(screen.getByRole('tab', { name: /Class Info/i })).toHaveClass('active');

    // Click messages tab
    fireEvent.click(screen.getByRole('tab', { name: /Messages/i }));
    expect(handleTabChange).toHaveBeenCalledWith('messages');

    // Re-render with new external activeTab
    rerender(
      <Sidebar
        activeTab="alerts"
        onTabChange={handleTabChange}
        classProperties={mockClassProps}
        myProperties={mockMyProps}
      />
    );
    expect(screen.getByRole('tab', { name: /Alerts/i })).toHaveClass('active');
  });

  it('places Class Properties first, followed immediately by My Recent Messages, then My Recent Alerts', () => {
    const { container } = render(
      <Sidebar
        classProperties={mockClassProps}
        myProperties={mockMyProps}
        recentIrregularities={mockIrregularities}
        ipAddress="192.168.1.100"
        recentMessages={mockMessages}
      />
    );

    const propertiesHeading = screen.getByText('Class Properties');
    const messagesHeading = screen.getByText('My Recent Messages');
    const alertsHeading = screen.getByText('My Recent Alerts');

    expect(
      propertiesHeading.compareDocumentPosition(messagesHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      messagesHeading.compareDocumentPosition(alertsHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(4);
    expect(tabs[0]).toHaveTextContent(/All Panels/i);
    expect(tabs[1]).toHaveTextContent(/Class Info/i);
    expect(tabs[2]).toHaveTextContent(/Messages/i);
    expect(tabs[3]).toHaveTextContent(/Alerts/i);
  });
});
