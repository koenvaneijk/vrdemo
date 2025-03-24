// Import Three.js modules from npm
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as Tone from 'tone';

// Create a custom logger that sends logs to the server
const logger = {
    log: function(...args) {
        console.log(...args);
        fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ level: 'log', message: args.map(arg => String(arg)).join(' ') })
        }).catch(e => console.error('Failed to send log to server:', e));
    },
    error: function(...args) {
        console.error(...args);
        fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ level: 'error', message: args.map(arg => String(arg)).join(' ') })
        }).catch(e => console.error('Failed to send error to server:', e));
    },
    warn: function(...args) {
        console.warn(...args);
        fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ level: 'warn', message: args.map(arg => String(arg)).join(' ') })
        }).catch(e => console.error('Failed to send warning to server:', e));
    }
};

// Capture global errors
window.addEventListener('error', (event) => {
    logger.error('Global error:', event.message, 'at', event.filename, 'line', event.lineno);
});

// Capture unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
    logger.error('Unhandled Promise Rejection:', event.reason);
});

// Main Three.js VR application
let scene, camera, renderer;
let controllers = [];
let gunModels = [];
let pointerLines = [];
let gunModelLeft, gunModelRight;
let shootingSounds = [];
let muzzleFlashes = [];
let isShooting = [false, false]; // Track shooting state for each controller
let targets = []; // Array to store target objects
let targetHitSound; // Sound for when a target is hit
let raycasters = [new THREE.Raycaster(), new THREE.Raycaster()]; // Raycasters for collision detection
let spawnTargetsInterval; // Interval for spawning targets
let moveTargetsInterval; // Interval for moving targets
let score = 0; // Player's score
let scoreText; // 3D text for displaying score

// Target types with their properties
const TARGET_TYPES = {
    SMALL: {
        size: 0.15,
        color: 0xff0000, // Red
        emissiveIntensity: 0.5,
        speedMultiplier: 2.0,
        points: 30,
        spawnChance: 0.2, // 20% chance
        maxHealth: 1     // One hit to destroy
    },
    MEDIUM: {
        size: 0.3,
        color: 0xffff00, // Yellow
        emissiveIntensity: 0.3,
        speedMultiplier: 1.0,
        points: 10,
        spawnChance: 0.5, // 50% chance
        maxHealth: 2     // Two hits to destroy
    },
    LARGE: {
        size: 0.5,
        color: 0x00ff00, // Green
        emissiveIntensity: 0.2,
        speedMultiplier: 0.6,
        points: 5,
        spawnChance: 0.3, // 30% chance
        maxHealth: 3     // Three hits to destroy
    }
};

// Initialize Tone.js sound effects
function initSounds() {
    // Start Tone.js audio context (needs to be triggered by user interaction)
    const startAudio = async () => {
        try {
            await Tone.start();
            logger.log('Tone.js audio context started');
            // Remove the event listeners once audio is started
            document.removeEventListener('click', startAudio);
            document.removeEventListener('touchstart', startAudio);
            document.getElementById('enter-vr-button').removeEventListener('click', startAudio);
        } catch (error) {
            logger.error('Failed to start Tone.js audio context:', error);
        }
    };
    
    // Add multiple event listeners to ensure audio starts
    document.addEventListener('click', startAudio);
    document.addEventListener('touchstart', startAudio);
    document.getElementById('enter-vr-button').addEventListener('click', startAudio);
    
    // Create shooting sound for each gun
    for (let i = 0; i < 2; i++) {
        // Create a more realistic gunshot sound using multiple synths and effects
        
        // Base drum sound for the initial impact - deeper and more powerful
        const membraneSynth = new Tone.MembraneSynth({
            pitchDecay: 0.05,
            octaves: 10,        // Wider range for more bass
            oscillator: {
                type: "sine"    // Sine wave for cleaner bass
            },
            envelope: {
                attack: 0.001,
                decay: 0.2,
                sustain: 0.02,
                release: 0.4,
                attackCurve: "exponential"
            }
        });
        
        // Noise component for the "blast" effect - louder and more explosive
        const noise = new Tone.NoiseSynth({
            noise: {
                type: "brown"   // Brown noise has more low-frequency content
            },
            envelope: {
                attack: 0.001,
                decay: 0.3,     // Longer decay
                sustain: 0.1,
                release: 0.2
            }
        });
        
        // Second noise layer for the initial crack/explosion
        const crackNoise = new Tone.NoiseSynth({
            noise: {
                type: "white"
            },
            envelope: {
                attack: 0.001,
                decay: 0.08,
                sustain: 0,
                release: 0.05
            }
        });
        
        // Low frequency oscillator for the rumble
        const lowSynth = new Tone.Synth({
            oscillator: {
                type: "sine"
            },
            envelope: {
                attack: 0.005,
                decay: 0.4,
                sustain: 0.01,
                release: 0.4
            }
        });
        
        // Effects chain
        const distortion = new Tone.Distortion(0.8);
        const reverb = new Tone.Reverb(1.5);  // Longer reverb
        reverb.wet.value = 0.3;
        const compressor = new Tone.Compressor(-15, 5);  // More compression
        const lowpass = new Tone.Filter(2000, "lowpass");  // Filter high frequencies
        const volume = new Tone.Volume(-5);  // Louder overall volume
        
        // Connect everything
        membraneSynth.chain(distortion, lowpass, compressor, volume, Tone.Destination);
        noise.chain(distortion, reverb, compressor, volume, Tone.Destination);
        crackNoise.chain(distortion, compressor, volume, Tone.Destination);
        lowSynth.chain(lowpass, reverb, compressor, volume, Tone.Destination);
        
        // Create a function to trigger all components with precise timing
        const gunshot = {
            triggerAttackRelease: function(note, duration) {
                // Initial crack/explosion
                crackNoise.triggerAttackRelease("16n");
                
                // Main bass impact (slightly delayed)
                setTimeout(() => {
                    membraneSynth.triggerAttackRelease(note, duration);
                    // Low rumble
                    lowSynth.triggerAttackRelease(note, "8n");
                }, 5);
                
                // Sustained noise component
                setTimeout(() => {
                    noise.triggerAttackRelease(duration);
                }, 10);
            }
        };
        
        shootingSounds.push(gunshot);
    }
    
    // Create target hit sound
    targetHitSound = new Tone.MetalSynth({
        frequency: 200,
        envelope: {
            attack: 0.001,
            decay: 0.1,
            release: 0.1
        },
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 4000,
        octaves: 1.5
    }).toDestination();
}

