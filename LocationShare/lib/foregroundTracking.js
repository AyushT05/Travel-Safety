// The ONE foreground GPS watcher for the whole app.
//
// Why this is a module and not a ref inside ActiveTracking: the screen can unmount while sharing
// continues (Back button). A ref dies with the screen, so the watcher it pointed to kept running
// with nobody holding its handle, and each re-open started yet another one. "Stop Sharing" could
// then only remove the newest, and the older ones kept uploading fixes. Here there is exactly one
// handle, owned by the module, so stop always stops everything.
import * as Location from 'expo-location';

const OPTIONS = { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 0 };

let sub = null;
let generation = 0;

function removeCurrent() {
  const s = sub;
  sub = null;
  try { s?.remove(); } catch { /* already removed */ }
}

// Replaces any running watcher. Resolves true if this call's watcher is the live one.
export async function startForegroundWatch(onFix) {
  const mine = ++generation;
  removeCurrent();
  const s = await Location.watchPositionAsync(OPTIONS, onFix);
  if (mine !== generation) {            // stop (or another start) happened while we were awaiting
    try { s.remove(); } catch { /* ignore */ }
    return false;
  }
  sub = s;
  return true;
}

export function stopForegroundWatch() {
  generation += 1;                      // also cancels a start that is still awaiting
  removeCurrent();
}

export const isForegroundWatching = () => sub !== null;
