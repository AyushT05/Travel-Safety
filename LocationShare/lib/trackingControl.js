// One call that stops every source of location uploads from this phone.
import { stopBackgroundTracking } from './backgroundTracking';
import { stopForegroundWatch } from './foregroundTracking';

export async function stopAllTracking() {
  stopForegroundWatch();
  await stopBackgroundTracking();
}
