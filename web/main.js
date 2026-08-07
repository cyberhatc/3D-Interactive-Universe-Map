import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

let scene, camera, renderer, controls, points, composer;
let starfield;

const GALAXY_BINARY_URL = 'galaxies.bin';
const GALAXY_META_URL = 'galaxies.json';

const canvas = document.getElementById('three-canvas');
const POINT_SIZE = 2.0;
const FOG_NEAR = 800;
const FOG_FAR = 6000;
const MPC_TO_LY = 3.2615637771418799e6;
const FLOATS_PER_GALAXY = 11;

// Planck18-ish cosmology params for lookback-time integration
const COSMO = { H0: 67.66, Om: 0.30966, OL: 0.6889 };

// Full dataset (pre-filter). galaxyDistances/baseColors stay full-length;
// fullToVisible maps full index -> current geometry vertex (-1 if filtered out).
let fullCount = 0;
let baseColors = null;
let fullSizes = null;
let galaxyRas = null;
let galaxyDecs = null;
let galaxyRedshifts = null;
let galaxyMags = null;
let galaxyDistances = null;
let fullToVisible = null;

// Light speed wave state
let waveActive = false;
let waveRadius = 0;
let waveMaxRadius = 0;
let waveElapsedYears = 0;
let timeScale = 200e6;
let waveSphere = null;

// Interaction / camera state
let animating = false;
let lastInteraction = 0;
let userInteracting = false;
let currentFilter = 'all';

// UI elements
const statusEl = document.getElementById('status');
const countEl = document.getElementById('count');
const selectionEl = document.getElementById('selection');
const scaleNarrEl = document.getElementById('scale-narr');
const btnZoom = document.getElementById('btn-zoom');
const btnLightwave = document.getElementById('btn-lightwave');
const timeScaleSlider = document.getElementById('timescale-slider');
const timeScaleValue = document.getElementById('timescale-value');
const searchInput = document.getElementById('search-input');
const btnSearch = document.getElementById('btn-search');
const tourCaptionEl = document.getElementById('tour-caption');
const galaxyCard = document.getElementById('galaxy-card');
const cardBody = document.getElementById('card-body');
const cardClose = document.getElementById('card-close');

const TOURS = {
    'earth': {
        label: 'You Are Here',
        distance: 60,
        direction: null,
        caption: 'You are here. Earth is the single fixed point of reference in this entire map.',
    },
    'sloan': {
        label: 'Sloan Great Wall',
        distance: 320,
        direction: { ra: 192, dec: 3 },
        caption: 'Sloan Great Wall — one of the largest known structures in the universe (z ≈ 0.07), a vast filament of galaxies.',
    },
    'void': {
        label: 'Cosmic Void',
        distance: 800,
        direction: { ra: 200, dec: 20 },
        caption: 'Looking toward a cosmic void — a vast region with strikingly few galaxies.',
    },
};

const NEARBY_LIMIT_MPC = 150;

async function init() {
    setupScene();
    setupCamera();
    setupRenderer();
    setupComposer();
    setupControls();
    setupLights();
    createStarfield();
    await loadGalaxies();
    setupWaveSphere();
    setupButtons();
    startZoomOut();
    animate();
}

function setupScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(0x000000, FOG_NEAR, FOG_FAR);
}

function setupCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 20000);
    camera.position.set(0, 0, 500);
}

function setupRenderer() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

function setupComposer() {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.35, // strength
        0.45, // radius
        0.18  // threshold
    );
    composer.addPass(bloomPass);
}

function setupControls() {
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan = true;
    controls.minDistance = 1;
    controls.maxDistance = 5000;
    controls.target.set(0, 0, 0);

    controls.addEventListener('start', () => {
        userInteracting = true;
        controls.autoRotate = false;
    });
    controls.addEventListener('end', () => {
        userInteracting = false;
        lastInteraction = performance.now();
    });
}

function setupLights() {
    const ambient = new THREE.AmbientLight(0x404040, 2);
    scene.add(ambient);

    const pointLight = new THREE.PointLight(0xffffff, 1, 1000);
    pointLight.position.set(0, 0, 0);
    scene.add(pointLight);
}

function createStarfield() {
    starfield = new THREE.Group();

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
    starfield.add(stars);
    scene.add(starfield);
}