// Create a simple gun model
function createGunModel(color) {
    const gunGroup = new THREE.Group();
    
    // Gun barrel
    const barrelGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.3, 16);
    const barrelMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 });
    const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.15;
    gunGroup.add(barrel);
    
    // Gun handle
    const handleGeometry = new THREE.BoxGeometry(0.05, 0.1, 0.03);
    const handleMaterial = new THREE.MeshStandardMaterial({ color: color, roughness: 0.7 });
    const handle = new THREE.Mesh(handleGeometry, handleMaterial);
    handle.position.y = -0.05;
    gunGroup.add(handle);
    
    // Gun body
    const bodyGeometry = new THREE.BoxGeometry(0.06, 0.06, 0.1);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.z = -0.02;
    gunGroup.add(body);
    
    // Sight
    const sightGeometry = new THREE.BoxGeometry(0.01, 0.03, 0.01);
    const sightMaterial = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const sight = new THREE.Mesh(sightGeometry, sightMaterial);
    sight.position.set(0, 0.03, -0.02);
    gunGroup.add(sight);
    
    // Create muzzle flash (initially invisible)
    const flashGeometry = new THREE.CylinderGeometry(0.01, 0.05, 0.1, 16);
    const flashMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xffff00,
        transparent: true,
        opacity: 0.0
    });
    const muzzleFlash = new THREE.Mesh(flashGeometry, flashMaterial);
    muzzleFlash.rotation.x = Math.PI / 2;
    muzzleFlash.position.z = -0.35; // Position at the end of the barrel
    gunGroup.add(muzzleFlash);
    
    // Position the gun to align better with the arm direction
    // Move it back along the arm axis so it appears to extend from the arm
    gunGroup.position.z = 0.1;  // Move slightly toward the user's arm
    
    return gunGroup;
}

// Play shooting animation and sound
function shootGun(index) {
    try {
        if (isShooting[index]) return; // Already shooting
        
        logger.log(`Shooting gun ${index}`);
        isShooting[index] = true;
        
        // Play sound
        shootingSounds[index].triggerAttackRelease("A0", "8n");
        
        // Show muzzle flash
        const flash = muzzleFlashes[index];
        if (flash) {
            flash.material.opacity = 1.0;
        } else {
            logger.warn(`Muzzle flash not found for gun ${index}`);
        }
        
        // Check for target hits
        checkTargetHits(index);
        
        // Hide muzzle flash after a short delay
        setTimeout(() => {
            if (flash) {
                flash.material.opacity = 0.0;
            }
            isShooting[index] = false;
        }, 100);
    } catch (error) {
        logger.error(`Error in shootGun(${index}):`, error);
        isShooting[index] = false; // Reset shooting state in case of error
    }
}

