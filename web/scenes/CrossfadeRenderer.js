import * as THREE from 'three';

export class CrossfadeRenderer {
    constructor(renderer) {
        this.renderer = renderer;
        this.renderTargets = {
            sceneA: new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                type: THREE.UnsignedByteType,
            }),
            sceneB: new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                type: THREE.UnsignedByteType,
            }),
        };

        this.quadScene = new THREE.Scene();
        this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        const quadGeometry = new THREE.PlaneGeometry(2, 2);
        this.quadMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tSceneA: { value: this.renderTargets.sceneA.texture },
                tSceneB: { value: this.renderTargets.sceneB.texture },
                uProgress: { value: 0 },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tSceneA;
                uniform sampler2D tSceneB;
                uniform float uProgress;
                varying vec2 vUv;
                void main() {
                    vec4 colorA = texture2D(tSceneA, vUv);
                    vec4 colorB = texture2D(tSceneB, vUv);
                    float progress = smoothstep(0.0, 1.0, uProgress);
                    gl_FragColor = mix(colorA, colorB, progress);
                }
            `,
            transparent: true,
        });

        const quad = new THREE.Mesh(quadGeometry, this.quadMaterial);
        this.quadScene.add(quad);
    }

    render(renderData) {
        const { crossfade, scene, camera, sceneA, sceneB, progress } = renderData;

        if (!crossfade) {
            this.renderer.setRenderTarget(null);
            this.renderer.render(scene, camera);
            return;
        }

        this.renderer.setRenderTarget(this.renderTargets.sceneA);
        this.renderer.clear();
        this.renderer.render(sceneA, camera);

        this.renderer.setRenderTarget(this.renderTargets.sceneB);
        this.renderer.clear();
        this.renderer.render(sceneB, camera);

        this.renderer.setRenderTarget(null);
        this.quadMaterial.uniforms.uProgress.value = progress;
        this.renderer.render(this.quadScene, this.quadCamera);
    }

    resize(width, height) {
        this.renderTargets.sceneA.setSize(width, height);
        this.renderTargets.sceneB.setSize(width, height);
    }

    dispose() {
        this.renderTargets.sceneA.dispose();
        this.renderTargets.sceneB.dispose();
        this.quadMaterial.dispose();
    }
}