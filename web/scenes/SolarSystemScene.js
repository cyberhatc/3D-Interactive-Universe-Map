import * as THREE from 'three';
import { BaseScene } from './BaseScene.js';

// Keplerian orbital elements (J2000 epoch, heliocentric ecliptic), deg.
// a = semi-major axis (AU), e = eccentricity, i = inclination,
// node = longitude of ascending node (Ω), peri = argument of perihelion (ω),
// M = mean anomaly at epoch.
const PLANET_ORBITS = [
    { name: 'Mercury', a: 0.38710, e: 0.20563, i: 7.005, node: 48.331, peri: 29.124, M: 174.796, radius: 0.0035, color: 0xb5b5b5, tilt: 0.03, texture: 'https://www.solarsystemscope.com/textures/download/2k_mercury.jpg' },
    { name: 'Venus', a: 0.72333, e: 0.00677, i: 3.395, node: 76.680, peri: 54.884, M: 50.416, radius: 0.0087, color: 0xe6c87a, tilt: 177.4, texture: 'https://www.solarsystemscope.com/textures/download/2k_venus_surface.jpg' },
    { name: 'Earth', a: 1.00000, e: 0.01671, i: 0.000, node: 0.000, peri: 114.207, M: 357.517, radius: 0.0092, color: 0x4a9fff, tilt: 23.4, hasMoon: true, texture: 'https://www.solarsystemscope.com/textures/download/2k_earth_daymap.jpg' },
    { name: 'Mars', a: 1.52368, e: 0.09340, i: 1.850, node: 49.558, peri: 286.502, M: 19.412, radius: 0.0049, color: 0xe27b58, tilt: 25.2, texture: 'https://www.solarsystemscope.com/textures/download/2k_mars.jpg' },
    { name: 'Jupiter', a: 5.20260, e: 0.04849, i: 1.303, node: 100.464, peri: 273.867, M: 20.020, radius: 0.100, color: 0xd4a574, tilt: 3.1, texture: 'https://www.solarsystemscope.com/textures/download/2k_jupiter.jpg' },
    { name: 'Saturn', a: 9.55491, e: 0.05555, i: 2.489, node: 113.666, peri: 339.391, M: 317.021, radius: 0.084, color: 0xf4e4bc, tilt: 26.7, hasRings: true, texture: 'https://www.solarsystemscope.com/textures/download/2k_saturn.jpg' },
    { name: 'Uranus', a: 19.21845, e: 0.04630, i: 0.773, node: 74.006, peri: 96.998, M: 141.050, radius: 0.036, color: 0x7de3f4, tilt: 97.8, texture: 'https://www.solarsystemscope.com/textures/download/2k_uranus.jpg' },
    { name: 'Neptune', a: 30.11039, e: 0.00899, i: 1.770, node: 131.784, peri: 276.340, M: 256.228, radius: 0.035, color: 0x4b70dd, tilt: 28.3, texture: 'https://www.solarsystemscope.com/textures/download/2k_neptune.jpg' },
];

const AU_TO_UNITS = 200;          // 1 AU = 200 scene units
const J2000_JD = 2451545.0;       // Julian Date of the epoch the elements refer to
const DEG = Math.PI / 180;

// Voyager 1: Horizons target -31, heliocentric. Receding ~3.6 AU/yr.
// Direction unit vector (ecliptic) from JPL Horizons state vectors (2026):
const VOYAGER_DIR = new THREE.Vector3(-0.187, -0.796, 0.576).normalize();
const VOYAGER_AU_AT_REF = 171.34;  // AU at reference Julian Date
const VOYAGER_REF_JD = 2461259.5;
const VOYAGER_AU_PER_DAY = 3.56 / 365.25;

export class SolarSystemScene extends BaseScene {
    constructor() {
        super('solar-system', { near: 0.001, far: 40000 });
        this.sun = null;
        this.planets = [];
        this.planetOrbits = [];
        this.voyager1 = null;
        this.voyagerLabel = null;
        this.currentJD = this.julianDateNow();
        this.daysPerSecond = 2.0;
        this.voyagerDistanceAU = VOYAGER_AU_AT_REF;
        this.voyagerLive = false;
    }

    julianDateNow() {
        return 2440587.5 + Date.now() / 86400000;
    }

    async init() {
        this.createSun();
        this.createPlanets();
        this.createOrbitLines();
        this.createVoyager1();
        this.setupScene();
        this.refreshVoyagerDistance();
    }

    setupScene() {
        this.scene.background = new THREE.Color(0x000000);
    }

