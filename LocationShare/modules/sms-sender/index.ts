import { requireNativeModule } from 'expo';

// Null in Expo Go / iOS / any build without the native module, so callers fall back
// to the SMS composer instead of crashing at import time.
let native: { send(to: string, body: string): Promise<boolean> } | null = null;
try {
  native = requireNativeModule('SmsSender');
} catch {
  native = null;
}
export default native;
