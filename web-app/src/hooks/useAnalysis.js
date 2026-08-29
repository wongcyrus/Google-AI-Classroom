import { useState, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase-config';

export const useAnalysis = (classId) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResults, setAnalysisResults] = useState({});

  const runPerImageAnalysis = useCallback(async (screenshotsToAnalyze, prompt, model) => {
    if (!prompt.trim()) return;
    console.log(`[${new Date().toISOString()}] Running per-image analysis using model ${model || 'default'} for:`, Object.keys(screenshotsToAnalyze));
    const analyzeImage = httpsCallable(functions, 'analyzeImage');
    try {
      setIsAnalyzing(true);
      const result = await analyzeImage({ screenshots: screenshotsToAnalyze, prompt, classId, model });
      console.log(`[${new Date().toISOString()}] Per-image analysis result for ${Object.keys(screenshotsToAnalyze)}:`, result.data);
      if (result.data && typeof result.data === 'object') {
        setAnalysisResults(prev => ({ ...prev, ...result.data }));
      } else {
        setAnalysisResults({ result: result.data });
      }
    } catch (error) {
      console.error("Error calling analyzeImage function: ", error);
      setAnalysisResults({ error: error.message || 'Analysis failed' });
    } finally {
      setIsAnalyzing(false);
    }
  }, [classId]);

  const runAllImagesAnalysis = useCallback(async (screenshotsToAnalyze, prompt, model) => {
    if (!prompt.trim()) return;
    console.log(`[${new Date().toISOString()}] Running all-images analysis using model ${model || 'default'} for ${Object.keys(screenshotsToAnalyze).length} images.`);
    const analyzeAllImages = httpsCallable(functions, 'analyzeAllImages');
    try {
      setIsAnalyzing(true);
      const result = await analyzeAllImages({ screenshots: screenshotsToAnalyze, prompt, classId, model });
      console.log(`[${new Date().toISOString()}] All-images analysis result:`, result.data);
      if (typeof result.data === 'string') {
        setAnalysisResults({ 'All Students (Class Summary)': result.data });
      } else if (result.data && typeof result.data === 'object') {
        setAnalysisResults(prev => ({ ...prev, ...result.data }));
      }
    } catch (error) {
      console.error("Error calling analyzeAllImages function: ", error);
      setAnalysisResults({ error: error.message || 'Analysis failed' });
    } finally {
      setIsAnalyzing(false);
    }
  }, [classId]);

  return { isAnalyzing, analysisResults, runPerImageAnalysis, runAllImagesAnalysis, setAnalysisResults };
};
