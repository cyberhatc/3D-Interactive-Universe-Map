import * as THREE from 'three';
import { BaseScene } from './BaseScene.js';

// Galactic center offset (pc). The Sun sits at the origin; the Milky Way's
// center is ~8.2 kpc away. This keeps the scene Sun-centered (matching the
// real HYG star data, which is heliocentric) while the procedural disk, spiral
// arms and core are placed around the galactic center.
const GALACTIC_CENTER = new THREE.Vector3(-8200, 0, -20);

// A Gaussian (standard normal) sample via Box–Muller.
function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Shared soft round-point shader material.
function makePointMaterial(uScale, pointMin, pointMax, opacity) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uScale: { value: uScale },
            uOpacity: { value: opacity != null ? opacity : 1.0 },
        },
        vertexShader: `
            attribute float size;
            attribute vec3 color;
            varying vec3 vColor;
            uniform float uScale;
            void main() {
                vColor = color;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                float pointSize = size * uScale / max(-mvPosition.z, 1.0);
                gl_PointSize = clamp(pointSize, ${pointMin}.0, ${pointMax}.0);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            uniform float uOpacity;
            void main() {
                vec2 cxy = 2.0 * gl_PointCoord - 1.0;
                float r = dot(cxy, cxy);
                float alpha = smoothstep(1.0, 0.0, r);
                gl_FragColor = vec4(vColor, alpha * uOpacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
}

function colorAttr(colors, i, rgb, scale) {
    colors[i * 3] = rgb[0] * scale;
    colors[i * 3 + 1] = rgb[1] * scale;
    colors[i * 3 + 2] = rgb[2] * scale;
}

export class MilkyWayScene extends BaseScene {
    constructor() {
        super('milky-way', { near: 0.1, far: 100000 });
        this.starPoints = null;
        this.diskStars = null;
        this.spiralArms = null;
        this.centralBar = null;
        this.galaxyCore = null;
        this.dustLanes = null;
        this.halo = null;
        this.sunMarker = null;
        this.starCount = 0;
    }

    async init(starData = null) {
        this.createRealStars(starData);
        this.createDisk();
        this.createSpiralArms();
        this.createCentralBar();
        this.createBulgeAndCore();
        this.createHalo();
        this.createDustLanes();
        this.addSunMarker();
        this.setupScene();
    }

    setupScene() {
        this.scene.background = new THREE.Color(0x000000);
        // Fog tuned so the real local stars (< ~1 kpc) stay crisp while the
        // distant procedural disk fades into the galactic haze.
        this.scene.fog = new THREE.Fog(0x0a0a14, 6000, 40000);
    }

    // --- Real stars from the HYG catalog (heliocentric parsecs, Sun at origin) ---
    createRealStars(starData) {
        const count = starData?.count || 0;
        this.starCount = count;

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);

        if (starData?.positions) {
            positions.set(starData.positions);
            colors.set(starData.colors);
            sizes.set(starData.sizes);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: { uScale: { value: window.innerHeight / 2 }, uOpacity: { value: 0.92 } },
            vertexShader: `
                attribute float size;
                attribute vec3 color;
                varying vec3 vColor;
                uniform float uScale;
                void main() {
                    vColor = color;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    float pointSize = size * uScale / max(-mvPosition.z, 1.0);
                    gl_PointSize = clamp(pointSize, 0.5, 12.0);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                uniform float uOpacity;
                void main() {
                    vec2 cxy = 2.0 * gl_PointCoord - 1.0;
                    float r = dot(cxy, cxy);
                    float alpha = smoothstep(1.0, 0.0, r) * uOpacity;
                    gl_FragColor = vec4(vColor, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        if (count > 0) {
            this.starPoints = new THREE.Points(geometry, material);
            this.starPoints.frustumCulled = false;
            this.scene.add(this.starPoints);
        }
    }

    // --- Dense exponential stellar disk with a flaring, thin vertical profile
    // and a realistic mix of old + young star populations. ---
    createDisk() {
        const count = 50000;
        const SCALE_LENGTH = 2600; // pc
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const r = Math.min(16000, -SCALE_LENGTH * Math.log(1 - Math.random()));
            const theta = Math.random() * Math.PI * 2;
            // Flared thin disk: vertical scale height grows toward the edge.
            const flare = 1 + (r / 14000) * (r / 14000);
            const z = gauss() * 90 * flare;

            positions[i * 3] = GALACTIC_CENTER.x + r * Math.cos(theta);
            positions[i * 3 + 1] = GALACTIC_CENTER.y + z;
            positions[i * 3 + 2] = GALACTIC_CENTER.z + r * Math.sin(theta);

            // Stellar population mix: solar G/K, red-orange K/M, young A/B.
            const p = Math.random();
            let col;
            if (p < 0.42) col = [1.00, 0.86, 0.55];     // solar G/K
            else if (p < 0.78) col = [1.00, 0.60, 0.34]; // red-orange K/M
            else col = [0.62, 0.78, 1.00];               // young A/B
            // Surface-brightness falloff; redder toward the dense center.
            const intensity = 0.30 + 0.65 * (1 - r / 16000);
            const redden = 0.80 + 0.20 * (r / 16000);
            colorAttr(colors, i, [col[0], col[1] * redden, col[2] * (0.55 + 0.45 * redden)], intensity);

            sizes[i] = 0.4 + Math.random() * 0.9;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        this.diskStars = new THREE.Points(geometry, makePointMaterial(window.innerHeight / 2, 0.4, 9, 1.0));
        this.diskStars.frustumCulled = false;
        this.scene.add(this.diskStars);
    }

    // --- Well-defined log-spiral arms: 4 major + Local arm at ~12deg pitch,
    // with bright blue star-formation knots and fainter warm field stars. ---
    createSpiralArms() {
        this.spiralArms = new THREE.Group();

        const arms = [
            { name: 'Perseus', angle: 0, pitch: 12, turns: 1.9 },
            { name: 'Sagittarius', angle: Math.PI * 0.5, pitch: 12, turns: 1.9 },
            { name: 'Scutum-Centaurus', angle: Math.PI, pitch: 12, turns: 1.9 },
            { name: 'Norma', angle: Math.PI * 1.5, pitch: 12, turns: 1.9 },
            { name: 'Local', angle: Math.PI * 0.2, pitch: 15, turns: 1.1 },
        ];

        const particlesPerArm = 10000;

        arms.forEach(arm => {
            const positions = new Float32Array(particlesPerArm * 3);
            const colors = new Float32Array(particlesPerArm * 3);
            const sizes = new Float32Array(particlesPerArm);

            const b = 1 / Math.tan(arm.pitch * Math.PI / 180);
            const R0 = 2200; // pc where the arm starts

            for (let i = 0; i < particlesPerArm; i++) {
                const t = Math.random() * arm.turns * Math.PI * 2;
                let r = R0 * Math.exp(b * t);
                r = Math.max(1800, Math.min(r, 21000));

                // Soft-edged arm, wider farther out.
                const armWidth = (0.06 + 0.20 * (1 - r / 21000)) * (0.5 + r / 8000);
                const theta = t + arm.angle + (Math.random() - 0.5) * armWidth;
                // Beaded star-formation clumps.
                const m = (t % 0.5) - 0.22;
                const clump = Math.exp(-((m * m) / 0.012));

                const z = gauss() * (60 + 180 * (1 - r / 21000));
                positions[i * 3] = GALACTIC_CENTER.x + r * Math.cos(theta);
                positions[i * 3 + 1] = GALACTIC_CENTER.y + z;
                positions[i * 3 + 2] = GALACTIC_CENTER.z + r * Math.sin(theta);

                const blue = Math.random() < 0.08 + 0.55 * clump;
                const intensity = 0.30 + 0.70 * (1 - r / 21000);
                if (blue) colorAttr(colors, i, [0.55, 0.78, 1.0], intensity);
                else colorAttr(colors, i, [1.0, 0.72, 0.38], intensity);
                sizes[i] = (3 + Math.random() * 7 * (1 - r / 21000)) * (1 + clump);
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

            const armMesh = new THREE.Points(geometry, makePointMaterial(window.innerHeight / 2, 0.4, 11, 1.0));
            armMesh.frustumCulled = false;
            this.spiralArms.add(armMesh);
        });

        this.scene.add(this.spiralArms);
    }

    // --- A long, boxy stellar bar (like the Milky Way's), tilted in the disk
    // plane, dense near the bulge. ---
    createCentralBar() {
        const count = 15000;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);

        const halfLen = 2400;   // pc, ~4.8 kpc-long boxy bar
        const barTilt = 0.44;   // radians
        const ct = Math.cos(barTilt), st = Math.sin(barTilt);

        for (let i = 0; i < count; i++) {
            // Accept-reject: keep points denser toward the inner bar.
            let x, dens;
            do {
                x = Math.pow(Math.random(), 1.4);
                dens = 1 - x;
            } while (Math.random() > 0.1 + 0.9 * dens);

            const along = (Math.random() < 0.5 ? -1 : 1) * x * halfLen;
            const vertical = gauss() * 640;  // thick bar / bulge
            const thin = gauss() * 380;       // thin width in the plane

            // Tilt the bar's long axis into the disk plane.
            const Lx = along * ct - thin * st;
            const Lz = along * st + thin * ct;

            positions[i * 3] = GALACTIC_CENTER.x + Lx;
            positions[i * 3 + 1] = GALACTIC_CENTER.y + vertical;
            positions[i * 3 + 2] = GALACTIC_CENTER.z + Lz;

            colorAttr(colors, i, [1.0, 0.84, 0.5], 0.45 + 0.5 * dens);
            sizes[i] = 2.5 + Math.random() * 5 * dens;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        this.centralBar = new THREE.Points(geometry, makePointMaterial(window.innerHeight / 2, 0.4, 9, 1.0));
        this.centralBar.frustumCulled = false;
        this.scene.add(this.centralBar);
    }

    // --- Glowing oblate (peanut-ish) bulge + an intense nuclear core. ---
    createBulgeAndCore() {
        const bulge = new THREE.SphereGeometry(1300, 64, 32);
        const mat = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: `
                varying vec3 vPos;
                void main() {
                    vPos = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                varying vec3 vPos;
                void main() {
                    vec3 p = vec3(vPos.x * 1.25, vPos.y, vPos.z * 0.7);
                    float r = length(p) / 1300.0;
                    float density = smoothstep(1.0, 0.0, r);
                    vec3 color = mix(vec3(1.0, 0.96, 0.82), vec3(1.0, 0.62, 0.28), r * 0.75);
                    float mottle = 0.85 + 0.15 * sin(vPos.x * 0.015 + uTime * 0.3) * sin(vPos.z * 0.015);
                    gl_FragColor = vec4(color * density * mottle, density * 0.9);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
        });
        this.galaxyCore = new THREE.Mesh(bulge, mat);
        this.galaxyCore.scale.set(0.8, 0.55, 0.8);
        this.galaxyCore.position.copy(GALACTIC_CENTER);
        this.scene.add(this.galaxyCore);

        // Intense point-like nuclear source (Galactic center).
        const ngeo = new THREE.SphereGeometry(90, 24, 12);
        const nm = new THREE.MeshBasicMaterial({ color: 0xffe9bd, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending, depthWrite: false });
        this.nuclearCore = new THREE.Mesh(ngeo, nm);
        this.nuclearCore.position.copy(GALACTIC_CENTER);
        this.scene.add(this.nuclearCore);
    }

    // --- Old red globular-cluster halo that fades with radius. ---
    createHalo() {
        const count = 12000;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            // Plummer-like halo: concentrated toward the center, sparse outside.
            const u = Math.random();
            const R = 1800 + 4800 * Math.pow(u, 1 / 1.6);
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const x = R * Math.sin(phi) * Math.cos(theta);
            const y = R * Math.cos(phi);
            const z = R * Math.sin(phi) * Math.sin(theta);

            positions[i * 3] = GALACTIC_CENTER.x + x;
            positions[i * 3 + 1] = GALACTIC_CENTER.y + y;
            positions[i * 3 + 2] = GALACTIC_CENTER.z + z;

            const face = Math.random() < 0.5;
            colorAttr(colors, i, face ? [1.0, 0.9, 0.75] : [1.0, 0.65, 0.45], 0.35);
            sizes[i] = 1.5 + Math.random() * 3;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        this.halo = new THREE.Points(geometry, makePointMaterial(window.innerHeight / 2, 0.4, 6, 0.5));
        this.halo.frustumCulled = false;
        this.scene.add(this.halo);
    }

    // --- Dust lanes: dark bands that follow the spiral arms + a thin disk
    // of interstellar dust that subtly reddens the stellar light. ---
    createDustLanes() {
        const count = 24000;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const r = 3000 + Math.random() * 15000;
            const theta = Math.random() * Math.PI * 2;
            const z = gauss() * 60;
            positions[i * 3] = GALACTIC_CENTER.x + r * Math.cos(theta);
            positions[i * 3 + 1] = GALACTIC_CENTER.y + z;
            positions[i * 3 + 2] = GALACTIC_CENTER.z + r * Math.sin(theta);

            const b = 0.02 + Math.random() * 0.04;
            colors[i * 3] = b * 1.5;
            colors[i * 3 + 1] = b;
            colors[i * 3 + 2] = b * 0.55;
            sizes[i] = 10 + Math.random() * 30;
        }

        // The dusty disk is rendered subtractively so its dark matter can't add
        // light; a custom fog-free subtractive material darkens points behind it.
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: { uScale: { value: window.innerHeight / 2 } },
            vertexShader: `
                attribute float size;
                attribute vec3 color;
                varying vec3 vColor;
                uniform float uScale;
                void main() {
                    vColor = color;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    float pointSize = size * uScale / max(-mvPosition.z, 1.0);
                    gl_PointSize = clamp(pointSize, 1.0, 60.0);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                void main() {
                    vec2 cxy = 2.0 * gl_PointCoord - 1.0;
                    float r = dot(cxy, cxy);
                    float alpha = smoothstep(1.0, 0.0, r);
                    gl_FragColor = vec4(vColor, alpha * 0.45);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.NormalBlending,
        });

        this.dustLanes = new THREE.Points(geometry, material);
        this.dustLanes.frustumCulled = false;
        this.scene.add(this.dustLanes);
    }

    addSunMarker() {
        const geometry = new THREE.SphereGeometry(3, 16, 16);
        const material = new THREE.MeshBasicMaterial({ color: 0xfff7d6, transparent: true, opacity: 1.0 });
        this.sunMarker = new THREE.Mesh(geometry, material);
        this.sunMarker.position.set(0, 0, 0);
        this.scene.add(this.sunMarker);

        const glow = new THREE.Mesh(
            new THREE.SphereGeometry(1, 32, 16),
            new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.25, wireframe: true, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        glow.scale.setScalar(30);
        this.sunMarker.add(glow);
        this.sunMarker.userData.glow = glow;

        const label = this.createTextLabel('Sol · You are here', 0xfff7d6);
        label.position.set(0, 40, 0);
        this.scene.add(label);
    }

    createTextLabel(text, colorHex) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 512;
        canvas.height = 128;
        ctx.font = 'bold 44px Arial';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.shadowColor = colorHex ? '#' + colorHex.toString(16).padStart(6, '0') : '#ffffff';
        ctx.shadowBlur = 12;
        ctx.fillText(text, 256, 76);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;

        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(400, 100, 1);
        return sprite;
    }

    update(deltaTime, cameraPosition) {
        if (this.diskStars) this.diskStars.rotation.y += deltaTime * 0.00001;
        if (this.spiralArms) this.spiralArms.rotation.y += deltaTime * 0.000005;
        if (this.galaxyCore?.material?.uniforms?.uTime) {
            this.galaxyCore.material.uniforms.uTime.value = performance.now() * 0.001;
        }
        if (this.sunMarker?.userData?.glow) {
            const glow = this.sunMarker.userData.glow;
            glow.scale.setScalar(30 + Math.sin(performance.now() * 0.003) * 6);
        }
    }

    resize(width, height) {
        super.resize(width, height);
        const uScale = height / 2;
        [this.starPoints, this.diskStars, this.spiralArms, this.centralBar, this.dustLanes, this.halo].forEach(points => {
            if (!points) return;
            if (points.material?.uniforms?.uScale) {
                points.material.uniforms.uScale.value = uScale;
            } else if (points.traverse) {
                points.traverse(obj => {
                    if (obj.material?.uniforms?.uScale) obj.material.uniforms.uScale.value = uScale;
                });
            }
        });
    }

    getScene() {
        return this.scene;
    }

    getCamera() {
        return this.camera;
    }
}