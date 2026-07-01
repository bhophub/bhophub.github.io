/**
 * ==========================================================================
 * OSMOSIS BHOP PLAYER CONTROLLER
 * Quake-style/Source-engine Air-Accelerate Bunny Hopping Physics
 * ==========================================================================
 */

class PlayerController {
    constructor() {
        // Physics constants matching Unity
        this.gravity = 20.0; // slightly reduced gravity for better air-time control
        this.friction = 4.0;
        this.maxGroundSpeed = 8.0;
        this.maxAirSpeed = 10.0;
        this.airSteerSpeed = 8.0;
        this.groundAccelerate = 10.0;
        this.airAccelerate = 150.0;
        this.airStrafingLimit = 30.0; // wishSpeedCap
        this.jumpForce = 7.5; // increased jump force to guarantee block clearances
        this.baseForwardSpeed = 7.5; // increased base forward speed to make all blocks easily jumpable
        this.autoRun = true;

        // Player state
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.yaw = 0.0; // horizontal look angle (radians)
        this.tiltSensitivity = 1.0;
        this.mouseSensitivity = 1.0;
        this.swipeSensitivity = 0.35;
        this.isGrounded = false;
        this.wasGrounded = false;
        
        // Stats
        this.currentSpeed = 0.0;
        this.maxSpeed = 0.0;
        this.perfectHopStreak = 0;
        this.hopTimingFeedback = "";
        
        // Tube and Level tracking
        this.lastClosestIndex = 0;
        
        // Camera references
        this.camera = null;
        this.camPositionSmoothSpeed = 15.0;
        this.camRotationSmoothSpeed = 18.0;
        this.smoothedCamPos = new THREE.Vector3();
        this.smoothedCamRot = new THREE.Quaternion();

        // Input state
        this.mouseDeltaX = 0;
        this.touchActive = false;
        this.touchStartX = 0;
        this.touchCurrentX = 0;
    }

    /**
     * Initializes player position and camera binding
     */
    init(camera) {
        this.camera = camera;
        this.resetToSpawn();
    }

    /**
     * Resets player state to spawn configuration
     */
    resetToSpawn() {
        if (window.GameManager && window.GameManager.spawnPoint) {
            const spawn = window.GameManager.spawnPoint;
            this.position.copy(spawn.position);
            this.yaw = spawn.yaw;
            this.velocity.set(0, 0, 0);
        } else {
            this.position.set(0, 1.5, 0);
            this.yaw = 0.0;
            this.velocity.set(0, 0, 0);
        }
        
        this.currentSpeed = 0.0;
        this.maxSpeed = 0.0;
        this.perfectHopStreak = 0;
        this.isGrounded = false;
        this.wasGrounded = false;
        this.lastClosestIndex = 0;
        
        this.smoothedCamPos.copy(this.position).add(new THREE.Vector3(0, 0.8, 0));
        if (this.camera) {
            this.camera.position.copy(this.smoothedCamPos);
            this.camera.rotation.set(0, this.yaw, 0, 'YXZ');
            this.smoothedCamRot.copy(this.camera.quaternion);
        }
    }

    resetPathTracking() {
        this.lastClosestIndex = 0;
    }

    /**
     * Handles keyboard/mouse/touch input updates
     */
    handleInput(dt) {
        let horizontalSwipeDelta = 0.0;

        // Apply mouse movement if pointer lock is active
        if (document.pointerLockElement) {
            // Standard FPS mouse sensitivity scaling (0.0022 is a comfortable base multiplier)
            // Moving mouse right (positive mouseDeltaX) should rotate camera right (clockwise, which is negative yaw)
            horizontalSwipeDelta = -this.mouseDeltaX * 0.0022 * this.mouseSensitivity;
        } 
        // Apply mobile touch dragging
        else if (this.touchActive) {
            const swipeDistance = this.touchCurrentX - this.touchStartX;
            // Clear delta each frame so it reacts to continuous movement
            horizontalSwipeDelta = -swipeDistance * 0.015 * this.mouseSensitivity;
            // Reset anchor slightly to prevent run-away turning
            this.touchStartX = THREE.MathUtils.lerp(this.touchStartX, this.touchCurrentX, 0.2);
        }

        // Reset input tracking
        this.mouseDeltaX = 0;

        // Apply turning yaw
        if (Math.abs(horizontalSwipeDelta) > 0.0001) {
            this.yaw += horizontalSwipeDelta;
        }

        return horizontalSwipeDelta;
    }

