import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizePasskeyError, checkPlatformAuthenticatorAvailable } from './passkeyErrorUtils';

describe('passkeyErrorUtils', () => {
  describe('normalizePasskeyError', () => {
    it('translates Android "provider not found" error into actionable screen lock setup steps', () => {
      const err = new Error('The operation failed because no credential provider was found.');
      const res = normalizePasskeyError(err, { isAndroid: true, isIOS: false });

      expect(res.type).toBe('android_screen_lock_missing');
      expect(res.title).toBe('Screen Lock & Biometrics Required');
      expect(res.resolutionSteps).toEqual(expect.arrayContaining([
        expect.stringContaining('Settings'),
        expect.stringContaining('Fingerprint'),
        expect.stringContaining('Google Password Manager'),
      ]));
    });

    it('translates Honor MagicOS 8.0 Android 14 provider missing error into specific GMS setup steps', () => {
      const err = new Error('CreateCredentialNoProviderException: TYPE_NO_CREATE_OPTIONS');
      const res = normalizePasskeyError(err, { isAndroid: true, isHonor: true });

      expect(res.type).toBe('android_screen_lock_missing');
      expect(res.title).toBe('Honor / MagicOS Passkey Setup Required');
      expect(res.resolutionSteps).toEqual(expect.arrayContaining([
        expect.stringContaining('Google Play Services'),
        expect.stringContaining('MagicOS 8.0'),
        expect.stringContaining('Autofill service'),
      ]));
    });

    it('translates un-paired phone or unregistered student scanning lecture QR', () => {
      const err = new Error('This phone passkey is not paired with any student account in the system. Please pair your phone with your account first.');
      const res = normalizePasskeyError(err);

      expect(res.type).toBe('phone_not_paired');
      expect(res.title).toBe('Phone Not Paired with Account');
      expect(res.action).toBe('pair_first');
      expect(res.resolutionSteps).toEqual(expect.arrayContaining([
        expect.stringContaining('Pair Mobile Phone'),
      ]));
    });

    it('translates browser "no passkey found" error into phone not paired guidance', () => {
      const err = new Error('No passkey found for domain it114115-2627.web.app');
      const res = normalizePasskeyError(err);

      expect(res.type).toBe('phone_not_paired');
      expect(res.title).toBe('Phone Not Paired with Account');
    });

    it('translates Android NotSupportedError into screen lock setup steps', () => {
      const err = new Error('The platform authenticator cannot satisfy the requested requirements.');
      err.name = 'NotSupportedError';
      const res = normalizePasskeyError(err, { isAndroid: true, isIOS: false });

      expect(res.type).toBe('android_screen_lock_missing');
    });

    it('translates iOS NotSupportedError / disabled keychain into Microsoft Authenticator guidance', () => {
      const err = new Error('The operation is not supported.');
      err.name = 'NotSupportedError';
      const res = normalizePasskeyError(err, { isAndroid: false, isIOS: true });

      expect(res.type).toBe('ios_keychain_missing');
      expect(res.title).toBe('iPhone Passkey Setting Required');
      expect(res.resolutionSteps).toEqual(expect.arrayContaining([
        expect.stringContaining('Microsoft Authenticator'),
        expect.stringContaining('iCloud Passwords & Keychain'),
      ]));
    });

    it('handles user cancellation clearly', () => {
      const err = new Error('User cancelled biometric verification');
      err.name = 'NotAllowedError';
      const res = normalizePasskeyError(err, { isAndroid: true, isIOS: false });

      expect(res.type).toBe('user_cancelled');
      expect(res.title).toBe('Biometric Scan Cancelled');
      expect(res.action).toBe('retry');
    });

    it('translates credential mismatch ("wrong key") and guides Android Chrome usage', () => {
      const err = new Error('Credential mismatch: This phone does not match the paired hardware key for this student.');
      const res = normalizePasskeyError(err, { isAndroid: true, isIOS: false });

      expect(res.type).toBe('credential_mismatch');
      expect(res.title).toBe('Browser or Phone Mismatch');
      expect(res.resolutionSteps).toEqual(expect.arrayContaining([
        expect.stringContaining('Google Chrome'),
        expect.stringContaining('Samsung Internet'),
      ]));
    });

    it('translates device mismatch', () => {
      const err = new Error('Device Mismatch: Attendance must be verified using your registered mobile phone.');
      const res = normalizePasskeyError(err, { isAndroid: true, isIOS: false });

      expect(res.type).toBe('credential_mismatch');
    });

    it('translates expired QR code or token', () => {
      const err = new Error('This pairing QR code has expired.');
      const res = normalizePasskeyError(err);

      expect(res.type).toBe('token_expired');
      expect(res.title).toBe('QR Code Expired');
    });

    it('translates 1-Phone = 1-Student hardware lock collision', () => {
      const err = new Error('Hardware Lock: This physical phone is already bound to student account (260111222@stu.vtc.edu.hk).');
      const res = normalizePasskeyError(err);

      expect(res.type).toBe('hardware_lock');
      expect(res.title).toBe('Phone Already Registered');
      expect(res.message).toContain('260111222@stu.vtc.edu.hk');
    });

    it('provides fallback generic error structure', () => {
      const err = new Error('Network timeout contacting server');
      const res = normalizePasskeyError(err);

      expect(res.type).toBe('generic_error');
      expect(res.message).toBe('Network timeout contacting server');
    });
  });

  describe('checkPlatformAuthenticatorAvailable', () => {
    const originalPKC = window.PublicKeyCredential;

    afterEach(() => {
      window.PublicKeyCredential = originalPKC;
    });

    it('returns true when platform authenticator is available', async () => {
      window.PublicKeyCredential = {
        isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
      };

      const res = await checkPlatformAuthenticatorAvailable();
      expect(res).toBe(true);
    });

    it('returns false when platform authenticator is not available', async () => {
      window.PublicKeyCredential = {
        isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(false),
      };

      const res = await checkPlatformAuthenticatorAvailable();
      expect(res).toBe(false);
    });

    it('handles absence of PublicKeyCredential gracefully by falling back to allowing attempt', async () => {
      delete window.PublicKeyCredential;
      const res = await checkPlatformAuthenticatorAvailable();
      expect(res).toBe(true);
    });
  });
});
