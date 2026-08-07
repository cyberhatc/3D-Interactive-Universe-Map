import * as THREE from 'three';

// Manages the four scale scenes. A single shared camera renders every scene —
// this is what makes the crossfade between scales a true continuous zoom
// (same vantage point, only the content layer changes).
export class SceneManager {
    constructor(renderer, canvas, sharedCamera) {
        this.renderer = renderer;
        this.canvas = canvas;
        this.camera = sharedCamera;
        this.scenes = new Map();
        this.currentScene = null;
        this.targetScene = null;
        this.transitionProgress = 0;
        this.transitionDuration = 2000;
        this.isTransitioning = false;
        this.transitionStartTime = 0;
    }

    registerScene(name, scene) {
        this.scenes.set(name, scene);
        if (!this.currentScene) this.currentScene = name;
    }

    getCurrentScene() {
        return this.scenes.get(this.currentScene);
    }

    requestTransition(targetSceneName) {
        if (targetSceneName === this.currentScene || this.isTransitioning) return false;
        if (!this.scenes.has(targetSceneName)) return false;

        this.targetScene = targetSceneName;
        this.isTransitioning = true;
        this.transitionProgress = 0;
        this.transitionStartTime = performance.now();
        return true;
    }

    update(deltaTime) {
        if (!this.isTransitioning) return false;

        const now = performance.now();
        this.transitionProgress = Math.min(1, (now - this.transitionStartTime) / this.transitionDuration);

        if (this.transitionProgress >= 1) {
            this.currentScene = this.targetScene;
            this.targetScene = null;
            this.isTransitioning = false;
        }
        return true;
    }

    getRenderData() {
        const camera = this.camera;
        if (!this.isTransitioning) {
            return {
                scene: this.getCurrentScene(),
                camera,
                crossfade: false,
            };
        }
        return {
            sceneA: this.scenes.get(this.currentScene),
            sceneB: this.scenes.get(this.targetScene),
            camera,
            crossfade: true,
            progress: this.transitionProgress,
        };
    }

    getCurrentSceneName() {
        return this.currentScene;
    }
}
