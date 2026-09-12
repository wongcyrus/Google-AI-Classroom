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

The platform is 100% domain-agnostic and uses an integrated **Hybrid Role Resolution Architecture** to distinguish **instructors** from **students**.

> [!NOTE]
> For a deep-dive into the underlying architecture, GCIP blocking lifecycle, FinOps cost protections, and Firestore profile migration, see the dedicated [Hybrid Role Resolution & Identity Architecture](./hybrid-role-resolution-and-auth.md) document.

---

### Configuration Recipes

Select the scenario matching your institution's email domain setup:

#### Recipe 1: Dedicated Subdomains (e.g. VTC, Universities)
*Students use a distinct subdomain (`@stu.school.edu`), faculty use the parent domain (`@school.edu`).*

```env
# web-app/.env
VITE_TEACHER_DOMAINS="school.edu,cs.school.edu"
VITE_STUDENT_DOMAINS="stu.school.edu,alumni.school.edu"
VITE_INSTITUTION_NAME="My University"
```
*How it works*: Subdomain priority ensures `@stu.school.edu` matches the student rule first without erroneously falling into the parent `@school.edu` teacher domain.

---

#### Recipe 2: Same Domain with Student ID Regex (Seamless Auto-Detection)
*Both students and faculty use the exact same root domain (`@school.edu`), but student IDs follow a predictable pattern (e.g. 8 digits or starting with 's').*

```env
# web-app/.env
VITE_TEACHER_DOMAINS="school.edu"
VITE_STUDENT_DOMAINS="school.edu"
VITE_INSTITUTION_NAME="My College"

# Student ID pattern: 8 digits (e.g. 20261234) or 's' + 7 digits (e.g. s1234567)
VITE_STUDENT_USERNAME_REGEX="^[0-9]{8}$|^s[0-9]{7}$"

# Optional: Teacher name pattern (e.g. firstname.lastname)
VITE_TEACHER_USERNAME_REGEX="^[a-zA-Z]+\\.[a-zA-Z]+$"

# Zero-trust fallback: ambiguous accounts safely default to student
VITE_DEFAULT_TO_STUDENT="true"
```
*How it works*: On same-domain signups, the username is tested against regex rules. Students are classified automatically with zero extra clicks.

---

#### Recipe 3: Same Domain Zero-Trust (Strict Access Control)
*Both use `@school.edu`, but email formats are unstructured or indistinguishable.*

```env
# web-app/.env
VITE_TEACHER_DOMAINS="school.edu"
VITE_STUDENT_DOMAINS="school.edu"
VITE_DEFAULT_TO_STUDENT="true"
```
*How it works*:
1. Any self-registered user receives `{ role: 'student' }`, completely safeguarding Gemini AI quotas.
2. Instructors are elevated through either:
   - **Class Pre-Enrollment**: When an existing teacher adds their email to any class's `teacherEmails`, their next sign-in automatically promotes them.
   - **Admin CLI Script**: Admin runs `node admin/scripts/grantTeacherRole.js <email>`.

---

#### Recipe 4: Open / Any Domain with Regex Disambiguation (Workshops, MOOCs)
*Students and instructors register using arbitrary personal or corporate email addresses.*

```env
# web-app/.env
VITE_TEACHER_DOMAINS="*"
VITE_STUDENT_DOMAINS="*"
VITE_STUDENT_USERNAME_REGEX="^stu_|^student_"
VITE_TEACHER_USERNAME_REGEX="^prof_|^instructor_"
VITE_DEFAULT_TO_STUDENT="true"
```
*How it works*: Anyone can register; usernames matching teacher patterns receive the `teacher` role, while others default to `student`.

---

### Applying Domain Configurations Across All Codebases

After updating `web-app/.env`, propagate the settings to all 7 Cloud Function codebases and Terraform:

```bash
# 1. Synchronize to all Cloud Functions (automatically generates functions/config.js in all 7 directories)
./switch-env.sh dev

# 2. (Optional) Run automated tests to verify the new domain rules
npm --prefix web-app test src/utils/domainConfig.test.js
npm --prefix functions/auth_triggers test

# 3. Deploy configuration to production
./deploy.sh
```

---

## 5. 👨‍🏫 First-Time Admin & Teacher Account Onboarding

Once deployed, grant the `teacher` role to instructors using the administrative CLI tool:

### Usage:
```bash
GOOGLE_CLOUD_PROJECT="<PROJECT_ID>" node admin/scripts/grantTeacherRole.js <email1> [email2] ...
```

**Example:**
```bash
GOOGLE_CLOUD_PROJECT="it114115-dev-2026" node admin/scripts/grantTeacherRole.js professor@school.edu dean@school.edu
```

### What the Admin Script Executes Automatically:
1. **Account Existence Check**: If the email does not exist in Firebase Auth yet, it automatically creates the account with email verified and a default password (`IT114115` or `DEMO_PASSWORD` env variable).
2. **Custom Claims Assignment**: Calls `auth.setCustomUserClaims(uid, { role: 'teacher' })`.
3. **Two-Phase Profile Migration**:
   - If the user had previously signed up as a student, it migrates their profile data from `studentProfiles/${uid}` to `teacherProfiles/${uid}`, preserves enrolled class IDs, sets `migratedFromStudent: true`, and deletes the old `studentProfiles` document.
   - If it is a fresh account, it initializes a clean `teacherProfiles/${uid}` document.

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