    /**
     * Core physics and movement calculation
     */
    update(dt) {
        if (window.GameManager && window.GameManager.isInMainMenu) {
            this.velocity.set(0, 0, 0);
            if (window.GameManager.spawnPoint) {
                this.position.copy(window.GameManager.spawnPoint.position);
            }
            this.updateCamera(dt);
            return;
        }

        if (window.GameManager && window.GameManager.hasFinished) {
            this.velocity.set(0, 0, 0);
            this.updateCamera(dt);
            return;
        }

        // 1. Process rotation inputs
        const horizontalSwipeDelta = this.handleInput(dt);

        // 2. Proximity/Cylinder checks against blocks for Grounding
        const wasGrounded = this.isGrounded;
        this.isGrounded = false;
        
        // Find closest block along track to optimize collision queries
        const levelPath = window.LevelGenerator.levelPath;
        const blocks = window.LevelGenerator.blocks;
        const playerRadius = 0.5;
        const playerHeight = 1.8;

        const projectionInfo = this.findClosestPathIndex(this.position);
        const closestIdx = projectionInfo.index;

        if (closestIdx !== -1) {
            // Check collision against all blocks in the level (extremely fast and avoids indexing mismatch bugs)
            for (let i = 0; i < blocks.length; i++) {
                const block = blocks[i];
                if (!block) continue;

                const blockTop = block.position.y + block.scale.y / 2.0;
                const collDist = (block.type === 'Start') ? 3.0 + playerRadius : (block.scale.x / 2.0) + playerRadius;
                
                // Track start and end positions of this physics frame
                const pStart = this.position.clone();
                const pEnd = this.position.clone().addScaledVector(this.velocity, dt);

                // Vertical crossing check (downwards direction only)
                const isMovingDown = this.velocity.y <= 0.1;

                if (isMovingDown) {
                    // Check horizontal distance at start and end of frame
                    const dxStart = pStart.x - block.position.x;
                    const dzStart = pStart.z - block.position.z;
                    const distSqStart = dxStart * dxStart + dzStart * dzStart;

                    const dxEnd = pEnd.x - block.position.x;
                    const dzEnd = pEnd.z - block.position.z;
                    const distSqEnd = dxEnd * dxEnd + dzEnd * dzEnd;

                    let shouldLand = false;

                    // Case 1: Player is already horizontally inside the block at start of frame
                    if (distSqStart < collDist * collDist) {
                        // Check if they are vertically in the generous landing zone
                        if (pStart.y <= blockTop + 0.15 && pStart.y >= blockTop - 0.6) {
                            shouldLand = true;
                        }
                    }

                    // Case 2: Player will be horizontally inside the block at end of frame
                    if (!shouldLand && distSqEnd < collDist * collDist) {
                        // Check if they cross the blockTop height during this frame
                        if (pStart.y >= blockTop - 0.6 && pEnd.y <= blockTop + 0.15) {
                            shouldLand = true;
                        }
                    }

                    // Case 3: Sweep trajectory intersection (for fast horizontal movement where they cross the block)
                    if (!shouldLand) {
                        // If they cross the blockTop height vertically
                        if (pStart.y >= blockTop - 0.6 && pEnd.y <= blockTop + 0.15) {
                            let t = 0;
                            const yDiff = pStart.y - pEnd.y;
                            if (yDiff > 0.0001) {
                                t = Math.max(0, Math.min(1, (pStart.y - blockTop) / yDiff));
                            }
                            const xIntersect = pStart.x + t * (pEnd.x - pStart.x);
                            const zIntersect = pStart.z + t * (pEnd.z - pStart.z);

                            const dxIntersect = xIntersect - block.position.x;
                            const dzIntersect = zIntersect - block.position.z;
                            const distSqIntersect = dxIntersect * dxIntersect + dzIntersect * dzIntersect;

                            if (distSqIntersect < collDist * collDist) {
                                shouldLand = true;
                            }
                        }
                    }

                    if (shouldLand) {
                        this.isGrounded = true;
                        // Set position to block top (step 5 will apply jump velocity from here)
                        this.position.y = blockTop;

                            // Start timer on landing if it was 0
                            if (window.GameManager && !window.GameManager.isRunning && window.GameManager.elapsedTime === 0.0) {
                                window.GameManager.startTimer();
                            }

                            // Apply auto-jump vertical impulse
                            this.velocity.y = this.jumpForce;

                            // Apply horizontal speed boost
                            const horizVel = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
                            const horizSpeed = horizVel.length();

                            if (horizSpeed > 0.05) {
                                // Cumulative hop boost
                                horizVel.normalize().multiplyScalar(horizSpeed + 1.2);
                                this.velocity.x = horizVel.x;
                                this.velocity.z = horizVel.z;
                            } else {
                                // Base launch forward speed
                                this.velocity.x = -Math.sin(this.yaw) * this.baseForwardSpeed;
                                this.velocity.z = -Math.cos(this.yaw) * this.baseForwardSpeed;
                            }

                            // Perfect hop visuals & audio feedback
                            if (!wasGrounded) {
                                this.perfectHopStreak++;
                                this.hopTimingFeedback = `PERFECT HOP! x${this.perfectHopStreak}`;
                                
                                if (window.AudioEngine) {
                                    window.AudioEngine.playBlip(0.45, false);
                                }

                                // Trigger block dip animation
                                block.triggerJumpDip();
                            }

                            // Trigger special block events immediately upon landing on the surface!
                            if (block.type !== 'Normal' && block.type !== 'Start') {
                                this.handleBlockTrigger(block.type, block);
                            }
                            
                            break; // Grounded on one block, stop searching
                        }
                    }
                }
            }

        // 3. Apply gravity or glass tube sliding physics
        if (!this.isGrounded) {
            let insideTube = false;
            let P_closest = new THREE.Vector3();
            let segmentDir = new THREE.Vector3(0, 0, 1);

            if (closestIdx !== -1 && closestIdx < levelPath.length - 1) {
                insideTube = window.LevelGenerator.levelPathHasTube[closestIdx];
                const p1 = levelPath[closestIdx];
                const p2 = levelPath[closestIdx + 1];

                segmentDir.copy(p2).sub(p1).normalize();
                
                // Project player onto path segment
                const t = Math.max(0, Math.min(1, projectionInfo.t));
                P_closest.copy(p1).addScaledVector(p2.clone().sub(p1), t);
            }

            const toPlayer = this.position.clone().sub(P_closest);
            const projectionProj = segmentDir.clone().multiplyScalar(toPlayer.dot(segmentDir));
            const radialVector = toPlayer.clone().sub(projectionProj);
            const horizontalDist = radialVector.length();
            const maxRadius = 11.2 - playerRadius; // 10.7m

            if (insideTube && horizontalDist >= 10.3 && horizontalDist < 12.5) {
                this.hopTimingFeedback = "TUBE SLIDE!";
                
                // Reduce gravity to slide smoothly along walls
                this.velocity.y -= this.gravity * 0.25 * dt;

                const radialDir = radialVector.clone().normalize();
                
                // Negate outward radial speed
                const radialSpeed = this.velocity.dot(radialDir);
                if (radialSpeed > 0.0) {
                    this.velocity.addScaledVector(radialDir, -radialSpeed);
                }

                // Clamp position inside tube
                if (horizontalDist > maxRadius) {
                    this.position.copy(P_closest).add(projectionProj).addScaledVector(radialDir, maxRadius);
                }

                // If looking inward (away from wall), push player off the wall
                const lookDir = new THREE.Vector3();
                this.camera.getWorldDirection(lookDir);
                const lookInward = lookDir.dot(radialDir.clone().negate());

                if (lookInward > 0.2) {
                    const pushDir = radialDir.clone().negate().add(new THREE.Vector3(0, 0.15, 0)).normalize();
                    this.velocity.addScaledVector(pushDir, 8.0 * dt);
                    this.hopTimingFeedback = "WALL LAUNCH!";
                }
            } else {
                // Apply normal falling gravity
                this.velocity.y -= this.gravity * dt;
            }

            // Steer velocity vector to follow camera yaw
            const horizVel = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
            const horizSpeed = horizVel.length();
            if (horizSpeed > 0.01) {
                const currentDir = horizVel.clone().normalize();
                const targetDir = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
                const steeredDir = new THREE.Vector3().lerpVectors(currentDir, targetDir, dt * this.airSteerSpeed).normalize();
                
                this.velocity.x = steeredDir.x * horizSpeed;
                this.velocity.z = steeredDir.z * horizSpeed;
            }
        }

        // 4. Calculate Wish Direction & Quake Acceleration
        const wishDir = new THREE.Vector3();
        let moveForward = 0.0;

        // Check manual keyboard inputs
        const keys = window.GameManager && window.GameManager.keys;
        const isLeftPressed = keys ? (keys['KeyA'] || keys['ArrowLeft']) : false;
        const isRightPressed = keys ? (keys['KeyD'] || keys['ArrowRight']) : false;
        const isStrafingManually = isLeftPressed || isRightPressed;
        
        // If in air and turning or strafing manually, set forward movement to zero to allow responsive strafing
        if (this.isGrounded || (!isStrafingManually && Math.abs(horizontalSwipeDelta) <= 0.05)) {
            moveForward = this.autoRun ? this.baseForwardSpeed : 0.0;
        }

        let moveStrafe = 0.0;
        if (isLeftPressed) {
            moveStrafe = -this.maxAirSpeed;
        } else if (isRightPressed) {
            moveStrafe = this.maxAirSpeed;
        } else if (Math.abs(horizontalSwipeDelta) > 0.005) {
            // Fallback to auto-strafing helper
            moveStrafe = Math.sign(horizontalSwipeDelta) * this.maxAirSpeed;
        }

        // Calculate direction relative to yaw angle
        const sinY = Math.sin(this.yaw);
        const cosY = Math.cos(this.yaw);

        // wishDir = transform.forward * moveForward + transform.right * moveStrafe
        // Forward: (-sinY, 0, -cosY), Right: (cosY, 0, -sinY)
        wishDir.x = -sinY * moveForward + cosY * moveStrafe;
        wishDir.z = -cosY * moveForward - sinY * moveStrafe;
        
        const wishSpeed = wishDir.length();
        if (wishSpeed > 0.01) {
            wishDir.normalize();
        }

        // Apply Quake-style speed acceleration
        if (this.isGrounded) {
            this.accelerate(wishDir, wishSpeed, this.groundAccelerate, dt);
        } else {
            this.applyAirAccelerate(wishDir, wishSpeed, this.airAccelerate, dt);
        }

        // 5. Integrate movement translation
        this.position.addScaledVector(this.velocity, dt);

        // 6. Post-move safety clamp inside the tubes
        const postProjection = this.findClosestPathIndex(this.position);
        const postIdx = postProjection.index;
        if (postIdx !== -1) {
            const insideTubePost = window.LevelGenerator.levelPathHasTube[postIdx];
            if (insideTubePost) {
                const p1 = levelPath[postIdx];
                const p2 = levelPath[postIdx + 1];
                const segmentDirPost = p2.clone().sub(p1).normalize();
                
                const t = Math.max(0, Math.min(1, postProjection.t));
                const P_closestPost = p1.clone().addScaledVector(p2.clone().sub(p1), t);

                const toPlayerPost = this.position.clone().sub(P_closestPost);
                const projectionProjPost = segmentDirPost.clone().multiplyScalar(toPlayerPost.dot(segmentDirPost));
                const radialVectorPost = toPlayerPost.clone().sub(projectionProjPost);
                const horizontalDistPost = radialVectorPost.length();
                const maxRadiusPost = 11.2 - playerRadius;

                if (horizontalDistPost > maxRadiusPost && horizontalDistPost < 12.5) {
                    const radialDirPost = radialVectorPost.clone().normalize();
                    this.position.copy(P_closestPost).add(projectionProjPost).addScaledVector(radialDirPost, maxRadiusPost);
                    
                    const radialSpeedPost = this.velocity.dot(radialDirPost);
                    if (radialSpeedPost > 0.0) {
                        this.velocity.addScaledVector(radialDirPost, -radialSpeedPost);
                    }
                }
            }
        }


        // 7. Speed calculation for UI tracking
        const horizVelPost = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
        this.currentSpeed = horizVelPost.length();
        if (this.currentSpeed > this.maxSpeed) {
            this.maxSpeed = this.currentSpeed;
        }

        // 8. Lap completion tracking
        if (closestIdx !== -1) {
            if (this.lastClosestIndex > levelPath.length - 8 && closestIdx < 8) {
                if (window.GameManager && window.GameManager.isRunning) {
                    window.GameManager.completeLap();
                }
            }
            this.lastClosestIndex = closestIdx;
        }

        // 9. Camera late updates
        this.updateCamera(dt);

        // 10. Fall detection check
        if (window.GameManager) {
            window.GameManager.checkFallDetection();
        }

        this.wasGrounded = this.isGrounded;
    }

