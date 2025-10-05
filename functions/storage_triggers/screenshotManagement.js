import './firebase.js';
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getApp } from "firebase-admin/app";

const db = getFirestore();
const storage = getStorage();
const app = getApp();

export const deleteScreenshotsByDateRange = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    );
  }

  const { classId, startDate, endDate } = request.data;

  if (!classId || !startDate || !endDate) {
    throw new HttpsError(
      "invalid-argument",
      "The function must be called with classId, startDate, and endDate."
    );
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  const screenshotsQuery = db
    .collection("screenshots")
    .where("classId", "==", classId)
    .where("timestamp", ">=", start)
    .where("timestamp", "<=", end);

  try {
    const snapshot = await screenshotsQuery.get();
    if (snapshot.empty) {
      return { status: "success", message: "No screenshots found in the specified range." };
    }

    // Delete in batches to avoid memory issues and batch limits
    const promises = [];
    let batch = db.batch();
    let count = 0;

    for (const doc of snapshot.docs) {
      const screenshotData = doc.data();
      const imageRef = storage.bucket().file(screenshotData.imagePath);
      promises.push(imageRef.delete().catch(err => console.error(`Failed to delete ${screenshotData.imagePath}:`, err)));
      batch.update(doc.ref, { imagePath: null, deleted: true });
      count++;

      if (count === 499) {
        promises.push(batch.commit());
        batch = db.batch();
        count = 0;
      }
    }

    if (count > 0) {
      promises.push(batch.commit());
    }

    await Promise.all(promises);

    return { status: "success", message: `Successfully deleted ${snapshot.size} screenshots.` };
  } catch (error) {
    console.error("Error deleting screenshots:", error);
    throw new HttpsError(
      "internal",
      "An error occurred while deleting screenshots."
    );
  }
});
