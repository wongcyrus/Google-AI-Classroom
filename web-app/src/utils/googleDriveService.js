/**
 * Google Drive API Service Utility
 * 
 * Handles Google Identity Services (GIS) token authorization,
 * Google Drive REST API v3 resumable uploads, public permission grants,
 * and preview embed link generation.
 */

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GSI_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

/**
 * Extracts a Google Drive File ID from full URLs or raw IDs.
 * Supports:
 * - https://drive.google.com/file/d/FILE_ID/view...
 * - https://drive.google.com/file/d/FILE_ID/preview
 * - https://drive.google.com/open?id=FILE_ID
 * - https://drive.google.com/uc?id=FILE_ID
 * - Raw alphanumeric IDs (min 20 chars)
 * 
 * @param {string} input 
 * @returns {string|null}
 */
export function extractGoogleDriveFileId(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Pattern 1: /file/d/{ID}
  const fileDMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
  if (fileDMatch) return fileDMatch[1];

  // Pattern 2: id={ID} query parameter
  const idQueryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (idQueryMatch) return idQueryMatch[1];

  // Pattern 3: Raw File ID (Google Drive IDs are base64url-like strings >= 20 characters)
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * Formats a Google Drive file ID into an embeddable preview stream URL.
 * @param {string} fileId 
 * @returns {string}
 */
export function formatGoogleDriveEmbedUrl(fileId) {
  if (!fileId) return '';
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

/**
 * Dynamically loads Google Identity Services (GIS) library if not already loaded.
 * @returns {Promise<void>}
 */
export function loadGsiScript() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      return reject(new Error('Cannot load GSI script in non-browser environment'));
    }

    if (window.google?.accounts?.oauth2) {
      return resolve();
    }

    const existingScript = document.querySelector(`script[src="${GSI_SCRIPT_URL}"]`);
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve());
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services')));
      return;
    }

    const script = document.createElement('script');
    script.src = GSI_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services from CDN'));
    document.head.appendChild(script);
  });
}

/**
 * Requests an OAuth 2.0 access token using Google Identity Services (GIS) Token Client.
 * Uses scope https://www.googleapis.com/auth/drive.file (Sensitive scope, least-privilege).
 * 
 * @param {Object} options
 * @param {string} options.clientId - Google OAuth 2.0 Client ID
 * @param {string} [options.prompt='consent'] - Consent prompt mode
 * @returns {Promise<{ access_token: string, expires_in: number, token_type: string, scope: string }>}
 */