    /**
     * Standard Quake ground acceleration
     */
    accelerate(wishDir, wishSpeed, accel, dt) {
        const currentSpeed = this.velocity.dot(wishDir);
        const addSpeed = wishSpeed - currentSpeed;
        if (addSpeed <= 0) return;

        let accelSpeed = accel * wishSpeed * dt;
        if (accelSpeed > addSpeed) accelSpeed = addSpeed;

        this.velocity.addScaledVector(wishDir, accelSpeed);
    }

    /**
     * Classic Quake/Source air-strafe acceleration limit
     */
    applyAirAccelerate(wishDir, wishSpeed, accel, dt) {
        const wishSpeedCap = Math.min(wishSpeed, this.airStrafingLimit);
        const currentSpeed = this.velocity.dot(wishDir);
        const addSpeed = wishSpeedCap - currentSpeed;
        if (addSpeed <= 0) return;

        let accelSpeed = accel * wishSpeed * dt;
        if (accelSpeed > addSpeed) accelSpeed = addSpeed;

        this.velocity.addScaledVector(wishDir, accelSpeed);
    }

    /**
     * Handles specific trigger actions when landing on special blocks
     */
    handleBlockTrigger(type, block) {
        switch (type) {
            case 'Checkpoint':
                if (window.GameManager) {
                    window.GameManager.setCheckpoint(block);
                }
                this.hopTimingFeedback = "CHECKPOINT!";
                break;
            case 'Booster':
                // Extra high vertical jump
                this.velocity.y = 15.0; // boosterForce
                this.hopTimingFeedback = "MEGA BOUNCE!";
                break;
            case 'SpeedUp':
                // Launch forward
                const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
                this.velocity.addScaledVector(forward, 15.0);
                this.hopTimingFeedback = "SPEED BOOST!";
                break;
            case 'Finish':
                // In loop mode, the finish portal is passed through, not completing the run immediately
                break;
        }
    }

