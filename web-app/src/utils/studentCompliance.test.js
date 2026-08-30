import { describe, it, expect } from 'vitest';
import {
  evaluateStudentCompliance,
  getComplianceSummary,
  filterStudentsByCompliance,
  getNudgeMessageForFilter,
  exportComplianceResultsToCsv,
} from './studentCompliance';

describe('studentCompliance Utility', () => {
  const fullyCompliantStudent = {
    id: 'stu_1',
    email: 'stu1@example.com',
    isSharing: true,
    isWebcamSharing: true,
    isAudioSharing: true,
    audioError: null,
    faceStatus: 'normal',
    isMultiSpeaker: false,
    speakerCount: 1,
  };

  const dualSettings = {
    captureMode: 'dual',
    enableAudioCapture: true,
    isCapturing: true,
  };

  const webcamOnlySettings = {
    captureMode: 'webcam',
    enableAudioCapture: true,
    isCapturing: true,
  };

  const screenOnlySettings = {
    captureMode: 'screen',
    enableAudioCapture: false,
    isCapturing: true,
  };

  describe('evaluateStudentCompliance', () => {
    it('returns compliant when all streams are active in dual mode', () => {
      const res = evaluateStudentCompliance(fullyCompliantStudent, dualSettings, {
        screen: { url: 'https://img.jpg' },
        webcam: { url: 'https://cam.jpg' },
      });
      expect(res.isCompliant).toBe(true);
      expect(res.issues).toHaveLength(0);
      expect(res.hasSevereIssue).toBe(false);
    });

    it('flags no_screen when student is not sharing screen', () => {
      const student = { ...fullyCompliantStudent, isSharing: false };
      const res = evaluateStudentCompliance(student, dualSettings);
      expect(res.isCompliant).toBe(false);
      expect(res.issues.some((i) => i.type === 'no_screen')).toBe(true);
      expect(res.hasSevereIssue).toBe(true);
    });

    it('flags no_cam when webcam is required (dual or webcam mode) but not sharing', () => {
      const student = { ...fullyCompliantStudent, isWebcamSharing: false };
      const resDual = evaluateStudentCompliance(student, dualSettings);
      expect(resDual.isCompliant).toBe(false);
      expect(resDual.issues.some((i) => i.type === 'no_cam')).toBe(true);

      const resWebcamOnly = evaluateStudentCompliance(student, webcamOnlySettings);
      expect(resWebcamOnly.isCompliant).toBe(false);
      expect(resWebcamOnly.issues.some((i) => i.type === 'no_cam')).toBe(true);
    });

    it('does NOT flag no_cam when captureMode is screen-only', () => {
      const student = { ...fullyCompliantStudent, isWebcamSharing: false };
      const res = evaluateStudentCompliance(student, screenOnlySettings);
      expect(res.isCompliant).toBe(true);
      expect(res.issues).toHaveLength(0);
    });

    it('flags no_mic when audio capture is enabled but student mic is off or errored', () => {
      const studentOff = { ...fullyCompliantStudent, isAudioSharing: false };
      const resOff = evaluateStudentCompliance(studentOff, dualSettings);
      expect(resOff.issues.some((i) => i.type === 'no_mic')).toBe(true);
      expect(resOff.issues.find((i) => i.type === 'no_mic').label).toBe('Microphone Inactive');

      const studentErr = { ...fullyCompliantStudent, isAudioSharing: true, audioError: 'Permission Denied' };
      const resErr = evaluateStudentCompliance(studentErr, dualSettings);
      expect(resErr.issues.some((i) => i.type === 'no_mic')).toBe(true);
      expect(resErr.issues.find((i) => i.type === 'no_mic').label).toContain('Permission Denied');
    });

    it('flags ai_alert when face status indicates an anomaly or multiple speakers or active violations', () => {
      // Looking away
      const studentLookingAway = { ...fullyCompliantStudent, faceStatus: 'looking_away', yawAngle: 35 };
      const resAway = evaluateStudentCompliance(studentLookingAway, dualSettings);
      expect(resAway.issues.some((i) => i.type === 'ai_alert')).toBe(true);
      expect(resAway.issues.find((i) => i.type === 'ai_alert').label).toContain('Looking Away (+35°)');

      // No face
      const studentNoFace = { ...fullyCompliantStudent, faceStatus: 'no_face' };
      const resNoFace = evaluateStudentCompliance(studentNoFace, dualSettings);
      expect(resNoFace.issues.find((i) => i.type === 'ai_alert').label).toBe('No Face in Frame');

      // Multiple faces
      const studentMultiFace = { ...fullyCompliantStudent, faceStatus: 'multiple_faces' };
      const resMultiFace = evaluateStudentCompliance(studentMultiFace, dualSettings);
      expect(resMultiFace.issues.find((i) => i.type === 'ai_alert').label).toBe('Multiple Faces in Frame');

      // Multiple speakers
      const studentMultiVoice = { ...fullyCompliantStudent, isMultiSpeaker: true, speakerCount: 3 };
      const resVoice = evaluateStudentCompliance(studentMultiVoice, dualSettings);
      expect(resVoice.issues.some((i) => i.type === 'ai_alert')).toBe(true);
      expect(resVoice.issues.find((i) => i.type === 'ai_alert').label).toContain('Multiple Speakers');

      // Active violation custom
      const studentActiveViol = { ...fullyCompliantStudent, activeViolation: 'unauthorized_tab' };
      const resViol = evaluateStudentCompliance(studentActiveViol, dualSettings);
      expect(resViol.issues.find((i) => i.type === 'ai_alert').label).toContain('unauthorized_tab');

      // Normal, disabled, and cloud_fallback should not trigger ai_alert
      expect(evaluateStudentCompliance({ ...fullyCompliantStudent, faceStatus: 'normal' }, dualSettings).issues).toHaveLength(0);
      expect(evaluateStudentCompliance({ ...fullyCompliantStudent, faceStatus: 'disabled' }, dualSettings).issues).toHaveLength(0);
      expect(evaluateStudentCompliance({ ...fullyCompliantStudent, faceStatus: 'cloud_fallback' }, dualSettings).issues).toHaveLength(0);
      expect(evaluateStudentCompliance({ ...fullyCompliantStudent, faceStatus: 'initializing' }, dualSettings).issues).toHaveLength(0);
    });

    it('handles null/undefined inputs safely', () => {
      const res = evaluateStudentCompliance(null, null);
      expect(res.isCompliant).toBe(false);
      expect(res.issues.some((i) => i.type === 'no_screen')).toBe(true);
    });
  });

  describe('getComplianceSummary & filterStudentsByCompliance', () => {
    const students = [
      { id: '1', email: 's1@test.com', isSharing: true, isWebcamSharing: true, isAudioSharing: true, faceStatus: 'normal' },
      { id: '2', email: 's2@test.com', isSharing: true, isWebcamSharing: false, isAudioSharing: true, faceStatus: 'normal' }, // no_cam
      { id: '3', email: 's3@test.com', isSharing: false, isWebcamSharing: false, isAudioSharing: false, faceStatus: 'normal' }, // no_screen, no_cam, no_mic
      { id: '4', email: 's4@test.com', isSharing: true, isWebcamSharing: true, isAudioSharing: true, faceStatus: 'looking_away', yawAngle: 28 }, // ai_alert
    ];

    it('correctly aggregates compliance summary counts with defaults', () => {
      const summary = getComplianceSummary(students, dualSettings);
      expect(summary.total).toBe(4);
      expect(summary.problems).toBe(3); // s2, s3, s4 have issues
      expect(summary.noCam).toBe(2); // s2, s3
      expect(summary.noMic).toBe(1); // s3
      expect(summary.noScreen).toBe(1); // s3
      expect(summary.aiAlert).toBe(1); // s4

      // Empty list default
      expect(getComplianceSummary()).toEqual({
        total: 0,
        problems: 0,
        noCam: 0,
        noMic: 0,
        noScreen: 0,
        aiAlert: 0,
      });
    });

    it('filters students properly by category including default and empty', () => {
      expect(filterStudentsByCompliance(students, 'all', dualSettings)).toHaveLength(4);
      expect(filterStudentsByCompliance(students, '', dualSettings)).toHaveLength(4);
      expect(filterStudentsByCompliance(students, null, dualSettings)).toHaveLength(4);
      expect(filterStudentsByCompliance(students, 'problems', dualSettings)).toHaveLength(3);
      expect(filterStudentsByCompliance(students, 'no_cam', dualSettings).map((s) => s.id)).toEqual(['2', '3']);
      expect(filterStudentsByCompliance(students, 'no_mic', dualSettings).map((s) => s.id)).toEqual(['3']);
      expect(filterStudentsByCompliance(students, 'no_screen', dualSettings).map((s) => s.id)).toEqual(['3']);
      expect(filterStudentsByCompliance(students, 'ai_alert', dualSettings).map((s) => s.id)).toEqual(['4']);
      expect(filterStudentsByCompliance([], 'problems', dualSettings)).toEqual([]);
    });
  });

  describe('getNudgeMessageForFilter', () => {
    it('returns appropriate guidance message for each issue filter and default fallback', () => {
      expect(getNudgeMessageForFilter('no_cam')).toContain('webcam');
      expect(getNudgeMessageForFilter('no_mic')).toContain('Microphone');
      expect(getNudgeMessageForFilter('no_screen')).toContain('sharing your entire screen');
      expect(getNudgeMessageForFilter('ai_alert')).toContain('looking directly');
      expect(getNudgeMessageForFilter('problems')).toContain('compliant');
      expect(getNudgeMessageForFilter('unknown')).toContain('compliant');
    });
  });

  describe('exportComplianceResultsToCsv', () => {
    it('formats filtered students into CSV with headers and proper columns', () => {
      const filtered = [
        {
          id: 's_101',
          email: 'alice@school.edu',
          isSharing: false,
          isWebcamSharing: false,
          isAudioSharing: false,
          faceStatus: 'looking_away',
          yawAngle: 28,
        },
      ];

      const csv = exportComplianceResultsToCsv(filtered, 'problems', dualSettings, {}, 'CLASS_101');
      expect(csv).toContain('Student ID,Student Email,Filter Category,Compliance Status');
      expect(csv).toContain('"s_101","alice@school.edu","problems","Non-Compliant"');
      expect(csv).toContain('"looking_away","28"');
    });

    it('handles empty filtered students list gracefully', () => {
      const csv = exportComplianceResultsToCsv([], 'all', dualSettings, {}, 'CLASS_101');
      expect(csv).toContain('Student ID,Student Email,Filter Category');
      const lines = csv.trim().split('\n');
      expect(lines).toHaveLength(1); // Header only
    });
  });
});
