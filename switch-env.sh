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
    DEFAULT_STUDENT_DOMAINS="stu.vtc.edu.hk,gmail.com"
    ;;
  prod|production)
    PROJECT_ID="it114115-2627"
    ENV_FILE="web-app/.env.prod"
    ENV_NAME="Production"
    FIREBASE_ALIAS="prod"
    DEFAULT_STUDENT_DOMAINS="stu.vtc.edu.hk"
    ;;
  *)
    PROJECT_ID="$ENV_TARGET"
    ENV_FILE="web-app/.env.$PROJECT_ID"
    ENV_NAME="Custom ($PROJECT_ID)"
    FIREBASE_ALIAS="$PROJECT_ID"
    DEFAULT_STUDENT_DOMAINS="${STUDENT_EMAIL_DOMAINS:-stu.vtc.edu.hk}"
    ;;
esac

# Safety check: Prevent targeting unapproved projects like pytest-runner
ALLOWED_PROJECTS=("it114115-dev-2026" "it114115-2627")
if [[ ! " ${ALLOWED_PROJECTS[@]} " =~ " ${PROJECT_ID} " ]]; then
    echo "🚨 CRITICAL SAFETY ABORT: Target project '$PROJECT_ID' is not permitted in this repo!"
    echo "Allowed projects: ${ALLOWED_PROJECTS[*]}"
    exit 1
fi

echo "=========================================================="
echo "🔄 Switching active environment to: $ENV_NAME ($PROJECT_ID)"
echo "=========================================================="

# 1. Switch Firebase CLI active project
firebase use "$FIREBASE_ALIAS" 2>/dev/null || firebase use "$PROJECT_ID"

# Export environment variables for current subshell to protect global gcloud config
export CLOUDSDK_CORE_PROJECT="$PROJECT_ID"
export GOOGLE_CLOUD_PROJECT="$PROJECT_ID"
export GCLOUD_PROJECT="$PROJECT_ID"

# 2. Copy the active web-app/.env and mode-specific files
if [ -f "$ENV_FILE" ]; then
    cp "$ENV_FILE" web-app/.env
    if [ "$FIREBASE_ALIAS" = "prod" ]; then
        cp "$ENV_FILE" web-app/.env.production
        echo "📄 Updated web-app/.env and web-app/.env.production"
    elif [ "$FIREBASE_ALIAS" = "dev" ]; then
        cp "$ENV_FILE" web-app/.env.development
        echo "📄 Updated web-app/.env and web-app/.env.development"
    else
        echo "📄 Updated web-app/.env"
    fi

    # 2b. Check Google Drive OAuth Client ID configuration
    if ! grep -q "^VITE_GOOGLE_CLIENT_ID=[a-zA-Z0-9]" "$ENV_FILE" 2>/dev/null; then
        echo "⚠️  [WARNING] VITE_GOOGLE_CLIENT_ID is not configured in $ENV_FILE"
        echo "   -> Direct Google Drive upload in Teacher Lecture Recordings will be disabled."
        echo "   -> To enable Google Drive direct upload:"
        echo "      1. In Google Cloud Console, create an OAuth 2.0 Web Client ID with scope 'https://www.googleapis.com/auth/drive.file'"
        echo "      2. Add Authorized JavaScript origin: https://${PROJECT_ID}.web.app (and http://localhost:5173 for local dev)"
        echo "      3. Set VITE_GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com in $ENV_FILE"
    else
        echo "✅ Google Drive integration configured (VITE_GOOGLE_CLIENT_ID detected)."
    fi
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

// Runtime project detection safeguard: Cloud Functions automatically inject GCLOUD_PROJECT or FIREBASE_CONFIG
const _detectedProjectId = process.env.GCLOUD_PROJECT || (() => {
  try { return JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId; } catch { return ''; }
})() || '';
const _isDevRuntime = _detectedProjectId === 'it114115-dev-2026' || _detectedProjectId.includes('dev');
const _fallbackStudentDomains = _isDevRuntime ? 'stu.vtc.edu.hk,gmail.com' : '${DEFAULT_STUDENT_DOMAINS:-stu.vtc.edu.hk}';

export const STUDENT_EMAIL_DOMAINS = (process.env.STUDENT_EMAIL_DOMAINS || _fallbackStudentDomains)
  .split(',')
  .map(d => d.trim().toLowerCase().replace(/^@/, ''))
  .filter(Boolean);

// Optional username regex patterns for same-domain or fine-grained disambiguation
export const STUDENT_USERNAME_REGEX = process.env.STUDENT_USERNAME_REGEX ? new RegExp(process.env.STUDENT_USERNAME_REGEX, 'i') : null;
export const TEACHER_USERNAME_REGEX = process.env.TEACHER_USERNAME_REGEX ? new RegExp(process.env.TEACHER_USERNAME_REGEX, 'i') : null;

// Default fallback to student for ambiguous / same-domain signups
export const DEFAULT_TO_STUDENT = process.env.DEFAULT_TO_STUDENT !== 'false';

/**
 * Derives user role ('teacher' | 'student' | null) from an email address based on configured domains and username patterns.
 * @param {string} email
 * @returns {'teacher' | 'student' | null}
 */
export function deriveUserRole(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return null;
  const cleanEmail = email.trim().toLowerCase();
  const atIndex = cleanEmail.lastIndexOf('@');
  const username = cleanEmail.substring(0, atIndex);
  const domain = cleanEmail.substring(atIndex + 1);

  if (!username || !domain) return null;

  const matchesTarget = (targetDomain) => targetDomain === '*' || domain === targetDomain || domain.endsWith('.' + targetDomain);

  const isStudentDomain = STUDENT_EMAIL_DOMAINS.some(matchesTarget);
  const isTeacherDomain = TEACHER_EMAIL_DOMAINS.some(matchesTarget);

  if (!isStudentDomain && !isTeacherDomain) {
    return null;
  }

  // 1. Username Regex check takes precedence if configured
  if (STUDENT_USERNAME_REGEX && STUDENT_USERNAME_REGEX.test(username)) {
    return 'student';
  }
  if (TEACHER_USERNAME_REGEX && TEACHER_USERNAME_REGEX.test(username)) {
    return 'teacher';
  }

  // 2. Check for same-domain or wildcard overlap
  const exactStudentDomain = STUDENT_EMAIL_DOMAINS.some(d => d === '*' || domain === d);
  const exactTeacherDomain = TEACHER_EMAIL_DOMAINS.some(d => d === '*' || domain === d);
  const isSameDomain = exactStudentDomain && exactTeacherDomain;

  if (isSameDomain) {
    return DEFAULT_TO_STUDENT ? 'student' : null;
  }

  // 3. Subdomain hierarchy (student subdomains win over parent teacher domains, e.g. stu.vtc.edu.hk vs vtc.edu.hk)
  if (isStudentDomain) {
    return 'student';
  }
  if (isTeacherDomain) {
    return 'teacher';
  }

  return DEFAULT_TO_STUDENT ? 'student' : null;
}

export function getAllowedEmailDomainsDescription() {
  const allDomains = [...STUDENT_EMAIL_DOMAINS, ...TEACHER_EMAIL_DOMAINS].map(d => d === '*' ? '* (any domain)' : '@' + d);
  return [...new Set(allDomains)].join(' or ');
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
