# Create Firebase Web App registration
resource "google_firebase_web_app" "default" {
  provider     = google-beta
  project      = var.project_id
  display_name = var.web_app_name

  depends_on = [
    google_firebase_project.default,
    google_project_service.apis
  ]
}

data "google_firebase_web_app_config" "default" {
  provider   = google-beta
  project    = var.project_id
  web_app_id = google_firebase_web_app.default.app_id
}

# Automatically generate web-app/.env
resource "local_file" "web_app_env" {
  filename = "${path.module}/../web-app/.env"
  content  = <<-EOT
VITE_API_KEY=${data.google_firebase_web_app_config.default.api_key}
VITE_AUTH_DOMAIN=${var.project_id}.firebaseapp.com
VITE_PROJECT_ID=${var.project_id}
VITE_STORAGE_BUCKET=${var.project_id}.firebasestorage.app
VITE_MESSAGING_SENDER_ID=${data.google_project.current.number}
VITE_APP_ID=${data.google_firebase_web_app_config.default.web_app_id}
VITE_REGION=${var.region}
VITE_RECAPTCHA_SITE_KEY=${var.recaptcha_site_key}
VITE_FIREBASE_API_KEY=${data.google_firebase_web_app_config.default.api_key}
VITE_FIREBASE_AUTH_DOMAIN=${var.project_id}.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=${var.project_id}
VITE_FIREBASE_STORAGE_BUCKET=${var.project_id}.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=${data.google_project.current.number}
VITE_FIREBASE_APP_ID=${data.google_firebase_web_app_config.default.web_app_id}
VITE_FIREBASE_REGION=${var.region}
VITE_USE_FIREBASE_EMULATOR=false
EOT
}

# Automatically generate root functions/config.js with all required exports
resource "local_file" "functions_config" {
  filename = "${path.module}/../functions/config.js"
  content  = <<-EOT
// Centralized configuration for Cloud Functions
export const FUNCTION_REGION = '${var.region}';

// CORS origins for callable functions
export const CORS_ORIGINS = [
  'https://${var.project_id}.web.app',
  'https://${var.project_id}.firebaseapp.com',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:3000'
];

// Genkit AI Model parameters
export const AI_MODEL = 'gemini-3.7-flash';
export const AI_TEMPERATURE = 0;
export const AI_TOP_P = 0.1;

// Job-specific configurations
export const ZIP_COMPRESSION_LEVEL = 9;
export const VIDEO_FRAME_RATE = 1;

// Storage related constants
export const MAX_SCREENSHOT_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
export const DEFAULT_CLASS_QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
EOT
}

# Automatically generate cors.json for Storage
resource "local_file" "storage_cors" {
  filename = "${path.module}/../cors.json"
  content  = <<-EOT
[
  {
    "origin": [
      "https://${var.project_id}.web.app",
      "https://${var.project_id}.firebaseapp.com",
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
EOT
}
