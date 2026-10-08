import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import LectureRecordingsView, {
  extractYouTubeVideoId,
  formatFileSize,
} from './LectureRecordingsView';

let snapshotCallback;
let snapshotCallbacks = [];
const mockOnSnapshot = vi.fn((queryRef, cb) => {
  snapshotCallback = cb;
  snapshotCallbacks.push({ path: queryRef?.path, cb });
  return vi.fn(); // unsubscribe mock
});
const mockDeleteDoc = vi.fn().mockResolvedValue();
const mockUpdateDoc = vi.fn().mockResolvedValue();
const mockSetDoc = vi.fn().mockResolvedValue();

const mockServerTimestamp = vi.fn(() => ({ _seconds: 12345, _nanoseconds: 0 }));

vi.mock('../firebase-config', () => ({
  db: {},
  functions: {},
  storage: {},
}));

const mockUploadTask = {
  on: vi.fn((event, onProgress, onError, onComplete) => {
    if (onProgress) onProgress({ bytesTransferred: 50, totalBytes: 100 });
    if (onComplete) onComplete();
  }),
};
const mockUploadBytesResumable = vi.fn(() => mockUploadTask);
const mockGetDownloadURL = vi.fn().mockResolvedValue('https://storage.googleapis.com/recovered.webm');

vi.mock('firebase/storage', () => ({
  ref: vi.fn(() => ({})),
  uploadBytesResumable: (...args) => mockUploadBytesResumable(...args),
  getDownloadURL: (...args) => mockGetDownloadURL(...args),
}));

