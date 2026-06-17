import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

type AddPassResult = {
  success: boolean;
  error?: string;
};

type PasskiteNativeModule = {
  addPassToWallet(passBase64: string): Promise<AddPassResult>;
  canAddPasses(): Promise<boolean>;
  isPassLibraryAvailable(): Promise<boolean>;
  containsPass(passTypeIdentifier: string, serialNumber: string): Promise<boolean>;
};

const DEBUG_SERVER_URL = 'http://192.168.1.131:7777/event';
const DEBUG_SESSION_ID = 'wallet-testflight-open';

// #region debug-point B:report-wallet-debug
export function reportWalletDebug(hypothesisId: string, msg: string, data: Record<string, unknown> = {}, runId = 'pre-fix') {
  fetch(DEBUG_SERVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: DEBUG_SESSION_ID,
      runId,
      hypothesisId,
      location: 'lib/passkite.ts',
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

function getNativeModule(): PasskiteNativeModule | null {
  const nativeModule = Platform.OS === 'web' ? null : requireOptionalNativeModule<PasskiteNativeModule>('ExpoPasskite');
  // #region debug-point B:get-native-module
  reportWalletDebug('B', 'Resolved ExpoPasskite native module', {
    platform: Platform.OS,
    hasNativeModule: !!nativeModule,
  });
  // #endregion
  return nativeModule;
}

export async function addPassToWallet(passBase64: string): Promise<AddPassResult> {
  const nativeModule = getNativeModule();
  if (!nativeModule) {
    // #region debug-point B:add-pass-no-native-module
    reportWalletDebug('B', 'Cannot call addPassToWallet because native module is unavailable', {
      platform: Platform.OS,
      passBase64Length: passBase64.length,
    });
    // #endregion
    return {
      success: false,
      error: 'Apple Wallet no esta disponible en este build. Usa el development build de iOS con PassKit.',
    };
  }

  // #region debug-point D:add-pass-native-call
  reportWalletDebug('D', 'Calling native addPassToWallet', {
    passBase64Length: passBase64.length,
    hasPkpassZipHeader: passBase64.startsWith('UEsD'),
  });
  // #endregion
  return nativeModule.addPassToWallet(passBase64);
}

export async function canAddPasses(): Promise<boolean> {
  const nativeModule = getNativeModule();
  if (!nativeModule) return false;
  const result = await nativeModule.canAddPasses();
  // #region debug-point C:can-add-passes
  reportWalletDebug('C', 'Queried canAddPasses', { result });
  // #endregion
  return result;
}

export async function isPassLibraryAvailable(): Promise<boolean> {
  const nativeModule = getNativeModule();
  if (!nativeModule) return false;
  const result = await nativeModule.isPassLibraryAvailable();
  // #region debug-point C:is-pass-library-available
  reportWalletDebug('C', 'Queried isPassLibraryAvailable', { result });
  // #endregion
  return result;
}

export async function containsPass(passTypeIdentifier: string, serialNumber: string): Promise<boolean> {
  const nativeModule = getNativeModule();
  if (!nativeModule) return false;
  return nativeModule.containsPass(passTypeIdentifier, serialNumber);
}
