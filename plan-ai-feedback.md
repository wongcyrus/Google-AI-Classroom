### **Detailed Plan: Enhanced AI Analysis & Feedback**

This plan breaks down the implementation into three main features: the Automated Feedback Loop, Sentiment Analysis, and AI-driven Performance Metrics.

---

### 1. Feature: Automated Feedback Loop

**Goal:** Allow students to reply to AI-generated messages, creating an interactive and conversational feedback experience.

**Plan:**

*   **Phase 1: Backend (Cloud Functions)**
    1.  **Create a new HTTP-triggered Cloud Function:**
        *   **Name:** `handleStudentReply`
        *   **Location:** `functions/ai_flows/`
        *   **Trigger:** HTTP Request (Callable from the web app).
        *   **Logic:**
            *   Accepts `originalMessageId` and `replyText` from the student.
            *   Fetches the conversation history from the `mails` collection using the `originalMessageId` to identify the thread.
            *   Constructs a new prompt for the Gemini AI, providing the conversation history for context.
            *   Calls the Gemini API to generate a context-aware response.
            *   Saves the AI's new response as a new document in the `mails` collection, linking it to the conversation thread.

*   **Phase 2: Firestore Schema**
    1.  **Update `mails` Collection:**
        *   Add a `threadId` field to group messages within the same conversation.
        *   Add a `sender` field to distinguish between messages from the `AI` and the `student`.
        *   Ensure timestamps are accurately recorded to maintain conversation order.

*   **Phase 3: Frontend (React App)**
    1.  **Modify `EmailDetailView.jsx`:**
        *   Add a "Reply" button and a text input area to the view.
        *   When a student submits a reply, call the `handleStudentReply` Cloud Function.
    2.  **Update `MailboxView.jsx` and `EmailDetailView.jsx`:**
        *   Modify the components to display messages in a threaded, conversational format (like a chat).
        *   Ensure the view updates in real-time as new messages are added to the thread.

---

### 2. Feature: Sentiment Analysis

**Goal:** Proactively identify if a student is frustrated or struggling by analyzing the text on their screen.

**Plan:**

*   **Phase 1: Backend (Cloud Functions)**
    1.  **Update the AI Analysis Prompt:**
        *   **File:** `functions/ai_flows/processVideoAnalysisJob.js`
        *   **Logic:** Modify the prompt sent to the Gemini API for screenshot analysis.
        *   **New Prompt Instruction:** Add a section to the prompt asking the AI to: "Analyze any visible text on the screen for sentiment (e.g., frustrated, confused, positive, neutral). If negative sentiment is detected, flag it."
    2.  **Process the AI Response:**
        *   Update the function to parse the sentiment analysis from the Gemini response.
        *   If negative sentiment is detected, create a new document in the `irregularities` collection with a `type` of `negativeSentiment`.

*   **Phase 2: Firestore Schema**
    1.  **Update `irregularities` Collection:**
        *   Add a `sentiment` field to store the sentiment label (e.g., `'frustrated'`) and score.
        *   This will allow for easy querying of sentiment-related events.

*   **Phase 3: Frontend (React App)**
    1.  **Update `TeacherView.jsx` / `MonitorView.jsx`:**
        *   Display a visual indicator (e.g., an icon or a colored border) on a student's screen in the grid when a `negativeSentiment` irregularity is detected.
    2.  **(Optional) Automated Proactive Message:**
        *   Create a new trigger that automatically sends a supportive message (e.g., "It looks like you might be stuck. Would you like some help?") to the student's mailbox when negative sentiment is detected.

---

### 3. Feature: AI-driven Performance Metrics

**Goal:** Use the AI to extract detailed performance metrics from student screens, such as time spent on a specific question.

**Plan:**

*   **Phase 1: Backend (Cloud Functions)**
    1.  **Update the AI Analysis Prompt:**
        *   **File:** `functions/ai_flows/processVideoAnalysisJob.js`
        *   **Logic:** Further enhance the Gemini prompt to extract structured data.
        *   **New Prompt Instruction:** "Analyze the screen to identify the current task (e.g., 'Question 5', 'Writing introduction'). Extract this as a structured field. Note the timestamp."
    2.  **Create a new Cloud Function for Aggregation:**
        *   **Name:** `aggregatePerformanceMetrics`
        *   **Trigger:** Time-based (e.g., runs every 5 minutes) or triggered on new analysis results.
        *   **Logic:**
            *   Processes new analysis results.
            *   Calculates metrics like `timeOnTask` by comparing timestamps of screenshots showing the same task.
            *   Saves these aggregated metrics to a new `performanceMetrics` collection.

*   **Phase 2: Firestore Schema**
    1.  **Create a new `performanceMetrics` Collection:**
        *   **Documents:** Each document will represent a period of work on a specific task.
        *   **Fields:** `studentId`, `classId`, `taskName`, `startTime`, `endTime`, `duration`, `resourcesUsed` (e.g., URLs from other browser tabs, if detectable).

*   **Phase 3: Frontend (React App)**
    1.  **Create a new `PerformanceAnalyticsView.jsx` component:**
        *   This view will be for teachers to see student progress.
        *   Query the `performanceMetrics` collection.
        *   Display the data using charts and graphs (e.g., a bar chart showing time spent per question, a timeline of student activity).
    2.  **Integrate into `TeacherView.jsx`:**
        *   Add a link or tab to the new `PerformanceAnalyticsView` from the main teacher dashboard.