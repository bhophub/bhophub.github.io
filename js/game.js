/**
 * ==========================================================================
 * OSMOSIS BHOP GAME COORDINATOR
 * Game State Management, UI Overlays, Controls Hooking, and Score Persistence
 * ==========================================================================
 */

const GameManager = {
    // Game state variables
    isRunning: false,
    isInMainMenu: true,
    hasFinished: false,
    elapsedTime: 0.0,
    lapsCompleted: 0,
    bestLaps: 0,
    currentLevel: 1,
    
    spawnPoint: null,
    currentCheckpointBlock: null,
    timerInterval: null,

    // UI elements references
    ui: {
        hudPanel: null,
        speedVal: null,
        maxSpeedVal: null,
        timerVal: null,
        lapVal: null,
        bestLapVal: null,
        feedbackText: null,
        streakBadge: null,
        streakVal: null,
        mainMenu: null,
        settingsMenu: null,
        pauseMenu: null,
        statsMenu: null,
        sensitivitySlider: null,
        sensitivityVal: null,
        pauseSensSlider: null,
        pauseSensVal: null,
        statsTitle: null,
        statsTime: null,
        statsLaps: null,
        statsBest: null,
        statsStreak: null
    },

    /**
     * Initializes all UI button listeners, mouse events, and setups the renderer
     */
    init() {
        // 1. Gather DOM Elements
        this.cacheDomElements();

        // 2. Load settings from localStorage
        this.bestLaps = parseInt(localStorage.getItem("BhopBestLaps") || "0");
        const savedSens = parseFloat(localStorage.getItem("BhopMouseSensitivity") || "1.0");

        // 3. Configure player controller & renderer
        window.Player = new PlayerController();
        window.Player.mouseSensitivity = savedSens;

        window.Renderer.init();
        window.Player.init(window.Renderer.camera);

        // 4. Generate first level procedural track
        window.LevelGenerator.generateLevel(window.Renderer.scene);

        // 5. Update initial UI states
        this.ui.bestLapVal.textContent = `Best: ${this.bestLaps}`;
        this.ui.sensitivitySlider.value = savedSens;
        this.ui.sensitivityVal.textContent = savedSens.toFixed(2);
        this.ui.pauseSensSlider.value = savedSens;
        this.ui.pauseSensVal.textContent = savedSens.toFixed(2);

        // 6. Bind Event Listeners
        this.bindEvents();

        // 7. Start WebGL loop
        window.Renderer.startRenderLoop();
    },

    /**
     * Cache the references of UI nodes from DOM
     */
    cacheDomElements() {
        this.ui.hudPanel = document.getElementById("hud-panel");
        this.ui.speedVal = document.getElementById("speed-val");
        this.ui.maxSpeedVal = document.getElementById("max-speed-val");
        this.ui.timerVal = document.getElementById("timer-val");
        this.ui.lapVal = document.getElementById("lap-val");
        this.ui.bestLapVal = document.getElementById("best-lap-val");
        this.ui.feedbackText = document.getElementById("feedback-text");
        this.ui.streakBadge = document.getElementById("streak-badge");
        this.ui.streakVal = document.getElementById("streak-val");
        
        this.ui.mainMenu = document.getElementById("main-menu-panel");
        this.ui.settingsMenu = document.getElementById("settings-panel");
        this.ui.pauseMenu = document.getElementById("pause-panel");
        this.ui.statsMenu = document.getElementById("stats-screen-panel");
        
        this.ui.sensitivitySlider = document.getElementById("sensitivity-slider");
        this.ui.sensitivityVal = document.getElementById("sensitivity-val");
        this.ui.pauseSensSlider = document.getElementById("pause-sensitivity-slider");
        this.ui.pauseSensVal = document.getElementById("pause-sensitivity-val");
        
        this.ui.statsTitle = document.getElementById("stats-title");
        this.ui.statsTime = document.getElementById("stats-time");
        this.ui.statsLaps = document.getElementById("stats-laps");
        this.ui.statsBest = document.getElementById("stats-best");
        this.ui.statsStreak = document.getElementById("stats-streak");
    },

    /**
     * Setups up listeners for clicks, inputs, pointers, and keyboards
     */
    bindEvents() {
        // Track key states for active inputs
        this.keys = {};
        window.addEventListener("keydown", (e) => {
            this.keys[e.code] = true;
        });
        window.addEventListener("keyup", (e) => {
            this.keys[e.code] = false;
        });
        window.addEventListener("blur", () => {
            this.keys = {};
        });

        // --- 1. Menu Controls ---
        document.getElementById("play-btn").addEventListener("click", () => {
            window.AudioEngine.playBlip(0.65, true);
            this.requestPointerLock();
            this.startGameplay();
        });

        document.getElementById("settings-btn").addEventListener("click", () => {
            window.AudioEngine.playHover(0.2);
            this.ui.mainMenu.classList.add("hidden");
            this.ui.settingsMenu.classList.remove("hidden");
        });

        document.getElementById("settings-back-btn").addEventListener("click", () => {
            window.AudioEngine.playBlip(0.5, true);
            this.ui.settingsMenu.classList.add("hidden");
            this.ui.mainMenu.classList.remove("hidden");
        });

        document.getElementById("reset-records-btn").addEventListener("click", () => {
            window.AudioEngine.playBlip(0.4, true);
            localStorage.setItem("BhopBestLaps", "0");
            this.bestLaps = 0;
            this.ui.bestLapVal.textContent = "Best: 0";
            alert("Best Laps Record reset to 0.");
        });

        // --- 2. Pause Controls ---
        document.getElementById("resume-btn").addEventListener("click", () => {
            window.AudioEngine.playBlip(0.5, true);
            this.requestPointerLock();
            this.resumeGameplay();
        });

        document.getElementById("pause-menu-btn").addEventListener("click", () => {
            window.AudioEngine.playBlip(0.5, true);
            this.returnToMainMenu();
        });

        // --- 3. Game Over Controls ---
        document.getElementById("retry-btn").addEventListener("click", () => {
            window.AudioEngine.playBlip(0.65, true);
            this.requestPointerLock();
            this.retryLevel();
        });

        document.getElementById("stats-menu-btn").addEventListener("click", () => {
            window.AudioEngine.playBlip(0.5, true);
            this.returnToMainMenu();
        });

        // --- 4. Sensitivity Sliders ---
        const onSensChange = (e) => {
            const val = parseFloat(e.target.value);
            window.Player.mouseSensitivity = val;
            localStorage.setItem("BhopMouseSensitivity", val.toString());
            this.ui.sensitivitySlider.value = val;
            this.ui.sensitivityVal.textContent = val.toFixed(2);
            this.ui.pauseSensSlider.value = val;
            this.ui.pauseSensVal.textContent = val.toFixed(2);
        };
        this.ui.sensitivitySlider.addEventListener("input", onSensChange);
        this.ui.pauseSensSlider.addEventListener("input", onSensChange);

        const domCanvas = window.Renderer.webglRenderer.domElement;

        // --- 5. Mouse Look Controls & Pointer Lock request on Canvas Click ---
        domCanvas.addEventListener("click", () => {
            // Only process click pointer lock request if in-game
            if (!this.isInMainMenu && !this.hasFinished) {
                this.requestPointerLock();
            }
        });

        document.addEventListener("mousemove", (e) => {
            // Only process movement if the pointer is locked to our canvas
            if (document.pointerLockElement === domCanvas && window.Player) {
                window.Player.mouseDeltaX = e.movementX;
            }
        });

        // --- 6. Mobile Swiping Controls ---
        
        domCanvas.addEventListener("touchstart", (e) => {
            if (this.isInMainMenu || this.hasFinished) return;
            document.body.classList.add("touch-device");
            window.Player.touchActive = true;
            window.Player.touchStartX = e.touches[0].clientX;
            window.Player.touchCurrentX = e.touches[0].clientX;
            window.AudioEngine.init(); // enable web audio
        }, { passive: true });

        domCanvas.addEventListener("touchmove", (e) => {
            if (window.Player.touchActive) {
                window.Player.touchCurrentX = e.touches[0].clientX;
            }
        }, { passive: true });

        domCanvas.addEventListener("touchend", () => {
            window.Player.touchActive = false;
        }, { passive: true });

        // --- 7. Keyboard ESC toggle handler ---
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" || e.keyCode === 27) {
                if (this.hasFinished) {
                    this.returnToMainMenu();
                } else if (!this.isInMainMenu) {
                    if (this.ui.pauseMenu.classList.contains("hidden")) {
                        this.pauseGameplay();
                    } else {
                        this.requestPointerLock();
                        this.resumeGameplay();
                    }
                }
            }
        });

        // Add soft hovers to buttons
        document.querySelectorAll(".btn").forEach(btn => {
            btn.addEventListener("mouseenter", () => {
                window.AudioEngine.playHover(0.08);
            });
        });

        // --- 8. Lock state change listener ---
        document.addEventListener("pointerlockchange", () => {
            // If pointer lock is released by user, show Pause screen (unless menu or game over is active)
            if (!document.pointerLockElement) {
                if (!this.isInMainMenu && !this.hasFinished && this.ui.pauseMenu.classList.contains("hidden")) {
                    this.pauseGameplay();
                }
            }
        });
    },

    /**
     * Request mouse locking
     */
    requestPointerLock() {
        const domCanvas = window.Renderer.webglRenderer.domElement;
        if (domCanvas.requestPointerLock) {
            try {
                const promise = domCanvas.requestPointerLock();
                if (promise && typeof promise.catch === "function") {
                    promise.catch((err) => {
                        // Silence security errors from immediate re-request
                        if (err.name !== "SecurityError" && err.message?.indexOf("exited") === -1) {
                            console.warn("Pointer lock request rejected:", err);
                        }
                    });
                }
            } catch (err) {
                console.warn("Pointer lock request exception:", err);
            }
        }
    },

    /**
     * Starts gameplay
     */
    startGameplay() {
        this.isInMainMenu = false;
        this.hasFinished = false;
        this.ui.mainMenu.classList.add("hidden");
        this.ui.hudPanel.classList.remove("hidden");
        this.resetToSpawn();
    },

    /**
     * Starts game elapsed timer on first block hop
     */
    startTimer() {
        if (this.isInMainMenu) return;
        this.isRunning = true;
        this.elapsedTime = 0.0;
        this.lapsCompleted = 0;
        window.Player.perfectHopStreak = 0;
        window.Player.maxSpeed = 0.0;
        this.ui.feedbackText.textContent = "GO!";
        this.ui.streakBadge.classList.add("hidden");
        
        // Timer ticking loop (every 16ms for precise frame HUD updates)
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => this.tickTimer(), 16);
    },

    /**
     * Increments lap completion records
     */
    completeLap() {
        this.lapsCompleted++;
        if (this.lapsCompleted > this.bestLaps) {
            this.bestLaps = this.lapsCompleted;
            localStorage.setItem("BhopBestLaps", this.bestLaps.toString());
            this.ui.bestLapVal.textContent = `Best: ${this.bestLaps}`;
        }

        const formatted = this.formatTime(this.elapsedTime);
        this.ui.feedbackText.textContent = `LAP ${this.lapsCompleted} COMPLETED! (${formatted})`;
        
        // Play success synthesis
        window.AudioEngine.playBlip(0.6, false);
    },

    /**
     * Ticks high precision timer
     */
    tickTimer() {
        if (this.isRunning) {
            this.elapsedTime += 0.016;
            this.ui.timerVal.textContent = this.formatTime(this.elapsedTime);
        }

        if (window.Player) {
            this.ui.speedVal.textContent = `${window.Player.currentSpeed.toFixed(1)} u/s`;
            this.ui.maxSpeedVal.textContent = `Max: ${window.Player.maxSpeed.toFixed(1)}`;
            this.ui.lapVal.textContent = this.lapsCompleted;

            // Show feedback
            this.ui.feedbackText.textContent = window.Player.hopTimingFeedback;
            
            // Streak badge
            const streak = window.Player.perfectHopStreak;
            if (streak > 0) {
                this.ui.streakBadge.classList.remove("hidden");
                this.ui.streakVal.textContent = streak;
            } else {
                this.ui.streakBadge.classList.add("hidden");
            }
        }
    },

    /**
     * Checks if player has fallen off the track. Called every frame from player update to be bulletproof.
     */
    checkFallDetection() {
        if (window.Player && window.Player.position.y < -4.0) {
            if (this.isRunning) {
                this.endRunOnFall();
            } else {
                this.resetToSpawn();
            }
        }
    },

    /**
     * Pauses the game loop and displays pause UI overlay card
     */
    pauseGameplay() {
        this.ui.pauseMenu.classList.remove("hidden");
    },

    /**
     * Resumes game loop and closes pause overlay
     */
    resumeGameplay() {
        this.ui.pauseMenu.classList.add("hidden");
    },

    /**
     * Triggers run failure and opens stats panel
     */
    endRunOnFall() {
        this.isRunning = false;
        this.hasFinished = true;
        if (this.timerInterval) clearInterval(this.timerInterval);

        if (this.lapsCompleted > this.bestLaps) {
            this.bestLaps = this.lapsCompleted;
            localStorage.setItem("BhopBestLaps", this.bestLaps.toString());
            this.ui.bestLapVal.textContent = `Best: ${this.bestLaps}`;
        }

        document.exitPointerLock();

        // Populate stats screen values
        this.ui.statsTitle.textContent = "RUN OVER!";
        this.ui.statsTime.textContent = this.formatTime(this.elapsedTime);
        this.ui.statsLaps.textContent = this.lapsCompleted;
        this.ui.statsBest.textContent = this.bestLaps;
        this.ui.statsStreak.textContent = window.Player.perfectHopStreak;

        this.ui.hudPanel.classList.add("hidden");
        this.ui.statsMenu.classList.remove("hidden");
    },

    setCheckpoint(block) {
        this.currentCheckpointBlock = block;
    },

    /**
     * Resets the level completely to spawn coordinates
     */
    resetToSpawn() {
        if (window.Player) {
            window.Player.resetToSpawn();
        }
        this.elapsedTime = 0.0;
        this.lapsCompleted = 0;
        this.isRunning = false;
        this.ui.timerVal.textContent = "00:00.00";
        this.ui.lapVal.textContent = "0";
        this.ui.speedVal.textContent = "0.0 u/s";
        this.ui.maxSpeedVal.textContent = "Max: 0.0";
        this.ui.streakBadge.classList.add("hidden");
        this.ui.feedbackText.textContent = "JUMP ON MEMBRANES TO BEGIN";
    },

    /**
     * Trigger retry sequence
     */
    retryLevel() {
        this.ui.statsMenu.classList.add("hidden");
        this.ui.hudPanel.classList.remove("hidden");
        this.startGameplay();
    },

    /**
     * Returns the game layout cleanly to the Main Screen
     */
    returnToMainMenu() {
        this.isInMainMenu = true;
        this.isRunning = false;
        this.hasFinished = false;
        if (this.timerInterval) clearInterval(this.timerInterval);

        document.exitPointerLock();

        this.ui.statsMenu.classList.add("hidden");
        this.ui.pauseMenu.classList.add("hidden");
        this.ui.settingsMenu.classList.add("hidden");
        this.ui.hudPanel.classList.add("hidden");
        
        this.ui.mainMenu.classList.remove("hidden");
        
        this.resetToSpawn();
    },

    /**
     * Converts float seconds into MM:SS.HH string
     */
    formatTime(time) {
        const minutes = Math.floor(time / 60.0);
        const seconds = Math.floor(time % 60.0);
        const hundredths = Math.floor((time * 100.0) % 100.0);

        const padM = minutes.toString().padStart(2, '0');
        const padS = seconds.toString().padStart(2, '0');
        const padH = hundredths.toString().padStart(2, '0');

        return `${padM}:${padS}.${padH}`;
    }
};

window.GameManager = GameManager;

// Bulletproof initialization on page load
if (document.readyState === "complete" || document.readyState === "interactive") {
    window.GameManager.init();
} else {
    window.addEventListener("DOMContentLoaded", () => {
        window.GameManager.init();
    });
}
