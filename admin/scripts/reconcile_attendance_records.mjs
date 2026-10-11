import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const targetProject = process.argv[2] || 'it114115-2627';
console.log(`=== Reconciling Attendance Records for Project: ${targetProject} ===`);

initializeApp({ projectId: targetProject });
const db = getFirestore();

async function reconcileClass(classId) {
  console.log(`\nReconciling class: ${classId}`);
  const classDoc = await db.collection('classes').doc(classId).get();
  if (!classDoc.exists) {
    console.log(`Class ${classId} not found.`);
    return;
  }

  const classData = classDoc.data();
  const classCaptureInterval = classData.frameRate ? Number(classData.frameRate) : 15;
  const studentsMap = classData.students || {};

  const lessonsSnap = await db.collection('classes').doc(classId).collection('lessons').get();
  if (lessonsSnap.empty) {
    console.log(`No lessons found for class ${classId}.`);
    return;
  }

  const videoJobsSnap = await db.collection('videoJobs')
    .where('classId', '==', classId)
    .where('status', '==', 'completed')
    .get();

  const completedVideos = [];
  videoJobsSnap.forEach(d => completedVideos.push(d.data()));
  console.log(`Found ${lessonsSnap.size} lessons and ${completedVideos.length} completed videoJobs.`);

  let totalUpdatedLessons = 0;
  let totalUpdatedStudents = 0;

  for (const lDoc of lessonsSnap.docs) {
    const lData = lDoc.data();
    const lStart = lData.startTime?.toDate ? lData.startTime.toDate() : (lData.startTime ? new Date(lData.startTime) : null);
    const lEnd = lData.endTime?.toDate ? lData.endTime.toDate() : (lData.endTime ? new Date(lData.endTime) : null);

    if (!lStart || !lEnd || isNaN(lStart.getTime()) || isNaN(lEnd.getTime())) {
      console.log(`Skipping invalid lesson ${lDoc.id} (invalid times)`);
      continue;
    }

    const durationMinutes = Math.max(1, Math.round((lEnd - lStart) / 60000));
    const students = lData.students || {};
    const updatedStudents = { ...students };
    let lessonModified = false;

    for (const [uid, studentObj] of Object.entries(students)) {
      const workingMins = studentObj.workingMinutes || 0;
      const currentShared = studentObj.sharedScreenMinutes || 0;
      const hasAttendanceBits = Array.isArray(studentObj.attendance) && studentObj.attendance.includes(1);

      // Check if student has a completed videoJob matching this lesson window (+/- 30 mins)
      const matchedVideo = completedVideos.find(v => {
        if (v.studentUid !== uid && v.studentEmail?.toLowerCase() !== studentsMap[uid]?.toLowerCase()) return false;
        const vStart = v.startTime?.toDate ? v.startTime.toDate() : (v.startTime ? new Date(v.startTime) : null);
        return vStart && Math.abs(vStart.getTime() - lStart.getTime()) <= 30 * 60 * 1000;
      });

      // Screencasts are 1 fps from periodic screenshots.
      // 1 frame of video = captureInterval seconds of real-world activity.
      let videoCap = null;
      if (matchedVideo && typeof matchedVideo.duration === 'number' && matchedVideo.duration > 0) {
        const captureInterval = typeof matchedVideo.captureInterval === 'number'
          ? matchedVideo.captureInterval
          : classCaptureInterval;
        videoCap = Math.min(durationMinutes, Math.max(1, Math.round((matchedVideo.duration * captureInterval) / 60)));
      }

      // Check if attendance needs reconciliation:
      // 1. Missing attendance (currentShared === 0 || !hasAttendanceBits)
      // 2. Overstated attendance (videoCap !== null && (currentShared > videoCap || workingMins > videoCap))
      const isMissing = (currentShared === 0 || !hasAttendanceBits) && (workingMins > 0 || matchedVideo);
      const isOverstated = videoCap !== null && (currentShared > videoCap || workingMins > videoCap);

      if (isMissing || isOverstated) {
        const effectiveMins = videoCap !== null
          ? videoCap
          : Math.min(workingMins > 0 ? workingMins : durationMinutes, durationMinutes);

        const effectiveWorking = videoCap !== null && workingMins > 0
          ? Math.min(workingMins, videoCap)
          : workingMins;

        const bitmask = Array(durationMinutes).fill(0).map((_, i) => (i < effectiveMins ? 1 : 0));

        updatedStudents[uid] = {
          ...studentObj,
          sharedScreenMinutes: effectiveMins,
          attendance: bitmask,
          deductedMinutes: studentObj.deductedMinutes || 0,
          ...(effectiveWorking > 0 ? { workingMinutes: effectiveWorking } : {}),
        };

        lessonModified = true;
        totalUpdatedStudents++;
      }
    }

    if (lessonModified) {
      await lDoc.ref.set({
        students: updatedStudents
      }, { merge: true });
      totalUpdatedLessons++;
      console.log(`✅ Updated lesson ${lDoc.id} (${lStart.toISOString()} - ${lEnd.toISOString()}): recovered attendance for students.`);
    } else {
      console.log(`ℹ️ Lesson ${lDoc.id} already has complete attendance.`);
    }
  }

  console.log(`Class ${classId} reconciliation complete: ${totalUpdatedLessons} lessons and ${totalUpdatedStudents} student records updated.`);
}

async function main() {
  const classesSnap = await db.collection('classes').get();
  for (const cDoc of classesSnap.docs) {
    await reconcileClass(cDoc.id);
  }
}

main()
  .then(() => {
    console.log('\n🎉 Attendance reconciliation completed successfully!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error during reconciliation:', err);
    process.exit(1);
  });
