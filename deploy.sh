#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

# Check if first argument is an environment selector (dev, prod, or custom project)
ENV_ARG=""
if [ "$1" = "dev" ] || [ "$1" = "development" ] || [ "$1" = "prod" ] || [ "$1" = "production" ] || [[ "$1" =~ ^[a-z0-9-]+-202[0-9]$|^[a-z0-9-]+-2627$ ]]; then
    ENV_ARG="$1"
    shift
    ./switch-env.sh "$ENV_ARG"
fi

# Detect target project ID safely
TARGET_PROJECT=""
if [ "$ENV_ARG" = "dev" ] || [ "$ENV_ARG" = "development" ]; then
    TARGET_PROJECT="it114115-dev-2026"
elif [ "$ENV_ARG" = "prod" ] || [ "$ENV_ARG" = "production" ]; then
    TARGET_PROJECT="it114115-2627"
fi

PREV_ARG=""
for arg in "$@"; do
    if [ "$PREV_ARG" = "--project" ]; then
        TARGET_PROJECT="$arg"
    fi
    PREV_ARG="$arg"
done

if [ -z "$TARGET_PROJECT" ]; then
    TARGET_PROJECT=$(firebase use 2>/dev/null | tr -d '\n\r ')
fi

# Whitelist validation: Never deploy to or touch unapproved projects (e.g. pytest-runner)
ALLOWED_PROJECTS=("it114115-dev-2026" "it114115-2627")
if [[ ! " ${ALLOWED_PROJECTS[@]} " =~ " ${TARGET_PROJECT} " ]]; then
    echo "🚨 CRITICAL SAFETY ABORT: Target project '$TARGET_PROJECT' is not permitted in this repo!"
    echo "Allowed projects: ${ALLOWED_PROJECTS[*]}"
    exit 1
fi

echo "🚀 Target Project for deployment: $TARGET_PROJECT"

# Export subshell environment variables to strictly bind GCP operations without altering global gcloud config
export CLOUDSDK_CORE_PROJECT="$TARGET_PROJECT"
export GOOGLE_CLOUD_PROJECT="$TARGET_PROJECT"
export GCLOUD_PROJECT="$TARGET_PROJECT"

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
ACTIVE_ENV_FILE="web-app/.env.prod"
if [ "$TARGET_PROJECT" = "it114115-dev-2026" ]; then
    ACTIVE_ENV_FILE="web-app/.env.dev"
fi
if [ -f "$ACTIVE_ENV_FILE" ] && ! grep -q "^VITE_GOOGLE_CLIENT_ID=[a-zA-Z0-9]" "$ACTIVE_ENV_FILE" 2>/dev/null; then
    echo "⚠️  ------------------------------------------------------------------------"
    echo "⚠️  [NOTICE] VITE_GOOGLE_CLIENT_ID is not configured in $ACTIVE_ENV_FILE"
    echo "⚠️  Google Drive direct cloud upload will be disabled in this deployment."
    echo "⚠️  To enable Google Drive upload:"
    echo "⚠️    1. In Google Cloud Console, create OAuth 2.0 Web Client ID (scope: drive.file)"
    echo "⚠️    2. Add authorized origin: https://${TARGET_PROJECT}.web.app"
    echo "⚠️    3. Add to $ACTIVE_ENV_FILE: VITE_GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com"
    echo "⚠️  ------------------------------------------------------------------------"
fi

if [ "$TARGET_PROJECT" = "it114115-2627" ]; then
    (cd web-app && npm install && npm run build:prod)
else
    (cd web-app && npm install && npm run build:dev)
fi

# Parse extra arguments
ONLY_HOSTING=false
FIREBASE_DEPLOY_ARGS=()
for arg in "$@"; do
    if [ "$arg" = "hosting" ]; then
        ONLY_HOSTING=true
        FIREBASE_DEPLOY_ARGS+=(--only hosting)
    elif [ "$arg" = "functions" ]; then
        FIREBASE_DEPLOY_ARGS+=(--only functions)
    elif [ -d "functions/$arg" ] || [ -d "functions/${arg//-/_}" ]; then
        codebase_name="${arg//_/-}"
        FIREBASE_DEPLOY_ARGS+=(--only "functions:$codebase_name")
    elif [[ "$arg" =~ ^functions: ]]; then
        FIREBASE_DEPLOY_ARGS+=(--only "$arg")
    elif [ "$arg" = "--only" ]; then
        FIREBASE_DEPLOY_ARGS+=("$arg")
    else
        FIREBASE_DEPLOY_ARGS+=("$arg")
    fi
done

if [ "$ONLY_HOSTING" = false ]; then
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

    echo "Deploying Storage and Firestore rules..."
    FUNCTIONS_DISCOVERY_TIMEOUT=30 firebase deploy --project="$TARGET_PROJECT" --only storage,firestore --force || true
    echo "Ensuring Storage bucket CORS rules are active on $TARGET_PROJECT..."
    gcloud storage buckets update "gs://${TARGET_PROJECT}.firebasestorage.app" --cors-file=cors.json --project="$TARGET_PROJECT" --quiet 2>/dev/null || true

    echo "Synchronizing system prompts & initial demo data on $TARGET_PROJECT..."
    node admin/scripts/seed_initial_data.mjs "$TARGET_PROJECT" || true

    # Initialize function upload bucket safely to prevent Day 0 parallel race conditions
    echo "Ensuring function upload environment is ready..."
    FUNCTIONS_DISCOVERY_TIMEOUT=30 firebase deploy --project="$TARGET_PROJECT" --only functions:attendance --force || true

    # Clean up any transient FAILED function state from Day 0 parallel builds
    echo "Checking for any failed function artifacts on $TARGET_PROJECT..."
    FAILED_FNS=$(gcloud functions list --project="$TARGET_PROJECT" --filter="state:FAILED" --format="value(name)" 2>/dev/null || true)
    for fn in $FAILED_FNS; do
        echo "Removing transient failed function $fn..."
        gcloud functions delete "$fn" --region=asia-east2 --gen2 --project="$TARGET_PROJECT" --quiet 2>/dev/null || true
    done
fi

echo "Deploying to Firebase (Functions & Hosting)..."
if ! FUNCTIONS_DISCOVERY_TIMEOUT=30 firebase deploy --project="$TARGET_PROJECT" --force "${FIREBASE_DEPLOY_ARGS[@]}"; then
    echo "Retrying deployment to finalize functions rollout..."
    sleep 5
    FAILED_FNS=$(gcloud functions list --project="$TARGET_PROJECT" --filter="state:FAILED" --format="value(name)" 2>/dev/null || true)
    for fn in $FAILED_FNS; do
        gcloud functions delete "$fn" --region=asia-east2 --gen2 --project="$TARGET_PROJECT" --quiet 2>/dev/null || true
    done
    FUNCTIONS_DISCOVERY_TIMEOUT=30 firebase deploy --project="$TARGET_PROJECT" --force "${FIREBASE_DEPLOY_ARGS[@]}"
fi

echo "Deployment successful to $TARGET_PROJECT!"