    /**
     * Smoothly positions and rotates camera around player position
     */
    updateCamera(dt) {
        if (!this.camera) return;

        // Target position at head height (80cm above body center position)
        const targetHeadPos = this.position.clone().add(new THREE.Vector3(0, 0.8, 0));

        // Smoothly interpolate camera position
        this.smoothedCamPos.x = THREE.MathUtils.lerp(this.smoothedCamPos.x, targetHeadPos.x, dt * this.camPositionSmoothSpeed);
        this.smoothedCamPos.z = THREE.MathUtils.lerp(this.smoothedCamPos.z, targetHeadPos.z, dt * this.camPositionSmoothSpeed);
        this.smoothedCamPos.y = THREE.MathUtils.lerp(this.smoothedCamPos.y, targetHeadPos.y, dt * (this.camPositionSmoothSpeed * 0.5));

        // Smoothly rotate camera orientation
        const targetRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));
        this.smoothedCamRot.slerp(targetRotation, dt * this.camRotationSmoothSpeed);

        this.camera.position.copy(this.smoothedCamPos);
        this.camera.quaternion.copy(this.smoothedCamRot);
    }

    /**
     * Projects player position onto nearest segment of the circular path
     */
    findClosestPathIndex(playerPos) {
        const levelPath = window.LevelGenerator.levelPath;
        if (!levelPath || levelPath.length < 2) {
            return { index: -1, t: 0 };
        }

        let closestIndex = 0;
        let minSqDist = Infinity;
        let bestT = 0;

        for (let i = 0; i < levelPath.length - 1; i++) {
            const p1 = levelPath[i];
            const p2 = levelPath[i + 1];

            const segment = p2.clone().sub(p1);
            const segLenSq = segment.lengthSq();
            if (segLenSq < 0.001) continue;

            const playerToP1 = playerPos.clone().sub(p1);
            let t = playerToP1.dot(segment) / segLenSq;
            t = Math.max(0, Math.min(1, t)); // clamp to segment

            const projection = p1.clone().addScaledVector(segment, t);
            const sqDist = playerPos.distanceToSquared(projection);

            if (sqDist < minSqDist) {
                minSqDist = sqDist;
                closestIndex = i;
                bestT = t;
            }
        }

        return { index: closestIndex, t: bestT };
    }
}

window.PlayerController = PlayerController;
