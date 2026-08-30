import './firebase.js';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { FUNCTION_REGION } from './config.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { stringify } from 'csv-stringify/sync';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  WidthType,
  AlignmentType,
  BorderStyle,
  ImageRun,
} from 'docx';

const db = getFirestore();
const storage = getStorage();
const bucket = storage.bucket();

export const processReportJob = onDocumentCreated(
  {
    document: 'reportJobs/{jobId}',
    region: FUNCTION_REGION,
    cpu: 1,
    memory: '2GiB',
    timeoutSeconds: 540,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) {
      console.log('No data associated with the reportJobs event');
      return;
    }

    const jobData = snap.data();
    const jobId = event.params.jobId;
    const {
      classId,
      startTime,
      endTime,
      requesterUid,
      requesterEmail,
      format = 'both', // 'docx' | 'csv' | 'both'
      includeScreenshots = true,
      includeAudioTranscripts = true,
      includeGazeLogs = true,
      studentUids = null,
    } = jobData;
    const jobRef = snap.ref;

    console.log(`Starting report generation for job ${jobId}, class ${classId}`);

    try {
      await jobRef.update({ status: 'processing', startedAt: new Date() });

      // Convert startTime / endTime to Date objects
      const startDate = startTime?.toDate ? startTime.toDate() : new Date(startTime || Date.now() - 24 * 3600 * 1000);
      const endDate = endTime?.toDate ? endTime.toDate() : new Date(endTime || Date.now());
      const startTimestamp = Timestamp.fromDate(startDate);
      const endTimestamp = Timestamp.fromDate(endDate);

      // 1. Fetch Class Data
      const classDoc = await db.doc(`classes/${classId}`).get();
      const classInfo = classDoc.exists ? classDoc.data() : { name: classId };

      // 2. Fetch Students & Student Properties
      const studentsSnap = await db.collection(`classes/${classId}/students`).get();
      const studentMap = {};
      studentsSnap.forEach((doc) => {
        studentMap[doc.id] = { id: doc.id, ...doc.data() };
      });

      const studentPropsSnap = await db.collection(`classes/${classId}/studentProperties`).get();
      studentPropsSnap.forEach((doc) => {
        if (studentMap[doc.id]) {
          studentMap[doc.id].properties = doc.data();
        } else {
          studentMap[doc.id] = { id: doc.id, properties: doc.data() };
        }
      });

      // Filter students if studentUids provided
      let targetStudentIds = Object.keys(studentMap);
      if (Array.isArray(studentUids) && studentUids.length > 0) {
        targetStudentIds = targetStudentIds.filter((uid) => studentUids.includes(uid));
      }

      // 3. Fetch Irregularities (Strictly Scoped to Class & Time Period)
      let irregularities = [];
      try {
        const irregSnap = await db
          .collection(`classes/${classId}/irregularities`)
          .where('timestamp', '>=', startTimestamp)
          .where('timestamp', '<=', endTimestamp)
          .orderBy('timestamp', 'asc')
          .get();

        irregSnap.forEach((doc) => {
          const d = doc.data();
          if (!targetStudentIds.length || targetStudentIds.includes(d.studentUid || d.userId)) {
            irregularities.push({ id: doc.id, ...d });
          }
        });
      } catch (err) {
        console.warn('Could not query ordered irregularities, falling back to unordered:', err);
        const fallbackSnap = await db.collection(`classes/${classId}/irregularities`).get();
        fallbackSnap.forEach((doc) => {
          const d = doc.data();
          const docTime = d.timestamp?.toDate ? d.timestamp.toDate() : new Date(d.timestamp || 0);
          if (docTime >= startDate && docTime <= endDate) {
            if (!targetStudentIds.length || targetStudentIds.includes(d.studentUid || d.userId)) {
              irregularities.push({ id: doc.id, ...d });
            }
          }
        });
      }

      // 4. Fetch Audio Transcripts
      let audioTranscripts = [];
      if (includeAudioTranscripts) {
        try {
          const audioSnap = await db
            .collection('audio')
            .where('classId', '==', classId)
            .where('timestamp', '>=', startTimestamp)
            .where('timestamp', '<=', endTimestamp)
            .get();

          audioSnap.forEach((doc) => {
            const d = doc.data();
            if (d.transcript || d.geminiSummary || d.hasVoiceActivity) {
              audioTranscripts.push({ id: doc.id, ...d });
            }
          });
        } catch (err) {
          console.warn('Audio query fallback:', err);
        }
      }

      // 5. Fetch Screenshot Evidences (if enabled)
      let screenshots = [];
      if (includeScreenshots) {
        try {
          const screenSnap = await db
            .collection('screenshots')
            .where('classId', '==', classId)
            .where('timestamp', '>=', startTimestamp)
            .where('timestamp', '<=', endTimestamp)
            .get();

          screenSnap.forEach((doc) => {
            screenshots.push({ id: doc.id, ...doc.data() });
          });
        } catch (err) {
          console.warn('Screenshot query error:', err);
        }
      }

      console.log(
        `Loaded: ${targetStudentIds.length} students, ${irregularities.length} irregularities, ${audioTranscripts.length} audio records, ${screenshots.length} screenshots`
      );

      // Aggregate metrics per student
      const studentReports = targetStudentIds.map((uid) => {
        const student = studentMap[uid] || { id: uid };
        const studentIrregs = irregularities.filter(
          (ir) => ir.studentUid === uid || ir.userId === uid || (ir.email && ir.email === student.email)
        );
        const studentAudios = audioTranscripts.filter(
          (a) => a.studentUid === uid || (a.studentEmail && a.studentEmail === student.email)
        );
        const studentScreens = screenshots.filter(
          (s) => s.studentUid === uid || (s.email && s.email === student.email)
        );

        const highSeverityCount = studentIrregs.filter((i) => i.severity === 'high' || i.type === 'multiple_faces').length;
        const totalIncidents = studentIrregs.length;
        const riskLevel = highSeverityCount > 2 ? 'HIGH RISK' : totalIncidents > 3 ? 'MODERATE RISK' : 'NORMAL / CLEAN';

        return {
          student,
          irregularities: studentIrregs,
          audios: studentAudios,
          screenshots: studentScreens,
          totalIncidents,
          highSeverityCount,
          riskLevel,
        };
      });

      // --- GENERATE CSV ---
      let csvDownloadUrl = null;
      if (format === 'csv' || format === 'both') {
        const csvRows = [
          [
            'Class ID',
            'Student UID',
            'Student Email',
            'Student Name',
            'Timestamp (UTC)',
            'Incident Type',
            'Severity',
            'Description',
            'Audio Transcript Snippet',
            'Evidence Screenshot Path',
          ],
        ];

        studentReports.forEach((sr) => {
          if (sr.irregularities.length === 0) {
            csvRows.push([
              classId,
              sr.student.id || '',
              sr.student.email || '',
              sr.student.name || sr.student.displayName || '',
              'N/A',
              'NO_INCIDENTS_RECORDED',
              'CLEAN',
              'Session completed with no flagged irregularities',
              '',
              '',
            ]);
          } else {
            sr.irregularities.forEach((ir) => {
              const irTime = ir.timestamp?.toDate ? ir.timestamp.toDate().toISOString() : ir.timestamp || '';
              csvRows.push([
                classId,
                sr.student.id || '',
                sr.student.email || '',
                sr.student.name || sr.student.displayName || '',
                irTime,
                ir.type || ir.title || 'Irregularity',
                ir.severity || 'medium',
                ir.details || ir.description || ir.message || '',
                ir.audioTranscriptSnippet || '',
                ir.screenshotPath || ir.imagePath || '',
              ]);
            });
          }
        });

        const csvString = stringify(csvRows);
        const csvStoragePath = `reports/${classId}/${jobId}/Incident_Log_${classId}_${startDate.toISOString().slice(0, 10)}.csv`;
        const csvFile = bucket.file(csvStoragePath);

        await csvFile.save(csvString, {
          contentType: 'text/csv',
          metadata: { classId, jobId, requesterUid },
        });

        const [signedCsvUrl] = await csvFile.getSignedUrl({
          action: 'read',
          expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
        });
        csvDownloadUrl = signedCsvUrl;
      }

      // --- GENERATE MICROSOFT WORD (.DOCX) ---
      let docxDownloadUrl = null;
      if (format === 'docx' || format === 'both') {
        const docSections = [];

        // Title Paragraphs
        const titleParagraphs = [
          new Paragraph({
            text: 'OFFICIAL EXAM PROCTORING INCIDENT DOSSIER',
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: `Course / Session: ${classInfo.name || classId}  |  Class ID: ${classId}`,
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
          }),
          new Paragraph({
            text: `Examination Period: ${startDate.toLocaleString()} — ${endDate.toLocaleString()}`,
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
          }),
        ];

        // Executive Summary Table
        const summaryTableRows = [
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ text: 'Student Email / Name', bold: true })], width: { size: 35, type: WidthType.PERCENTAGE } }),
              new TableCell({ children: [new Paragraph({ text: 'Incidents Flagged', bold: true })], width: { size: 20, type: WidthType.PERCENTAGE } }),
              new TableCell({ children: [new Paragraph({ text: 'High Severity', bold: true })], width: { size: 20, type: WidthType.PERCENTAGE } }),
              new TableCell({ children: [new Paragraph({ text: 'Proctoring Risk Evaluation', bold: true })], width: { size: 25, type: WidthType.PERCENTAGE } }),
            ],
          }),
        ];

        studentReports.forEach((sr) => {
          summaryTableRows.push(
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph(sr.student.email || sr.student.name || sr.student.id)] }),
                new TableCell({ children: [new Paragraph(String(sr.totalIncidents))] }),
                new TableCell({ children: [new Paragraph(String(sr.highSeverityCount))] }),
                new TableCell({ children: [new Paragraph({ text: sr.riskLevel, bold: sr.riskLevel.includes('HIGH') })] }),
              ],
            })
          );
        });

        const summaryTable = new Table({
          rows: summaryTableRows,
          width: { size: 100, type: WidthType.PERCENTAGE },
        });

        const detailParagraphs = [
          new Paragraph({
            text: 'Detailed Student Incident Breakdown',
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 },
          }),
        ];

        // Detailed student sheets
        studentReports.forEach((sr, idx) => {
          detailParagraphs.push(
            new Paragraph({
              text: `${idx + 1}. Student: ${sr.student.name || sr.student.email || sr.student.id} (${sr.student.email || ''})`,
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 240, after: 100 },
            }),
            new Paragraph({
              children: [
                new TextRun({ text: `Overall Risk Assessment: `, bold: true }),
                new TextRun({ text: sr.riskLevel, bold: true }),
                new TextRun({ text: ` | Total Flags: ${sr.totalIncidents}` }),
              ],
              spacing: { after: 120 },
            })
          );

          if (sr.irregularities.length === 0) {
            detailParagraphs.push(
              new Paragraph({
                text: '✓ No anomalous gaze deviations, background audio speech, or multi-face violations detected during this examination window.',
                spacing: { after: 200 },
              })
            );
          } else {
            const incidentTableRows = [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: 'Timestamp', bold: true })], width: { size: 25, type: WidthType.PERCENTAGE } }),
                  new TableCell({ children: [new Paragraph({ text: 'Type / Category', bold: true })], width: { size: 25, type: WidthType.PERCENTAGE } }),
                  new TableCell({ children: [new Paragraph({ text: 'Severity', bold: true })], width: { size: 15, type: WidthType.PERCENTAGE } }),
                  new TableCell({ children: [new Paragraph({ text: 'Details / Description', bold: true })], width: { size: 35, type: WidthType.PERCENTAGE } }),
                ],
              }),
            ];

            sr.irregularities.forEach((ir) => {
              const tStr = ir.timestamp?.toDate ? ir.timestamp.toDate().toLocaleTimeString() : String(ir.timestamp || '');
              incidentTableRows.push(
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph(tStr)] }),
                    new TableCell({ children: [new Paragraph(ir.type || ir.title || 'Irregularity')] }),
                    new TableCell({ children: [new Paragraph(ir.severity || 'Medium')] }),
                    new TableCell({ children: [new Paragraph(ir.details || ir.description || ir.message || 'Anomaly logged')] }),
                  ],
                })
              );
            });

            detailParagraphs.push(
              new Table({
                rows: incidentTableRows,
                width: { size: 100, type: WidthType.PERCENTAGE },
              })
            );
          }

          // Audio Transcripts Excerpts
          if (sr.audios.length > 0) {
            detailParagraphs.push(
              new Paragraph({
                text: 'Audio Surveillance & Diarization Transcripts:',
                heading: HeadingLevel.HEADING_3,
                spacing: { before: 160, after: 80 },
              })
            );
            sr.audios.slice(0, 5).forEach((aud) => {
              const audTime = aud.timestamp?.toDate ? aud.timestamp.toDate().toLocaleTimeString() : '';
              detailParagraphs.push(
                new Paragraph({
                  children: [
                    new TextRun({ text: `[${audTime}] `, bold: true }),
                    new TextRun({ text: `Transcript: "${aud.transcript || aud.geminiSummary || 'Voice activity recorded'}"` }),
                  ],
                  spacing: { after: 60 },
                })
              );
            });
          }
        });

        const doc = new Document({
          sections: [
            {
              children: [
                ...titleParagraphs,
                summaryTable,
                ...detailParagraphs,
              ],
            },
          ],
        });

        const docxBuffer = await Packer.toBuffer(doc);
        const docxStoragePath = `reports/${classId}/${jobId}/Exam_Incident_Dossier_${classId}_${startDate.toISOString().slice(0, 10)}.docx`;
        const docxFile = bucket.file(docxStoragePath);

        await docxFile.save(docxBuffer, {
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          metadata: { classId, jobId, requesterUid },
        });

        const [signedDocxUrl] = await docxFile.getSignedUrl({
          action: 'read',
          expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
        });
        docxDownloadUrl = signedDocxUrl;
      }

      // 6. Complete Job Doc
      await jobRef.update({
        status: 'completed',
        completedAt: new Date(),
        docxUrl: docxDownloadUrl,
        csvUrl: csvDownloadUrl,
        summary: {
          totalStudents: targetStudentIds.length,
          totalIrregularities: irregularities.length,
          totalAudios: audioTranscripts.length,
        },
      });

      // 7. Send Notification Email if requesterEmail provided
      if (requesterEmail) {
        await db.collection('mails').add({
          to: requesterEmail,
          message: {
            subject: `🎓 Exam Incident Dossier Ready: ${classInfo.name || classId}`,
            text: `Hello,\n\nYour official proctoring incident dossier for ${classInfo.name || classId} (${startDate.toLocaleDateString()}) is ready.\n\nDownload Word Document (.docx): ${docxDownloadUrl || 'N/A'}\nDownload CSV Log: ${csvDownloadUrl || 'N/A'}\n\nLinks are valid for 7 days.\n\nBest regards,\nAI Classroom Assistant`,
          },
          createdAt: new Date(),
        });
      }

      console.log(`Report job ${jobId} completed successfully.`);
    } catch (err) {
      console.error(`Report job ${jobId} failed:`, err);
      await jobRef.update({
        status: 'failed',
        error: err.message || 'Report generation failed',
        failedAt: new Date(),
      });
    }
  }
);
