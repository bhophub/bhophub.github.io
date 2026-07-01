/**
 * ==========================================================================
 * OSMOSIS AUDIO SYNTHESIS ENGINE
 * Dynamic sound effect generation using HTML5 Web Audio API
 * ==========================================================================
 */

const AudioEngine = {
    ctx: null,

    /**
     * Initializes the Web Audio context safely
     */
    init() {
        try {
            if (!this.ctx) {
                this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume().catch((err) => {
                    console.debug("AudioContext resume deferred until user gesture:", err);
                });
            }
        } catch (err) {
            console.debug("AudioContext initialization deferred:", err);
        }
    },

    /**
     * Synthesizes a sci-fi blip / confirmation ping
     */
    playBlip(volume = 0.5, isConfirm = false) {
        this.init();
        if (!this.ctx || this.ctx.state !== 'running') return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        if (isConfirm) {
            // High double beep for confirmations
            osc.type = "sine";
            osc.frequency.setValueAtTime(660, now);
            osc.frequency.exponentialRampToValueAtTime(1320, now + 0.15);
            
            gain.gain.setValueAtTime(volume, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
            
            osc.start(now);
            osc.stop(now + 0.16);
        } else {
            // Plucky low-pass blip for block landing / bouncing
            osc.type = "triangle";
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
            osc.frequency.exponentialRampToValueAtTime(440, now + 0.25);

            gain.gain.setValueAtTime(volume, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

            osc.start(now);
            osc.stop(now + 0.3);
        }
    },

    /**
     * Synthesizes a quiet click for button hovering
     */
    playHover(volume = 0.08) {
        // Prevent hover sounds from triggering autoplay warnings before interaction
        if (!this.ctx || this.ctx.state !== 'running') return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.type = "sine";
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.setValueAtTime(600, now + 0.02);

        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

        osc.start(now);
        osc.stop(now + 0.05);
    }
};

window.AudioEngine = AudioEngine;

// Automatically unlock AudioContext on first user interaction
const unlockAudio = () => {
    AudioEngine.init();
    if (AudioEngine.ctx && AudioEngine.ctx.state === 'running') {
        window.removeEventListener('click', unlockAudio);
        window.removeEventListener('touchstart', unlockAudio);
        window.removeEventListener('keydown', unlockAudio);
    }
};
window.addEventListener('click', unlockAudio);
window.addEventListener('touchstart', unlockAudio);
window.addEventListener('keydown', unlockAudio);
