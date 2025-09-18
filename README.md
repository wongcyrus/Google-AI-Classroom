# AI Invigilator

An intelligent proctoring solution designed to monitor students' computer screens during computer-based tests using AI analysis. This project leverages the Gemini model to detect potential academic dishonesty, providing a robust tool for modern online assessments.

## Architecture Overview

The project is a monorepo composed of three main parts:

*   **`web-app/`**: A React single-page application (built with Vite) that serves as the user-facing frontend for students, teachers, and admins. It uses Firebase for authentication and communicates with the backend services.
*   **`functions/`**: A Node.js backend using Firebase Functions. This includes the core AI logic for analyzing student screen captures, powered by Google's Genkit and the Gemini model.
*   **`admin/`**: A collection of Node.js scripts for administrative tasks, such as granting teacher roles and managing users.

## Features

### Student Features

*   **Simple Login & Class Selection:** Students can easily log in and select their active class.
*   **Session Management:** Strictly enforces a single active session per user, preventing logins from multiple browsers or devices simultaneously.
*   **Real-time Screen Sharing:** Shares the screen with the invigilator for proctoring.
*   **Real-time Messaging:** Receives important announcements and messages from the teacher via OS-level notifications.

### Teacher Features

*   **Class Management Dashboard:** Create, view, and manage classes and student enrollment.
*   **Live Student Monitoring:** View a gallery of all students who are actively sharing their screens.
*   **Configurable Capture Settings:** Adjust the screen capture frame rate and image quality for each class to balance detail and performance.
*   **Real-time Messaging:** Send messages to an entire class or individual students.
*   **AI-Powered Insights (Inferred):** The system analyzes screen captures to flag potential incidents of academic dishonesty.

### Admin Features

*   **Secure User Management:** Admins can securely grant teacher privileges using dedicated command-line scripts.
*   **Role-Based Access Control:** Utilizes Firebase custom claims to differentiate between user roles (student, teacher).

## Getting Started (Local Development)

Follow these instructions to set up the project for local development.

### Prerequisites

*   [Node.js](https://nodejs.org/) (v18 or higher recommended)
*   [Git](https://git-scm.com/)
*   [Firebase CLI](https://firebase.google.com/docs/cli#install_the_cli): `npm install -g firebase-tools`

### 1. Firebase Project Setup

1.  Create a new project in the [Firebase Console](https://console.firebase.google.com/).
2.  Enable the following services:
    *   **Authentication:** Email/Password sign-in.
    *   **Firestore:** Create a database.
    *   **Storage:** Create a storage bucket.
3.  In your Firebase project settings, add a new Web App.
4.  Copy the `firebaseConfig` object provided.
5.  In the `web-app/` directory, copy `.env.example` to a new file named `.env` and paste your `firebaseConfig` values into it.

### 2. Backend Setup

Install dependencies for the Firebase Functions.

```bash
cd functions
npm install
```

### 3. Frontend Setup

Install dependencies and run the local development server for the React app.

```bash
cd web-app
npm install
npm run dev
```

The application should now be running locally, typically at `http://localhost:5173`.

## Admin Scripts

The `/admin` directory contains scripts for managing user roles.

1.  **Setup:**
    *   Navigate to the directory: `cd admin`
    *   Install dependencies: `npm install`
    *   **Authentication:** You need to provide service account credentials to the Admin SDK.
        1.  In your Firebase project settings, go to **Service Accounts**.
        2.  Click **Generate new private key**.
        3.  Save the downloaded JSON file in the `admin/` directory.
        4.  Rename the key file or update the path in each admin script (e.g., `grantTeacherRole.js`).

2.  **Usage:**
    *   **To grant a user teacher privileges:**
        ```bash
        node grantTeacherRole.js teacher-email@example.com
        ```
    *   **To verify a user's email (if needed):**
        ```bash
        node verifyUser.js user-email@example.com
        ```

## Deployment

This project is configured for deployment to Firebase.

1.  **Build the Frontend:**
    ```bash
    cd web-app
    npm run build
    ```

2.  **Deploy to Firebase:**
    Run the deploy command from the project root.
    ```bash
    # Deploy everything (hosting, functions, firestore rules, etc.)
    firebase deploy

    # Or, deploy only specific parts
    firebase deploy --only hosting
    firebase deploy --only functions
    ```