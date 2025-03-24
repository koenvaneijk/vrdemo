// Import Three.js modules from npm
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as Tone from 'tone';

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

// Initialize Tone.js sound effects
function initSounds() {
    // Start Tone.js audio context (needs to be triggered by user interaction)
    const startAudio = async () => {
        await Tone.start();
        console.log('Tone.js audio context started');
        // Remove the event listeners once audio is started
        document.removeEventListener('click', startAudio);
        document.removeEventListener('touchstart', startAudio);
        document.getElementById('enter-vr-button').removeEventListener('click', startAudio);
    };
    
    // Add multiple event listeners to ensure audio starts
    document.addEventListener('click', startAudio);
    document.addEventListener('touchstart', startAudio);
    document.getElementById('enter-vr-button').addEventListener('click', startAudio);
    
    // Create shooting sound for each gun
    for (let i = 0; i < 2; i++) {
        // Create a synth for the shooting sound
        const synth = new Tone.MembraneSynth({
            pitchDecay: 0.05,
            octaves: 4,
            oscillator: {
                type: "sine"
            },
            envelope: {
                attack: 0.001,
                decay: 0.2,
                sustain: 0.01,
                release: 0.2,
                attackCurve: "exponential"
            }
        }).toDestination();
        
        // Add some distortion for a more "gunshot" like sound
        const distortion = new Tone.Distortion(0.8).toDestination();
        synth.connect(distortion);
        
        shootingSounds.push(synth);
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
    if (isShooting[index]) return; // Already shooting
    
    isShooting[index] = true;
    
    // Play sound
    shootingSounds[index].triggerAttackRelease("C1", "16n");
    
    // Show muzzle flash
    const flash = muzzleFlashes[index];
    flash.material.opacity = 1.0;
    
    // Check for target hits
    checkTargetHits(index);
    
    // Hide muzzle flash after a short delay
    setTimeout(() => {
        flash.material.opacity = 0.0;
        isShooting[index] = false;
    }, 100);
}

// Initialize the scene, camera, and renderer
function init() {
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x505050);

    // Create camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 3);

    // Create renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    // Add VR button
    document.body.appendChild(VRButton.createButton(renderer));
    
    // Hide custom button as we're using the standard VRButton
    document.getElementById('enter-vr-button').style.display = 'none';

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0x404040);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1).normalize();
    scene.add(directionalLight);

    // Add a floor
    const floorGeometry = new THREE.PlaneGeometry(10, 10);
    const floorMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x808080,
        roughness: 0.8,
        metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    scene.add(floor);

    // Add a grid helper
    const gridHelper = new THREE.GridHelper(10, 10);
    scene.add(gridHelper);

    // Initialize sound effects
    initSounds();
    
    // Setup VR controllers
    setupVRControllers();
    
    // Start spawning targets when entering VR
    renderer.xr.addEventListener('sessionstart', () => {
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
    });
    
    // Clean up when exiting VR
    renderer.xr.addEventListener('sessionend', () => {
        clearInterval(spawnTargetsInterval);
        // Remove all targets
        for (let i = targets.length - 1; i >= 0; i--) {
            removeTarget(i);
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

// Create a target at a random position around the player
function spawnTarget() {
    // Random position in a sphere around the player
    const radius = 2 + Math.random() * 3; // Between 2 and 5 meters
    const theta = Math.random() * Math.PI * 2; // Random angle around y-axis
    const phi = Math.random() * Math.PI; // Random angle from top to bottom
    
    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = 1 + radius * Math.cos(phi); // Keep targets above ground level
    const z = radius * Math.sin(phi) * Math.sin(theta);
    
    // Create target geometry
    const targetGeometry = new THREE.RingGeometry(0.1, 0.2, 32);
    const targetMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xffff00,
        side: THREE.DoubleSide,
        emissive: 0xffff00,
        emissiveIntensity: 0.5
    });
    const target = new THREE.Mesh(targetGeometry, targetMaterial);
    
    // Position the target
    target.position.set(x, y, z);
    
    // Make the target face the player
    target.lookAt(0, 1.6, 0);
    
    // Add to scene and targets array
    scene.add(target);
    targets.push(target);
    
    return target;
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
    const controller = controllers[controllerIndex];
    
    // Update raycaster from the gun's position and direction
    const raycaster = raycasters[controllerIndex];
    const gunTip = new THREE.Vector3(0, 0, -0.3); // Position at the end of the gun barrel
    const rayDirection = new THREE.Vector3(0, 0, -1); // Direction the gun is pointing
    
    // Transform the position and direction to world space
    controller.updateMatrixWorld(true);
    gunTip.applyMatrix4(controller.matrixWorld);
    rayDirection.transformDirection(controller.matrixWorld);
    
    raycaster.set(gunTip, rayDirection);
    
    // Check for intersections with targets
    const intersects = raycaster.intersectObjects(targets);
    
    if (intersects.length > 0) {
        // Find the target in our array
        const hitTarget = intersects[0].object;
        const targetIndex = targets.indexOf(hitTarget);
        
        if (targetIndex !== -1) {
            // Play hit sound
            targetHitSound.triggerAttackRelease("C5", "16n");
            
            // Remove the hit target
            removeTarget(targetIndex);
            
            // Spawn a new target after a delay
            setTimeout(() => {
                if (targets.length < 10) {
                    spawnTarget();
                }
            }, 1000);
        }
    }
}

// Animation loop
function animate() {
    // Update pointer lines if needed
    for (let i = 0; i < controllers.length; i++) {
        // The pointer line is already attached to the controller, which has the gun model
        // So it will automatically follow the gun's position and orientation
    }
    
    // Rotate targets slightly to make them more visible
    targets.forEach(target => {
        target.rotation.z += 0.01;
    });
    
    renderer.render(scene, camera);
}

// Initialize the application
init();
