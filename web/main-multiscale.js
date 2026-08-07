import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SceneManager } from './scenes/SceneManager.js';
import { CosmicWebScene } from './scenes/CosmicWebScene.js';
import { MilkyWayScene } from './scenes/MilkyWayScene.js';
import { SolarSystemScene } from './scenes/SolarSystemScene.js';
import { PlanetScene } from './scenes/PlanetScene.js';
import { CrossfadeRenderer } from './scenes/CrossfadeRenderer.js';
import { JourneyController } from './JourneyController.js';

const GALAXY_BINARY_URL = 'galaxies.bin';
const GALAXY_META_URL = 'galaxies.json';
const FLOATS_PER_GALAXY = 15;
const STAR_BINARY_URL = 'stars.bin';
const STAR_META_URL = 'stars.json';
const FLOATS_PER_STAR = 9;

const NEARBY_LIMIT_MPC = 150;
const MPC_TO_LY = 3.2615637771418799e6;
const GALACTIC_CENTER = new THREE.Vector3(-8200, 0, -20);

// Entry poses per scale. `target` is what the camera orbits.
const SCENE_PRESETS = {
    cosmic: { position: new THREE.Vector3(0, 0, 500), target: new THREE.Vector3(0, 0, 0) },
    milkyway: {
        position: new THREE.Vector3(GALACTIC_CENTER.x, 26000, GALACTIC_CENTER.z),
        target: GALACTIC_CENTER.clone(),
    },
    solar: { position: new THREE.Vector3(0, 400, 800), target: new THREE.Vector3(0, 0, 0) },
};

// Auto crossfade thresholds, in each scene's own units:
// cosmic = Mpc, milky way = pc, solar = 0.005 AU, planet = km.
const TRANSITION = {
    cosmicToMilky: 40,     // Mpc
    milkyToSolar: 300,     // pc from Sun
    milkyToCosmic: 32000,  // pc from Sun (zoomed out past the whole galaxy)
    solarToMilky: 40000,   // scene units = 200 AU (beyond Voyager 1)
    planetToSolar: 30,     // camera distance as a multiple of planet radius
};

const JOURNEY_DIRECTIONS = {
    andromeda: { ra: 10.6847, dec: 41.2687 },
    gc: { ra: 266.417, dec: -29.0078 },
    sloan: { ra: 192, dec: 3 },
    north: { ra: 192.86, dec: 27.13 },
};

const canvas = document.getElementById('three-canvas');
const statusEl = document.getElementById('status');
const countEl = document.getElementById('count');
const scaleNarrEl = document.getElementById('scale-narr');
const btnZoom = document.getElementById('btn-zoom');
const btnLightwave = document.getElementById('btn-lightwave');
const timeScaleSlider = document.getElementById('timescale-slider');
const timeScaleValue = document.getElementById('timescale-value');
const timescaleNote = document.getElementById('timescale-note');

const journeyHud = document.getElementById('journey-hud');
const journeyZoneEl = document.getElementById('journey-zone');
const journeyTextEl = document.getElementById('journey-text');
const journeySpeedEl = document.getElementById('journey-speed-hud');
const btnJourneyStart = document.getElementById('btn-journey-start');
const btnJourneyPause = document.getElementById('btn-journey-pause');
const btnJourneyCruise = document.getElementById('btn-journey-cruise');
const btnJourneyExit = document.getElementById('btn-journey-exit');
const journeyDirection = document.getElementById('journey-direction');
const journeySpeedSlider = document.getElementById('journey-speed-slider');
const journeySpeedValue = document.getElementById('journey-speed-value');
const galaxyPhoto = document.getElementById('galaxy-photo');
const photoImg = document.getElementById('photo-img');
const photoCaption = document.getElementById('photo-caption');
const galaxyCard = document.getElementById('galaxy-card');
const cardBody = document.getElementById('card-body');
const cardClose = document.getElementById('card-close');

// Planck18-ish cosmology for real distance/lookback values (z -> Mpc / Gyr).
const COSMO = { H0: 67.66, Om: 0.30966, OL: 0.6889 };
const MORPH_NAMES = ['Elliptical', 'S0 lenticular', 'Spiral', 'Irregular'];

let renderer, composer, controls, crossfadeRenderer, sceneManager;
let cosmicWebScene, milkyWayScene, solarSystemScene;
let planetSceneCache = new Map();
let galaxyData = null;
let starData = null;
let galaxyDistances = null;
let currentPlanet = null;
let lastInteraction = 0;
let userInteracting = false;
let animating = false;
let lastAutoTransition = 0;

// Shared camera across all scenes — the crossfade is a true continuous zoom.
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1e7);
camera.position.copy(SCENE_PRESETS.cosmic.position);