// Create a score display using a canvas texture
function createScoreDisplay() {
    // Create canvas for the score
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    
    // Fill background
    context.fillStyle = 'rgba(0, 0, 0, 0.5)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw text
    context.font = 'Bold 36px Arial';
    context.fillStyle = 'white';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('Score: 0', canvas.width / 2, canvas.height / 2);
    
    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    
    // Create plane with the texture
    const geometry = new THREE.PlaneGeometry(0.8, 0.4);
    const material = new THREE.MeshBasicMaterial({ 
        map: texture,
        transparent: true
    });
    
    scoreText = new THREE.Mesh(geometry, material);
    scoreText.position.set(0, 2.2, -2);
    scoreText.rotation.x = -0.2;
    
    // Store the canvas context for later updates
    scoreText.userData = { 
        canvas: canvas,
        context: context,
        texture: texture
    };
    
    scene.add(scoreText);
    logger.log('Fallback score display created');
}

// Update the score display
function updateScoreDisplay() {
    if (!scoreText) return;
    
    const context = scoreText.userData.context;
    const canvas = scoreText.userData.canvas;
    
    // Clear canvas
    context.clearRect(0, 0, canvas.width, canvas.height);
    
    // Redraw background
    context.fillStyle = 'rgba(0, 0, 0, 0.5)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw updated score
    context.font = 'Bold 36px Arial';
    context.fillStyle = 'white';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(`Score: ${score}`, canvas.width / 2, canvas.height / 2);
    
    // Update texture
    scoreText.userData.texture.needsUpdate = true;
}

// Initialize the scene, camera, and renderer
function init() {
    // Create scene
    scene = new THREE.Scene();
    
    // Create skybox (low-poly style)
    const skyboxGeometry = new THREE.BoxGeometry(1000, 1000, 1000);
    const skyboxMaterials = [
        new THREE.MeshBasicMaterial({ color: 0x87CEEB, side: THREE.BackSide }), // Right - light blue
        new THREE.MeshBasicMaterial({ color: 0x6495ED, side: THREE.BackSide }), // Left - cornflower blue
        new THREE.MeshBasicMaterial({ color: 0x00BFFF, side: THREE.BackSide }), // Top - deep sky blue
        new THREE.MeshBasicMaterial({ color: 0x4682B4, side: THREE.BackSide }), // Bottom - steel blue
        new THREE.MeshBasicMaterial({ color: 0x87CEEB, side: THREE.BackSide }), // Front - light blue
        new THREE.MeshBasicMaterial({ color: 0x6495ED, side: THREE.BackSide })  // Back - cornflower blue
    ];
    const skybox = new THREE.Mesh(skyboxGeometry, skyboxMaterials);
    scene.add(skybox);

    // Create camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 3);

    // Create renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.xr.enabled = true;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    // Add VR button
    document.body.appendChild(VRButton.createButton(renderer));
    
    // Hide custom button as we're using the standard VRButton
    document.getElementById('enter-vr-button').style.display = 'none';

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0x6b8cff, 0.4); // Soft blue ambient light
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffbb, 1); // Warm sunlight
    directionalLight.position.set(5, 10, 7).normalize();
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    scene.add(directionalLight);
    
    // Add a hemisphere light for more natural outdoor lighting
    const hemisphereLight = new THREE.HemisphereLight(0xffffbb, 0x080820, 0.5);
    scene.add(hemisphereLight);

    // Create a stylized low-poly terrain
    createLowPolyTerrain();
    
    // Add some decorative elements
    addEnvironmentElements();
    
    // Create score display
    createScoreDisplay();
    
    // Initialize sound effects
    initSounds();
    
    // Setup VR controllers
    setupVRControllers();
    
    // Start spawning targets when entering VR
    renderer.xr.addEventListener('sessionstart', () => {
        logger.log('VR session started');
        try {
            // Spawn initial targets
            for (let i = 0; i < 5; i++) {
                spawnTarget();
            }
            
            // Set up interval to spawn new targets
            spawnTargetsInterval = setInterval(() => {
                if (targets.length < 10) { // Limit the number of targets
                    spawnTarget();
                }
            }, 3000); // Spawn a new target every 3 seconds
            
            // Set up interval to move targets
            moveTargetsInterval = setInterval(() => {
                moveTargets();
            }, 16); // Update target positions more frequently for smoother animation (approx 60fps)
            
            logger.log('Initial targets spawned:', targets.length);
        } catch (error) {
            logger.error('Error during VR session start:', error);
        }
    });
    
    // Clean up when exiting VR
    renderer.xr.addEventListener('sessionend', () => {
        logger.log('VR session ended');
        try {
            clearInterval(spawnTargetsInterval);
            clearInterval(moveTargetsInterval);
            // Remove all targets
            const targetCount = targets.length;
            for (let i = targets.length - 1; i >= 0; i--) {
                removeTarget(i);
            }
            logger.log('Cleaned up', targetCount, 'targets');
            logger.log(`Final score: ${score}`);
            
            // Reset score for next session
            score = 0;
            updateScoreDisplay();
        } catch (error) {
            logger.error('Error during VR session cleanup:', error);
        }
    });

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // Start animation loop
    renderer.setAnimationLoop(animate);
}

