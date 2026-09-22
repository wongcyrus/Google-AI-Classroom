import { useState, useEffect, useCallback } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase-config';
import {
  requestGoogleDriveToken,
  fetchGoogleUserInfo,
  uploadVideoToGoogleDrive,
  extractGoogleDriveFileId,
  formatGoogleDriveEmbedUrl,
} from '../utils/googleDriveService';

const STORAGE_KEY_TOKEN = 'classroom_gdrive_access_token';
const STORAGE_KEY_USER = 'classroom_gdrive_user';

export function useGoogleDrive() {
  const [clientId] = useState(() => {
    return import.meta.env?.VITE_GOOGLE_CLIENT_ID || '';
  });

  const isConfigured = Boolean(clientId && clientId.trim());

  const [accessToken, setAccessToken] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem(STORAGE_KEY_TOKEN) || null;
    }
    return null;
  });

  const [connectedUser, setConnectedUser] = useState(() => {
    if (typeof window !== 'undefined') {
      const savedUser = sessionStorage.getItem(STORAGE_KEY_USER);
      if (savedUser) {
        try {
          return JSON.parse(savedUser);
        } catch {
          return null;
        }
      }
    }
    return null;
  });

  const [isConnecting, setIsConnecting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const isConnected = Boolean(accessToken && connectedUser);

  // Deprecated no-op retained for backwards compatibility with tests
  const setCustomClientId = useCallback(() => {}, []);

  const connect = useCallback(async (customId) => {
    const targetClientId = (customId || clientId || '').trim();
    if (!targetClientId) {
      setError('Google Drive cloud integration is not configured.');
      return false;
    }

    setIsConnecting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const tokenResponse = await requestGoogleDriveToken({ clientId: targetClientId });
      const token = tokenResponse.access_token;
      setAccessToken(token);
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(STORAGE_KEY_TOKEN, token);
      }

      // Fetch user profile info
      let userProfile = { email: 'Google Account', name: 'Google User', picture: '' };
      try {
        const info = await fetchGoogleUserInfo(token);
        userProfile = {
          email: info.email || 'Google Account',
          name: info.name || info.email || 'Google User',
          picture: info.picture || '',
        };
      } catch (profileErr) {
        console.warn('[useGoogleDrive] User profile notice:', profileErr);
      }

      setConnectedUser(userProfile);
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(STORAGE_KEY_USER, JSON.stringify(userProfile));
      }

      setSuccessMessage(`Connected to Google Drive as ${userProfile.email}`);
      return true;
    } catch (err) {
      setError(err?.message || 'Failed to authenticate with Google Drive.');
      return false;
    } finally {
      setIsConnecting(false);
    }
  }, [clientId]);

  const disconnect = useCallback(() => {
    setAccessToken(null);
    setConnectedUser(null);
    setError(null);
    setSuccessMessage(null);
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(STORAGE_KEY_TOKEN);
      sessionStorage.removeItem(STORAGE_KEY_USER);
    }
  }, []);

  const uploadRecording = useCallback(async ({ recording, classId }) => {
    if (!isConnected || !accessToken) {
      setError('Please connect your Google Drive first.');
      return null;
    }

    if (!recording?.videoUrl) {
      setError('Recording does not have a valid video URL to upload.');
      return null;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setError(null);
    setSuccessMessage(null);

    try {
      // Step 1: Fetch the video blob from Cloud Storage
      const response = await fetch(recording.videoUrl);
      if (!response.ok) {
        throw new Error(`Failed to download recording file from storage: ${response.statusText}`);
      }
      const videoBlob = await response.blob();

      // Step 2: Format semantic filename and description
      const safeTitle = (recording.title || 'Lecture_Recording').replace(/[^a-zA-Z0-9_-]/g, '_');
      const ext = recording.mimeType?.includes('webm') ? 'webm' : 'mp4';
      const fileName = `${classId || 'Class'}_${safeTitle}_${recording.id}.${ext}`;
      const description = `Classroom Lecture: ${recording.title || 'Class Recording'}\nClass ID: ${classId}\nRecorded: ${recording.startedAt?.toDate ? recording.startedAt.toDate().toLocaleString() : new Date().toLocaleString()}`;

      // Step 3: Upload to Google Drive via resumable upload
      const result = await uploadVideoToGoogleDrive({
        accessToken,
        fileBlob: videoBlob,
        fileName,
        description,
        onProgress: (percent) => setUploadProgress(percent),
      });

      // Step 4: Persist Google Drive linkage in Firestore
      if (classId && recording.id) {
        const recordingRef = doc(db, 'classes', classId, 'lectureRecordings', recording.id);
        await updateDoc(recordingRef, {
          driveFileId: result.fileId,
          driveWebViewLink: result.webViewLink,
          driveEmbedUrl: result.embedUrl,
          driveUploadedAt: new Date(),
          driveUploadedBy: connectedUser?.email || 'Teacher',
        });
      }

      setSuccessMessage(`Successfully uploaded "${fileName}" to Google Drive!`);
      return result;
    } catch (err) {
      setError(err?.message || 'Google Drive upload encountered an error.');
      return null;
    } finally {
      setIsUploading(false);
    }
  }, [isConnected, accessToken, connectedUser]);

  const linkManualDrive = useCallback(async ({ recordingId, classId, driveUrlOrId }) => {
    const fileId = extractGoogleDriveFileId(driveUrlOrId);
    if (!fileId) {
      setError('Invalid Google Drive URL or File ID. Please enter a valid link or 20+ character ID.');
      return false;
    }

    setError(null);
    setSuccessMessage(null);

    try {
      const embedUrl = formatGoogleDriveEmbedUrl(fileId);
      const webViewLink = `https://drive.google.com/file/d/${fileId}/view`;

      if (classId && recordingId) {
        const recordingRef = doc(db, 'classes', classId, 'lectureRecordings', recordingId);
        await updateDoc(recordingRef, {
          driveFileId: fileId,
          driveWebViewLink: webViewLink,
          driveEmbedUrl: embedUrl,
          driveUploadedAt: new Date(),
        });
      }

      setSuccessMessage('Successfully linked Google Drive video to classroom.');
      return true;
    } catch (err) {
      setError(err?.message || 'Failed to link Google Drive video.');
      return false;
    }
  }, []);

  const unlinkRecording = useCallback(async ({ recordingId, classId }) => {
    if (!classId || !recordingId) return false;
    try {
      const recordingRef = doc(db, 'classes', classId, 'lectureRecordings', recordingId);
      await updateDoc(recordingRef, {
        driveFileId: null,
        driveWebViewLink: null,
        driveEmbedUrl: null,
        driveUploadedAt: null,
        driveUploadedBy: null,
      });
      setSuccessMessage('Unlinked Google Drive video.');
      return true;
    } catch (err) {
      setError(err?.message || 'Failed to unlink Google Drive video.');
      return false;
    }
  }, []);

  return {
    clientId,
    isConfigured,
    setCustomClientId,
    isConnected,
    connectedUser,
    accessToken,
    isConnecting,
    isUploading,
    uploadProgress,
    error,
    successMessage,
    connect,
    disconnect,
    uploadRecording,
    linkManualDrive,
    unlinkRecording,
    clearFeedback: () => {
      setError(null);
      setSuccessMessage(null);
    },
  };
}