const journey = new JourneyController({
    camera,
    getSceneName: () => sceneManager ? sceneManager.getCurrentSceneName() : null,
    requestTransition: (name) => sceneManager ? sceneManager.requestTransition(name) : false,
    speed: 0.5,
    onHud: (zoneLabel, text, speed) => {
        journeyZoneEl.textContent = zoneLabel;
        journeyTextEl.textContent = text;
        journeySpeedEl.textContent = speed >= 1e9 ? `1 s = ${(speed / 1e9).toFixed(1)} Gly`
            : speed >= 1e6 ? `1 s = ${(speed / 1e6).toFixed(1)} Mly`
            : speed >= 1e3 ? `1 s = ${(speed / 1e3).toFixed(1)} kly`
            : speed >= 1 ? `1 s = ${speed.toFixed(1)} ly`
            : `1 s = ${(speed * AU_PER_LY).toFixed(1)} AU`;
    },
    onZoneChange: () => {},
    onDone: () => {
        journeyZoneEl.textContent = 'Edge of the mapped universe';
        journeyTextEl.textContent = 'You have traveled 6.3 billion light-years. Beyond this distance no galaxies are mapped.';
        journeySpeedEl.textContent = 'Journey complete';
        btnJourneyPause.disabled = true;
        btnJourneyCruise.disabled = true;
        journeySpeedSlider.disabled = true;
    },
    onExit: () => {},
});

const AU_PER_LY = 63241.077;

async function init() {
    setupRenderer();
    setupComposer();
    setupControls();
    setupSceneManager();
    await loadGalaxyData();
    await loadStarData();
    await initializeScenes();
    setupUI();
    animate();
}

function setupRenderer() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, logarithmicDepthBuffer: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
}

function setupComposer() {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(new THREE.Scene(), camera));

    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.3, 0.4, 0.2
    );
    composer.addPass(bloomPass);

    crossfadeRenderer = new CrossfadeRenderer(renderer);
}

function setupControls() {
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan = true;
    controls.minDistance = 0.5;
    controls.maxDistance = 50000;
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

function updateControlsLimits() {
    if (journey.active) return;
    const sceneName = sceneManager.getCurrentSceneName();
    if (sceneName === 'cosmic-web') {
        controls.maxDistance = 20000;
    } else if (sceneName === 'milky-way') {
        controls.maxDistance = 100000;
    } else if (sceneName === 'solar-system') {
        controls.maxDistance = 60000; // 300 AU — past Voyager 1
    } else if (sceneName && sceneName.startsWith('planet')) {
        const radius = planetSceneCache.get(currentPlanet)?.planetData?.radius || 6371;
        controls.maxDistance = radius * 40;
    }
}

function setupSceneManager() {
    sceneManager = new SceneManager(renderer, canvas, camera);
}

async function loadGalaxyData() {
    statusEl.textContent = 'Loading galaxy metadata...';
    try {
        const metaRes = await fetch(GALAXY_META_URL);
        if (!metaRes.ok) throw new Error('Metadata not found');
        const meta = await metaRes.json();

        statusEl.textContent = `Loading ${meta.count.toLocaleString()} galaxies...`;
        const binRes = await fetch(GALAXY_BINARY_URL);
        if (!binRes.ok) throw new Error('Binary data not found');
        const arrayBuffer = await binRes.arrayBuffer();

        galaxyData = parseGalaxyBinary(arrayBuffer, meta.count);
        statusEl.textContent = `Loaded ${meta.count.toLocaleString()} galaxies (SDSS + 2MRS)`;
        countEl.textContent = `${meta.count.toLocaleString()} galaxies · real sky surveys`;
    } catch (err) {
        console.error('Failed to load galaxies:', err);
        statusEl.textContent = 'Error: Could not load galaxy data';
        galaxyData = createFallbackGalaxyData(10000);
    }
}

function parseGalaxyBinary(arrayBuffer, expectedCount) {
    const view = new DataView(arrayBuffer);
    const count = view.getUint32(0, true);
    const floatOffset = 4;
    const floatCount = count * FLOATS_PER_GALAXY;
    const floatArray = new Float32Array(arrayBuffer, floatOffset, floatCount);

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const morphs = new Float32Array(count);
    const bA = new Float32Array(count);
    const ra = new Float32Array(count);
    const dec = new Float32Array(count);
    const redshift = new Float32Array(count);
    const survey = new Float32Array(count);
    const brightness = new Float32Array(count);
    const mag = new Float32Array(count);
    galaxyDistances = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const b = i * FLOATS_PER_GALAXY;
        positions[i * 3] = floatArray[b];
        positions[i * 3 + 1] = floatArray[b + 1];
        positions[i * 3 + 2] = floatArray[b + 2];
        colors[i * 3] = floatArray[b + 3];
        colors[i * 3 + 1] = floatArray[b + 4];
        colors[i * 3 + 2] = floatArray[b + 5];
        sizes[i] = floatArray[b + 6];
        ra[i] = floatArray[b + 7];
        dec[i] = floatArray[b + 8];
        redshift[i] = floatArray[b + 9];
        morphs[i] = floatArray[b + 10];
        survey[i] = floatArray[b + 11];
        brightness[i] = floatArray[b + 12];
        bA[i] = floatArray[b + 13];
        mag[i] = floatArray[b + 14];
        galaxyDistances[i] = Math.sqrt(
            positions[i * 3] ** 2 + positions[i * 3 + 1] ** 2 + positions[i * 3 + 2] ** 2
        );
    }

    return { positions, colors, sizes, morphs, bA, ra, dec, redshift, survey, brightness, mag, fullCount: count };
}

