/* Liquid metal shader renderer adapted from Cintzel Ultimate Metal FX (MIT); see third-party-licenses/. */
(() => {
    const vertexShader = `
        attribute vec2 position;
        varying vec2 v_uv;
        void main(){ v_uv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }
    `;
    const fragmentShader = `
        precision mediump float;
        uniform float u_time; uniform vec2 u_mouse; uniform vec2 u_resolution;
        uniform float u_scale; uniform float u_complexity; uniform float u_contrast;
        uniform float u_flow_type; uniform float u_hue_shift; uniform float u_light_mode;
        uniform sampler2D u_gradient; uniform sampler2D u_mask; varying vec2 v_uv;
        mat2 rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}
        vec3 hueShift(vec3 color,float hue){const vec3 k=vec3(.57735);float c=cos(hue),s=sin(hue);return color*c+cross(k,color)*s+k*dot(k,color)*(1.-c);}
        float wavePattern(vec2 p){float h=0.,amp=.5,freq=1.;mat2 r=rot(u_complexity*.5);vec2 d=vec2(1.,.5);for(int i=0;i<4;i++){h+=sin(dot(p,d)*freq+u_time)*amp;d=r*d;p*=1.4;amp*=.6;}return h;}
        float ripplePattern(vec2 p){float h=0.;vec2 p2=p;for(int i=1;i<5;i++){float fi=float(i);vec2 center=vec2(sin(u_time*.4*fi),cos(u_time*.25*fi))*3.;float dist=length(p2-center);h+=sin(dist*(5.+u_complexity)-u_time*2.5)*(.4/fi);p2=rot(.8)*p2;}return h;}
        float chaosPattern(vec2 p){float h=0.;for(float i=1.;i<4.;i++){p.x+=sin(p.y*u_complexity+u_time*.5);p.y+=cos(p.x*u_complexity+u_time*.5);h+=sin(p.x*i+p.y*i);}return h*.4;}
        float getLiquidHeight(vec2 p){if(u_flow_type<.5)return wavePattern(p);else if(u_flow_type<1.5)return ripplePattern(p);return chaosPattern(p);}
        void main(){
          float alpha=texture2D(u_mask,v_uv).a;if(alpha<.004)discard;
          vec2 p=v_uv*2.-1.;float aspect=u_resolution.x/max(1.,u_resolution.y);p.x*=aspect;
          vec2 m=u_mouse*2.-1.;m.x*=aspect;float dist=length(p-m);float force=(1.-smoothstep(0.,.5,dist))*.2;p-=(p-m)*force;
          float h=getLiquidHeight(p*u_scale);vec2 eps=vec2(.01,0.);float hx=getLiquidHeight((p+eps.xy)*u_scale)-h;float hy=getLiquidHeight((p+eps.yx)*u_scale)-h;
          vec3 normal=normalize(vec3(-hx*6.,-hy*6.,.5));vec3 lightDir=normalize(vec3(-.5,1.,1.));vec3 viewDir=vec3(0.,0.,1.);vec3 halfDir=normalize(lightDir+viewDir);
          float spec=pow(max(dot(normal,halfDir),0.),50.*max(.01,u_contrast));float angle=dot(normal.xy,vec2(1.))*.5+.5;float coord=angle+h*.05;
          vec3 col=texture2D(u_gradient,vec2(coord,.5)).rgb;if(u_hue_shift>0.)col=hueShift(col,u_hue_shift);col+=vec3(spec);col*=smoothstep(-.3,.7,h*.5+.5);
          if(u_light_mode>.5)col=mix(col,vec3(1.)-col,.15);
          gl_FragColor=vec4(col,alpha);
        }
    `;
    const presets = () => window.LEGENDARY_METAL_PRESETS || [];
    class LegendaryMetalRenderer {
        constructor(){this.gl=null;this.program=null;this.host=null;this.maskElement=null;this.canvas=null;this.maskCanvas=document.createElement('canvas');this.maskContext=this.maskCanvas.getContext('2d');this.maskTexture=null;this.gradientTexture=null;this.frame=0;this.config=null;this.currentPhysics=null;this.targetMouse={x:.5,y:.5};this.currentMouse={x:.5,y:.5};this.maskStamp='';this.previewText=null;this.failure=null;this._move=e=>this._pointerMove(e);this._resize=()=>this._resizeCanvas();}
        _shader(type,source){const gl=this.gl,s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)||'Shader compilation failed');return s;}
        _init(){
            if(this.gl)return true;
            this.canvas=document.createElement('canvas');this.canvas.className='legendary-metal-canvas';this.canvas.setAttribute('aria-hidden','true');
            this.gl=this.canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:false})||this.canvas.getContext('experimental-webgl',{alpha:true,antialias:true});
            if(!this.gl)throw new Error('WebGL is not available');
            const gl=this.gl;this.program=gl.createProgram();gl.attachShader(this.program,this._shader(gl.VERTEX_SHADER,vertexShader));gl.attachShader(this.program,this._shader(gl.FRAGMENT_SHADER,fragmentShader));gl.linkProgram(this.program);
            if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program)||'Shader link failed');
            gl.useProgram(this.program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
            const pos=gl.getAttribLocation(this.program,'position');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
            this.maskTexture=this._texture();this.gradientTexture=this._texture();
            gl.uniform1i(gl.getUniformLocation(this.program,'u_mask'),0);gl.uniform1i(gl.getUniformLocation(this.program,'u_gradient'),1);
            gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(0,0,0,0);
            this._makeGradientTexture();return true;
        }
        _texture(){const gl=this.gl,t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;}
        _makeGradientTexture(){const gl=this.gl,c=document.createElement('canvas');c.width=512;c.height=1;const ctx=c.getContext('2d'),colors=this.config?.colors?.length?this.config.colors:['#111','#222','#333','#000','#101'];const gradient=ctx.createLinearGradient(0,0,c.width,0);colors.forEach((color,i)=>gradient.addColorStop(i/Math.max(1,colors.length-1),color));ctx.fillStyle=gradient;ctx.fillRect(0,0,c.width,1);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.gradientTexture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);}
        setConfig(config){const next=JSON.stringify(config);if(next===this.configStamp)return;this.configStamp=next;this.config=JSON.parse(next);const p=this._preset();this.targetPhysics={scale:Number(this.config.scale??p.physics.scale),complexity:Number(this.config.complexity??p.physics.complexity),contrast:Number(this.config.contrast??p.physics.contrast),flow:Number(this.config.flow??p.physics.flow)};if(!this.currentPhysics)this.currentPhysics={...this.targetPhysics};if(this.gl)this._makeGradientTexture();}
        _preset(){return presets().find(p=>p.name===this.config?.presetName)||presets().find(p=>p.name==='Obsidian')||presets()[0];}
        mount(host,maskElement,config,previewText=null){try{this._init();if(this.host&&this.host!==host){this.host.removeEventListener('pointermove',this._move);this.host.classList.remove('legendary-metal-host');}this.host=host;this.maskElement=maskElement;this.previewText=previewText;this.setConfig(config);if(this.canvas.parentElement!==host)host.appendChild(this.canvas);host.classList.add('legendary-metal-host');window.addEventListener('resize',this._resize);host.removeEventListener('pointermove',this._move);host.addEventListener('pointermove',this._move);this._resizeCanvas();this._refreshMask(true);if(!this.frame)this.frame=requestAnimationFrame(t=>this._draw(t));return true;}catch(error){console.error('Metal FX could not start:',error);this.failure=error;this.unmount();return false;}}
        unmount(){if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;window.removeEventListener('resize',this._resize);this.host?.removeEventListener('pointermove',this._move);this.host?.classList.remove('legendary-metal-host');this.canvas?.remove();this.host=null;this.maskElement=null;this.previewText=null;this.maskStamp='';this.configStamp='';}
        _uniform1f(name,value){const gl=this.gl;gl.uniform1f(gl.getUniformLocation(this.program,name),value);}
        _uniform2f(name,x,y){const gl=this.gl;gl.uniform2f(gl.getUniformLocation(this.program,name),x,y);}
        _resizeCanvas(){if(!this.host||!this.gl)return;const r=this.host.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2),w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;this.canvas.style.width=`${r.width}px`;this.canvas.style.height=`${r.height}px`;this.gl.viewport(0,0,w,h);this.maskStamp='';this._refreshMask(true);}}
        _refreshMask(force=false){if(!this.host||!this.maskElement||!this.gl)return;const r=this.host.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2),w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr)),cs=getComputedStyle(this.maskElement),isCountdown=this.maskElement.classList.contains('inspection-countdown'),text=this.previewText??this.maskElement.textContent.trim(),stamp=[text,w,h,cs.font,cs.letterSpacing,cs.textAlign,cs.lineHeight,isCountdown].join('|');if(!force&&stamp===this.maskStamp)return;this.maskStamp=stamp;this.maskCanvas.width=w;this.maskCanvas.height=h;const ctx=this.maskContext;ctx.clearRect(0,0,w,h);if(!isCountdown){ctx.setTransform(dpr,0,0,dpr,0,0);ctx.font=cs.font||`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;ctx.textAlign=cs.textAlign==='left'?'left':cs.textAlign==='right'?'right':'center';ctx.textBaseline='middle';if('letterSpacing' in ctx)ctx.letterSpacing=cs.letterSpacing;ctx.fillStyle='#fff';ctx.fillText(text,ctx.textAlign==='left'?0:ctx.textAlign==='right'?r.width:r.width/2,r.height/2);}const gl=this.gl;gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.maskTexture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.maskCanvas);}
        _pointerMove(e){const r=this.host?.getBoundingClientRect();if(!r)return;this.targetMouse.x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));this.targetMouse.y=1-Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));}
        _draw(now){if(!this.gl||!this.host)return;this.frame=requestAnimationFrame(t=>this._draw(t));this._resizeCanvas();this._refreshMask();const gl=this.gl,c=this.config||{},p=this._preset(),speed=matchMedia('(prefers-reduced-motion: reduce)').matches?0:Math.max(0,Number(c.speed??.5));this.currentPhysics=this.currentPhysics||{...p.physics};for(const key of ['scale','complexity','contrast'])this.currentPhysics[key]+=(Number(c[key]??p.physics[key])-this.currentPhysics[key])*.05;
            gl.useProgram(this.program);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.maskTexture);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.gradientTexture);
            this._uniform1f('u_time',now*.001*speed);this._uniform1f('u_scale',this.currentPhysics.scale);this._uniform1f('u_complexity',this.currentPhysics.complexity);this._uniform1f('u_contrast',this.currentPhysics.contrast);this._uniform1f('u_flow_type',Number(c.flow??p.physics.flow));this._uniform1f('u_hue_shift',Number(c.hue??0));this._uniform1f('u_light_mode',c.lightMode?1:0);this.currentMouse.x+=(this.targetMouse.x-this.currentMouse.x)*.05;this.currentMouse.y+=(this.targetMouse.y-this.currentMouse.y)*.05;this._uniform2f('u_mouse',this.currentMouse.x,this.currentMouse.y);this._uniform2f('u_resolution',this.canvas.width,this.canvas.height);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);}
    }
    window.LegendaryMetalFx = new LegendaryMetalRenderer();
})();
