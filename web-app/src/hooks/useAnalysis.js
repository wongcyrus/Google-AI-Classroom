
import { useState, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase-config';

export const useAnalysis = (classId) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResults, setAnalysisResults] = useState({});

  const runPerImageAnalysis = useCallback(async (screenshotsToAnalyze, prompt) => {
    if (!prompt.trim()) return;
    console.log(`[${new Date().toISOString()}] Running per-image analysis for:`, Object.keys(screenshotsToAnalyze));
    const analyzeImage = httpsCallable(functions, 'analyzeImage');
    try {
      setIsAnalyzing(true);
      const result = await analyzeImage({ screenshots: screenshotsToAnalyze, prompt, classId });
      console.log(`[${new Date().toISOString()}] Per-image analysis result for ${Object.keys(screenshotsToAnalyze)}:`, result.data);
      setAnalysisResults(prev => ({ ...prev, ...result.data }));
    } catch (error) {
      console.error("Error calling analyzeImage function: ", error);
    } finally {
      setIsAnalyzing(false);
    }
  }, [classId]);

  const runAllImagesAnalysis = useCallback(async (screenshotsToAnalyze, prompt) => {
    if (!prompt.trim()) return;
    console.log(`[${new Date().toISOString()}] Running all-images analysis for ${Object.keys(screenshotsToAnalyze).length} images.`);
    const analyzeAllImages = httpsCallable(functions, 'analyzeAllImages');
    try {
      setIsAnalyzing(true);
      const result = await analyzeAllImages({ screenshots: screenshotsToAnalyze, prompt, classId });
      console.log(`[${new Date().toISOString()}] All-images analysis result:`, result.data);
      setAnalysisResults(prev => ({ ...prev, 'All Images': result.data }));
    } catch (error) {
      console.error("Error calling analyzeAllImages function: ", error);
    } finally {
      setIsAnalyzing(false);
    }
  }, [classId]);

  return { isAnalyzing, analysisResults, runPerImageAnalysis, runAllImagesAnalysis, setAnalysisResults };
};
