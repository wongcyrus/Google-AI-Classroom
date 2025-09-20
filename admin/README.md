# Admin Scripts

This directory contains scripts for administering the AI Invigilator application's Firebase backend.

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

### User Management

*   **`scripts/grantTeacherRole.js`**
    *   **Purpose:** Assigns the 'teacher' role to one or more users in Firebase Authentication. Users with this role are granted access to the teacher-specific parts of the application.
    *   **Usage:**
        1.  Open the script and add the email addresses of the users you want to make teachers to the `emails` array.
        2.  Run the script:
            ```bash
            node scripts/grantTeacherRole.js
            ```

*   **`scripts/verifyUser.js`**
    *   **Purpose:** Manually marks a user's email as verified.
    *   **Usage:**
        1.  Open the script and add the email addresses of the users you want to verify to the `emails` array.
        2.  Run the script:
            ```bash
            node scripts/verifyUser.js
            ```

### Data Management

*   **`scripts/generate_mock_data.js`**
    *   **Purpose:** Populates your Firestore database with mock data for UI development and testing. This includes creating sample users, a class, progress records, and irregularities.
    *   **Usage:**
        ```bash
        node scripts/generate_mock_data.js
        ```

*   **`scripts/reset_app.js`**
    *   **Purpose:** Deletes all data from your Firestore collections and files from Firebase Storage. This is useful for starting with a clean slate.
    *   **WARNING:** This script will permanently delete data.
    *   **Usage:**
        ```bash
        node scripts/reset_app.js
        ```
