# 🧪 Testing Strategy, Quality Assurance & Coverage

This document outlines the testing architecture, test suites, execution commands, and coverage targets for the **Gemini AI Classroom Assistant**.

---

## 🏛️ Multi-Tier Testing Pyramid

The project uses a four-tier automated testing pyramid designed to ensure bulletproof reliability across client and cloud components:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Level 4: Live E2E & Smoke Suite (it114115-dev-2026 / Local Emulator)  │
│ - End-to-End Class Lifecycle & TTL Stamping                            │
│ - Cascading Deletion Verification (No Orphaned Records)                │
├────────────────────────────────────────────────────────────────────────┤
│ Level 3: Security Rules Verification (@firebase/rules-unit-testing)    │
│ - Student vs Teacher vs Anonymous Data Isolation                       │
│ - Prevention of Student Tampering & Private Media Leakage              │
├────────────────────────────────────────────────────────────────────────┤
│ Level 2: Backend Cloud Functions Logic Tests (Vitest + V8 Coverage)    │
│ - AI Genkit Cost Calculations & Quota Overdraft Prevention             │
│ - Screencast Even-Dimension Math & FFmpeg Parameter Builders           │
├────────────────────────────────────────────────────────────────────────┤
│ Level 1: Frontend React Component & Unit Tests (Vitest + JSDOM)        │
│ - Geometric Canvas Downscaling (4K -> 1080p Cap)                       │
│ - ControlsPanel, StudentScreen, Banner Component State Transitions     │
│ - Timezone Formatters & Micro-Cent AI Cost Display                     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Test Execution Commands

| Command | Target Suite | Description |
| :--- | :--- | :--- |
| `npm test` | **All Suites** | Runs Frontend Unit Tests + Backend Functions Tests + Live System Smoke Tests in sequence. |
| `npm run test:coverage` | **Full Coverage Suite** | Runs all unit and component suites with **V8 Code Coverage** enabled and outputs line-by-line coverage reports. |
| `npm run test:frontend` | `web-app` | Executes React component and utility unit tests (`vitest run`). |
| `npm run test:functions` | `functions/*` | Executes backend logic unit tests across `ai_flows` and `media_processing`. |
| `npm run test:smoke` | Live / Staging Cloud | Executes end-to-end smoke verification script against the active Firebase project (`admin/scripts/smoke_test.mjs`). |

---

## 🔬 Test Suite Breakdown

### 1. Frontend Component & Unit Suite (`web-app/src/`)
* **Framework**: `vitest` + `@testing-library/react` + `@testing-library/jest-dom` + `jsdom`.
* **Covered Modules**:
  * `web-app/src/utils/imageUtils.test.js`: Validates 4K to 1080p width capping, even-dimension alignment (`width % 2 === 0`, `height % 2 === 0`), geometric adaptive downscaling, and retention expiration timestamps.
  * `web-app/src/utils/formatters.test.js`: Validates byte conversion and micro-cent AI pricing formats (`$0.0042`).
  * `web-app/src/components/monitor/ControlsPanel.test.jsx`: Tests broadcast messaging, chip quick-actions, frame rate/size selectors, and start/stop capture toggles.
  * `web-app/src/components/StudentView.test.jsx`: Tests student stream controls, multi-camera device enumeration, conditional camera selector dropdown rendering, and live camera switching.
  * `web-app/src/components/StudentScreen.test.jsx`: Tests student grid states (`Not Sharing`, `Connecting...`, live screenshot display).
  * `web-app/src/components/Banner.test.jsx`: Tests notification visibility and close event handling.

### 2. Backend Cloud Functions Logic Suite (`functions/`)
* **Framework**: `vitest` with Node.js 22 runtime.
* **Covered Modules**:
  * `functions/ai_flows/cost.test.js`: Verifies exact token-to-USD pricing equations for Gemini 3.7 Flash input/output tokens and multimodal media inputs.
  * `functions/media_processing/videoEncoding.test.js`: Verifies FFmpeg output options, 1 FPS screencast timelapses, and text banner overlay string construction.

### 3. Live System Smoke & Cascade Suite (`admin/scripts/smoke_test.mjs`)
* **Framework**: Node.js + Firebase Admin SDK.
* **Tested Scenarios**:
  * **Test 1**: Class creation with dual retention parameters (`retentionDays: 14`, `videoRetentionDays: 60`).
  * **Test 2**: Screenshot ingestion with accurate `expireAt` timestamp calculation for Firestore TTL.
  * **Test 3**: Video job payload creation and retention expiration stamping.
  * **Test 4**: Student profile array linking (`classes: [...]`).
  * **Test 5**: Cascading deletion execution proving zero leftover documents in Firestore and full isolation of other enrolled classes.

---

## 📊 Code Coverage Benchmarks

```
==================================================================================
 % V8 Coverage Report Summary
-------------------|---------|----------|---------|---------|---------------------
Module             | % Stmts | % Branch | % Funcs | % Lines | Status
-------------------|---------|----------|---------|---------|---------------------
web-app (utils)    |   97.43 |    94.87 |     100 |   97.05 | 🟢 Exceeds Target
web-app (comp)     |     100 |    91.66 |     100 |     100 | 🟢 Exceeds Target
functions/ai_flows |     100 |    80.00 |     100 |     100 | 🟢 Exceeds Target
functions/media    |     100 |   100.00 |     100 |     100 | 🟢 Exceeds Target
==================================================================================
```
