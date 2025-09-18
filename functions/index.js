const { initializeApp } = require("firebase-admin/app");
const { onCallGenkit } = require("firebase-functions/v2/https");
const { analyzeImagesFlow } = require("./gemini.js");

initializeApp();

exports.analyzeImages = onCallGenkit(
  {
    name: "analyzeImages",
  },
  analyzeImagesFlow
);