// Setup VR controllers
function setupVRControllers() {
    // Controller model factory for visualizing the controllers
    const controllerModelFactory = new XRControllerModelFactory();

    // Setup controllers
    for (let i = 0; i < 2; i++) {
        // Create controller
        const controller = renderer.xr.getController(i);
        scene.add(controller);

        // Create gun model for the hand
        const gunColor = i === 0 ? 0xff0000 : 0x0000ff; // Red for left, blue for right
        const gunModel = createGunModel(gunColor);
        
        // Apply a slight rotation to align better with the controller
        gunModel.rotation.x = -0.3; // Tilt down slightly to align with hand grip
        
        controller.add(gunModel);
        
        // Create pointer line
        const lineGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, -5) // 5 meters forward
        ]);
        const lineMaterial = new THREE.LineBasicMaterial({ 
            color: i === 0 ? 0xff0000 : 0x0000ff,
            linewidth: 2
        });
        const pointerLine = new THREE.Line(lineGeometry, lineMaterial);
        
        // Position the line to start from the gun barrel
        pointerLine.position.z = -0.3; // Align with the end of the barrel
        pointerLine.position.y = 0; // Adjust vertical position to match barrel
        
        // Add the line to the gun model instead of directly to the controller
        // This ensures it follows the gun's orientation exactly
        gunModel.add(pointerLine);
        
        // Store reference to the muzzle flash
        const muzzleFlash = gunModel.children.find(child => 
            child.geometry && 
            child.geometry.type === 'CylinderGeometry' && 
            child.position.z < -0.3);
            
        if (muzzleFlash) {
            muzzleFlashes.push(muzzleFlash);
        } else {
            console.error('Muzzle flash not found for gun', i);
            // Create a fallback muzzle flash if not found
            const flashGeometry = new THREE.CylinderGeometry(0.01, 0.05, 0.1, 16);
            const flashMaterial = new THREE.MeshBasicMaterial({ 
                color: 0xffff00,
                transparent: true,
                opacity: 0.0
            });
            const newMuzzleFlash = new THREE.Mesh(flashGeometry, flashMaterial);
            newMuzzleFlash.rotation.x = Math.PI / 2;
            newMuzzleFlash.position.z = -0.35; // Position at the end of the barrel
            gunModel.add(newMuzzleFlash);
            muzzleFlashes.push(newMuzzleFlash);
        }
        
        // Add event listeners for the trigger button
        controller.addEventListener('selectstart', () => {
            shootGun(i);
        });
        
        // Reset shooting state when trigger is released
        controller.addEventListener('selectend', () => {
            isShooting[i] = false;
        });
        
        // Store references
        controllers.push(controller);
        gunModels.push(gunModel);
        pointerLines.push(pointerLine);

        // Add controller grip for model
        const controllerGrip = renderer.xr.getControllerGrip(i);
        const controllerModel = controllerModelFactory.createControllerModel(controllerGrip);
        controllerGrip.add(controllerModel);
        scene.add(controllerGrip);
    }
}

// Handle window resize
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Create a target at a random position on the ground
function spawnTarget() {
    try {
        // Random position on the ground plane
        const x = (Math.random() - 0.5) * 40; // -20 to 20 meters
        const z = (Math.random() - 0.5) * 40; // -20 to 20 meters
        
        // Determine target type based on random chance
        const rand = Math.random();
        let targetType;
        
        if (rand < TARGET_TYPES.SMALL.spawnChance) {
            targetType = TARGET_TYPES.SMALL;
        } else if (rand < TARGET_TYPES.SMALL.spawnChance + TARGET_TYPES.MEDIUM.spawnChance) {
            targetType = TARGET_TYPES.MEDIUM;
        } else {
            targetType = TARGET_TYPES.LARGE;
        }
        
        // Create a group to hold the target and its health bar
        const targetGroup = new THREE.Group();
        
        // Create target geometry (sphere)
        const targetGeometry = new THREE.SphereGeometry(targetType.size, 32, 32);
        const targetMaterial = new THREE.MeshStandardMaterial({ 
            color: targetType.color,
            emissive: targetType.color,
            emissiveIntensity: targetType.emissiveIntensity,
            roughness: 0.4
        });
        const targetMesh = new THREE.Mesh(targetGeometry, targetMaterial);
        
        // Position the target mesh exactly at the center of the group
        targetMesh.position.y = 0;
        targetGroup.add(targetMesh);
        
        // Create health bar
        const healthBarGroup = createHealthBar(targetType.maxHealth);
        healthBarGroup.position.y = targetType.size * 1.5; // Position above the target
        targetGroup.add(healthBarGroup);
        
        // Position the target group with bottom of sphere exactly on ground
        targetGroup.position.set(x, targetType.size, z);
        
        // Add random movement direction
        const angle = Math.random() * Math.PI * 2;
        const baseSpeed = 0.005 + Math.random() * 0.01; // Base speed between 0.005 and 0.015 units per frame
        const speed = baseSpeed * targetType.speedMultiplier; // Apply speed multiplier based on target type
        
        // Store movement data with the target
        targetGroup.userData = {
            velocity: new THREE.Vector2(Math.cos(angle) * speed, Math.sin(angle) * speed),
            lastPosition: new THREE.Vector3(x, targetType.size, z),
            targetPosition: new THREE.Vector3(x, targetType.size, z), // Target position for lerping
            type: targetType, // Store the target type for reference
            points: targetType.points, // Store the point value
            health: targetType.maxHealth, // Current health
            maxHealth: targetType.maxHealth, // Maximum health
            healthBar: healthBarGroup, // Reference to the health bar
            targetMesh: targetMesh // Reference to the actual target mesh
        };
        
        // Add to scene and targets array
        scene.add(targetGroup);
        targets.push(targetGroup);
        
        logger.log(`Spawned ${getTargetTypeName(targetType)} target at (${x.toFixed(2)}, ${targetType.size.toFixed(2)}, ${z.toFixed(2)}), total targets: ${targets.length}`);
        
        return targetGroup;
    } catch (error) {
        logger.error('Error in spawnTarget:', error);
        return null;
    }
}

