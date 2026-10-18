/* Lightweight native-WebGL first-person renderer. No external runtime required. */
(() => {
  const COLORS = {
    wall: { 1: [0.69, 0.62, 0.49], 2: [0.31, 0.49, 0.43], 3: [0.48, 0.34, 0.20], 4: [0.56, 0.31, 0.23] },
    floor: [[0.49, 0.48, 0.39], [0.53, 0.52, 0.43], [0.46, 0.46, 0.38]],
  };
  const vertexShader = `attribute vec3 aPosition; attribute vec3 aColor; uniform mat4 uViewProjection; varying vec3 vColor; varying float vFog; uniform vec3 uCamera; void main(){ vec4 p=uViewProjection*vec4(aPosition,1.0); gl_Position=p; vColor=aColor; float d=distance(aPosition,uCamera); vFog=clamp((d-13.0)/36.0,0.0,0.72); }`;
  const fragmentShader = `precision mediump float; varying vec3 vColor; varying float vFog; void main(){ vec3 fog=vec3(0.53,0.65,0.68); gl_FragColor=vec4(mix(vColor,fog,vFog),1.0); }`;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
  const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const norm = (a) => { const n=Math.hypot(...a)||1; return a.map(v=>v/n); };

  function makeMatrix(eye, target, aspect) {
    const z=norm(sub(eye,target)), x=norm(cross([0,1,0],z)), y=cross(z,x);
    const view=new Float32Array([
      x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
      -dot(x,eye),-dot(y,eye),-dot(z,eye),1,
    ]);
    const f=1/Math.tan(Math.PI/7.2), near=.06, far=100;
    const p=new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)/(near-far),-1, 0,0,(2*far*near)/(near-far),0]);
    const out=new Float32Array(16);
    for(let c=0;c<4;c++) for(let r=0;r<4;r++) out[c*4+r]=p[r]*view[c*4]+p[4+r]*view[c*4+1]+p[8+r]*view[c*4+2]+p[12+r]*view[c*4+3];
    return out;
  }

  function init(canvas, map) {
    const gl=canvas.getContext('webgl',{alpha:false,antialias:true}) || canvas.getContext('experimental-webgl');
    if(!gl) return null;
    function shader(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
    const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertexShader));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragmentShader));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)) return null;
    const posLoc=gl.getAttribLocation(program,'aPosition'), colorLoc=gl.getAttribLocation(program,'aColor');
    const matrixLoc=gl.getUniformLocation(program,'uViewProjection'), cameraLoc=gl.getUniformLocation(program,'uCamera');
    const staticBuffer=gl.createBuffer(), dynamicBuffer=gl.createBuffer();
    const vertices=[];
    function tri(a,b,c,color){for(const p of [a,b,c])vertices.push(p[0],p[1],p[2],color[0],color[1],color[2]);}
    function quad(a,b,c,d,color){tri(a,b,c,color);tri(a,c,d,color);}
    function box(x,y,z,w,h,d,color){
      const x0=x-w/2,x1=x+w/2,y0=y,y1=y+h,z0=z-d/2,z1=z+d/2;
      const shade=(k)=>color.map(v=>Math.min(1,v*k));
      quad([x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[x1,y0,z0],shade(.76));
      quad([x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[x0,y0,z1],shade(.88));
      quad([x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[x0,y0,z0],shade(.68));
      quad([x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1],shade(.92));
      quad([x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],color);
      quad([x0,y0,z1],[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],shade(.62));
    }
    // Tiled ground with subtle variation and actual solid wall volumes.
    for(let z=0;z<map.height;z++) for(let x=0;x<map.width;x++){
      const tile=map.grid[z][x];
      if(!tile){const c=COLORS.floor[(x*7+z*11)%COLORS.floor.length];quad([x,0,z],[x,0,z+1],[x+1,0,z+1],[x+1,0,z],c);}
      else box(x+.5,0,z+.5,1,3.45,1,COLORS.wall[tile]||COLORS.wall[1]);
    }
    // Low polygon market props add depth and scale to the lanes.
    for(const prop of map.props||[]){
      const x=prop.x,z=prop.y,s=prop.size||1;
      if(prop.type==='barrel') box(x,.0,z,.48*s,.78*s,.48*s,[.42,.27,.15]);
      else if(prop.type==='planter') {box(x,0,z,.85*s,.45*s,.6*s,[.48,.4,.29]);box(x,.45*s,z,.72*s,.5*s,.5*s,[.22,.38,.2]);}
      else if(prop.type==='tree') {box(x,0,z,.22,.9,.22,[.32,.22,.13]);box(x,.8,z,.92,.8,.92,[.2,.36,.17]);box(x,1.25,z,.68,.7,.7,[.29,.44,.2]);}
      else if(prop.type==='stall'||prop.type==='umbrella') {box(x,.85,z,1.25,.12,.8,[.64,.34,.24]);box(x,.0,z,.12,.9,.12,[.35,.25,.16]);}
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,staticBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
    const staticCount=vertices.length/6;

    function drawBuffer(buffer,count,usage){
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.enableVertexAttribArray(posLoc);gl.vertexAttribPointer(posLoc,3,gl.FLOAT,false,24,0);
      gl.enableVertexAttribArray(colorLoc);gl.vertexAttribPointer(colorLoc,3,gl.FLOAT,false,24,12);
      gl.drawArrays(gl.TRIANGLES,0,count);
    }
    function render(player, actors, pitch, width, height){
      const dpr=Math.min(window.devicePixelRatio||1,1.4);
      const w=Math.max(1,Math.floor(width*dpr)),h=Math.max(1,Math.floor(height*dpr));
      if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;canvas.style.width=width+'px';canvas.style.height=height+'px';}
      gl.viewport(0,0,w,h);gl.clearColor(.42,.61,.69,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.useProgram(program);
      const yaw=player.angle, cp=Math.cos(pitch), eye=[player.x,1.66+(player.alive?0: -.5),player.y];
      const dir=[Math.cos(yaw)*cp,Math.sin(pitch),Math.sin(yaw)*cp];
      gl.uniformMatrix4fv(matrixLoc,false,makeMatrix(eye,[eye[0]+dir[0],eye[1]+dir[1],eye[2]+dir[2]],w/h));
      gl.uniform3fv(cameraLoc,eye);
      drawBuffer(staticBuffer,staticCount,gl.STATIC_DRAW);
      const dyn=[];
      function addBox(x,y,z,wid,hei,dep,c){
        const start=vertices.length;box(x,y,z,wid,hei,dep,c);dyn.push(...vertices.splice(start));
      }
      // Render readable, shaded low-poly operators from either team.
      for(const a of actors||[]){if(!a||!a.alive||Math.hypot(a.x-player.x,a.y-player.y)>31)continue;
        const blue=a.team==='CT', uniform=blue?[.23,.39,.43]:[.49,.29,.24], trim=blue?[.34,.65,.76]:[.91,.43,.31];
        addBox(a.x,.08,a.y,.34,.48,.28,[.12,.14,.14]); // boots
        addBox(a.x,.55,a.y,.55,.66,.34,uniform);
        addBox(a.x,.82,a.y-.035,.43,.24,.37,trim);
        addBox(a.x,1.31,a.y,.31,.31,.31,[.58,.42,.31]);
        addBox(a.x,1.48,a.y,.37,.12,.36,[.15,.18,.17]); // helmet
        addBox(a.x+.3,1.01,a.y,.48,.12,.12,[.12,.14,.14]); // rifle
      }
      // Reuse the scene buffer for dynamic geometry; it is rebuilt only for actors.
      if(dyn.length){const arr=new Float32Array(dyn);gl.bindBuffer(gl.ARRAY_BUFFER,dynamicBuffer);gl.bufferData(gl.ARRAY_BUFFER,arr,gl.DYNAMIC_DRAW);drawBuffer(dynamicBuffer,arr.length/6,gl.DYNAMIC_DRAW);}
    }
    return {render,gl};
  }
  window.Rift3D={init};
})();
