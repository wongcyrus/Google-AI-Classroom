#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

# Copy the central config file to all function directories
cp functions/config.js functions/ai_flows/config.js
cp functions/config.js functions/auth_triggers/config.js
cp functions/config.js functions/media_processing/config.js
cp functions/config.js functions/property_processing/config.js
cp functions/config.js functions/scheduled_tasks/config.js
cp functions/config.js functions/storage_triggers/config.js
cp functions/config.js functions/attendance/config.js

echo "Installing functions dependencies..."
(cd functions/ai_flows && npm install)
(cd functions/auth_triggers && npm install)
(cd functions/media_processing && npm install)
(cd functions/property_processing && npm install)
(cd functions/scheduled_tasks && npm install)
(cd functions/storage_triggers && npm install)
(cd functions/attendance && npm install)

echo "Building web app..."
(cd web-app && npm install && npm run build)

echo "Deploying to Firebase..."
FUNCTIONS_DISCOVERY_TIMEOUT=30 firebase deploy

echo "Deployment successful!"