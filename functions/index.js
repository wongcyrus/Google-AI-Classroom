const { initializeApp } = require("firebase-admin/app");
const { onCallGenkit } = require("firebase-functions/v2/https");
const geminiModule = require("./gemini.js");

initializeApp();

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