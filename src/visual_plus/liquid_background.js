const KAWARP_MODULE_SOURCE = "/**\n * Kawarp - Fluid Animated Background Renderer\n *\n * Creates a fluid, animated background effect similar to Apple Music's album art visualization.\n * Uses WebGL with Kawase blur and domain warping techniques.\n *\n * Optimized architecture:\n * - Blur runs on small textures (128x128) only when image changes\n * - Smooth crossfade transitions between images\n * - Instant first frame without black buffer crossfade\n * - High-precision FBO tracking and resolution management\n * - Robust CORS and blob/imageBitmap loading\n */\n// Size for blur operations (small = fast)\nconst BLUR_SIZE = 128;\nconst DEFAULT_VIDEO_OPTIONS = {\n    sampleWidth: 128,\n    sampleHeight: 72,\n    downsampleFactor: 2,\n    frameRate: 0,\n    smoothing: 0,\n};\n// A media-time jump larger than this between frames is a seek, not playback.\nconst VIDEO_SEEK_THRESHOLD_SECONDS = 0.25;\n// Time constants after the last video frame before easing snaps and goes idle\nconst VIDEO_SMOOTHING_SETTLE_RESPONSES = 8;\nconst boundedOption = (value, fallback, min, max) => typeof value === \"number\" && Number.isFinite(value)\n    ? Math.min(max, Math.max(min, value))\n    : fallback;\nconst textureSourceSize = (source) => {\n    if (\"naturalWidth\" in source)\n        return [source.naturalWidth, source.naturalHeight];\n    if (\"videoWidth\" in source)\n        return [source.videoWidth, source.videoHeight];\n    if (\"displayWidth\" in source)\n        return [source.displayWidth, source.displayHeight];\n    return [source.width, source.height];\n};\nconst VERTEX_SHADER = `\n  attribute vec2 a_position;\n  attribute vec2 a_texCoord;\n  varying vec2 v_texCoord;\n  void main() {\n    gl_Position = vec4(a_position, 0.0, 1.0);\n    v_texCoord = a_texCoord;\n  }\n`;\nconst KAWASE_BLUR_SHADER = `\n  precision highp float;\n  uniform sampler2D u_texture;\n  uniform vec2 u_resolution;\n  uniform float u_offset;\n  varying vec2 v_texCoord;\n\n  void main() {\n    highp vec2 texelSize = 1.0 / u_resolution;\n    highp vec4 color = vec4(0.0);\n\n    color += texture2D(u_texture, v_texCoord + vec2(-u_offset, -u_offset) * texelSize);\n    color += texture2D(u_texture, v_texCoord + vec2(u_offset, -u_offset) * texelSize);\n    color += texture2D(u_texture, v_texCoord + vec2(-u_offset, u_offset) * texelSize);\n    color += texture2D(u_texture, v_texCoord + vec2(u_offset, u_offset) * texelSize);\n\n    gl_FragColor = color * 0.25;\n  }\n`;\n// Blend shader for crossfading between two textures\nconst BLEND_SHADER = `\n  precision highp float;\n  uniform sampler2D u_texture1;\n  uniform sampler2D u_texture2;\n  uniform float u_blend;\n  varying vec2 v_texCoord;\n\n  void main() {\n    vec4 color1 = texture2D(u_texture1, v_texCoord);\n    vec4 color2 = texture2D(u_texture2, v_texCoord);\n    gl_FragColor = mix(color1, color2, u_blend);\n  }\n`;\n// Tint shader - applies color to dark areas before blur\nconst TINT_SHADER = `\n  precision highp float;\n  uniform sampler2D u_texture;\n  uniform vec3 u_tintColor;\n  uniform float u_tintIntensity;\n  varying vec2 v_texCoord;\n\n  void main() {\n    vec4 color = texture2D(u_texture, v_texCoord);\n    float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));\n\n    // darkMask: 1.0 for black, 0.0 for luma >= 0.5\n    float darkMask = 1.0 - smoothstep(0.0, 0.5, luma);\n\n    // Blend dark areas toward tint color\n    color.rgb = mix(color.rgb, u_tintColor, darkMask * u_tintIntensity);\n\n    gl_FragColor = color;\n  }\n`;\nconst DOMAIN_WARP_SHADER = `\n  precision highp float;\n  uniform sampler2D u_texture;\n  uniform float u_time;\n  uniform float u_intensity;\n  varying vec2 v_texCoord;\n\n  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }\n  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }\n  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }\n\n  float snoise(vec2 v) {\n    const vec4 C = vec4(0.211324865405187, 0.366025403784439,\n                        -0.577350269189626, 0.024390243902439);\n    vec2 i  = floor(v + dot(v, C.yy));\n    vec2 x0 = v - i + dot(i, C.xx);\n    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);\n    vec4 x12 = x0.xyxy + C.xxzz;\n    x12.xy -= i1;\n    i = mod289(i);\n    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));\n    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);\n    m = m*m; m = m*m;\n    vec3 x = 2.0 * fract(p * C.www) - 1.0;\n    vec3 h = abs(x) - 0.5;\n    vec3 ox = floor(x + 0.5);\n    vec3 a0 = x - ox;\n    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);\n    vec3 g;\n    g.x = a0.x * x0.x + h.x * x0.y;\n    g.yz = a0.yz * x12.xz + h.yz * x12.yw;\n    return 130.0 * dot(m, g);\n  }\n\n  void main() {\n    vec2 uv = v_texCoord;\n    float t = u_time * 0.05;\n\n    vec2 center = uv - 0.5;\n    float centerWeight = 1.0 - smoothstep(0.0, 0.7, length(center));\n\n    // Large-scale movement (slow, big blobs)\n    float n1 = snoise(uv * 0.35 + vec2(t, t * 0.7));\n    float n2 = snoise(uv * 0.35 + vec2(-t * 0.8, t * 0.5) + vec2(50.0, 50.0));\n\n    // Medium-scale detail (adds organic movement)\n    float n3 = snoise(uv * 0.9 + vec2(t * 1.2, -t) + vec2(100.0, 0.0));\n    float n4 = snoise(uv * 0.9 + vec2(-t, t * 1.1) + vec2(0.0, 100.0));\n\n    // Combine two octaves\n    vec2 warp = vec2(\n      n1 * 0.65 + n3 * 0.35,\n      n2 * 0.65 + n4 * 0.35\n    ) * centerWeight;\n\n    vec2 warpedUV = uv + warp * u_intensity;\n    warpedUV = clamp(warpedUV, 0.0, 1.0);\n\n    gl_FragColor = texture2D(u_texture, warpedUV);\n  }\n`;\nconst OUTPUT_SHADER = `\n  precision highp float;\n  uniform sampler2D u_texture;\n  uniform float u_saturation;\n  uniform float u_dithering;\n  uniform float u_time;\n  uniform float u_scale;\n  uniform vec2 u_resolution;\n  varying vec2 v_texCoord;\n\n  highp float hash(highp vec3 p) {\n    p = fract(p * 0.1031);\n    p += dot(p, p.zyx + 31.32);\n    return fract((p.x + p.y) * p.z);\n  }\n\n  void main() {\n    vec2 uv = (v_texCoord - 0.5) / u_scale + 0.5;\n    uv = clamp(uv, 0.0, 1.0);\n\n    vec4 color = texture2D(u_texture, uv);\n\n    vec2 center = v_texCoord - 0.5;\n    float vignette = 1.0 - dot(center, center) * 0.3;\n    color.rgb *= vignette;\n\n    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));\n    color.rgb = mix(vec3(gray), color.rgb, u_saturation);\n\n    highp vec2 pixelPos = floor(v_texCoord * u_resolution);\n    highp float noise = hash(vec3(pixelPos, floor(u_time * 60.0)));\n    color.rgb += (noise - 0.5) * u_dithering;\n\n    gl_FragColor = color;\n  }\n`;\n// Four bilinear taps average a 4x4 source footprint for reductions up to 4x\nconst DOWNSAMPLE_SHADER = `\n  precision highp float;\n  uniform sampler2D u_texture;\n  uniform vec2 u_texelSize;\n  varying vec2 v_texCoord;\n\n  void main() {\n    vec2 offset = u_texelSize * 0.25;\n    gl_FragColor = 0.25 * (\n      texture2D(u_texture, v_texCoord + vec2(-offset.x, -offset.y)) +\n      texture2D(u_texture, v_texCoord + vec2(offset.x, -offset.y)) +\n      texture2D(u_texture, v_texCoord + vec2(-offset.x, offset.y)) +\n      texture2D(u_texture, v_texCoord + vec2(offset.x, offset.y))\n    );\n  }\n`;\n// Moves at least one storage step toward the target, so half-float and 8-bit\n// history cannot stall short of it when the per-frame response is tiny\nconst SMOOTHING_SHADER = `\n  precision highp float;\n  uniform sampler2D u_texture;\n  uniform sampler2D u_history;\n  uniform float u_response;\n  uniform float u_minStep;\n  varying vec2 v_texCoord;\n\n  void main() {\n    vec4 history = texture2D(u_history, v_texCoord);\n    vec4 current = texture2D(u_texture, v_texCoord);\n    vec4 blended = mix(history, current, u_response);\n    vec4 remaining = current - history;\n    vec4 minimal = history + sign(remaining) * min(abs(remaining), vec4(u_minStep));\n    gl_FragColor = mix(\n      minimal,\n      blended,\n      step(abs(minimal - history), abs(blended - history))\n    );\n  }\n`;\nexport class Kawarp {\n    canvas;\n    gl;\n    halfFloatExt = null;\n    halfFloatLinearExt = null;\n    // Shader programs\n    blurProgram;\n    blendProgram;\n    tintProgram;\n    warpProgram;\n    outputProgram;\n    // Buffers\n    positionBuffer;\n    texCoordBuffer;\n    // Source texture (original image)\n    sourceTexture;\n    // Small FBOs for blur (BLUR_SIZE x BLUR_SIZE)\n    blurFBO1;\n    blurFBO2;\n    // Album FBOs for crossfade (BLUR_SIZE x BLUR_SIZE)\n    currentAlbumFBO;\n    nextAlbumFBO;\n    // Full-res FBO for warp output\n    warpFBO;\n    // Animation state\n    animationId = null;\n    lastFrameTime = 0;\n    accumulatedTime = 0;\n    isPlaying = false;\n    disposed = false;\n    // Transition state\n    isTransitioning = false;\n    transitionStartTime = 0;\n    _transitionDuration;\n    // Options\n    _warpIntensity;\n    _blurPasses;\n    _animationSpeed;\n    _targetAnimationSpeed;\n    _saturation;\n    _tintColor;\n    _tintIntensity;\n    _dithering;\n    _scale;\n    hasImage = false;\n    // WebGL2 high-precision state (null/false on the default WebGL1 path)\n    gl2;\n    halfFloatRenderTargets = false;\n    float32RenderTargets = false;\n    floatLinearFiltering = false;\n    _highPrecisionOutput = false;\n    highPrecisionInputRequested;\n    // Texture the blur reads from: the image source or the latest video frame\n    activeSourceTexture;\n    imageSourceWidth = 0;\n    imageSourceHeight = 0;\n    videoFrameWidth = 0;\n    videoFrameHeight = 0;\n    // Video source state\n    video = null;\n    // An in-flight image load is dropped only when a later loadVideo call has\n    // since put a video frame on screen\n    videoLoadCount = 0;\n    // videoLoadCount of the last video that put a frame on screen\n    shownVideoLoad = 0;\n    videoOptions = { ...DEFAULT_VIDEO_OPTIONS };\n    videoCallbackId = null;\n    videoUploadTexture = null;\n    videoStages = [];\n    videoHistory = [];\n    videoHistoryIndex = 0;\n    hasVideoHistory = false;\n    // Latest downsampled frame the history is easing toward, null once settled\n    videoSmoothingTarget = null;\n    videoSmoothingTargetAt = 0;\n    videoSmoothedAt = 0;\n    // Smallest change the history format can store; 0 for float32\n    videoHistoryStep = 0;\n    // Ideal time of the last sample on the frameRate cadence\n    videoSampleSlot = Number.NEGATIVE_INFINITY;\n    videoTargetsStale = true;\n    videoSourceWidth = 0;\n    videoSourceHeight = 0;\n    videoFrameTime = 0;\n    videoMediaTime = 0;\n    videoFrameShown = false;\n    videoFramePending = false;\n    retainedVideoFrame = null;\n    samplingPrograms = null;\n    sampleTargets = [];\n    sampleTargetsLayout = [0, 0, 0];\n    pendingSampleSize = 0;\n    samplePixelBuffer = null;\n    pendingSample = null;\n    // Cached attribute locations\n    attribs;\n    // Cached uniform locations\n    uniforms;\n    constructor(canvas, options = {}) {\n        this.canvas = canvas;\n        const contextAttributes = {\n            alpha: true,\n            antialias: false,\n            depth: false,\n            stencil: false,\n            preserveDrawingBuffer: true,\n            powerPreference: \"high-performance\",\n        };\n        const gl2 = options.highPrecisionInput || options.highPrecisionOutput\n            ? canvas.getContext(\"webgl2\", contextAttributes)\n            : null;\n        const gl = gl2 ?? canvas.getContext(\"webgl\", contextAttributes);\n        if (!gl)\n            throw new Error(\"WebGL not supported\");\n        this.gl = gl;\n        this.gl2 = gl2;\n        this.highPrecisionInputRequested = !!gl2 && !!options.highPrecisionInput;\n        this.halfFloatExt = gl.getExtension(\"OES_texture_half_float\");\n        this.halfFloatLinearExt = gl.getExtension(\"OES_texture_half_float_linear\");\n        if (gl2) {\n            this.float32RenderTargets = !!gl2.getExtension(\"EXT_color_buffer_float\");\n            this.halfFloatRenderTargets =\n                this.float32RenderTargets ||\n                    !!gl2.getExtension(\"EXT_color_buffer_half_float\");\n            this.floatLinearFiltering = !!gl2.getExtension(\"OES_texture_float_linear\");\n        }\n        this._warpIntensity = options.warpIntensity ?? 1.0;\n        this._blurPasses = options.blurPasses ?? 8;\n        this._animationSpeed = options.animationSpeed ?? 1.0;\n        this._targetAnimationSpeed = this._animationSpeed;\n        this._transitionDuration = options.transitionDuration ?? 1000;\n        this._saturation = options.saturation ?? 1.5;\n        this._tintColor = options.tintColor ?? [0.157, 0.157, 0.235];\n        this._tintIntensity = options.tintIntensity ?? 0.15;\n        this._dithering = options.dithering ?? 0.008;\n        this._scale = options.scale ?? 1.0;\n        // Create shader programs\n        this.blurProgram = this.createProgram(VERTEX_SHADER, KAWASE_BLUR_SHADER);\n        this.blendProgram = this.createProgram(VERTEX_SHADER, BLEND_SHADER);\n        this.tintProgram = this.createProgram(VERTEX_SHADER, TINT_SHADER);\n        this.warpProgram = this.createProgram(VERTEX_SHADER, DOMAIN_WARP_SHADER);\n        this.outputProgram = this.createProgram(VERTEX_SHADER, OUTPUT_SHADER);\n        // Cache attribute locations (same for all programs since they use same vertex shader)\n        this.attribs = {\n            position: gl.getAttribLocation(this.blurProgram, \"a_position\"),\n            texCoord: gl.getAttribLocation(this.blurProgram, \"a_texCoord\"),\n        };\n        // Cache uniform locations\n        this.uniforms = {\n            blur: {\n                resolution: gl.getUniformLocation(this.blurProgram, \"u_resolution\"),\n                texture: gl.getUniformLocation(this.blurProgram, \"u_texture\"),\n                offset: gl.getUniformLocation(this.blurProgram, \"u_offset\"),\n            },\n            blend: {\n                texture1: gl.getUniformLocation(this.blendProgram, \"u_texture1\"),\n                texture2: gl.getUniformLocation(this.blendProgram, \"u_texture2\"),\n                blend: gl.getUniformLocation(this.blendProgram, \"u_blend\"),\n            },\n            warp: {\n                texture: gl.getUniformLocation(this.warpProgram, \"u_texture\"),\n                time: gl.getUniformLocation(this.warpProgram, \"u_time\"),\n                intensity: gl.getUniformLocation(this.warpProgram, \"u_intensity\"),\n            },\n            tint: {\n                texture: gl.getUniformLocation(this.tintProgram, \"u_texture\"),\n                tintColor: gl.getUniformLocation(this.tintProgram, \"u_tintColor\"),\n                tintIntensity: gl.getUniformLocation(this.tintProgram, \"u_tintIntensity\"),\n            },\n            output: {\n                texture: gl.getUniformLocation(this.outputProgram, \"u_texture\"),\n                saturation: gl.getUniformLocation(this.outputProgram, \"u_saturation\"),\n                dithering: gl.getUniformLocation(this.outputProgram, \"u_dithering\"),\n                time: gl.getUniformLocation(this.outputProgram, \"u_time\"),\n                scale: gl.getUniformLocation(this.outputProgram, \"u_scale\"),\n                resolution: gl.getUniformLocation(this.outputProgram, \"u_resolution\"),\n            },\n        };\n        // Create buffers\n        this.positionBuffer = this.createBuffer(new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]));\n        this.texCoordBuffer = this.createBuffer(new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]));\n        // Create source texture\n        this.sourceTexture = this.createTexture();\n        this.activeSourceTexture = this.sourceTexture;\n        // Create small FBOs for blur operations (high precision to avoid banding)\n        this.blurFBO1 = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE, true);\n        this.blurFBO2 = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE, true);\n        // Create album FBOs for crossfade (high precision to avoid banding)\n        this.currentAlbumFBO = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE, true);\n        this.nextAlbumFBO = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE, true);\n        const initW = Math.max(1, canvas.width || 640);\n        const initH = Math.max(1, canvas.height || 360);\n        this.warpFBO = this.createFramebuffer(initW, initH, true);\n        if (options.highPrecisionOutput)\n            this.applyFloatDrawingBuffer();\n    }\n    /** Whether the drawing buffer is float16 (requested via highPrecisionOutput) */\n    get highPrecisionOutput() {\n        return this._highPrecisionOutput;\n    }\n    /** Whether smoothed video keeps float32 color history (requested via highPrecisionInput) */\n    get highPrecisionInput() {\n        return this.highPrecisionInputRequested && this.float32RenderTargets;\n    }\n    // Getters and setters\n    get warpIntensity() {\n        return this._warpIntensity;\n    }\n    set warpIntensity(value) {\n        this._warpIntensity = Math.max(0, Math.min(1, value));\n    }\n    get blurPasses() {\n        return this._blurPasses;\n    }\n    set blurPasses(value) {\n        const newValue = Math.max(0, Math.min(40, Math.floor(value)));\n        if (newValue !== this._blurPasses) {\n            this._blurPasses = newValue;\n            // Re-blur with new pass count if we have an image\n            if (this.hasImage) {\n                this.reblurCurrentImage();\n            }\n        }\n    }\n    get animationSpeed() {\n        return this._targetAnimationSpeed;\n    }\n    set animationSpeed(value) {\n        this._targetAnimationSpeed = Math.max(0, Math.min(16, value));\n    }\n    get transitionDuration() {\n        return this._transitionDuration;\n    }\n    set transitionDuration(value) {\n        this._transitionDuration = Math.max(0, Math.min(5000, value));\n    }\n    get saturation() {\n        return this._saturation;\n    }\n    set saturation(value) {\n        this._saturation = Math.max(0, Math.min(3, value));\n    }\n    get tintColor() {\n        return this._tintColor;\n    }\n    set tintColor(value) {\n        const newValue = value.map((v) => Math.max(0, Math.min(1, v)));\n        const changed = newValue.some((v, i) => v !== this._tintColor[i]);\n        if (changed) {\n            this._tintColor = newValue;\n            if (this.hasImage) {\n                this.reblurCurrentImage();\n            }\n        }\n    }\n    get tintIntensity() {\n        return this._tintIntensity;\n    }\n    set tintIntensity(value) {\n        const newValue = Math.max(0, Math.min(1, value));\n        if (newValue !== this._tintIntensity) {\n            this._tintIntensity = newValue;\n            if (this.hasImage) {\n                this.reblurCurrentImage();\n            }\n        }\n    }\n    get dithering() {\n        return this._dithering;\n    }\n    set dithering(value) {\n        this._dithering = Math.max(0, Math.min(0.1, value));\n    }\n    get scale() {\n        return this._scale;\n    }\n    set scale(value) {\n        this._scale = Math.max(0.01, Math.min(4, value));\n    }\n    setOptions(options) {\n        if (options.warpIntensity !== undefined)\n            this.warpIntensity = options.warpIntensity;\n        if (options.blurPasses !== undefined)\n            this.blurPasses = options.blurPasses;\n        if (options.animationSpeed !== undefined)\n            this.animationSpeed = options.animationSpeed;\n        if (options.transitionDuration !== undefined)\n            this.transitionDuration = options.transitionDuration;\n        if (options.saturation !== undefined)\n            this.saturation = options.saturation;\n        if (options.tintColor !== undefined)\n            this.tintColor = options.tintColor;\n        if (options.tintIntensity !== undefined)\n            this.tintIntensity = options.tintIntensity;\n        if (options.dithering !== undefined)\n            this.dithering = options.dithering;\n        if (options.scale !== undefined)\n            this.scale = options.scale;\n    }\n    getOptions() {\n        return {\n            warpIntensity: this._warpIntensity,\n            blurPasses: this._blurPasses,\n            animationSpeed: this._targetAnimationSpeed,\n            transitionDuration: this._transitionDuration,\n            saturation: this._saturation,\n            tintColor: this._tintColor,\n            tintIntensity: this._tintIntensity,\n            dithering: this._dithering,\n            scale: this._scale,\n        };\n    }\n    // Image loading methods\n    async loadImage(src) {\n        if (!src)\n            return;\n        const videoLoadsAtStart = this.videoLoadCount;\n        let bitmap = null;\n        try {\n            const res = await fetch(src, { mode: \"cors\" });\n            if (res.ok) {\n                const blob = await res.blob();\n                bitmap = await createImageBitmap(blob);\n            }\n        }\n        catch {\n            // ignore fetch failure and proceed to image fallback\n        }\n        if (!bitmap) {\n            bitmap = await new Promise((resolve, reject) => {\n                const img = new Image();\n                img.crossOrigin = \"anonymous\";\n                img.onload = () => resolve(img);\n                img.onerror = () => reject(new Error(`Failed to load image: ${src}`));\n                img.src = src;\n            });\n        }\n        if (this.disposed || this.shownVideoLoad > videoLoadsAtStart) {\n            if (\"close\" in bitmap)\n                bitmap.close();\n            return;\n        }\n        const posterForVideo = !!this.video && this.videoLoadCount !== videoLoadsAtStart;\n        const gl = this.gl;\n        gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);\n        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);\n        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);\n        [this.imageSourceWidth, this.imageSourceHeight] = textureSourceSize(bitmap);\n        if (\"close\" in bitmap &&\n            typeof bitmap.close === \"function\") {\n            bitmap.close();\n        }\n        this.processNewImage(this.sourceTexture, posterForVideo);\n    }\n    loadImageElement(source) {\n        this.showImageElement(source, false);\n    }\n    showImageElement(source, posterForVideo) {\n        this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);\n        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, source);\n        [this.imageSourceWidth, this.imageSourceHeight] = textureSourceSize(source);\n        this.processNewImage(this.sourceTexture, posterForVideo);\n    }\n    loadImageData(data, width, height) {\n        this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);\n        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, width, height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, data instanceof Uint8ClampedArray ? new Uint8Array(data.buffer) : data);\n        this.imageSourceWidth = width;\n        this.imageSourceHeight = height;\n        this.processNewImage();\n    }\n    loadFromImageData(imageData) {\n        this.loadImageData(imageData.data, imageData.width, imageData.height);\n    }\n    async loadBlob(blob) {\n        const videoLoadsAtStart = this.videoLoadCount;\n        const bitmap = await createImageBitmap(blob);\n        if (this.disposed || this.shownVideoLoad > videoLoadsAtStart) {\n            bitmap.close();\n            return;\n        }\n        const posterForVideo = !!this.video && this.videoLoadCount !== videoLoadsAtStart;\n        this.showImageElement(bitmap, posterForVideo);\n        bitmap.close();\n    }\n    loadBase64(base64) {\n        const src = base64.startsWith(\"data:\")\n            ? base64\n            : `data:image/png;base64,${base64}`;\n        return this.loadImage(src);\n    }\n    async loadArrayBuffer(buffer, mimeType = \"image/png\") {\n        const blob = new Blob([buffer], { type: mimeType });\n        return this.loadBlob(blob);\n    }\n    loadGradient(colors, angle = 135) {\n        const size = 512;\n        const canvas = document.createElement(\"canvas\");\n        canvas.width = size;\n        canvas.height = size;\n        const ctx = canvas.getContext(\"2d\");\n        if (!ctx)\n            return;\n        const angleRad = (angle * Math.PI) / 180;\n        const x1 = size / 2 - Math.cos(angleRad) * size;\n        const y1 = size / 2 - Math.sin(angleRad) * size;\n        const x2 = size / 2 + Math.cos(angleRad) * size;\n        const y2 = size / 2 + Math.sin(angleRad) * size;\n        const gradient = ctx.createLinearGradient(x1, y1, x2, y2);\n        colors.forEach((color, i) => {\n            gradient.addColorStop(i / (colors.length - 1), color);\n        });\n        ctx.fillStyle = gradient;\n        ctx.fillRect(0, 0, size, size);\n        this.loadImageElement(canvas);\n    }\n    /**\n     * Use a playing video as the source. Each decoded frame is imported on the\n     * GPU, downsampled in stages, optionally smoothed over time, and blurred in\n     * place. The first frame crossfades from the current image (instantly on a\n     * stopped instance). Video renders\n     * upright; images keep their historical flipped orientation.\n     *\n     * Calling again with the same element only updates the options. A stopped\n     * instance skips frames from a playing video and draws single frames from a\n     * paused one, so seeking while paused stays visible.\n     */\n    loadVideo(video, options = {}) {\n        if (this.disposed)\n            return;\n        if (typeof video.requestVideoFrameCallback !== \"function\") {\n            throw new Error(\"Video sources require requestVideoFrameCallback\");\n        }\n        const isNewVideo = this.video !== video;\n        if (isNewVideo) {\n            this.videoLoadCount++;\n            this.unloadVideo();\n            this.video = video;\n            this.videoFrameShown = false;\n            this.hasVideoHistory = false;\n            this.videoSampleSlot = Number.NEGATIVE_INFINITY;\n        }\n        const nextOptions = {\n            sampleWidth: Math.round(boundedOption(options.sampleWidth, DEFAULT_VIDEO_OPTIONS.sampleWidth, 1, 1024)),\n            sampleHeight: Math.round(boundedOption(options.sampleHeight, DEFAULT_VIDEO_OPTIONS.sampleHeight, 1, 1024)),\n            downsampleFactor: boundedOption(options.downsampleFactor, DEFAULT_VIDEO_OPTIONS.downsampleFactor, 1.25, 4),\n            frameRate: boundedOption(options.frameRate, DEFAULT_VIDEO_OPTIONS.frameRate, 0, 240),\n            smoothing: boundedOption(options.smoothing, DEFAULT_VIDEO_OPTIONS.smoothing, 0, 10000),\n            onError: options.onError,\n        };\n        const previousOptions = this.videoOptions;\n        if (isNewVideo ||\n            nextOptions.sampleWidth !== previousOptions.sampleWidth ||\n            nextOptions.sampleHeight !== previousOptions.sampleHeight ||\n            nextOptions.downsampleFactor !== previousOptions.downsampleFactor ||\n            nextOptions.smoothing > 0 !== previousOptions.smoothing > 0) {\n            this.videoTargetsStale = true;\n        }\n        this.videoOptions = nextOptions;\n        this.requestVideoFrame();\n        if (video.readyState >= video.HAVE_CURRENT_DATA &&\n            (isNewVideo || (video.paused && this.videoTargetsStale))) {\n            this.processVideoFrame(performance.now(), video.currentTime);\n        }\n    }\n    /**\n     * Stop following the video. The last frame stays on screen until the next\n     * image or video is loaded.\n     */\n    unloadVideo() {\n        const video = this.video;\n        if (!video)\n            return;\n        if (this.videoCallbackId !== null) {\n            video.cancelVideoFrameCallback(this.videoCallbackId);\n            this.videoCallbackId = null;\n        }\n        video.removeEventListener(\"pause\", this.resumeVideoCallbacks);\n        this.video = null;\n        this.videoFramePending = false;\n        this.releaseVideoTargets();\n        if (this.videoUploadTexture) {\n            this.gl.deleteTexture(this.videoUploadTexture);\n            this.videoUploadTexture = null;\n        }\n    }\n    /**\n     * Read a small RGBA8 thumbnail (size x size, bottom row of the rendered\n     * orientation first) of the current source, e.g. to measure brightness. WebGL2 reads asynchronously\n     * through a pixel buffer and fence; WebGL1 reads synchronously.\n     * Resolves to null when there is no source or the instance is disposed.\n     */\n    sampleSource(size = 32) {\n        if (this.disposed || !this.hasImage)\n            return Promise.resolve(null);\n        const edge = Math.round(boundedOption(size, 32, 1, BLUR_SIZE));\n        if (this.pendingSample) {\n            return this.pendingSampleSize === edge\n                ? this.pendingSample\n                : this.pendingSample.then(() => this.sampleSource(edge));\n        }\n        const gl = this.gl;\n        const [sourceWidth, sourceHeight] = this.activeSourceTexture === this.sourceTexture\n            ? [this.imageSourceWidth, this.imageSourceHeight]\n            : [this.videoFrameWidth, this.videoFrameHeight];\n        this.prepareSampleTargets(sourceWidth, sourceHeight, edge);\n        let sampledTexture = this.activeSourceTexture;\n        for (const stage of this.sampleTargets) {\n            this.drawDownsample(sampledTexture, stage);\n            sampledTexture = stage.texture;\n        }\n        const pixels = new Uint8Array(edge * edge * 4);\n        const gl2 = this.gl2;\n        if (!gl2) {\n            gl.readPixels(0, 0, edge, edge, gl.RGBA, gl.UNSIGNED_BYTE, pixels);\n            return Promise.resolve(pixels);\n        }\n        this.samplePixelBuffer ??= gl2.createBuffer();\n        gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, this.samplePixelBuffer);\n        gl2.bufferData(gl2.PIXEL_PACK_BUFFER, pixels.byteLength, gl2.STREAM_READ);\n        gl2.readPixels(0, 0, edge, edge, gl2.RGBA, gl2.UNSIGNED_BYTE, 0);\n        gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, null);\n        const fence = gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0);\n        if (!fence)\n            return Promise.resolve(null);\n        gl2.flush();\n        // Timers keep polling in background tabs, where animation frames stop\n        const sample = new Promise((resolve) => {\n            const poll = () => {\n                if (this.disposed) {\n                    gl2.deleteSync(fence);\n                    resolve(null);\n                    return;\n                }\n                const status = gl2.clientWaitSync(fence, 0, 0);\n                if (status === gl2.TIMEOUT_EXPIRED) {\n                    setTimeout(poll, 4);\n                    return;\n                }\n                gl2.deleteSync(fence);\n                if (status === gl2.WAIT_FAILED) {\n                    resolve(null);\n                    return;\n                }\n                gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, this.samplePixelBuffer);\n                gl2.getBufferSubData(gl2.PIXEL_PACK_BUFFER, 0, pixels);\n                gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, null);\n                resolve(pixels);\n            };\n            setTimeout(poll, 0);\n        }).finally(() => {\n            this.pendingSample = null;\n        });\n        this.pendingSample = sample;\n        this.pendingSampleSize = edge;\n        return sample;\n    }\n    /**\n     * Halving stages from the source down to size x size. A single 4-tap\n     * reduction from full-resolution artwork would skip most texels and alias.\n     */\n    prepareSampleTargets(sourceWidth, sourceHeight, edge) {\n        const [cachedWidth, cachedHeight, cachedEdge] = this.sampleTargetsLayout;\n        if (sourceWidth === cachedWidth &&\n            sourceHeight === cachedHeight &&\n            edge === cachedEdge) {\n            return;\n        }\n        for (const target of this.sampleTargets)\n            this.deleteFramebuffer(target);\n        this.sampleTargets = [];\n        let width = sourceWidth;\n        let height = sourceHeight;\n        while (width > edge * 2 || height > edge * 2) {\n            width = Math.max(edge, Math.ceil(width / 2));\n            height = Math.max(edge, Math.ceil(height / 2));\n            this.sampleTargets.push(this.createByteFramebuffer(width, height));\n        }\n        this.sampleTargets.push(this.createByteFramebuffer(edge, edge));\n        this.sampleTargetsLayout = [sourceWidth, sourceHeight, edge];\n    }\n    createByteFramebuffer(width, height) {\n        return this.gl2\n            ? this.createSizedFramebuffer(width, height, this.gl2.RGBA8)\n            : this.createFramebuffer(width, height);\n    }\n    requestVideoFrame() {\n        if (!this.video || this.videoCallbackId !== null)\n            return;\n        this.videoCallbackId = this.video.requestVideoFrameCallback(this.handleVideoFrame);\n    }\n    handleVideoFrame = (now, metadata) => {\n        this.videoCallbackId = null;\n        const video = this.video;\n        if (!video || this.disposed)\n            return;\n        // Stay idle until start(), but wake on pause so a paused seek still redraws\n        if (!this.isPlaying && !video.paused) {\n            this.videoFramePending = true;\n            video.addEventListener(\"pause\", this.resumeVideoCallbacks, {\n                once: true,\n            });\n            return;\n        }\n        this.requestVideoFrame();\n        const { frameRate } = this.videoOptions;\n        if (frameRate > 0 && !video.paused) {\n            const interval = 1000 / frameRate;\n            // Slack keeps jittery frame timing from halving the rate\n            if (now < this.videoSampleSlot + interval * 0.75)\n                return;\n        }\n        this.processVideoFrame(now, metadata.mediaTime);\n    };\n    resumeVideoCallbacks = () => {\n        this.requestVideoFrame();\n    };\n    processVideoFrame(now, mediaTime) {\n        const video = this.video;\n        if (!video ||\n            video.readyState < video.HAVE_CURRENT_DATA ||\n            video.videoWidth === 0 ||\n            video.videoHeight === 0) {\n            return;\n        }\n        const gl = this.gl;\n        const elapsedMs = now - this.videoFrameTime;\n        try {\n            this.prepareVideoTargets(video.videoWidth, video.videoHeight);\n            gl.activeTexture(gl.TEXTURE0);\n            gl.bindTexture(gl.TEXTURE_2D, this.videoUploadTexture);\n            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);\n            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);\n        }\n        catch (error) {\n            const { onError } = this.videoOptions;\n            this.unloadVideo();\n            onError?.(error);\n            return;\n        }\n        finally {\n            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);\n        }\n        let frameTexture = this.videoUploadTexture;\n        for (const stage of this.videoStages) {\n            this.drawDownsample(frameTexture, stage);\n            frameTexture = stage.texture;\n        }\n        const { smoothing } = this.videoOptions;\n        let easedByRenderLoop = false;\n        if (smoothing > 0) {\n            const expectedMediaAdvance = (elapsedMs / 1000) * video.playbackRate;\n            const seeked = Math.abs(mediaTime - this.videoMediaTime - expectedMediaAdvance) >\n                VIDEO_SEEK_THRESHOLD_SECONDS;\n            const snap = !this.hasVideoHistory ||\n                !this.videoFrameShown ||\n                !this.isPlaying ||\n                video.paused ||\n                seeked;\n            if (snap) {\n                frameTexture = this.drawSmoothing(frameTexture, 1);\n                this.videoSmoothingTarget = null;\n            }\n            else {\n                if (!this.videoSmoothingTarget)\n                    this.videoSmoothedAt = now;\n                this.videoSmoothingTarget = frameTexture;\n                this.videoSmoothingTargetAt = now;\n                easedByRenderLoop = true;\n            }\n            this.hasVideoHistory = true;\n        }\n        else {\n            this.hasVideoHistory = false;\n        }\n        const { frameRate } = this.videoOptions;\n        if (frameRate > 0) {\n            const interval = 1000 / frameRate;\n            // Advance on a fixed cadence; restart it after falling behind\n            this.videoSampleSlot =\n                now - this.videoSampleSlot > interval * 2\n                    ? now\n                    : this.videoSampleSlot + interval;\n        }\n        this.videoFrameTime = now;\n        this.videoMediaTime = mediaTime;\n        this.videoFrameWidth = this.videoOptions.sampleWidth;\n        this.videoFrameHeight = this.videoOptions.sampleHeight;\n        if (!easedByRenderLoop)\n            this.showVideoFrame(frameTexture);\n    }\n    // Easing per animation frame keeps a low frame rate source from stepping\n    advanceVideoSmoothing(timestamp) {\n        const target = this.videoSmoothingTarget;\n        if (!target)\n            return;\n        const { smoothing } = this.videoOptions;\n        const settled = timestamp - this.videoSmoothingTargetAt >=\n            smoothing * VIDEO_SMOOTHING_SETTLE_RESPONSES;\n        const elapsedMs = Math.max(0, timestamp - this.videoSmoothedAt);\n        this.videoSmoothedAt = timestamp;\n        const response = settled ? 1 : 1 - Math.exp(-elapsedMs / smoothing);\n        this.activeSourceTexture = this.drawSmoothing(target, response);\n        this.releaseRetainedVideoFrame();\n        this.blurSourceInto(this.nextAlbumFBO);\n        if (settled)\n            this.videoSmoothingTarget = null;\n    }\n    showVideoFrame(texture) {\n        if (this.videoFrameShown) {\n            this.activeSourceTexture = texture;\n            this.releaseRetainedVideoFrame();\n            this.blurSourceInto(this.nextAlbumFBO);\n        }\n        else {\n            this.videoFrameShown = true;\n            this.shownVideoLoad = this.videoLoadCount;\n            this.processNewImage(texture);\n            // A stopped instance cannot animate the crossfade, so show the frame outright\n            if (!this.isPlaying)\n                this.isTransitioning = false;\n        }\n        if (!this.isPlaying)\n            this.render(this.accumulatedTime);\n    }\n    prepareVideoTargets(videoWidth, videoHeight) {\n        if (!this.videoTargetsStale &&\n            videoWidth === this.videoSourceWidth &&\n            videoHeight === this.videoSourceHeight) {\n            return;\n        }\n        this.releaseVideoTargets();\n        this.videoUploadTexture ??= this.createTexture();\n        const { sampleWidth, sampleHeight, downsampleFactor, smoothing } = this.videoOptions;\n        let width = videoWidth;\n        let height = videoHeight;\n        while (width > sampleWidth * downsampleFactor ||\n            height > sampleHeight * downsampleFactor) {\n            const nextWidth = Math.max(sampleWidth, Math.ceil(width / downsampleFactor));\n            const nextHeight = Math.max(sampleHeight, Math.ceil(height / downsampleFactor));\n            // Rounding up can stop shrinking tiny stages; the final stage covers the rest\n            if (nextWidth === width && nextHeight === height)\n                break;\n            width = nextWidth;\n            height = nextHeight;\n            this.videoStages.push(this.createFramebuffer(width, height, true));\n        }\n        this.videoStages.push(this.createFramebuffer(sampleWidth, sampleHeight, true));\n        if (smoothing > 0) {\n            const float32History = this.highPrecisionInputRequested && this.float32RenderTargets;\n            for (let i = 0; i < 2; i++) {\n                this.videoHistory.push(this.gl2 && float32History\n                    ? this.createSizedFramebuffer(sampleWidth, sampleHeight, this.gl2.RGBA32F)\n                    : this.createFramebuffer(sampleWidth, sampleHeight, true));\n            }\n            const halfFloatHistory = this.gl2\n                ? this.halfFloatRenderTargets\n                : !!(this.halfFloatExt && this.halfFloatLinearExt);\n            this.videoHistoryStep = float32History\n                ? this.float32RenderTargets\n                    ? 0\n                    : 1 / 255\n                : halfFloatHistory\n                    ? 1 / 1024\n                    : 1 / 255;\n        }\n        this.hasVideoHistory = false;\n        this.videoSourceWidth = videoWidth;\n        this.videoSourceHeight = videoHeight;\n        this.videoTargetsStale = false;\n    }\n    /**\n     * Free video render targets. The one the blur currently reads from is\n     * retained so re-blurring keeps working until another source replaces it.\n     */\n    releaseVideoTargets() {\n        for (const target of [...this.videoStages, ...this.videoHistory]) {\n            if (target.texture === this.activeSourceTexture) {\n                this.releaseRetainedVideoFrame();\n                this.retainedVideoFrame = target;\n            }\n            else {\n                this.deleteFramebuffer(target);\n            }\n        }\n        this.videoStages = [];\n        this.videoHistory = [];\n        this.videoSmoothingTarget = null;\n        this.videoTargetsStale = true;\n    }\n    releaseRetainedVideoFrame() {\n        if (!this.retainedVideoFrame ||\n            this.retainedVideoFrame.texture === this.activeSourceTexture) {\n            return;\n        }\n        this.deleteFramebuffer(this.retainedVideoFrame);\n        this.retainedVideoFrame = null;\n    }\n    getSamplingPrograms() {\n        if (this.samplingPrograms)\n            return this.samplingPrograms;\n        const gl = this.gl;\n        const downsample = this.createProgram(VERTEX_SHADER, DOWNSAMPLE_SHADER);\n        const smoothing = this.createProgram(VERTEX_SHADER, SMOOTHING_SHADER);\n        this.samplingPrograms = {\n            downsample,\n            smoothing,\n            downsampleUniforms: {\n                texture: gl.getUniformLocation(downsample, \"u_texture\"),\n                texelSize: gl.getUniformLocation(downsample, \"u_texelSize\"),\n            },\n            smoothingUniforms: {\n                texture: gl.getUniformLocation(smoothing, \"u_texture\"),\n                history: gl.getUniformLocation(smoothing, \"u_history\"),\n                response: gl.getUniformLocation(smoothing, \"u_response\"),\n                minStep: gl.getUniformLocation(smoothing, \"u_minStep\"),\n            },\n        };\n        return this.samplingPrograms;\n    }\n    drawDownsample(source, target) {\n        const gl = this.gl;\n        const programs = this.getSamplingPrograms();\n        gl.useProgram(programs.downsample);\n        this.setupAttributes();\n        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);\n        gl.viewport(0, 0, target.width, target.height);\n        gl.activeTexture(gl.TEXTURE0);\n        gl.bindTexture(gl.TEXTURE_2D, source);\n        gl.uniform1i(programs.downsampleUniforms.texture, 0);\n        gl.uniform2f(programs.downsampleUniforms.texelSize, 1 / target.width, 1 / target.height);\n        gl.drawArrays(gl.TRIANGLES, 0, 6);\n    }\n    drawSmoothing(source, response) {\n        const gl = this.gl;\n        const programs = this.getSamplingPrograms();\n        const history = this.videoHistory[this.videoHistoryIndex];\n        this.videoHistoryIndex = 1 - this.videoHistoryIndex;\n        const target = this.videoHistory[this.videoHistoryIndex];\n        if (!history || !target)\n            return source;\n        gl.useProgram(programs.smoothing);\n        this.setupAttributes();\n        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);\n        gl.viewport(0, 0, target.width, target.height);\n        gl.activeTexture(gl.TEXTURE1);\n        gl.bindTexture(gl.TEXTURE_2D, history.texture);\n        gl.uniform1i(programs.smoothingUniforms.history, 1);\n        gl.activeTexture(gl.TEXTURE0);\n        gl.bindTexture(gl.TEXTURE_2D, source);\n        gl.uniform1i(programs.smoothingUniforms.texture, 0);\n        gl.uniform1f(programs.smoothingUniforms.response, response);\n        gl.uniform1f(programs.smoothingUniforms.minStep, this.videoHistoryStep);\n        gl.drawArrays(gl.TRIANGLES, 0, 6);\n        return target.texture;\n    }\n    /**\n     * Process a new image: blur it and start transition\n     * This is the key optimization - blur only runs here, not every frame!\n     */\n    processNewImage(texture = this.sourceTexture, keepVideo = false) {\n        if (texture === this.sourceTexture && !keepVideo)\n            this.unloadVideo();\n        this.activeSourceTexture = texture;\n        this.releaseRetainedVideoFrame();\n        if (!this.hasImage) {\n            this.blurSourceInto(this.nextAlbumFBO);\n            this.blurSourceInto(this.currentAlbumFBO);\n            this.hasImage = true;\n            this.isTransitioning = false;\n            return;\n        }\n        const previousAlbumFBO = this.currentAlbumFBO;\n        this.currentAlbumFBO = this.nextAlbumFBO;\n        this.nextAlbumFBO = previousAlbumFBO;\n        this.blurSourceInto(this.nextAlbumFBO);\n        this.isTransitioning = true;\n        this.transitionStartTime = performance.now();\n    }\n    /**\n     * Re-blur the current image (used when blurPasses changes)\n     * Updates nextAlbumFBO in place without starting a transition\n     */\n    reblurCurrentImage() {\n        this.blurSourceInto(this.nextAlbumFBO);\n    }\n    /**\n     * Blur the source texture into the target FBO (with tint applied before blur)\n     */\n    blurSourceInto(targetFBO) {\n        const gl = this.gl;\n        // Step 1: Apply tint to source texture \u2192 blurFBO1\n        gl.useProgram(this.tintProgram);\n        this.setupAttributes();\n        gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFBO1.framebuffer);\n        gl.viewport(0, 0, BLUR_SIZE, BLUR_SIZE);\n        gl.activeTexture(gl.TEXTURE0);\n        gl.bindTexture(gl.TEXTURE_2D, this.activeSourceTexture);\n        gl.uniform1i(this.uniforms.tint.texture, 0);\n        gl.uniform3fv(this.uniforms.tint.tintColor, this._tintColor);\n        gl.uniform1f(this.uniforms.tint.tintIntensity, this._tintIntensity);\n        gl.drawArrays(gl.TRIANGLES, 0, 6);\n        // Step 2: Kawase blur passes on the tinted texture\n        gl.useProgram(this.blurProgram);\n        this.setupAttributes();\n        gl.uniform2f(this.uniforms.blur.resolution, BLUR_SIZE, BLUR_SIZE);\n        gl.uniform1i(this.uniforms.blur.texture, 0);\n        let readFBO = this.blurFBO1;\n        let writeFBO = this.blurFBO2;\n        for (let i = 0; i < this._blurPasses; i++) {\n            gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO.framebuffer);\n            gl.viewport(0, 0, BLUR_SIZE, BLUR_SIZE);\n            gl.bindTexture(gl.TEXTURE_2D, readFBO.texture);\n            gl.uniform1f(this.uniforms.blur.offset, i + 0.5);\n            gl.drawArrays(gl.TRIANGLES, 0, 6);\n            const swap = readFBO;\n            readFBO = writeFBO;\n            writeFBO = swap;\n        }\n        // Step 3: Copy final blur result to target FBO\n        gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO.framebuffer);\n        gl.viewport(0, 0, BLUR_SIZE, BLUR_SIZE);\n        gl.bindTexture(gl.TEXTURE_2D, readFBO.texture);\n        gl.uniform1f(this.uniforms.blur.offset, 0.0);\n        gl.drawArrays(gl.TRIANGLES, 0, 6);\n    }\n    resize() {\n        const width = Math.max(1, this.canvas.width);\n        const height = Math.max(1, this.canvas.height);\n        if (this.warpFBO.width !== width || this.warpFBO.height !== height) {\n            if (this.warpFBO)\n                this.deleteFramebuffer(this.warpFBO);\n            this.warpFBO = this.createFramebuffer(width, height, true);\n        }\n    }\n    start() {\n        if (this.disposed || this.isPlaying)\n            return;\n        this.isPlaying = true;\n        this.lastFrameTime = performance.now();\n        if (this.video) {\n            this.video.removeEventListener(\"pause\", this.resumeVideoCallbacks);\n            this.requestVideoFrame();\n            if (this.videoFramePending) {\n                this.videoFramePending = false;\n                this.processVideoFrame(this.lastFrameTime, this.video.currentTime);\n            }\n        }\n        this.animationId = requestAnimationFrame(this.renderLoop);\n    }\n    stop() {\n        this.isPlaying = false;\n        if (this.animationId !== null) {\n            cancelAnimationFrame(this.animationId);\n            this.animationId = null;\n        }\n    }\n    renderFrame(time) {\n        const now = performance.now();\n        if (time !== undefined) {\n            this.render(time, now);\n        }\n        else {\n            const dt = (now - this.lastFrameTime) / 1000;\n            this.lastFrameTime = now;\n            this._animationSpeed +=\n                (this._targetAnimationSpeed - this._animationSpeed) * 0.05;\n            this.accumulatedTime += dt * this._animationSpeed;\n            this.render(this.accumulatedTime, now);\n        }\n    }\n    dispose() {\n        if (this.disposed)\n            return;\n        this.disposed = true;\n        this.stop();\n        this.unloadVideo();\n        const gl = this.gl;\n        if (this.retainedVideoFrame)\n            this.deleteFramebuffer(this.retainedVideoFrame);\n        for (const target of this.sampleTargets)\n            this.deleteFramebuffer(target);\n        if (this.samplingPrograms) {\n            gl.deleteProgram(this.samplingPrograms.downsample);\n            gl.deleteProgram(this.samplingPrograms.smoothing);\n        }\n        this.gl2?.deleteBuffer(this.samplePixelBuffer);\n        gl.deleteProgram(this.blurProgram);\n        gl.deleteProgram(this.blendProgram);\n        gl.deleteProgram(this.tintProgram);\n        gl.deleteProgram(this.warpProgram);\n        gl.deleteProgram(this.outputProgram);\n        gl.deleteBuffer(this.positionBuffer);\n        gl.deleteBuffer(this.texCoordBuffer);\n        gl.deleteTexture(this.sourceTexture);\n        this.deleteFramebuffer(this.blurFBO1);\n        this.deleteFramebuffer(this.blurFBO2);\n        this.deleteFramebuffer(this.currentAlbumFBO);\n        this.deleteFramebuffer(this.nextAlbumFBO);\n        this.deleteFramebuffer(this.warpFBO);\n    }\n    renderLoop = (timestamp) => {\n        if (!this.isPlaying)\n            return;\n        const dt = (timestamp - this.lastFrameTime) / 1000;\n        this.lastFrameTime = timestamp;\n        this._animationSpeed +=\n            (this._targetAnimationSpeed - this._animationSpeed) * 0.05;\n        this.accumulatedTime += dt * this._animationSpeed;\n        this.render(this.accumulatedTime, timestamp);\n        this.animationId = requestAnimationFrame(this.renderLoop);\n    };\n    /**\n     * Main render loop - very efficient!\n     * Just: blend album FBOs \u2192 domain warp \u2192 output\n     */\n    render(time, timestamp = performance.now()) {\n        if (this.disposed || !this.hasImage)\n            return;\n        this.advanceVideoSmoothing(timestamp);\n        const gl = this.gl;\n        const width = Math.max(1, this.canvas.width);\n        const height = Math.max(1, this.canvas.height);\n        if (this.warpFBO.width !== width || this.warpFBO.height !== height) {\n            this.deleteFramebuffer(this.warpFBO);\n            this.warpFBO = this.createFramebuffer(width, height, true);\n        }\n        // Calculate transition blend factor\n        let blendFactor = 1.0;\n        if (this.isTransitioning) {\n            // A source can arrive after this frame's timestamp (video frame callbacks\n            // run before animation frames); a zero duration must not divide into NaN\n            const elapsed = Math.max(0, timestamp - this.transitionStartTime);\n            blendFactor =\n                this._transitionDuration > 0\n                    ? Math.min(1.0, elapsed / this._transitionDuration)\n                    : 1.0;\n            if (blendFactor >= 1.0) {\n                this.isTransitioning = false;\n            }\n        }\n        let currentTexture;\n        if (this.isTransitioning && blendFactor < 1.0) {\n            gl.useProgram(this.blendProgram);\n            this.setupAttributes();\n            gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFBO1.framebuffer);\n            gl.viewport(0, 0, BLUR_SIZE, BLUR_SIZE);\n            gl.activeTexture(gl.TEXTURE0);\n            gl.bindTexture(gl.TEXTURE_2D, this.currentAlbumFBO.texture);\n            gl.uniform1i(this.uniforms.blend.texture1, 0);\n            gl.activeTexture(gl.TEXTURE1);\n            gl.bindTexture(gl.TEXTURE_2D, this.nextAlbumFBO.texture);\n            gl.uniform1i(this.uniforms.blend.texture2, 1);\n            const easedBlend = 0.5 - 0.5 * Math.cos(blendFactor * Math.PI);\n            gl.uniform1f(this.uniforms.blend.blend, easedBlend);\n            gl.drawArrays(gl.TRIANGLES, 0, 6);\n            currentTexture = this.blurFBO1.texture;\n        }\n        else {\n            currentTexture = this.nextAlbumFBO.texture;\n        }\n        // Warp upscales the blended result to full resolution\n        gl.useProgram(this.warpProgram);\n        this.setupAttributes();\n        gl.bindFramebuffer(gl.FRAMEBUFFER, this.warpFBO.framebuffer);\n        gl.viewport(0, 0, width, height);\n        gl.activeTexture(gl.TEXTURE0);\n        gl.bindTexture(gl.TEXTURE_2D, currentTexture);\n        gl.uniform1i(this.uniforms.warp.texture, 0);\n        gl.uniform1f(this.uniforms.warp.time, time);\n        gl.uniform1f(this.uniforms.warp.intensity, this._warpIntensity);\n        gl.drawArrays(gl.TRIANGLES, 0, 6);\n        // Output with saturation and dithering\n        gl.useProgram(this.outputProgram);\n        this.setupAttributes();\n        gl.bindFramebuffer(gl.FRAMEBUFFER, null);\n        gl.viewport(0, 0, width, height);\n        gl.bindTexture(gl.TEXTURE_2D, this.warpFBO.texture);\n        gl.uniform1i(this.uniforms.output.texture, 0);\n        gl.uniform1f(this.uniforms.output.saturation, this._saturation);\n        gl.uniform1f(this.uniforms.output.dithering, this._dithering);\n        gl.uniform1f(this.uniforms.output.time, time);\n        gl.uniform1f(this.uniforms.output.scale, this._scale);\n        gl.uniform2f(this.uniforms.output.resolution, width, height);\n        gl.drawArrays(gl.TRIANGLES, 0, 6);\n    }\n    setupAttributes() {\n        const gl = this.gl;\n        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);\n        gl.enableVertexAttribArray(this.attribs.position);\n        gl.vertexAttribPointer(this.attribs.position, 2, gl.FLOAT, false, 0, 0);\n        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);\n        gl.enableVertexAttribArray(this.attribs.texCoord);\n        gl.vertexAttribPointer(this.attribs.texCoord, 2, gl.FLOAT, false, 0, 0);\n    }\n    createShader(type, source) {\n        const gl = this.gl;\n        const shader = gl.createShader(type);\n        if (!shader)\n            throw new Error(\"Failed to create shader\");\n        gl.shaderSource(shader, this.gl2 && type === gl.FRAGMENT_SHADER\n            ? `precision highp sampler2D;\\n${source}`\n            : source);\n        gl.compileShader(shader);\n        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {\n            const error = gl.getShaderInfoLog(shader);\n            gl.deleteShader(shader);\n            throw new Error(`Shader compile error: ${error}`);\n        }\n        return shader;\n    }\n    createProgram(vertexSource, fragmentSource) {\n        const gl = this.gl;\n        const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexSource);\n        const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentSource);\n        const program = gl.createProgram();\n        if (!program)\n            throw new Error(\"Failed to create program\");\n        gl.attachShader(program, vertexShader);\n        gl.attachShader(program, fragmentShader);\n        gl.linkProgram(program);\n        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {\n            const error = gl.getProgramInfoLog(program);\n            gl.deleteProgram(program);\n            throw new Error(`Program link error: ${error}`);\n        }\n        gl.deleteShader(vertexShader);\n        gl.deleteShader(fragmentShader);\n        return program;\n    }\n    createBuffer(data) {\n        const gl = this.gl;\n        const buffer = gl.createBuffer();\n        if (!buffer)\n            throw new Error(\"Failed to create buffer\");\n        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);\n        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);\n        return buffer;\n    }\n    createTexture() {\n        const gl = this.gl;\n        const texture = gl.createTexture();\n        if (!texture)\n            throw new Error(\"Failed to create texture\");\n        gl.bindTexture(gl.TEXTURE_2D, texture);\n        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);\n        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);\n        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);\n        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);\n        return texture;\n    }\n    createFramebuffer(width, height, useHighPrecision = false) {\n        if (this.gl2) {\n            return this.createSizedFramebuffer(width, height, useHighPrecision && this.halfFloatRenderTargets\n                ? this.gl2.RGBA16F\n                : this.gl2.RGBA8);\n        }\n        const gl = this.gl;\n        const texture = this.createTexture();\n        const canUseHalfFloat = useHighPrecision && this.halfFloatExt && this.halfFloatLinearExt;\n        const type = canUseHalfFloat\n            ? this.halfFloatExt.HALF_FLOAT_OES\n            : gl.UNSIGNED_BYTE;\n        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, type, null);\n        const framebuffer = gl.createFramebuffer();\n        if (!framebuffer)\n            throw new Error(\"Failed to create framebuffer\");\n        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);\n        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);\n        return { framebuffer, texture, width, height };\n    }\n    /**\n     * WebGL2 render target with an explicit internal format. Float formats fall\n     * back to RGBA8 when the driver reports them incomplete.\n     */\n    createSizedFramebuffer(width, height, internalFormat) {\n        const gl = this.gl2;\n        const texture = this.createTexture();\n        const pixelType = internalFormat === gl.RGBA32F\n            ? gl.FLOAT\n            : internalFormat === gl.RGBA16F\n                ? gl.HALF_FLOAT\n                : gl.UNSIGNED_BYTE;\n        if (internalFormat === gl.RGBA32F && !this.floatLinearFiltering) {\n            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);\n            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);\n        }\n        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, pixelType, null);\n        const framebuffer = gl.createFramebuffer();\n        if (!framebuffer)\n            throw new Error(\"Failed to create framebuffer\");\n        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);\n        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);\n        if (internalFormat !== gl.RGBA8 &&\n            gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {\n            if (internalFormat === gl.RGBA32F)\n                this.float32RenderTargets = false;\n            else\n                this.halfFloatRenderTargets = false;\n            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);\n            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);\n            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);\n        }\n        return { framebuffer, texture, width, height };\n    }\n    applyFloatDrawingBuffer() {\n        const gl = this.gl2;\n        if (!gl?.drawingBufferStorage || !this.halfFloatRenderTargets)\n            return;\n        gl.drawingBufferStorage(gl.RGBA16F, Math.max(1, this.canvas.width), Math.max(1, this.canvas.height));\n        this._highPrecisionOutput = gl.drawingBufferFormat === gl.RGBA16F;\n    }\n    deleteFramebuffer(fbo) {\n        this.gl.deleteFramebuffer(fbo.framebuffer);\n        this.gl.deleteTexture(fbo.texture);\n    }\n}\nexport default Kawarp;\n";

