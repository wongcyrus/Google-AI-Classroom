import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import LectureRecordingsView, { extractYouTubeVideoId, formatFileSize } from './LectureRecordingsView';

let snapshotCallback;
const mockOnSnapshot = vi.fn((query, cb) => {
  snapshotCallback = cb;
  return vi.fn(); // unsubscribe mock
});
const mockDeleteDoc = vi.fn().mockResolvedValue();
const mockUpdateDoc = vi.fn().mockResolvedValue();

vi.mock('../firebase-config', () => ({
  db: {},
  functions: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((db, ...pathSegments) => ({ path: pathSegments.join('/') })),
  doc: vi.fn((db, ...pathSegments) => ({ path: pathSegments.join('/') })),
  deleteDoc: (...args) => mockDeleteDoc(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
  query: vi.fn((collRef) => collRef),
  orderBy: vi.fn(),
  onSnapshot: (...args) => mockOnSnapshot(...args),
}));

const mockHttpsCallable = vi.fn();
vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockHttpsCallable,
}));

// Mock JSZip
vi.mock('jszip', () => {
  return {
    default: class MockJSZip {
      folder() { return this; }
      file() { return this; }
      generateAsync() {
        return Promise.resolve(new Blob(['fake-zip'], { type: 'application/zip' }));
      }
    },
  };
});


