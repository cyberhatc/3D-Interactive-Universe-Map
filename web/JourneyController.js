import * as THREE from 'three';

// Light-time based journey from Earth out to the edge of the mapped universe.
// The camera always moves at exactly the speed of light: its distance from
// Earth is L (light-years), so the HUD "looking back Y years" is exact.
// The TIME slider is the only knob: it compresses time so the flight is
// watchable (1 real second = X light-years of travel).
//
// Scene units (all share Earth/Sun at origin, equatorial J2000 axes):
//   planet : km            planet:Earth
//   solar  : 1 unit = 0.005 AU
//   milky  : 1 unit = 1 pc
//   cosmic : 1 unit = 1 Mpc

const KM_PER_LY = 9.4607304725808e12;
const AU_PER_LY = 63241.077;
const PC_PER_LY = 0.3066013938;
const MPC_PER_LY = 3.066013938e-7;
const SOLAR_UNITS_PER_LY = AU_PER_LY * 200;

const EARTH_R_KM = 6371;
const START_ALT_KM = 2500;

// Zone boundaries in light-years.
const PLANET_END_LY = 4.5e-8;      // just past the Moon (~4.06e-8 ly)
const SOLAR_END_LY = 0.01;         // 632 AU — Oort Cloud approaches
const MILKY_END_LY = 104371;       // 32,000 pc — galactic halo edge
const COSMIC_END_LY = 6.35e9;      // ~1946 Mpc — farthest mapped galaxy

const MIN_SPEED = 1e-12;           // ly per real second (sub-planetary travel)
const MAX_SPEED = 1e10;
// Cruise mode: speed = CRUISE_K * L — an exponential zoom. The journey takes
// ~90 s from Earth's surface to the edge of the mapped universe, while always
// reporting the true light-time (distance = lookback years).
const CRUISE_K = 0.55;

function zoneFor(L) {
    if (L < PLANET_END_LY) return 'planet';
    if (L < SOLAR_END_LY) return 'solar';
    if (L < MILKY_END_LY) return 'milky';
    return 'cosmic';
}

function sceneNameFor(zone) {
    switch (zone) {
        case 'planet': return 'planet:Earth';
        case 'solar': return 'solar-system';
        case 'milky': return 'milky-way';
        default: return 'cosmic-web';
    }
}

export class JourneyController {
    constructor(host) {
        this.host = host; // { camera, getSceneName(), requestTransition(), onHud(), onDone(), onExit() }
        this.active = false;
        this.paused = true;
        this.cruise = true;
        this.finished = false;
        this.speed = 0.5;       // ly / real second
        this.L = PLANET_END_LY; // current light-time from Earth (ly)
        this.dir = new THREE.Vector3(0, 0, 1);
        this.lastZone = null;
        this.lookBack = true;   // look back at Earth at the very start
        this._tmpPos = new THREE.Vector3();
    }

    setDirectionFromRaDec(raDeg, decDeg) {
        const ra = raDeg * Math.PI / 180;
        const dec = decDeg * Math.PI / 180;
        this.dir.set(
            Math.cos(dec) * Math.cos(ra),
            Math.cos(dec) * Math.sin(ra),
            Math.sin(dec)
        ).normalize();
    }

    start() {
        this.active = true;
        this.paused = false;
        this.cruise = true;
        this.finished = false;
        this.speed = Math.max(MIN_SPEED, this.host.speed || 0.5);
        this.L = (EARTH_R_KM + START_ALT_KM) / KM_PER_LY;
        this.lookBack = true;
        this.lastZone = null;
        this.host.onHud('Leaving Earth', `Light-speed journey · starting from Earth's surface`, 0);
    }

    stop() {
        this.active = false;
        this.paused = true;
        this.host.onExit();
    }

    setPaused(p) {
        this.paused = p;
    }

    togglePause() {
        this.paused = !this.paused;
        return this.paused;
    }

