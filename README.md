# AI-invigilator
Use AI to monitor students' computer screens during computer-based tests.

## How to Use

This application provides different functionalities for students and teachers.

### For Students

1.  **Register:** Open the application and use the registration form. You must use an email address ending in `@stu.vtc.edu.hk`.
2.  **Login:** After registering, log in with your credentials.
3.  **Share Your Screen:** Click the "Share Screen" button to begin sharing your screen with the invigilator. A screenshot will be taken every 5 seconds.
4.  **Stop Sharing:** Click the "Stop Sharing" button to end the screen sharing session.

### For Teachers

1.  **Account Creation:** Teacher accounts must be created manually in the Firebase Console and assigned a 'teacher' role. See the technical details below.
2.  **Login:** Log in with your teacher account credentials.
3.  **Monitor Students:** Upon logging in, you will be presented with the Teacher View, which displays the real-time screen captures of all students who are currently sharing their screens. The view automatically refreshes to show the latest screenshots.

## Technical Details for Teacher Account Creation

To create a teacher account, you need to have `Editor` or `Owner` role in your Firebase project.

1.  **Create a new user in Firebase Authentication:**
    *   Go to your Firebase project console.
    *   Navigate to the **Authentication** section.
    *   Click on the **Users** tab.
    *   Click the **Add user** button.
    *   Enter the teacher's email address and a temporary password.
    *   Click **Add user**.

2.  **Set Custom User Claim:**
    *   After creating the user, you need to assign the 'teacher' role. This is done by setting a custom claim on the user's account. This requires using the Firebase Admin SDK.
    *   You will need to run a script to set this claim. Here is an example using Node.js:

    ```javascript
    // Make sure to install firebase-admin: npm install firebase-admin
    const admin = require('firebase-admin');

    // Initialize the Admin SDK with your service account credentials
    // You can download your service account key from Project settings > Service accounts
    const serviceAccount = require('./path/to/your/serviceAccountKey.json');

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    const uid = 'USER_UID_TO_MAKE_TEACHER'; // <-- Replace with the UID of the user you created

    admin.auth().setCustomUserClaims(uid, { role: 'teacher' }).then(() => {
      console.log('Successfully set teacher role for user:', uid);
      process.exit();
    }).catch(error => {
      console.error('Error setting custom claims:', error);
      process.exit(1);
    });
    ```
    *   **Important:** Replace `'USER_UID_TO_MAKE_TEACHER'` with the actual UID of the teacher's account you just created in the Firebase console.
    *   You will also need to download your service account key from `Project settings > Service accounts` in your Firebase project and update the path in the script.

3.  **Login:** The teacher can now log in using the email and password you created. The application will recognize them as a teacher based on the custom claim.
