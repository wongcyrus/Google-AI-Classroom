import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractGoogleDriveFileId,
  formatGoogleDriveEmbedUrl,
  loadGsiScript,
  requestGoogleDriveToken,
  fetchGoogleUserInfo,
  uploadVideoToGoogleDrive,
  setGoogleDriveFilePublic,
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
});
