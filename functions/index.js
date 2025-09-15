const functions = require("firebase-functions");

// The v1 SDK does not have a direct equivalent for blocking on sign-in.
// This uses the `onCreate` trigger, which will only check for a verified
// email when a user first creates their account.
exports.beforeSignIn = functions.auth.user().onCreate((user) => {
  if (user.email && !user.emailVerified) {
    // Preventing the user account from being created in Firestore/RTDB.
    // Note: The user will still be created in Firebase Auth.
    // A full solution would involve a cleanup function.
    throw new functions.https.HttpsError(
        "permission-denied",
        "Please verify your email before creating an account.",
    );
  }
  return null; // Return a value for successful execution
});
