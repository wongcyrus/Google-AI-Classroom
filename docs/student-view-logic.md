# Student View: Schedule-Driven Logic

This document outlines the automated, schedule-driven logic implemented in the `StudentView.jsx` component. The primary goal of this architecture is to ensure that a student's screen capture data is always associated with the correct, currently active class, especially in scenarios with back-to-back lessons.

## Core Architecture

The logic is managed by a custom React hook, `useStudentClassSchedule`, which provides the active class ID to the `StudentView` component. This decouples the class selection logic from the view component itself.

### 1. The `useStudentClassSchedule` Hook

This hook is the brain of the operation and works in three stages:

1.  **Fetch Student's Class List:** The hook subscribes to the logged-in student's profile document at `studentProfiles/{user.uid}`. It maintains a real-time list of all classes the student is enrolled in.

2.  **Fetch All Schedules:** Whenever the student's list of classes changes, the hook fetches the `schedule` object from each corresponding class document (`classes/{classId}`). This object contains the `timeSlots` and, crucially, the `timeZone` for that class.

3.  **Determine the Active Class:** Every 30 seconds, the hook performs the following check:
    *   It gets the current time.
    *   It iterates through each of the student's class schedules.
    *   For each schedule, it converts the current time into that class's specific timezone.
    *   It checks if the current, timezone-adjusted time falls within any of the defined `timeSlots` for the current day.
    *   The first class that matches becomes the `currentActiveClassId`.
    *   If no class is currently scheduled, `currentActiveClassId` is `null`.

### 2. `StudentView.jsx` Integration

The `StudentView.jsx` component consumes the `useStudentClassSchedule` hook and implements the following logic:

#### Automatic Class Selection

- The component gets the `currentActiveClassId` from the hook.
- A new variable, `activeClass`, is used as the source of truth for all data subscriptions and actions (e.g., listening for capture signals, uploading screenshots, fetching messages).

#### Manual Override

To handle edge cases or provide user flexibility, a manual override system is in place:

- The `activeClass` is determined by the formula: `manualClassSelection || currentActiveClassId`.
- The class selection dropdown in the UI now sets the `manualClassSelection` state, which takes precedence over the schedule-driven `currentActiveClassId`.
- When a class is manually selected, a **"Follow Schedule"** button appears. Clicking this button resets `manualClassSelection` to `null`, immediately returning the component to the automatic, schedule-driven mode.

#### UI Indicators

- The class dropdown now visually indicates which class is currently **"(Live)"** according to the schedule, guiding the user to the correct class without requiring them to think about it.

## Handling Overlap in Back-to-Back Classes

A key design consideration is how the system handles the transition between two classes scheduled back-to-back (e.g., Class A from 8:00-9:00 and Class B from 9:00-10:00).

The backend's `handleAutomaticCapture` function uses a 5-minute look-ahead to start capturing and a 5-minute look-behind to stop. This creates a 10-minute "overlap" in the database where both class documents may have `isCapturing: true`.

The schedule-driven frontend logic ensures this overlap does not affect the student's device. Here is a timeline of events:

**Scenario:**
*   **Class A:** 8:00 AM - 9:00 AM
*   **Class B:** 9:00 AM - 10:00 AM

---

### **At 8:55 AM**

*   **Backend:** Sets `isCapturing: true` for the upcoming **Class B**.
*   **Frontend:** The `activeClass` is still **Class A** based on the schedule. The app continues to capture and save screenshots for **Class A**, unaware of the change to Class B's database record.

---

### **At 9:00:00 AM (The Instant of Transition)**

*   **Frontend:** The `useStudentClassSchedule` hook detects the schedule change. The `activeClass` instantly switches from **Class A** to **Class B**.
*   The component begins listening to the Class B document, sees `isCapturing: true`, and starts saving all new screenshots for **Class B**.

---

### **At 9:05 AM**

*   **Backend:** Sets `isCapturing: false` for the now-finished **Class A**.
*   **Frontend:** The `activeClass` is **Class B**. The app is unaffected by the change to the Class A document it is no longer listening to.

### Conclusion

The backend flags may overlap in the database, but the frontend logic ensures a clean and instantaneous handoff. The student's screen is captured continuously, but the `classId` associated with the saved screenshots switches precisely at the scheduled time, ensuring data integrity.

