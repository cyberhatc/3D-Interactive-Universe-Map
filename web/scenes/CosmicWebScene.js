import * as THREE from 'three';
import { BaseScene } from './BaseScene.js';

const MORPH_ELLIPTICAL = 0;
const MORPH_S0 = 1;
const MORPH_SPIRAL = 2;
const MORPH_IRREGULAR = 3;

const ATLAS_CELLS = 4;
const ATLAS_CELL = 128;
const ATLAS_SIZE = ATLAS_CELLS * ATLAS_CELL;

// Bright SDSS galaxies whose real photographic cutouts we try to show.
const PHOTO_POOL = 8;
const PHOTO_MAX_CANDIDATES = 300;

function makeAtlasCell(ctx, cx, cy, r, kind, seed) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    switch (kind) {
        case MORPH_ELLIPTICAL:
            g.addColorStop(0.0, 'rgba(255,246,220,0.98)');
            g.addColorStop(0.18, 'rgba(255,226,180,0.85)');
            g.addColorStop(0.45, 'rgba(255,196,140,0.42)');
            g.addColorStop(1.0, 'rgba(255,180,120,0.0)');
            break;
        case MORPH_S0:
            g.addColorStop(0.0, 'rgba(255,250,235,0.99)');
            g.addColorStop(0.12, 'rgba(255,232,195,0.9)');
            g.addColorStop(0.35, 'rgba(250,215,170,0.55)');
            g.addColorStop(0.75, 'rgba(240,200,150,0.18)');
            g.addColorStop(1.0, 'rgba(230,190,140,0.0)');
            break;
        case MORPH_SPIRAL:
            g.addColorStop(0.0, 'rgba(255,248,225,0.99)');
            g.addColorStop(0.1, 'rgba(255,220,175,0.95)');
            g.addColorStop(0.35, 'rgba(255,205,160,0.5)');
            g.addColorStop(0.8, 'rgba(200,210,235,0.16)');
            g.addColorStop(1.0, 'rgba(180,200,235,0.0)');
            break;
        default:
            g.addColorStop(0.0, 'rgba(255,250,235,0.98)');
            g.addColorStop(0.3, 'rgba(255,220,180,0.6)');
            g.addColorStop(0.7, 'rgba(255,200,160,0.25)');
            g.addColorStop(1.0, 'rgba(240,190,150,0.0)');
            break;
    }
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    if (kind === MORPH_SPIRAL) {
        // Two log-spiral arms + bluish disk sheen.
        ctx.save();
        ctx.translate(cx, cy);
        ctx.globalCompositeOperation = 'lighter';
        for (let arm = 0; arm < 2; arm++) {
            ctx.beginPath();
            let first = true;
            for (let a = 0; a < Math.PI * 1.9; a += 0.06) {
                const rr = (a / (Math.PI * 2)) * r * 0.98;
                const x = rr * Math.cos(a + arm * Math.PI);
                const y = rr * Math.sin(a + arm * Math.PI) * 0.62;
                if (first) { ctx.moveTo(x, y); first = false; }
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = 'rgba(160,180,255,0.28)';
            ctx.lineWidth = 3.0;
            ctx.stroke();
        }
        ctx.restore();
    }
    if (kind === MORPH_IRREGULAR) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.globalCompositeOperation = 'lighter';
        const rand = mulberry32(seed);
        for (let i = 0; i < 26; i++) {
            const a = rand() * Math.PI * 2;
            const rr = r * (0.15 + 0.85 * rand() * rand());
            const px = rr * Math.cos(a);
            const py = rr * Math.sin(a) * 0.6;
            const pr = r * (0.05 + 0.2 * rand());
            const pg = ctx.createRadialGradient(px, py, 0, px, py, pr);
            pg.addColorStop(0, `rgba(255,235,200,${0.35 + 0.4 * rand()})`);
            pg.addColorStop(1, 'rgba(255,200,160,0)');
            ctx.fillStyle = pg;
            ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
        }
        ctx.restore();
    }
}