const mockGetPendingRecoverySessions = vi.fn().mockResolvedValue([]);
const mockClearRecoverySession = vi.fn().mockResolvedValue();
vi.mock('../utils/lectureRecoveryDb', () => ({
  getPendingRecoverySessions: () => mockGetPendingRecoverySessions(),
  clearRecoverySession: (...args) => mockClearRecoverySession(...args),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((db, ...pathSegments) => ({ path: pathSegments.join('/') })),
  doc: vi.fn((db, ...pathSegments) => ({ path: pathSegments.join('/') })),
  deleteDoc: (...args) => mockDeleteDoc(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
  setDoc: (...args) => mockSetDoc(...args),
  serverTimestamp: () => mockServerTimestamp(),
  query: vi.fn((collRef) => collRef),
  orderBy: vi.fn(),
  where: vi.fn(),
  onSnapshot: (...args) => mockOnSnapshot(...args),
}));

const mockHttpsCallable = vi.fn();
const mockHttpsCallableFactory = vi.fn(() => mockHttpsCallable);
vi.mock('firebase/functions', () => ({
  httpsCallable: (...args) => mockHttpsCallableFactory(...args),
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
    snapshotCallbacks = [];
    mockOnSnapshot.mockImplementation((queryRef, cb) => {
      snapshotCallback = cb;
      snapshotCallbacks.push({ path: queryRef?.path, cb });
      return vi.fn();
    });
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
          recordingSegmentsCount: 57,
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
    expect(screen.getByText(/57 segments/i)).toBeInTheDocument(); // Segment audit card badge
    expect(screen.getByText(/Recording Segments/i)).toBeInTheDocument(); // Detail banner pill
    expect(screen.getByText(/Ready \(Multi-CC\)/i)).toBeInTheDocument();
    expect(screen.getByText(/YouTube Studio & Publishing/i)).toBeInTheDocument();
    expect(screen.getByText('test_class - Introduction to React & State')).toBeInTheDocument();

    // Check HTML5 video and tracks
    const videoElement = document.querySelector('video');
    expect(videoElement).toBeInTheDocument();
    const tracks = videoElement.querySelectorAll('track');
    expect(tracks.length).toBe(3); // en, zh-Hant, ja

    // Subtitle language toolbar checks
    expect(screen.getByTestId('subtitle-language-toolbar')).toBeInTheDocument();
    const enBtn = screen.getByRole('button', { name: /🇬🇧 English/i });
    const zhBtn = screen.getByRole('button', { name: /🇭🇰 繁體中文/i });
    const jaBtn = screen.getByRole('button', { name: /🇯🇵 日本語/i });
    const offBtn = screen.getByRole('button', { name: /🚫 Off/i });

    expect(enBtn).toBeInTheDocument();
    expect(zhBtn).toBeInTheDocument();
    expect(jaBtn).toBeInTheDocument();
    expect(offBtn).toBeInTheDocument();

    // Default to English
    expect(enBtn).toHaveClass('active');

    // Select Traditional Chinese
    fireEvent.click(zhBtn);
    expect(zhBtn).toHaveClass('active');
    expect(enBtn).not.toHaveClass('active');

    // Select Off
    fireEvent.click(offBtn);
    expect(offBtn).toHaveClass('active');
    expect(zhBtn).not.toHaveClass('active');
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

    const startBtn = screen.getByRole('button', { name: /Start AI Generation/i });
    expect(startBtn).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(mockHttpsCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: 'test_class',
        sessionId: 'rec_retry',
        isManualTrigger: true,
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

  it('detects and clusters multiple clips with differing bcast_ IDs from the same date', async () => {
    mockHttpsCallable.mockResolvedValue({
      data: {
        success: true,
        combinedSessionId: 'rec_combined_abc',
        storagePath: 'recordings/test_class/rec_combined_abc/lecture.webm',
        title: 'Combined Full Lecture - 10/5/2026',
      },
    });

    render(
      <LectureRecordingsView
        classId="test_class"
        user={{ uid: 'teacher_1', email: 'teacher@test.com' }}
      />
    );

    const mockDocs = [
      {
        id: 'rec_clip_a',
        data: () => ({
          title: 'Lecture Clip A',
          sessionGroupId: 'bcast_1759000_abc',
          durationSeconds: 120,
          startedAt: new Date('2026-10-05T09:15:00'),
          status: 'ready',
          videoUrl: 'https://storage.googleapis.com/test/clipA.webm',
        }),
      },
      {
        id: 'rec_clip_b',
        data: () => ({
          title: 'Lecture Clip B',
          sessionGroupId: 'bcast_1759001_xyz',
          durationSeconds: 300,
          startedAt: new Date('2026-10-05T09:30:00'),
          status: 'ready',
          videoUrl: 'https://storage.googleapis.com/test/clipB.webm',
        }),
      },
    ];

    await act(async () => {
      snapshotCallback({ docs: mockDocs });
    });

    // Verify unmerged banner appears despite differing bcast_ sessionGroupIds
    await waitFor(() => {
      expect(screen.getByText(/2 separate recording clips detected/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Merge into Full Lecture/i })).toBeInTheDocument();
    });

    // Click Merge
    const mergeBtn = screen.getByRole('button', { name: /Merge into Full Lecture/i });
    await act(async () => {
      fireEvent.click(mergeBtn);
    });

    // Check that callable was invoked with recordingIds
    expect(mockHttpsCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: 'test_class',
        recordingIds: ['rec_clip_a', 'rec_clip_b'],
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
      const originalClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
      import.meta.env.VITE_GOOGLE_CLIENT_ID = '';
      try {
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
        expect(screen.queryByRole('button', { name: /^Connect Google Drive$/i })).not.toBeInTheDocument();

        // Cloud upload button is not rendered when unconfigured
        expect(screen.queryByRole('button', { name: /Upload Video to Google Drive|Connect Google Drive to Upload/i })).not.toBeInTheDocument();

        // Ensure no developer client ID input or configure button is present in the UI
        expect(screen.queryByRole('button', { name: /Configure Client ID/i })).not.toBeInTheDocument();
        expect(screen.queryByPlaceholderText(/123456789-abcdef\.apps\.googleusercontent\.com/i)).not.toBeInTheDocument();
        expect(screen.getByText(/Google Drive direct cloud upload is disabled \(not configured for this system\)/i)).toBeInTheDocument();
        expect(screen.getByText(/Direct cloud upload is disabled \(no Google OAuth client configured\)/i)).toBeInTheDocument();
      } finally {
        import.meta.env.VITE_GOOGLE_CLIENT_ID = originalClientId;
      }
    });

    it('allows deleting a recording with confirmation dialog and handles cancel', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm');
      render(<LectureRecordingsView classId="test_class" />);

      const mockDocs = [
        {
          id: 'rec_del_1',
          data: () => ({
            title: 'Delete Me Lecture',
            durationSeconds: 100,
            status: 'ready',
            videoUrl: 'https://storage.googleapis.com/test/lecture.webm',
          }),
        },
      ];

      await act(async () => {
        snapshotCallback({ docs: mockDocs });
      });

      const delBtns = screen.getAllByRole('button', { name: /Delete Recording/i });
      const delBtn = delBtns[0];

      // 1. Cancel deletion
      confirmSpy.mockReturnValueOnce(false);
      fireEvent.click(delBtn);
      expect(mockDeleteDoc).not.toHaveBeenCalled();

      // 2. Confirm deletion
      confirmSpy.mockReturnValueOnce(true);
      await act(async () => {
        fireEvent.click(delBtn);
      });

      expect(mockDeleteDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/test_class/lectureRecordings/rec_del_1' })
      );

      confirmSpy.mockRestore();
    });

    it('triggers manual subtitle retry when recording is in failed or non-ready status', async () => {
      render(<LectureRecordingsView classId="test_class" />);

      const mockDocs = [
        {
          id: 'rec_failed_sub',
          data: () => ({
            title: 'Failed Subtitles Lecture',
            topic: 'Debugging',
            durationSeconds: 150,
            status: 'failed',
            videoUrl: 'https://storage.googleapis.com/test/lecture.webm',
            storagePath: 'classes/test_class/recordings/rec_failed_sub.webm',
          }),
        },
      ];

      await act(async () => {
        snapshotCallback({ docs: mockDocs });
      });

      const retryBtn = screen.getByRole('button', { name: /Generate \/ Retry Subtitles/i });
      expect(retryBtn).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(retryBtn);
      });

      const startBtn = screen.getByRole('button', { name: /Start AI Generation/i });
      expect(startBtn).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(startBtn);
      });

      expect(mockHttpsCallable).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'test_class',
          sessionId: 'rec_failed_sub',
          title: 'Failed Subtitles Lecture',
          topic: 'Debugging',
          isManualTrigger: true,
        })
      );
    });

    it('handles unlinking YouTube and Google Drive links', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { container } = render(<LectureRecordingsView classId="test_class" />);

      const mockDocs = [
        {
          id: 'rec_linked_all',
          data: () => ({
            title: 'Fully Linked Lecture',
            durationSeconds: 200,
            status: 'ready',
            videoUrl: 'https://storage.googleapis.com/test/lecture.webm',
            youtubeUrl: 'https://www.youtube.com/watch?v=abc123xyz',
            youtubeVideoId: 'abc123xyz',
            driveFileId: 'drive_file_id_123',
            driveEmbedUrl: 'https://drive.google.com/file/d/drive_file_id_123/preview',
          }),
        },
      ];

      await act(async () => {
        snapshotCallback({ docs: mockDocs });
      });

      // Unlink YouTube
      const unlinkYtBtn = container.querySelector('.btn-unlink-youtube');
      expect(unlinkYtBtn).toBeTruthy();
      await act(async () => {
        fireEvent.click(unlinkYtBtn);
      });

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/test_class/lectureRecordings/rec_linked_all' }),
        expect.objectContaining({
          youtubeUrl: null,
          youtubeVideoId: null,
        })
      );

      // Unlink Google Drive
      const unlinkDriveBtn = container.querySelector('.btn-unlink-drive');
      expect(unlinkDriveBtn).toBeTruthy();
      await act(async () => {
        fireEvent.click(unlinkDriveBtn);
      });

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/test_class/lectureRecordings/rec_linked_all' }),
        expect.objectContaining({
          driveFileId: null,
          driveEmbedUrl: null,
        })
      );
      confirmSpy.mockRestore();
    });

    it('displays shared and private badges, toggles student sharing, and warns when class sharing is disabled', async () => {
      const mockDocs = [
        {
          id: 'rec_private',
          data: () => ({
            title: 'Private Lecture Session',
            durationSeconds: 300,
            status: 'ready',
            isSharedWithStudents: false,
          }),
        },
        {
          id: 'rec_shared',
          data: () => ({
            title: 'Shared Lecture Session',
            durationSeconds: 400,
            status: 'ready',
            isSharedWithStudents: true,
          }),
        },
      ];

      render(<LectureRecordingsView classId="test_class" />);

      const recCb = snapshotCallbacks.find((s) => s.path?.includes('lectureRecordings'))?.cb || snapshotCallback;
      const classDocCb = snapshotCallbacks.find((s) => s.path === 'classes/test_class')?.cb;

      await act(async () => {
        recCb({ docs: mockDocs });
        if (classDocCb) {
          classDocCb({
            exists: () => true,
            data: () => ({ allowShareTeacherRecordings: false }),
          });
        }
      });

      // Verify badges in the recording list
      expect(screen.getByText('🔒 Private')).toBeInTheDocument();
      expect(screen.getByText('👥 Shared')).toBeInTheDocument();

      // Warning banner is displayed when class sharing is disabled
      expect(screen.getByText(/Class Sharing Disabled/i)).toBeInTheDocument();

      // Verify 1-click class-level student sharing toggle button
      const enableClassBtn = screen.getByRole('button', { name: /Enable Student Access for Class/i });
      expect(enableClassBtn).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(enableClassBtn);
      });

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/test_class' }),
        expect.objectContaining({
          allowShareTeacherRecordings: true,
        })
      );
    });

    it('supports 3 policy modes (always_shared, selective, private) and controls in the studio', async () => {
      const mockDocs = [
        {
          id: 'rec_auto_1',
          data: () => ({
            title: 'Auto Shared Lecture',
            status: 'completed',
            videoUrl: 'https://storage.googleapis.com/test/auto.webm',
            isSharedWithStudents: false,
            durationSeconds: 900,
          }),
        },
      ];

      render(
        <LectureRecordingsView
          classId="test_class"
          user={{ uid: 'teacher_1', email: 'teacher@school.edu' }}
        />
      );

      const recCb = snapshotCallbacks.find((s) => s.path?.includes('lectureRecordings'))?.cb || snapshotCallback;
      const classDocCb = snapshotCallbacks.find((s) => s.path === 'classes/test_class')?.cb;

      // 1. Test always_shared policy
      await act(async () => {
        recCb({ docs: mockDocs });
        if (classDocCb) {
          classDocCb({
            exists: () => true,
            data: () => ({ teacherRecordingsPolicy: 'always_shared', allowShareTeacherRecordings: true }),
          });
        }
      });

      expect(screen.getByText(/Class Student Access: Always Shared \(Automatic\)/i)).toBeInTheDocument();
      // Even though isSharedWithStudents is false, badge shows Shared because policy is always_shared
      expect(screen.getByText('👥 Shared')).toBeInTheDocument();

      // Recording is auto-selected into detail panel
      expect(screen.getAllByText('Auto Shared Lecture').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Automatically shared with enrolled students \(Class Policy: Always Share\)/i)).toBeInTheDocument();

      // Click Switch to Selective
      const switchToSelectiveBtn = screen.getByRole('button', { name: /Switch to Selective/i });
      await act(async () => {
        fireEvent.click(switchToSelectiveBtn);
      });

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/test_class' }),
        expect.objectContaining({
          teacherRecordingsPolicy: 'selective',
          allowShareTeacherRecordings: true,
        })
      );
    });

    it('filters recordings by lesson using the lesson dropdown filter', async () => {
      const mockLessons = [
        {
          id: 'lesson_1',
          lessonId: 'lesson_1',
          title: 'Lesson 1: Intro',
          startTime: '2026-10-02T08:00:00Z',
          endTime: '2026-10-02T09:00:00Z',
          duration: 60,
        },
        {
          id: 'lesson_2',
          lessonId: 'lesson_2',
          title: 'Lesson 2: Advanced',
          startTime: '2026-10-09T08:00:00Z',
          endTime: '2026-10-09T09:00:00Z',
          duration: 60,
        },
      ];

      const mockDocs = [
        {
          id: 'rec_l1',
          data: () => ({
            title: 'Recording for Lesson 1',
            startedAt: '2026-10-02T08:15:00Z',
            lessonId: 'lesson_1',
            isSharedWithStudents: true,
          }),
        },
        {
          id: 'rec_l2',
          data: () => ({
            title: 'Recording for Lesson 2',
            startedAt: '2026-10-09T08:15:00Z',
            lessonId: 'lesson_2',
            isSharedWithStudents: false,
          }),
        },
      ];

      render(<LectureRecordingsView classId="test_class" lessons={mockLessons} />);

      const recCb = snapshotCallbacks.find((s) => s.path?.includes('lectureRecordings'))?.cb || snapshotCallback;
      await act(async () => {
        recCb({ docs: mockDocs });
      });

      // Initially all lessons shown
      expect(screen.getAllByText('Recording for Lesson 1').length).toBeGreaterThan(0);
      expect(screen.getByText('Recording for Lesson 2')).toBeInTheDocument();

      // Filter by Lesson 1
      const filterSelect = screen.getByLabelText(/Filter recordings by lesson:/i);
      await act(async () => {
        fireEvent.change(filterSelect, { target: { value: 'lesson_1' } });
      });

      expect(screen.getAllByText('Recording for Lesson 1').length).toBeGreaterThan(0);
      expect(screen.queryByText('Recording for Lesson 2')).not.toBeInTheDocument();
    });

    it('automatically promotes class policy to selective when sharing an individual recording on a private class', async () => {
      const mockDocs = [
        {
          id: 'rec_target_to_share',
          data: () => ({
            title: 'Operating Systems Virtual Memory',
            status: 'ready',
            videoUrl: 'https://storage.googleapis.com/test/os.webm',
            isSharedWithStudents: false,
            durationSeconds: 1200,
          }),
        },
      ];

      render(<LectureRecordingsView classId="it3901-l" />);

      const recCb = snapshotCallbacks.find((s) => s.path?.includes('lectureRecordings'))?.cb || snapshotCallback;
      const classDocCb = snapshotCallbacks.find((s) => s.path === 'classes/it3901-l')?.cb;

      await act(async () => {
        recCb({ docs: mockDocs });
        if (classDocCb) {
          classDocCb({
            exists: () => true,
            data: () => ({ teacherRecordingsPolicy: 'private', allowShareTeacherRecordings: false }),
          });
        }
      });

      // Target recording should be selected into detail panel
      expect(screen.getAllByText('Operating Systems Virtual Memory').length).toBeGreaterThanOrEqual(1);

      const shareBtn = screen.getByRole('button', { name: /Share with Students/i });
      expect(shareBtn).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(shareBtn);
      });

      // Verify the recording document was marked as shared
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/it3901-l/lectureRecordings/rec_target_to_share' }),
        expect.objectContaining({
          isSharedWithStudents: true,
        })
      );

      // Verify the class document was automatically promoted to selective sharing
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/it3901-l' }),
        expect.objectContaining({
          teacherRecordingsPolicy: 'selective',
          allowShareTeacherRecordings: true,
        })
      );
    });

    it('defaults to Cloud Storage HTML5 Player when CC subtitles exist even if Drive is linked, and shows Drive no-CC banner if switched to Drive', async () => {
      let snapshotCallback;
      mockOnSnapshot.mockImplementation((query, callback) => {
        snapshotCallback = callback;
        return vi.fn();
      });

      render(<LectureRecordingsView classId="test_class" />);

      const mockDocs = [
        {
          id: 'rec_drive_and_cc',
          data: () => ({
            title: 'DevOps Cloud Lecture',
            durationSeconds: 1500,
            status: 'ready',
            videoUrl: 'https://storage.googleapis.com/test/devops.webm',
            driveFileId: 'drive_file_abc123',
            vttUrls: {
              en: 'https://storage.googleapis.com/test/devops_en.vtt',
              'zh-Hant': 'https://storage.googleapis.com/test/devops_zh.vtt',
            },
          }),
        },
      ];

      await act(async () => {
        snapshotCallback({ docs: mockDocs });
      });

      // HTML5 video player should be active by default (not Drive iframe)
      expect(document.querySelector('video')).toBeInTheDocument();
      expect(screen.getByTestId('subtitle-language-toolbar')).toBeInTheDocument();

      // Switch to Drive stream tab
      const driveTab = screen.getByRole('button', { name: /Google Drive Stream \(⚠️ No CC\)/i });
      fireEvent.click(driveTab);

      // In Drive mode, the warning banner is shown
      expect(screen.getByTestId('drive-no-cc-banner')).toBeInTheDocument();
      expect(screen.getByText(/Google Drive Preview does not support external CC subtitles/i)).toBeInTheDocument();

      // Click language button from Drive banner to switch back to Cloud player with Traditional Chinese
      const switchZhBtn = screen.getByRole('button', { name: /🇭🇰 繁體中文 \(Cloud Player\)/i });
      fireEvent.click(switchZhBtn);

      expect(document.querySelector('video')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /🇭🇰 繁體中文/i })).toHaveClass('active');
    });

    it('opens regeneration modal and allows teacher to pick model, target languages, and custom prompt', async () => {
      render(<LectureRecordingsView classId="test_class" user={{ uid: 'teacher_1' }} />);

      const mockDocs = [
        {
          id: 'rec_regen_test',
          data: () => ({
            title: 'Full Stack Development',
            durationSeconds: 3600,
            status: 'ready',
            storagePath: 'recordings/test_class/rec_regen_test/lecture.webm',
            videoUrl: 'https://storage.googleapis.com/test/fullstack.webm',
            targetLanguages: ['en', 'zh-Hant'],
            aiModelUsed: 'gemini-3.8-flash',
          }),
        },
      ];

      await act(async () => {
        snapshotCallback({ docs: mockDocs });
      });

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /Re-generate Subtitles & CC/i })[0]).toBeInTheDocument();
      });

      // Click Re-generate Subtitles button
      const regenBtn = screen.getAllByRole('button', { name: /Re-generate Subtitles & CC/i })[0];
      await act(async () => {
        fireEvent.click(regenBtn);
      });

      // Modal is visible
      expect(screen.getByText(/Re-generate Multilingual Subtitles & CC/i)).toBeInTheDocument();
      expect(screen.getByText(/Select Gemini AI Model/i)).toBeInTheDocument();
      expect(screen.getByText(/Target Subtitle & CC Languages/i)).toBeInTheDocument();

      // Switch model to Gemini 3.5 Flash-Lite
      const gemini35Radio = screen.getByRole('radio', { name: /Gemini 3.5 Flash-Lite/i });
      fireEvent.click(gemini35Radio);
      expect(gemini35Radio).toBeChecked();

      // Enter custom prompt in the textarea
      const promptTextarea = screen.getByPlaceholderText(/Select a lecture recording prompt|Select a translation prompt/i);
      fireEvent.change(promptTextarea, {
        target: { value: 'Translate Computer Science and Vue.js terms carefully with Cantonese slang.' },
      });

      // Start generation
      const startBtn = screen.getByRole('button', { name: /Start AI Generation/i });
      await act(async () => {
        fireEvent.click(startBtn);
      });

      expect(mockHttpsCallable).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'test_class',
          sessionId: 'rec_regen_test',
          isManualTrigger: true,
          preferredModel: 'gemini-3.5-flash-lite',
          customPrompt: 'Translate Computer Science and Vue.js terms carefully with Cantonese slang.',
          targetLanguages: expect.arrayContaining(['en', 'zh-Hant']),
        })
      );
    });

    it('handles deadline-exceeded gracefully without popping an alert when subtitle generation takes long', async () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      const deadlineError = new Error('deadline-exceeded');
      deadlineError.code = 'functions/deadline-exceeded';
      mockHttpsCallable.mockRejectedValueOnce(deadlineError);

      render(<LectureRecordingsView classId="test_class" user={{ uid: 'teacher_1' }} />);

      const mockDocs = [
        {
          id: 'rec_timeout_test',
          data: () => ({
            title: 'Long 50min Lecture',
            durationSeconds: 3400,
            status: 'ready',
            storagePath: 'recordings/test_class/rec_timeout_test/lecture.webm',
            videoUrl: 'https://storage.googleapis.com/test/long.webm',
            targetLanguages: ['en'],
          }),
        },
      ];

      await act(async () => {
        snapshotCallback({ docs: mockDocs });
      });

      const regenBtn = screen.getAllByRole('button', { name: /Re-generate Subtitles & CC/i })[0];
      await act(async () => {
        fireEvent.click(regenBtn);
      });

      const startBtn = screen.getByRole('button', { name: /Start AI Generation/i });
      await act(async () => {
        fireEvent.click(startBtn);
      });

      expect(mockHttpsCallableFactory).toHaveBeenCalledWith(
        expect.anything(),
        'processLectureSubtitles',
        expect.objectContaining({ timeout: 600000 })
      );
      expect(alertSpy).not.toHaveBeenCalled();
      alertSpy.mockRestore();
    });

    it('renders CC Skipped status badge when subtitlesDisabled is true and no vttUrls exist', async () => {
      render(<LectureRecordingsView classId="test_class" />);

      const mockDocs = [
        {
          id: 'rec_skipped_subs',
          data: () => ({
            title: 'Lecture with Subtitles Disabled',
            durationSeconds: 1800,
            status: 'ready',
            subtitlesDisabled: true,
            vttUrls: {},
            videoUrl: 'https://storage.googleapis.com/test/lecture_no_cc.webm',
          }),
        },
      ];

      await act(async () => {
        snapshotCallback({ docs: mockDocs });
      });

      await waitFor(() => {
        expect(screen.getByText(/Video Ready \(CC Skipped\)/i)).toBeInTheDocument();
      });
    });

    it('enables Custom Merge selection mode, allows selecting clips via checkboxes, and triggers merge with selected clips', async () => {
      mockHttpsCallable.mockResolvedValue({
        data: {
          success: true,
          combinedSessionId: 'rec_custom_merged',
          storagePath: 'recordings/test_class/rec_custom_merged/lecture.webm',
          title: 'Custom Merged Lecture',
        },
      });

      render(<LectureRecordingsView classId="test_class" />);

      const mockDocs = [
        {
          id: 'rec_clip_1',
          data: () => ({
            title: 'Python Part 1',
            startedAt: { seconds: 1791167878, nanoseconds: 0 },
            durationSeconds: 273,
            storagePath: 'recordings/test_class/rec_clip_1/lecture.webm',
            status: 'ready',
          }),
        },
        {
          id: 'rec_clip_2',
          data: () => ({
            title: 'Python Part 2',
            startedAt: { seconds: 1791169996, nanoseconds: 0 },
            durationSeconds: 627,
            storagePath: 'recordings/test_class/rec_clip_2/lecture.webm',
            status: 'ready',
          }),
        },
        {
          id: 'rec_already_combined',
          data: () => ({
            title: 'Full Combined Lecture',
            startedAt: { seconds: 1789957831, nanoseconds: 0 },
            durationSeconds: 3183,
            isCombined: true,
            storagePath: 'recordings/test_class/rec_already_combined/lecture.webm',
            status: 'ready',
          }),
        },
        {
          id: 'rec_in_progress',
          data: () => ({
            title: 'Recording In Progress',
            startedAt: { seconds: 1789958000, nanoseconds: 0 },
            durationSeconds: 10,
            status: 'recording',
          }),
        },
      ];

      await act(async () => {
        snapshotCallback({ docs: mockDocs });
      });

      // 1. Click Custom Merge to enter selection mode
      const toggleMergeBtn = screen.getByRole('button', { name: /Custom Merge/i });
      await act(async () => {
        fireEvent.click(toggleMergeBtn);
      });

      expect(screen.getByText(/Cancel Selection/i)).toBeInTheDocument();
      expect(screen.getByText(/Selected:/i).textContent).toContain('Selected: 0 clips');

      // 1b. Verify clicking checkbox directly selects and unselects clips
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBe(4);
      expect(checkboxes[0]).not.toBeChecked();
      expect(checkboxes[2]).not.toBeDisabled(); // previously combined recordings CAN now be merged in Custom Merge
      expect(checkboxes[3]).toBeDisabled(); // actively recording clip is non-mergeable

      // Click directly on the checkbox of clip 1
      await act(async () => {
        fireEvent.click(checkboxes[0]);
      });
      expect(checkboxes[0]).toBeChecked();
      expect(screen.getByText(/Selected:/i).textContent).toContain('Selected: 1 clip');

      // Click directly on the checkbox of clip 1 again to deselect
      await act(async () => {
        fireEvent.click(checkboxes[0]);
      });
      expect(checkboxes[0]).not.toBeChecked();
      expect(screen.getByText(/Selected:/i).textContent).toContain('Selected: 0 clips');

      // Click on card body (e.g. card container) to select
      const clipCard0 = document.querySelectorAll('.recording-card')[0];
      await act(async () => {
        fireEvent.click(clipCard0);
      });
      expect(checkboxes[0]).toBeChecked();
      expect(screen.getByText(/Selected:/i).textContent).toContain('Selected: 1 clip');

      // Click directly on checkbox to deselect clip that was selected via card
      await act(async () => {
        fireEvent.click(checkboxes[0]);
      });
      expect(checkboxes[0]).not.toBeChecked();
      expect(screen.getByText(/Selected:/i).textContent).toContain('Selected: 0 clips');

      // Keyboard Space/Enter on card to toggle selection
      const clipCard1 = document.querySelectorAll('.recording-card')[1];
      await act(async () => {
        fireEvent.keyDown(clipCard1, { key: ' ' });
      });
      expect(checkboxes[1]).toBeChecked();
      expect(screen.getByText(/Selected:/i).textContent).toContain('Selected: 1 clip');

      await act(async () => {
        fireEvent.keyDown(clipCard1, { key: 'Enter' });
      });
      expect(checkboxes[1]).not.toBeChecked();
      expect(screen.getByText(/Selected:/i).textContent).toContain('Selected: 0 clips');

      // 2. Select All Mergeable toggle
      const selectAllBtn = screen.getByRole('button', { name: /Select All Mergeable/i });
      await act(async () => {
        fireEvent.click(selectAllBtn);
      });

      // All 3 mergeable completed recordings should be selected (rec_clip_1, rec_clip_2, rec_already_combined)
      expect(screen.getByText(/Selected:/i).textContent).toContain('Selected: 3 clips');

      // 3. Click Merge Selected (3)
      const mergeActionBtn = screen.getByRole('button', { name: /Merge Selected \(3\)/i });
      expect(mergeActionBtn).not.toBeDisabled();

      await act(async () => {
        fireEvent.click(mergeActionBtn);
      });

      expect(mockHttpsCallable).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'test_class',
          recordingIds: expect.arrayContaining(['rec_clip_1', 'rec_clip_2', 'rec_already_combined']),
        })
      );
    });

    it('filters recordings by lesson and displays accurate lesson counts in the dropdown', async () => {
      const lessons = [
        {
          id: '2026-10-05T02:30:00.000Z',
          start: new Date('2026-10-05T02:30:00.000Z'),
          end: new Date('2026-10-05T03:30:00.000Z'),
          title: 'Lesson 03 (10/5/2026)',
        },
        {
          id: '2026-09-28T02:30:00.000Z',
          start: new Date('2026-09-28T02:30:00.000Z'),
          end: new Date('2026-09-28T03:30:00.000Z'),
          title: 'Lesson 02 (9/28/2026)',
        },
      ];

      render(<LectureRecordingsView classId="test_class" lessons={lessons} selectedLesson="all" />);

      const mockDocs = [
        {
          id: 'rec_1005_1',
          data: () => ({
            title: 'Oct 5 Clip 1',
            startedAt: { seconds: 1791167878, nanoseconds: 0 },
            durationSeconds: 273,
            classId: 'test_class',
          }),
        },
        {
          id: 'rec_1005_2',
          data: () => ({
            title: 'Oct 5 Clip 2',
            startedAt: { seconds: 1791169996, nanoseconds: 0 },
            durationSeconds: 627,
            classId: 'test_class',
          }),
        },
        {
          id: 'rec_0928_1',
          data: () => ({
            title: 'Sep 28 Full',
            startedAt: { seconds: 1790563137, nanoseconds: 0 },
            durationSeconds: 2079,
            classId: 'test_class',
          }),
        },
      ];

      await act(async () => {
        snapshotCallback({ docs: mockDocs });
      });

      // Filter select element exists
      const filterSelect = screen.getByLabelText(/Filter recordings by lesson:/i);
      expect(filterSelect).toBeInTheDocument();

      // Verify dropdown shows non-zero counts for lessons that have matching recordings
      expect(screen.getByText(/🌐 All Lessons \(3\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Lesson 03 \(10\/5\/2026\) \(2\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Lesson 02 \(9\/28\/2026\) \(1\)/i)).toBeInTheDocument();

      // Switch to Lesson 03
      await act(async () => {
        fireEvent.change(filterSelect, { target: { value: '2026-10-05T02:30:00.000Z' } });
      });

      // Header updates to show 2 of 3
      expect(screen.getByText(/Past Lectures \(2 of 3\)/i)).toBeInTheDocument();
      expect(screen.getAllByText('Oct 5 Clip 1').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Oct 5 Clip 2').length).toBeGreaterThan(0);
      expect(screen.queryByText('Sep 28 Full')).not.toBeInTheDocument();
    });
  });

  it('handles deleting a lecture recording with confirmation', async () => {
    window.confirm = vi.fn().mockReturnValue(false);

    render(<LectureRecordingsView classId="test_class" />);

    const mockDocs = [
      {
        id: 'rec_to_del',
        data: () => ({
          title: 'Lecture to Delete',
          startedAt: { seconds: 1791167878, nanoseconds: 0 },
          durationSeconds: 120,
          videoUrl: 'https://storage.googleapis.com/test.webm',
        }),
      },
    ];

    await act(async () => {
      snapshotCallback({ docs: mockDocs });
    });

    const deleteBtn = screen.getAllByRole('button', { name: /🗑️ Delete Recording/i })[0];
    expect(deleteBtn).toBeInTheDocument();

    // Cancel deletion
    fireEvent.click(deleteBtn);
    expect(mockDeleteDoc).not.toHaveBeenCalled();

    // Confirm deletion
    window.confirm = vi.fn().mockReturnValue(true);
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    expect(mockDeleteDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/test_class/lectureRecordings/rec_to_del' })
    );
  });

  it('handles direct video download and fallback window open', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['mock-video-binary'], { type: 'video/webm' })),
    });

    render(<LectureRecordingsView classId="test_class" />);

    const mockDocs = [
      {
        id: 'rec_download_test',
        data: () => ({
          title: 'Downloadable Lecture',
          startedAt: { seconds: 1791167878, nanoseconds: 0 },
          durationSeconds: 200,
          videoUrl: 'https://storage.googleapis.com/lecture.webm',
          mimeType: 'video/webm',
        }),
      },
    ];

    await act(async () => {
      snapshotCallback({ docs: mockDocs });
    });

    const downloadBtn = screen.getByRole('button', { name: /Direct Video Download/i });
    expect(downloadBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(downloadBtn);
    });

    expect(global.fetch).toHaveBeenCalledWith('https://storage.googleapis.com/lecture.webm');
    expect(await screen.findByText(/Video downloaded!/i)).toBeInTheDocument();

    // Test fallback when fetch fails
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    window.open = vi.fn();

    await act(async () => {
      fireEvent.click(downloadBtn);
    });

    expect(window.open).toHaveBeenCalledWith('https://storage.googleapis.com/lecture.webm', '_blank');
  });

  it('handles merging clips with ffmpeg and auto-triggering subtitles', async () => {
    const mockCallableDispatch = vi.fn((params) => {
      if (params.recordingIds) {
        return Promise.resolve({
          data: {
            success: true,
            combinedSessionId: 'rec_merged_123',
            storagePath: 'classes/test_class/lectures/rec_merged_123.mp4',
            title: 'Merged Full Lecture',
            targetLanguages: ['en', 'zh-HK'],
          },
        });
      }
      return Promise.resolve({ data: { success: true } });
    });
    mockHttpsCallableFactory.mockReturnValue(mockCallableDispatch);

    render(<LectureRecordingsView classId="test_class" />);

    const mockDocs = [
      {
        id: 'clip_1',
        data: () => ({
          title: 'Part 1',
          sessionGroupId: 'grp_001',
          startedAt: { seconds: 1791167000, nanoseconds: 0 },
          durationSeconds: 300,
          videoUrl: 'https://storage.googleapis.com/clip1.webm',
        }),
      },
      {
        id: 'clip_2',
        data: () => ({
          title: 'Part 2',
          sessionGroupId: 'grp_001',
          startedAt: { seconds: 1791167400, nanoseconds: 0 },
          durationSeconds: 400,
          videoUrl: 'https://storage.googleapis.com/clip2.webm',
        }),
      },
    ];

    await act(async () => {
      snapshotCallback({ docs: mockDocs });
    });

    const mergeBtn = screen.getByRole('button', { name: /Merge into Full Lecture/i });
    expect(mergeBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(mergeBtn);
    });

    expect(mockCallableDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: 'test_class',
        sessionGroupId: 'grp_001',
        recordingIds: ['clip_1', 'clip_2'],
      })
    );
  });

  it('detects local crash recovery chunks in IndexedDB and allows one-click restore', async () => {
    mockGetPendingRecoverySessions.mockResolvedValue([
      {
        sessionId: 'rec_interrupted_1',
        classId: 'test_class',
        mimeType: 'video/webm',
        title: 'Interrupted Today Class',
        chunks: [new Blob(['chunk1'], { type: 'video/webm' }), new Blob(['chunk2'], { type: 'video/webm' })],
      },
    ]);

    render(<LectureRecordingsView classId="test_class" />);

    const mockDocs = [
      {
        id: 'rec_interrupted_1',
        data: () => ({
          title: 'Interrupted Today Class',
          status: 'interrupted',
          startedAt: { seconds: 1791334826, nanoseconds: 0 },
          interruptedReason: 'No media files found in Cloud Storage.',
        }),
      },
    ];

    await act(async () => {
      snapshotCallback({ docs: mockDocs });
    });

    expect(await screen.findByText(/Local Crash Recovery Chunks Found in This Browser!/i)).toBeInTheDocument();
    expect(screen.getByText(/video chunks/i)).toBeInTheDocument();

    const recoverBtn = screen.getByRole('button', { name: /Upload & Restore from This Browser/i });
    expect(recoverBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(recoverBtn);
    });

    expect(mockUploadBytesResumable).toHaveBeenCalled();
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/test_class/lectureRecordings/rec_interrupted_1' }),
      expect.objectContaining({
        status: 'ready',
        isRecoveredAfterCrash: true,
        videoUrl: 'https://storage.googleapis.com/recovered.webm',
      }),
      { merge: true }
    );
    expect(mockClearRecoverySession).toHaveBeenCalledWith('rec_interrupted_1');
  });

  it('shows clear recovery instructions and manual upload option when no local chunks exist', async () => {
    mockGetPendingRecoverySessions.mockResolvedValue([]);

    render(<LectureRecordingsView classId="test_class" />);

    const mockDocs = [
      {
        id: 'rec_other_device',
        data: () => ({
          title: 'Remote Device Lecture',
          status: 'interrupted',
          teacherEmail: 'teacher@school.edu',
          startedAt: { seconds: 1791334826, nanoseconds: 0 },
          interruptedReason: 'No media files found in Cloud Storage. The browser may have closed or crashed before upload completed.',
        }),
      },
    ];

    await act(async () => {
      snapshotCallback({ docs: mockDocs });
    });

    expect(await screen.findByText(/Recording Session Interrupted/i)).toBeInTheDocument();
    expect(screen.getByText(/Diagnosis:/i)).toBeInTheDocument();
    expect(screen.getByText(/How to Recover This Lecture:/i)).toBeInTheDocument();
    expect(screen.getByText(/Upload Video File Manually/i)).toBeInTheDocument();
  });
});



