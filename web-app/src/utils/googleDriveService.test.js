import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractGoogleDriveFileId,
  formatGoogleDriveEmbedUrl,
  loadGsiScript,
  requestGoogleDriveToken,
  fetchGoogleUserInfo,
  uploadVideoToGoogleDrive,
  setGoogleDriveFilePublic,
  createGoogleDriveFolder,
  findOrCreateGoogleDriveFolder,
  resolveClassroomFolderHierarchy,
} from './googleDriveService';

describe('googleDriveService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete window.google;
  });

  describe('extractGoogleDriveFileId', () => {
    const validId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OIvE2up08';

    it('extracts ID from standard view URL', () => {
      expect(extractGoogleDriveFileId(`https://drive.google.com/file/d/${validId}/view?usp=sharing`)).toBe(validId);
    });

    it('extracts ID from preview URL', () => {
      expect(extractGoogleDriveFileId(`https://drive.google.com/file/d/${validId}/preview`)).toBe(validId);
    });

    it('extracts ID from open?id= URL', () => {
      expect(extractGoogleDriveFileId(`https://drive.google.com/open?id=${validId}`)).toBe(validId);
      expect(extractGoogleDriveFileId(`https://drive.google.com/open?foo=bar&id=${validId}`)).toBe(validId);
    });

    it('extracts ID from uc?id= URL', () => {
      expect(extractGoogleDriveFileId(`https://drive.google.com/uc?id=${validId}&export=download`)).toBe(validId);
    });

    it('accepts raw valid Drive file ID', () => {
      expect(extractGoogleDriveFileId(validId)).toBe(validId);
      expect(extractGoogleDriveFileId(`  ${validId}  `)).toBe(validId);
    });

    it('returns null for invalid inputs', () => {
      expect(extractGoogleDriveFileId('')).toBeNull();
      expect(extractGoogleDriveFileId(null)).toBeNull();
      expect(extractGoogleDriveFileId(undefined)).toBeNull();
      expect(extractGoogleDriveFileId('https://example.com/not-drive')).toBeNull();
      expect(extractGoogleDriveFileId('short_id_123')).toBeNull();
    });
  });

  describe('formatGoogleDriveEmbedUrl', () => {
    it('formats file ID into preview URL', () => {
      expect(formatGoogleDriveEmbedUrl('sample_id_12345')).toBe('https://drive.google.com/file/d/sample_id_12345/preview');
    });

    it('returns empty string if fileId is missing', () => {
      expect(formatGoogleDriveEmbedUrl('')).toBe('');
      expect(formatGoogleDriveEmbedUrl(null)).toBe('');
    });
  });

  describe('loadGsiScript', () => {
    it('resolves immediately if google accounts oauth2 is already defined', async () => {
      window.google = { accounts: { oauth2: {} } };
      await expect(loadGsiScript()).resolves.toBeUndefined();
    });

    it('creates script tag and resolves when loaded', async () => {
      const promise = loadGsiScript();
      const script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      expect(script).toBeTruthy();

      // Trigger load
      script.onload();
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe('requestGoogleDriveToken', () => {
    it('throws error if clientId is missing', async () => {
      await expect(requestGoogleDriveToken({ clientId: '' })).rejects.toThrow(/Google Client ID is required/i);
    });

    it('inits token client and requests token successfully', async () => {
      const mockRequestAccessToken = vi.fn();
      window.google = {
        accounts: {
          oauth2: {
            initTokenClient: vi.fn(({ callback }) => {
              // Simulate async success callback
              setTimeout(() => {
                callback({ access_token: 'fake_drive_token', expires_in: 3600, scope: 'drive.file' });
              }, 10);
              return { requestAccessToken: mockRequestAccessToken };
            }),
          },
        },
      };

      const result = await requestGoogleDriveToken({ clientId: 'test-client-id.apps.googleusercontent.com' });
      expect(result.access_token).toBe('fake_drive_token');
      expect(mockRequestAccessToken).toHaveBeenCalled();
    });

    it('rejects if OAuth callback returns an error', async () => {
      window.google = {
        accounts: {
          oauth2: {
            initTokenClient: vi.fn(({ callback }) => {
              setTimeout(() => {
                callback({ error: 'access_denied', error_description: 'User canceled sign-in' });
              }, 10);
              return { requestAccessToken: vi.fn() };
            }),
          },
        },
      };

      await expect(
        requestGoogleDriveToken({ clientId: 'test-client-id.apps.googleusercontent.com' })
      ).rejects.toThrow(/User canceled sign-in/i);
    });
  });

  describe('fetchGoogleUserInfo', () => {
    it('fetches user info with access token', async () => {
      const mockProfile = { email: 'teacher@gmail.com', name: 'Dr. Jane Teacher', picture: 'https://pic.jpg' };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockProfile,
      });

      const profile = await fetchGoogleUserInfo('fake_token');
      expect(profile).toEqual(mockProfile);
      expect(global.fetch).toHaveBeenCalledWith('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: 'Bearer fake_token' },
      });
    });

    it('throws error if fetch fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Unauthorized',
      });

      await expect(fetchGoogleUserInfo('bad_token')).rejects.toThrow(/Failed to fetch Google user profile/i);
    });
  });

  describe('uploadVideoToGoogleDrive', () => {
    it('initiates resumable session, uploads binary blob, and sets permissions', async () => {
      const mockLocation = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=session_123';
      
      // Mock fetch for init session and permissions
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ Location: mockLocation }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'perm_123' }),
        });

      class MockXMLHttpRequest {
        constructor() {
          MockXMLHttpRequest.instance = this;
          this.open = vi.fn();
          this.setRequestHeader = vi.fn();
          this.upload = { onprogress: null };
          this.send = vi.fn(() => {
            if (this.upload.onprogress) {
              this.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 });
            }
            this.status = 200;
            this.responseText = JSON.stringify({
              id: 'drive_file_abc',
              name: 'lecture_ai.webm',
              webViewLink: 'https://drive.google.com/file/d/drive_file_abc/view',
            });
            this.onload();
          });
        }
      }
      vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);

      const onProgress = vi.fn();
      const fakeBlob = new Blob(['test-video'], { type: 'video/webm' });

      const result = await uploadVideoToGoogleDrive({
        accessToken: 'valid_token',
        fileBlob: fakeBlob,
        fileName: 'lecture_ai.webm',
        description: 'Lecture recording for CS101',
        onProgress,
      });

      expect(result.fileId).toBe('drive_file_abc');
      expect(result.embedUrl).toBe('https://drive.google.com/file/d/drive_file_abc/preview');
      expect(result.webViewLink).toBe('https://drive.google.com/file/d/drive_file_abc/view');
      expect(onProgress).toHaveBeenCalledWith(50);
      expect(onProgress).toHaveBeenCalledWith(100);
      expect(MockXMLHttpRequest.instance.open).toHaveBeenCalledWith('PUT', mockLocation, true);
    });
  });

  describe('setGoogleDriveFilePublic', () => {
    it('sends POST request to permissions endpoint', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'perm_xyz', role: 'reader', type: 'anyone' }),
      });

      const res = await setGoogleDriveFilePublic('drive_123', 'tok_456');
      expect(res.id).toBe('perm_xyz');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://www.googleapis.com/drive/v3/files/drive_123/permissions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer tok_456' }),
        })
      );
    });
  });

  describe('createGoogleDriveFolder', () => {
    it('creates folder with mimeType application/vnd.google-apps.folder', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'folder_created_123', name: 'My Folder' }),
      });

      const res = await createGoogleDriveFolder({
        accessToken: 'tok_abc',
        folderName: 'My Folder',
        parentFolderId: 'parent_999',
      });

      expect(res.id).toBe('folder_created_123');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer tok_abc',
            'Content-Type': 'application/json; charset=UTF-8',
          }),
          body: JSON.stringify({
            name: 'My Folder',
            mimeType: 'application/vnd.google-apps.folder',
            parents: ['parent_999'],
          }),
        })
      );
    });
  });

  describe('findOrCreateGoogleDriveFolder', () => {
    it('returns existing folder id when found', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          files: [{ id: 'existing_folder_456', name: 'Existing Folder' }],
        }),
      });

      const res = await findOrCreateGoogleDriveFolder({
        accessToken: 'tok_abc',
        folderName: 'Existing Folder',
        parentFolderId: 'parent_111',
      });

      expect(res.id).toBe('existing_folder_456');
    });

    it('creates folder when not found in search', async () => {
      // First fetch: search returns empty list
      // Second fetch: create returns new folder
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ files: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'newly_created_folder_789', name: 'New Folder' }),
        });

      const res = await findOrCreateGoogleDriveFolder({
        accessToken: 'tok_abc',
        folderName: 'New Folder',
        parentFolderId: 'parent_111',
      });

      expect(res.id).toBe('newly_created_folder_789');
    });

    it('uses memory cache on consecutive calls with same parent and name', async () => {
      const cache = new Map();
      cache.set('root:Cached Folder', { id: 'cached_id_999', name: 'Cached Folder' });

      const res = await findOrCreateGoogleDriveFolder({
        accessToken: 'tok_abc',
        folderName: 'Cached Folder',
        parentFolderId: null,
        cache,
      });

      expect(res.id).toBe('cached_id_999');
    });
  });

  describe('resolveClassroomFolderHierarchy', () => {
    it('resolves lecture hierarchy: Base / Class / Lesson / Teacher Lectures', async () => {
      const cache = new Map();
      let folderCounter = 0;
      global.fetch = vi.fn().mockImplementation(async (url, options) => {
        if (options?.method === 'POST') {
          folderCounter++;
          const body = JSON.parse(options.body);
          return {
            ok: true,
            json: async () => ({ id: `folder_${folderCounter}_${body.name}`, name: body.name }),
          };
        }
        // search returns empty to trigger creation
        return {
          ok: true,
          json: async () => ({ files: [] }),
        };
      });

      const result = await resolveClassroomFolderHierarchy({
        accessToken: 'tok_abc',
        baseFolderName: 'Classroom Archives',
        className: 'IT114115-A',
        lessonName: 'Lesson 01 - React State',
        subfolderType: 'lectures',
        cache,
      });

      expect(result.folderId).toBe('folder_4_Teacher Lectures');
      expect(result.folderPath).toBe(
        'Classroom Archives/IT114115-A/Lesson 01 - React State/Teacher Lectures'
      );
    });

    it('resolves student hierarchy: Base / Class / Lesson / Students / studentEmail', async () => {
      const cache = new Map();
      let folderCounter = 0;
      global.fetch = vi.fn().mockImplementation(async (url, options) => {
        if (options?.method === 'POST') {
          folderCounter++;
          const body = JSON.parse(options.body);
          return {
            ok: true,
            json: async () => ({ id: `folder_${folderCounter}_${body.name}`, name: body.name }),
          };
        }
        return {
          ok: true,
          json: async () => ({ files: [] }),
        };
      });

      const result = await resolveClassroomFolderHierarchy({
        accessToken: 'tok_abc',
        baseFolderName: 'Classroom Archives',
        className: 'IT114115-B',
        lessonName: 'Week 2 Lab',
        subfolderType: 'students',
        studentEmail: '230123456@stu.vtc.edu.hk',
        cache,
      });

      expect(result.folderId).toBe('folder_5_230123456@stu.vtc.edu.hk');
      expect(result.folderPath).toBe(
        'Classroom Archives/IT114115-B/Week 2 Lab/Students/230123456@stu.vtc.edu.hk'
      );
    });

    it('resolves task hierarchy: Base / Class / Tasks / Task Title / Students / studentEmail', async () => {
      const cache = new Map();
      let folderCounter = 0;
      global.fetch = vi.fn().mockImplementation(async (url, options) => {
        if (options?.method === 'POST') {
          folderCounter++;
          const body = JSON.parse(options.body);
          return {
            ok: true,
            json: async () => ({ id: `folder_${folderCounter}_${body.name}`, name: body.name }),
          };
        }
        return {
          ok: true,
          json: async () => ({ files: [] }),
        };
      });

      const result = await resolveClassroomFolderHierarchy({
        accessToken: 'tok_abc',
        baseFolderName: 'Classroom Archives',
        className: 'IT114115-B',
        subfolderType: 'task',
        taskTitle: 'Task 1: Docker Containerization',
        studentEmail: '230123456@stu.vtc.edu.hk',
        cache,
      });

      expect(result.folderId).toBe('folder_6_230123456@stu.vtc.edu.hk');
      expect(result.folderPath).toBe(
        'Classroom Archives/IT114115-B/Tasks/Task 1 Docker Containerization/Students/230123456@stu.vtc.edu.hk'
      );
    });
  });
});