function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export class CosmicWebScene extends BaseScene {
    constructor() {
        super('cosmic-web', { near: 0.1, far: 20000 });
        this.galaxyPoints = null;
        this.galaxyData = null;
        this.starfield = null;
        this.earthMarker = null;
        this.waveSphere = null;
        this.atlas = null;
        this.galaxyInfo = null;
        this.photoSprites = [];
        this.photoActive = new Set();
        this.photoQueue = [];
        this.onPhotoFallback = null;
        this.cutoutCache = new Map();
        this.controls = null;
    }

    async init(galaxyData) {
        this.galaxyData = galaxyData;
        this.createStarfield();
        this.buildGalaxyAtlas();
        await this.loadGalaxies();
        this.addEarthMarker();
        this.addAxes();
    }

    buildGalaxyAtlas() {
        const canvas = document.createElement('canvas');
        canvas.width = ATLAS_SIZE;
        canvas.height = ATLAS_CELL;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_CELL);
        for (let i = 0; i < ATLAS_CELLS; i++) {
            const cx = i * ATLAS_CELL + ATLAS_CELL / 2;
            const cy = ATLAS_CELL / 2;
            const r = ATLAS_CELL * 0.46;
            makeAtlasCell(ctx, cx, cy, r, i, 1234 + i * 77);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        tex.needsUpdate = true;
        this.atlas = tex;
    }

    createStarfield() {
        this.starfield = new THREE.Group();

        const fieldStars = 9000;
        const bandStars = 4500;
        const total = fieldStars + bandStars;
        const positions = new Float32Array(total * 3);
        const colors = new Float32Array(total * 3);
        const RADIUS = 9000;

        let idx = 0;
        for (let i = 0; i < fieldStars; i++) {
            const u = Math.random() * 2 - 1;
            const phi = Math.acos(u);
            const theta = Math.random() * Math.PI * 2;
            const r = RADIUS * (1 + Math.random() * 0.02);
            positions[idx * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[idx * 3 + 1] = r * Math.cos(phi);
            positions[idx * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
            const b = 0.35 + Math.random() * 0.5;
            colors[idx * 3] = b;
            colors[idx * 3 + 1] = b;
            colors[idx * 3 + 2] = b + Math.random() * 0.15;
            idx++;
        }
        for (let i = 0; i < bandStars; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.PI / 2 + (Math.random() - 0.5) * 0.28;
            const r = RADIUS * (1 + Math.random() * 0.02);
            positions[idx * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[idx * 3 + 1] = r * Math.cos(phi);
            positions[idx * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
            const warm = Math.random() < 0.65;
            const b = 0.5 + Math.random() * 0.5;
            colors[idx * 3] = warm ? b : b * 0.75;
            colors[idx * 3 + 1] = warm ? b * 0.85 : b * 0.8;
            colors[idx * 3 + 2] = warm ? b * 0.6 : b;
            idx++;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 1.6,
            vertexColors: true,
            sizeAttenuation: false,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            fog: false,
        });

        const stars = new THREE.Points(geometry, material);
        stars.frustumCulled = false;
        this.starfield.add(stars);
        this.scene.add(this.starfield);
    }

    async loadGalaxies() {
        if (!this.galaxyData) return;
        const { positions, colors, sizes, morphs, bA } = this.galaxyData;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        if (morphs) geometry.setAttribute('morph', new THREE.BufferAttribute(morphs, 1));
        if (bA) geometry.setAttribute('bA', new THREE.BufferAttribute(bA, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uScale: { value: window.innerHeight / 2 },
                uAtlas: { value: this.atlas },
                uOpacity: { value: 0.9 },
            },
            vertexShader: `
                attribute float size;
                attribute vec3 color;
                attribute float morph;
                attribute float bA;
                varying vec3 vColor;
                varying float vMorph;
                varying float vB_a;
                varying float vPA;
                uniform float uScale;
                float hashPA(vec2 p) {
                    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
                }
                void main() {
                    vColor = color;
                    vMorph = morph;
                    vB_a = max(bA, 0.12);
                    vPA = hashPA(position.xy * 0.013 + position.zz) * 3.14159265;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    float pointSize = size * uScale / max(-mvPosition.z, 1.0);
                    gl_PointSize = clamp(pointSize, 0.6, 220.0);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D uAtlas;
                uniform float uOpacity;
                varying vec3 vColor;
                varying float vMorph;
                varying float vB_a;
                varying float vPA;
                void main() {
                    vec2 p = gl_PointCoord * 2.0 - 1.0;
                    float c = cos(vPA);
                    float s = sin(vPA);
                    vec2 rp = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
                    rp.y /= vB_a;
                    float r2 = dot(rp, rp);
                    if (r2 > 1.0) discard;
                    float cell = floor(vMorph + 0.5);
                    vec2 uv = vec2((gl_PointCoord.x + cell) / ${ATLAS_CELLS}.0, gl_PointCoord.y);
                    vec3 galaxy = texture2D(uAtlas, uv).rgb;
                    float edge = smoothstep(1.0, 0.55, r2);
                    float core = 1.0 - smoothstep(0.0, 0.25, r2) * 0.35;
                    float alpha = edge * (0.45 + 0.55 * core) * uOpacity;
                    gl_FragColor = vec4(galaxy * vColor * 1.35, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.galaxyPoints = new THREE.Points(geometry, material);
        this.galaxyPoints.frustumCulled = false;
        this.scene.add(this.galaxyPoints);

        this.scene.background = new THREE.Color(0x000000);
        this.scene.fog = new THREE.Fog(0x000000, 800, 6000);
    }

    setGalaxyInfo(info) {
        // { positions, ra, dec, survey, brightness, mag, size } aligned with galaxyData
        this.galaxyInfo = info;
        if (info) this.buildPhotoCandidates(info);
    }

    buildPhotoCandidates(info) {
        const cands = [];
        for (let i = 0; i < info.brightness.length; i++) {
            if (info.survey[i] === 0 && info.brightness[i] > 0.55) {
                cands.push({
                    index: i,
                    x: info.positions[i * 3],
                    y: info.positions[i * 3 + 1],
                    z: info.positions[i * 3 + 2],
                    ra: info.ra[i],
                    dec: info.dec[i],
                    size: Math.max(info.size[i], 0.05),
                    mag: info.mag[i],
                });
            }
        }
        cands.sort((a, b) => b.brightness - a.brightness || b.size - a.size);
        this.photoCandidates = cands.slice(0, PHOTO_MAX_CANDIDATES);
        this._photoScores = new Map();
    }

    cutoutUrl(ra, dec) {
        const scale = 0.4;
        return `https://skyserver.sdss.org/dr18/SkyServerWS/ImgCutout/getjpeg?ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}&scale=${scale}&width=256&height=256`;
    }

    ensurePhotoFor(index) {
        const info = this.galaxyInfo;
        if (!info || this.photoActive.has(index) || this.cutoutCache.get(index)) return;
        if (this.photoQueue.length > PHOTO_POOL && this.photoQueue.indexOf(index) === -1) return;
        if (this.cutoutCache.has(index)) return;
        this.photoActive.add(index);
        const g = this.photoCandidates.find(c => c.index === index);
        if (!g) { this.photoActive.delete(index); return; }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const tex = new THREE.Texture(img);
            tex.minFilter = THREE.LinearFilter;
            tex.needsUpdate = true;
            this.cutoutCache.set(index, tex);
            this.attachPhotoSprite(index, tex);
            this.photoActive.delete(index);
        };
        img.onerror = () => {
            this.cutoutCache.set(index, null);
            this.photoActive.delete(index);
            if (this.onPhotoFallback) this.onPhotoFallback(g.ra, g.dec);
        };
        img.src = this.cutoutUrl(g.ra, g.dec);
    }

    attachPhotoSprite(index, tex) {
        const g = this.photoCandidates.find(c => c.index === index);
        if (!g) return;
        const mat = new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            depthWrite: false,
            opacity: 1.0,
            blending: THREE.NormalBlending,
            rotation: 0.4,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.position.set(g.x, g.y, g.z);
        sprite.scale.setScalar(g.size * 6);
        sprite.userData.galaxyIndex = index;
        this.photoSprites.push(sprite);
        this.scene.add(sprite);
    }

    update(deltaTime, cameraPosition) {
        if (this.galaxyPoints) {
            this.galaxyPoints.rotation.y += 0.00005;
        }
        if (this.starfield) {
            this.starfield.rotation.y += deltaTime * 0.0005;
        }
        if (this.earthMarker && this.earthMarker.userData.pulse) {
            const pulse = this.earthMarker.userData.pulse;
            pulse.scale.setScalar(6 + Math.sin(performance.now() * 0.002) * 2);
        }

        // Load real SDSS photos for bright galaxies near the camera.
        if (this.photoCandidates && cameraPosition) {
            const activeCount = this.photoSprites.length + this.photoActive.size;
            let budget = PHOTO_POOL - activeCount;
            if (budget > 0) {
                let best = null, bestD = Infinity;
                for (const c of this.photoCandidates) {
                    const dx = c.x - cameraPosition.x, dy = c.y - cameraPosition.y, dz = c.z - cameraPosition.z;
                    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    const reach = Math.max(0.8, c.size * 20);
                    if (d < reach && d < bestD) { best = c; bestD = d; }
                }
                if (best && !this.photoActive.has(best.index) && !this.cutoutCache.get(best.index)) {
                    this.ensurePhotoFor(best.index);
                }
            }

            // Fade/remove photo sprites once the camera has flown past.
            for (let i = this.photoSprites.length - 1; i >= 0; i--) {
                const sp = this.photoSprites[i];
                const g = this.photoCandidates.find(c => c.index === sp.userData.galaxyIndex);
                if (!g) { this.scene.remove(sp); this.photoSprites.splice(i, 1); continue; }
                const dx = g.x - cameraPosition.x, dy = g.y - cameraPosition.y, dz = g.z - cameraPosition.z;
                const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (d > Math.max(2.0, g.size * 30)) {
                    this.scene.remove(sp);
                    sp.material.map.dispose();
                    sp.material.dispose();
                    this.photoSprites.splice(i, 1);
                }
            }
        }
    }

    replaceGalaxyData(data) {
        if (!this.galaxyPoints) return;
        const material = this.galaxyPoints.material;
        this.scene.remove(this.galaxyPoints);
        this.galaxyPoints.geometry.dispose();
        this.galaxyData = data;

        const { positions, colors, sizes, morphs, bA } = data;
        const count = positions.length / 3;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        if (morphs) geometry.setAttribute('morph', new THREE.BufferAttribute(morphs, 1));
        if (bA) geometry.setAttribute('bA', new THREE.BufferAttribute(bA, 1));

        this.galaxyPoints = new THREE.Points(geometry, material);
        this.galaxyPoints.frustumCulled = false;
        this.scene.add(this.galaxyPoints);
        return count;
    }

    addLightWaveSphere() {
        const geometry = new THREE.SphereGeometry(1, 48, 24);
        const material = new THREE.MeshBasicMaterial({
            color: 0x66ccff,
            wireframe: true,
            transparent: true,
            opacity: 0.35,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        this.waveSphere = new THREE.Mesh(geometry, material);
        this.waveSphere.visible = false;
        this.scene.add(this.waveSphere);
    }

    setLightWave(radiusMpc, active) {
        if (!this.waveSphere) return;
        if (!active) {
            this.waveSphere.visible = false;
            return;
        }
        this.waveSphere.visible = true;
        this.waveSphere.scale.setScalar(Math.max(radiusMpc, 1));
    }

    addEarthMarker() {
        const geometry = new THREE.SphereGeometry(2, 16, 16);
        const material = new THREE.MeshBasicMaterial({ color: 0x4a9fff, transparent: true, opacity: 0.9 });
        this.earthMarker = new THREE.Mesh(geometry, material);
        this.earthMarker.position.set(0, 0, 0);
        this.scene.add(this.earthMarker);

        const pulse = new THREE.Mesh(
            new THREE.SphereGeometry(1, 32, 16),
            new THREE.MeshBasicMaterial({
                color: 0x4a9fff,
                transparent: true,
                opacity: 0.25,
                wireframe: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            })
        );
        pulse.scale.setScalar(6);
        this.earthMarker.add(pulse);
        this.earthMarker.userData.pulse = pulse;
    }

    addAxes() {
        const axesLength = 200;
        const axesHelper = new THREE.AxesHelper(axesLength);
        this.scene.add(axesHelper);
    }

    resize(width, height) {
        super.resize(width, height);
        if (this.galaxyPoints) {
            this.galaxyPoints.material.uniforms.uScale.value = height / 2;
        }
    }

    setCameraPosition(pos) {
        this.camera.position.copy(pos);
    }

    getCamera() {
        return this.camera;
    }

    getScene() {
        return this.scene;
    }
}