let KawarpCtor = null;
let kawarpLoadPromise = null;
let kawarp = null;
let canvas = null;
let lastCoverSrc = null;
let resizeObserver = null;
let playStateBound = false;
let unavailable = false;
let kawarpBlobUrl = null;

function readVisualPlusSettings() {
  try {
    const raw = localStorage.getItem('pn_visual_plus');
    if (!raw) {
      return {
        enabled: false,
        theme: 'shooting_stars',
        liquidSpeed: 100,
        liquidStatic: false,
        blurredSpeed: 100,
        blurredStatic: false,
        colorDiversity: 55,
      };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { enabled: false, theme: 'shooting_stars', liquidSpeed: 100, liquidStatic: false };
    }
    let theme = parsed.theme;
    if (theme === 'liquid_immersive') theme = 'liquid';
    if (theme === 'liquid_gradient') theme = 'blurred';
    // Migrar static/speed compartidos hacia claves propias si faltan
    const liquidStatic = typeof parsed.liquidStatic === 'boolean' ? parsed.liquidStatic : false;
    const liquidSpeed = Number.isFinite(Number(parsed.liquidSpeed)) ? Number(parsed.liquidSpeed) : 100;
    const blurredStatic = typeof parsed.blurredStatic === 'boolean' ? parsed.blurredStatic : false;
    const blurredSpeed = Number.isFinite(Number(parsed.blurredSpeed)) ? Number(parsed.blurredSpeed) : 100;
    return {
      liquidSpeed: 100,
      liquidStatic: false,
      blurredSpeed: 100,
      blurredStatic: false,
      colorDiversity: 55,
      ...parsed,
      theme,
      liquidStatic,
      liquidSpeed,
      blurredStatic,
      blurredSpeed,
    };
  } catch (_) {
    return { enabled: false, theme: 'shooting_stars', liquidSpeed: 100, liquidStatic: false };
  }
}

