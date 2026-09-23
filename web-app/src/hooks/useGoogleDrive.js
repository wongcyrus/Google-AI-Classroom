import { useState, useEffect, useCallback } from 'react';
import { doc, updateDoc, setDoc } from 'firebase/firestore';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import { db } from '../firebase-config';
import {
  requestGoogleDriveToken,
  fetchGoogleUserInfo,
  uploadVideoToGoogleDrive,
  extractGoogleDriveFileId,
  formatGoogleDriveEmbedUrl,
  resolveClassroomFolderHierarchy,
} from '../utils/googleDriveService';
import { resolveVideoLessonName } from '../utils/lessonUtils';

const STORAGE_KEY_TOKEN = 'classroom_gdrive_access_token';
const STORAGE_KEY_USER = 'classroom_gdrive_user';
const STORAGE_KEY_BASE_FOLDER = 'classroom_gdrive_base_folder';

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

  const [baseFolderName, setBaseFolderNameState] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(STORAGE_KEY_BASE_FOLDER) || 'Classroom Archives';
    }
    return 'Classroom Archives';
  });

  const setBaseFolderName = useCallback((newName) => {
    const clean = (newName || 'Classroom Archives').trim();
    setBaseFolderNameState(clean);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_BASE_FOLDER, clean);
    }
  }, []);

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
      const rawMsg = err?.message || 'Failed to authenticate with Google Drive.';
      if (rawMsg.includes('access_denied') || rawMsg.includes('verification process') || rawMsg.includes('403')) {
        setError('Google OAuth Error 403: Access Denied. Your app in Google Cloud Console is in "Testing" mode. Go to Google Cloud Console > APIs & Services > OAuth consent screen > "Test users" and add your email (cy.gdoc@gmail.com), or click "Publish App".');
      } else {
        setError(rawMsg);
      }
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

  const uploadRecording = useCallback(async ({
    recording,
    classId,
    className = '',
    lessonName = '',
    baseFolder = null,
  }) => {
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

      // Step 3: Resolve hierarchical folder: [Base] / [Class] / [Lesson] / Teacher Lectures
      let targetFolderId = null;
      let targetFolderPath = null;
      try {
        const hierarchy = await resolveClassroomFolderHierarchy({
          accessToken,
          baseFolderName: baseFolder || baseFolderName || 'Classroom Archives',
          className: className || classId || 'General Class',
          lessonName: lessonName || recording.lessonTitle || recording.title || 'General Recordings',
          subfolderType: 'lectures',
        });
        targetFolderId = hierarchy.folderId;
        targetFolderPath = hierarchy.folderPath;
      } catch (fErr) {
        console.warn('[useGoogleDrive] Folder hierarchy error (uploading to root fallback):', fErr);
      }

      // Step 4: Upload to Google Drive via resumable upload
      const result = await uploadVideoToGoogleDrive({
        accessToken,
        fileBlob: videoBlob,
        fileName,
        description,
        folderId: targetFolderId,
        onProgress: (percent) => setUploadProgress(percent),
      });

      // Step 5: Persist Google Drive linkage in Firestore
      if (classId && recording.id) {
        const recordingRef = doc(db, 'classes', classId, 'lectureRecordings', recording.id);
        await updateDoc(recordingRef, {
          driveFileId: result.fileId,
          driveWebViewLink: result.webViewLink,
          driveEmbedUrl: result.embedUrl,
          driveFolderPath: targetFolderPath,
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
  }, [isConnected, accessToken, connectedUser, baseFolderName]);

  const backupStudentVideosToDrive = useCallback(async ({
    videos = [],
    classId = 'Class',
    className = '',
    lessons = [],
    selectedLesson = '',
    baseFolder = null,
    onBatchProgress = () => {},
    abortSignal = null,
  }) => {
    if (!isConnected || !accessToken) {
      setError('Please connect your Google Drive first.');
      return { successful: [], failed: [], aborted: false };
    }

    if (!videos || videos.length === 0) {
      setError('No student videos selected for backup.');
      return { successful: [], failed: [], aborted: false };
    }

    setIsUploading(true);
    setUploadProgress(0);
    setError(null);
    setSuccessMessage(null);

    const successful = [];
    const failed = [];
    let isAborted = false;

    const resolvedBase = (baseFolder || baseFolderName || 'Classroom Archives').trim();
    const cleanClassName = (className || classId || 'Class').trim();

    for (let i = 0; i < videos.length; i++) {
      if (abortSignal?.aborted) {
        isAborted = true;
        break;
      }

      const video = videos[i];
      const studentEmail = video.studentEmail || video.studentUid || 'Unknown_Student';
      const isTask = Boolean(video.isTaskSubmission || video.taskId);
      const lessonName = resolveVideoLessonName({
        video,
        lessons,
        selectedLesson,
      });

      onBatchProgress({
        index: i,
        total: videos.length,
        currentVideo: video,
        percentage: 0,
        status: 'uploading',
      });

      try {
        // Step 1: Resolve Download URL from storage
        let downloadUrl = video.videoUrl;
        if (!downloadUrl && video.videoPath) {
          const storage = getStorage();
          const videoRef = ref(storage, video.videoPath);
          downloadUrl = await getDownloadURL(videoRef);
        }

        if (!downloadUrl) {
          throw new Error('No storage path or video URL found for this video.');
        }

        // Step 2: Download video blob
        const res = await fetch(downloadUrl);
        if (!res.ok) {
          throw new Error(`Failed to fetch video from storage: ${res.statusText}`);
        }
        const blob = await res.blob();

        // Step 3: Resolve folder hierarchy:
        // Tasks: [Base] / [Class] / Tasks / [Task Title] / Students / [studentEmail]
        // Lessons: [Base] / [Class] / [Lesson] / Students / [studentEmail]
        let targetFolderId = null;
        let targetFolderPath = null;
        try {
          const hierarchy = isTask
            ? await resolveClassroomFolderHierarchy({
                accessToken,
                baseFolderName: resolvedBase,
                className: cleanClassName,
                subfolderType: 'task',
                taskTitle: video.taskTitle || video.taskId || 'Practical Task',
                studentEmail,
              })
            : await resolveClassroomFolderHierarchy({
                accessToken,
                baseFolderName: resolvedBase,
                className: cleanClassName,
                lessonName,
                subfolderType: 'students',
                studentEmail,
              });
          targetFolderId = hierarchy.folderId;
          targetFolderPath = hierarchy.folderPath;
        } catch (fErr) {
          console.warn('[useGoogleDrive] Folder hierarchy error (using root fallback):', fErr);
        }

        // Step 4: Semantic Filename
        const safeEmail = studentEmail.replace(/[@.]/g, '_');
        const dateStr = video.startTime
          ? new Date(video.startTime?.toDate ? video.startTime.toDate() : video.startTime)
              .toISOString()
              .replace(/[:.]/g, '-')
              .slice(0, 19)
          : new Date().toISOString().slice(0, 10);
        const fileName = `${safeEmail}_${dateStr}_${video.id || i}.webm`;

        // Step 5: Upload to Google Drive with progress
        const result = await uploadVideoToGoogleDrive({
          accessToken,
          fileBlob: blob,
          fileName,
          description: `Student Screencast for Class ${cleanClassName}\nStudent: ${studentEmail}\nLesson: ${lessonName}\nJob ID: ${video.id || 'N/A'}`,
          folderId: targetFolderId,
          onProgress: (pct) => {
            setUploadProgress(pct);
            onBatchProgress({
              index: i,
              total: videos.length,
              currentVideo: video,
              percentage: pct,
              status: 'uploading',
            });
          },
        });

        // Step 6: Persist Google Drive links into Firestore videoJobs
        if (video.id) {
          const jobDocRef = doc(db, 'videoJobs', video.id);
          await updateDoc(jobDocRef, {
            driveFileId: result.fileId,
            driveWebViewLink: result.webViewLink,
            driveEmbedUrl: result.embedUrl,
            driveFolderPath: targetFolderPath,
            driveBackedUpAt: new Date(),
            driveBackedUpBy: connectedUser?.email || 'Teacher',
          });
        }

        successful.push({
          video,
          fileId: result.fileId,
          webViewLink: result.webViewLink,
          folderPath: targetFolderPath,
        });

        onBatchProgress({
          index: i + 1,
          total: videos.length,
          currentVideo: video,
          percentage: 100,
          status: 'success',
        });
      } catch (uploadErr) {
        console.error(`[useGoogleDrive] Failed to backup video ${video.id}:`, uploadErr);
        failed.push({
          video,
          error: uploadErr?.message || 'Upload failed',
        });
        onBatchProgress({
          index: i + 1,
          total: videos.length,
          currentVideo: video,
          percentage: 0,
          status: 'error',
          error: uploadErr?.message,
        });
      }
    }

    setIsUploading(false);
    if (failed.length === 0 && !isAborted) {
      setSuccessMessage(`Successfully backed up ${successful.length} student video(s) to Google Drive!`);
    } else if (successful.length > 0) {
      setSuccessMessage(`Backed up ${successful.length} video(s); ${failed.length} failed.`);
    }

    return {
      successful,
      failed,
      successCount: successful.length,
      failedCount: failed.length,
      aborted: isAborted,
    };
  }, [isConnected, accessToken, connectedUser, baseFolderName]);

  const backupTaskVideosToDrive = useCallback(async ({
    classId,
    className = '',
    task,
    submissions = [],
    videoJobs = [],
    baseFolder = null,
    onBatchProgress = () => {},
    abortSignal = null,
  }) => {
    if (!isConnected || !accessToken) {
      setError('Please connect your Google Drive first.');
      return { successful: [], failed: [], aborted: false };
    }

    if (!task || !classId) {
      setError('Task and class information are required.');
      return { successful: [], failed: [], aborted: false };
    }

    if (!submissions || submissions.length === 0) {
      setError('No task submissions found for backup.');
      return { successful: [], failed: [], aborted: false };
    }

    setIsUploading(true);
    setUploadProgress(0);
    setError(null);
    setSuccessMessage(null);

    const successful = [];
    const failed = [];
    let isAborted = false;

    const resolvedBase = (baseFolder || baseFolderName || 'Classroom Archives').trim();
    const cleanClassName = (className || classId || 'Class').trim();
    const taskTitle = task.title || task.id || 'Practical Task';

    for (let i = 0; i < submissions.length; i++) {
      if (abortSignal?.aborted) {
        isAborted = true;
        break;
      }

      const sub = submissions[i];
      const studentUid = sub.studentUid || sub.id;
      const studentEmail = sub.email || sub.studentEmail || studentUid || 'student';
      const attemptNumber = sub.latestAttempt?.attemptNumber || sub.attemptNumber || 1;

      // Find video path: from sub itself, latestAttempt, or matched videoJobs
      let videoStoragePath = sub.compiledVideoPath || sub.latestAttempt?.compiledVideoPath || sub.videoPath;
      let matchedJobId = sub.videoJobId || sub.latestAttempt?.videoJobId || sub.jobId;

      if (!videoStoragePath && Array.isArray(videoJobs) && videoJobs.length > 0) {
        const matchedJob = videoJobs.find(v => 
          (v.studentUid === studentUid || v.studentEmail?.toLowerCase() === String(studentEmail).toLowerCase()) &&
          (v.status === 'completed' && (v.videoPath || v.videoUrl))
        );
        if (matchedJob) {
          videoStoragePath = matchedJob.videoPath;
          matchedJobId = matchedJob.id || matchedJob.jobId;
        }
      }

      onBatchProgress({
        index: i,
        total: submissions.length,
        currentSubmission: sub,
        studentEmail,
        percentage: 0,
        status: 'uploading',
      });

      if (!videoStoragePath) {
        failed.push({
          submission: sub,
          studentEmail,
          error: 'No compiled video found for this submission.',
        });
        onBatchProgress({
          index: i,
          total: submissions.length,
          currentSubmission: sub,
          studentEmail,
          percentage: 0,
          status: 'error',
          error: 'No compiled video found',
        });
        continue;
      }

      try {
        // Step 1: Resolve Download URL from storage
        const storage = getStorage();
        const videoRef = ref(storage, videoStoragePath);
        const downloadUrl = await getDownloadURL(videoRef);

        // Step 2: Download video blob
        const res = await fetch(downloadUrl);
        if (!res.ok) {
          throw new Error(`Failed to fetch video blob from storage: ${res.statusText}`);
        }
        const blob = await res.blob();

        // Step 3: Resolve folder hierarchy: [Base] / [Class] / Tasks / [Task Title] / Students / [studentEmail]
        let targetFolderId = null;
        let targetFolderPath = null;
        try {
          const hierarchy = await resolveClassroomFolderHierarchy({
            accessToken,
            baseFolderName: resolvedBase,
            className: cleanClassName,
            subfolderType: 'task',
            taskTitle,
            studentEmail,
          });
          targetFolderId = hierarchy.folderId;
          targetFolderPath = hierarchy.folderPath;
        } catch (fErr) {
          console.warn('[useGoogleDrive] Task folder hierarchy resolution error:', fErr);
        }

        // Step 4: Semantic Filename
        const safeEmail = String(studentEmail).replace(/[@.]/g, '_');
        const safeTaskTitle = String(taskTitle).replace(/[/\\:*?"<>|\s]+/g, '_');
        const fileName = `${safeEmail}_${safeTaskTitle}_attempt_${attemptNumber}.mp4`;

        // Step 5: Upload to Google Drive with progress
        const result = await uploadVideoToGoogleDrive({
          accessToken,
          fileBlob: blob,
          fileName,
          description: `Practical Task Submission Video\nClass: ${cleanClassName}\nTask: ${taskTitle}\nStudent: ${studentEmail}\nAttempt: ${attemptNumber}`,
          folderId: targetFolderId,
          onProgress: (pct) => {
            setUploadProgress(pct);
            onBatchProgress({
              index: i,
              total: submissions.length,
              currentSubmission: sub,
              studentEmail,
              percentage: pct,
              status: 'uploading',
            });
          },
        });

        // Step 6: Persist Drive links into Firestore:
        // A. Update submission document
        if (studentUid && task.id) {
          const subDocRef = doc(db, 'classes', classId, 'tasks', task.id, 'submissions', studentUid);
          await updateDoc(subDocRef, {
            driveFileId: result.fileId,
            driveWebViewLink: result.webViewLink,
            driveEmbedUrl: result.embedUrl,
            driveFolderPath: targetFolderPath,
            driveBackedUpAt: new Date(),
            driveBackedUpBy: connectedUser?.email || 'Teacher',
          });

          // B. Update attempt document if applicable
          try {
            const attemptRef = doc(db, 'classes', classId, 'tasks', task.id, 'submissions', studentUid, 'attempts', String(attemptNumber));
            await setDoc(attemptRef, {
              driveFileId: result.fileId,
              driveWebViewLink: result.webViewLink,
              driveEmbedUrl: result.embedUrl,
              driveFolderPath: targetFolderPath,
              driveBackedUpAt: new Date(),
            }, { merge: true });
          } catch (attErr) {
            console.debug('[useGoogleDrive] Attempt doc update skipped:', attErr);
          }
        }

        // C. Update videoJob if matched
        if (matchedJobId) {
          try {
            const jobDocRef = doc(db, 'videoJobs', matchedJobId);
            await updateDoc(jobDocRef, {
              driveFileId: result.fileId,
              driveWebViewLink: result.webViewLink,
              driveEmbedUrl: result.embedUrl,
              driveFolderPath: targetFolderPath,
              driveBackedUpAt: new Date(),
              driveBackedUpBy: connectedUser?.email || 'Teacher',
            });
          } catch (jobErr) {
            console.debug('[useGoogleDrive] Video job doc update skipped:', jobErr);
          }
        }

        successful.push({
          submission: sub,
          studentEmail,
          fileId: result.fileId,
          webViewLink: result.webViewLink,
          folderPath: targetFolderPath,
        });

        onBatchProgress({
          index: i,
          total: submissions.length,
          currentSubmission: sub,
          studentEmail,
          percentage: 100,
          status: 'success',
          result,
        });

      } catch (err) {
        console.error(`[useGoogleDrive] Failed backing up task submission for ${studentEmail}:`, err);
        failed.push({
          submission: sub,
          studentEmail,
          error: err.message,
        });
        onBatchProgress({
          index: i,
          total: submissions.length,
          currentSubmission: sub,
          studentEmail,
          percentage: 0,
          status: 'error',
          error: err.message,
        });
      }
    }

    setIsUploading(false);

    if (isAborted) {
      setSuccessMessage(`Task video backup paused. ${successful.length} uploaded, ${failed.length} failed.`);
      return { successful, failed, aborted: true };
    }

    if (failed.length === 0) {
      setSuccessMessage(`Successfully backed up all ${successful.length} task video(s) to Google Drive!`);
    } else {
      setError(`Backed up ${successful.length} video(s); ${failed.length} failed.`);
    }

    return {
      successful,
      failed,
      successCount: successful.length,
      failedCount: failed.length,
      aborted: false,
    };
  }, [isConnected, accessToken, baseFolderName, connectedUser]);

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
    baseFolderName,
    setBaseFolderName,
    isConnecting,
    isUploading,
    uploadProgress,
    error,
    successMessage,
    connect,
    disconnect,
    uploadRecording,
    backupStudentVideosToDrive,
    backupTaskVideosToDrive,
    linkManualDrive,
    unlinkRecording,
    clearFeedback: () => {
      setError(null);
      setSuccessMessage(null);
    },
  };
}