    setSpeed(lyPerSecond) {
        this.cruise = false;
        this.speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, lyPerSecond));
    }

    setCruise(on) {
        this.cruise = on;
    }

    get zone() {
        return zoneFor(this.L);
    }

    update(dt) {
        if (!this.active) return;

        // Advance light-time at the speed of light * time compression.
        if (!this.paused) {
            if (this.cruise) {
                // Exponential zoom: speed grows with distance, so each scale
                // gets roughly equal screen time.
                this.speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, CRUISE_K * this.L));
            }
            this.L += this.speed * dt;
            if (this.L >= COSMIC_END_LY) {
                this.L = COSMIC_END_LY;
                this.paused = true;
                if (!this.finished) {
                    this.finished = true;
                    this.host.onDone();
                }
            }
        }

        // Zone crossfades happen automatically as L crosses a boundary.
        const zone = this.zone;
        const targetScene = sceneNameFor(zone);
        if (targetScene !== this.host.getSceneName()) {
            this.host.requestTransition(targetScene);
        }
        if (zone !== this.lastZone) {
            this.lastZone = zone;
            this.host.onZoneChange(zone);
        }

        // Place the camera at the correct physical distance in scene units.
        const camera = this.host.camera;
        const d = this.distanceInSceneUnits(zone);
        this._tmpPos.copy(this.dir).multiplyScalar(d);
        camera.position.copy(this._tmpPos);

        // Relative frustum: see ~1000x ahead, ~1e-4 behind of current position.
        camera.near = Math.max(d * 1e-4, 1e-9);
        camera.far = Math.max(d * 1e3, 1e4);
        camera.updateProjectionMatrix();

        // Look back at Earth at the very start, then look outward.
        if (zone === 'planet' && this.L < (EARTH_R_KM * 6) / KM_PER_LY) {
            camera.lookAt(0, 0, 0);
        } else {
            camera.lookAt(this._tmpPos.x + this.dir.x, this._tmpPos.y + this.dir.y, this._tmpPos.z + this.dir.z);
        }

        this.host.onHud(this.zoneLabel(zone), this.hudText(), this.speed);
    }

    distanceInSceneUnits(zone) {
        switch (zone) {
            case 'planet': return this.L * KM_PER_LY;
            case 'solar': return this.L * SOLAR_UNITS_PER_LY;
            case 'milky': return this.L * PC_PER_LY;
            default: return this.L * MPC_PER_LY;
        }
    }

    zoneLabel(zone) {
        switch (zone) {
            case 'planet': {
                const km = this.L * KM_PER_LY;
                if (km < 2 * EARTH_R_KM) return 'Launching from Earth';
                if (km < 1e5) return 'Leaving Earth\u2019s orbit';
                return 'Passing the Moon';
            }
            case 'solar': {
                const au = this.L * AU_PER_LY;
                if (au < 0.4) return 'Inside Mercury\u2019s orbit';
                if (au < 1.1) return 'Crossing Earth\u2019s orbit';
                if (au < 31) return 'Crossing the outer planets';
                if (au < 175) return 'Passing Voyager 1';
                return 'Beyond the planets \u2014 Voyager 1 behind you';
            }
            case 'milky': {
                const pc = this.L * PC_PER_LY;
                const ly = this.L;
                if (pc < 1000) return 'Solar neighborhood \u2014 nearby stars';
                if (ly < 26000) return 'Inside the galactic disk';
                if (ly < 35000) return 'Passing the galactic core region';
                return 'Flying out through the galactic halo';
            }
            default: {
                const mpc = this.L * MPC_PER_LY;
                if (mpc < 1) return 'Intergalactic space \u2014 Andromeda ahead';
                if (mpc < 400) return '2MASS cosmic web \u2014 full-sky survey';
                if (mpc < 1200) return 'Deep SDSS structures \u2014 Sloan Great Wall region';
                return 'Approaching the edge of the mapped universe';
            }
        }
    }

    hudText() {
        const ly = this.L;
        const lookback = ly;
        let dist;
        if (ly < 1e-5) dist = `${Math.round(ly * KM_PER_LY / 1000)} thousand km`;
        else if (ly < 1e-3) dist = `${(ly * AU_PER_LY).toFixed(2)} AU`;
        else if (ly < 1e3) dist = `${(ly * PC_PER_LY).toFixed(1)} pc`;
        else if (ly < 1e6) dist = `${(ly / 1e3).toFixed(1)} thousand ly`;
        else if (ly < 1e9) dist = `${(ly / 1e6).toFixed(2)} million ly`;
        else dist = `${(ly / 1e9).toFixed(2)} billion ly`;

        let look;
        if (lookback < 1e3) look = `${Math.round(lookback)} yr`;
        else if (lookback < 1e6) look = `${(lookback / 1e3).toFixed(1)}k yr`;
        else if (lookback < 1e9) look = `${(lookback / 1e6).toFixed(1)}M yr`;
        else look = `${(lookback / 1e9).toFixed(2)}B yr`;

        return `Light-speed journey · ${dist} from Earth · looking back ${look}`;
    }
}
