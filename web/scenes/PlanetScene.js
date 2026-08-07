import * as THREE from 'three';
import { BaseScene } from './BaseScene.js';
import { getPlanetTexture, getRingTexture } from './planetTextures.js';

const PLANET_DETAILS = {
    Sun: { radius: 696340.0, color: 0xffdd88, rotationPeriod: 27.0, axialTilt: 7.25, textureUrl: 'https://www.solarsystemscope.com/textures/download/2k_sun.jpg' },
    Mercury: { radius: 2439.7, color: 0xb5b5b5, rotationPeriod: 58.6, axialTilt: 0.03, textureUrl: 'https://www.solarsystemscope.com/textures/download/2k_mercury.jpg' },
    Venus: { radius: 6051.8, color: 0xe6c87a, rotationPeriod: -243.0, axialTilt: 177.4, textureUrl: 'https://www.solarsystemscope.com/textures/download/2k_venus_surface.jpg' },
    Earth: { radius: 6371.0, color: 0x4a9fff, rotationPeriod: 1.0, axialTilt: 23.4, textureUrl: 'https://www.solarsystemscope.com/textures/download/2k_earth_daymap.jpg', hasMoon: true, moonDistance: 384400 },
    Mars: { radius: 3389.5, color: 0xe27b58, rotationPeriod: 1.03, axialTilt: 25.2, textureUrl: 'https://www.solarsystemscope.com/textures/download/2k_mars.jpg' },
    Jupiter: { radius: 69911.0, color: 0xd4a574, rotationPeriod: 0.41, axialTilt: 3.1, textureUrl: 'https://www.solarsystemscope.com/textures/download/2k_jupiter.jpg' },
    Saturn: { radius: 58232.0, color: 0xf4e4bc, rotationPeriod: 0.44, axialTilt: 26.7, textureUrl: 'https://www.solarsystemscope.com/textures/download/2k_saturn.jpg', hasRings: true },
    Uranus: { radius: 25362.0, color: 0x7de3f4, rotationPeriod: -0.72, axialTilt: 97.8, textureUrl: 'https://www.solarsystemscope.com/textures/download/2k_uranus.jpg' },
    Neptune: { radius: 24622.0, color: 0x4b70dd, rotationPeriod: 0.67, axialTilt: 28.3, textureUrl: 'https://www.solarsystemscope.com/textures/download/2k_neptune.jpg' },
};

export class PlanetScene extends BaseScene {
    constructor() {
        super('planet', { near: 1, far: 1000000 });
        this.planet = null;
        this.planetData = null;
        this.moon = null;
        this.rings = null;
        this.atmosphere = null;
        this.starfield = null;
        this.rotationSpeed = 1;
    }

    async init(planetName) {
        this.planetName = planetName;
        this.planetData = PLANET_DETAILS[planetName] || PLANET_DETAILS.Earth;
        this.createStarfield();
        await this.createPlanet();
        if (this.planetData.hasMoon) this.createMoon();
        if (this.planetData.hasRings) this.createRings();
        this.createAtmosphere();
        this.setupScene();
    }

    setupScene() {
        this.scene.background = new THREE.Color(0x000000);
    }

    createStarfield() {
        this.starfield = new THREE.Group();
        const positions = new Float32Array(5000 * 3);
        const colors = new Float32Array(5000 * 3);

        for (let i = 0; i < 5000; i++) {
            const u = Math.random() * 2 - 1;
            const phi = Math.acos(u);
            const theta = Math.random() * Math.PI * 2;
            const r = 500000;
            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.cos(phi);
            positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
            const b = 0.5 + Math.random() * 0.5;
            colors[i * 3] = b;
            colors[i * 3 + 1] = b;
            colors[i * 3 + 2] = b;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 100,
            vertexColors: true,
            sizeAttenuation: false,
            transparent: true,
            opacity: 0.8,
            depthWrite: false,
        });

