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

# 2. Copy the active web-app/.env and mode-specific files
if [ -f "$ENV_FILE" ]; then
    cp "$ENV_FILE" web-app/.env
    if [ "$FIREBASE_ALIAS" = "prod" ]; then
        cp "$ENV_FILE" web-app/.env.production
    elif [ "$FIREBASE_ALIAS" = "dev" ]; then
        cp "$ENV_FILE" web-app/.env.development
    fi
    echo "📄 Updated web-app/.env"
fi

# 3. Generate functions/config.js
cat << CONFIG_EOF > functions/config.js
// Centralized configuration for Cloud Functions
export const FUNCTION_REGION = process.env.FUNCTION_REGION || process.env.FIREBASE_REGION || 'asia-east2';

// CORS origins for callable functions (true reflects request origin dynamically, authenticated via request.auth)
export const CORS_ORIGINS = true;


// Genkit AI Model parameters
export const AI_MODEL = 'gemini-3.5-flash-lite';
export const AI_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe-preview';
export const VERTEX_AI_LOCATION = 'global';
export const AI_TEMPERATURE = 0;
export const AI_TOP_P = 0.1;

// Job-specific configurations
export const ZIP_COMPRESSION_LEVEL = 9;
export const VIDEO_FRAME_RATE = 1;

// Storage related constants
export const MAX_SCREENSHOT_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
export const DEFAULT_CLASS_QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

// Institutional domain configuration for multi-school deployment
export const TEACHER_EMAIL_DOMAINS = (process.env.TEACHER_EMAIL_DOMAINS || 'vtc.edu.hk')
  .split(',')
  .map(d => d.trim().toLowerCase().replace(/^@/, ''))
  .filter(Boolean);

export const STUDENT_EMAIL_DOMAINS = (process.env.STUDENT_EMAIL_DOMAINS || 'stu.vtc.edu.hk')
  .split(',')
  .map(d => d.trim().toLowerCase().replace(/^@/, ''))
  .filter(Boolean);

/**
 * Derives user role ('teacher' | 'student' | null) from an email address based on configured domains.
 * @param {string} email
 * @returns {'teacher' | 'student' | null}
 */
export function deriveUserRole(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return null;
  const cleanEmail = email.trim().toLowerCase();
  const domain = cleanEmail.substring(cleanEmail.lastIndexOf('@') + 1);

  const matchesDomain = (targetDomain) => domain === targetDomain || domain.endsWith('.' + targetDomain);

  // Check student domains first, since student domains are often subdomains of the institutional domain (e.g. stu.vtc.edu.hk vs vtc.edu.hk)
  if (STUDENT_EMAIL_DOMAINS.some(matchesDomain)) {
    return 'student';
  }
  if (TEACHER_EMAIL_DOMAINS.some(matchesDomain)) {
    return 'teacher';
  }
  return null;
}

export function getAllowedEmailDomainsDescription() {
  const allDomains = [...STUDENT_EMAIL_DOMAINS, ...TEACHER_EMAIL_DOMAINS].map(d => '@' + d);
  return allDomains.join(' or ');
}
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
    "origin": ["*"],
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