function createFallbackGalaxyData(count) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const morphs = new Float32Array(count);
    const bA = new Float32Array(count);
    const ra = new Float32Array(count);
    const dec = new Float32Array(count);
    const redshift = new Float32Array(count);
    const survey = new Float32Array(count);
    const brightness = new Float32Array(count);
    const mag = new Float32Array(count);
    galaxyDistances = new Float32Array(count);

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
        sizes[i] = 0.02 + Math.random() * 0.1;
        morphs[i] = Math.floor(Math.random() * 4);
        bA[i] = 0.4 + Math.random() * 0.6;
        ra[i] = 0; dec[i] = 0; redshift[i] = 0;
        survey[i] = 0;
        brightness[i] = 0.5 + Math.random() * 0.5;
        mag[i] = 15 + Math.random() * 4;
        galaxyDistances[i] = radius;
    }
    return { positions, colors, sizes, morphs, bA, ra, dec, redshift, survey, brightness, mag, fullCount: count };
}

async function loadStarData() {
    try {
        const metaRes = await fetch(STAR_META_URL);
        if (!metaRes.ok) throw new Error('Star metadata not found');
        const meta = await metaRes.json();

        const binRes = await fetch(STAR_BINARY_URL);
        if (!binRes.ok) throw new Error('Star binary not found');
        const arrayBuffer = await binRes.arrayBuffer();

        starData = parseStarBinary(arrayBuffer, meta.count);
    } catch (err) {
        console.warn('No star data — Milky Way will be purely procedural:', err);
        starData = null;
    }
}

function parseStarBinary(arrayBuffer, expectedCount) {
    const view = new DataView(arrayBuffer);
    const count = view.getUint32(0, true);
    const floatOffset = 4;
    const floatCount = count * FLOATS_PER_STAR;
    const floatArray = new Float32Array(arrayBuffer, floatOffset, floatCount);

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const base = i * FLOATS_PER_STAR;
        positions[i * 3] = floatArray[base];
        positions[i * 3 + 1] = floatArray[base + 1];
        positions[i * 3 + 2] = floatArray[base + 2];
        colors[i * 3] = floatArray[base + 3];
        colors[i * 3 + 1] = floatArray[base + 4];
        colors[i * 3 + 2] = floatArray[base + 5];
        sizes[i] = floatArray[base + 6];
    }

    return { positions, colors, sizes, count };
}

async function initializeScenes() {
    cosmicWebScene = new CosmicWebScene();
    cosmicWebScene.camera = camera;
    await cosmicWebScene.init(galaxyData);
    cosmicWebScene.addLightWaveSphere();
    cosmicWebScene.setGalaxyInfo({
        positions: galaxyData.positions,
        ra: galaxyData.ra,
        dec: galaxyData.dec,
        survey: galaxyData.survey,
        brightness: galaxyData.brightness,
        mag: galaxyData.mag,
        size: galaxyData.sizes,
    });
    cosmicWebScene.onPhotoFallback = (ra, dec) => {
        const card = document.getElementById('galaxy-photo');
        const img = document.getElementById('photo-img');
        const cap = document.getElementById('photo-caption');
        if (!card || !img) return;
        img.src = cosmicWebScene.cutoutUrl(ra, dec);
        cap.textContent = `SDSS cutout at RA ${ra.toFixed(2)}° · Dec ${dec.toFixed(2)}°`;
        card.classList.remove('hidden');
    };
    sceneManager.registerScene('cosmic-web', cosmicWebScene.getScene());

    milkyWayScene = new MilkyWayScene();
    milkyWayScene.camera = camera;
    await milkyWayScene.init(starData);
    sceneManager.registerScene('milky-way', milkyWayScene.getScene());

    solarSystemScene = new SolarSystemScene();
    solarSystemScene.camera = camera;
    await solarSystemScene.init();
    sceneManager.registerScene('solar-system', solarSystemScene.getScene());
}

