import { useState, useEffect } from 'react';
import { db } from '../firebase-config';
import { doc, onSnapshot } from 'firebase/firestore';

export const DEFAULT_STORAGE_RATE_PER_GIB_MONTH = 0.023; // Google Cloud Storage Standard asia-east2 (Hong Kong)

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

  return {
    pricing,
    storageRatePerGibMonth,
    storageRegion,
    storageDescription,
    lastSyncedAt,
    loading,
  };
};

export default useCloudPricing;