        const stars = new THREE.Points(geometry, material);
        stars.frustumCulled = false;
        this.starfield.add(stars);
        this.scene.add(this.starfield);
    }

    async createPlanet() {
        const radius = this.planetData.radius;
        const geometry = new THREE.SphereGeometry(radius, 64, 64);

        const isSun = this.planetName === 'Sun';
        const texture = getPlanetTexture(this.planetName);
        let material;
        if (isSun) {
            material = new THREE.MeshBasicMaterial({ map: texture, color: 0xfff2cc });
        } else {
            material = new THREE.MeshStandardMaterial({
                map: texture,
                color: 0xffffff,
                roughness: 0.8,
                metalness: 0.1,
            });
        }

        this.planet = new THREE.Mesh(geometry, material);
        this.planet.castShadow = true;
        this.planet.receiveShadow = true;
        this.scene.add(this.planet);

        const tilt = this.planetData.axialTilt * Math.PI / 180;
        this.planet.rotation.z = tilt;

        const light = new THREE.DirectionalLight(0xffffee, 1.5);
        light.position.set(100000, 50000, 100000);
        light.castShadow = true;
        light.shadow.mapSize.width = 2048;
        light.shadow.mapSize.height = 2048;
        light.shadow.camera.near = 1000;
        light.shadow.camera.far = 500000;
        light.shadow.camera.left = -150000;
        light.shadow.camera.right = 150000;
        light.shadow.camera.top = 150000;
        light.shadow.camera.bottom = -150000;
        this.scene.add(light);
        this.planet.userData.sunLight = light;
    }

    createMoon() {
        const moonData = { radius: 1737.4, distance: this.planetData.moonDistance };
        const geometry = new THREE.SphereGeometry(moonData.radius, 32, 32);
        const material = new THREE.MeshStandardMaterial({
            map: getPlanetTexture('Moon'),
            color: 0xffffff,
            roughness: 0.9,
        });
        this.moon = new THREE.Mesh(geometry, material);
        this.moon.position.set(moonData.distance, 0, 0);
        this.planet.add(this.moon);
    }

    createRings() {
        const innerRadius = this.planetData.radius * 1.2;
        const outerRadius = this.planetData.radius * 2.3;
        const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 128);
        const material = new THREE.MeshBasicMaterial({
            map: getRingTexture(),
            transparent: true,
            opacity: 0.95,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        this.rings = new THREE.Mesh(geometry, material);
        this.rings.rotation.x = -Math.PI / 2;
        this.planet.add(this.rings);
    }

    createAtmosphere() {
        const atmosphereColors = {
            Earth: 0x4a9fff,
            Venus: 0xe8d29a,
            Mars: 0xe2786a,
        };
        if (atmosphereColors[this.planetName]) {
            const geometry = new THREE.SphereGeometry(this.planetData.radius * 1.02, 64, 64);
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uColor: { value: new THREE.Color(atmosphereColors[this.planetName]) },
                    uCameraPos: { value: new THREE.Vector3() },
                },
                vertexShader: `
                    varying vec3 vNormal;
                    varying vec3 vWorldPos;
                    void main() {
                        vNormal = normalize(normalMatrix * normal);
                        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform vec3 uColor;
                    uniform vec3 uCameraPos;
                    varying vec3 vNormal;
                    varying vec3 vWorldPos;
                    void main() {
                        vec3 viewDir = normalize(uCameraPos - vWorldPos);
                        float rim = 1.0 - max(dot(vNormal, viewDir), 0.0);
                        float alpha = pow(rim, 3.0) * 0.3;
                        gl_FragColor = vec4(uColor, alpha);
                    }
                `,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.BackSide,
            });
            this.atmosphere = new THREE.Mesh(geometry, material);
            this.planet.add(this.atmosphere);
        }
    }

    update(deltaTime, cameraPosition) {
        const rotationRate = (2 * Math.PI) / (this.planetData.rotationPeriod * 24) * this.rotationSpeed;
        this.planet.rotation.y += rotationRate * deltaTime;

        if (this.starfield) {
            this.starfield.rotation.y += deltaTime * 0.00001;
        }

        if (this.moon) {
            this.moon.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.0001);
        }

        if (this.atmosphere?.material?.uniforms?.uCameraPos) {
            this.atmosphere.material.uniforms.uCameraPos.value.copy(cameraPosition);
        }
    }

    setRotationSpeed(speed) {
        this.rotationSpeed = speed;
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