function isLiquidTheme(settings) {
  return Boolean(settings?.enabled && settings.theme === 'liquid');
}

function getRoot() {
  return document.getElementById('visual-plus-liquid-bg');
}

async function loadKawarpClass() {
  if (unavailable) return null;
  if (KawarpCtor) return KawarpCtor;
  if (kawarpLoadPromise) return kawarpLoadPromise;

  kawarpLoadPromise = (async () => {
    try {
      if (!kawarpBlobUrl) {
        const blob = new Blob([KAWARP_MODULE_SOURCE], { type: 'text/javascript' });
        kawarpBlobUrl = URL.createObjectURL(blob);
      }
      const mod = await import(kawarpBlobUrl);
      KawarpCtor = mod.default || mod.Kawarp || null;
      if (!KawarpCtor) {
        console.warn('[liquid_background] Kawarp export no encontrado');
        unavailable = true;
        return null;
      }
      return KawarpCtor;
    } catch (err) {
      console.warn('[liquid_background] No se pudo cargar Kawarp:', err);
      unavailable = true;
      KawarpCtor = null;
      return null;
    } finally {
      kawarpLoadPromise = null;
    }
  })();

  return kawarpLoadPromise;
}

function ensureCanvas() {
  const root = getRoot();
  if (!root) return null;
  let el = root.querySelector('canvas.liquid-immersive-canvas');
  if (!el) {
    el = document.createElement('canvas');
    el.className = 'liquid-immersive-canvas';
    el.setAttribute('aria-hidden', 'true');
    root.insertBefore(el, root.firstChild);
  }
  canvas = el;
  return el;
}

