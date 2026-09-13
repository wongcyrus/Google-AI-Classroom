# 👥 Demo Accounts & Development Sandbox Guide

[🏠 Documentation Index](../README.md#documentation-index) | [👨‍🏫 Teacher Manual](./user-manual-teacher.md) | [🧑‍🎓 Student Manual](./user-manual-student.md) | [🛠️ Admin Manual](./user-manual-admin.md) | [📘 UI Catalog](./comprehensive-ui-controls-and-features-catalog.md)

---

This reference details the pre-configured accounts, sandboxed testing class, and security safeguards available in the development environment ([`https://it114115-dev-2026.web.app`](https://it114115-dev-2026.web.app)) and local emulators.

---

## 📑 Table of Contents

1. [Overview & Sandbox Purpose](#overview--sandbox-purpose)
2. [Demo Accounts Directory](#demo-accounts-directory)
3. [Pre-Seeded Demo Class (IT114115-Demo)](#pre-seeded-demo-class-it114115-demo)
4. [Environment Isolation & Security Best Practices](#environment-isolation--security-best-practices)
5. [Re-seeding & Resetting Sandbox Data](#re-seeding--resetting-sandbox-data)

---

## Overview & Sandbox Purpose

To facilitate immediate hands-on evaluation, automated testing, and UI demonstration without requiring manual user registration or institutional domain verification, the development environment comes pre-seeded with:
- An active, 24/7 demo class (`IT114115-Demo`).
- Pre-enrolled teacher and student accounts with verified emails.
- Standard vision, audio, and video AI prompt templates pre-loaded into Firestore.

---

## Demo Accounts Directory

> [!TIP]
> **1-Click Copy**: Hover over the email boxes below and click the **📋 Copy** button in the top-right corner to copy the demo account emails directly into your clipboard.

### 👨‍🏫 Lead Teacher Account
```text
teacher1@vtc.edu.hk
```
* **Role**: Lead Instructor (`teacher` custom claim, `teacherProfiles` document).
* **Permissions**: Class creation, live invigilation, audio review, rubric synthesis, and incident dossier generation.

### 🧑‍🎓 Demo Student Accounts
```text
student1@stu.vtc.edu.hk
```
```text
student2@stu.vtc.edu.hk
```
```text
student3@stu.vtc.edu.hk
```
```text
student4@stu.vtc.edu.hk
```
```text
student5@stu.vtc.edu.hk
```
* **Role**: Enrolled Students (`student` custom claim, `studentProfiles` document).
* **Permissions**: Pre-flight readiness wizard, dual-channel screen & webcam streaming, interactive Bingo challenges, and self-service learning records portal.

### 🔑 Demo Account Password Configuration

Demo account passwords are set during environment seeding and can be customized via the `DEMO_PASSWORD` environment variable in your `.env` (configured in [`admin/scripts/seed_initial_data.mjs`](../admin/scripts/seed_initial_data.mjs)). For security best practices and compliance, shared default passwords are not openly published in public documentation.

---

### 📑 Complete Sandbox Accounts Directory

| Role | Email Address | Password Configuration | Enrolled / Assigned Class | Verification Status |
| :--- | :--- | :--- | :--- | :--- |
| **👨‍🏫 Lead Teacher** | `teacher1@vtc.edu.hk` | Set via seeding (`DEMO_PASSWORD`) | `IT114115-Demo` (Lead Instructor) | ✅ Verified (`emailVerified: true`) |
| **👨‍🏫 Co-Teacher** | `teacher2@vtc.edu.hk` | Set via seeding (`DEMO_PASSWORD`) | `IT114115-Demo` (Co-Instructor) | ✅ Verified (`emailVerified: true`) |
| **👨‍🏫 Co-Teacher** | `cywong@vtc.edu.hk` | *(Personal account)* | `IT114115-Demo` (Co-Instructor) | ✅ Verified (`emailVerified: true`) |
| **🧑‍🎓 Student 1** | `student1@stu.vtc.edu.hk` | Set via seeding (`DEMO_PASSWORD`) | `IT114115-Demo` (Student) | ✅ Verified (`emailVerified: true`) |
| **🧑‍🎓 Student 2** | `student2@stu.vtc.edu.hk` | Set via seeding (`DEMO_PASSWORD`) | `IT114115-Demo` (Student) | ✅ Verified (`emailVerified: true`) |
| **🧑‍🎓 Student 3** | `student3@stu.vtc.edu.hk` | Set via seeding (`DEMO_PASSWORD`) | `IT114115-Demo` (Student) | ✅ Verified (`emailVerified: true`) |
| **🧑‍🎓 Student 4** | `student4@stu.vtc.edu.hk` | Set via seeding (`DEMO_PASSWORD`) | `IT114115-Demo` (Student) | ✅ Verified (`emailVerified: true`) |
| **🧑‍🎓 Student 5** | `student5@stu.vtc.edu.hk` | Set via seeding (`DEMO_PASSWORD`) | `IT114115-Demo` (Student) | ✅ Verified (`emailVerified: true`) |

---

## Pre-Seeded Demo Class (`IT114115-Demo`)

The `IT114115-Demo` class is configured to ensure continuous evaluation availability without timetable friction:

- **Class ID:** `IT114115-Demo`
- **Class Name:** `IT114115 Demo Class`
- **AI Budget:** `$50.00 USD` (`aiQuota: 50`)
- **Default AI Invigilation Mode:** `hybrid` (`⚡ Client AI + Fallback`)
- **Schedule:** **24/7 Unrestricted** (`00:00 - 23:59`, Monday through Sunday). Screen capture, edge AI monitoring, and student view matching work at any hour of the day.
- **Assigned Teachers:** `teacher1@vtc.edu.hk`, `teacher2@vtc.edu.hk`, `cywong@vtc.edu.hk`.
- **Enrolled Students:** `student1@stu.vtc.edu.hk` through `student5@stu.vtc.edu.hk`.

---

## Environment Isolation & Security Best Practices

> [!CAUTION]
> **Production Protection**: Demo accounts and public seeding credentials must **NEVER** be deployed to or enabled in the production environment (`it114115-2627`).

1. **Hard Build-Time Validation**: Production builds executed via `npm run build:prod` verify that `VITE_PROJECT_ID === 'it114115-2627'` and reject development-only environment variables.
2. **Quota Bounds**: The demo class operates with a strict $50 quota ceiling to prevent unintended Gemini token consumption.
3. **Data Sandboxing**: All demo data is scoped strictly to the `IT114115-Demo` document tree.

---

## Re-seeding & Resetting Sandbox Data

To reset all student progress, delete temporary screencasts, and restore initial seed state:

```bash
# 1. Reset database and Storage while retaining demo user accounts
npm run reset:env

# 2. Re-seed default prompt templates and demo class structure
node admin/scripts/seed_prompts.cjs
node admin/scripts/seed_demo_class.js

# 3. Complete clean-slate re-initialization (including Auth accounts)
node admin/scripts/reset_environment.mjs it114115-dev-2026 --delete-users
node admin/scripts/seed_initial_data.mjs
```

---

[← Back to Documentation Index](../README.md#documentation-index)
