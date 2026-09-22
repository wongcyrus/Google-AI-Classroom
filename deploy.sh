#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

# Check if first argument is an environment selector (dev, prod, or custom project)
if [ "$1" = "dev" ] || [ "$1" = "development" ] || [ "$1" = "prod" ] || [ "$1" = "production" ] || [[ "$1" =~ ^[a-z0-9-]+-202[0-9]$|^[a-z0-9-]+-2627$ ]]; then
    ENV_ARG="$1"
    shift
    ./switch-env.sh "$ENV_ARG"
fi

# Copy the central config file to all function directories
for d in functions/*/ ; do
    if [ -f "$d/package.json" ]; then
        cp functions/config.js "$d/config.js"
    fi
done

echo "Installing functions dependencies..."
for d in functions/*/ ; do
    if [ -f "$d/package.json" ]; then
        (cd "$d" && npm install)
    fi
done

echo "Building web app..."
CURRENT_ACTIVE_PROJECT=$(firebase use 2>/dev/null | tr -d '\n\r ')
if [ "$CURRENT_ACTIVE_PROJECT" = "it114115-2627" ]; then
    (cd web-app && npm install && npm run build:prod)
else
    (cd web-app && npm install && npm run build:dev)
fi

# Check if deployment is only for hosting
ONLY_HOSTING=false
for arg in "$@"; do
    if [ "$arg" = "--only" ] || [ "$arg" = "hosting" ]; then
        ONLY_HOSTING=true
    fi
done

if [ "$ONLY_HOSTING" = false ]; then
    # Detect target project ID safely
    TARGET_PROJECT=$(firebase use 2>/dev/null | tr -d '\n\r ')
    PREV_ARG=""
    for arg in "$@"; do
        if [ "$PREV_ARG" = "--project" ]; then
            TARGET_PROJECT="$arg"
        fi
        PREV_ARG="$arg"
    done

    if [ -n "$TARGET_PROJECT" ]; then
        echo "Ensuring required AI & Firebase APIs (including Firebase AI Logic) are enabled on $TARGET_PROJECT..."
        gcloud services enable \
            firebasevertexai.googleapis.com \
            generativelanguage.googleapis.com \
            aiplatform.googleapis.com \
            firebaseappcheck.googleapis.com \
            firebaseml.googleapis.com \
            recaptchaenterprise.googleapis.com \
            --project="$TARGET_PROJECT" --quiet 2>/dev/null || true

        # Ensure App Check service policy permits Firebase AI Logic requests (unenforced until SDK #10018 WebSocket token transport is supported)
        echo "Configuring App Check policy for Firebase AI Logic on $TARGET_PROJECT..."
        firebase experiments:enable appcheckadmin || true
        firebase appcheck:services:set ailogic unenforced --project="$TARGET_PROJECT" --force || true
    fi

    echo "Deploying Storage and Firestore rules..."
    FUNCTIONS_DISCOVERY_TIMEOUT=30 firebase deploy --only storage,firestore --force || true
    if [ -n "$TARGET_PROJECT" ]; then
        echo "Ensuring Storage bucket CORS rules are active on $TARGET_PROJECT..."
        gcloud storage buckets update "gs://${TARGET_PROJECT}.firebasestorage.app" --cors-file=cors.json --quiet 2>/dev/null || true
    fi

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