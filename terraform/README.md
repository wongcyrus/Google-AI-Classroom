# 🏗️ Terraform Infrastructure for Gemini AI Classroom Assistant

This directory contains the Infrastructure as Code (IaC) configuration to provision and configure all Google Cloud and Firebase resources automatically with **Zero UI Clicks**.

---

## 📋 What This Provisions Automatically

1. **APIs**: Enables all 15 required GCP/Firebase services (`cloudfunctions`, `cloudbuild`, `run`, `eventarc`, `pubsub`, `cloudscheduler`, `artifactregistry`, `firebasestorage`, `firestore`, `identitytoolkit`, etc.).
2. **Firestore**: Creates the `(default)` Firestore Native Database in your chosen region (default: `asia-east2`).
3. **Storage**: Provisions `gs://<project_id>.firebasestorage.app` and pre-creates the regional Functions v2 staging bucket to prevent deployment race conditions.
4. **Authentication**: Automatically enables Google Cloud Identity Platform (GCIP) and Email/Password sign-in.
5. **IAM Security Roles**: Binds all necessary Eventarc, PubSub, Cloud Run, and Storage Admin permissions.
6. **Config Generation**: Registers the Firebase Web App and automatically writes `web-app/.env` and `functions/config.js`.

---

## 🚀 Quickstart (1 Command)

From the project root:

```bash
# Usage: ./setup-new-project.sh <PROJECT_ID> [BILLING_ACCOUNT_ID]
./setup-new-project.sh my-new-classroom-2026 0116DD-30726C-E72885
```

This single command will:
1. Run Terraform to provision all cloud infrastructure and generate configuration files.
2. Build and deploy all 7 Cloud Function codebases, Firestore rules, Storage rules, and Hosting.

---

## 🛠️ Manual Terraform Commands

If you prefer to run Terraform manually:

```bash
cd terraform
terraform init
terraform apply -var="project_id=YOUR_PROJECT_ID" -var="billing_account=YOUR_BILLING_ID"
```