// Create a health bar for a target
function createHealthBar(maxHealth) {
    const healthBarGroup = new THREE.Group();
    
    // Background bar (black)
    const bgBarGeometry = new THREE.PlaneGeometry(0.5, 0.05);
    const bgBarMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        side: THREE.DoubleSide
    });
    const bgBar = new THREE.Mesh(bgBarGeometry, bgBarMaterial);
    healthBarGroup.add(bgBar);
    
    // Health bar (green)
    const healthBarGeometry = new THREE.PlaneGeometry(0.5, 0.05);
    const healthBarMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        side: THREE.DoubleSide
    });
    const healthBar = new THREE.Mesh(healthBarGeometry, healthBarMaterial);
    healthBar.position.z = 0.001; // Slightly in front of the background
    healthBarGroup.add(healthBar);
    
    // Store references to update later
    healthBarGroup.userData = {
        healthBar: healthBar,
        maxWidth: 0.5
    };
    
    return healthBarGroup;
}

// Update a target's health bar
function updateHealthBar(target) {
    const healthBar = target.userData.healthBar.userData.healthBar;
    const healthPercent = target.userData.health / target.userData.maxHealth;
    const maxWidth = target.userData.healthBar.userData.maxWidth;
    
    // Update the health bar's width based on current health
    healthBar.scale.x = healthPercent;
    // Center the bar by adjusting its position
    healthBar.position.x = (maxWidth * (healthPercent - 1)) / 2;
    
    // Update color based on health percentage
    if (healthPercent > 0.6) {
        healthBar.material.color.setHex(0x00ff00); // Green
    } else if (healthPercent > 0.3) {
        healthBar.material.color.setHex(0xffff00); // Yellow
    } else {
        healthBar.material.color.setHex(0xff0000); // Red
    }
}

// Helper function to get target type name
function getTargetTypeName(targetType) {
    if (targetType === TARGET_TYPES.SMALL) return "SMALL";
    if (targetType === TARGET_TYPES.MEDIUM) return "MEDIUM";
    if (targetType === TARGET_TYPES.LARGE) return "LARGE";
    return "UNKNOWN";
}

// Remove a target from the scene
function removeTarget(index) {
    if (index >= 0 && index < targets.length) {
        scene.remove(targets[index]);
        targets.splice(index, 1);
    }
}

