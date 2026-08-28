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

echo "Deploying Storage and Firestore rules..."
FUNCTIONS_DISCOVERY_TIMEOUT=30 firebase deploy --only storage,firestore --force || true

# Initialize function upload bucket safely to prevent Day 0 parallel race conditions
echo "Ensuring function upload environment is ready..."
FUNCTIONS_DISCOVERY_TIMEOUT=30 firebase deploy --only functions:attendance --force || true

# Clean up any transient FAILED function state from Day 0 parallel builds
PROJECT_ID=$(firebase use 2>/dev/null | tr -d '\n\r ')
if [ -n "$PROJECT_ID" ]; then
    echo "Checking for any failed function artifacts on $PROJECT_ID..."
    FAILED_FNS=$(gcloud functions list --project="$PROJECT_ID" --filter="state:FAILED" --format="value(name)" 2>/dev/null || true)
    for fn in $FAILED_FNS; do
        echo "Removing transient failed function $fn..."
        gcloud functions delete "$fn" --region=asia-east2 --gen2 --project="$PROJECT_ID" --quiet 2>/dev/null || true
    done
fi

echo "Deploying to Firebase (Functions & Hosting)..."
if ! FUNCTIONS_DISCOVERY_TIMEOUT=30 firebase deploy --force "$@"; then
    echo "Retrying deployment to finalize functions rollout..."
    sleep 5
    if [ -n "$PROJECT_ID" ]; then
        FAILED_FNS=$(gcloud functions list --project="$PROJECT_ID" --filter="state:FAILED" --format="value(name)" 2>/dev/null || true)
        for fn in $FAILED_FNS; do
            gcloud functions delete "$fn" --region=asia-east2 --gen2 --project="$PROJECT_ID" --quiet 2>/dev/null || true
        done
    fi
    FUNCTIONS_DISCOVERY_TIMEOUT=30 firebase deploy --force "$@"
fi

echo "Deployment successful!"