async function loadGalaxies() {
    statusEl.textContent = 'Loading galaxy metadata...';

    try {
        const metaRes = await fetch(GALAXY_META_URL);
        if (!metaRes.ok) throw new Error('Metadata not found');
        const meta = await metaRes.json();
        const floatsPer = meta.floats_per_galaxy || 7;

        statusEl.textContent = `Loading ${meta.count.toLocaleString()} galaxies...`;

        const binRes = await fetch(GALAXY_BINARY_URL);
        if (!binRes.ok) throw new Error('Binary data not found');
        const arrayBuffer = await binRes.arrayBuffer();

        if (floatsPer === 11) {
            parseGalaxyData(arrayBuffer, meta.count);
        } else {
            parseLegacyBinary(arrayBuffer, meta.count);
        }

        statusEl.textContent = `Loaded ${meta.count.toLocaleString()} galaxies`;
        countEl.textContent = `Distance range: ${meta.distance_range_mpc[0].toFixed(0)} - ${meta.distance_range_mpc[1].toFixed(0)} Mpc`;

    } catch (err) {
        console.error('Failed to load galaxies:', err);
        statusEl.textContent = 'Error: Could not load galaxy data. Run the pipeline first.';
        statusEl.style.color = '#ff6b6b';
        createFallbackGalaxies();
    }
}

function parseGalaxyData(arrayBuffer, expectedCount) {
    const view = new DataView(arrayBuffer);
    const count = view.getUint32(0, true);

    if (count !== expectedCount) {
        console.warn(`Count mismatch: binary has ${count}, metadata says ${expectedCount}`);
    }

    const floatOffset = 4;
    const floatCount = count * FLOATS_PER_GALAXY;
    const floatArray = new Float32Array(arrayBuffer, floatOffset, floatCount);

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    galaxyRas = new Float32Array(count);
    galaxyDecs = new Float32Array(count);
    galaxyRedshifts = new Float32Array(count);
    galaxyMags = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const base = i * FLOATS_PER_GALAXY;
        positions[i * 3] = floatArray[base];
        positions[i * 3 + 1] = floatArray[base + 1];
        positions[i * 3 + 2] = floatArray[base + 2];
        colors[i * 3] = floatArray[base + 3];
        colors[i * 3 + 1] = floatArray[base + 4];
        colors[i * 3 + 2] = floatArray[base + 5];
        sizes[i] = floatArray[base + 6];
        galaxyRas[i] = floatArray[base + 7];
        galaxyDecs[i] = floatArray[base + 8];
        galaxyRedshifts[i] = floatArray[base + 9];
        galaxyMags[i] = floatArray[base + 10];
    }

    buildGalaxyCloud(count, positions, colors, sizes);
}

function parseLegacyBinary(arrayBuffer, expectedCount) {
    const view = new DataView(arrayBuffer);
    const count = view.getUint32(0, true);

    const floatOffset = 4;
    const floatsPer = 7;
    const floatCount = count * floatsPer;
    const floatArray = new Float32Array(arrayBuffer, floatOffset, floatCount);

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const base = i * floatsPer;
        positions[i * 3] = floatArray[base];
        positions[i * 3 + 1] = floatArray[base + 1];
        positions[i * 3 + 2] = floatArray[base + 2];
        colors[i * 3] = floatArray[base + 3];
        colors[i * 3 + 1] = floatArray[base + 4];
        colors[i * 3 + 2] = floatArray[base + 5];
        sizes[i] = floatArray[base + 6];
    }

    galaxyRas = null;
    galaxyDecs = null;
    galaxyRedshifts = null;
    galaxyMags = null;

    buildGalaxyCloud(count, positions, colors, sizes);
}

// We keep the raw x/y/z positions in a persistent array for filter rebuilds.
let positionsByIndex = null;

function buildGalaxyCloud(count, positions, colors, sizes) {
    fullCount = count;
    baseColors = new Float32Array(colors);
    fullSizes = new Float32Array(sizes);
    positionsByIndex = new Float32Array(positions);
    galaxyDistances = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        galaxyDistances[i] = Math.sqrt(x * x + y * y + z * z);
    }

    const all = new Array(count);
    for (let i = 0; i < count; i++) all[i] = i;
    rebuildPoints(all);

    addEarthMarker();
    addAxes();
}

