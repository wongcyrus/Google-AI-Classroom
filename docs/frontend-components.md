# Frontend Components

The `web-app/src/components/` directory contains the following main components:

*   **`AuthComponent.jsx`**: Handles user authentication (login, logout).
*   **`ClassManagement.jsx`**: Allows teachers to create and manage classes.
*   **`ClassView.jsx`**: The main view for teachers, containing a tabbed interface to navigate between different functionalities.
*   **`MonitorView.jsx`**: A real-time view of students' screens during a class session.
*   **`VideoLibrary.jsx`**: A gallery of recorded student sessions, with features for playback, download, and requesting analysis or zip archives.
*   **`SessionReviewView.jsx`**: A view for reviewing a student's session, including their screen recording and any irregularities.
*   **`IrregularitiesView.jsx`**: Displays a list of irregularities detected during a class session.
*   **`ProgressView.jsx`**: Shows the progress of students' work.
*   **`DataManagementView.jsx`**: Allows teachers to manage class data, including downloading zipped videos and analysis results.
*   **`PerformanceAnalyticsView.jsx`**: Provides analytics on student performance.
*   **`StudentView.jsx`**: The main view for students, showing their screen sharing status and any messages from the teacher. For more details on its internal logic, see the [Student View Logic Documentation](./student-view-logic.md).
*   **`AttendanceView.jsx`**: Displays a per-minute attendance heatmap for each student in a selected lesson, providing a detailed visualization of their presence throughout the class.
