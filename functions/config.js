// Centralized configuration for Cloud Functions
export const FUNCTION_REGION = process.env.FUNCTION_REGION || process.env.FIREBASE_REGION || 'asia-east2';

// CORS origins for callable functions
export const CORS_ORIGINS = [
  'https://it114115-2627.web.app',
  'https://it114115-2627.firebaseapp.com',
  'https://it114115-dev-2026.web.app',
  'https://it114115-dev-2026.firebaseapp.com',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:3000'
];

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