function rebuildPoints(visibleIndices) {
    if (points) {
        scene.remove(points);
        points.geometry.dispose();
        points.material.dispose();
    }

    const n = visibleIndices.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);

    fullToVisible = new Int32Array(fullCount).fill(-1);

    for (let v = 0; v < n; v++) {
        const i = visibleIndices[v];
        fullToVisible[i] = v;
        positions[v * 3] = positionsByIndex[i * 3];
        positions[v * 3 + 1] = positionsByIndex[i * 3 + 1];
        positions[v * 3 + 2] = positionsByIndex[i * 3 + 2];
        colors[v * 3] = baseColors[i * 3];
        colors[v * 3 + 1] = baseColors[i * 3 + 1];
        colors[v * 3 + 2] = baseColors[i * 3 + 2];
        sizes[v] = fullSizes[i];
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
        size: POINT_SIZE,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
}

function addEarthMarker() {
    const geometry = new THREE.SphereGeometry(2, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0x4a9fff, transparent: true, opacity: 0.9 });
    const earth = new THREE.Mesh(geometry, material);
    earth.position.set(0, 0, 0);
    scene.add(earth);

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
    earth.add(pulse);
    earth.userData.pulse = pulse;

    const label = createTextLabel('You are here', new THREE.Vector3(0, 6, 0));
    scene.add(label);
}

function addAxes() {
    const axesLength = 200;
    const axesHelper = new THREE.AxesHelper(axesLength);
    scene.add(axesHelper);

    const labels = [
        { text: 'X (RA=0°)', pos: new THREE.Vector3(axesLength + 10, 0, 0), color: 0xff0000 },
        { text: 'Y (RA=90°)', pos: new THREE.Vector3(0, axesLength + 10, 0), color: 0x00ff00 },
        { text: 'Z (Dec=+90°)', pos: new THREE.Vector3(0, 0, axesLength + 10), color: 0x0000ff },
    ];

    labels.forEach(({ text, pos, color }) => {
        const label = createTextLabel(text, pos);
        label.material.color.setHex(color);
        scene.add(label);
    });
}

function createTextLabel(text, position) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 64;
    ctx.font = '24px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(text, 128, 40);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.copy(position);
    sprite.scale.set(40, 10, 1);
    return sprite;
}

function createFallbackGalaxies() {
    statusEl.textContent = 'Generating fallback procedural galaxies...';

    const count = 10000;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const radius = Math.random() * 500;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = radius * Math.cos(phi);

        const colorPhase = Math.random();
        colors[i * 3] = colorPhase;
        colors[i * 3 + 1] = 0.3 * (1 - colorPhase);
        colors[i * 3 + 2] = 1 - colorPhase;

        sizes[i] = 0.5 + Math.random() * 1.5;
    }

    galaxyRas = null;
    galaxyDecs = null;
    galaxyRedshifts = null;
    galaxyMags = null;

    buildGalaxyCloud(count, positions, colors, sizes);

    countEl.textContent = `Procedural: ${count} galaxies`;
}