// Check if a ray from the gun hits any targets
function checkTargetHits(controllerIndex) {
    try {
        const controller = controllers[controllerIndex];
        const gunModel = gunModels[controllerIndex];
        
        if (!controller || !gunModel) {
            logger.warn('Missing controller or gun model for index:', controllerIndex);
            return;
        }
        
        // Update raycaster from the gun's position and direction
        const raycaster = raycasters[controllerIndex];
        
        // Get the gun barrel's world position and direction
        controller.updateMatrixWorld(true);
        
        // Create a vector for the gun tip position (end of barrel)
        const gunTip = new THREE.Vector3(0, 0, -0.3);
        // Create a vector for the direction the gun is pointing
        const rayDirection = new THREE.Vector3(0, 0, -1);
        
        // Apply the gun model's local transformations
        gunTip.applyMatrix4(gunModel.matrixWorld);
        rayDirection.transformDirection(gunModel.matrixWorld);
        
        raycaster.set(gunTip, rayDirection);
        
        logger.log(`Gun ${controllerIndex} position: (${gunTip.x.toFixed(2)}, ${gunTip.y.toFixed(2)}, ${gunTip.z.toFixed(2)})`);
        logger.log(`Gun ${controllerIndex} direction: (${rayDirection.x.toFixed(2)}, ${rayDirection.y.toFixed(2)}, ${rayDirection.z.toFixed(2)})`);
        
        // Check for intersections with targets
        // Use a larger threshold for easier hitting (0.2 is the default)
        const intersects = raycaster.intersectObjects(targets, false);
        
        // Check if any target is close to the ray
        let hitTarget = null;
        let hitDistance = Infinity;
        let hitTargetIndex = -1;
        
        // Loop through all targets to find the closest one within range
        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            
            // Get target world position
            const targetPosition = new THREE.Vector3();
            target.getWorldPosition(targetPosition);
            
            // Calculate distance from ray to target center
            const distance = raycaster.ray.distanceToPoint(targetPosition);
            
            // Get the target size and add a small buffer for easier hitting
            const targetSize = target.userData.type ? target.userData.type.size * 1.2 : 0.3;
            
            // If within the target's hitbox radius and closer than any previous hit
            if (distance < targetSize && distance < hitDistance) {
                hitTarget = target;
                hitDistance = distance;
                hitTargetIndex = i;
            }
        }
        
        if (hitTarget) {
            // Get the target data
            const targetData = hitTarget.userData;
            const pointValue = targetData.type.points;
            const targetTypeName = getTargetTypeName(targetData.type);
            
            logger.log(`Hit ${targetTypeName} target ${hitTargetIndex} at distance ${hitDistance.toFixed(2)}`);
            
            // Play hit sound with pitch based on target size (higher pitch for smaller targets)
            const noteOffset = targetData.type === TARGET_TYPES.SMALL ? 12 : 
                              targetData.type === TARGET_TYPES.MEDIUM ? 7 : 0;
            targetHitSound.triggerAttackRelease(`C${5 + Math.floor(noteOffset/12)}`, "16n");
            
            // Reduce target health
            targetData.health--;
            
            // Update the health bar
            updateHealthBar(hitTarget);
            
            // Create a floating damage indicator
            createFloatingScore(hitTarget.position, "-1 HP", 0xff0000);
            
            if (targetData.health <= 0) {
                // Target destroyed - award points
                logger.log(`Destroyed ${targetTypeName} target`);
                
                // Increment score
                score += pointValue;
                logger.log(`Score increased by ${pointValue} to ${score}`);
                
                // Update score display
                updateScoreDisplay();
                
                // Create a floating score indicator at the hit position
                createFloatingScore(hitTarget.position, `+${pointValue}`, 0xffff00);
                
                // Remove the hit target
                removeTarget(hitTargetIndex);
                
                // Spawn a new target after a delay
                setTimeout(() => {
                    if (targets.length < 10) {
                        spawnTarget();
                    }
                }, 1000);
            } else {
                // Target still alive - flash the target to indicate damage
                const targetMesh = targetData.targetMesh;
                const originalEmissiveIntensity = targetData.type.emissiveIntensity;
                
                // Flash effect
                targetMesh.material.emissiveIntensity = 1.0;
                setTimeout(() => {
                    targetMesh.material.emissiveIntensity = originalEmissiveIntensity;
                }, 100);
            }
        }
    } catch (error) {
        logger.error('Error in checkTargetHits:', error);
    }
}

// Create a floating score indicator that rises and fades
function createFloatingScore(position, text, color = 0xffff00) {
    // Create a canvas for the score text
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    
    // Draw the score text
    context.font = 'Bold 32px Arial';
    context.fillStyle = new THREE.Color(color).getStyle();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    
    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    
    // Create a plane with the texture
    const geometry = new THREE.PlaneGeometry(0.5, 0.25);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        side: THREE.DoubleSide
    });
    
    const scoreIndicator = new THREE.Mesh(geometry, material);
    
    // Position it at the hit location
    scoreIndicator.position.copy(position);
    
    // Add to scene
    scene.add(scoreIndicator);
    
    // Store creation time for animation
    scoreIndicator.userData = {
        createdAt: Date.now(),
        lifespan: 1000 // 1 second lifespan
    };
    
    // Add to a list for animation
    if (!window.floatingScores) window.floatingScores = [];
    window.floatingScores.push(scoreIndicator);
}