describe('LectureRecordingsView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('1\n00:00:00,000 --> 00:00:05,000\nTest Subtitle'),
    });
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(),
      },
    });
  });

  it('renders empty state when classId is empty or no recordings', async () => {
    render(<LectureRecordingsView classId="test_class" />);
    expect(screen.getByText(/loading lecture recordings/i)).toBeInTheDocument();

    await act(async () => {
      snapshotCallback({ docs: [] });
    });

    await waitFor(() => {
      expect(screen.getByText(/no lecture recordings found for class/i)).toBeInTheDocument();
    });
  });

  it('renders list of recordings and displays selected video player with CC tracks', async () => {
    render(<LectureRecordingsView classId="test_class" />);

    const mockDocs = [
      {
        id: 'rec_1',
        data: () => ({
          title: 'Introduction to React & State',
          topic: 'React Hooks',
          durationSeconds: 125,
          status: 'ready',
          videoUrl: 'https://storage.googleapis.com/test/lecture1.webm',
          vttUrls: {
            en: 'https://storage.googleapis.com/test/subtitles_en.vtt',
            'zh-Hant': 'https://storage.googleapis.com/test/subtitles_zh-Hant.vtt',
            ja: 'https://storage.googleapis.com/test/subtitles_ja.vtt',
          },
          srtUrls: {
            en: 'https://storage.googleapis.com/test/subtitles_en.srt',
          },
          youtubeMetadata: {
            title: 'test_class - Introduction to React & State',
            description: '00:00 - Intro\n01:30 - Demo',
          },
        }),
      },
    ];

    await act(async () => {
      snapshotCallback({ docs: mockDocs });
    });

    await waitFor(() => {
      expect(screen.getAllByText('Introduction to React & State').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText(/02:05/).length).toBeGreaterThan(0); // Duration format check
    expect(screen.getByText(/Ready \(Multi-CC\)/i)).toBeInTheDocument();
    expect(screen.getByText(/YouTube Studio & Publishing/i)).toBeInTheDocument();
    expect(screen.getByText('test_class - Introduction to React & State')).toBeInTheDocument();

    // Check HTML5 video and tracks
    const videoElement = document.querySelector('video');
    expect(videoElement).toBeInTheDocument();
    const tracks = videoElement.querySelectorAll('track');
    expect(tracks.length).toBe(3); // en, zh-Hant, ja
  });

  it('allows copying YouTube title to clipboard', async () => {
    render(<LectureRecordingsView classId="test_class" />);

    const mockDocs = [
      {
        id: 'rec_1',
        data: () => ({
          title: 'Sample Lecture',
          status: 'ready',
          videoUrl: 'https://storage.googleapis.com/test/lecture.webm',
          youtubeMetadata: {
            title: 'Sample Lecture YouTube Title',
            description: 'Sample Description',
          },
        }),
      },
    ];

    await act(async () => {
      snapshotCallback({ docs: mockDocs });
    });

    await waitFor(() => {
      expect(screen.getByText('📋 Copy Title')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('📋 Copy Title'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Sample Lecture YouTube Title');
  });

  it('allows downloading YouTube package as zip', async () => {
    render(<LectureRecordingsView classId="test_class" />);

    const mockDocs = [
      {
        id: 'rec_1',
        data: () => ({
          title: 'Sample Lecture',
          status: 'ready',
          videoUrl: 'https://storage.googleapis.com/test/lecture.webm',
          srtUrls: { en: 'https://storage.googleapis.com/test/en.srt' },
          youtubeMetadata: {
            title: 'Sample Title',
            description: 'Sample Description',
          },
        }),
      },
    ];

    await act(async () => {
      snapshotCallback({ docs: mockDocs });
    });

    await waitFor(() => {
      expect(screen.getByText(/Download YouTube Package/i)).toBeInTheDocument();
    });

    const exportBtn = screen.getByText(/Download YouTube Package/i);
    await act(async () => {
      fireEvent.click(exportBtn);
    });

    await waitFor(() => {
      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });
  });

  it('allows copying description and triggering/retrying subtitles when status is not ready', async () => {
    mockHttpsCallable.mockResolvedValueOnce({ data: { success: true } });

    render(<LectureRecordingsView classId="test_class" />);

    const mockDocs = [
      {
        id: 'rec_retry',
        data: () => ({
          title: 'Pending Subtitles Lecture',
          status: 'failed',
          storagePath: 'lectures/test_class/video.webm',
          videoUrl: 'https://storage.googleapis.com/test/lecture.webm',
          youtubeMetadata: {
            title: 'Sample Title',
            description: '00:00 - Introduction\n05:00 - Q&A',
          },
        }),
      },
    ];

    await act(async () => {
      snapshotCallback({ docs: mockDocs });
    });

    await waitFor(() => {
      expect(screen.getByText('📋 Copy Description')).toBeInTheDocument();
      expect(screen.getByText(/Generate \/ Retry Subtitles/i)).toBeInTheDocument();
    });

    // Test copying description
    fireEvent.click(screen.getByText('📋 Copy Description'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('00:00 - Introduction\n05:00 - Q&A');

    // Test triggering subtitles
    const retryBtn = screen.getByText(/Generate \/ Retry Subtitles/i);
    await act(async () => {
      fireEvent.click(retryBtn);
    });

    expect(mockHttpsCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: 'test_class',
        sessionId: 'rec_retry',
      })
    );
  });

  it('allows teacher to delete a lecture recording', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LectureRecordingsView classId="test_class" />);

    const mockDocs = [
      {
        id: 'rec_del',
        data: () => ({
          title: 'Lecture To Delete',
          status: 'ready',
          videoUrl: 'https://storage.googleapis.com/test/lecture.webm',
        }),
      },
    ];

    await act(async () => {
      snapshotCallback({ docs: mockDocs });
    });

    await waitFor(() => {
      expect(screen.getAllByText('Lecture To Delete').length).toBeGreaterThan(0);
    });

    const deleteBtns = screen.getAllByRole('button', { name: /Delete Recording/i });
    expect(deleteBtns.length).toBeGreaterThan(0);
    fireEvent.click(deleteBtns[0]);

    await waitFor(() => {
      expect(mockDeleteDoc).toHaveBeenCalled();
    });
  });

  it('detects unmerged clips for a class session and merges them on click', async () => {
    mockHttpsCallable.mockResolvedValue({
      data: {
        success: true,
        combinedSessionId: 'rec_combined_123',
        storagePath: 'recordings/test_class/rec_combined_123/lecture.webm',
        title: 'Combined Full Lecture - 9/21/2026',
      },
    });

    render(<LectureRecordingsView classId="test_class" />);

    const mockDocs = [
      {
        id: 'rec_clip_1',
        data: () => ({
          title: 'Lecture Clip 1',
          sessionGroupId: 'grp_lecture_1',
          durationSeconds: 65,
          startedAt: new Date('2026-09-21T10:28:30'),
          status: 'ready',
          videoUrl: 'https://storage.googleapis.com/test/clip1.webm',
        }),
      },
      {
        id: 'rec_clip_2',
        data: () => ({
          title: 'Lecture Clip 2',
          sessionGroupId: 'grp_lecture_1',
          durationSeconds: 3120,
          startedAt: new Date('2026-09-21T10:30:30'),
          status: 'ready',
          videoUrl: 'https://storage.googleapis.com/test/clip2.webm',
        }),
      },
    ];

    await act(async () => {
      snapshotCallback({ docs: mockDocs });
    });

    // Verify unmerged banner appears
    await waitFor(() => {
      expect(screen.getByText(/2 separate recording clips detected/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Merge into Full Lecture/i })).toBeInTheDocument();
    });

    // Click Merge
    const mergeBtn = screen.getByRole('button', { name: /Merge into Full Lecture/i });
    await act(async () => {
      fireEvent.click(mergeBtn);
    });

    // Check that callable was invoked with classId, sessionGroupId, and recordingIds
    expect(mockHttpsCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: 'test_class',
        sessionGroupId: 'grp_lecture_1',
        recordingIds: ['rec_clip_1', 'rec_clip_2'],
      })
    );
  });

  describe('extractYouTubeVideoId', () => {
    it('extracts ID from standard watch URL', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(extractYouTubeVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ&t=10s')).toBe('dQw4w9WgXcQ');
    });

    it('extracts ID from short youtu.be URL', () => {
      expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=35s')).toBe('dQw4w9WgXcQ');
    });

    it('extracts ID from embed and live URLs', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(extractYouTubeVideoId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('accepts raw 11-character video ID', () => {
      expect(extractYouTubeVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(extractYouTubeVideoId('  dQw4w9WgXcQ  ')).toBe('dQw4w9WgXcQ');
    });

    it('returns null for invalid inputs', () => {
      expect(extractYouTubeVideoId('')).toBeNull();
      expect(extractYouTubeVideoId(null)).toBeNull();
      expect(extractYouTubeVideoId('https://example.com/not-youtube')).toBeNull();
      expect(extractYouTubeVideoId('short_id')).toBeNull();
    });
  });

  describe('YouTube Linking & Dual Player', () => {
    it('saves a linked YouTube video to Firestore and switches to YouTube player', async () => {
      render(<LectureRecordingsView classId="test_class" />);

      const mockDocs = [
        {
          id: 'rec_yt_test',
          data: () => ({
            title: 'AI Robotics Lecture',
            durationSeconds: 1800,
            startedAt: new Date('2026-09-21T14:00:00'),
            status: 'ready',
            videoUrl: 'https://storage.googleapis.com/test/robotics.webm',
            youtubeMetadata: {
              title: 'AI Robotics Lecture - 9/21/2026',
              description: '00:00 Introduction\n10:00 Sensors',
            },
          }),
        },
      ];

      await act(async () => {
        snapshotCallback({ docs: mockDocs });
      });

      // Verify recording details are rendered
      expect(screen.getAllByText('AI Robotics Lecture').length).toBeGreaterThan(0);

      // Find YouTube link input
      const input = screen.getByPlaceholderText(/e\.g\. https:\/\/youtu\.be/i);
      expect(input).toBeInTheDocument();

      fireEvent.change(input, { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } });

      const saveBtn = screen.getByRole('button', { name: /Save YouTube Link/i });
      await act(async () => {
        fireEvent.click(saveBtn);
      });

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/test_class/lectureRecordings/rec_yt_test' }),
        expect.objectContaining({
          youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          youtubeVideoId: 'dQw4w9WgXcQ',
        })
      );
    });

    it('renders YouTube stream iframe, sidebar badge, and supports switching between YouTube and HTML5 player', async () => {
      render(<LectureRecordingsView classId="test_class" />);

      const mockDocs = [
        {
          id: 'rec_already_linked',
          data: () => ({
            title: 'Published Cloud Architecture Lecture',
            durationSeconds: 2400,
            startedAt: new Date('2026-09-21T15:00:00'),
            status: 'ready',
            videoUrl: 'https://storage.googleapis.com/test/cloud.webm',
            youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            youtubeVideoId: 'dQw4w9WgXcQ',
          }),
        },
      ];

      await act(async () => {
        snapshotCallback({ docs: mockDocs });
      });

      // Verify YouTube badge in list
      expect(screen.getByText('📺 YouTube')).toBeInTheDocument();

      // Verify YouTube iframe is present by default
      const iframe = screen.getByTitle('Published Cloud Architecture Lecture');
      expect(iframe).toBeInTheDocument();
      expect(iframe.src).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');

      // Check player switcher tabs exist
      const ytTab = screen.getByRole('button', { name: /YouTube Stream/i });
      const cloudTab = screen.getByRole('button', { name: /Cloud Storage HTML5 Player/i });
      expect(ytTab).toBeInTheDocument();
      expect(cloudTab).toBeInTheDocument();

      // Switch to Cloud Storage HTML5 Player
      await act(async () => {
        fireEvent.click(cloudTab);
      });

      // HTML5 video element should now be rendered instead of iframe
      expect(screen.queryByTitle('Published Cloud Architecture Lecture')).not.toBeInTheDocument();

      // Switch back to YouTube stream
      await act(async () => {
        fireEvent.click(ytTab);
      });
      expect(screen.getByTitle('Published Cloud Architecture Lecture')).toBeInTheDocument();
    });

    it('unlinks YouTube video when Unlink is clicked and confirmed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      render(<LectureRecordingsView classId="test_class" />);

      const mockDocs = [
        {
          id: 'rec_to_unlink',
          data: () => ({
            title: 'Lecture with YouTube Link',
            durationSeconds: 900,
            startedAt: new Date('2026-09-21T16:00:00'),
            status: 'ready',
            videoUrl: 'https://storage.googleapis.com/test/lecture.webm',
            youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            youtubeVideoId: 'dQw4w9WgXcQ',
          }),
        },
      ];

      await act(async () => {
        snapshotCallback({ docs: mockDocs });
      });

      const unlinkBtn = screen.getByRole('button', { name: /Unlink/i });
      await act(async () => {
        fireEvent.click(unlinkBtn);
      });

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/test_class/lectureRecordings/rec_to_unlink' }),
        expect.objectContaining({
          youtubeUrl: null,
          youtubeVideoId: null,
          youtubeLinkedAt: null,
        })
      );
    });
  });

  describe('Google Drive Integration & Multi-Player', () => {
    it('renders Drive badge and switches to Google Drive stream player', async () => {
      render(<LectureRecordingsView classId="test_class" />);

      const mockDocs = [
        {
          id: 'rec_drive_1',
          data: () => ({
            title: 'Google Drive Streamable Lecture',
            durationSeconds: 1200,
            startedAt: new Date('2026-09-21T16:00:00'),
            status: 'ready',
            videoUrl: 'https://storage.googleapis.com/test/lecture.webm',
            driveFileId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OIvE2up08',
            driveEmbedUrl: 'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OIvE2up08/preview',
            driveWebViewLink: 'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OIvE2up08/view',
          }),
        },
      ];

      await act(async () => {
        snapshotCallback({ docs: mockDocs });
      });

      // Verify Drive badge in recording list
      expect(screen.getByText('📁 Drive')).toBeInTheDocument();

      // Verify Google Drive Stream button exists and is active
      const driveTab = screen.getByRole('button', { name: /Google Drive Stream/i });
      expect(driveTab).toBeInTheDocument();

      // Verify Google Drive iframe is rendered
      const driveIframe = screen.getByTitle('Google Drive Streamable Lecture');
      expect(driveIframe).toBeInTheDocument();
      expect(driveIframe.src).toBe('https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OIvE2up08/preview');

      // Verify switcher allows switching to Cloud Storage HTML5 player
      const cloudTab = screen.getByRole('button', { name: /Cloud Storage HTML5 Player/i });
      await act(async () => {
        fireEvent.click(cloudTab);
      });
      expect(screen.queryByTitle('Google Drive Streamable Lecture')).not.toBeInTheDocument();

      // Switch back to Google Drive Stream
      await act(async () => {
        fireEvent.click(driveTab);
      });
      expect(screen.getByTitle('Google Drive Streamable Lecture')).toBeInTheDocument();
    });

    it('manually links Google Drive URL to recording', async () => {
      render(<LectureRecordingsView classId="test_class" />);

      const mockDocs = [
        {
          id: 'rec_manual_gdrive',
          data: () => ({
            title: 'Manual Drive Link Lecture',
            durationSeconds: 600,
            status: 'ready',
            videoUrl: 'https://storage.googleapis.com/test/lecture.webm',
          }),
        },
      ];

      await act(async () => {
        snapshotCallback({ docs: mockDocs });
      });

      // Find manual link input
      const driveInput = screen.getByPlaceholderText(/e\.g\. https:\/\/drive\.google\.com\/file\/d\/1BxiMVs0X\.\.\.\/view/i);
      expect(driveInput).toBeInTheDocument();

      await act(async () => {
        fireEvent.change(driveInput, {
          target: { value: 'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OIvE2up08/view' },
        });
      });

      const linkBtn = screen.getByRole('button', { name: /Link Drive/i });
      await act(async () => {
        fireEvent.click(linkBtn);
      });

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/test_class/lectureRecordings/rec_manual_gdrive' }),
        expect.objectContaining({
          driveFileId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OIvE2up08',
          driveEmbedUrl: 'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OIvE2up08/preview',
        })
      );
    });

    it('disables Google Drive direct cloud upload feature in UI when no client ID key is configured', async () => {
      render(<LectureRecordingsView classId="test_class" />);

      const mockDocs = [
        {
          id: 'rec_gdrive_config',
          data: () => ({
            title: 'Config Test Lecture',
            durationSeconds: 300,
            status: 'ready',
            videoUrl: 'https://storage.googleapis.com/test/lecture.webm',
          }),
        },
      ];

      await act(async () => {
        snapshotCallback({ docs: mockDocs });
      });

      // Connect button is not rendered when unconfigured
      expect(screen.queryByRole('button', { name: /Connect Google Drive/i })).not.toBeInTheDocument();

      // Cloud upload button is not rendered when unconfigured
      expect(screen.queryByRole('button', { name: /Upload Video to Google Drive|Connect Google Drive to Upload/i })).not.toBeInTheDocument();

      // Ensure no developer client ID input or configure button is present in the UI
      expect(screen.queryByRole('button', { name: /Configure Client ID/i })).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/123456789-abcdef\.apps\.googleusercontent\.com/i)).not.toBeInTheDocument();
      expect(screen.getByText(/Google Drive direct cloud upload is disabled \(not configured for this system\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Direct cloud upload is disabled \(no Google OAuth client configured\)/i)).toBeInTheDocument();
    });
  });
});
