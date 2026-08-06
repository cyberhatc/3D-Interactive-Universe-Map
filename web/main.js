import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const container = document.getElementById('container');
const canvas = document.getElementById('three-canvas');
const statusEl = document.getElementById('status');
const countEl = document.getElementById('count');
const selectionEl = document.getElementById('selection');

let scene, camera, renderer, controls, points, galaxyData;

const GALAXY_BINARY_URL = 'galaxies.bin';
const GALAXY_META_URL = 'galaxies.json';

const POINT_SIZE = 2.0;
const FOG_NEAR = 100;
const FOG_FAR = 2000;

async function init() {
    setupScene();
    setupCamera();
    setupRenderer();
    setupControls();
    setupLights();
    await loadGalaxies();
    animate();
}

function setupScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(0x000000, FOG_NEAR, FOG_FAR);
}

function setupCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000);
    camera.position.set(0, 0, 500);
}

function setupRenderer() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

function setupControls() {
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan = true;
    controls.minDistance = 1;
    controls.maxDistance = 5000;
    controls.target.set(0, 0, 0);
}

function setupLights() {
    const ambient = new THREE.AmbientLight(0x404040, 2);
    scene.add(ambient);
    
    const pointLight = new THREE.PointLight(0xffffff, 1, 1000);
    pointLight.position.set(0, 0, 0);
    scene.add(pointLight);
}

async function loadGalaxies() {
    statusEl.textContent = 'Loading galaxy metadata...';
    
    try {
        const metaRes = await fetch(GALAXY_META_URL);
        if (!metaRes.ok) throw new Error('Metadata not found');
        const meta = await metaRes.json();
        galaxyData = meta;
        
        statusEl.textContent = `Loading ${meta.count.toLocaleString()} galaxies...`;
        
        const binRes = await fetch(GALAXY_BINARY_URL);
        if (!binRes.ok) throw new Error('Binary data not found');
        const arrayBuffer = await binRes.arrayBuffer();
        
        parseBinaryData(arrayBuffer, meta.count);
        
        statusEl.textContent = `Loaded ${meta.count.toLocaleString()} galaxies`;
        countEl.textContent = `Distance range: ${meta.distance_range_mpc[0].toFixed(0)} - ${meta.distance_range_mpc[1].toFixed(0)} Mpc`;
        
    } catch (err) {
        console.error('Failed to load galaxies:', err);
        statusEl.textContent = 'Error: Could not load galaxy data. Run the pipeline first.';
        statusEl.style.color = '#ff6b6b';
        createFallbackGalaxies();
    }
}

function parseBinaryData(arrayBuffer, expectedCount) {
    const view = new DataView(arrayBuffer);
    const count = view.getUint32(0, true); // little-endian
    
    if (count !== expectedCount) {
        console.warn(`Count mismatch: binary has ${count}, metadata says ${expectedCount}`);
    }
    
    const floatOffset = 4; // after uint32 header
    const floatsPerGalaxy = 7;
    const floatCount = count * floatsPerGalaxy;
    const floatArray = new Float32Array(arrayBuffer, floatOffset, floatCount);
    
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    
    for (let i = 0; i < count; i++) {
        const base = i * floatsPerGalaxy;
        positions[i * 3 + 0] = floatArray[base + 0];
        positions[i * 3 + 1] = floatArray[base + 1];
        positions[i * 3 + 2] = floatArray[base + 2];
        colors[i * 3 + 0] = floatArray[base + 3];
        colors[i * 3 + 1] = floatArray[base + 4];
        colors[i * 3 + 2] = floatArray[base + 5];
        sizes[i] = floatArray[base + 6];
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
        opacity: 0.8,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    
    points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    
    // Add Earth marker at origin
    addEarthMarker();
    
    // Add coordinate axes
    addAxes();
}

function addEarthMarker() {
    const geometry = new THREE.SphereGeometry(2, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0x4a9fff, transparent: true, opacity: 0.8 });
    const earth = new THREE.Mesh(geometry, material);
    earth.position.set(0, 0, 0);
    scene.add(earth);
    
    const label = createTextLabel('Earth (Origin)', new THREE.Vector3(0, 5, 0));
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
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    const material = new THREE.PointsMaterial({
        size: POINT_SIZE,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    
    points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    
    addEarthMarker();
    addAxes();
    
    countEl.textContent = `Procedural: ${count} galaxies`;
}

function animate() {
    requestAnimationFrame(animate);
    
    controls.update();
    
    if (points) {
        points.rotation.y += 0.00005;
    }
    
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

canvas.addEventListener('click', onCanvasClick);

function onCanvasClick(event) {
    if (!points) return;
    
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
        const idx = intersects[0].index;
        const pos = intersects[0].point;
        selectionEl.style.display = 'block';
        selectionEl.textContent = `Galaxy #${idx}: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}) Mpc`;
    } else {
        selectionEl.style.display = 'none';
    }
}

init();