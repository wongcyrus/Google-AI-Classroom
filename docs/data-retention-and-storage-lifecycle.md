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

## ⚙️ 1. Per-Class Retention Configuration

### Data Model (`classes/{classId}`)
* **`retentionDays`** `(number)`: Specifies how many days screenshots are kept before recycling.
* Supported Presets:
  * `7 Days` (Short Workshop / Intensive)
  * `14 Days` (Standard Two-Week Window)
  * `30 Days` (1 Month - Default)
  * `60 Days` (2 Months)
  * `90 Days` (1 Academic Semester)
  * `180 Days` (Half Year)
  * `365 Days` (1 Full Year)

### Ingestion Stamping (`StudentView.jsx`)
When a student's screen is captured and uploaded:
1. The client subscribes to the class configuration (`classes/{classId}`).
2. Calculates `expireAt`:
   $$\text{expireAt} = \text{new Date}(\text{Date.now}() + \text{retentionDays} \times 86,400,000\text{ ms})$$
3. Saves `expireAt` directly into the `screenshots` metadata document in Firestore.

---

## ⚡ 2. Event-Driven Deletion Triggers (`functions/storage_triggers/`)

### `onScreenshotDocDeleted`
* **Trigger**: `onDocumentDeleted('screenshots/{screenshotId}')`
* **Execution Region**: `FUNCTION_REGION` (`us-central1` / `asia-east2`)
* **Behavior**:
  1. Extracts `imagePath` from `event.data.data()`.
  2. Executes `storage.bucket().file(imagePath).delete({ ignoreNotFound: true })`.
  3. Guarantees that whether a document is deleted via:
     * Manual teacher UI click
     * Automatic Firestore TTL
     * Daily Sweeper function
     * Admin batch script
     The physical image file is **instantly purged from Cloud Storage**, eliminating orphan blobs.

### `onClassRetentionUpdated`
* **Trigger**: `onDocumentUpdated('classes/{classId}')`
* **Timeout**: 300 seconds | **Memory**: 512MiB
* **Behavior**:
  1. Detects changes: `before.retentionDays !== after.retentionDays`.
  2. Queries all screenshots belonging to `classId` in **500-item chunks**.
  3. Computes: $\text{newExpireAt} = \text{doc.timestamp} + (\text{newDays} \times 86.4\text{M ms})$.
  4. If $\text{newExpireAt} \le \text{now}$: Deletes the document immediately (triggering `onScreenshotDocDeleted` to free up storage).
  5. If $\text{newExpireAt} > \text{now}$: Updates `expireAt` with the new expiration date.

### `onClassDocDeleted`
* **Trigger**: `onDocumentDeleted('classes/{classId}')`
* **Behavior**:
  * Automatically cascades and purges all storage folders under `screenshots/{classId}/`, `videos/{classId}/`, and `zips/{classId}/`.

---

## 🧹 3. Time-Budgeted Daily Sweeper (`functions/scheduled_tasks/`)

### `handleDailyDataCleanup`
* **Schedule**: `0 2 * * *` (Daily at 02:00 AM UTC)
* **Timeout Limit**: `timeoutSeconds: 540` (9 minutes - Gen 2 max)
* **Internal Runtime Budget (`MAX_RUNTIME_MS`)**: `480,000 ms` (8 minutes)

### Why the 8-Minute Safety Budget is Critical:
* **Prevents Hard Container SIGKILL**: If a function runs up to the strict 540s cutoff, Google Cloud forcefully kills the container, leaving open transactions in an uncertain state and emitting false `TIMEOUT` alerts.
* **Graceful Exit (60s buffer)**: At 8 minutes, the sweeper cleanly commits any active 500-item batch, logs performance metrics, and exits with `200 OK`. Any leftover backlog is picked up in the next scheduled cycle.

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
