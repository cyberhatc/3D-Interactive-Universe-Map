import * as THREE from 'three';
import { BaseScene } from './BaseScene.js';

// Galactic center offset (pc). The Sun sits at the origin; the Milky Way's
// center is ~8.2 kpc away. This keeps the scene Sun-centered (matching the
// real HYG star data, which is heliocentric) while the procedural disk, spiral
// arms and core are placed around the galactic center.
const GALACTIC_CENTER = new THREE.Vector3(-8200, 0, -20);

export class MilkyWayScene extends BaseScene {
    constructor() {
        super('milky-way', { near: 0.1, far: 100000 });
        this.starPoints = null;
        this.diskStars = null;
        this.spiralArms = null;
        this.galaxyCore = null;
        this.sunMarker = null;
        this.starCount = 0;
    }

    async init(starData = null) {
        this.createRealStars(starData);
        this.createDiskStars();
        this.createSpiralArms();
        this.createCentralBar();
        this.createGalaxyCore();
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
            uniforms: {
                uScale: { value: window.innerHeight / 2 },
                uOpacity: { value: 0.9 },
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

    // --- Procedural stellar disk centered on the galactic center ---
    createDiskStars() {
        const count = 40000;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);

        const SCALE_LENGTH = 2600; // pc, exponential disk scale length
        for (let i = 0; i < count; i++) {
            const r = Math.min(-SCALE_LENGTH * Math.log(1 - Math.random()), 16000);
            const theta = Math.random() * Math.PI * 2;
            const z = (Math.random() - 0.5) * 2 * 400 * Math.exp(-r / 4000);

            positions[i * 3] = GALACTIC_CENTER.x + r * Math.cos(theta);
            positions[i * 3 + 1] = GALACTIC_CENTER.y + z;
            positions[i * 3 + 2] = GALACTIC_CENTER.z + r * Math.sin(theta);

            const warm = Math.random() < 0.75;
            const b = 0.25 + Math.random() * 0.45;
            colors[i * 3] = warm ? b : b * 0.6;
            colors[i * 3 + 1] = warm ? b * 0.85 : b * 0.75;
            colors[i * 3 + 2] = warm ? b * 0.55 : b;

            sizes[i] = 0.3 + Math.random() * 0.7;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uScale: { value: window.innerHeight / 2 },
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
                    gl_PointSize = clamp(pointSize, 0.5, 8.0);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                void main() {
                    vec2 cxy = 2.0 * gl_PointCoord - 1.0;
                    float r = dot(cxy, cxy);
                    float alpha = smoothstep(1.0, 0.0, r);
                    gl_FragColor = vec4(vColor, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.diskStars = new THREE.Points(geometry, material);
        this.diskStars.frustumCulled = false;
        this.scene.add(this.diskStars);
    }

    // --- Log-spiral arms centered on the galactic center ---
    createSpiralArms() {
        this.spiralArms = new THREE.Group();

        // Real Milky Way: 4 major arms + Local arm, pitch ~12°, plus a central bar.
        const arms = [
            { name: 'Perseus', angle: 0, pitch: 12, turns: 1.6 },
            { name: 'Sagittarius', angle: Math.PI * 0.5, pitch: 12, turns: 1.6 },
            { name: 'Scutum-Centaurus', angle: Math.PI, pitch: 12, turns: 1.6 },
            { name: 'Norma', angle: Math.PI * 1.5, pitch: 12, turns: 1.6 },
            { name: 'Orion (Local)', angle: Math.PI * 0.2, pitch: 15, turns: 0.9 },
        ];

        const particlesPerArm = 8000;

        arms.forEach(arm => {
            const positions = new Float32Array(particlesPerArm * 3);
            const colors = new Float32Array(particlesPerArm * 3);
            const sizes = new Float32Array(particlesPerArm);

            const pitchRad = arm.pitch * Math.PI / 180;
            const b = 1 / Math.tan(pitchRad);
            const R_REF = 1200; // pc

            for (let i = 0; i < particlesPerArm; i++) {
                const t = Math.random() * arm.turns * Math.PI * 2;
                const r = R_REF * Math.exp(b * t);
                if (r < 1000 || r > 18000) continue;

                // Density clumping along the arm: HII regions / stellar associations
                const clump = Math.exp(-((t % 0.4) - 0.2) ** 2 / 0.02);
                const scatter = (0.08 + 0.35 * (1 - r / 20000)) * (1 - 0.6 * clump);
                const theta = t + arm.angle + (Math.random() - 0.5) * scatter;

                const z = (Math.random() - 0.5) * (60 + 300 * (1 - r / 20000));

                positions[i * 3] = GALACTIC_CENTER.x + r * Math.cos(theta);
                positions[i * 3 + 1] = GALACTIC_CENTER.y + z;
                positions[i * 3 + 2] = GALACTIC_CENTER.z + r * Math.sin(theta);

                // Real arm colors: young blue O/B stars in the dense HII clumps,
                // redder older populations between.
                const blue = Math.random() < 0.15 + 0.5 * clump;
                const intensity = 0.25 + 0.75 * (1 - r / 20000);
                if (blue) {
                    colors[i * 3] = 0.5 * intensity;
                    colors[i * 3 + 1] = 0.7 * intensity;
                    colors[i * 3 + 2] = 1.0 * intensity;
                } else {
                    colors[i * 3] = 1.0 * intensity;
                    colors[i * 3 + 1] = 0.7 * intensity;
                    colors[i * 3 + 2] = 0.35 * intensity;
                }

                sizes[i] = (3 + Math.random() * 6 * (1 - r / 20000)) * (1 + clump);
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uScale: { value: window.innerHeight / 2 },
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
                        gl_PointSize = clamp(pointSize, 0.5, 10.0);
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    varying vec3 vColor;
                    void main() {
                        vec2 cxy = 2.0 * gl_PointCoord - 1.0;
                        float r = dot(cxy, cxy);
                        float alpha = smoothstep(1.0, 0.0, r);
                        gl_FragColor = vec4(vColor, alpha);
                    }
                `,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });

            const armMesh = new THREE.Points(geometry, material);
            armMesh.frustumCulled = false;
            this.spiralArms.add(armMesh);
        });

        this.scene.add(this.spiralArms);
    }

    // --- Central bar: an elongated stellar bar like the real Milky Way's ---
    createCentralBar() {
        const positions = new Float32Array(15000 * 3);
        const colors = new Float32Array(15000 * 3);
        const sizes = new Float32Array(15000);

        for (let i = 0; i < 15000; i++) {
            // Bar is ~4 kpc long, extends from the core
            const halfLen = 2200;
            const x = (Math.random() * 2 - 1) * halfLen;
            const y = (Math.random() - 0.5) * 500;
            const z = (Math.random() - 0.5) * 700;

            // Denser toward the middle
            const density = 1 - Math.abs(x) / halfLen;
            if (Math.random() > density) continue;

            positions[i * 3] = GALACTIC_CENTER.x + x;
            positions[i * 3 + 1] = GALACTIC_CENTER.y + y;
            positions[i * 3 + 2] = GALACTIC_CENTER.z + z;

            const warm = Math.random() < 0.8;
            const b = 0.4 + 0.4 * density;
            colors[i * 3] = warm ? b : b * 0.5;
            colors[i * 3 + 1] = warm ? b * 0.85 : b * 0.7;
            colors[i * 3 + 2] = warm ? b * 0.5 : b;
            sizes[i] = 2 + Math.random() * 4 * density;
        }

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
                    gl_PointSize = clamp(pointSize, 0.5, 8.0);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                void main() {
                    vec2 cxy = 2.0 * gl_PointCoord - 1.0;
                    float r = dot(cxy, cxy);
                    float alpha = smoothstep(1.0, 0.0, r);
                    gl_FragColor = vec4(vColor, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.centralBar = new THREE.Points(geometry, material);
        this.centralBar.frustumCulled = false;
        this.scene.add(this.centralBar);
    }

    createGalaxyCore() {
        const coreGeometry = new THREE.SphereGeometry(900, 64, 32);
        const coreMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
            },
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
                    float r = length(vPos.xy) / 900.0;
                    float z = abs(vPos.z) / 600.0;
                    float density = smoothstep(1.0, 0.0, r) * smoothstep(1.0, 0.0, z);
                    // Warm yellowish bulge light with subtle mottling
                    vec3 color = mix(vec3(1.0, 0.95, 0.8), vec3(1.0, 0.6, 0.25), r * 0.7);
                    float mottle = 0.85 + 0.15 * sin(vPos.x * 0.02 + uTime * 0.3) * sin(vPos.z * 0.02);
                    float pulse = 0.9 + 0.1 * sin(uTime * 0.4 + r * 6.0);
                    gl_FragColor = vec4(color * density * mottle * pulse, density * 0.85);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
        });

        this.galaxyCore = new THREE.Mesh(coreGeometry, coreMaterial);
        this.galaxyCore.position.copy(GALACTIC_CENTER);
        this.scene.add(this.galaxyCore);
    }

    // --- Dust lanes: dark interstellar dust that obscures the disk ---
    createDustLanes() {
        const positions = new Float32Array(12000 * 3);
        const colors = new Float32Array(12000 * 3);
        const sizes = new Float32Array(12000);

        for (let i = 0; i < 12000; i++) {
            const r = 1500 + Math.random() * 14000;
            const theta = Math.random() * Math.PI * 2;
            const z = (Math.random() - 0.5) * 120;

            positions[i * 3] = GALACTIC_CENTER.x + r * Math.cos(theta);
            positions[i * 3 + 1] = GALACTIC_CENTER.y + z;
            positions[i * 3 + 2] = GALACTIC_CENTER.z + r * Math.sin(theta);

            // Dark reddish-brown dust
            const b = 0.03 + Math.random() * 0.05;
            colors[i * 3] = b * 1.4;
            colors[i * 3 + 1] = b * 0.9;
            colors[i * 3 + 2] = b * 0.6;
            sizes[i] = 8 + Math.random() * 20;
        }

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
                    gl_PointSize = clamp(pointSize, 1.0, 40.0);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                void main() {
                    vec2 cxy = 2.0 * gl_PointCoord - 1.0;
                    float r = dot(cxy, cxy);
                    float alpha = smoothstep(1.0, 0.0, r);
                    // Subtractive: darken the background stars
                    gl_FragColor = vec4(vColor, alpha * 0.5);
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
        const material = new THREE.MeshBasicMaterial({
            color: 0xfff7d6,
            transparent: true,
            opacity: 1.0,
        });
        this.sunMarker = new THREE.Mesh(geometry, material);
        this.sunMarker.position.set(0, 0, 0);
        this.scene.add(this.sunMarker);

        const glowGeometry = new THREE.SphereGeometry(1, 32, 16);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: 0xffe08a,
            transparent: true,
            opacity: 0.25,
            wireframe: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
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

        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(400, 100, 1);
        return sprite;
    }

    update(deltaTime, cameraPosition) {
        if (this.diskStars) {
            this.diskStars.rotation.y += deltaTime * 0.00001;
        }
        if (this.spiralArms) {
            this.spiralArms.rotation.y += deltaTime * 0.000005;
        }
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
        [this.starPoints, this.diskStars, this.spiralArms, this.centralBar, this.dustLanes].forEach(points => {
            if (!points) return;
            if (points.material?.uniforms?.uScale) {
                points.material.uniforms.uScale.value = uScale;
            } else if (points.traverse) {
                points.traverse(obj => {
                    if (obj.material?.uniforms?.uScale) {
                        obj.material.uniforms.uScale.value = uScale;
                    }
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