function setupUI() {
    btnZoom.addEventListener('click', () => zoomToScale('cosmic'));
    btnLightwave.addEventListener('click', startLightWave);

    timeScaleSlider.addEventListener('input', () => {
        const days = Number(timeScaleSlider.value);
        timeScaleValue.textContent = `${days} day${days === 1 ? '' : 's'}/s`;
        if (solarSystemScene) solarSystemScene.setTimeScaleDaysPerSecond(days);
    });

    document.querySelectorAll('.tour').forEach(btn => {
        btn.addEventListener('click', () => {
            const tour = btn.dataset.tour;
            if (tour === 'sloan') flyCosmicTo({ ra: 192, dec: 3 }, 320, 'Sloan Great Wall — one of the largest known structures (z ≈ 0.07).');
            else if (tour === 'void') flyCosmicTo({ ra: 200, dec: 20 }, 800, 'Looking into a cosmic void — a vast, near-empty region.');
            else if (tour === 'milkyway') zoomToScale('milkyway');
            else if (tour === 'solar') zoomToScale('solar');
            else zoomToScale('cosmic');
        });
    });

    document.querySelectorAll('.scale-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const scale = btn.dataset.scale;
            zoomToScale(scale);
            document.querySelectorAll('.scale-btn').forEach(b => b.classList.toggle('active', b === btn));
        });
    });

    document.querySelectorAll('.filter').forEach(btn => {
        btn.addEventListener('click', () => {
            applyGalaxyFilter(btn.dataset.filter);
            document.querySelectorAll('.filter').forEach(b => b.classList.toggle('active', b === btn));
        });
    });

    const searchInput = document.getElementById('search-input');
    const btnSearch = document.getElementById('btn-search');
    const doSearch = () => handleSearch(searchInput.value);
    btnSearch.addEventListener('click', doSearch);
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideGalaxyCard();
        if (e.key >= '1' && e.key <= '4') {
            const scales = ['cosmic', 'milkyway', 'solar', 'planet'];
            zoomToScale(scales[e.key - '1']);
            document.querySelectorAll('.scale-btn').forEach((b, i) => b.classList.toggle('active', i === e.key - '1'));
        }
        if (e.code === 'Space' && journey.active) {
            e.preventDefault();
            toggleJourneyPause();
        }
    });

    if (cardClose) cardClose.addEventListener('click', hideGalaxyCard);

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('click', onCanvasClick);

    setupJourneyUI();
}

// --- Journey ---

function setupJourneyUI() {
    btnJourneyStart.addEventListener('click', startJourney);
    btnJourneyPause.addEventListener('click', toggleJourneyPause);
    btnJourneyCruise.addEventListener('click', () => {
        journey.setCruise(true);
        journeySpeedSlider.disabled = true;
        journeySpeedValue.textContent = 'cruise';
        btnJourneyCruise.classList.add('active');
    });
    btnJourneyExit.addEventListener('click', exitJourney);

    journeySpeedSlider.addEventListener('input', () => {
        const exp = Number(journeySpeedSlider.value);
        const speed = Math.pow(10, exp);
        journey.setSpeed(speed);
        journeySpeedValue.textContent = `${speed >= 1e6 ? (speed / 1e6).toFixed(1) + ' Mly/s' : speed >= 1e3 ? (speed / 1e3).toFixed(1) + ' kly/s' : speed >= 1 ? speed.toFixed(1) + ' ly/s' : (speed * AU_PER_LY).toFixed(2) + ' AU/s'}`;
    });

    journeyDirection.addEventListener('change', () => {
        const key = journeyDirection.value;
        if (key === 'view') {
            journey.setDirectionFromRaDec(cameraForwardRaDec()[0], cameraForwardRaDec()[1]);
        } else {
            const d = JOURNEY_DIRECTIONS[key];
            if (d) journey.setDirectionFromRaDec(d.ra, d.dec);
        }
    });
}

function cameraForwardRaDec() {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const dec = Math.asin(dir.y) * 180 / Math.PI;
    const ra = Math.atan2(dir.z, dir.x) * 180 / Math.PI;
    return [((ra % 360) + 360) % 360, dec];
}

async function startJourney() {
    if (journey.active) return;
    await enterPlanetView('Earth', true);
    const key = journeyDirection.value;
    if (key === 'view') {
        const [ra, dec] = cameraForwardRaDec();
        journey.setDirectionFromRaDec(ra, dec);
    } else {
        const d = JOURNEY_DIRECTIONS[key] || JOURNEY_DIRECTIONS.andromeda;
        journey.setDirectionFromRaDec(d.ra, d.dec);
    }
    journey.start();
    journeyHud.classList.remove('hidden');
    btnJourneyStart.disabled = true;
    btnJourneyPause.disabled = false;
    btnJourneyPause.textContent = '⏸ Pause';
    btnJourneyCruise.disabled = false;
    btnJourneyCruise.classList.add('active');
    btnJourneyExit.disabled = false;
    controls.enabled = false;
    journeySpeedSlider.disabled = true;
    journeySpeedValue.textContent = 'cruise';
    statusEl.textContent = 'Light-speed journey running — press Space to pause.';
}

function toggleJourneyPause() {
    if (!journey.active) return;
    const paused = journey.togglePause();
    btnJourneyPause.textContent = paused ? '▶ Resume' : '⏸ Pause';
    if (paused) {
        journeySpeedSlider.disabled = false;
        journeySpeedValue.textContent = 'manual';
        journey.setCruise(false);
        btnJourneyCruise.classList.remove('active');
    } else {
        journeySpeedSlider.disabled = true;
        journeySpeedValue.textContent = 'cruise';
    }
}

function exitJourney() {
    journey.stop();
    journeyHud.classList.add('hidden');
    btnJourneyStart.disabled = false;
    btnJourneyPause.disabled = true;
    btnJourneyPause.textContent = '⏸ Pause';
    btnJourneyCruise.disabled = true;
    btnJourneyExit.disabled = true;
    journeySpeedSlider.disabled = false;
    journeySpeedSlider.value = '0';
    journeySpeedValue.textContent = 'cruise';
    controls.enabled = true;
    camera.near = 0.1;
    camera.far = 1e7;
    camera.updateProjectionMatrix();
    hideGalaxyPhoto();
    sceneManager.requestTransition('cosmic-web');
    flyTo(SCENE_PRESETS.cosmic.position.clone(), SCENE_PRESETS.cosmic.target.clone());
    statusEl.textContent = 'Journey ended — you can explore freely again.';
}

