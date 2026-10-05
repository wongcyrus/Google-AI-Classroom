import { initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { getFirestore } from "firebase-admin/firestore";
import { ensureIndexedLectureVideo } from "../ai_flows/processLectureSubtitles.js";

initializeApp({
  projectId: "it114115-2627",
  storageBucket: "it114115-2627.firebasestorage.app",
});

const bucket = getStorage().bucket();
const db = getFirestore();

async function run() {
  console.log("=== SCANNING ALL LECTURE RECORDINGS FOR WEBMS WITHOUT CUES ===");
  const snapshot = await db.collectionGroup("lectureRecordings").get();
  console.log(`Found ${snapshot.size} total recording records in Firestore.`);

  let indexedCount = 0;
  let alreadyIndexedCount = 0;
  let skippedCount = 0;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const classId = docSnap.ref.parent.parent.id;
    const sessionId = docSnap.id;
    const storagePath =
      data.storagePath || `recordings/${classId}/${sessionId}/lecture.webm`;

    if (!storagePath.endsWith(".webm") || storagePath.includes("audio")) {
      skippedCount++;
      continue;
    }

    const videoFile = bucket.file(storagePath);
    const [exists] = await videoFile.exists();
    if (!exists) {
      skippedCount++;
      continue;
    }

    const [metadata] = await videoFile.getMetadata().catch(() => [{}]);
    if (metadata?.metadata?.hasCuesIndex === "true" && data.hasCuesIndex) {
      alreadyIndexedCount++;
      continue;
    }

    console.log(`\nProcessing: [${classId}] ${sessionId} -> ${storagePath}`);
    const t0 = Date.now();
    try {
      await ensureIndexedLectureVideo({
        bucket,
        classId,
        sessionId,
        videoStoragePath: storagePath,
        sessionRef: docSnap.ref,
      });
      console.log(`Indexed in ${Date.now() - t0}ms`);
      indexedCount++;
    } catch (err) {
      console.error(`Failed to index ${storagePath}:`, err.message);
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Successfully Indexed: ${indexedCount}`);
  console.log(`Already Indexed: ${alreadyIndexedCount}`);
  console.log(`Skipped / Non-WebM / Missing: ${skippedCount}`);
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