    // --- Kepler solver: mean anomaly -> heliocentric ecliptic (AU) ---
    keplerPosition(el, jd) {
        const periodDays = Math.pow(el.a, 1.5) * 365.25636;
        const n = (2 * Math.PI) / periodDays;           // mean motion, rad/day
        let M = el.M0 + n * (jd - J2000_JD);
        M = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

        // Solve Kepler's equation M = E - e*sin(E) (Newton-Raphson)
        let E = M + el.e * Math.sin(M);
        for (let k = 0; k < 8; k++) {
            E = E - (E - el.e * Math.sin(E) - M) / (1 - el.e * Math.cos(E));
        }

        // True anomaly and heliocentric distance
        const nu = 2 * Math.atan2(
            Math.sqrt(1 + el.e) * Math.sin(E / 2),
            Math.sqrt(1 - el.e) * Math.cos(E / 2)
        );
        const r = el.a * (1 - el.e * Math.cos(E));
        const xp = r * Math.cos(nu);
        const yp = r * Math.sin(nu);

        // Rotate perifocal frame -> heliocentric ecliptic
        const node = el.node * DEG, peri = el.peri * DEG, i = el.i * DEG;
        const cosO = Math.cos(node), sinO = Math.sin(node);
        const cosw = Math.cos(peri), sinw = Math.sin(peri);
        const cosi = Math.cos(i), sini = Math.sin(i);
        return new THREE.Vector3(
            (cosw * cosO - sinw * sinO * cosi) * xp + (-sinw * cosO - cosw * sinO * cosi) * yp,
            (cosw * sinO + sinw * cosO * cosi) * xp + (-sinw * sinO + cosw * cosO * cosi) * yp,
            (sinw * sini) * xp + (cosw * sini) * yp
        );
    }

    createSun() {
        const geometry = new THREE.SphereGeometry(0.1 * AU_TO_UNITS, 64, 32);

        // Try to load the real Sun texture; fall back to the shader if it fails.
        const textureLoader = new THREE.TextureLoader();
        const sunTextureUrl = 'https://www.solarsystemscope.com/textures/download/2k_sun.jpg';
        const material = new THREE.MeshBasicMaterial({ color: 0xffdd88 });

        this.sun = new THREE.Mesh(geometry, material);
        this.sun.userData.sunTextureUrl = sunTextureUrl;

        textureLoader.setCrossOrigin('anonymous');
        textureLoader.load(
            sunTextureUrl,
            (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                this.sun.material = new THREE.MeshBasicMaterial({ map: tex, color: 0xfff0c0 });
            },
            undefined,
            () => { /* fall back to flat color */ }
        );

        const coronaGeometry = new THREE.SphereGeometry(0.15 * AU_TO_UNITS, 32, 16);
        const coronaMaterial = new THREE.MeshBasicMaterial({
            color: 0xff8800,
            transparent: true,
            opacity: 0.1,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
        });
        const corona = new THREE.Mesh(coronaGeometry, coronaMaterial);
        this.sun.add(corona);
        this.sun.userData.corona = corona;

        const light = new THREE.PointLight(0xffffee, 2, 5000);
        this.sun.add(light);
        this.scene.add(this.sun);
    }

    createPlanets() {
        PLANET_ORBITS.forEach(el => {
            const planet = this.createPlanetMesh(el);
            const record = { ...el, mesh: planet, label: null };
            this.scene.add(planet);

            if (el.hasMoon) this.createMoon(planet);
            if (el.hasRings) this.createRings(planet, el.radius * AU_TO_UNITS * 2.5);

            this.planets.push(record);
        });
        this.createPlanetLabels();
    }

    createPlanetMesh(el) {
        const geometry = new THREE.SphereGeometry(el.radius * AU_TO_UNITS, 32, 32);
        const material = new THREE.MeshStandardMaterial({
            color: el.color,
            roughness: 0.8,
            metalness: 0.05,
        });
        const planet = new THREE.Mesh(geometry, material);
        planet.castShadow = true;
        planet.receiveShadow = true;
        planet.userData.planetName = el.name;
        planet.rotation.z = (el.tilt || 0) * DEG;

        if (el.texture) {
            const loader = new THREE.TextureLoader();
            loader.setCrossOrigin('anonymous');
            loader.load(
                el.texture,
                (tex) => {
                    tex.colorSpace = THREE.SRGBColorSpace;
                    planet.material.map = tex;
                    planet.material.color.setHex(0xffffff);
                    planet.material.needsUpdate = true;
                },
                undefined,
                () => { /* keep flat color fallback */ }
            );
        }
        return planet;
    }