function disposeKawarp() {
  if (kawarp) {
    try { kawarp.stop(); } catch (_) {}
    try { kawarp.dispose(); } catch (_) {}
    kawarp = null;
  }
}

function resizeCanvas() {
  if (!canvas || !kawarp) return;
  const root = getRoot();
  if (!root) return;
  const rect = root.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    try { kawarp.resize(); } catch (_) {}
  }
}

async function ensureKawarp() {
  const Ctor = await loadKawarpClass();
  if (!Ctor) return null;
  const el = ensureCanvas();
  if (!el) return null;
  if (kawarp) return kawarp;
  try {
    // Velocidad base más visible (Spicy usa ~0.1–1; 0.08 se percibe casi estático)
    kawarp = new Ctor(el, {
      warpIntensity: 1,
      blurPasses: 8,
      animationSpeed: 0.55,
      saturation: 1.5,
      dithering: 0.008,
      transitionDuration: 700,
      tintIntensity: 0.08,
      scale: 1.05,
    });
  } catch (err) {
    console.warn('[liquid_background] WebGL/Kawarp init failed', err);
    kawarp = null;
    return null;
  }
  resizeCanvas();
  if (!resizeObserver && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      try { resizeCanvas(); } catch (_) {}
    });
    const root = getRoot();
    if (root) resizeObserver.observe(root);
  }
  return kawarp;
}

