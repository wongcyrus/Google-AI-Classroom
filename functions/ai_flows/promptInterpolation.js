/**
 * Interpolates dynamic runtime placeholders in prompt templates.
 * Supports standard placeholders across video, image, audio, and translation flows:
 * - {{captureInterval}}
 * - {{frameRate}}
 * - {{intervalMinutes}}
 * - {{classId}}
 * - {{studentEmail}}
 * - {{studentUid}}
 * - {{studentName}}
 * - {{startTime}}
 * - {{endTime}}
 * - {{studentRecords}}
 * - {{courseContext}}
 * - {{targetLanguage}}
 */
export function interpolatePromptPlaceholders(promptTemplate, context = {}) {
  if (!promptTemplate || typeof promptTemplate !== 'string') return '';

  const captureInterval = typeof context.captureInterval === 'number' && context.captureInterval > 0
    ? context.captureInterval
    : (typeof context.frameRate === 'number' && context.frameRate > 0 ? context.frameRate : 15);

  const intervalMinutes = (captureInterval / 60).toFixed(2).replace(/\.?0+$/, '');

  return promptTemplate
    .replace(/\{\{\s*captureInterval\s*\}\}/g, String(captureInterval))
    .replace(/\{\{\s*frameRate\s*\}\}/g, String(captureInterval))
    .replace(/\{\{\s*intervalMinutes\s*\}\}/g, String(intervalMinutes))
    .replace(/\{\{\s*classId\s*\}\}/g, String(context.classId || ''))
    .replace(/\{\{\s*studentEmail\s*\}\}/g, String(context.studentEmail || ''))
    .replace(/\{\{\s*studentUid\s*\}\}/g, String(context.studentUid || ''))
    .replace(/\{\{\s*studentName\s*\}\}/g, String(context.studentName || context.studentEmail || ''))
    .replace(/\{\{\s*startTime\s*\}\}/g, String(context.startTime || ''))
    .replace(/\{\{\s*endTime\s*\}\}/g, String(context.endTime || ''))
    .replace(/\{\{\s*courseContext\s*\}\}/g, String(context.courseContext || ''))
    .replace(/\{\{\s*targetLanguage\s*\}\}/g, String(context.targetLanguage || ''))
    .replace(/\{\{\s*studentRecords\s*\}\}/g, String(
      context.studentRecords || (context.studentEmail ? `Student: ${context.studentEmail} (${context.studentUid || 'N/A'})` : '')
    ));
}
