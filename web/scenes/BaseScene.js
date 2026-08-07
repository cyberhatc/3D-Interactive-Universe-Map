import * as THREE from 'three';

export class BaseScene {
    constructor(name, options = {}) {
        this.name = name;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(
            options.fov || 60,
            window.innerWidth / window.innerHeight,
            options.near || 0.1,
            options.far || 10000
        );
        this.objects = new Map();
        this.enabled = false;
    }

    async init() {}

    enable() {
        this.enabled = true;
    }

    disable() {
        this.enabled = false;
    }

    update(deltaTime, cameraPosition) {}

    resize(width, height) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }

    dispose() {
        this.scene.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        });
    }
}