function isAudioPlaying() {
  if (document.body.classList.contains('np-fs-audio-playing')) return true;
  const audio = document.getElementById('audio') || document.querySelector('audio');
  if (audio) return !audio.paused && !audio.ended;
  return false;
}

function liquidAnimationSpeed(settings) {
  if (settings.liquidStatic) return 0.02;
  const pct = Math.max(25, Math.min(200, Number(settings.liquidSpeed) || 100));
  // 25% → ~0.2, 100% → ~0.7, 200% → ~1.35
  const playing = isAudioPlaying();
  const base = playing ? 0.35 : 0.22;
  return base + (0.5 * (pct / 100));
}

function applySpeedFromSettings() {
  const settings = readVisualPlusSettings();
  if (!kawarp) return;
  const speed = liquidAnimationSpeed(settings);
  try {
    if (typeof kawarp.setOptions === 'function') {
      kawarp.setOptions({ animationSpeed: speed });
    } else if ('animationSpeed' in kawarp) {
      kawarp.animationSpeed = speed;
    }
  } catch (_) {}
}

export function syncImmersiveAnimationPlayState() {
  if (!kawarp) return;
  const settings = readVisualPlusSettings();
  if (!isLiquidTheme(settings)) return;
  applySpeedFromSettings();
  try {
    // start() es no-op si ya está playing; reiniciar si estaba parado
    if (typeof kawarp.stop === 'function' && typeof kawarp.start === 'function') {
      // No stop/start cada vez: solo asegurar start
      kawarp.start();
    }
  } catch (_) {}
}

export async function setImmersiveBackgroundActive(active) {
  const root = getRoot();
  if (!root) return;
  const settings = readVisualPlusSettings();
  root.classList.toggle('is-immersive', Boolean(active));
  if (!active) {
    root.classList.remove('is-active-immersive');
    // No quitar is-active si el difuminado lo necesita
    if (settings.theme !== 'blurred') {
      root.classList.remove('is-active');
    }
    disposeKawarp();
    if (canvas) canvas.style.display = 'none';
    return;
  }
  root.classList.add('is-active-immersive');
  root.classList.add('is-active');
  if (canvas) canvas.style.display = 'block';
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const instance = await ensureKawarp();
  if (!instance) {
    root.classList.remove('is-active-immersive');
    if (settings.theme !== 'blurred') root.classList.remove('is-active');
    return;
  }
  resizeCanvas();
  applySpeedFromSettings();
  try { instance.start(); } catch (_) {}
  try {
    if (typeof instance.renderFrame === 'function') instance.renderFrame();
  } catch (_) {}
  syncImmersiveAnimationPlayState();
}

async function loadCoverIntoKawarp(coverSrc) {
  const instance = await ensureKawarp();
  if (!instance || !coverSrc) return;
  try {
    if (coverSrc.startsWith('blob:') || coverSrc.startsWith('data:')) {
      await instance.loadImage(coverSrc);
      return;
    }
    try {
      await instance.loadImage(coverSrc);
      return;
    } catch (_) {}
    try {
      const res = await fetch(coverSrc);
      if (!res.ok) return;
      const blob = await res.blob();
      if (typeof instance.loadBlob === 'function') {
        await instance.loadBlob(blob);
        return;
      }
      const url = URL.createObjectURL(blob);
      try {
        await instance.loadImage(url);
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (err) {
      console.warn('[liquid_background] load cover failed', err);
    }
  } catch (err) {
    console.warn('[liquid_background] loadImage failed', err);
  }
}

export async function syncImmersiveBackgroundFromCover(coverSrc) {
  const settings = readVisualPlusSettings();
  const shouldShow = isLiquidTheme(settings);
  await setImmersiveBackgroundActive(shouldShow);
  if (!shouldShow) return;
  if (!coverSrc) return;
  if (coverSrc === lastCoverSrc && kawarp) {
    applySpeedFromSettings();
    try { kawarp.start(); } catch (_) {}
    return;
  }
  lastCoverSrc = coverSrc;
  await loadCoverIntoKawarp(coverSrc);
  applySpeedFromSettings();
  try { kawarp?.start(); } catch (_) {}
  syncImmersiveAnimationPlayState();
}

export function refreshImmersiveBackgroundState() {
  const settings = readVisualPlusSettings();
  const shouldShow = isLiquidTheme(settings);
  void setImmersiveBackgroundActive(shouldShow).then(() => {
    if (shouldShow && lastCoverSrc) void loadCoverIntoKawarp(lastCoverSrc);
    if (shouldShow) {
      applySpeedFromSettings();
      try { kawarp?.start(); } catch (_) {}
    }
  });
}

function bindPlayStateObservers() {
  if (playStateBound) return;
  playStateBound = true;
  const bodyObs = new MutationObserver(() => {
    try { syncImmersiveAnimationPlayState(); } catch (_) {}
  });
  bodyObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const audio = document.getElementById('audio') || document.querySelector('audio');
  if (audio) {
    ['play', 'pause', 'ended'].forEach((ev) => {
      audio.addEventListener(ev, () => {
        try { syncImmersiveAnimationPlayState(); } catch (_) {}
      });
    });
  }
}

function resolveCurrentCoverSrc() {
  const candidates = [
    document.querySelector('#player-cover img'),
    document.querySelector('.player-cover img'),
    document.querySelector('#lyrics-focus-mini-cover img'),
    document.querySelector('#expanded-cover-img'),
  ];
  for (const img of candidates) {
    const src = img?.currentSrc || img?.src;
    if (src && !src.endsWith('.svg') && src.length > 8) return src;
  }
  return null;
}

export function initLiquidImmersiveBackground() {
  bindPlayStateObservers();
  const settings = readVisualPlusSettings();
  if (!isLiquidTheme(settings)) return;
  void setImmersiveBackgroundActive(true).then(() => {
    const cover = resolveCurrentCoverSrc();
    if (cover) void syncImmersiveBackgroundFromCover(cover);
  });
}

export const initLiquidBackground = initLiquidImmersiveBackground;

document.addEventListener('visibilitychange', () => {
  try {
    if (typeof refreshImmersiveBackgroundState === 'function') {
      refreshImmersiveBackgroundState();
    }
  } catch (_) {}
});
