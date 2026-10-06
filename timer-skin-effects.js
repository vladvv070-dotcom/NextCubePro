/* SVG and text-based skins adapted to the timer's live digits. */
(function () {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const CHARACTER_SKINS = new Set(['neon-sign', 'corgo-bounce', 'shimmering-neon']);

    function makeSvg(name, attributes = {}) {
        const node = document.createElementNS(SVG_NS, name);
        Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
        return node;
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    }

    const TimerSkinEffects = {
        activeId: null,
        display: null,
        flowOverlay: null,
        svgDefs: null,
        observer: null,
        fontObserver: null,
        generatedMarkup: false,

        apply(id, display) {
            if (!display) return;
            if (this.display !== display) {
                this.observer?.disconnect();
                this.display = display;
                this.observer = new MutationObserver(() => this.sync());
                this.observer.observe(display, { childList: true, characterData: true, subtree: true });
                this.fontObserver?.disconnect();
                this.fontObserver = new MutationObserver(() => this.sync());
                this.fontObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-font'] });
            }
            const nextId = id || null;
            if (this.activeId !== nextId) {
                this._clearGeneratedMarkup();
                this._removeFlowSvg();
                this.activeId = nextId;
            }
            this.sync();
        },

        _clearGeneratedMarkup() {
            if (this.generatedMarkup && this.display) {
                const plain = this.display.textContent || '';
                this.generatedMarkup = false;
                this.display.textContent = plain;
            }
        },

        sync() {
            const display = this.display;
            if (!display) return;
            if (CHARACTER_SKINS.has(this.activeId)) this._renderCharacters();
            else this._clearGeneratedMarkup();

            if (this.activeId === 'flowing-gradient') this._ensureFlowSvg();
            else this._removeFlowSvg();

            if (this.activeId === 'spectrum-glow') this._ensureGlowFilter();
            else this._removeGlowFilter();
        },

        _renderCharacters() {
            const display = this.display;
            const source = display.textContent || '';
            if (this.generatedMarkup && display.dataset.timerSkinText === source) return;
            const id = this.activeId;
            const chars = Array.from(source);
            const content = chars.map((char, index) => {
                const classes = ['timer-skin-char'];
                if (id === 'corgo-bounce') classes.push('skin-corgo-char');
                if (id === 'neon-sign') {
                    classes.push('skin-neon-char');
                    if (index === 0) classes.push('fast-flicker');
                    if (index === Math.max(0, chars.length - 3)) classes.push('flicker');
                }
                if (id === 'shimmering-neon') classes.push('skin-shimmer-char');
                const value = char === ' ' ? '&nbsp;' : escapeHtml(char);
                return `<span class="${classes.join(' ')}" data-char="${escapeHtml(char)}" style="--char-index:${index}">${value}</span>`;
            }).join('');

            this.generatedMarkup = true;
            display.dataset.timerSkinText = source;
            if (id === 'shimmering-neon') {
                display.innerHTML = `<span class="timer-skin-shimmer-wrap"><span class="timer-skin-shimmer-text" data-text="${escapeHtml(source)}">${content}</span></span>`;
            } else {
                display.innerHTML = content;
            }
        },

        _ensureFlowSvg() {
            const container = this.display.closest('.timer-container');
            if (!container) return;
            const displayStyle = getComputedStyle(this.display);
            if (this.flowOverlay?.isConnected) {
                const text = this.flowOverlay.querySelector('text');
                if (text && text.textContent !== this.display.textContent) text.textContent = this.display.textContent || '';
                if (text) {
                    const fontScale = 1000 / Math.max(1, container.clientWidth);
                    text.setAttribute('font-family', displayStyle.fontFamily);
                    text.setAttribute('font-size', parseFloat(displayStyle.fontSize) * fontScale);
                    text.setAttribute('font-weight', displayStyle.fontWeight);
                    text.setAttribute('letter-spacing', (parseFloat(displayStyle.letterSpacing) || 0) * fontScale);
                }
                return;
            }
            const svg = makeSvg('svg', { class: 'timer-skin-svg-overlay', viewBox: '0 0 1000 300', preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' });
            const defs = makeSvg('defs');
            const gradient = makeSvg('linearGradient', { id: 'timer-flow-gradient', x1: '0%', y1: '0%', x2: '100%', y2: '0%' });
            [['0%', '#33235b'], ['25%', '#D62229'], ['50%', '#E97639'], ['75%', '#792042'], ['100%', '#33235b']].forEach(([offset, color]) => gradient.appendChild(makeSvg('stop', { offset, 'stop-color': color })));
            const pattern = makeSvg('pattern', { id: 'timer-flow-pattern', x: 0, y: 0, width: 1200, height: 300, patternUnits: 'userSpaceOnUse' });
            const first = makeSvg('rect', { x: 0, y: 0, width: 600, height: 300, fill: 'url(#timer-flow-gradient)' });
            const firstMove = makeSvg('animate', { attributeName: 'x', from: 0, to: 600, dur: '7s', repeatCount: 'indefinite' });
            const second = makeSvg('rect', { x: -600, y: 0, width: 600, height: 300, fill: 'url(#timer-flow-gradient)' });
            const secondMove = makeSvg('animate', { attributeName: 'x', from: -600, to: 0, dur: '7s', repeatCount: 'indefinite' });
            first.appendChild(firstMove);
            second.appendChild(secondMove);
            pattern.append(first, second);
            defs.append(gradient, pattern);
            const fontScale = 1000 / Math.max(1, container.clientWidth);
            const text = makeSvg('text', { x: '50%', y: '50%', dy: '.35em', 'text-anchor': 'middle', fill: 'url(#timer-flow-pattern)', 'font-family': displayStyle.fontFamily, 'font-size': parseFloat(displayStyle.fontSize) * fontScale, 'font-weight': displayStyle.fontWeight, 'letter-spacing': (parseFloat(displayStyle.letterSpacing) || 0) * fontScale });
            text.textContent = this.display.textContent || '';
            svg.append(defs, text);
            container.appendChild(svg);
            this.flowOverlay = svg;
        },

        _removeFlowSvg() {
            this.flowOverlay?.remove();
            this.flowOverlay = null;
        },

        _ensureGlowFilter() {
            if (this.svgDefs?.isConnected) return;
            const container = this.display.closest('.timer-container');
            if (!container) return;
            const svg = makeSvg('svg', { class: 'timer-skin-svg-defs', width: 0, height: 0, 'aria-hidden': 'true' });
            const filter = makeSvg('filter', { id: 'timer-spectrum-glow', x: '-50%', y: '-200%', width: '200%', height: '500%' });
            filter.append(makeSvg('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: 5, result: 'blurred' }));
            filter.append(makeSvg('feBlend', { in: 'SourceGraphic', in2: 'blurred', result: 'glow' }));
            filter.append(makeSvg('feColorMatrix', { in: 'glow', type: 'saturate', values: 1.3, result: 'saturated' }));
            filter.append(makeSvg('feBlend', { in: 'SourceGraphic', in2: 'saturated' }));
            svg.appendChild(filter);
            container.appendChild(svg);
            this.svgDefs = svg;
        },

        _removeGlowFilter() {
            this.svgDefs?.remove();
            this.svgDefs = null;
        }
    };

    window.TimerSkinEffects = TimerSkinEffects;

    /* The supplied advanced example's WebGL flow-map and image shader, scoped to a text preview. */
    window.FluidTextHover = {
        instances: new WeakMap(),
        vertex: `attribute vec2 uv; attribute vec2 position; varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,0,1); }`,
        fragment: `precision highp float; precision highp int; uniform sampler2D tWater; uniform sampler2D tFlow; uniform float uTime; varying vec2 vUv; uniform vec4 res; uniform vec2 img; void main(){ vec3 flow=texture2D(tFlow,vUv).rgb; vec2 uv=.5*gl_FragCoord.xy/res.xy; vec2 myUV=(uv-vec2(.5))*res.zw+vec2(.5); myUV-=flow.xy*(.15*1.2); vec2 myUV2=(uv-vec2(.5))*res.zw+vec2(.5); myUV2-=flow.xy*(.125*1.2); vec2 myUV3=(uv-vec2(.5))*res.zw+vec2(.5); myUV3-=flow.xy*(.10*1.4); vec3 tex=texture2D(tWater,myUV).rgb; vec3 tex2=texture2D(tWater,myUV2).rgb; vec3 tex3=texture2D(tWater,myUV3).rgb; gl_FragColor=vec4(tex.r,tex2.g,tex3.b,1.); }`,
        mount(host, textSource) {
            if (!host || !window.ogl) return false;
            const existing = this.instances.get(host);
            if (existing) {
                existing.updateMask(textSource);
                return true;
            }
            const { Renderer, Vec2, Vec4, Geometry, Texture, Program, Mesh, Flowmap } = window.ogl;
            let renderer, flowmap, program, mesh, resizeObserver, frameId, disposed = false;
            try {
                renderer = new Renderer({ dpr: Math.min(window.devicePixelRatio || 1, 2), alpha: true });
                const gl = renderer.gl;
                const canvas = gl.canvas;
                canvas.className = 'fluid-text-hover-canvas';
                host.appendChild(canvas);
                let aspect = 1;
                const mouse = new Vec2(-1);
                const velocity = new Vec2();
                let lastTime = 0;
                const lastMouse = new Vec2();
                let a1 = 1, a2 = 1;
                const imageAspect = 1638 / 2048;
                const resize = () => {
                    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
                    if (height / width < imageAspect) { a1 = 1; a2 = height / width / imageAspect; }
                    else { a1 = width / height * imageAspect; a2 = 1; }
                    renderer.setSize(width, height);
                    aspect = width / height;
                    if (program) program.uniforms.res.value = new Vec4(width, height, a1, a2);
                };
                flowmap = new Flowmap(gl, { falloff: .3, dissipation: .92, alpha: .5 });
                const geometry = new Geometry(gl, { position: { size: 2, data: new Float32Array([-1,-1,3,-1,-1,3]) }, uv: { size: 2, data: new Float32Array([0,0,2,0,0,2]) } });
                const texture = new Texture(gl, { minFilter: gl.LINEAR, magFilter: gl.LINEAR });
                const img = new Image();
                img.crossOrigin = 'Anonymous';
                img.onload = () => { texture.image = img; };
                img.src = 'https://robindelaporte.fr/codepen/bg3.jpg';
                program = new Program(gl, { vertex: this.vertex, fragment: this.fragment, uniforms: { uTime: { value: 0 }, tWater: { value: texture }, res: { value: new Vec4(host.clientWidth, host.clientHeight, a1, a2) }, img: { value: new Vec2(1638, 2048) }, tFlow: flowmap.uniform } });
                mesh = new Mesh(gl, { geometry, program });
                resize();
                resizeObserver = new ResizeObserver(resize);
                resizeObserver.observe(host);
                const updatePointer = event => {
                    const rect = host.getBoundingClientRect();
                    const x = event.clientX - rect.left, y = event.clientY - rect.top;
                    mouse.set(x / Math.max(1, rect.width), 1 - y / Math.max(1, rect.height));
                    if (!lastTime) { lastTime = performance.now(); lastMouse.set(x, y); }
                    const now = performance.now(), delta = Math.max(10.4, now - lastTime);
                    velocity.x = (x - lastMouse.x) / delta;
                    velocity.y = (y - lastMouse.y) / delta;
                    lastMouse.set(x, y);
                    lastTime = now;
                    velocity.needsUpdate = true;
                };
                host.addEventListener('pointermove', updatePointer, { passive: true });
                const update = time => {
                    if (disposed) return;
                    frameId = requestAnimationFrame(update);
                    if (!velocity.needsUpdate) { mouse.set(-1); velocity.set(0); }
                    velocity.needsUpdate = false;
                    flowmap.aspect = aspect;
                    flowmap.mouse.copy(mouse);
                    flowmap.velocity.lerp(velocity, velocity.len ? .15 : .1);
                    flowmap.update();
                    program.uniforms.uTime.value = time * .01;
                    renderer.render({ scene: mesh });
                };
                frameId = requestAnimationFrame(update);
                const updateMask = source => {
                    const rect = host.getBoundingClientRect();
                    const width = Math.max(1, Math.round(rect.width)), height = Math.max(1, Math.round(rect.height));
                    const style = getComputedStyle(textSource);
                    const viewHeight = Math.round(height * 1000 / width);
                    const fontSize = parseFloat(style.fontSize || '96') * 1000 / width;
                    const letterSpacing = parseFloat(style.letterSpacing || '0') * 1000 / width;
                    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${viewHeight}" viewBox="0 0 1000 ${viewHeight}"><text x="500" y="${viewHeight / 2}" text-anchor="middle" dominant-baseline="central" fill="white" font-family="${escapeHtml(style.fontFamily || 'sans-serif')}" font-size="${fontSize}" font-weight="${style.fontWeight || 700}" letter-spacing="${letterSpacing}">${escapeHtml(source || '')}</text></svg>`;
                    const data = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
                    canvas.style.maskImage = data;
                    canvas.style.webkitMaskImage = data;
                    canvas.style.maskSize = '100% 100%';
                    canvas.style.webkitMaskSize = '100% 100%';
                };
                const textObserver = new MutationObserver(() => updateMask(textSource.textContent));
                textObserver.observe(textSource, { childList: true, characterData: true, subtree: true });
                const fontObserver = new MutationObserver(() => updateMask(textSource.textContent));
                fontObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-font'] });
                this.instances.set(host, { canvas, updateMask: () => updateMask(textSource.textContent), dispose: () => { disposed = true; cancelAnimationFrame(frameId); resizeObserver?.disconnect(); textObserver.disconnect(); fontObserver.disconnect(); host.removeEventListener('pointermove', updatePointer); canvas.remove(); gl.getExtension('WEBGL_lose_context')?.loseContext(); } });
                updateMask(textSource.textContent);
                return true;
            } catch (error) {
                renderer?.gl?.getExtension('WEBGL_lose_context')?.loseContext();
                host.querySelector('.fluid-text-hover-canvas')?.remove();
                return false;
            }
        },
        unmount(host) {
            const instance = host && this.instances.get(host);
            instance?.dispose();
            if (host) this.instances.delete(host);
        }
    };
})();
