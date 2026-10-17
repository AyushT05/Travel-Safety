// Minimal layout/SVG stubs so Leaflet can render vector layers under jsdom.
Object.defineProperty(HTMLElement.prototype, "clientWidth",  { configurable:true, get(){ return 800; } });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable:true, get(){ return 600; } });
if (window.SVGSVGElement) window.SVGSVGElement.prototype.createSVGRect = function(){ return {}; };
