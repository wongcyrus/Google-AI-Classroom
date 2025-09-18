import {beforeUserSignedIn as beforeUserSignedInHandler} from "firebase-functions/v2/identity";
import {HttpsError} from "firebase-functions/v2/https";
import {analyzeImages as analyzeImagesHandler} from "./gemini.js";

export const beforeUserSignedIn = beforeUserSignedInHandler((event) => {
  const user = event.data;
  if (user.email && !user.emailVerified) {
    throw new HttpsError(
        "permission-denied",
        "Please verify your email before signing in.",
    );
  }
});

export const analyzeImages = analyzeImagesHandler;
