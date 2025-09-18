const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { onCallGenkit } = require("firebase-functions/v2/https");
const geminiModule = require("./gemini.js");

initializeApp();
const db = getFirestore();

geminiModule.initializeFlows(db);

exports.analyzeImages = onCallGenkit(
  {
    name: "analyzeImages",
  },
  geminiModule.analyzeImagesFlow
);

exports.analyzeAllImages = onCallGenkit(
  {
    name: "analyzeAllImages",
  },
  geminiModule.analyzeAllImagesFlow
);