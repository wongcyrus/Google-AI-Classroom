import { describe, it, expect } from 'vitest';
import {
  CLASS_TEMPLATES,
  DEFAULT_CLASS_TEMPLATE_ID,
  getClassTemplate,
  getTemplateSettings,
} from './classTemplates';

describe('classTemplates constants and helpers', () => {
  it('defines the three required templates: lecture, lab, and lecture_in_lab', () => {
    expect(CLASS_TEMPLATES.lecture).toBeDefined();
    expect(CLASS_TEMPLATES.lab).toBeDefined();
    expect(CLASS_TEMPLATES.lecture_in_lab).toBeDefined();
  });

  describe('Lecture template presets', () => {
    it('configures studio recording and disables student screen capture and proctoring', () => {
      const { settings } = CLASS_TEMPLATES.lecture;
      expect(settings.classType).toBe('lecture');
      expect(settings.automaticCapture).toBe(false);
      expect(settings.requireFullScreenOnly).toBe(false);
      expect(settings.aiMonitoringMode).toBe('off');
      expect(settings.defaultLectureRecording).toBe(true);
      expect(settings.isLectureSubtitlesEnabled).toBe(true);
      expect(settings.allowShareTeacherRecordings).toBe(true);
    });
  });

  describe('Lab template presets', () => {
    it('configures dual-screen student capture, relaxed full-screen, and disables lecture studio', () => {
      const { settings } = CLASS_TEMPLATES.lab;
      expect(settings.classType).toBe('lab');
      expect(settings.automaticCapture).toBe(true);
      expect(settings.captureMode).toBe('dual');
      expect(settings.automaticCombine).toBe(true);
      expect(settings.requireFullScreenOnly).toBe(false); // relaxed for multi-window
      expect(settings.defaultLectureRecording).toBe(false);
      expect(settings.isLectureSubtitlesEnabled).toBe(false);
    });
  });

  describe('Lecture in Lab template presets', () => {
    it('enforces anti-distraction focus: fullscreen required, dual-screen, high attention, 5-min bingo', () => {
      const { settings } = CLASS_TEMPLATES.lecture_in_lab;
      expect(settings.classType).toBe('lecture_in_lab');
      expect(settings.automaticCapture).toBe(true);
      expect(settings.captureMode).toBe('dual');
      expect(settings.requireFullScreenOnly).toBe(true); // forces focus
      expect(settings.aiMonitoringMode).toBe('hybrid');
      expect(settings.gazeSensitivity).toBe('high');
      expect(settings.faceDebounceSeconds).toBe(3);
      expect(settings.autoBingoEnabled).toBe(true);
      expect(settings.autoBingoIntervalMinutes).toBe(5);
      expect(settings.defaultLectureRecording).toBe(true);
      expect(settings.isLectureSubtitlesEnabled).toBe(true);
    });
  });

  describe('Helper functions', () => {
    it('getClassTemplate returns requested template or default on unknown', () => {
      expect(getClassTemplate('lab').name).toBe('Lab');
      expect(getClassTemplate('lecture_in_lab').name).toBe('Lecture in Lab');
      expect(getClassTemplate('unknown_key').id).toBe(DEFAULT_CLASS_TEMPLATE_ID);
    });

    it('getTemplateSettings returns settings copy for template', () => {
      const labSettings = getTemplateSettings('lab');
      expect(labSettings.captureMode).toBe('dual');
      labSettings.captureMode = 'single';
      // Ensure original is not mutated
      expect(CLASS_TEMPLATES.lab.settings.captureMode).toBe('dual');
    });
  });
});
