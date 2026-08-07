import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Procedural equirectangular textures for the Sun, planets and natural
// satellites. These are generated deterministically (no network, no CORS) so
// the Solar System always looks like the real thing even when offline.
// ---------------------------------------------------------------------------

const RES = 512;
const GAS = 768;

function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// Smooth Perlin-style 2D value noise, seeded so textures are reproducible.
function createNoise(seed) {
    const p = new Uint8Array(512);
    const p0 = new Uint8Array(256);
    const rnd = mulberry32(seed);
    for (let i = 0; i < 256; i++) p0[i] = i;
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = p0[i]; p0[i] = p0[j]; p0[j] = t;
    }
    for (let i = 0; i < 512; i++) p[i] = p0[i & 255];

    const grad = (hash, x, y) => {
        const h = hash & 7;
        const u = h < 4 ? x : y;
        const v = h < 2 ? y : x;
        return (h & 1 ? -u : u) + (h & 2 ? -v : v);
    };
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (a, b, t) => a + t * (b - a);

    function noise(x, y) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const xf = x - Math.floor(x);
        const yf = y - Math.floor(y);
        const u = fade(xf);
        const v = fade(yf);
        const aa = p[p[X] + Y];
        const ab = p[p[X] + ((Y + 1) & 255)];
        const ba = p[p[((X + 1) & 255)] + Y];
        const bb = p[p[((X + 1) & 255)] + ((Y + 1) & 255)];
        const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
        const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
        return lerp(x1, x2, v);
    }

    function fbm(x, y, oct) {
        let val = 0, amp = 1, freq = 1, maxv = 0;
        for (let o = 0; o < oct; o++) {
            val += amp * noise(x * freq, y * freq);
            maxv += amp;
            amp *= 0.5;
            freq *= 2;
        }
        return val / maxv; // ~[-1,1]
    }

    return {
        noise,
        fbm,
        fbm01(x, y, oct) { return fbm(x, y, oct) * 0.5 + 0.5; },
        rand: rnd,
    };
}

