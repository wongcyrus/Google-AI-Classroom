import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider } from "firebase/app-check";

const isLocalhost = typeof window !== 'undefined' && (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname === '::1' ||
  window.location.hostname.endsWith('.local')
);

// In accordance with Firebase App Check security guidelines:
// Debug provider is strictly restricted to local development (localhost).
// Debug tokens must never ship to production or be accepted via URLs.
if (typeof window !== 'undefined' && isLocalhost) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || '484285c2-28e3-4af5-b3cc-0a6083df1275';
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || import.meta.env.VITE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || import.meta.env.VITE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || import.meta.env.VITE_APP_ID
};

let app;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

// Initialize App Check with ReCaptchaEnterpriseProvider
const recaptchaKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY || import.meta.env.VITE_FIREBASE_RECAPTCHA_SITE_KEY;
const enableAppCheck = import.meta.env.VITE_ENABLE_APP_CHECK !== 'false';
const isPlaceholderKey = !recaptchaKey || recaptchaKey === '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI';

let appCheck = null;
if (typeof window !== 'undefined' && enableAppCheck && (!isPlaceholderKey || self.FIREBASE_APPCHECK_DEBUG_TOKEN)) {
  try {
    const rawKey = recaptchaKey && !isPlaceholderKey ? recaptchaKey : '6Ld3VLwtAAAAAH0F9aGgsrN8Ln4Igwb-LsXZ2KSQ';
    const siteKey = rawKey.includes('/keys/') ? rawKey.split('/keys/')[1] : rawKey;
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true
    });
    console.info('[AppCheck] Initialized successfully with ReCaptchaEnterpriseProvider.');
  } catch (err) {
    console.warn('[AppCheck] initialization notice:', err);
  }
}

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app, import.meta.env.VITE_REGION || import.meta.env.VITE_FIREBASE_REGION || 'asia-east2');

if (import.meta.env.DEV) {
  window.auth = auth;
  window.appCheck = appCheck;
}

export { auth, db, storage, functions, app, appCheck };