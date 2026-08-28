# Deployment & Infrastructure Guide

This document provides a comprehensive overview of the automated infrastructure provisioning, multi-codebase deployment pipeline, and environment management workflows for the **Gemini AI Classroom Assistant**.

---

## 🏗️ Architecture & Technology Stack

The project employs a 3-stage automated provisioning, deployment, and data seeding architecture:

```
┌────────────────────────────────────────────────────────────────────────┐
│  STAGE 1: 100% Terraform (Cloud Infrastructure as Code)               │
├────────────────────────────────────────────────────────────────────────┤
│  • Google Cloud Project Creation & Billing Account Linkage             │
│  • 16 Google Cloud APIs Activation                                     │
│  • Cloud Firestore Native Database (asia-east2)                        │
│  • Cloud Storage Bucket & Custom CORS Configuration                    │
│  • IAM Roles & Service Agent Token Permissions                         │
│  • Identity Platform Configuration (Email/Password Auth)               │
│  • Auto-generation of web-app/.env and functions/config.js             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  STAGE 2: Firebase CLI / deploy.sh (Application & Functions Runtime)   │
├────────────────────────────────────────────────────────────────────────┤
│  • 14 Cloud Functions Gen 2 across 7 isolated codebases                │
│  • Genkit AI Flow integration with @genkit-ai/google-genai             │
│  • Firestore Security Rules & Composite Indexes (18 indexes)           │
│  • Cloud Storage Security Rules                                        │
│  • Vite + React Frontend Build & Firebase Hosting Release              │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  STAGE 3: Automated Demo Seeding (admin/scripts/seed_initial_data.mjs) │
├────────────────────────────────────────────────────────────────────────┤
│  • Auto-provisioning of Demo Teacher & Student Accounts                │
│  • 24/7 Active Class (IT114115-Demo) Creation and User Enrolment       │
│  • Automatic Seeding of 13 AI System Prompts                           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Creating a New Environment (Zero UI Clicks)

To provision a brand-new GCP/Firebase project from scratch with all APIs, database, storage, IAM, functions, hosting, and seeded demo accounts in a single command:

```bash
./setup-new-project.sh <PROJECT_ID> [BILLING_ACCOUNT_ID]
```

### Example:
```bash
./setup-new-project.sh it114115-dev-2026 01C74C-667DFE-538DBC
```

### What `setup-new-project.sh` executes:
1. **Terraform Apply (`terraform/`)**:
   - Initializes Terraform with isolated per-project state (`${PROJECT_ID}.tfstate`).
   - Provisions all cloud resources.
   - Generates project-specific `web-app/.env` and `functions/config.js`.
2. **Firebase Context Switch**:
   - Sets `firebase use <PROJECT_ID>`.
3. **Application & Functions Deployment (`deploy.sh`)**:
   - Builds frontend React application.
   - Deploys Firestore and Storage security rules and composite indexes.
   - Deploys all 14 Cloud Functions across the 7 isolated codebases with automatic Day-0 failure recovery.
   - Releases static assets to Firebase Hosting.
4. **Initial Data Seeding (`admin/scripts/seed_initial_data.mjs`)**:
   - Provisions verified demo accounts.
   - Configures `IT114115-Demo` class with 24/7 schedule.
   - Seeds all AI prompts.

---

## 👥 Default Seeded Accounts & Demo Class

When a project is deployed or seeded via `node admin/scripts/seed_initial_data.mjs`, the following assets are ready immediately:

| Role | Email | Default Password | Verification Status |
| :--- | :--- | :--- | :--- |
| **Teacher** | `cywong@vtc.edu.hk` | `Password123!` | ✅ Pre-verified (`emailVerified: true`) |
| **Student** | `t-cywong@stu.vtc.edu.hk` | `Password123!` | ✅ Pre-verified (`emailVerified: true`) |

### Pre-enrolled Demo Class:
- **Class ID:** `IT114115-Demo`
- **Class Name:** `IT114115 Demo Class`
- **Schedule:** 24/7 (`00:00 - 23:59`, Monday through Sunday) so screen capturing and testing work anytime.

---

## 🔄 Switching Between Environments (Dev vs Prod)

Each deployed environment maintains its own isolated Terraform state and Firebase configuration.

### Deploying Changes to Production:
```bash
# 1. Switch active Firebase project to Prod
firebase use it114115-2627

# 2. Deploy updates
./deploy.sh
```

### Deploying Changes to Development:
```bash
# 1. Switch active Firebase project to Dev
firebase use it114115-dev-2026

