// Centralized configuration for Cloud Functions

export const FUNCTION_REGION = 'asia-east2';

// CORS origins for callable functions
export const CORS_ORIGINS = [
    "https://9000-firebase-ai-invigilator-1757825283554.cluster-44kx2eiocbhe2tyk3zoyo3ryuo.cloudworkstations.dev",
    /https:\/\/.*\.cloudworkstations\.dev/,
    "https://ai-invigilator-hkiit.web.app",
    /https:\/\/.*--ai-invigilator-hkiit\.web\.app/,
];

// Genkit AI Model parameters
export const AI_TEMPERATURE = 0;
export const AI_TOP_P = 0.1;

// Job-specific configurations
export const ZIP_COMPRESSION_LEVEL = 9;
export const VIDEO_FRAME_RATE = 1;

// Storage related constants
export const MAX_SCREENSHOT_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
export const DEFAULT_CLASS_QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB