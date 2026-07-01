/**
 * ==========================================================================
 * OSMOSIS RENDER ENGINE
 * Three.js WebGL Graphics, Dynamic Color Themes, and Custom GLSL Shaders
 * ==========================================================================
 */

const Renderer = {
    scene: null,
    camera: null,
    webglRenderer: null,
    clock: null,
    materials: {},

    /**
     * Initializes Three.js WebGL structures, lighting, materials, and listeners
     */
    init() {
        this.clock = new THREE.Clock();

        // 1. Setup Scene & Perspective Camera
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x040407);
        this.scene.fog = new THREE.FogExp2(0x040407, 0.012);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);

        // 2. Setup WebGL Renderer
        this.webglRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.webglRenderer.setSize(window.innerWidth, window.innerHeight);
        this.webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); // cap at 2 for performance
        this.webglRenderer.shadowMap.enabled = true;
        this.webglRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        // Add to DOM
        document.getElementById('canvas-container').appendChild(this.webglRenderer.domElement);

        // 3. Initialize Lights
        this.initLights();

        // 4. Compile Custom Shaders & Materials
        this.initMaterials();

        // 5. Register Resize Listener
        window.addEventListener('resize', () => this.onWindowResize());
    },

    /**
     * Setups directional sun and ambient lighting with shadow maps
     */
    initLights() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
        this.scene.add(ambientLight);

        const sunLight = new THREE.DirectionalLight(0xffffff, 1.25);
        
        // Light vector direction matching C# skybox settings (LookRotation(-sunDirection))
        const sunDirection = new THREE.Vector3(0.5, 0.8, -0.3).normalize();
        sunLight.position.copy(sunDirection).multiplyScalar(100);
        sunLight.castShadow = true;
        this.scene.add(sunLight);

        // Optimize shadow map performance
        sunLight.shadow.mapSize.width = 1024;
        sunLight.shadow.mapSize.height = 1024;
        sunLight.shadow.camera.near = 0.5;
        sunLight.shadow.camera.far = 1000;
        const d = 150;
        sunLight.shadow.camera.left = -d;
        sunLight.shadow.camera.right = d;
        sunLight.shadow.camera.top = d;
        sunLight.shadow.camera.bottom = -d;
        sunLight.shadow.bias = -0.0005;
    },

    /**
     * Compiles GLSL materials and generates a dynamic stage color palette
     */
    initMaterials() {
        // Theme colors generated dynamically
        const themeHue = Math.random();
        
        const primaryColor = new THREE.Color().setHSL(themeHue, 0.7, 0.45);
        const primaryGlow = new THREE.Color().setHSL(themeHue, 0.95, 0.7);
        const secondaryColor = new THREE.Color().setHSL((themeHue + 0.4) % 1.0, 0.7, 0.4);
        const secondaryGlow = new THREE.Color().setHSL((themeHue + 0.4) % 1.0, 0.95, 0.7);

        // Shared single uTime uniform to optimize driver draw calls
        const timeUniform = { value: 0.0 };

        // -------------------------------------------------------------
        // GLSL VORONOI LIPID BILAYER SHADER (Osmosis style membranes)
        // -------------------------------------------------------------
        const MembraneShader = {
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vNormalWS;
                varying vec3 vViewDirWS;

                void main() {
                    vUv = uv;
                    vNormalWS = normalize(normalMatrix * normal);
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vViewDirWS = normalize(-mvPosition.xyz);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uColor;
                uniform vec3 uFlowColor;
                uniform float uCellScale;
                uniform float uCellSpeed;
                uniform float uFlowSpeed;
                uniform float uWaterDensity;

                varying vec2 vUv;
                varying vec3 vNormalWS;
                varying vec3 vViewDirWS;

                // Hash for Voronoi random cell grid offsets
                vec2 hash2(vec2 p) {
                    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
                }

                // Shifting Voronoi cellular noise
                float voronoi(vec2 uv, float speed) {
                    vec2 g = floor(uv);
                    vec2 f = fract(uv);
                    float minDist = 1.0;

                    for (int j = -1; j <= 1; j++) {
                        for (int i = -1; i <= 1; i++) {
                            vec2 gridOffset = vec2(float(i), float(j));
                            vec2 noisePos = hash2(g + gridOffset);
                            vec2 animOffset = 0.5 + 0.5 * sin(speed + noisePos * 6.2831);
                            vec2 r = gridOffset + animOffset - f;
                            float d = dot(r, r);
                            if (d < minDist) {
                                minDist = d;
                            }
                        }
                    }
                    return sqrt(minDist);
                }

                void main() {
                    // 1. Voronoi Lipid Bilayer
                    vec2 cellUV = vUv * uCellScale;
                    float cellShift = voronoi(cellUV, uTime * uCellSpeed);
                    float cellLine = smoothstep(0.0, 0.7, cellShift);
                    vec3 membraneColor = uColor * (1.0 - cellLine * 0.45);

                    // 2. Scrolling Osmosis water molecule dots
                    vec2 flowUV = vUv * uWaterDensity;
                    flowUV.y -= uTime * uFlowSpeed;
                    vec2 grid = fract(flowUV) - 0.5;
                    float dist = length(grid);
                    float dotMask = smoothstep(0.2, 0.08, dist);

                    vec2 cellID = floor(flowUV);
                    float randVal = fract(sin(dot(cellID, vec2(12.9898, 78.233))) * 43758.5453);
                    float pulse = 0.4 + 0.6 * sin(uTime * 6.0 + randVal * 6.28);
                    vec3 waterFlow = uFlowColor * (dotMask * pulse * randVal);

                    // 3. Fresnel edge glowing outline
                    float rim = pow(1.0 - max(0.0, dot(vNormalWS, vViewDirWS)), 3.0);
                    vec3 rimGlow = uFlowColor * rim * (0.8 + 0.2 * sin(uTime * 2.0));

                    // Assemble composite transparent colors
                    vec3 finalColor = membraneColor + waterFlow + rimGlow;
                    float finalAlpha = clamp(0.55 + dotMask * pulse * randVal * 0.4 + rim * 0.5, 0.0, 1.0);

                    gl_FragColor = vec4(finalColor, finalAlpha);
                }
            `
        };

        // Normal platform
        this.materials.normal = new THREE.ShaderMaterial({
            uniforms: {
                uTime: timeUniform,
                uColor: { value: new THREE.Vector3(primaryColor.r, primaryColor.g, primaryColor.b) },
                uFlowColor: { value: new THREE.Vector3(primaryGlow.r, primaryGlow.g, primaryGlow.b) },
                uCellScale: { value: 7.0 },
                uCellSpeed: { value: 0.8 },
                uFlowSpeed: { value: 2.2 },
                uWaterDensity: { value: 16.0 }
            },
            vertexShader: MembraneShader.vertexShader,
            fragmentShader: MembraneShader.fragmentShader,
            transparent: true,
            depthWrite: true,
            side: THREE.DoubleSide
        });

        // Start platform
        this.materials.start = new THREE.MeshPhysicalMaterial({
            color: 0x0a3311,
            emissive: 0x1f9024,
            roughness: 0.2,
            metalness: 0.1,
            transparent: true,
            opacity: 0.8
        });

        // Booster block (Yellow)
        this.materials.booster = new THREE.ShaderMaterial({
            uniforms: {
                uTime: timeUniform,
                uColor: { value: new THREE.Vector3(0.3, 0.28, 0.05) },
                uFlowColor: { value: new THREE.Vector3(1.0, 0.9, 0.1) },
                uCellScale: { value: 8.0 },
                uCellSpeed: { value: 1.2 },
                uFlowSpeed: { value: 3.5 },
                uWaterDensity: { value: 20.0 }
            },
            vertexShader: MembraneShader.vertexShader,
            fragmentShader: MembraneShader.fragmentShader,
            transparent: true,
            depthWrite: true,
            side: THREE.DoubleSide
        });

        // SpeedUp block (Purple/Magenta)
        this.materials.speedUp = new THREE.ShaderMaterial({
            uniforms: {
                uTime: timeUniform,
                uColor: { value: new THREE.Vector3(secondaryColor.r, secondaryColor.g, secondaryColor.b) },
                uFlowColor: { value: new THREE.Vector3(secondaryGlow.r, secondaryGlow.g, secondaryGlow.b) },
                uCellScale: { value: 8.0 },
                uCellSpeed: { value: 1.4 },
                uFlowSpeed: { value: 4.0 },
                uWaterDensity: { value: 20.0 }
            },
            vertexShader: MembraneShader.vertexShader,
            fragmentShader: MembraneShader.fragmentShader,
            transparent: true,
            depthWrite: true,
            side: THREE.DoubleSide
        });

        // -------------------------------------------------------------
        // GLSL GLOWING GLASS TUBE SHADER
        // -------------------------------------------------------------
        this.materials.tube = new THREE.ShaderMaterial({
            uniforms: {
                uTime: timeUniform,
                uWaterColor: { value: new THREE.Vector3(0.01, 0.08, 0.2) },
                uShallowColor: { value: new THREE.Vector3(0.0, 0.8, 0.9) },
                uFlowSpeed: { value: 1.8 }
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vNormalWS;
                varying vec3 vViewDirWS;

                void main() {
                    vUv = uv;
                    vNormalWS = normalize(normalMatrix * normal);
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vViewDirWS = normalize(-mvPosition.xyz);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uWaterColor;
                uniform vec3 uShallowColor;
                uniform float uFlowSpeed;

                varying vec2 vUv;
                varying vec3 vNormalWS;
                varying vec3 vViewDirWS;

                void main() {
                    // Fresnel translucency
                    float rim = pow(1.0 - max(0.0, dot(vNormalWS, vViewDirWS)), 4.0);
                    vec3 col = mix(uWaterColor, uShallowColor, rim);

                    // Pulsing sci-fi glass scanlines
                    float grid = fract(vUv.y * 12.0 - uTime * uFlowSpeed);
                    float scan = smoothstep(0.96, 0.98, grid);
                    col += vec3(0.3, 0.9, 1.0) * scan * 0.45;

                    float alpha = clamp(0.22 + rim * 0.65 + scan * 0.2, 0.0, 1.0);
                    gl_FragColor = vec4(col, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.NormalBlending
        });

        // -------------------------------------------------------------
        // GLSL GERSTNER WAVE SHADER (Water floor plane)
        // -------------------------------------------------------------
        this.materials.water = new THREE.ShaderMaterial({
            uniforms: {
                uTime: timeUniform,
                uWaterColor: { value: new THREE.Color(0x010815) },
                uShallowColor: { value: new THREE.Color(0x006b85) },
                uTimeScale: { value: 1.5 }
            },
            vertexShader: `
                uniform float uTime;
                uniform float uTimeScale;
                varying vec3 vPositionWS;
                varying vec3 vNormalWS;
                varying vec3 vViewDirWS;

                // Gerstner Wave displacement
                vec3 gerstner(vec4 wave, vec3 gridPos, float time, inout vec3 tangent, inout vec3 binormal) {
                    vec2 dir = normalize(wave.xy);
                    float amp = wave.z;
                    float wavelength = wave.w;
                    float k = 2.0 * 3.14159 / wavelength;
                    float c = sqrt(9.8 / k);
                    float speed = c * uTimeScale;
                    float phi = k * (dot(dir, gridPos.xz) - speed * time);
                    float steepness = 0.45;
                    float q = steepness / (amp * k * 3.0);
                    float sinPhi = sin(phi);
                    float cosPhi = cos(phi);

                    tangent += vec3(
                        -q * amp * k * dir.x * dir.x * sinPhi,
                        amp * k * dir.x * cosPhi,
                        -q * amp * k * dir.x * dir.y * sinPhi
                    );
                    binormal += vec3(
                        -q * amp * k * dir.x * dir.y * sinPhi,
                        amp * k * dir.y * cosPhi,
                        -q * amp * k * dir.y * dir.y * sinPhi
                    );

                    return vec3(
                        q * amp * dir.x * cosPhi,
                        amp * sinPhi,
                        q * amp * dir.y * cosPhi
                    );
                }

                void main() {
                    vec3 posWS = (modelMatrix * vec4(position, 1.0)).xyz;
                    float time = uTime;

                    vec3 tangent = vec3(1.0, 0.0, 0.0);
                    vec3 binormal = vec3(0.0, 0.0, 1.0);

                    // Displace position with 3 overlapping waves
                    vec3 offset = vec3(0.0);
                    offset += gerstner(vec4(1.0, 0.1, 0.22, 25.0), posWS, time, tangent, binormal);
                    offset += gerstner(vec4(0.6, 0.8, 0.12, 12.0), posWS, time, tangent, binormal);
                    offset += gerstner(vec4(-0.5, 0.8, 0.08, 6.0), posWS, time, tangent, binormal);

                    vec3 finalPosWS = posWS + offset;
                    vPositionWS = finalPosWS;

                    vNormalWS = normalize(cross(binormal, tangent));

                    vec4 mvPosition = viewMatrix * vec4(finalPosWS, 1.0);
                    vViewDirWS = normalize(-mvPosition.xyz);

                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uWaterColor;
                uniform vec3 uShallowColor;

                varying vec3 vPositionWS;
                varying vec3 vNormalWS;
                varying vec3 vViewDirWS;

                // FBM Ripples noise helper
                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
                }

                float noise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    vec2 u = f * f * (3.0 - 2.0 * f);

                    return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
                               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
                }

                float fbm(vec2 p, float time) {
                    float v = 0.0;
                    float a = 0.5;
                    vec2 shift = vec2(100.0);
                    vec2 t = vec2(time * 0.4, -time * 0.2);
                    for (int i = 0; i < 3; ++i) {
                        v += a * noise(p + t);
                        p = vec2(0.8 * p.x + 0.6 * p.y, -0.6 * p.x + 0.8 * p.y) * 2.0 + shift;
                        a *= 0.5;
                    }
                    return v;
                }

                void main() {
                    // Combine vertex waves normal with high frequency micro ripple bumps
                    float time = uTime;
                    vec2 microUV = vPositionWS.xz * 1.5;
                    float n = fbm(microUV, time);

                    float delta = 0.08;
                    float n_x = fbm(microUV + vec2(delta, 0.0), time);
                    float n_z = fbm(microUV + vec2(0.0, delta), time);
                    
                    float bump = 0.08;
                    vec3 microNormal = vec3(-(n_x - n) / delta * bump, 1.0, -(n_z - n) / delta * bump);
                    vec3 normalWS = normalize(vNormalWS + microNormal);

                    // Fresnel color blending
                    float rim = pow(1.0 - max(0.0, dot(normalWS, vViewDirWS)), 4.0);
                    vec3 baseCol = mix(uWaterColor, uShallowColor, rim);

                    // Directional lighting
                    vec3 lightDir = normalize(vec3(0.5, 0.8, -0.3));
                    float diffuse = max(0.0, dot(normalWS, lightDir) * 0.5 + 0.5);

                    // Specular reflection (sparkly Blinn-Phong)
                    vec3 halfDir = normalize(lightDir + vViewDirWS);
                    float spec = pow(max(0.0, dot(normalWS, halfDir)), 120.0) * 1.8;
                    vec3 specular = vec3(1.0) * spec;

                    // Wave foam based on displacement heights
                    float waveHeight = vPositionWS.y - (-3.8); // height offset relative to base level
                    float foamMask = clamp((waveHeight - 0.18) * 3.0, 0.0, 1.0);
                    vec3 foamColor = vec3(0.7, 0.9, 1.0) * foamMask * (0.3 + 0.7 * fbm(vPositionWS.xz * 3.0, time));

                    vec3 finalCol = baseCol * diffuse + specular + foamColor;
                    float alpha = clamp(0.7 + spec * 0.5 + foamMask * 0.8, 0.0, 1.0);

                    gl_FragColor = vec4(finalCol, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });
    },

    /**
     * Handles viewport resizing dynamically
     */
    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.webglRenderer.setSize(window.innerWidth, window.innerHeight);
    },

    /**
     * Runs the animation loop and triggers player updates
     */
    startRenderLoop() {
        const animate = () => {
            requestAnimationFrame(animate);

            // Get elapsed delta time capped to prevent physics frame-rate jumps
            let dt = this.clock.getDelta();
            if (dt > 0.1) dt = 0.1;

            const time = this.clock.getElapsedTime();

            // Update shader time uniforms
            this.materials.normal.uniforms.uTime.value = time;
            this.materials.booster.uniforms.uTime.value = time;
            this.materials.speedUp.uniforms.uTime.value = time;
            this.materials.tube.uniforms.uTime.value = time;
            this.materials.water.uniforms.uTime.value = time;

            // Update player controller physics
            if (window.Player) {
                window.Player.update(dt);
            }

            // Update block dip animation states
            if (window.LevelGenerator && window.LevelGenerator.blocks) {
                window.LevelGenerator.blocks.forEach((b) => b.update(dt));
            }

            // Render frame
            this.webglRenderer.render(this.scene, this.camera);
        };

        animate();
    }
};

window.Renderer = Renderer;
