// leaflet.heat is a plain script that expects a global `L`. ES imports are hoisted, so this tiny module
// exists to run first (see leafletHeat.js).
import L from 'leaflet';
if (typeof window !== 'undefined' && !window.L) window.L = L;
export default L;