// Build a CanvasTexture by evaluating fn(u, v) -> [r,g,b] (0-255) per pixel.
function buildTexture(w, h, fn) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
        const v = y / (h - 1);
        for (let x = 0; x < w; x++) {
            const u = x / (w - 1);
            const c = fn(u, v);
            const i = (y * w + x) * 4;
            d[i] = c[0];
            d[i + 1] = c[1];
            d[i + 2] = c[2];
            d[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mixCol = (a, b, t) => {
    t = clamp(t, 0, 1);
    return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
};
function mix(a, b, t) { return a * (1 - t) + b * t; }
const finalize = c => [clamp(c[0], 0, 255), clamp(c[1], 0, 255), clamp(c[2], 0, 255)];

// ---------- individual texture builders ----------

function makeSunTexture() {
    const N = createNoise(101);
    const w = GAS, h = Math.floor(GAS / 2);
    return buildTexture(w, h, (u, v) => {
        const lat = (v - 0.5) * 2;
        const limb = 1.0 - Math.pow(Math.abs(lat), 1.6); // 0 at poles, 1 equator
        const gran = N.fbm01(u * 7, v * 7, 5);
        const t = 0.55 + 0.45 * limb * (0.8 + 0.2 * gran); // temperature 0..1
        let col = mixCol([255, 250, 215], [255, 200, 70], 1 - t);
        col = mixCol(col, [255, 80, 12], (1 - t) * 0.5);
        col = mixCol(col, [180, 40, 0], (1 - limb) * 0.9); // limb darkening
        return finalize(col);
    });
}

function makeCrateredTexture(seed, baseTone) {
    const N = createNoise(seed);
    const w = RES, h = Math.floor(RES / 2);
    const craters = [];
    for (let i = 0; i < 70; i++) {
        craters.push({
            u: N.rand(),
            v: 0.06 + N.rand() * 0.88,
            r: 0.012 + N.rand() * 0.045,
            depth: 0.25 + N.rand() * 0.6,
        });
    }
    const dark = [24, 22, 20];
    const light = [205, 199, 188];
    return buildTexture(w, h, (u, v) => {
        const n = Math.pow(N.fbm01(u * 6, v * 6, 6), 1.2);
        let col = mixCol(baseTone, [40, 36, 32], n * 0.6);
        const grain = N.fbm01(u * 55, v * 55, 3);
        col = mixCol(col, dark, grain * 0.15);
        for (const c of craters) {
            const du = (u - c.u) * 2.0;
            const dv = (v - c.v);
            const rr = Math.sqrt(du * du + dv * dv);
            if (rr < c.r * 1.2) {
                if (rr < c.r) {
                    col = mixCol(col, dark, c.depth * (1 - rr / c.r));
                } else {
                    const rim = (c.r * 1.2 - rr) / (c.r * 0.2);
                    col = mixCol(col, light, rim * c.depth * 0.45);
                }
            }
        }
        return finalize(col);
    });
}

function makeMercuryTexture() {
    return makeCrateredTexture(7, [138, 128, 117]);
}

function makeMoonTexture() {
    return makeCrateredTexture(12, [168, 164, 155]);
}

function makeVenusTexture() {
    const N = createNoise(5);
    const w = GAS, h = Math.floor(GAS / 2);
    return buildTexture(w, h, (u, v) => {
        const bands = N.fbm01(u * 10, v * 10, 6);
        const swirl = N.fbm01(u * 22, v * 22, 4);
        let col = mixCol([212, 182, 122], [250, 238, 200], bands);
        col = mixCol(col, [255, 252, 232], swirl * 0.3);
        const pole = 1.0 - Math.abs(v - 0.5) * 2;
        col = mixCol(col, [255, 248, 220], 0.18 * pole);
        return finalize(col);
    });
}

function makeEarthTexture() {
    const N = createNoise(9);
    const w = GAS, h = Math.floor(GAS / 2);
    const DEEP = [18, 48, 108];
    const SHALLOW = [36, 118, 170];
    const GREEN = [58, 122, 56];
    const DRY = [172, 142, 90];
    const MOUNTAIN = [128, 110, 96];
    const SNOW = [238, 240, 236];
    return buildTexture(w, h, (u, v) => {
        const cont = N.fbm01(u * 4.4 + 30, v * 4.4 + 17, 7);
        const detail = N.fbm01(u * 12, v * 12, 5);
        const humidity = N.fbm01(u * 6, v * 6, 4);
        const ice = v < 0.05 || v > 0.95;
        let col;
        if (cont > 0.53) {
            col = mixCol(GREEN, DRY, Math.pow(detail, 1.5));
            col = mixCol(col, MOUNTAIN, detail * detail * 0.6);
            if (ice || humidity > 0.84) col = mixCol(col, SNOW, 0.85);
        } else {
            const shallowness = (0.53 - cont) / 0.53;
            col = mixCol(DEEP, SHALLOW, shallowness < 0.15 ? 1 - shallowness / 0.15 : 0);
            if (ice) col = mixCol(col, SNOW, 0.7);
        }
        const cloud = N.fbm01(u * 7, v * 12, 5);
        if (cloud > 0.56) {
            col = mixCol(col, [240, 244, 248], clamp((cloud - 0.56) / 0.2, 0, 1) * 0.85);
        }
        return finalize(col);
    });
}

function makeMarsTexture() {
    const N = createNoise(21);
    const w = RES, h = Math.floor(RES / 2);
    return buildTexture(w, h, (u, v) => {
        const n = Math.pow(N.fbm01(u * 5, v * 7, 6), 1.3);
        const dark = N.fbm01(u * 9, v * 9, 4);
        let col = mixCol([188, 98, 46], [122, 52, 28], n);
        if (dark > 0.6) col = mixCol(col, [98, 62, 44], (dark - 0.6) / 0.4);
        if (v < 0.08) col = mixCol(col, [228, 222, 212], 0.9);
        if (v > 0.92) col = mixCol(col, [228, 222, 212], 0.9);
        return finalize(col);
    });
}

function makeGasGiantTexture(seed, palette) {
    const N = createNoise(seed);
    const w = GAS, h = Math.floor(GAS / 2);
    return buildTexture(w, h, (u, v) => {
        let t = v * palette.length;
        t += 0.55 * N.fbm(u * 3, v * 3, 4);
        const i0 = ((Math.floor(t) % palette.length) + palette.length) % palette.length;
        const i1 = (i0 + 1) % palette.length;
        let col = mixCol(palette[i0], palette[i1], clamp(t - Math.floor(t), 0, 1));
        const stripe = N.fbm01(u * 26, v * 26, 3);
        col = mixCol(col, [0, 0, 0], (stripe - 0.5) * 0.16);
        const pole = 1.0 - Math.abs(v - 0.5) * 2;
        col = mixCol(col, [25, 20, 32], Math.pow(1 - pole, 3) * 0.5);
        return finalize(col);
    });
}

function makeJupiterTexture() {
    const tex = makeGasGiantTexture(33, [
        [200, 176, 150], [240, 228, 205], [150, 110, 80],
        [232, 214, 184], [120, 86, 68], [244, 232, 208],
        [180, 150, 120], [230, 218, 190], [140, 104, 82], [246, 236, 212],
    ]);
    const canvas = tex.image;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const cx = W * 0.68, cy = H * 0.60;
    const rx = W * 0.055, ry = H * 0.10;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
    g.addColorStop(0, 'rgb(198,84,66)');
    g.addColorStop(0.6, 'rgb(170,64,54)');
    g.addColorStop(1, 'rgba(120,50,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(190,120,90,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 1.7, ry * 1.2, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    tex.needsUpdate = true;
    return tex;
}

function makeSaturnTexture() {
    return makeGasGiantTexture(57, [
        [230, 220, 200], [214, 198, 170], [238, 228, 204],
        [180, 150, 120], [224, 210, 184], [160, 130, 100],
        [210, 196, 172], [236, 228, 206],
    ]);
}

function makeUranusTexture() {
    const N = createNoise(77);
    const w = GAS, h = Math.floor(GAS / 2);
    return buildTexture(w, h, (u, v) => {
        const n = N.fbm(u * 4, v * 4, 3) * 0.06; // subtle
        const w0 = 1 + n;
        return finalize([
            184 * w0, 226 * w0, 244 * w0,
        ]);
    });
}

function makeNeptuneTexture() {
    const N = createNoise(101);
    const w = GAS, h = Math.floor(GAS / 2);
    return buildTexture(w, h, (u, v) => {
        const band = N.fbm(u * 6, v * 9, 4);
        let col = mixCol([58, 108, 190], [44, 88, 176], band * 0.5 + 0.5);
        const du = u - 0.55, dv = v - 0.62;
        const r2 = du * du + dv * dv * 2.2;
        if (r2 < 0.012) col = mixCol(col, [18, 30, 90], 0.6 * (1 - r2 / 0.012));
        return finalize(col);
    });
}

// Banded ring texture (Saturn's rings incl. Cassini division), maps radially.
function generateRingTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const stops = [
        [0.00, [205, 195, 175], 0.70],
        [0.18, [224, 214, 192], 0.95],
        [0.28, [200, 186, 160], 0.90],
        [0.34, [150, 140, 120], 0.75],
        [0.42, [112, 100, 86], 0.50],
        [0.46, [60, 52, 44], 0.15],
        [0.50, [232, 222, 198], 0.98],
        [0.68, [206, 194, 170], 0.92],
        [0.80, [176, 164, 140], 0.80],
        [1.00, [150, 140, 120], 0.55],
    ];
    for (let i = 0; i < 256; i++) {
        const tt = i / 255;
        let s0 = stops[0], s1 = stops[stops.length - 1];
        for (let s = 0; s < stops.length - 1; s++) {
            if (tt >= stops[s][0] && tt <= stops[s + 1][0]) { s0 = stops[s]; s1 = stops[s + 1]; break; }
        }
        const f = (tt - s0[0]) / Math.max(1e-6, s1[0] - s0[0]);
        const r = mix(s0[1][0], s1[1][0], f);
        const g = mix(s0[1][1], s1[1][1], f);
        const b = mix(s0[1][2], s1[1][2], f);
        const a = mix(s0[2], s1[2], f);
        ctx.fillStyle = `rgba(${r|0},${g|0},${b|0},${a})`;
        ctx.fillRect(0, i, 8, 1);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
}

const cache = {};

// Public: return a cached procedural texture keyed by body name.
export function getPlanetTexture(name) {
    if (!name) name = 'Earth';
    if (!cache[name]) {
        switch (name) {
            case 'Sun': cache[name] = makeSunTexture(); break;
            case 'Mercury': cache[name] = makeMercuryTexture(); break;
            case 'Venus': cache[name] = makeVenusTexture(); break;
            case 'Earth': cache[name] = makeEarthTexture(); break;
            case 'Mars': cache[name] = makeMarsTexture(); break;
            case 'Jupiter': cache[name] = makeJupiterTexture(); break;
            case 'Saturn': cache[name] = makeSaturnTexture(); break;
            case 'Uranus': cache[name] = makeUranusTexture(); break;
            case 'Neptune': cache[name] = makeNeptuneTexture(); break;
            case 'Moon': cache[name] = makeMoonTexture(); break;
            default: cache[name] = makeEarthTexture();
        }
    }
    return cache[name];
}

export function getRingTexture() {
    if (!cache.__rings) cache.__rings = generateRingTexture();
    return cache.__rings;
}