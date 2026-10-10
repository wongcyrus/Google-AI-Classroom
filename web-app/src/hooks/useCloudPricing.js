import { useState, useEffect } from 'react';
import { db } from '../firebase-config';
import { doc, onSnapshot } from 'firebase/firestore';

export const DEFAULT_STORAGE_RATE_PER_GIB_MONTH = 0.023; // Google Cloud Storage Standard asia-east2 (Hong Kong)

export const DEFAULT_MODEL_PRICING = {
  'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gemini-3.7-flash': { input: 0.75, output: 3.75 },
  'gemini-3.7-pro': { input: 3.00, output: 15.00 },
  'gemini-3.5-transcribe': { input: 0.50, output: 2.50 },
  'gemini-3.5-transcribe-preview': { input: 0.50, output: 2.50 },
  'gemini-3.5-transcribe-live': { input: 0.60, output: 3.00 },
  'gemini-3.5-transcribe-live-preview': { input: 0.60, output: 3.00 },
  'gemini-3.1-flash-live-preview': { input: 0.60, output: 2.50 },
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
};

/**
 * Hook to subscribe to live Google Cloud pricing rates (Gemini models and Cloud Storage)
 * synced from Google Cloud Billing Catalog API into Firestore `system_config/pricing`.
 */
export const useCloudPricing = () => {
  const [pricing, setPricing] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const docRef = doc(db, 'system_config', 'pricing');
    const unsub = onSnapshot(docRef, (snap) => {
      if (snap.exists && snap.exists()) {
        setPricing(snap.data());
      }
      setLoading(false);
    }, (err) => {
      console.warn('Could not subscribe to system_config/pricing:', err);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const storageConfig = pricing?.['cloud-storage'];
  const storageRatePerGibMonth = Number(storageConfig?.ratePerGibMonth) || DEFAULT_STORAGE_RATE_PER_GIB_MONTH;
  const storageRegion = storageConfig?.region || 'asia-east2';
  const storageDescription = storageConfig?.description || 'Standard Storage Hong Kong';
  const lastSyncedAt = pricing?.lastSyncedAt || null;

  const getModelRate = (modelName = 'gemini-3.5-flash-lite') => {
    if (!modelName) return DEFAULT_MODEL_PRICING['gemini-3.5-flash-lite'];
    if (pricing && pricing[modelName]) return pricing[modelName];
    if (DEFAULT_MODEL_PRICING[modelName]) return DEFAULT_MODEL_PRICING[modelName];

    // Handle composite model strings with '+'
    if (typeof modelName === 'string' && modelName.includes('+')) {
      const parts = modelName.split('+').map(p => p.trim()).filter(Boolean);
      if (parts.length > 0) {
        let sumInput = 0;
        let sumOutput = 0;
        for (const p of parts) {
          const rate = getModelRate(p);
          sumInput += rate.input;
          sumOutput += rate.output;
        }
        return {
          input: Number((sumInput / parts.length).toFixed(4)),
          output: Number((sumOutput / parts.length).toFixed(4)),
        };
      }
    }

    // Handle preview suffix aliases
    if (typeof modelName === 'string') {
      const withoutPreview = modelName.replace(/-preview$/, '');
      if (pricing && pricing[withoutPreview]) return pricing[withoutPreview];
      if (DEFAULT_MODEL_PRICING[withoutPreview]) return DEFAULT_MODEL_PRICING[withoutPreview];
      const withPreview = `${modelName}-preview`;
      if (pricing && pricing[withPreview]) return pricing[withPreview];
      if (DEFAULT_MODEL_PRICING[withPreview]) return DEFAULT_MODEL_PRICING[withPreview];
    }

    return DEFAULT_MODEL_PRICING['gemini-3.5-flash-lite'];
  };

  return {
    pricing,
    storageRatePerGibMonth,
    storageRegion,
    storageDescription,
    getModelRate,
    lastSyncedAt,
    loading,
  };
};

export default useCloudPricing;