function setupWaveSphere() {
    const geometry = new THREE.SphereGeometry(1, 48, 24);
    const material = new THREE.MeshBasicMaterial({
        color: 0x66ccff,
        wireframe: true,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    waveSphere = new THREE.Mesh(geometry, material);
    waveSphere.visible = false;
    scene.add(waveSphere);
}

function setupButtons() {
    btnZoom.addEventListener('click', () => flyTo(null, null, 1500, 'Full survey view — SDSS galaxies spanning ~2,000 Mpc.'));
    btnLightwave.addEventListener('click', startLightWave);
    timeScaleSlider.addEventListener('input', () => {
        timeScale = Number(timeScaleSlider.value) * 1e6;
        timeScaleValue.textContent = formatYears(timeScale) + '/s';
    });

    btnSearch.addEventListener('click', () => handleSearch(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSearch(searchInput.value);
    });

    document.querySelectorAll('.tour').forEach((btn) => {
        btn.addEventListener('click', () => {
            const name = btn.dataset.tour;
            const tour = TOURS[name];
            if (!tour) return;
            flyTo(tour.direction ? tour.direction.ra : null,
                tour.direction ? tour.direction.dec : null,
                tour.distance,
                tour.caption);
        });
    });

    document.querySelectorAll('.filter').forEach((btn) => {
        btn.addEventListener('click', () => {
            setFilter(btn.dataset.filter);
            document.querySelectorAll('.filter').forEach((b) => b.classList.toggle('active', b === btn));
        });
    });

    cardClose.addEventListener('click', () => {
        galaxyCard.classList.add('hidden');
    });
}

function startZoomOut() {
    if (!points) return;
    stopLightWave();
    flyTo(null, null, 500, null);
}

function setFilter(mode) {
    currentFilter = mode;
    if (!galaxyDistances) return;

    const keep = [];
    for (let i = 0; i < fullCount; i++) {
        if (mode === 'all') {
            keep.push(i);
        } else if (mode === 'near' && galaxyDistances[i] < NEARBY_LIMIT_MPC) {
            keep.push(i);
        } else if (mode === 'far' && galaxyDistances[i] >= NEARBY_LIMIT_MPC) {
            keep.push(i);
        }
    }

    stopLightWave();
    rebuildPoints(keep);
    countEl.textContent =
        `${keep.length.toLocaleString()} galaxies shown ` +
        `(${mode === 'all' ? 'all' : mode === 'near' ? `< ${NEARBY_LIMIT_MPC} Mpc` : `≥ ${NEARBY_LIMIT_MPC} Mpc`})`;
}

function flyTo(ra, dec, distanceMpc, caption) {
    if (!points) return;
    stopLightWave();
    controls.autoRotate = false;

    let endPos;
    if (ra !== null && dec !== null) {
        endPos = raDecToCartesian(ra, dec, distanceMpc);
    } else {
        endPos = new THREE.Vector3(0, 0, distanceMpc);
    }

    hideCard();
    animating = true;
    const startPos = camera.position.clone();
    const endTarget = controls.target.clone();
    const duration = 3000;
    const t0 = performance.now();

    if (caption) {
        tourCaptionEl.textContent = caption;
        tourCaptionEl.classList.add('show');
    }

    function step(now) {
        const t = Math.min(1, (now - t0) / duration);
        const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        camera.position.lerpVectors(startPos, endPos, ease);
        controls.target.lerpVectors(controls.target, endTarget, ease);
        controls.update();
        if (t < 1) {
            requestAnimationFrame(step);
        } else {
            animating = false;
            statusEl.textContent = galaxyDataCountText();
        }
    }
    requestAnimationFrame(step);
}

function raDecToCartesian(raDeg, decDeg, distanceMpc) {
    const ra = raDeg * Math.PI / 180;
    const dec = decDeg * Math.PI / 180;
    return new THREE.Vector3(
        distanceMpc * Math.cos(dec) * Math.cos(ra),
        distanceMpc * Math.cos(dec) * Math.sin(ra),
        distanceMpc * Math.sin(dec)
    );
}

function galaxyDataCountText() {
    return `Loaded ${fullCount.toLocaleString()} galaxies`;
}

function handleSearch(text) {
    if (!points) return;
    text = (text || '').trim();
    if (!text) return;

    const lower = text.toLowerCase();
    const tourKey = Object.keys(TOURS).find((k) => lower === k || lower.includes(TOURS[k].label.toLowerCase()));
    if (tourKey) {
        const tour = TOURS[tourKey];
        flyTo(tour.direction ? tour.direction.ra : null,
            tour.direction ? tour.direction.dec : null,
            tour.distance,
            tour.caption);
        return;
    }

    const nums = text.split(/[,\s]+/).filter((s) => s !== '' && !isNaN(parseFloat(s))).map(Number);
    if (nums.length >= 2 && nums.length <= 3) {
        const ra = ((nums[0] % 360) + 360) % 360;
        const dec = Math.max(-90, Math.min(90, nums[1]));
        const distance = nums[2] ? Math.min(1900, Math.max(20, nums[2])) : 400;
        flyTo(ra, dec, distance, `Flying to RA ${ra.toFixed(1)}°, Dec ${dec.toFixed(1)}°`);
    } else {
        statusEl.textContent = 'Search format: "RA Dec" or "RA Dec distance". Try 192 3 or "sloan".';
    }
}

function startLightWave() {
    if (!points || !baseColors || !galaxyDistances) return;
    stopLightWave();
    waveActive = true;
    waveRadius = 0;
    waveElapsedYears = 0;
    waveMaxRadius = 0;
    for (let i = 0; i < galaxyDistances.length; i++) {
        if (galaxyDistances[i] > waveMaxRadius) waveMaxRadius = galaxyDistances[i];
    }
    const totalYears = waveMaxRadius * MPC_TO_LY;
    waveSphere.visible = true;
    statusEl.textContent = `Light from Earth crossing the universe · ${formatYears(totalYears)} to reach the farthest galaxy`;
    btnLightwave.disabled = true;
}

function stopLightWave() {
    if (!waveActive) return;
    waveActive = false;
    waveSphere.visible = false;
    btnLightwave.disabled = false;
    restoreColors();
}

function restoreColors() {
    if (!points || !baseColors) return;
    const colorAttr = points.geometry.attributes.color;
    const colors = colorAttr.array;
    for (let i = 0; i < fullCount; i++) {
        const p = fullToVisible[i];
        if (p < 0) continue;
        colors[p * 3] = baseColors[i * 3];
        colors[p * 3 + 1] = baseColors[i * 3 + 1];
        colors[p * 3 + 2] = baseColors[i * 3 + 2];
    }
    colorAttr.needsUpdate = true;
}

function formatYears(years) {
    if (years >= 1e9) return (years / 1e9).toFixed(2) + 'B yr';
    if (years >= 1e6) return (years / 1e6).toFixed(1) + 'M yr';
    if (years >= 1e3) return (years / 1e3).toFixed(1) + 'k yr';
    return years.toFixed(0) + ' yr';
}

function updateWave(dt) {
    if (!waveActive) return;
    waveElapsedYears += timeScale * dt;
    waveRadius = waveElapsedYears / MPC_TO_LY;

    if (waveRadius >= waveMaxRadius) {
        waveRadius = waveMaxRadius;
        stopLightWave();
        countEl.textContent = `Light reached the farthest galaxy in ${formatYears(waveElapsedYears)}`;
        return;
    }

    waveSphere.scale.setScalar(waveRadius);

    const colorAttr = points.geometry.attributes.color;
    const colors = colorAttr.array;
    const bright = 1.0;
    const dim = 0.06;
    for (let i = 0; i < galaxyDistances.length; i++) {
        const p = fullToVisible[i];
        if (p < 0) continue;
        const lit = galaxyDistances[i] <= waveRadius ? bright : dim;
        colors[p * 3] = baseColors[i * 3] * lit;
        colors[p * 3 + 1] = baseColors[i * 3 + 1] * lit;
        colors[p * 3 + 2] = baseColors[i * 3 + 2] * lit;
    }
    colorAttr.needsUpdate = true;

    const pct = ((waveRadius / waveMaxRadius) * 100).toFixed(2);
    countEl.textContent = `Light has traveled ${formatYears(waveElapsedYears)} (${waveRadius.toFixed(1)} / ${waveMaxRadius.toFixed(0)} Mpc) · ${pct}% of the way out`;
}

function lookbackTimeGyr(z) {
    if (z <= 0) return 0;
    const { H0, Om, OL } = COSMO;
    const steps = 200;
    let sum = 0;
    for (let i = 0; i <= steps; i++) {
        const zp = (z * i) / steps;
        const E = Math.sqrt(Om * Math.pow(1 + zp, 3) + OL);
        const w = (i === 0 || i === steps) ? 0.5 : 1;
        sum += w / ((1 + zp) * E);
    }
    const integral = (sum * z) / steps;
    const cOverH0 = 299792.458 / H0; // Mpc
    return (cOverH0 * integral * 3.261563777e6) / 1e9; // Gyr
}

function narrateScale(camDistMpc) {
    const ly = camDistMpc * MPC_TO_LY;
    let text;
    if (ly < 1) text = 'less than a light-year';
    else if (ly < 1e3) text = `${ly.toFixed(0)} light-years`;
    else if (ly < 1e6) text = `${(ly / 1e3).toFixed(1)} thousand light-years`;
    else if (ly < 1e9) text = `${(ly / 1e6).toFixed(1)} million light-years`;
    else text = `${(ly / 1e9).toFixed(2)} billion light-years`;

    scaleNarrEl.textContent =
        `You are ${text} from Earth · looking ${formatYears(ly)} into the past`;
}

function showGalaxyProfile(idx) {
    const distMpc = galaxyDistances[idx];
    const distLy = distMpc * MPC_TO_LY;
    const ra = galaxyRas ? galaxyRas[idx] : null;
    const dec = galaxyDecs ? galaxyDecs[idx] : null;
    const z = galaxyRedshifts ? galaxyRedshifts[idx] : null;
    const mag = galaxyMags ? galaxyMags[idx] : null;

    const lb = z != null ? lookbackTimeGyr(z) : null;

    const rows = [
        ['Object class', 'GALAXY'],
        ['Right Ascension', ra != null ? `${ra.toFixed(3)}°` : '—'],
        ['Declination', dec != null ? `${dec.toFixed(3)}°` : '—'],
        ['Redshift (z)', z != null ? z.toFixed(5) : '—'],
        ['Comoving distance', `${distMpc.toFixed(1)} Mpc (${formatYears(distLy)})`],
        ['Lookback time', lb != null ? `light left ~${lb.toFixed(2)} billion years ago` : '—'],
        ['Apparent magnitude (r)', mag != null ? mag.toFixed(2) : '—'],
    ];

    cardBody.innerHTML = '';
    rows.forEach(([label, value]) => {
        const row = document.createElement('div');
        row.className = 'card-row';
        const l = document.createElement('span');
        l.className = 'card-label';
        l.textContent = label;
        const v = document.createElement('span');
        v.className = 'card-value';
        v.textContent = value;
        row.appendChild(l);
        row.appendChild(v);
        cardBody.appendChild(row);
    });

    if (ra != null && dec != null) {
        const cutoutUrl =
            `https://skyserver.sdss.org/dr18/SkyServerWS/ImgCutout/getjpeg?ra=${ra}&dec=${dec}&scale=0.4&width=200&height=200`;
        const img = document.createElement('img');
        img.className = 'card-image';
        img.alt = 'SDSS sky cutout';
        img.onerror = () => { img.style.display = 'none'; };
        img.src = cutoutUrl;

        const link = document.createElement('a');
        link.className = 'card-link';
        link.href = `https://skyserver.sdss.org/dr18/en/tools/explore/Summary.aspx?ra=${ra}&dec=${dec}`;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'Open in SDSS Explorer ↗';

        cardBody.appendChild(img);
        cardBody.appendChild(link);
    }

    galaxyCard.classList.remove('hidden');
}

function hideCard() {
    galaxyCard.classList.add('hidden');
}

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min(0.1, (now - (animate._last || now)) / 1000);
    animate._last = now;

    updateWave(dt);

    if (points) {
        points.rotation.y += 0.00005;
    }

    if (starfield) {
        starfield.rotation.y += dt * 0.0005;
    }

    // Ambient camera drift when idle
    if (!userInteracting && !animating && !waveActive &&
        (now - lastInteraction) > 5000 && controls.autoRotate !== true) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.35;
    }

    controls.update();

    const camDist = camera.position.distanceTo(controls.target);
    narrateScale(camDist);

    if (composer) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
});

let pointerDownPos = null;
canvas.addEventListener('pointerdown', (e) => {
    pointerDownPos = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('click', onCanvasClick);

function onCanvasClick(event) {
    if (!points) return;

    if (pointerDownPos) {
        const dx = event.clientX - pointerDownPos.x;
        const dy = event.clientY - pointerDownPos.y;
        if (dx * dx + dy * dy > 25) return; // was a drag, not a click
    }

    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    raycaster.params.Points.threshold = 10;

    const intersects = raycaster.intersectObject(points);

    if (intersects.length > 0) {
        const vertex = intersects[0].index;
        const fullIdx = fullToVisible ? fullToVisible[vertex] : vertex;
        const pos = intersects[0].point;
        selectionEl.style.display = 'block';
        selectionEl.textContent = `Galaxy #${fullIdx}: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}) Mpc`;
        showGalaxyProfile(fullIdx);
    } else {
        selectionEl.style.display = 'none';
        hideCard();
    }
}

init();