// Move targets along the ground
function moveTargets() {
    try {
        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            const userData = target.userData;
            const velocity = userData.velocity;
            
            // Update target position based on velocity
            userData.targetPosition.x += velocity.x;
            userData.targetPosition.z += velocity.y;
            
            // Bounce off boundaries
            const boundarySize = 24; // Keep within a 48x48 area (slightly smaller than the 50x50 floor)
            if (Math.abs(userData.targetPosition.x) > boundarySize) {
                velocity.x *= -1; // Reverse x direction
                userData.targetPosition.x = Math.sign(userData.targetPosition.x) * boundarySize; // Keep within bounds
            }
            if (Math.abs(userData.targetPosition.z) > boundarySize) {
                velocity.y *= -1; // Reverse z direction
                userData.targetPosition.z = Math.sign(userData.targetPosition.z) * boundarySize; // Keep within bounds
            }
            
            // Lerp the actual position toward the target position (smooth movement)
            // Use a lerp factor based on the target type - faster targets need faster lerping
            const lerpFactor = userData.type ? (0.05 * userData.type.speedMultiplier) : 0.05;
            target.position.x = THREE.MathUtils.lerp(target.position.x, userData.targetPosition.x, lerpFactor);
            target.position.z = THREE.MathUtils.lerp(target.position.z, userData.targetPosition.z, lerpFactor);
            
            // Update last position
            userData.lastPosition.copy(target.position);
        }
    } catch (error) {
        logger.error('Error in moveTargets:', error);
    }
}

// Create a low-poly terrain
function createLowPolyTerrain() {
    // Create a larger terrain with low-poly style
    const terrainSize = 100;
    const terrainSegments = 50;
    const terrainGeometry = new THREE.PlaneGeometry(terrainSize, terrainSize, terrainSegments, terrainSegments);
    
    // Modify vertices to create hills and valleys
    const vertices = terrainGeometry.attributes.position.array;
    for (let i = 0; i < vertices.length; i += 3) {
        // Skip the center area to keep it flat for gameplay
        const x = vertices[i];
        const z = vertices[i + 2];
        const distanceFromCenter = Math.sqrt(x * x + z * z);
        
        if (distanceFromCenter > 20) {
            // Create hills and valleys outside the gameplay area
            const amplitude = 0.5 + Math.random() * 0.5; // Random height between 0.5 and 1.0
            vertices[i + 1] = amplitude * Math.sin(x * 0.1) * Math.cos(z * 0.1);
            
            // Make the terrain higher toward the edges
            vertices[i + 1] += (distanceFromCenter - 20) * 0.05;
        }
    }
    
    // Update the geometry
    terrainGeometry.computeVertexNormals();
    
    // Create a gradient material for the terrain
    const terrainMaterial = new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.8,
        metalness: 0.1
    });
    
    // Add vertex colors to create a gradient
    const colors = [];
    const color1 = new THREE.Color(0x4CBB17); // Forest green
    const color2 = new THREE.Color(0x228B22); // Forest green (darker)
    const color3 = new THREE.Color(0x8B4513); // Saddle brown (for mountains)
    
    for (let i = 0; i < vertices.length; i += 3) {
        const y = vertices[i + 1];
        let color;
        
        if (y < 0.2) {
            color = color1.clone();
        } else if (y < 1.0) {
            const t = (y - 0.2) / 0.8;
            color = color1.clone().lerp(color2, t);
        } else {
            const t = Math.min((y - 1.0) / 2.0, 1.0);
            color = color2.clone().lerp(color3, t);
        }
        
        colors.push(color.r, color.g, color.b);
    }
    
    terrainGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    
    // Create the terrain mesh
    const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
    terrain.rotation.x = -Math.PI / 2;
    terrain.position.y = -0.5; // Lower the terrain slightly
    scene.add(terrain);
    
    // Add a flat area for gameplay
    const playAreaGeometry = new THREE.CircleGeometry(20, 32);
    const playAreaMaterial = new THREE.MeshStandardMaterial({
        color: 0x90EE90, // Light green
        roughness: 0.9,
        metalness: 0.1,
        flatShading: true
    });
    const playArea = new THREE.Mesh(playAreaGeometry, playAreaMaterial);
    playArea.rotation.x = -Math.PI / 2;
    playArea.position.y = 0;
    scene.add(playArea);
    
    // Add a subtle grid to the play area
    const gridHelper = new THREE.GridHelper(40, 20);
    gridHelper.position.y = 0.01; // Slightly above the ground to avoid z-fighting
    gridHelper.material.opacity = 0.2;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);
}

// Add decorative elements to the environment
function addEnvironmentElements() {
    // Add some low-poly trees
    for (let i = 0; i < 30; i++) {
        // Position trees around the play area but not in it
        const angle = Math.random() * Math.PI * 2;
        const radius = 25 + Math.random() * 40; // Between 25 and 65 units from center
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        
        createLowPolyTree(x, 0, z);
    }
    
    // Add some rocks
    for (let i = 0; i < 20; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 22 + Math.random() * 40; // Between 22 and 62 units from center
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        
        createLowPolyRock(x, 0, z);
    }
    
    // Add distant mountains
    createDistantMountains();
}