export async function requestGoogleDriveToken({ clientId, prompt = 'consent' }) {
  if (!clientId) {
    throw new Error('Google Client ID is required to connect Google Drive.');
  }

  await loadGsiScript();

  return new Promise((resolve, reject) => {
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_FILE_SCOPE,
        prompt,
        callback: (response) => {
          if (response.error) {
            reject(new Error(response.error_description || response.error || 'OAuth authorization failed'));
          } else {
            resolve(response);
          }
        },
        error_callback: (err) => {
          reject(new Error(err?.message || 'OAuth popup closed or blocked'));
        },
      });

      client.requestAccessToken();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Fetches user profile information for the authenticated access token.
 * @param {string} accessToken 
 * @returns {Promise<{ email: string, name: string, picture: string }>}
 */
export async function fetchGoogleUserInfo(accessToken) {
  if (!accessToken) throw new Error('Access token is required');
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Google user profile: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Uploads a video file or blob to Google Drive via API v3 Resumable Upload.
 * Also configures public viewing permission (anyone with link can view).
 * 
 * @param {Object} params
 * @param {string} params.accessToken - OAuth 2.0 access token
 * @param {Blob|File} params.fileBlob - Video file or Blob
 * @param {string} params.fileName - Name of the file in Google Drive
 * @param {string} [params.description] - Description of file
 * @param {string} [params.folderId] - Optional Google Drive folder ID to place file into
 * @param {function} [params.onProgress] - Callback receiving upload percentage (0 - 100)
 * @returns {Promise<{ fileId: string, webViewLink: string, embedUrl: string, name: string }>}
 */
export async function uploadVideoToGoogleDrive({
  accessToken,
  fileBlob,
  fileName,
  description = 'Classroom lecture recording',
  folderId = null,
  onProgress = () => {},
}) {
  if (!accessToken) throw new Error('Access token is required for Google Drive upload');
  if (!fileBlob) throw new Error('No video blob provided for Google Drive upload');

  const mimeType = fileBlob.type || 'video/webm';
  const fileSize = fileBlob.size;

  // Step 1: Initiate Resumable Upload Session
  const metadata = {
    name: fileName,
    description,
    mimeType,
    ...(folderId ? { parents: [folderId] } : {}),
  };

  const initResponse = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(fileSize),
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initResponse.ok) {
    const errorText = await initResponse.text().catch(() => '');
    throw new Error(`Failed to initiate Google Drive upload session: ${initResponse.status} ${errorText}`);
  }

  const uploadLocation = initResponse.headers.get('Location');
  if (!uploadLocation) {
    throw new Error('Google Drive API did not return a resumable upload location URL');
  }

  // Step 2: Upload Binary Data with Progress Tracking via XMLHttpRequest
  const fileData = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadLocation, true);
    xhr.setRequestHeader('Content-Type', mimeType);

    if (xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
          onProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          onProgress(100);
          resolve(result);
        } catch {
          reject(new Error('Invalid JSON response from Google Drive on upload completion'));
        }
      } else {
        reject(new Error(`Google Drive upload failed with status ${xhr.status}: ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during Google Drive video upload'));
    xhr.ontimeout = () => reject(new Error('Google Drive upload request timed out'));

    xhr.send(fileBlob);
  });

  const fileId = fileData.id;
  const webViewLink = fileData.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
  const embedUrl = formatGoogleDriveEmbedUrl(fileId);

  // Step 3: Grant public link-reader permission so students can view
  try {
    await setGoogleDriveFilePublic(fileId, accessToken);
  } catch (permErr) {
    console.warn('[GoogleDriveService] Permission grant warning (may be managed by domain policy):', permErr);
  }

  return {
    fileId,
    name: fileData.name || fileName,
    webViewLink,
    embedUrl,
  };
}

/**
 * Sets file sharing permission to "Anyone with the link can view" (reader).
 * 
 * @param {string} fileId 
 * @param {string} accessToken 
 * @returns {Promise<Object>}
 */
export async function setGoogleDriveFilePublic(fileId, accessToken) {
  const permResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone',
      }),
    }
  );

  if (!permResponse.ok) {
    const errText = await permResponse.text().catch(() => '');
    throw new Error(`Failed to set Google Drive permission: ${permResponse.status} ${errText}`);
  }

  return permResponse.json();
}

/**
 * In-memory cache for resolved Google Drive folder IDs.
 */
export const folderHierarchyCache = new Map();

/**
 * Creates a folder in Google Drive.
 * 
 * @param {Object} params
 * @param {string} params.accessToken
 * @param {string} params.folderName
 * @param {string} [params.parentFolderId]
 * @returns {Promise<{ id: string, name: string }>}
 */
export async function createGoogleDriveFolder({ accessToken, folderName, parentFolderId = null }) {
  if (!accessToken) throw new Error('Access token is required');
  if (!folderName) throw new Error('Folder name is required');

  const metadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    ...(parentFolderId ? { parents: [parentFolderId] } : {}),
  };

  const response = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(metadata),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Failed to create Google Drive folder "${folderName}": ${response.status} ${errText}`);
  }

  return response.json();
}

/**
 * Finds an existing folder or creates it if not found.
 * 
 * @param {Object} params
 * @param {string} params.accessToken
 * @param {string} params.folderName
 * @param {string} [params.parentFolderId]
 * @param {Map} [params.cache]
 * @returns {Promise<{ id: string, name: string }>}
 */
export async function findOrCreateGoogleDriveFolder({
  accessToken,
  folderName,
  parentFolderId = null,
  cache = folderHierarchyCache,
}) {
  const cacheKey = `${parentFolderId || 'root'}:${folderName}`;
  if (cache && cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const safeName = folderName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  let q = `mimeType = 'application/vnd.google-apps.folder' and name = '${safeName}' and trashed = false`;
  if (parentFolderId) {
    q += ` and '${parentFolderId}' in parents`;
  }

  try {
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.files && data.files.length > 0) {
        const found = data.files[0];
        if (cache) cache.set(cacheKey, found);
        return found;
      }
    }
  } catch (err) {
    console.warn('[GoogleDriveService] Error searching folder, creating new:', err);
  }

  const created = await createGoogleDriveFolder({ accessToken, folderName, parentFolderId });
  if (cache) cache.set(cacheKey, created);
  return created;
}