// --- Navigation ---

function zoomToScale(target) {
    if (animating || journey.active) return;
    const sceneName = sceneManager.getCurrentSceneName();

    if (target === 'planet') {
        if (sceneName && sceneName.startsWith('planet')) { exitPlanetView(); return; }
        enterPlanetView(currentPlanet || 'Earth');
        return;
    }

    const targetScene = target === 'cosmic' ? 'cosmic-web'
        : target === 'milkyway' ? 'milky-way'
        : target === 'solar' ? 'solar-system' : null;
    if (!targetScene) return;
    if (sceneName && sceneName.startsWith('planet')) {
        exitPlanetView();
        return;
    }

    hideGalaxyPhoto();
    sceneManager.requestTransition(targetScene);
    flyTo(SCENE_PRESETS[target].position.clone(), SCENE_PRESETS[target].target.clone());
}

function hideGalaxyPhoto() {
    const card = document.getElementById('galaxy-photo');
    if (card) card.classList.add('hidden');
    hideGalaxyCard();
}

function flyCosmicTo(dir, distanceMpc, caption) {
    if (journey.active) return;
    if (sceneManager.getCurrentSceneName() !== 'cosmic-web') {
        sceneManager.requestTransition('cosmic-web');
    }
    const ra = dir.ra * Math.PI / 180;
    const dec = dir.dec * Math.PI / 180;
    const pos = new THREE.Vector3(
        distanceMpc * Math.cos(dec) * Math.cos(ra),
        distanceMpc * Math.cos(dec) * Math.sin(ra),
        distanceMpc * Math.sin(dec)
    );
    flyTo(pos, new THREE.Vector3(0, 0, 0));
    if (caption) {
        const captionEl = document.getElementById('tour-caption');
        captionEl.textContent = caption;
        captionEl.classList.add('show');
    }
}

function flyTo(endPos, endTarget) {
    animating = true;
    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const duration = 2000;
    const startTime = performance.now();

    function step(now) {
        const t = Math.min(1, (now - startTime) / duration);
        const ease = t < 0.5 ? 4 * t ** 3 : 1 - Math.pow(-2 * t + 2, 3) / 2;
        camera.position.lerpVectors(startPos, endPos, ease);
        controls.target.lerpVectors(startTarget, endTarget, ease);
        controls.update();
        if (t < 1) requestAnimationFrame(step);
        else {
            animating = false;
            lastAutoTransition = performance.now();
        }
    }
    requestAnimationFrame(step);
}

async function enterPlanetView(planetName, forJourney) {
    if (animating && !forJourney) return;
    animating = true;

    let planetScene = planetSceneCache.get(planetName);
    if (!planetScene) {
        planetScene = new PlanetScene();
        planetScene.camera = camera;
        await planetScene.init(planetName);
        planetSceneCache.set(planetName, planetScene);
    }
    currentPlanet = planetName;

    const radius = planetScene.planetData.radius;
    sceneManager.registerScene(`planet:${planetName}`, planetScene.getScene());
    sceneManager.requestTransition(`planet:${planetName}`);

    const endPos = new THREE.Vector3(0, 0, radius * 3);
    const endTarget = new THREE.Vector3(0, 0, 0);
    animating = false;
    if (!forJourney) {
        flyTo(endPos, endTarget);
    } else {
        camera.position.copy(endPos);
        camera.near = 0.1;
        camera.far = 1e7;
        camera.updateProjectionMatrix();
    }
}

function exitPlanetView() {
    if (journey.active) return;
    const sceneName = sceneManager.getCurrentSceneName();
    if (!sceneName || !sceneName.startsWith('planet')) return;
    sceneManager.requestTransition('solar-system');
    flyTo(SCENE_PRESETS.solar.position.clone(), SCENE_PRESETS.solar.target.clone());
}

function applyGalaxyFilter(mode) {
    if (!galaxyData) return;
    if (mode === 'all') {
        cosmicWebScene.replaceGalaxyData(galaxyData);
        countEl.textContent = `${galaxyData.fullCount.toLocaleString()} galaxies shown`;
        return;
    }
    const keep = [];
    for (let i = 0; i < galaxyData.fullCount; i++) {
        if (mode === 'near' && galaxyDistances[i] < NEARBY_LIMIT_MPC) keep.push(i);
        else if (mode === 'far' && galaxyDistances[i] >= NEARBY_LIMIT_MPC) keep.push(i);
    }
    const subset = subsetGalaxyData(keep);
    cosmicWebScene.replaceGalaxyData(subset);
    countEl.textContent =
        `${keep.length.toLocaleString()} galaxies shown (${mode === 'near' ? `< ${NEARBY_LIMIT_MPC} Mpc` : `≥ ${NEARBY_LIMIT_MPC} Mpc`})`;
}

