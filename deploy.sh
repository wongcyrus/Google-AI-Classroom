#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

# Copy the central config file to all function directories
cp functions/config.js functions/ai_flows/config.js
cp functions/config.js functions/auth_triggers/config.js
cp functions/config.js functions/media_processing/config.js
cp functions/config.js functions/property_processing/config.js
cp functions/config.js functions/scheduled_tasks/config.js
cp functions/config.js functions/storage_triggers/config.js

echo "Building web app..."
(cd web-app && npm install && npm run build)

echo "Deploying to Firebase..."
firebase deploy

echo "Deployment successful!"