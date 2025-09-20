#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Install backend dependencies
echo "Installing backend dependencies..."
cd functions
npm install
cd ..

# Install and build the frontend application
echo "Installing and building the frontend..."
cd web-app
npm install
npm run build
cd ..

# Deploy to Firebase
echo "Deploying to Firebase..."
firebase deploy

echo "Deployment complete."