function subsetGalaxyData(keep) {
    const n = keep.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const morphs = new Float32Array(n);
    const bA = new Float32Array(n);
    for (let v = 0; v < n; v++) {
        const i = keep[v];
        positions[v * 3] = galaxyData.positions[i * 3];
        positions[v * 3 + 1] = galaxyData.positions[i * 3 + 1];
        positions[v * 3 + 2] = galaxyData.positions[i * 3 + 2];
        colors[v * 3] = galaxyData.colors[i * 3];
        colors[v * 3 + 1] = galaxyData.colors[i * 3 + 1];
        colors[v * 3 + 2] = galaxyData.colors[i * 3 + 2];
        sizes[v] = galaxyData.sizes[i];
        morphs[v] = galaxyData.morphs[i];
        bA[v] = galaxyData.bA[i];
    }
    return { positions, colors, sizes, morphs, bA, fullCount: n };
}

function handleSearch(text) {
    text = (text || '').trim().toLowerCase();
    if (!text) return;

    const keywords = {
        milkyway: () => zoomToScale('milkyway'),
        galaxy: () => zoomToScale('milkyway'),
        solar: () => zoomToScale('solar'),
        sun: () => zoomToScale('solar'),
        earth: () => zoomToScale('cosmic'),
        planet: () => enterPlanetView(currentPlanet || 'Earth'),
    };
    if (keywords[text]) {
        keywords[text]();
        return;
    }

    const nums = text.split(/[,\s]+/).filter(s => s !== '' && !isNaN(parseFloat(s))).map(Number);
    if (nums.length >= 2 && nums.length <= 3) {
        const ra = ((nums[0] % 360) + 360) % 360;
        const dec = Math.max(-90, Math.min(90, nums[1]));
        const distance = nums[2] ? Math.min(1900, Math.max(20, nums[2])) : 400;
        if (sceneManager.getCurrentSceneName() !== 'cosmic-web') zoomToScale('cosmic');
        const pos = new THREE.Vector3(
            distance * Math.cos(dec * Math.PI / 180) * Math.cos(ra * Math.PI / 180),
            distance * Math.cos(dec * Math.PI / 180) * Math.sin(ra * Math.PI / 180),
            distance * Math.sin(dec * Math.PI / 180)
        );
        flyTo(pos, new THREE.Vector3(0, 0, 0));
    } else {
        statusEl.textContent = 'Search: "RA Dec" or "RA Dec distance". Try 192 3 or "solar".';
    }
}

// --- Light speed wave (cosmic layer) ---

let waveActive = false;
let waveRadius = 0;
let waveSpeed = 30; // Mpc / second
let waveMaxRadius = 0;

function startLightWave() {
    if (waveActive || !galaxyDistances || journey.active) return;
    zoomToScale('cosmic');
    waveActive = true;
    waveRadius = 0;
    let max = 0;
    for (let i = 0; i < galaxyDistances.length; i++) {
        if (galaxyDistances[i] > max) max = galaxyDistances[i];
    }
    waveMaxRadius = max || 2000;
    btnLightwave.disabled = true;
    statusEl.textContent = `Light from Earth crossing the universe · ${formatDistance(waveMaxRadius)} to the edge`;
}

function updateLightWave(dt) {
    if (!waveActive) return;
    waveRadius += waveSpeed * dt;
    if (waveRadius >= waveMaxRadius) {
        waveRadius = waveMaxRadius;
        waveActive = false;
        btnLightwave.disabled = false;
        cosmicWebScene.setLightWave(0, false);
        statusEl.textContent = `Light reached the farthest galaxy in ${formatDistance(waveMaxRadius)}`;
        return;
    }
    cosmicWebScene.setLightWave(waveRadius, true);
}

// --- Auto transitions between scales ---

function checkScaleTransitions() {
    if (journey.active) return;
    const sceneName = sceneManager.getCurrentSceneName();
    const now = performance.now();
    if (now - lastAutoTransition < 2500) return;
    if (animating || userInteracting) return;

    const camDist = camera.position.length();

    if (sceneName === 'cosmic-web' && camDist < TRANSITION.cosmicToMilky) {
        enterMilkyWayFromCosmic();
    } else if (sceneName === 'milky-way') {
        if (camDist > TRANSITION.milkyToCosmic) {
            sceneManager.requestTransition('cosmic-web');
            flyTo(SCENE_PRESETS.cosmic.position.clone(), SCENE_PRESETS.cosmic.target.clone());
        } else if (camDist < TRANSITION.milkyToSolar) {
            sceneManager.requestTransition('solar-system');
            flyTo(new THREE.Vector3(0, 150, 350), new THREE.Vector3(0, 0, 0));
        }
    } else if (sceneName === 'solar-system' && camDist > TRANSITION.solarToMilky) {
        sceneManager.requestTransition('milky-way');
        flyTo(new THREE.Vector3(0, 800, 4000), new THREE.Vector3(0, 0, 0));
    } else if (sceneName && sceneName.startsWith('planet') && currentPlanet) {
        const planetScene = planetSceneCache.get(currentPlanet);
        const radius = planetScene?.planetData?.radius;
        if (radius && camDist > radius * TRANSITION.planetToSolar) {
            exitPlanetView();
        }
    }
}