    createPlanetLabels() {
        this.planets.forEach(record => {
            const label = this.createTextLabel(record.name);
            label.userData.planetName = record.name;
            record.label = label;
            this.scene.add(label);
        });
    }

    createTextLabel(text) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;
        ctx.font = 'bold 28px Arial';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 8;
        ctx.fillText(text, 128, 42);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        const sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
        );
        sprite.scale.set(24, 6, 1);
        return sprite;
    }

    createMoon(planet) {
        const geometry = new THREE.SphereGeometry(0.0025 * AU_TO_UNITS, 16, 16);
        const material = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.9 });
        const moon = new THREE.Mesh(geometry, material);
        moon.position.set(0.025 * AU_TO_UNITS, 0, 0);
        planet.add(moon);
        planet.userData.moon = moon;
    }

    createRings(planet, radius) {
        const ringTexture = this.createRingTexture();
        const geometry = new THREE.RingGeometry(radius * 1.2, radius * 2.3, 128);
        const material = new THREE.MeshBasicMaterial({
            map: ringTexture,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        // Fix UV mapping so the texture radial stripes map to ring radii
        const uvAttribute = geometry.attributes.uv;
        for (let i = 0; i < uvAttribute.count; i++) {
            uvAttribute.setXY(i, 0, uvAttribute.getX(i));
        }
        geometry.attributes.uv.needsUpdate = true;
        const rings = new THREE.Mesh(geometry, material);
        rings.rotation.x = -Math.PI / 2;
        planet.add(rings);
        planet.userData.rings = rings;
    }

    createRingTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Radial rings: bright A ring, dark Cassini division, bright B ring
        const stops = [
            [0.00, 'rgba(150,140,120,0.9)'],
            [0.35, 'rgba(180,170,150,0.95)'],
            [0.45, 'rgba(40,35,30,0.5)'],
            [0.50, 'rgba(30,25,20,0.3)'],
            [0.60, 'rgba(200,190,170,0.95)'],
            [0.75, 'rgba(170,160,140,0.9)'],
            [0.85, 'rgba(120,110,95,0.6)'],
            [1.00, 'rgba(90,85,75,0.4)'],
        ];
        for (let i = 0; i < 256; i++) {
            const t = i / 255;
            let color = 'rgba(150,140,120,0.7)';
            for (let s = 0; s < stops.length - 1; s++) {
                if (t >= stops[s][0] && t <= stops[s + 1][0]) {
                    const local = (t - stops[s][0]) / (stops[s + 1][0] - stops[s][0]);
                    const c1 = stops[s][1], c2 = stops[s + 1][1];
                    color = this.lerpColor(c1, c2, local);
                    break;
                }
            }
            ctx.fillStyle = color;
            ctx.fillRect(0, i, 1, 1);
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.needsUpdate = true;
        return texture;
    }

    lerpColor(c1, c2, t) {
        const parse = (s) => s.match(/[\d.]+/g).map(Number);
        const a = parse(c1), b = parse(c2);
        const r = Math.round(a[0] + (b[0] - a[0]) * t);
        const g = Math.round(a[1] + (b[1] - a[1]) * t);
        const bl = Math.round(a[2] + (b[2] - a[2]) * t);
        const al = a[3] + (b[3] - a[3]) * t;
        return `rgba(${r},${g},${bl},${al})`;
    }

    createOrbitLines() {
        PLANET_ORBITS.forEach(el => {
            const points = [];
            for (let i = 0; i <= 256; i++) {
                const angle = (i / 256) * Math.PI * 2;
                const r = el.a * (1 - el.e * el.e) / (1 + el.e * Math.cos(angle));
                points.push(new THREE.Vector3(
                    r * Math.cos(angle) * AU_TO_UNITS,
                    0,
                    r * Math.sin(angle) * AU_TO_UNITS
                ));
            }
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({
                color: 0x444466,
                transparent: true,
                opacity: 0.3,
            });
            const orbit = new THREE.Line(geometry, material);
            this.planetOrbits.push(orbit);
            this.scene.add(orbit);
        });
    }

    createVoyager1() {
        const geometry = new THREE.SphereGeometry(0.004 * AU_TO_UNITS, 8, 8);
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ff66,
            transparent: true,
            opacity: 0.9,
        });
        this.voyager1 = new THREE.Mesh(geometry, material);
        this.scene.add(this.voyager1);

        this.voyagerLabel = this.createTextLabel('Voyager 1');
        this.scene.add(this.voyagerLabel);

        // Trajectory line from the Sun out to Voyager
        const linePoints = [];
        for (let i = 0; i <= 32; i++) {
            linePoints.push(VOYAGER_DIR.clone().multiplyScalar(i * (this.voyagerDistanceAU * AU_TO_UNITS) / 32));
        }
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
        const lineMaterial = new THREE.LineBasicMaterial({
            color: 0x00ff66,
            transparent: true,
            opacity: 0.25,
        });
        this.voyagerTrajectory = new THREE.Line(lineGeometry, lineMaterial);
        this.scene.add(this.voyagerTrajectory);
    }

    // Live Voyager 1 distance from JPL Horizons, with an analytic fallback.
    async refreshVoyagerDistance() {
        try {
            const now = new Date();
            const iso = now.toISOString().slice(0, 10);
            const next = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
            const url =
                `https://ssd.jpl.nasa.gov/api/horizons.api?format=json` +
                `&COMMAND=-31&OBJ_DATA=NO&MAKE_EPHEM=YES&EPHEM_TYPE=VECTORS` +
                `&CENTER=500@10&START_TIME=${iso}&STOP_TIME=${next}&STEP_SIZE=1d`;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 6000);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) throw new Error('Horizons HTTP ' + res.status);
            const data = await res.json();
            const match = data?.result?.match(/RG=\s*([+\-0-9.E]+)/);
            if (match && parseFloat(match[1]) > 0) {
                const km = parseFloat(match[1]);
                this.voyagerDistanceAU = km / 149597870.7;
                this.voyagerLive = true;
            }
        } catch (err) {
            // CORS/offline — fall back to the analytic drift estimate.
            this.voyagerLive = false;
        }
    }

    voyagerDistanceAt(jd) {
        if (this.voyagerLive) {
            return this.voyagerDistanceAU + VOYAGER_AU_PER_DAY * (jd - this.julianDateNow());
        }
        return VOYAGER_AU_AT_REF + VOYAGER_AU_PER_DAY * (jd - VOYAGER_REF_JD);
    }

    updatePlanetPositions() {
        this.planets.forEach(record => {
            const pos = this.keplerPosition(record, this.currentJD);
            record.mesh.position.set(
                pos.x * AU_TO_UNITS,
                pos.y * AU_TO_UNITS,
                pos.z * AU_TO_UNITS
            );
            record.mesh.rotation.y += 0.002;
        });
    }

    updateLabels(cameraPosition) {
        const camDist = cameraPosition.length();
        this.planets.forEach(record => {
            if (!record.label) return;
            record.label.position.copy(record.mesh.position);
            record.label.position.y += record.radius * AU_TO_UNITS * 2 + 2;
            const s = Math.max(camDist * 0.12, 12);
            record.label.scale.set(s * 4, s, 1);
        });
    }

    update(deltaTime, cameraPosition) {
        this.currentJD += deltaTime * this.daysPerSecond;
        this.updatePlanetPositions();
        this.updateLabels(cameraPosition);

        // Slow solar rotation (additive rotation on the textured Sun)
        if (this.sun?.userData) {
            this.sun.rotation.y += deltaTime * 0.0005;
            if (this.sun.userData.corona) {
                this.sun.userData.corona.rotation.y += deltaTime * 0.0001;
            }
        }

        // Voyager 1 marker drifts outward each frame
        const vDist = this.voyagerDistanceAt(this.currentJD) * AU_TO_UNITS;
        const vPos = VOYAGER_DIR.clone().multiplyScalar(vDist);
        this.voyager1.position.copy(vPos);
        if (this.voyagerLabel) {
            this.voyagerLabel.position.copy(vPos);
            this.voyagerLabel.position.y += 6;
            const s = Math.max(cameraPosition.length() * 0.12, 12);
            this.voyagerLabel.scale.set(s * 6, s * 1.5, 1);
        }
        this.voyagerDistanceAU = vDist / AU_TO_UNITS;

        this.planets.forEach(record => {
            const moon = record.mesh.userData.moon;
            if (moon) {
                moon.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.01);
            }
        });
    }

    setTimeScaleDaysPerSecond(scale) {
        this.daysPerSecond = scale;
    }

    resetToNow() {
        this.currentJD = this.julianDateNow();
    }

    getPlanetMeshes() {
        return this.planets.map(p => p.mesh);
    }

    getClickTargets() {
        const targets = [];
        this.planets.forEach(p => {
            targets.push(p.mesh);
            if (p.label) targets.push(p.label);
        });
        return targets;
    }

    getPlanetByName(name) {
        return this.planets.find(p => p.name === name);
    }

    getVoyagerDistanceAU() {
        return this.voyagerDistanceAU;
    }

    resize(width, height) {
        super.resize(width, height);
    }

    getScene() {
        return this.scene;
    }

    getCamera() {
        return this.camera;
    }
}
