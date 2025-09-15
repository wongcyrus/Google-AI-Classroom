
const admin = require('firebase-admin');
const serviceAccount = require('./sp.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const email = 'cywong@vtc.edu.hk';

admin.auth().getUserByEmail(email)
  .then((userRecord) => {
    return admin.auth().setCustomUserClaims(userRecord.uid, {
      teacher: true
    });
  })
  .then(() => {
    console.log(`Successfully granted 'teacher' role to ${email}`);
  })
  .catch((error) => {
    console.error('Error granting teacher role:', error);
  });
