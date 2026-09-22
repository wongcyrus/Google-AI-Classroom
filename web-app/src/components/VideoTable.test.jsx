import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VideoTable, { formatDate } from './VideoTable';

describe('VideoTable Component', () => {
  const mockVideos = [
    {
      id: 'vid_1',
      studentEmail: 'student1@stu.vtc.edu.hk',
      studentUid: 'uid_1',
      startTime: { toDate: () => new Date('2026-09-18T10:00:00Z') },
      endTime: new Date('2026-09-18T11:00:00Z'),
      duration: 3600,
      size: 104857600, // 100 MB
      createdAt: '2026-09-18T11:05:00Z',
      videoPath: 'videos/class1/vid1.mp4',
    },
    {
      id: 'vid_2',
      studentEmail: null,
      studentUid: 'uid_2',
      startTime: null,
      endTime: undefined,
      duration: 0,
      size: 512,
      createdAt: null,
      videoPath: null,
    },
  ];

  it('correctly formats various date representations via formatDate', () => {
    expect(formatDate(null)).toBe('N/A');
    expect(formatDate(undefined)).toBe('N/A');
    expect(formatDate('invalid-date')).toBe('N/A');

    const ts = { toDate: () => new Date('2026-09-18T12:00:00Z') };
    expect(formatDate(ts)).toBe(new Date('2026-09-18T12:00:00Z').toLocaleString());

    const d = new Date('2026-09-18T12:00:00Z');
    expect(formatDate(d)).toBe(d.toLocaleString());

    const isoStr = '2026-09-18T12:00:00.000Z';
    expect(formatDate(isoStr)).toBe(new Date(isoStr).toLocaleString());
  });

  it('renders video rows and handles play, select, and download callbacks', () => {
    const onSelectVideo = vi.fn();
    const onPlayVideo = vi.fn();
    const onDownloadVideo = vi.fn();
    const onSelectAll = vi.fn();

    const selectedVideos = new Map();
    selectedVideos.set('vid_1', mockVideos[0]);

    render(
      <VideoTable
        videos={mockVideos}
        selectedVideos={selectedVideos}
        onSelectVideo={onSelectVideo}
        onPlayVideo={onPlayVideo}
        onDownloadVideo={onDownloadVideo}
        onSelectAll={onSelectAll}
        downloadingVideos={new Set()}
      />
    );

    expect(screen.getByText('student1@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.getByText('uid_2')).toBeInTheDocument(); // fallback when studentEmail is null
    expect(screen.getByText('100.00 MB')).toBeInTheDocument();
    expect(screen.getByText('512 B')).toBeInTheDocument();
    expect(screen.getByText('Path Not Found')).toBeInTheDocument();

    // Play button
    const playButtons = screen.getAllByRole('button', { name: '▶️' });
    fireEvent.click(playButtons[0]);
    expect(onPlayVideo).toHaveBeenCalledWith(mockVideos[0]);

    // Download button for vid_1
    const downloadBtn = screen.getByRole('button', { name: /Download/i });
    fireEvent.click(downloadBtn);
    expect(onDownloadVideo).toHaveBeenCalledWith(mockVideos[0]);

    // Select checkbox
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]); // vid_1 checkbox
    expect(onSelectVideo).toHaveBeenCalledWith(mockVideos[0]);

    // Select all checkbox in header
    fireEvent.click(checkboxes[0]);
    expect(onSelectAll).toHaveBeenCalled();
  });

  it('displays loading state and disables button when video is downloading', () => {
    const downloadingSet = new Set(['vid_1']);

    render(
      <VideoTable
        videos={mockVideos}
        selectedVideos={new Map()}
        onSelectVideo={vi.fn()}
        onPlayVideo={vi.fn()}
        onDownloadVideo={vi.fn()}
        onSelectAll={vi.fn()}
        downloadingVideos={downloadingSet}
      />
    );

    const downloadingBtn = screen.getByRole('button', { name: /Downloading\.\.\./i });
    expect(downloadingBtn).toBeInTheDocument();
    expect(downloadingBtn).toBeDisabled();
  });
});
