const admin = require('firebase-admin');
// Make sure the path to your service account key is correct. 
// You can download this from your Firebase project settings.
const serviceAccount = require('./sp.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// The email of the user you want to make a teacher
const email = 'cywong@vtc.edu.hk';

admin.auth().getUserByEmail(email)
  .then((userRecord) => {
    // Set the custom claim { role: 'teacher' } to match your security rule
    return admin.auth().setCustomUserClaims(userRecord.uid, {
      role: 'teacher'
    });
  })
  .then(() => {
    console.log(`Successfully set custom claim { role: 'teacher' } for ${email}`);
    console.log('The user must log out and log back in for the changes to take effect.');
  })
  .catch((error) => {
    console.error('Error setting custom claims:', error);
  });