function enterMilkyWayFromCosmic() {
    sceneManager.requestTransition('milky-way');
    flyTo(new THREE.Vector3(0, 400, 500), new THREE.Vector3(0, 0, 0));
}

// --- Scale narrative (scene-aware) ---

function formatDistance(mpc) {
    const ly = mpc * MPC_TO_LY;
    if (ly < 1e3) return `${ly.toFixed(0)} light-years`;
    if (ly < 1e6) return `${(ly / 1e3).toFixed(1)} thousand light-years`;
    if (ly < 1e9) return `${(ly / 1e6).toFixed(1)} million light-years`;
    return `${(ly / 1e9).toFixed(2)} billion light-years`;
}

function formatYears(years) {
    if (years >= 1e9) return (years / 1e9).toFixed(2) + 'B yr';
    if (years >= 1e6) return (years / 1e6).toFixed(1) + 'M yr';
    if (years >= 1e3) return (years / 1e3).toFixed(1) + 'k yr';
    return years.toFixed(0) + ' yr';
}

function updateScaleNarrative() {
    if (journey.active) return;
    const sceneName = sceneManager.getCurrentSceneName();
    const camDist = camera.position.length();
    let text;

    if (sceneName === 'cosmic-web') {
        const ly = camDist * MPC_TO_LY;
        text = `~${formatDistance(camDist)} from Earth · looking ${formatYears(ly)} into the past`;
    } else if (sceneName === 'milky-way') {
        const pc = camDist;
        const ly = pc * 3.26156;
        if (ly < 100) text = `~${ly.toFixed(1)} ly from the Sun · inside the local bubble`;
        else text = `~${(ly / 1000).toFixed(1)} thousand ly from the Sun · ${(pc / 1000).toFixed(1)} kpc`;
    } else if (sceneName === 'solar-system') {
        const au = camDist * (1 / 200);
        const lightMin = au * 8.317; // light-minutes
        if (au < 0.05) text = `~${(au * 149.6).toFixed(0)} million km from the Sun`;
        else if (au < 2) text = `~${au.toFixed(2)} AU from the Sun · ${lightMin.toFixed(1)} light-min`;
        else if (au < 200) text = `~${au.toFixed(1)} AU from the Sun · ${(lightMin / 60).toFixed(1)} light-hr`;
        else text = `~${au.toFixed(0)} AU from the Sun`;
        if (solarSystemScene) {
            text += ` · Voyager 1 at ${solarSystemScene.getVoyagerDistanceAU().toFixed(1)} AU`;
        }
    } else if (sceneName && sceneName.startsWith('planet')) {
        const km = camDist;
        text = km < 1e3 ? `~${km.toFixed(0)} km above the surface`
            : km < 1e6 ? `~${(km / 1000).toFixed(1)} thousand km above the surface`
            : `~${(km / 1e6).toFixed(1)} million km away`;
    }
    scaleNarrEl.textContent = text || '';
}

// --- Click handling: select a planet in the solar scene ---

let pointerDownPos = null;

function onPointerDown(e) {
    pointerDownPos = { x: e.clientX, y: e.clientY };
}

function onCanvasClick(event) {
    if (!pointerDownPos) return;
    const dx = event.clientX - pointerDownPos.x;
    const dy = event.clientY - pointerDownPos.y;
    if (dx * dx + dy * dy > 25) return; // was a drag
    if (journey.active) return;

    const sceneName = sceneManager.getCurrentSceneName();

    if (sceneName === 'cosmic-web' && cosmicWebScene) {
        const rect = canvas.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);
        const idx = pickNearestGalaxy(raycaster.ray);
        if (idx >= 0 && !galaxyPhoto.classList.contains('hidden')) hideGalaxyPhoto();
        if (idx >= 0) showGalaxyCard(idx);
        else hideGalaxyCard();
        return;
    }

    if (sceneName !== 'solar-system' || !solarSystemScene) return;

    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const hits = raycaster.intersectObjects(solarSystemScene.getClickTargets(), false);
    if (hits.length > 0) {
        const name = hits[0].object.userData.planetName;
        if (name) enterPlanetView(name);
    }
}

// --- Real galaxy detail card ---------------------------------------------

function pickNearestGalaxy(ray) {
    const d = galaxyData;
    if (!d || !d.positions) return -1;
    const n = d.positions.length / 3;
    const cam = camera.position;
    let best = -1, bestAng = Infinity;
    for (let i = 0; i < n; i++) {
        const gx = d.positions[i * 3] - cam.x;
        const gy = d.positions[i * 3 + 1] - cam.y;
        const gz = d.positions[i * 3 + 2] - cam.z;
        const len = Math.sqrt(gx * gx + gy * gy + gz * gz);
        if (len < 1e-6) continue;
        // Angular offset between the click ray and the galaxy direction.
        const dot = (gx * ray.direction.x + gy * ray.direction.y + gz * ray.direction.z) / len;
        const cosA = Math.max(-1, Math.min(1, dot));
        const ang = Math.acos(cosA); // radians
        if (ang < bestAng) { bestAng = ang; best = i; }
    }
    // Only respond to a fairly deliberate click (within ~1.2 deg).
    if (best >= 0 && bestAng < 0.021) return best;
    return -1;
}

