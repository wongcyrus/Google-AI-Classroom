#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

# Copy the central config file to all function directories
for d in functions/*/ ; do
    cp functions/config.js "$d/config.js"
done

echo "Installing functions dependencies..."
for d in functions/*/ ; do
    (cd "$d" && npm install)
done

echo "Building web app..."
(cd web-app && npm install && npm run build)

echo "Deploying to Firebase..."
FUNCTIONS_DISCOVERY_TIMEOUT=30 firebase deploy

echo "Deployment successful!"