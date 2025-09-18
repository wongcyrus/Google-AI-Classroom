const { initializeApp } = require("firebase-admin/app");
const { onCallGenkit } = require("firebase-functions/v2/https");
const { analyzeImagesFlow, analyzeAllImagesFlow } = require("./gemini.js");

initializeApp();

exports.analyzeImages = onCallGenkit(
  {
    name: "analyzeImages",
  },
  analyzeImagesFlow
);

exports.analyzeAllImages = onCallGenkit(
  {
    name: "analyzeAllImages",
  },
  analyzeAllImagesFlow
);