// Create a low-poly tree
function createLowPolyTree(x, y, z) {
    const treeGroup = new THREE.Group();
    
    // Tree trunk - position at ground level with half height above ground
    const trunkHeight = 2;
    const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.4, trunkHeight, 6);
    const trunkMaterial = new THREE.MeshStandardMaterial({
        color: 0x8B4513, // Saddle brown
        roughness: 1.0,
        flatShading: true
    });
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = trunkHeight / 2; // Position exactly half height above ground
    treeGroup.add(trunk);
    
    // Tree foliage (cone)
    const foliageGeometry = new THREE.ConeGeometry(1.5, 3, 6);
    const foliageMaterial = new THREE.MeshStandardMaterial({
        color: 0x228B22, // Forest green
        roughness: 1.0,
        flatShading: true
    });
    const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
    foliage.position.y = trunkHeight + 1.5; // Position at top of trunk + half cone height
    treeGroup.add(foliage);
    
    // Position the tree directly on the ground (y=0)
    treeGroup.position.set(x, 0, z);
    
    // Add some random rotation and scale
    treeGroup.rotation.y = Math.random() * Math.PI * 2;
    const scale = 0.7 + Math.random() * 0.6; // Scale between 0.7 and 1.3
    treeGroup.scale.set(scale, scale, scale);
    
    scene.add(treeGroup);
}

// Create a low-poly rock
function createLowPolyRock(x, y, z) {
    const rockSize = 0.5 + Math.random() * 0.5;
    const rockGeometry = new THREE.DodecahedronGeometry(rockSize, 0);
    const rockMaterial = new THREE.MeshStandardMaterial({
        color: 0x808080, // Gray
        roughness: 1.0,
        flatShading: true
    });
    const rock = new THREE.Mesh(rockGeometry, rockMaterial);
    
    // Calculate the lowest point of the dodecahedron to ensure it sits on the ground
    // For a dodecahedron, we need to adjust the y position to account for its shape
    // The factor 0.4 is an approximation that works well for dodecahedrons
    rock.position.set(x, rockSize * 0.4, z);
    
    // Add some random rotation and scale
    rock.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
    );
    const scale = 0.8 + Math.random() * 1.2; // Scale between 0.8 and 2.0
    rock.scale.set(scale, scale * 0.7, scale);
    
    scene.add(rock);
}

// Create distant mountains
function createDistantMountains() {
    const mountainGroup = new THREE.Group();
    
    // Create a ring of mountains around the scene
    for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const radius = 80;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        
        // Create a mountain
        const mountainHeight = 15 + Math.random() * 10;
        const mountainGeometry = new THREE.ConeGeometry(10 + Math.random() * 5, mountainHeight, 5);
        const mountainMaterial = new THREE.MeshStandardMaterial({
            color: 0x4682B4, // Steel blue
            roughness: 1.0,
            flatShading: true
        });
        const mountain = new THREE.Mesh(mountainGeometry, mountainMaterial);
        
        // Position the mountain with half height above ground
        mountain.position.set(x, mountainHeight / 2, z);
        
        // Add some random rotation
        mountain.rotation.y = Math.random() * Math.PI * 2;
        
        mountainGroup.add(mountain);
    }
    
    scene.add(mountainGroup);
}

// Animation loop
function animate() {
    // Update raycasters to match pointer lines
    for (let i = 0; i < controllers.length; i++) {
        if (controllers[i] && gunModels[i]) {
            // Update the raycaster to match the current gun position and orientation
            const gunModel = gunModels[i];
            const gunTip = new THREE.Vector3(0, 0, -0.3);
            const rayDirection = new THREE.Vector3(0, 0, -1);
            
            // Apply the gun model's transformations
            gunModel.updateMatrixWorld(true);
            gunTip.applyMatrix4(gunModel.matrixWorld);
            rayDirection.transformDirection(gunModel.matrixWorld);
            
            // Update the raycaster
            raycasters[i].set(gunTip, rayDirection);
        }
    }
    
    // Make health bars face the camera
    for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        if (target.userData.healthBar) {
            target.userData.healthBar.lookAt(camera.position);
        }
    }
    
    // Animate floating score indicators
    if (window.floatingScores) {
        const now = Date.now();
        for (let i = window.floatingScores.length - 1; i >= 0; i--) {
            const indicator = window.floatingScores[i];
            const age = now - indicator.userData.createdAt;
            
            if (age > indicator.userData.lifespan) {
                // Remove expired indicators
                scene.remove(indicator);
                window.floatingScores.splice(i, 1);
            } else {
                // Animate rising and fading
                const progress = age / indicator.userData.lifespan;
                indicator.position.y += 0.01; // Rise up
                indicator.material.opacity = 1 - progress; // Fade out
                
                // Make it face the camera
                indicator.lookAt(camera.position);
            }
        }
    }
    
    renderer.render(scene, camera);
}

// Initialize the application
init();
