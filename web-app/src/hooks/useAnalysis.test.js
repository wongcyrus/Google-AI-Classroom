import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnalysis } from './useAnalysis';
import { httpsCallable } from 'firebase/functions';

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(),
}));

vi.mock('../firebase-config', () => ({
  functions: {},
}));

describe('useAnalysis Hook', () => {
  const mockAnalyzeImage = vi.fn();
  const mockAnalyzeAllImages = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    httpsCallable.mockImplementation((_, fnName) => {
      if (fnName === 'analyzeImage') return mockAnalyzeImage;
      if (fnName === 'analyzeAllImages') return mockAnalyzeAllImages;
      return vi.fn();
    });
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useAnalysis('CLASS_123'));
    expect(result.current.isAnalyzing).toBe(false);
    expect(result.current.analysisResults).toEqual({});
  });

  it('skips runPerImageAnalysis if prompt is whitespace or empty', async () => {
    const { result } = renderHook(() => useAnalysis('CLASS_123'));
    await act(async () => {
      await result.current.runPerImageAnalysis({ s1: 'url1' }, '   ', 'model-1');
    });
    expect(mockAnalyzeImage).not.toHaveBeenCalled();
    expect(result.current.isAnalyzing).toBe(false);
  });

  it('runs per image analysis successfully with object results', async () => {
    mockAnalyzeImage.mockResolvedValueOnce({
      data: { s1: 'No cheating detected', s2: 'Focus on editor' },
    });

    const { result } = renderHook(() => useAnalysis('CLASS_123'));

    await act(async () => {
      await result.current.runPerImageAnalysis({ s1: 'url1', s2: 'url2' }, 'Check activity', 'gemini-1.5-flash');
    });

    expect(mockAnalyzeImage).toHaveBeenCalledWith({
      screenshots: { s1: 'url1', s2: 'url2' },
      prompt: 'Check activity',
      classId: 'CLASS_123',
      model: 'gemini-1.5-flash',
    });
    expect(result.current.analysisResults).toEqual({
      s1: 'No cheating detected',
      s2: 'Focus on editor',
    });
    expect(result.current.isAnalyzing).toBe(false);
  });

  it('handles non-object response in runPerImageAnalysis', async () => {
    mockAnalyzeImage.mockResolvedValueOnce({ data: 'Generic string output' });

    const { result } = renderHook(() => useAnalysis('CLASS_123'));

    await act(async () => {
      await result.current.runPerImageAnalysis({ s1: 'url1' }, 'Check', null);
    });

    expect(result.current.analysisResults).toEqual({
      result: 'Generic string output',
    });
  });

  it('catches and formats errors in runPerImageAnalysis', async () => {
    mockAnalyzeImage.mockRejectedValueOnce(new Error('Quota exceeded'));

    const { result } = renderHook(() => useAnalysis('CLASS_123'));

    await act(async () => {
      await result.current.runPerImageAnalysis({ s1: 'url1' }, 'Check', 'model-1');
    });

    expect(result.current.analysisResults).toEqual({
      error: 'Quota exceeded',
    });
    expect(result.current.isAnalyzing).toBe(false);
  });

  it('runs all images analysis with string summary result', async () => {
    mockAnalyzeAllImages.mockResolvedValueOnce({
      data: 'Class-wide summary: 95% on task.',
    });

    const { result } = renderHook(() => useAnalysis('CLASS_123'));

    await act(async () => {
      await result.current.runAllImagesAnalysis({ s1: 'url1', s2: 'url2' }, 'Summarize class', 'gemini-2.0-flash');
    });

    expect(mockAnalyzeAllImages).toHaveBeenCalledWith({
      screenshots: { s1: 'url1', s2: 'url2' },
      prompt: 'Summarize class',
      classId: 'CLASS_123',
      model: 'gemini-2.0-flash',
    });
    expect(result.current.analysisResults).toEqual({
      'All Students (Class Summary)': 'Class-wide summary: 95% on task.',
    });
  });

  it('runs all images analysis with object result and handles error', async () => {
    mockAnalyzeAllImages.mockResolvedValueOnce({
      data: { summary: 'Good' },
    });

    const { result } = renderHook(() => useAnalysis('CLASS_123'));

    await act(async () => {
      await result.current.runAllImagesAnalysis({ s1: 'url1' }, 'Check', 'model-1');
    });

    expect(result.current.analysisResults).toEqual({ summary: 'Good' });

    // Error case
    mockAnalyzeAllImages.mockRejectedValueOnce(new Error('Network failure'));
    await act(async () => {
      await result.current.runAllImagesAnalysis({ s1: 'url1' }, 'Check again', 'model-1');
    });
    expect(result.current.analysisResults).toEqual({ error: 'Network failure' });
  });

  it('allows manually setting analysis results', () => {
    const { result } = renderHook(() => useAnalysis('CLASS_123'));
    act(() => {
      result.current.setAnalysisResults({ custom: '123' });
    });
    expect(result.current.analysisResults).toEqual({ custom: '123' });
  });
});
