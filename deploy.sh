#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

echo "Building web app..."
(cd web-app && npm install && npm run build)

echo "Deploying to Firebase..."
firebase deploy

echo "Deployment successful!"