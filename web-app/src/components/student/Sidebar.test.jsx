import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Sidebar from './Sidebar';

describe('Sidebar Component', () => {
  const mockClassProps = { classId: 'CLASS_101', name: 'Software Architecture' };
  const mockMyProps = { Seat: 'Lab PC 12' };
  const mockIrregularities = [{ id: 'irr_1', type: 'tab_switch', timestamp: Date.now() }];
  const mockMessages = [{ id: 'msg_1', text: 'Please pay attention to demo', sender: 'Teacher' }];

  it('renders all 4 tabs and displays all panels by default', () => {
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
    expect(screen.getByRole('tab', { name: /Transcript/i })).not.toHaveClass('active');
    expect(screen.getByRole('tab', { name: /Class Info/i })).not.toHaveClass('active');
    expect(screen.getByRole('tab', { name: /Alerts/i })).not.toHaveClass('active');

    // In 'all' mode, empty placeholder for transcript is visible
    expect(screen.getByText(/Listening for instructor lecture speech\.\.\./i)).toBeInTheDocument();
  });

  it('switches internal tab when clicking tab buttons', () => {
    render(
      <Sidebar
        classProperties={mockClassProps}
        myProperties={mockMyProps}
        recentIrregularities={mockIrregularities}
        ipAddress="192.168.1.100"
        recentMessages={mockMessages}
      />
    );

    // Click Transcript tab
    fireEvent.click(screen.getByRole('tab', { name: /Transcript/i }));
    expect(screen.getByRole('tab', { name: /Transcript/i })).toHaveClass('active');
    expect(screen.getByRole('tab', { name: /All Panels/i })).not.toHaveClass('active');

    // Click Class Info tab
    fireEvent.click(screen.getByRole('tab', { name: /Class Info/i }));
    expect(screen.getByRole('tab', { name: /Class Info/i })).toHaveClass('active');

    // Click Alerts tab
    fireEvent.click(screen.getByRole('tab', { name: /Alerts/i }));
    expect(screen.getByRole('tab', { name: /Alerts/i })).toHaveClass('active');

    // Click All Panels tab
    fireEvent.click(screen.getByRole('tab', { name: /All Panels/i }));
    expect(screen.getByRole('tab', { name: /All Panels/i })).toHaveClass('active');
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

    // Click transcript tab
    fireEvent.click(screen.getByRole('tab', { name: /Transcript/i }));
    expect(handleTabChange).toHaveBeenCalledWith('transcript');

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

  it('renders live transcript entries and in-flight current speech sentence', () => {
    const mockTranscript = [
      {
        id: 't1',
        time: '10:00:15',
        speaker: 'Dr. Wong',
        original: 'Today we will discuss Docker containers.',
        translation: '今天我們將討論 Docker 容器。',
        lang: 'zh-Hant',
      },
      {
        id: 't2',
        timestamp: new Date('2026-09-26T10:01:00Z').getTime(),
        original: 'Make sure your terminals are open.',
        translation: '請確保打開終端機。',
      },
    ];

    render(
      <Sidebar
        activeTab="transcript"
        liveTranscriptHistory={mockTranscript}
        currentOriginalText="Let us start the demo."
        currentTranslationText="讓我們開始示範。"
        selectedLanguage="zh-Hant"
      />
    );

    // Total entries badge: 2 history + 1 in-flight = 3 entries
    expect(screen.getByText('3 entries')).toBeInTheDocument();

    // History items
    expect(screen.getByText('Today we will discuss Docker containers.')).toBeInTheDocument();
    expect(screen.getByText('今天我們將討論 Docker 容器。')).toBeInTheDocument();
    expect(screen.getByText('Dr. Wong')).toBeInTheDocument();
    expect(screen.getByText('10:00:15')).toBeInTheDocument();

    expect(screen.getByText('Make sure your terminals are open.')).toBeInTheDocument();
    expect(screen.getByText('請確保打開終端機。')).toBeInTheDocument();

    // In-flight sentence
    expect(screen.getByText('Speaking now')).toBeInTheDocument();
    expect(screen.getByText('Let us start the demo.')).toBeInTheDocument();
    expect(screen.getByText('讓我們開始示範。')).toBeInTheDocument();
  });

  it('invokes scrollIntoView when transcript updates and tab is active', () => {
    const scrollIntoViewMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    const { rerender } = render(
      <Sidebar
        activeTab="transcript"
        liveTranscriptHistory={[]}
        currentOriginalText="First sentence."
      />
    );

    expect(scrollIntoViewMock).toHaveBeenCalled();

    rerender(
      <Sidebar
        activeTab="transcript"
        liveTranscriptHistory={[{ id: 'item1', original: 'Sentence 1' }]}
        currentOriginalText="Second sentence."
      />
    );

    expect(scrollIntoViewMock).toHaveBeenCalled();
  });
});
