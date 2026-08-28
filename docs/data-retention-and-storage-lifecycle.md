# 🔄 Data Retention & Storage Lifecycle Architecture

This document provides a comprehensive technical reference for the automated data retention, Firestore event triggers, Cloud Storage auto-cleanup, and daily time-budgeted sweepers in the AI Classroom Assistant.

---

## 🏛️ System Architecture Overview

```
                      ┌────────────────────────────────────────────────────────┐
                      │              Class Management UI                       │
                      │       Teacher configures: retentionDays (e.g. 14)      │
                      └───────────────────────────┬────────────────────────────┘
                                                  │
                                                  ▼
                        ┌──────────────────────────────────────────────────┐
                        │            Student Screenshot Ingestion          │
                        │   expireAt = timestamp + (retentionDays * 86.4M) │
                        └─────────────────────────┬────────────────────────┘
                                                  │
                ┌─────────────────────────────────┴─────────────────────────────────┐
                ▼                                                                   ▼
    ┌───────────────────────────────┐                               ┌───────────────────────────────┐
    │     Firestore TTL Engine      │                               │    Daily Sweeper Function     │
    │ (Auto-deletes docs at scale)  │                               │ (Bounded 8m batch safety net) │
    └───────────────┬───────────────┘                               └───────────────┬───────────────┘
                    │                                                               │
                    └───────────────────────────────┬───────────────────────────────┘
                                                    │ (Document Deleted Event)
                                                    ▼
                                    ┌───────────────────────────────┐
                                    │    ⚡ onScreenshotDocDeleted   │
                                    │   (Deletes physical GCS file) │
                                    └───────────────┬───────────────┘
                                                    │ (Storage Deleted Event)
                                                    ▼
                                    ┌───────────────────────────────┐
                                    │     ⚡ onObjectDeleted        │
                                    │  (Decrements class storage)   │
                                    └───────────────────────────────┘
```

---

## ⚙️ 1. Per-Class Dual Retention Configuration

### Data Model (`classes/{classId}`)
* **`retentionDays`** `(number)`: Specifies how many days **raw screenshots** are kept before recycling (e.g., 7, 14, 30, 60, 90, 180, 365 days).
* **`videoRetentionDays`** `(number)`: Specifies how many days **compiled lesson videos** (`.mp4`) are kept (e.g., 14, 30, 60, 90, 180, 365, 730 days).

### Ingestion Stamping
* **Screenshots (`StudentView.jsx`)**:
  $$\text{expireAt} = \text{new Date}(\text{Date.now}() + \text{retentionDays} \times 86,400,000\text{ ms})$$
* **Videos (`scheduledTasks.js` / `PlaybackView.jsx`)**:
  $$\text{expireAt} = \text{new Date}(\text{Date.now}() + \text{videoRetentionDays} \times 86,400,000\text{ ms})$$

---

## ⚡ 2. Event-Driven Deletion Triggers (`functions/storage_triggers/`)

### `onScreenshotDocDeleted`
* **Trigger**: `onDocumentDeleted('screenshots/{screenshotId}')`
* **Behavior**: Extracts `imagePath` and executes `storage.bucket().file(imagePath).delete({ ignoreNotFound: true })`.

### `onVideoJobDocDeleted`
* **Trigger**: `onDocumentDeleted('videoJobs/{jobId}')`
* **Behavior**: Extracts `videoPath` (e.g. `videos/{classId}/{outputVideoName}.mp4`) and automatically deletes the `.mp4` file from Cloud Storage.

### `onZipJobDocDeleted`
* **Trigger**: `onDocumentDeleted('zipJobs/{jobId}')`
* **Behavior**: Extracts `zipPath` (e.g. `zips/{classId}/{archiveName}.zip`) and automatically deletes the `.zip` archive from Cloud Storage.

### `onClassRetentionUpdated`
* **Trigger**: `onDocumentUpdated('classes/{classId}')`
* **Timeout**: 300 seconds | **Memory**: 512MiB
* **Behavior**:
  1. Detects changes to `retentionDays` or `videoRetentionDays`.
  2. Queries screenshots or videoJobs for `classId` in **500-item chunks**.
  3. Computes $\text{newExpireAt} = \text{doc.timestamp} + (\text{newDays} \times 86.4\text{M ms})$.
  4. If $\text{newExpireAt} \le \text{now}$: Deletes the document immediately (triggering storage deletion triggers).
  5. If $\text{newExpireAt} > \text{now}$: Updates `expireAt` with the new expiration date.

### `onClassDocDeleted`
* **Trigger**: `onDocumentDeleted('classes/{classId}')`
* **Behavior**:
  * Automatically cascades and purges all storage folders under `screenshots/{classId}/`, `videos/{classId}/`, and `zips/{classId}/`.

## ⚡ 3. Real-Time Autonomous TTL Lifecycle

Since all documents (`screenshots`, `videoJobs`, `zipJobs`) are timestamped with an exact `expireAt` at creation time:
1. **Firestore TTL** automatically deletes expired documents natively in the background without needing scheduled cron sweepers.
2. **Deletion Triggers** (`onScreenshotDocDeleted`, `onVideoJobDocDeleted`, `onZipJobDocDeleted`) immediately catch the document removals and purge physical files from Cloud Storage in real-time.
3. **No Scheduled Sweeper Overhead**: Eliminates scheduled function invocations, runtime timeouts, and polling queries.

---

## 📊 4. Storage Quota Auto-Adjustment (`storageQuota.js`)

* **Trigger**: `onObjectDeleted` (Cloud Storage Event)
* **Behavior**:
  * When an image blob is deleted (by `onScreenshotDocDeleted` or GCS Lifecycle), it detects the file path prefix (`screenshots/{classId}/...`).
  * Atomically decrements `classes/{classId}/metadata/storage`:
    ```javascript
    storageRef.update({
      storageUsage: FieldValue.increment(-fileSize),
      storageUsageScreenShots: FieldValue.increment(-fileSize)
    });
    ```
  * Keeps class quota metrics 100% accurate without manual re-indexing.

---

## 🛡️ Verification & Security Summary

| Feature | Protection Mechanism |
| :--- | :--- |
| **No Orphan Blobs** | Every Firestore delete event cascades to physical Cloud Storage deletion. |
| **No Function Timeouts** | Sweepers enforce an 8-minute runtime ceiling with 500-item chunking. |
| **No Client Secrets** | File deletion is handled securely by backend triggers without exposing Storage admin permissions to browser clients. |
| **Zero UI Lag** | UI deletions only touch Firestore; all storage deletions execute asynchronously in the background. |
