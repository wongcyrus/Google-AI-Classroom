#!/bin/bash
set -e

# ==============================================================================
# Instant Environment Switcher (Dev <-> Prod <-> Custom)
# ==============================================================================

ENV_TARGET="${1:-dev}"

case "$ENV_TARGET" in
  dev|development)
    PROJECT_ID="it114115-dev-2026"
    ENV_FILE="web-app/.env.dev"
    ENV_NAME="Development"
    FIREBASE_ALIAS="dev"
    ;;
  prod|production)
    PROJECT_ID="it114115-2627"
    ENV_FILE="web-app/.env.prod"
    ENV_NAME="Production"
    FIREBASE_ALIAS="prod"
    ;;
  *)
    PROJECT_ID="$ENV_TARGET"
    ENV_FILE="web-app/.env.$PROJECT_ID"
    ENV_NAME="Custom ($PROJECT_ID)"
    FIREBASE_ALIAS="$PROJECT_ID"
    ;;
esac

echo "=========================================================="
echo "🔄 Switching active environment to: $ENV_NAME ($PROJECT_ID)"
echo "=========================================================="

# 1. Switch Firebase CLI active project
firebase use "$FIREBASE_ALIAS" 2>/dev/null || firebase use "$PROJECT_ID"

# 2. Copy the active web-app/.env
if [ -f "$ENV_FILE" ]; then
    cp "$ENV_FILE" web-app/.env
    echo "📄 Updated web-app/.env"
fi

# 3. Generate functions/config.js
cat << CONFIG_EOF > functions/config.js
// Centralized configuration for Cloud Functions
export const FUNCTION_REGION = 'asia-east2';

// CORS origins for callable functions
export const CORS_ORIGINS = [
  'https://${PROJECT_ID}.web.app',
  'https://${PROJECT_ID}.firebaseapp.com',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:3000'
];

// Genkit AI Model parameters
export const AI_MODEL = 'gemini-3.5-flash-lite';
export const AI_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
export const VERTEX_AI_LOCATION = 'global';
export const AI_TEMPERATURE = 0;
export const AI_TOP_P = 0.1;

// Job-specific configurations
export const ZIP_COMPRESSION_LEVEL = 9;
export const VIDEO_FRAME_RATE = 1;

// Storage related constants
export const MAX_SCREENSHOT_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
export const DEFAULT_CLASS_QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
CONFIG_EOF

# 4. Propagate functions/config.js to all function codebases
for d in functions/*/ ; do
    cp functions/config.js "$d/config.js"
done
echo "⚙️ Synchronized functions/config.js to all 7 codebases"

# 5. Generate cors.json
cat << CORS_EOF > cors.json
[
  {
    "origin": [
      "https://${PROJECT_ID}.web.app",
      "https://${PROJECT_ID}.firebaseapp.com",
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:3000",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
      "http://127.0.0.1:3000"
    ],
    "method": ["GET", "POST", "PUT", "DELETE", "HEAD"],
    "maxAgeSeconds": 3600,
    "responseHeader": [
      "Content-Type",
      "Authorization",
      "Content-Length",
      "User-Agent",
      "x-goog-resumable"
    ]
  }
]
CORS_EOF
echo "🌐 Updated cors.json"

echo "=========================================================="
echo "✅ Active Environment: $ENV_NAME"
echo "🌐 Live App URL:       https://${PROJECT_ID}.web.app"
echo "⚙️ Firebase Console:   https://console.firebase.google.com/project/${PROJECT_ID}/overview"
echo "=========================================================="
