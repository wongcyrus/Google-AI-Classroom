# Complete Setup & Customization Guide

This guide provides end-to-end instructions for deploying, customizing, and running the **Gemini AI Classroom Assistant** for any school, university, or educational institution.

---

## 📋 Table of Contents

1. [Prerequisites & Tools](#1-prerequisites--tools)
2. [Option A: Automated Setup (Recommended — Zero UI Clicks)](#2-option-a-automated-setup-recommended--zero-ui-clicks)
3. [Option B: Manual Setup for Pre-existing Projects](#3-option-b-manual-setup-for-pre-existing-projects)
4. [🏫 Multi-School & Domain Customization](#4--multi-school--domain-customization)
5. [👨‍🏫 First-Time Admin & Teacher Account Onboarding](#5--first-time-admin--teacher-account-onboarding)
6. [💻 Local Development Environment](#6--local-development-environment)
7. [🧪 Verification & Testing Playbook](#7--verification--testing-playbook)
8. [❓ Troubleshooting & Day-0 Gotchas](#8--troubleshooting--day-0-gotchas)

---

## 1. Prerequisites & Tools

Ensure the following tools are installed on your workstation or deployment server:

| Tool | Minimum Version | Installation / Verification |
| :--- | :--- | :--- |
| **Node.js** | `>= 20.0.0` | `node -v` |
| **npm** | `>= 10.0.0` | `npm -v` |
| **Git** | Any modern version | `git --version` |
| **Google Cloud SDK (`gcloud`)** | Latest | `gcloud version` — [Install Guide](https://cloud.google.com/sdk/docs/install) |
| **Firebase CLI** | `>= 13.0.0` | `npm install -g firebase-tools` |
| **Terraform** | `>= 1.5.0` | `terraform version` — [Install Guide](https://developer.hashicorp.com/terraform/install) |

### Cloud Permissions Required:
- A **Google Cloud Account** with an active **Billing Account ID** (format: `XXXXXX-XXXXXX-XXXXXX`).
- IAM privileges to create projects or modify existing projects (`Owner` or `Project Creator` + `Billing User`).

---

## 2. Option A: Automated Setup (Recommended — Zero UI Clicks)

The fastest and most reliable way to set up a brand-new, production-ready environment is using the automated Infrastructure-as-Code provisioning script.

### Step 1: Authenticate Cloud CLIs
```bash
# Authenticate Google Cloud with your admin account
gcloud auth login
gcloud auth application-default login

# Authenticate Firebase CLI
firebase login
```

### Step 2: Run Automated Provisioning
```bash
./setup-new-project.sh <PROJECT_ID> [BILLING_ACCOUNT_ID]
```

**Example:**
```bash
./setup-new-project.sh my-school-assistant-2026 01C74C-667DFE-538DBC
```

### What `setup-new-project.sh` executes automatically:
1. **Terraform Apply (`terraform/`)**:
   - Creates the Google Cloud Project and binds it to your billing account.
   - Enables all 17 required GCP & Firebase APIs (`cloudfunctions`, `cloudbuild`, `run`, `eventarc`, `pubsub`, `cloudscheduler`, `artifactregistry`, `firebasestorage`, `firestore`, `identitytoolkit`, etc.).
   - Provisions Firestore Native database in `asia-east2` (or your configured region).
   - Provisions Cloud Storage buckets with pre-configured CORS rules.
   - Enables Google Cloud Identity Platform (GCIP) with Email/Password authentication.
   - Configures IAM service agents and roles (`roles/eventarc.eventReceiver`, `roles/run.invoker`, `roles/storage.admin`).
   - Automatically writes `web-app/.env` and `functions/config.js`.
2. **Multi-Codebase Functions & Hosting Deployment (`deploy.sh`)**:
   - Builds the React frontend application.
   - Deploys Firestore composite indexes and security rules.
   - Deploys Cloud Storage security rules.
   - Deploys all 14 Cloud Functions across 7 isolated codebases with Day-0 build retry handling.
   - Deploys static assets to Firebase Hosting.
3. **Data Seeding (`admin/scripts/seed_initial_data.mjs`)**:
   - Restores default Gemini AI system prompts, audio rate matrices, and sample classes.

---

## 3. Option B: Manual Setup for Pre-existing Projects

If your institution requires using a pre-existing Google Cloud project or restricts automated project creation:

### Step 1: Enable Required APIs
```bash
PROJECT_ID="your-project-id"
gcloud config set project "$PROJECT_ID"

gcloud services enable \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  eventarc.googleapis.com \
  pubsub.googleapis.com \
  cloudscheduler.googleapis.com \
  artifactregistry.googleapis.com \
  firebasestorage.googleapis.com \
  firestore.googleapis.com \
  identitytoolkit.googleapis.com \
  aiplatform.googleapis.com
```

### Step 2: Configure Firebase Services
1. Go to [Firebase Console](https://console.firebase.google.com/) and click **Add Project** -> select your existing GCP project.
2. **Authentication**: Enable **Identity Platform** and add the **Email/Password** sign-in provider.
3. **Firestore**: Create a Firestore Native Database in your desired region (e.g. `asia-east2`).
4. **Storage**: Enable Cloud Storage. Apply CORS rules:
   ```bash
   gsutil cors set cors.json gs://<PROJECT_ID>.firebasestorage.app
   ```

### Step 3: Configure Environment Files
1. Copy template to `web-app/.env`:
   ```bash
   cp web-app/.env.example web-app/.env
   ```
2. Populate the Firebase Web App credentials obtained from **Project Settings > General > Your Apps > Web App**.
3. Generate centralized Cloud Functions configuration:
   ```bash
   ./switch-env.sh "$PROJECT_ID"
   ```

### Step 4: Deploy Rules, Codebases & Hosting
```bash
./deploy.sh
```

---

## 4. 🏫 Multi-School & Domain Customization

The system is completely domain-agnostic and uses dynamic domain configuration to separate **teachers** from **students**.

### 1. Configure Frontend Domains (`web-app/.env`)
Edit `web-app/.env` with your institution's email suffixes:
```env
# Comma-separated domains for instructors
VITE_TEACHER_DOMAINS="school.edu,cs.school.edu"

# Comma-separated domains for students
VITE_STUDENT_DOMAINS="students.school.edu,alumni.school.edu"

# Display name for login dialogs & error messages
VITE_INSTITUTION_NAME="My University"
```

### 2. Configure Backend Cloud Functions (`functions/config.js`)
Set the environment variables in your deployment environment or update [`functions/config.js`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/functions/config.js):
```env
TEACHER_EMAIL_DOMAINS="school.edu,cs.school.edu"
STUDENT_EMAIL_DOMAINS="students.school.edu,alumni.school.edu"
```

### Domain Evaluation Architecture:
- **Subdomain Priority**: Student domains are evaluated before teacher domains. For instance, if teachers use `@school.edu` and students use `@students.school.edu`, students are correctly assigned the `student` role rather than the parent domain's `teacher` role.
- **Security Rules Isolation**: Both `firestore.rules` and `storage.rules` use pure role claims (`request.auth.token.role == 'teacher'`), eliminating hardcoded email strings.

---

## 5. 👨‍🏫 First-Time Admin & Teacher Account Onboarding

Once deployed, you need to grant the `teacher` custom claim to your instructors:

### Grant Teacher Role via CLI:
```bash
# Usage: node admin/scripts/grantTeacherRole.js <email1> [email2] ...
GOOGLE_CLOUD_PROJECT="your-project-id" node admin/scripts/grantTeacherRole.js professor@school.edu dean@school.edu
```

> [!NOTE]
> If the user account does not exist in Firebase Authentication yet, the script automatically creates the account, verifies their email address, sets a temporary password (`IT114115` or custom `DEMO_PASSWORD`), and assigns `{ role: 'teacher' }`.

---

## 6. 💻 Local Development Environment

To run the platform locally against your Firebase project:

```bash
# 1. Install root dependencies
npm install

# 2. Synchronize config to function codebases
for d in functions/*/ ; do cp functions/config.js "$d/config.js"; done

# 3. Start React Vite local development server
cd web-app
npm install
npm run dev
```

The app will start at `http://localhost:5173`. You can log in with your configured instructor or student account.

> [!IMPORTANT]
> **Google Chrome Enforcement**: Students are strictly required to use Google Chrome on desktop for full Web Worker, LiteRT Whisper/Gemma STT, and screen-sharing API support. Instructors may use any modern browser.

---

## 7. 🧪 Verification & Testing Playbook

Run the automated test suites to ensure your setup is fully functional:

```bash
# 1. Run all tests across the repository
npm test

# 2. Run React frontend unit tests (609 tests across 88 suites)
npm run test:frontend

# 3. Run Cloud Functions tests (100 tests across 6 codebases)
npm run test:functions

# 4. Run real-token Firestore security rules verification
npm run test:security

# 5. Run end-to-end cloud pipeline smoke tests
npm run test:smoke
```

---

## 8. ❓ Troubleshooting & Day-0 Gotchas

### Issue 1: "Quota exceeded for Cloud Build" on initial deployment
- **Cause**: Google Cloud limits concurrent builds on brand-new billing accounts.
- **Solution**: [`deploy.sh`](file:///home/developer/Documents/Gemini-AI-Classroom-Assistant/deploy.sh) has built-in automated retry. Simply re-run `./deploy.sh`. Firebase will resume where it left off.

### Issue 2: Student registration rejected with "Only emails ending with..."
- **Cause**: The email does not match `VITE_STUDENT_DOMAINS` or `VITE_TEACHER_DOMAINS`.
- **Solution**: Check `web-app/.env` and ensure the exact domain is listed without leading `@` symbols (e.g. `VITE_STUDENT_DOMAINS="students.school.edu"`).

### Issue 3: Screen capture / microphone permission issues
- **Cause**: Browser permissions blocked or non-HTTPS origin.
- **Solution**: WebRTC screen capture and audio APIs require either `https://` or `http://localhost`. Ensure your domain is served over HTTPS or use the Firebase Hosting default domain (`https://<project-id>.web.app`).
