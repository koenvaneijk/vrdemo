// Import Three.js modules from npm
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Main Three.js VR application
let scene, camera, renderer;
let controllers = [];
let gunModels = [];
let pointerLines = [];
let gunModelLeft, gunModelRight;

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
    
    // Position the gun to align better with the arm direction
    // Move it back along the arm axis so it appears to extend from the arm
    gunGroup.position.z = 0.1;  // Move slightly toward the user's arm
    
    return gunGroup;
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

    // Setup VR controllers
    setupVRControllers();

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
        controller.add(pointerLine);
        
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

// Animation loop
function animate() {
    // Update pointer lines if needed
    for (let i = 0; i < controllers.length; i++) {
        // You can add more complex logic here if needed
        // For example, casting rays to detect intersections with targets
        
        // The pointer line is already attached to the controller, which has the gun model
        // So it will automatically follow the gun's position and orientation
    }
    
    renderer.render(scene, camera);
}

// Initialize the application
init();
