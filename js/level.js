/**
 * ==========================================================================
 * OSMOSIS PROCEDURAL LEVEL GENERATOR
 * Procedural Circular Track Generation with Wiggle/Curve Sections and Tubes
 * ==========================================================================
 */

class Block {
    constructor(position, scale, type) {
        this.position = position.clone();
        this.scale = scale.clone();
        this.type = type; // 'Start', 'Normal', 'Booster', 'SpeedUp', 'Checkpoint', 'Finish'
        this.mesh = null;
        
        // Animation variables matching Unity BhopBlock
        this.originalY = position.y;
        this.isAnimating = false;
        this.animTimer = 0.0;
        this.animDuration = 0.4;
    }

    triggerJumpDip() {
        // Animation disabled for completely static blocks
    }

    update(dt) {
        // Blocks are completely static
    }
}

const LevelGenerator = {
    baseBlockCount: 100,
    blocks: [],
    tubes: [],
    levelPath: [],
    levelPathHasTube: [],
    waterPlane: null,

    /**
     * Clears previous track meshes and generates a new procedural circle track
     */
    generateLevel(scene) {
        // 1. Clean up old elements
        this.blocks = [];
        this.tubes = [];
        this.levelPath = [];
        this.levelPathHasTube = [];

        if (this.waterPlane) {
            scene.remove(this.waterPlane);
            if (this.waterPlane.geometry) this.waterPlane.geometry.dispose();
            this.waterPlane = null;
        }

        const currentLevel = window.GameManager ? window.GameManager.currentLevel || 1 : 1;
        let blockCount = this.baseBlockCount + (currentLevel - 1) * 30;
        blockCount = Math.min(blockCount, 300); // cap for performance

        // 2. Generate smooth circular path waypoints
        const trackSpacing = 4.2;
        const circumference = blockCount * trackSpacing;
        const radius = circumference / (2.0 * Math.PI);
        const center = new THREE.Vector3(0, 0, radius);

        const waypointSpacing = 2.5;
        const numPoints = Math.ceil(circumference / waypointSpacing);

        for (let i = 0; i < numPoints; i++) {
            const angle = (i / numPoints) * 2.0 * Math.PI;
            // Circular path in XZ plane
            const x = center.x + radius * Math.sin(angle);
            const z = center.z - radius * Math.cos(angle);
            const y = 0.0;

            this.levelPath.push(new THREE.Vector3(x, y, z));
            this.levelPathHasTube.push(false);
        }

        // Close the loop
        this.levelPath.push(this.levelPath[0].clone());
        this.levelPathHasTube.push(false);

        // 3. Create start block
        const startPos = this.levelPath[0].clone();
        const startBlock = new Block(startPos, new THREE.Vector3(6, 1, 6), 'Start');
        this.blocks.push(startBlock);

        // Configure GameManager spawnPoint references
        if (window.GameManager) {
            const nextDir = this.levelPath[1].clone().sub(startPos).normalize();
            const yaw = Math.atan2(-nextDir.x, -nextDir.z);
            window.GameManager.spawnPoint = {
                position: startPos.clone().add(new THREE.Vector3(0, 1.5, 0)),
                yaw: yaw
            };
        }

        // 4. Distribute curved segments (Straight, Left curve, Right curve, ZigZag)
        const sectionTypes = [0]; // Start with safe Straight section
        const sectionLengths = [6];
        let remainingBlocks = blockCount - 6;

        while (remainingBlocks > 0) {
            let len = Math.floor(Math.random() * 7) + 6; // 6 to 12
            if (len > remainingBlocks) len = remainingBlocks;

            const sType = Math.floor(Math.random() * 4); // 0 = Straight, 1 = Left, 2 = Right, 3 = ZigZag
            sectionTypes.push(sType);
            sectionLengths.push(len);
            remainingBlocks -= len;
        }

        // 5. Generate blocks along the path points
        let currentSection = 0;
        let sectionStartIdx = 0;

        for (let i = 0; i < blockCount; i++) {
            const t = (i + 1) / (blockCount + 1);
            // Clamp path indexing inside loop limits to ensure clean, jumpable spacing wrap-around
            const pathIndex = Math.max(3, Math.min(numPoints - 3, Math.floor(t * numPoints)));
            
            const blockPos = this.levelPath[pathIndex].clone();
            const forward = this.levelPath[pathIndex + 1].clone().sub(this.levelPath[pathIndex]).normalize();

            // Rotate segment headers
            while (currentSection < sectionLengths.length && i >= sectionStartIdx + sectionLengths[currentSection]) {
                sectionStartIdx += sectionLengths[currentSection];
                currentSection++;
            }

            let sType = 0;
            let blockIndexInSection = i - sectionStartIdx;
            let sectionLen = 1;

            if (currentSection < sectionTypes.length) {
                sType = sectionTypes[currentSection];
                sectionLen = sectionLengths[currentSection];
            }

            // Lateral offset logic
            let lateralOffset = 0.0;
            const rightDir = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize();
            const progress = sectionLen > 1 ? blockIndexInSection / (sectionLen - 1) : 0.5;
            const envelope = Math.sin(progress * Math.PI);
            const direction = (blockIndexInSection % 2 === 0) ? -1.0 : 1.0;

            if (sType === 0) {
                // Straight wiggle
                lateralOffset = direction * 0.35 * envelope;
            } else if (sType === 1) {
                // Left curve - slightly gentler for jumpability
                lateralOffset = -1.8 * envelope;
            } else if (sType === 2) {
                // Right curve - slightly gentler for jumpability
                lateralOffset = 1.8 * envelope;
            } else if (sType === 3) {
                // Zigzag - reduced amplitude to guarantee jumpability at base speed
                lateralOffset = direction * 1.2 * envelope;
            }

            blockPos.addScaledVector(rightDir, lateralOffset);

            // Block type allocation
            let type = 'Normal';
            if (i > 0 && i % 5 === 0) {
                type = 'Booster';
            } else if (i > 0 && i % 8 === 0) {
                type = 'SpeedUp';
            }

            // Apply slight random height variance to make jumping more organic (matches Unity C# blockHeightVariance = 0.2f)
            const heightVariance = (Math.random() * 2.0 - 1.0) * 0.2;
            blockPos.y += heightVariance;

            const scale = type === 'Normal' ? new THREE.Vector3(2.0, 0.4, 2.0) : new THREE.Vector3(1.6, 0.4, 1.6);
            const block = new Block(blockPos, scale, type);
            this.blocks.push(block);
        }

        // 6. Build segmented 3D tubes covering specific sectors (40-52% and 75-83%)
        const tubeStart1 = Math.floor(numPoints * 0.40);
        const tubeEnd1 = Math.floor(numPoints * 0.52);
        const tubeStart2 = Math.floor(numPoints * 0.75);
        const tubeEnd2 = Math.floor(numPoints * 0.83);

        this.createCurvedTube(scene, tubeStart1, tubeEnd1);
        this.createCurvedTube(scene, tubeStart2, tubeEnd2);

        // 7. Spawn 3D meshes inside Three.js
        this.spawnThreeMeshes(scene, radius);
    },

    /**
     * Creates hollow glass tube segment meshes
     */
    createCurvedTube(scene, startIndex, endIndex) {
        for (let i = startIndex; i < endIndex; i++) {
            const p1 = this.levelPath[i];
            const p2 = this.levelPath[i + 1];

            const length = p1.distanceTo(p2);
            const midPoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
            const dir = p2.clone().sub(p1).normalize();

            // Represent tube segment as hollow open-ended cylinder
            const geom = new THREE.CylinderGeometry(11.2, 11.2, length, 16, 1, true);
            const mat = window.Renderer.materials.tube;
            const mesh = new THREE.Mesh(geom, mat);

            // Position and orient segment
            mesh.position.copy(midPoint);
            mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

            scene.add(mesh);
            this.tubes.push(mesh);
            this.levelPathHasTube[i] = true;
        }
        this.levelPathHasTube[endIndex] = true;
    },

    /**
     * Builds and attaches Three.js mesh instances to Block models
     */
    spawnThreeMeshes(scene, radius) {
        this.blocks.forEach((block) => {
            let geom;
            let mat;
            
            if (block.type === 'Start') {
                geom = new THREE.BoxGeometry(block.scale.x, block.scale.y, block.scale.z);
                mat = window.Renderer.materials.start;
            } else if (block.type === 'Booster') {
                geom = new THREE.CylinderGeometry(block.scale.x / 2, block.scale.x / 2, block.scale.y, 24);
                mat = window.Renderer.materials.booster;
            } else if (block.type === 'SpeedUp') {
                geom = new THREE.CylinderGeometry(block.scale.x / 2, block.scale.x / 2, block.scale.y, 24);
                mat = window.Renderer.materials.speedUp;
            } else {
                geom = new THREE.CylinderGeometry(block.scale.x / 2, block.scale.x / 2, block.scale.y, 24);
                mat = window.Renderer.materials.normal;
            }

            const mesh = new THREE.Mesh(geom, mat);
            mesh.position.copy(block.position);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            
            scene.add(mesh);
            block.mesh = mesh;
        });

        // 8. Create Realistic Water plane floor (aligned with grid spacing)
        const gridSize = Math.max(500, radius * 3.5);
        const waterGeom = new THREE.PlaneGeometry(gridSize, gridSize, 64, 64);
        this.waterPlane = new THREE.Mesh(waterGeom, window.Renderer.materials.water);
        
        // Orient flat XZ floor
        this.waterPlane.rotation.x = -Math.PI / 2;
        this.waterPlane.position.set(0, -3.8, radius); // y = -3.8m matching C# deadzone offsets
        this.waterPlane.receiveShadow = true;
        scene.add(this.waterPlane);
    }
};

window.LevelGenerator = LevelGenerator;