/**
 * Resolves or creates the hierarchical folder structure in Google Drive:
 * [Base Folder] / [Class] / [Lesson] / [Teacher Lectures | Students / (studentEmail)]
 * 
 * @param {Object} params
 * @param {string} params.accessToken
 * @param {string} [params.baseFolderName='Classroom Archives']
 * @param {string} params.className - e.g. "IT114115-Demo"
 * @param {string} [params.lessonName='General Recordings'] - e.g. "Lesson 01 - 2026-09-23"
 * @param {'lectures'|'students'} params.subfolderType
 * @param {string} [params.studentEmail] - required if subfolderType is 'students'
 * @param {Map} [params.cache]
 * @returns {Promise<{ folderId: string, folderPath: string }>}
 */
export async function resolveClassroomFolderHierarchy({
  accessToken,
  baseFolderName = 'Classroom Archives',
  className = 'General Class',
  lessonName = 'General Recordings',
  subfolderType = 'lectures',
  studentEmail = null,
  taskTitle = null,
  cache = folderHierarchyCache,
}) {
  if (!accessToken) throw new Error('Access token is required');

  const cleanBase = (baseFolderName || 'Classroom Archives').trim();
  const cleanClass = (className || 'General Class').trim();
  const cleanLesson = (lessonName || 'General Recordings').trim();

  // 1. Root / Base folder
  const baseFolder = await findOrCreateGoogleDriveFolder({
    accessToken,
    folderName: cleanBase,
    parentFolderId: null,
    cache,
  });

  // 2. Class folder
  const classFolder = await findOrCreateGoogleDriveFolder({
    accessToken,
    folderName: cleanClass,
    parentFolderId: baseFolder.id,
    cache,
  });

  // subfolderType === 'task': [Base] / [Class] / Tasks / [Task Title] / Students / [studentEmail]
  if (subfolderType === 'task') {
    const rawTaskTitle = (taskTitle || 'Practical Task').trim();
    const cleanTaskTitle = rawTaskTitle
      .replace(/[/\\:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Practical Task';

    // 3. Tasks root folder under class
    const tasksRootFolder = await findOrCreateGoogleDriveFolder({
      accessToken,
      folderName: 'Tasks',
      parentFolderId: classFolder.id,
      cache,
    });

    // 4. Specific Task folder
    const specificTaskFolder = await findOrCreateGoogleDriveFolder({
      accessToken,
      folderName: cleanTaskTitle,
      parentFolderId: tasksRootFolder.id,
      cache,
    });

    // 5. Students folder under the specific task
    const taskStudentsFolder = await findOrCreateGoogleDriveFolder({
      accessToken,
      folderName: 'Students',
      parentFolderId: specificTaskFolder.id,
      cache,
    });

    if (studentEmail) {
      const cleanEmail = studentEmail.trim();
      const studentFolder = await findOrCreateGoogleDriveFolder({
        accessToken,
        folderName: cleanEmail,
        parentFolderId: taskStudentsFolder.id,
        cache,
      });
      return {
        folderId: studentFolder.id,
        folderPath: `${cleanBase}/${cleanClass}/Tasks/${cleanTaskTitle}/Students/${cleanEmail}`,
      };
    }

    return {
      folderId: taskStudentsFolder.id,
      folderPath: `${cleanBase}/${cleanClass}/Tasks/${cleanTaskTitle}/Students`,
    };
  }

  // 3. Lesson folder
  const lessonFolder = await findOrCreateGoogleDriveFolder({
    accessToken,
    folderName: cleanLesson,
    parentFolderId: classFolder.id,
    cache,
  });

  if (subfolderType === 'lectures') {
    const lectureFolder = await findOrCreateGoogleDriveFolder({
      accessToken,
      folderName: 'Teacher Lectures',
      parentFolderId: lessonFolder.id,
      cache,
    });
    return {
      folderId: lectureFolder.id,
      folderPath: `${cleanBase}/${cleanClass}/${cleanLesson}/Teacher Lectures`,
    };
  }

  // subfolderType === 'students'
  const studentsRootFolder = await findOrCreateGoogleDriveFolder({
    accessToken,
    folderName: 'Students',
    parentFolderId: lessonFolder.id,
    cache,
  });

  if (studentEmail) {
    const cleanEmail = studentEmail.trim();
    const studentFolder = await findOrCreateGoogleDriveFolder({
      accessToken,
      folderName: cleanEmail,
      parentFolderId: studentsRootFolder.id,
      cache,
    });
    return {
      folderId: studentFolder.id,
      folderPath: `${cleanBase}/${cleanClass}/${cleanLesson}/Students/${cleanEmail}`,
    };
  }

  return {
    folderId: studentsRootFolder.id,
    folderPath: `${cleanBase}/${cleanClass}/${cleanLesson}/Students`,
  };
}