function lookbackTimeGyr(z) {
    if (!z || z <= 0) return 0;
    const steps = 200;
    let sum = 0;
    for (let i = 0; i <= steps; i++) {
        const zp = (z * i) / steps;
        const E = Math.sqrt(COSMO.Om * Math.pow(1 + zp, 3) + COSMO.OL);
        const w = (i === 0 || i === steps) ? 0.5 : 1;
        sum += w / ((1 + zp) * E);
    }
    const integral = (sum * z) / steps;
    const cOverH0 = 299792.458 / COSMO.H0; // Mpc
    return (cOverH0 * integral * 3.261563777e6) / 1e9; // Gyr
}

function showGalaxyCard(idx) {
    if (!galaxyData) return;
    const { positions, ra, dec, redshift, sizes, mag, morphs, survey, bA } = galaxyData;
    const distMpc = galaxyDistances ? galaxyDistances[idx] : 0;
    const distLy = distMpc * MPC_TO_LY;
    const z = redshift ? redshift[idx] : 0;
    const m = morphs ? morphs[idx] : 2;
    const s = survey ? survey[idx] : 0;
    const lb = lookbackTimeGyr(z);
    const angRadiusDeg = distMpc > 0 ? (sizes[idx] / distMpc) * 57.2958 : 0;

    const rows = [
        ['Object class', 'GALAXY'],
        ['Catalog', s === 0 ? 'SDSS (spectroscopic wedge)' : '2MRS (full sky)'],
        ['Morphology', MORPH_NAMES[m] || '—'],
        ['Right Ascension', ra != null ? `${ra[idx].toFixed(4)}°` : '—'],
        ['Declination', dec != null ? `${dec[idx].toFixed(4)}°` : '—'],
        ['Redshift (z)', z != null ? z.toFixed(5) : '—'],
        ['Comoving distance', `${distMpc.toFixed(1)} Mpc · ${formatYears(distLy)} light away`],
        ['Lookback time', lb > 0 ? `light left ~${lb.toFixed(2)} billion years ago` : '—'],
        ['Apparent magnitude', mag != null ? mag[idx].toFixed(2) : '—'],
        ['Physical radius', `${(sizes[idx] * 1000).toFixed(0)} pc`],
        ['Axis ratio (b/a)', bA != null ? bA[idx].toFixed(2) : '—'],
        ['Angular size', `${angRadiusDeg.toFixed(2)}°`],
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
            `https://skyserver.sdss.org/dr18/SkyServerWS/ImgCutout/getjpeg?ra=${ra[idx]}&dec=${dec[idx]}&scale=0.4&width=200&height=200`;
        const img = document.createElement('img');
        img.className = 'card-image';
        img.alt = 'Sky cutout';
        img.onerror = () => { img.style.display = 'none'; };
        img.src = cutoutUrl;
        const link = document.createElement('a');
        link.className = 'card-link';
        link.href = `https://skyserver.sdss.org/dr18/en/tools/explore/Summary.aspx?ra=${ra[idx]}&dec=${dec[idx]}`;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'Open in SDSS Explorer ↗';
        cardBody.appendChild(img);
        cardBody.appendChild(link);
    }

    galaxyCard.classList.remove('hidden');
}

function hideGalaxyCard() {
    galaxyCard.classList.add('hidden');
}

// --- Main loop ---

let lastTime = 0;
function animate(time) {
    requestAnimationFrame(animate);
    const deltaTime = Math.min(0.1, (time - lastTime) / 1000);
    lastTime = time;

    journey.update(deltaTime);

    const transitioning = sceneManager.update(deltaTime);
    const renderData = sceneManager.getRenderData();
    const sceneName = sceneManager.getCurrentSceneName();

    let activeScene;
    if (sceneName === 'cosmic-web') activeScene = cosmicWebScene;
    else if (sceneName === 'milky-way') activeScene = milkyWayScene;
    else if (sceneName === 'solar-system') activeScene = solarSystemScene;
    else if (sceneName && sceneName.startsWith('planet')) activeScene = planetSceneCache.get(currentPlanet);

    if (activeScene && !transitioning) {
        activeScene.update(deltaTime, camera.position);
    }

    updateLightWave(deltaTime);

    if (!transitioning) {
        checkScaleTransitions();
    }

    controls.update();
    updateControlsLimits();
    updateScaleNarrative();

    if (renderData.crossfade) {
        crossfadeRenderer.render(renderData);
    } else {
        composer.passes[0].scene = renderData.scene;
        composer.passes[0].camera = renderData.camera;
        composer.render();
    }
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    crossfadeRenderer.resize(window.innerWidth, window.innerHeight);

    [cosmicWebScene, milkyWayScene, solarSystemScene].forEach(scene => {
        if (scene) scene.resize(window.innerWidth, window.innerHeight);
    });
    planetSceneCache.forEach(scene => scene.resize(window.innerWidth, window.innerHeight));
});

init();
