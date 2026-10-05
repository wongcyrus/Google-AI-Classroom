/**
 * Type definitions for Prompt Management & AI Task Dispatching.
 * Provides static type safety and nominal/branded ID typing to prevent
 * cross-category prompt assignment and runtime undefined property access.
 */

export type PromptCategory = 'images' | 'videos' | 'audios' | 'translations' | 'rubrics';

export type PromptAccessLevel = 'public' | 'private' | 'shared';

export type ImagePromptId = string & { readonly __brand: 'ImagePromptId' };
export type VideoPromptId = string & { readonly __brand: 'VideoPromptId' };
export type AudioPromptId = string & { readonly __brand: 'AudioPromptId' };
export type TranslationPromptId = string & { readonly __brand: 'TranslationPromptId' };

export type AnyPromptId = ImagePromptId | VideoPromptId | AudioPromptId | TranslationPromptId | string;

export interface PromptItem {
  id?: string;
  originalId?: string | null;
  name: string;
  category: PromptCategory;
  promptText: string;
  applyTo?: string | string[];
  accessLevel?: PromptAccessLevel;
  owner?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/**
 * Discriminated union for asynchronous data loading states.
 * Enforces narrowing before accessing data to prevent async race conditions.
 */
export type AsyncState<T> =
  | { status: 'idle'; data: null; error: null; loading: false }
  | { status: 'loading'; data: T | null; error: null; loading: true }
  | { status: 'success'; data: T; error: null; loading: false }
  | { status: 'error'; data: null; error: Error; loading: false };
