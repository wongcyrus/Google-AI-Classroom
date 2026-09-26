# Admin Scripts

[🏠 Back to Documentation Index](../README.md#documentation-index) | [🛠️ Admin Manual](../docs/user-manual-admin.md)

---

This directory contains scripts for administering the Google AI Classroom application's Firebase backend.

## Prerequisites

Before running any of these scripts, you need to complete the following steps:

1.  **Install Dependencies:** Navigate to this `admin` directory in your terminal and run:
    ```bash
    npm install
    ```

2.  **Firebase Service Account:**
    *   Download your Firebase service account key from your Firebase project settings (Project settings > Service accounts > Generate new private key).
    *   Rename the downloaded JSON file to `sp.json`.
    *   Place the `sp.json` file in this `admin` directory.

3.  **Environment Variables:** Some scripts may require environment variables to be set. These are typically loaded from the `web-app/.env` file. Ensure that this file is present and correctly configured.

## Scripts

All scripts are located in the `scripts` subdirectory and should be run from the `admin` directory.

## Scripts Catalog

All scripts are located in the `scripts` subdirectory and should be run from the repository root or the `admin` directory with `sp.json` service account configured.

### 1. Identity & User Management

*   **`scripts/grantTeacherRole.js`**
    *   **Purpose:** Assigns the `teacher` role custom claim in Firebase Authentication and performs atomic Firestore migration between `studentProfiles` and `teacherProfiles`.
    *   **Usage:**
        ```bash
        node scripts/grantTeacherRole.js
        ```
*   **`scripts/verifyUser.js`**
    *   **Purpose:** Manually marks target user accounts as email-verified in Firebase Authentication.
*   **`scripts/export_users.mjs`**
    *   **Purpose:** Exports all Firebase Authentication accounts, custom claims, and metadata to JSON/CSV for backup and institutional audit.
*   **`scripts/import_users.mjs`**
    *   **Purpose:** Bulk imports students and instructors from CSV into Firebase Authentication with deterministic claims and auto-linking.
*   **`scripts/findDuplicateUsers.cjs`**
    *   **Purpose:** Scans Firebase Authentication and Firestore profiles for duplicate emails, conflicting casing, or orphaned records.

### 2. Environment & System Data Seeding

*   **`scripts/seed_initial_data.mjs`**
    *   **Purpose:** Stage 3 automated provisioning script. Pre-seeds lead instructor (`teacher1@vtc.edu.hk`), demo students (`student1..5@stu.vtc.edu.hk`), and creates the 24/7 active demo class `IT114115-Demo`.
    *   **Usage:**
        ```bash
        node scripts/seed_initial_data.mjs
        ```
*   **`scripts/seed_prompts.cjs`**
    *   **Purpose:** Scans version-controlled prompt templates in `admin/prompts/` (across `images`, `videos`, `audios`, `translations`, `rubrics`) and seeds/updates Firestore system prompts with zero downtime.
*   **`scripts/seed_demo_class.js`**
    *   **Purpose:** Lightweight seeding utility for spinning up a single sandbox class.
*   **`scripts/generate_mock_data.js`**
    *   **Purpose:** Populates Firestore with synthetic screenshots, face angles, and telemetry for UI testing.
*   **`scripts/revert_mock_data.js`**
    *   **Purpose:** Cleans up synthetic documents created by `generate_mock_data.js`.

### 3. Migrations & Maintenance

*   **`scripts/migrate_class_schedules.mjs`**
    *   **Purpose:** Migrates legacy single-schedule classes to the multi-segment `scheduleHistory` array format, backing up original documents to `classes_schedule_backup.json`.
*   **`scripts/reset_environment.mjs`**
    *   **Purpose:** Cleanly resets development or sandbox environments while preserving administrative credentials and pricing configuration.
*   **`scripts/reset_app.js`**
    *   **Purpose:** Hard purge of all Firestore collections and Cloud Storage buckets.
    *   **WARNING:** Permanent data deletion. Only run in development sandboxes.

### 4. Verification & Testing

*   **`scripts/smoke_test.mjs`**
    *   **Purpose:** Level 4 end-to-end automated smoke testing suite (28 cloud assertions validating Auth, Firestore TTL, Cloud Functions triggers, and Storage quotas).
    *   **Usage:**
        ```bash
        npm run test:smoke
        ```
