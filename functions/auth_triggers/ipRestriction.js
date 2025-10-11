import { beforeUserSignedIn } from 'firebase-functions/v2/identity';
import { HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { Address4 } from 'ip-address';
import { format } from 'date-fns-tz';
import { toZonedTime } from 'date-fns-tz/toZonedTime';
import './firebase.js'; // Ensure firebase is initialized
import { FUNCTION_REGION } from './config.js';

const db = getFirestore();

/**
 * Checks if a login attempt is happening during a class's scheduled time.
 * @param {object} schedule The class schedule object from Firestore.
 * @returns {boolean} True if the current time is within a scheduled slot.
 */
function isDuringScheduledTime(schedule) {
  if (!schedule || !schedule.startDate || !schedule.endDate || !schedule.timeSlots || !schedule.timeZone) {
    return false;
  }

  try {
    const timeZone = schedule.timeZone;
    const now = new Date(); // Current time in UTC

    // Get current time details in the class's timezone
    const zonedNow = toZonedTime(now, timeZone);

    const startDate = new Date(schedule.startDate);
    const endDate = new Date(schedule.endDate);
    endDate.setUTCHours(23, 59, 59, 999); // Compare dates in UTC

    if (now < startDate || now > endDate) {
      return false; // Not within the date range of the class
    }

    const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentDay = dayMap[zonedNow.getUTCDay()];
    const currentTime = format(zonedNow, 'HH:mm', { timeZone });

    for (const slot of schedule.timeSlots) {
      if (slot.days.includes(currentDay)) {
        if (currentTime >= slot.startTime && currentTime < slot.endTime) {
          return true; // We are in a scheduled slot
        }
      }
    }
  } catch (e) {
    console.error('Error processing schedule time:', e);
    return false; // Fail safe: if time zone is invalid, don't block
  }

  return false; // Not in any scheduled time slot for the current day
}

export const checkipaddress = beforeUserSignedIn({ region: FUNCTION_REGION }, async (event) => {
  console.log('--- checkipaddress function triggered (v2) ---');
  const user = event.data;
  const ipAddress = event.ipAddress;
  console.log(`User: ${user.email}, IP Address: ${ipAddress}`);

  if (!user.email || !ipAddress) {
    console.log('Exiting: Missing user email or IP address.');
    return;
  }

  if (user.customClaims && user.customClaims.role === 'teacher') {
    console.log('Exiting: User is a teacher, skipping restrictions.');
    return;
  }

  const classesRef = db.collection('classes');
  const qByEmail = classesRef.where('studentEmails', 'array-contains', user.email);
  const qByUid = classesRef.where('studentUids', 'array-contains', user.uid);

  const [snapshotByEmail, snapshotByUid] = await Promise.all([qByEmail.get(), qByUid.get()]);

  const allDocs = new Map();
  snapshotByEmail.forEach(doc => allDocs.set(doc.id, doc));
  snapshotByUid.forEach(doc => allDocs.set(doc.id, doc));

  if (allDocs.size === 0) {
    console.log(`Exiting: User ${user.email} is not enrolled in any classes.`);
    return;
  }

  console.log(`User ${user.email} is in ${allDocs.size} class(es). Checking for active IP restrictions...`);

  let allRestrictions = [];
  let restrictionsFound = false;

  allDocs.forEach(doc => {
    const classData = doc.data();
    // Only consider restrictions if the login is during a scheduled time
    if (isDuringScheduledTime(classData.schedule)) {
      console.log(`Class '${doc.id}' is currently in a scheduled session.`);
      if (classData.ipRestrictions && classData.ipRestrictions.length > 0) {
        console.log(`Found ${classData.ipRestrictions.length} IP restrictions for class '${doc.id}'.`);
        restrictionsFound = true;
        allRestrictions = allRestrictions.concat(classData.ipRestrictions);
      } else {
        console.log(`No IP restrictions for active class '${doc.id}'.`);
      }
    }
  });

  if (!restrictionsFound) {
    // No active restrictions at this time, so allow login.
    console.log('Exiting: No active IP restrictions found for this user at this time. Login allowed.');
    return;
  }

  const uniqueRestrictions = [...new Set(allRestrictions)];
  console.log(`Consolidated unique IP restrictions: ${uniqueRestrictions.join(', ')}`);

  let ipAllowed = false;
  for (const restriction of uniqueRestrictions) {
    try {
      if (restriction.includes('/')) { // CIDR range
        const range = new Address4(restriction);
        const userIp = new Address4(ipAddress);
        if (userIp.isInSubnet(range)) {
          ipAllowed = true;
          break;
        }
      } else { // Single IP
        if (ipAddress === restriction) {
          ipAllowed = true;
          break;
        }
      }
    } catch (e) {
      console.error(`Invalid IP address or range format: ${restriction}`, e);
    }
  }

  if (!ipAllowed) {
    console.log(`Blocking login for ${user.email} from IP ${ipAddress}. IP not in allowed list.`);
    throw new HttpsError(
      'permission-denied',
      'Login is only permitted from a school network during scheduled class times.'
    );
  }

  console.log(`Login allowed for ${user.email} from IP ${ipAddress}.`);
  return;
});