# 2. Deploy updates
./deploy.sh
```

### Checking Currently Active Project:
```bash
firebase use
```

---

## ✉️ Email Delivery & Custom SMTP Configuration

Because `@vtc.edu.hk` and `@stu.vtc.edu.hk` are hosted on **Microsoft 365 Exchange Online**, Microsoft's email gateway may reject unauthenticated messages from newly created `*.firebaseapp.com` subdomains.

### Configuring Gmail SMTP Relay for 100% Inbox Delivery:
1. Generate an **App Password** from your Google Account: [Google Account > Security > App Passwords](https://myaccount.google.com/apppasswords).
2. Open [Firebase Console > Authentication > Templates](https://console.firebase.google.com).
3. Click the **Edit (pencil)** icon on any email template and configure **SMTP Configuration**:
   - **Sender email:** `it114115@vtc.edu.hk` *(Must match the Google account)*
   - **Username:** `it114115@vtc.edu.hk`
   - **Password:** *(16-character Google App Password)*
   - **Host:** `smtp.gmail.com`
   - **Port:** `465`
   - **Security:** `SSL`
4. Click **Save**.

### Instant Admin CLI Verification (No Email Wait Needed):
```bash
# Instantly verify any email address:
GOOGLE_CLOUD_PROJECT=<PROJECT_ID> node admin/scripts/verifyUser.js <user_email>

# Grant teacher role:
GOOGLE_CLOUD_PROJECT=<PROJECT_ID> node admin/scripts/grantTeacherRole.js <user_email>

# Reseed or reset initial demo data:
GOOGLE_CLOUD_PROJECT=<PROJECT_ID> node admin/scripts/seed_initial_data.mjs
```

---

## 🧩 Multi-Codebase Cloud Functions Architecture

To ensure high availability, prevent circular dependencies, and isolate build failures, Cloud Functions are divided into **7 isolated codebases** in [`firebase.json`](../firebase.json):

| Codebase Directory | Functions | Triggers / Purpose |
| :--- | :--- | :--- |
| **`functions/ai_flows/`** | `analyzeImage`, `analyzeAllImages`, `onAiJobCreated`, `processVideoAnalysisJob`, `triggerAutomaticAnalysis`, `retryVideoAnalysisJob`, `aggregatePerformanceMetrics` | Genkit Gemini AI analysis flows & performance aggregations |
| **`functions/media_processing/`** | `processVideoJob`, `processZipJob`, `cleanupStuckJobs` | Video compilation & ZIP extraction pipelines |
| **`functions/auth_triggers/`** | `beforeusercreated`, `checkipaddress`, `onClassUpdate` | Auth blocking triggers & user class role sync |
| **`functions/storage_triggers/`** | `updateStorageUsageOnUpload`, `updateStorageUsageOnDelete`, `deleteScreenshotsByDateRange` | Storage quota tracking & cleanup |
| **`functions/scheduled_tasks/`** | `handleAutomaticCapture`, `handleAutomaticVideoCombination` | Automated interval captures and video merges |
| **`functions/property_processing/`** | `processPropertyUpload` | Asset property validation |
| **`functions/attendance/`** | `getAttendanceData` | Attendance reporting endpoint |

---

## 🤖 Genkit AI Modern Integration

The AI engine uses Google's latest **`@genkit-ai/google-genai`** SDK (migrated from the deprecated `@genkit-ai/vertexai`):

- **Model:** `gemini-2.5-flash`
- **Location:** `asia-east2`
- **Configuration File:** [`functions/ai_flows/ai.js`](../functions/ai_flows/ai.js)

```javascript
import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';
import { enableFirebaseTelemetry } from '@genkit-ai/firebase';

enableFirebaseTelemetry();

export const ai = genkit({
  plugins: [
    vertexAI({
      projectId: process.env.GCLOUD_PROJECT,
      location: process.env.GCLOUD_LOCATION || 'asia-east2',
    }),
  ],
  model: vertexAI.model('gemini-2.5-flash'),
});
```

---

## 🛡️ Self-Healing & Resilience Features in `deploy.sh`

On brand-new projects (Day 0), Google Cloud Build enforces strict concurrency limits when compiling 14 functions simultaneously. [`deploy.sh`](../deploy.sh) includes built-in automated self-healing:

1. **Pre-warm Step:** Deploys a lightweight function first to initialize the Cloud Functions upload bucket without parallel collision.
2. **Transient Failure Cleanup:** Automatically discovers and removes any transient `FAILED` placeholders before redeployment.
3. **Automatic Second-Pass Retry:** If GCP hits a parallel build ceiling on the first run, the script automatically retries; Firebase skips the already-deployed functions and cleanly finalizes the remaining functions with 0 manual intervention.
