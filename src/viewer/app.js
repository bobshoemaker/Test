// Brickhouse viewer: rendering, manual, parts, design editor, photo jobs.
// Needs three.js r128 (global THREE) and src/engine/engine.js (global compile, COLORS).
const $=id=>document.getElementById(id);
const canvas=$('cv'), stage=$('stage');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
renderer.outputEncoding=THREE.sRGBEncoding;
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate=false; // redrawn when bricks change, not every frame: the sun doesn't move with the camera
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(30,1,0.5,600);
const hemi=new THREE.HemisphereLight(0xffffff,0x8a97a8,0.62); scene.add(hemi);
const sun=new THREE.DirectionalLight(0xffffff,0.78); sun.position.set(18,38,26); sun.castShadow=true;
const small=Math.min(window.innerWidth,window.innerHeight)<700;
sun.shadow.mapSize.set(small?1024:2048,small?1024:2048);
Object.assign(sun.shadow.camera,{left:-26,right:26,top:26,bottom:-26,near:1,far:120}); sun.shadow.bias=-0.0006; sun.shadow.normalBias=0.02;
scene.add(sun);
const fill=new THREE.DirectionalLight(0xffffff,0.2); fill.position.set(-28,18,-18); scene.add(fill);

const lin=hex=>new THREE.Color(hex).convertSRGBToLinear();
// several shapes, each placed by an optional matrix, as one geometry: one draw call instead of many
function mergeGeos(items){ const pos=[], nor=[];
  for(const [geo,m] of items){ const g=geo.index?geo.toNonIndexed():geo.clone(); if(m) g.applyMatrix4(m);
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); }
  const out=new THREE.BufferGeometry(); out.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); out.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3)); return out; }
const PH=0.4; let PLATE=32, OFF=16; // the baseplate size comes from the design ("plate": 32 or 48)
const tmp=new THREE.Object3D(), ZERO=new THREE.Matrix4().makeScale(0,0,0), col=new THREE.Color();
let stageLin=lin('#D9E2EB');

// ---------- geometries ----------
const boxGeo=new THREE.BoxGeometry(1,1,1);
const studGeo=(()=>{ const g=new THREE.CylinderGeometry(0.3,0.3,0.17,10,1,true), top=new THREE.CircleGeometry(0.3,10); top.rotateX(-Math.PI/2); top.translate(0,0.085,0); return mergeGeos([[g],[top]]); })();
const cylGeo=new THREE.CylinderGeometry(0.5,0.5,1,24);
function wedgeGeo(){
  const a=0.485, hb=0.78, hf=0.2; // the real slope is 2 plates tall at the back (LDraw 54200)
  const P={bl:[-a,0,-a],br:[a,0,-a],fl:[-a,0,a],fr:[a,0,a],tbl:[-a,hb,-a],tbr:[a,hb,-a],tfl:[-a,hf,a],tfr:[a,hf,a]};
  const v=[]; const q=(A,B,C,D)=>{ v.push(...P[A],...P[B],...P[C],...P[A],...P[C],...P[D]); };
  q('bl','br','fr','fl'); q('bl','tbl','tbr','br'); q('fl','fr','tfr','tfl'); q('tbl','tfl','tfr','tbr'); q('bl','fl','tfl','tbl'); q('br','tbr','tfr','fr');
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(v,3)); g.computeVertexNormals(); return g;
}
const cheeseGeo=wedgeGeo();
const archCache={};
function archGeoFor(h,top){ const k=h+'|'+top; if(archCache[k]) return archCache[k];
  const H=h*PH-0.02, openTop=H-top*PH, ry=Math.min(1.02,openTop*0.62), rect=Math.max(0,openTop-ry);
  const s=new THREE.Shape(); s.moveTo(0,0); s.lineTo(0.98,0); s.lineTo(0.98,rect); s.absellipse(2,rect,1.02,ry,Math.PI,0,true); s.lineTo(3.02,0); s.lineTo(4,0); s.lineTo(4,H); s.lineTo(0,H); s.lineTo(0,0);
  const g=new THREE.ExtrudeGeometry(s,{depth:0.94,bevelEnabled:false,curveSegments:18}); g.translate(-2,0,-0.47); archCache[k]=g; return g; }

// Foliage shapes, drawn instanced like bricks, modelled on the real elements:
//  2417 / 2423 "plant leaves": flat branching stems with a hollow stud boss at each tip
//  32607: a round plate with three almond-shaped, creased leaves
//  33291: a round plate with four round knobs around its edge
//  30239: a clip with a fan of long, narrow pointed sword leaves
// A leaf blade: almond outline (round sides, pointed tip), creased along its middle, arching as it goes.
function almondGeo(len,wid,rise,droop,segs=6,full=0.75){ const v=[], pt=(t,side)=>{ const w=wid/2*Math.pow(Math.sin(Math.PI*Math.min(1,t*1.08)),full)*side;
    return [w, rise*Math.sin(Math.PI*t*0.8)-droop*t*t+(side?0:0.05), t*len]; };
  for(let k=0;k<segs;k++){ const a=k/segs, b=(k+1)/segs, A=pt(a,0), B=pt(b,0), La=pt(a,-1), Lb=pt(b,-1), Ra=pt(a,1), Rb=pt(b,1);
    v.push(...La,...A,...Lb, ...A,...B,...Lb, ...A,...Ra,...B, ...Ra,...Rb,...B); }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(v,3)); g.computeVertexNormals(); return g; }
const place3=(g,x,y,z,ry)=>{ if(ry) g.rotateY(ry); g.translate(x,y,z); return g; };
// Real part shapes from the LDraw library (src/viewer/ldraw-parts.js, CC BY 4.0), when it's loaded:
// LDraw units are 1/20 stud with y down, so a part's geometry is scaled by 1/20 and flipped.
const ldrawCache={};
// ?ldraw=0 in the address draws the simple shapes instead, to compare looks and speed
const USE_LDRAW=!(typeof location!=='undefined'&&/[?&]ldraw=0\b/.test(location.search))&&!(typeof window!=='undefined'&&window.BRICKHOUSE_LDRAW===false);
function ldrawGeo(no){ if(!USE_LDRAW||typeof LDRAW_PARTS==='undefined'||!LDRAW_PARTS.parts[no]) return null; if(ldrawCache[no]) return ldrawCache[no];
  const bin=atob(LDRAW_PARTS.parts[no].tris), u8=new Uint8Array(bin.length); for(let k=0;k<bin.length;k++) u8[k]=bin.charCodeAt(k);
  const q=new Int16Array(u8.buffer), f=new Float32Array(q.length), s=1/(20*LDRAW_PARTS.q);
  for(let k=0;k<q.length;k+=3){ f[k]=q[k]*s; f[k+1]=-q[k+1]*s; f[k+2]=q[k+2]*s; }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(f,3)); g.computeVertexNormals(); return ldrawCache[no]=g; }
// Where a part's LDraw origin sits, and which way it turns: [x, y, z, quarter turns]
function ldrawPose(p){ const def=SPECIAL[p.key]||{};
  if(p.shape==='swordleaf'){ // clipped on one corner bar of the palm top, fanning out toward dir
    const r={N:0,E:1,S:2,W:3}[p.dir||'N'], c=[[p.x+2.5,p.z+6],[p.x,p.z+2.5],[p.x+2.5,p.z],[p.x+6,p.z+2.5]][r], bar=[[0.5,0],[0,0.5],[-0.5,0],[0,-0.5]][r];
    return [c[0]+bar[0]-OFF,(p.y+0.5)*PH,c[1]+bar[1]-OFF,r]; }
  if(p.shape==='palm'||p.key==='bush224') return [p.x+p.w/2-OFF,p.y*PH,p.z+p.d/2-OFF,0];
  if(def.at){ const a=turnCell(def,def.at,p.rot); return [p.x+a[0]+0.5-OFF,(p.y+1)*PH,p.z+a[1]+0.5-OFF,p.rot||0]; }
  // a standard part: LDraw's origin is the middle of the top of its body; a quarter turn per "rot" (the
  // long side of windows, arches and fences runs along x at rot 0), and slopes and side studs by "dir"/"face"
  const turn=LDRAW_TURN[p.key], d=p.dir||p.face;
  const r=turn&&d?turn[d]:(p.rot||0)%2;
  return [p.x+p.w/2-OFF,(LDRAW_BOTTOM[p.key]?p.y:p.y+p.h)*PH,p.z+p.d/2-OFF,r]; }
// quarter turns for parts that face a way: the slope's low side, the side stud, the bracket's plate
// (LDraw's slope runs down toward -z and its side stud points to -z; the bracket's plate reaches +z)
// glass whose LDraw origin isn't its frame's: how far down (LDU) it sits in the frame
const GLASS_DROP={ 60603: 8 };
const LDRAW_TURN={ cheese:{N:0,E:1,S:2,W:3}, snot:{N:0,E:1,S:2,W:3}, bracket11:{S:0,W:1,N:2,E:3} };
// parts whose LDraw origin is the bottom of the part, not the top of its body
const LDRAW_BOTTOM={ cheese:true };
const folCache={};
function foliageGeo(p){ const key=`${p.shape}|${p.key}|${p.w}x${p.d}|${p.dir||''}`; if(folCache[key]) return folCache[key];
  const items=[], H=PH*0.9, def=SPECIAL[p.key]||{};
  if(p.shape==='leaves'){ // stems between the tips, and a boss under each tip's stud
    const tr=c=>p.w!==def.w?[c[1],c[0]]:c, at=c=>{ const [i,j]=tr(c); return [i+0.5-p.w/2,j+0.5-p.d/2]; };
    for(const [a,b] of def.branches||[]){ const [x0,z0]=at(a), [x1,z1]=at(b), L=Math.hypot(x1-x0,z1-z0);
      const g=new THREE.BoxGeometry(0.34,H*0.55,L); g.rotateY(Math.atan2(x1-x0,z1-z0)); g.translate((x0+x1)/2,H*0.3,(z0+z1)/2); items.push([g]); }
    for(const c of def.tips||[]){ const [x,z]=at(c), g=new THREE.CylinderGeometry(0.34,0.34,H,12); g.translate(x,H/2,z); items.push([g]); }
  } else if(p.shape==='sprig'){ // a round plate with three almond leaves reaching out
    const pl=new THREE.CylinderGeometry(0.42,0.44,H,14); pl.translate(0,H/2,0); items.push([pl]);
    for(let k=0;k<3;k++){ const a=Math.PI/6+k*Math.PI*2/3; items.push([place3(almondGeo(1.05,0.78,0.04,0.02,8,0.5),Math.sin(a)*0.15,H*0.3,Math.cos(a)*0.15,a)]); }
  } else if(p.shape==='flower'){ // a round plate with four round knobs on its edge
    const pl=new THREE.CylinderGeometry(0.4,0.4,H,16); pl.translate(0,H/2,0); items.push([pl]);
    for(let k=0;k<4;k++){ const a=k*Math.PI/2+Math.PI/4, n=new THREE.CylinderGeometry(0.21,0.21,H*0.8,12); n.translate(Math.cos(a)*0.45,H*0.4,Math.sin(a)*0.45); items.push([n]); }
  } else if(p.shape==='swordleaf'){ // a fan of sword leaves from the clip at the trunk side, out across the footprint
    const out=Math.max(p.w,p.d), clip=out/2, ry={N:0,E:-Math.PI/2,S:Math.PI,W:Math.PI/2}[p.dir||'N'];
    const cl=new THREE.BoxGeometry(0.5,0.5,0.5); cl.translate(0,0.25,0); items.push([cl]);
    for(let k=0;k<6;k++){ const f=(k-2.5)/2.5*1.15, L=out*(k%2?0.84:0.98);
      items.push([place3(almondGeo(L,0.5,0.45,0.7,8),0,0.25,0,Math.PI+f)]); }
    const merged=mergeGeos(items); merged.translate(0,0,clip); merged.rotateY(ry); return folCache[key]=merged;
  }
  return folCache[key]=mergeGeos(items); }

const matO=new THREE.MeshLambertMaterial({color:0xffffff});
const matT=new THREE.MeshLambertMaterial({color:0xffffff,transparent:true,opacity:0.62,depthWrite:false});
const matTW=new THREE.MeshLambertMaterial({color:0xffffff,transparent:true,opacity:0.45,depthWrite:false,side:THREE.DoubleSide});
const matW=new THREE.MeshLambertMaterial({color:0xffffff,side:THREE.DoubleSide});
const glassMat=()=>new THREE.MeshLambertMaterial({color:lin('#BFE3F5'),transparent:true,opacity:0.42,depthWrite:false});

const base=new THREE.Mesh(new THREE.BoxGeometry(32,0.14,32),new THREE.MeshLambertMaterial({color:lin(COLORS['Green'].hex)}));
base.position.set(0,-0.07,0); base.receiveShadow=true; scene.add(base);

// ---------- state ----------
let R=null, root=null, inst=[], specials=[], studs=null, studRecs=[], meshes=[], recOf=new Map(), studsOf=new Map();
const anims=new Map(); // part id -> {t0, dur, from, to, spin, ease, hideBefore, shrink}: bricks in motion
let stepIdx=0, showAll=true, stress=false, mode='main', lifted=0; // lift-off groups taken off, top first
let DESIGN_TEXT='';

function strengthHex(p){ const area=p.shape==='arch'?4:p.w*p.d; const r=R.jn.get(p.id)/area; return r<0.5?'#D64B34':r<1?'#E8A93A':'#3E9E68'; }

function makeInstanced(geo,mat,list,cast){ const m=new THREE.InstancedMesh(geo,mat,Math.max(1,list.length)); m.castShadow=!!cast; m.receiveShadow=true;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); list.forEach((r,i)=>{ r.mesh=m; r.i=i; m.setMatrixAt(i,r.m); m.setColorAt(i,col.set(0xffffff)); });
  // an empty group still gets instance colors (meshes sharing a material share its shader, and one
  // compiled without them draws everything white) and draws nothing
  if(!list.length){ m.setColorAt(0,col.set(0xffffff)); m.count=0; }
  m.userData.recs=list; root.add(m); meshes.push(m); return m; }

function buildScene(){
  if(root){ scene.remove(root); meshes.forEach(m=>m.dispose&&m.dispose()); specials.forEach(s=>{ s.mats.forEach(o=>o.mat.dispose()); s.obj.traverse(o=>{ if(o.geometry) o.geometry.dispose(); }); }); }
  root=new THREE.Group(); scene.add(root); inst=[]; specials=[]; meshes=[]; studRecs=[]; anims.clear(); recOf=new Map(); studsOf=new Map();
  const boxO=[], boxT=[], ch=[], cyl=[], fol=new Map();
  for(const p of R.parts){
    const cx=p.x+p.w/2-OFF, cz=p.z+p.d/2-OFF, y0=p.y*PH, hh=p.h*PH;
    if(ldrawGeo(p.no)){
      const [lx,ly,lz,r]=ldrawPose(p); tmp.position.set(lx,ly,lz); tmp.scale.set(1,1,1); tmp.rotation.set(0,-r*Math.PI/2,0); tmp.updateMatrix();
      const geo=ldrawGeo(p.no), rec={p,m:tmp.matrix.clone()}, key=p.color.startsWith('Trans-')?'T':'O';
      if(!fol.has(geo)) fol.set(geo,{O:[],T:[]}); fol.get(geo)[key].push(rec); inst.push(rec); recOf.set(p.id,rec);
      const gg=p.glass&&ldrawGeo(p.glass.no); if(gg){ const g={p,m:rec.m.clone().multiply(new THREE.Matrix4().makeTranslation(0,-(GLASS_DROP[p.glass.no]||0)/20,0)),glass:true}; if(!fol.has(gg)) fol.set(gg,{O:[],T:[]}); fol.get(gg).T.push(g); inst.push(g); rec.extra=[g]; }
    } else if(p.shape==='box'||p.shape==='cyl'){
      tmp.rotation.set(0,0,0); tmp.position.set(cx,y0+hh/2,cz);
      if(p.shape==='box') tmp.scale.set(p.w-0.035,hh-0.018,p.d-0.035); else tmp.scale.set(p.diam,hh-0.018,p.diam);
      tmp.updateMatrix(); const r={p,m:tmp.matrix.clone()}; (p.shape==='cyl'?cyl:(p.color.startsWith('Trans-')?boxT:boxO)).push(r); inst.push(r); recOf.set(p.id,r);
    } else if(p.shape==='cheese'){
      tmp.position.set(cx,y0,cz); tmp.scale.set(1,1,1); tmp.rotation.set(0,{S:0,N:Math.PI,E:Math.PI/2,W:-Math.PI/2}[p.dir]||0,0);
      tmp.updateMatrix(); const r={p,m:tmp.matrix.clone()}; ch.push(r); inst.push(r); recOf.set(p.id,r);
    } else if(p.shape==='leaves'||p.shape==='sprig'||p.shape==='flower'||p.shape==='swordleaf'){
      tmp.position.set(cx,y0,cz); tmp.scale.set(1,1,1); tmp.rotation.set(0,0,0); tmp.updateMatrix();
      const geo=foliageGeo(p), r={p,m:tmp.matrix.clone()}; if(!fol.has(geo)) fol.set(geo,{O:[],T:[]}); fol.get(geo).O.push(r); inst.push(r); recOf.set(p.id,r);
    } else { const sp=makeSpecial(p); sp.pos0=sp.obj.position.clone(); sp.rot0=sp.obj.rotation.y; specials.push(sp); recOf.set(p.id,sp); }
  }
  makeInstanced(boxGeo,matO,boxO,true); makeInstanced(boxGeo,matT,boxT,false); makeInstanced(cheeseGeo,matW,ch,true); makeInstanced(cylGeo,matO,cyl,true);
  for(const [geo,{O,T}] of fol){ if(O.length) makeInstanced(geo,matW,O,true); if(T.length) makeInstanced(geo,matTW,T,false); }
  // studs
  for(const p of R.parts) if(!ldrawGeo(p.no)) for(const [x,z] of p.studs){ const top=p.y+p.h; const cov=R.occ.get(x+','+z+','+top); studRecs.push({p,x,z,top,cov}); }
  for(let x=0;x<PLATE;x++) for(let z=0;z<PLATE;z++){ const cov=R.occ.get(x+','+z+',0'); studRecs.push({p:null,x,z,top:0,cov}); }
  studs=new THREE.InstancedMesh(studGeo,matO,studRecs.length); studs.instanceMatrix.setUsage(THREE.DynamicDrawUsage); studs.receiveShadow=true;
  studRecs.forEach((s,i)=>{ tmp.rotation.set(0,0,0); tmp.scale.set(1,1,1); tmp.position.set(s.x+0.5-OFF,s.top*PH+0.085,s.z+0.5-OFF); tmp.updateMatrix(); s.m=tmp.matrix.clone();
    if(s.p){ if(!studsOf.has(s.p.id)) studsOf.set(s.p.id,[]); studsOf.get(s.p.id).push(i); } });
  root.add(studs); meshes.push(studs);
}

function makeSpecial(p){
  const g=new THREE.Group(), mats=[]; const main=new THREE.MeshLambertMaterial({color:lin(COLORS[p.color].hex),side:THREE.DoubleSide}); mats.push({mat:main,p});
  const add=(geo,mat,x,y,z,cast=true)=>{ const m=new THREE.Mesh(geo,mat); m.position.set(x,y,z); m.castShadow=cast; m.receiveShadow=true; g.add(m); return m; };
  // shapes in the part's own color are merged into one mesh at the end (glass stays its own)
  const shapes=[], put=(geo,x,y,z,rot)=>{ const o=new THREE.Object3D(); o.position.set(x,y,z); if(rot) o.rotation.copy(rot); o.updateMatrix(); shapes.push([geo,o.matrix]); };
  const H=p.h*PH;
  if(p.shape==='window'){
    const w=p.rot%2?p.d:p.w, t=0.17, dep=0.9;
    put(new THREE.BoxGeometry(w-0.03,t,dep),0,H-t/2-0.01,0); put(new THREE.BoxGeometry(w-0.03,t,dep),0,t/2,0);
    put(new THREE.BoxGeometry(t,H-0.02,dep),-w/2+t/2+0.015,H/2,0); put(new THREE.BoxGeometry(t,H-0.02,dep),w/2-t/2-0.015,H/2,0);
    put(new THREE.BoxGeometry(w-2*t,0.08,0.3),0,H*0.55,0);
    if(w>=4||p.h>=9) put(new THREE.BoxGeometry(0.1,H-2*t,0.3),0,H/2,0);
    const gm=glassMat(); mats.push({mat:gm,p,glass:true}); add(new THREE.BoxGeometry(w-2*t,H-2*t,0.06),gm,0,H/2,0,false);
  } else if(p.shape==='arch'){ put(archGeoFor(p.h,p.archTop||2),0,0,0);
  } else if(p.shape==='fence'){
    const w=4; put(new THREE.BoxGeometry(w-0.04,0.34,0.8),0,0.17,0); put(new THREE.BoxGeometry(w-0.04,0.2,0.34),0,1.08,0);
    const sg=new THREE.BoxGeometry(0.22,0.8,0.16); for(let i=0;i<7;i++) put(sg,-w/2+0.3+i*(w-0.6)/6,0.7,0);
  } else if(p.shape==='bracket'){ // plate out from the wall, and an upright flange against the wall's side stud
    const [fx,fz]={N:[0,-1],S:[0,1],E:[1,0],W:[-1,0]}[p.face]||[0,1], t=PH*0.9;
    put(new THREE.BoxGeometry(0.96,t,0.96),0,t/2,0);
    put(new THREE.BoxGeometry(fx?t:0.96,1,fz?t:0.96),-fx*(0.48-t/2),0.5,-fz*(0.48-t/2));
  } else if(p.shape==='palm'){ // palm top: a hub with four upright bars (fronds clip onto them)
    put(new THREE.CylinderGeometry(0.34,0.34,PH,12),0,PH/2,0);
    const bar=new THREE.CylinderGeometry(0.11,0.11,H-PH*0.5,8); for(const [bx,bz] of [[0.3,0.3],[-0.3,0.3],[0.3,-0.3],[-0.3,-0.3]]) put(bar,bx,PH*0.5+(H-PH*0.5)/2,bz);
  }
  if(shapes.length) add(mergeGeos(shapes),main,0,0,0);
  g.position.set(p.x+p.w/2-OFF,p.y*PH,p.z+p.d/2-OFF);
  if(p.rot%2&&p.shape!=='palm') g.rotation.y=Math.PI/2;
  root.add(g); return {p,obj:g,mats};
}

// ---------- visibility & color ----------
function partState(p){
  if(lifted&&p.liftoff&&R.stats.liftoff.indexOf(p.liftoff)<lifted) return [false,false];
  if(showAll) return [true,false];
  const s=R.steps[stepIdx];
  if(s.kind==='sub'){ const v=p.sub===s.sub&&p.copy===0&&p.buildStep<=stepIdx; return [v,v&&p.buildStep===stepIdx]; }
  const v=p.mainStep!==undefined&&p.mainStep<=stepIdx; return [v,v&&p.mainStep===stepIdx];
}
function colorFor(p,cur){
  col.copy(lin(stress?strengthHex(p):COLORS[p.color].hex));
  if(!showAll&&!cur) col.lerp(stageLin,0.42);
  return col;
}
function applyState(){
  if(!R) return;
  mode=(!showAll&&R.steps[stepIdx].kind==='sub')?'sub':'main';
  for(const p of R.parts){ const [v,c]=partState(p); p._v=v||anims.has(p.id); p._c=c; }
  for(const r of inst){ r.mesh.setMatrixAt(r.i,r.p._v?r.m:ZERO); r.mesh.setColorAt(r.i,r.glass?col.copy(lin(COLORS['Trans-Clear'].hex)):colorFor(r.p,r.p._c)); }
  for(const m of meshes){ m.instanceMatrix.needsUpdate=true; if(m.instanceColor) m.instanceColor.needsUpdate=true; }
  for(const s of specials){ s.obj.visible=s.p._v; s.obj.position.copy(s.pos0); s.obj.rotation.set(0,s.rot0,0); s.obj.scale.setScalar(1); for(const o of s.mats){ if(o.glass) continue; o.mat.color.copy(colorFor(s.p,s.p._c)); } }
  const baseHex=COLORS['Green'].hex;
  // only the studs that show are drawn: they're packed into the first slots and the rest skipped
  let n=0;
  studRecs.forEach(s=>{ s.slot=-1;
    const ownerV=s.p?s.p._v:(mode==='main'); const covered=s.cov&&R.parts[s.cov-1]._v;
    if(!ownerV||covered) return;
    s.slot=n; studs.setMatrixAt(n,s.m); studs.setColorAt(n, s.p?colorFor(s.p,s.p._c):col.copy(lin(baseHex))); n++;
  });
  studs.count=n;
  studs.instanceMatrix.needsUpdate=true; if(studs.instanceColor) studs.instanceColor.needsUpdate=true;
  if(anims.size) animFrame(performance.now());
  renderer.shadowMap.needsUpdate=true;
  base.visible=mode==='main';
  $('modebadge').style.display=mode==='sub'?'block':'none';
  if(mode==='sub'){ const s=R.steps[stepIdx], sub=R.subs[s.sub]; $('modebadge').textContent=`Sub-build: ${sub.name}`+(sub.copies>1?`, make ${sub.copies}`:''); }
  frame(); dirty=true;
}

// ---------- camera ----------
let theta=0.62, phi=0.98, radius=70, target=new THREE.Vector3(0,3.5,0), goal={theta, phi, radius, t:target.clone()}, autoSpin=false, dirty=true, userZoom=false, lastMode='main';
function fitRadius(){ const a=camera.aspect, k=PLATE/32; return Math.min(170*k,Math.max(82*k,77*k/Math.max(a,0.45))); }
function frame(){
  if(mode===lastMode) return; lastMode=mode;
  if(mode==='sub'){ const s=R.steps[stepIdx]; const ps=R.parts.filter(p=>p.sub===s.sub&&p.copy===0);
    let mnx=1e9,mxx=-1e9,mnz=1e9,mxz=-1e9,mxy=0; ps.forEach(p=>{mnx=Math.min(mnx,p.x);mxx=Math.max(mxx,p.x+p.w);mnz=Math.min(mnz,p.z);mxz=Math.max(mxz,p.z+p.d);mxy=Math.max(mxy,(p.y+p.h)*PH);});
    goal.t.set((mnx+mxx)/2-OFF,mxy/2,(mnz+mxz)/2-OFF); goal.radius=Math.max(14,mxy*2.7,(mxx-mnx)*2.6)*(camera.aspect<1?1.25:1); }
  else { goal.t.set(0,3.5,0); goal.radius=fitRadius(); }
}
function setView(v){ document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.view===v));
  if(v==='q'){goal.theta=0.62;goal.phi=0.98;} if(v==='f'){goal.theta=0;goal.phi=1.28;} if(v==='t'){goal.theta=0;goal.phi=0.06;}
  // back corners (no buttons; the design loop renders them so Claude sees the back and sides)
  if(v==='bl'){goal.theta=Math.PI+0.62;goal.phi=0.98;} if(v==='br'){goal.theta=Math.PI-0.62;goal.phi=0.98;}
  userZoom=false; goal.radius=mode==='sub'?goal.radius:fitRadius(); dirty=true; }
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
$('spin').onclick=()=>{ autoSpin=!autoSpin; $('spin').setAttribute('aria-pressed',autoSpin); dirty=true; };
function placeCam(){ camera.position.set(target.x+radius*Math.sin(phi)*Math.sin(theta),target.y+radius*Math.cos(phi),target.z+radius*Math.sin(phi)*Math.cos(theta)); camera.lookAt(target); }
const ptrs=new Map(); let pinch0=0,r0=0;
canvas.addEventListener('pointerdown',e=>{ canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY}); document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed','false'));
  if(ptrs.size===2){ const [a,b]=[...ptrs.values()]; pinch0=Math.hypot(a.x-b.x,a.y-b.y); r0=goal.radius; } });
canvas.addEventListener('pointermove',e=>{ if(!ptrs.has(e.pointerId)) return; const p=ptrs.get(e.pointerId);
  if(ptrs.size===1){ goal.theta-=(e.clientX-p.x)*0.008; goal.phi=Math.max(0.06,Math.min(1.5,goal.phi-(e.clientY-p.y)*0.006)); theta=goal.theta; phi=goal.phi; }
  p.x=e.clientX; p.y=e.clientY;
  if(ptrs.size===2){ const [a,b]=[...ptrs.values()], d=Math.hypot(a.x-b.x,a.y-b.y); if(pinch0){ goal.radius=Math.max(10,Math.min(170,r0*pinch0/d)); radius=goal.radius; userZoom=true; } }
  dirty=true; });
const endPtr=e=>{ ptrs.delete(e.pointerId); if(ptrs.size<2) pinch0=0; };
canvas.addEventListener('pointerup',endPtr); canvas.addEventListener('pointercancel',endPtr);
canvas.addEventListener('wheel',e=>{ e.preventDefault(); goal.radius=Math.max(10,Math.min(170,goal.radius*(1+e.deltaY*0.001))); radius=goal.radius; userZoom=true; dirty=true; },{passive:false});
function resize(){ const w=stage.clientWidth,h=stage.clientHeight; renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); if(!userZoom&&mode==='main'){ goal.radius=fitRadius(); } dirty=true; }
new ResizeObserver(resize).observe(stage);
const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function loop(){ requestAnimationFrame(loop);
  const k=reduceMotion?1:0.14; let moving=false;
  const ease=(a,b)=>{ const d=b-a; if(Math.abs(d)>1e-4){ moving=true; return a+d*k; } return b; };
  if(autoSpin){ goal.theta+=0.004; moving=true; }
  if(anims.size){ animFrame(performance.now()); moving=true; }
  theta=ease(theta,goal.theta); phi=ease(phi,goal.phi); radius=ease(radius,goal.radius);
  const tx=ease(target.x,goal.t.x), ty=ease(target.y,goal.t.y), tz=ease(target.z,goal.t.z); target.set(tx,ty,tz);
  if(moving||dirty){ placeCam(); renderer.render(scene,camera); dirty=false; } }

// ---------- bricks in motion ----------
// Play build drops each step's bricks straight down into place one after another; lifting a roof or floor
// raises its bricks straight up one by one, top first, and putting it back lowers them, bottom first.
const m4=new THREE.Matrix4(), m4b=new THREE.Matrix4(), eul=new THREE.Euler(), v3=new THREE.Vector3();
const easeIn=t=>t*t, easeOut=t=>1-(1-t)*(1-t);
function centerOf(p){ return v3.set(p.x+p.w/2-OFF,(p.y+p.h/2)*PH,p.z+p.d/2-OFF); }
function animFrame(now){
  let done=false, touched=false;
  for(const [id,a] of anims){
    const t=(now-a.t0)/a.dur, p=R.parts[id-1], r=recOf.get(id); if(!r) { anims.delete(id); continue; }
    if(t>=1){ anims.delete(id); settle(p,r); done=true; continue; }
    const e=t<0?0:a.ease(t), hide=t<0&&a.hideBefore;
    const off=[0,1,2].map(k=>a.from[k]+(a.to[k]-a.from[k])*e), sc=a.shrink&&e>0.7?Math.max(0.05,1-(e-0.7)/0.3):1;
    if(r.obj){ r.obj.visible=!hide&&p._v; r.obj.position.set(r.pos0.x+off[0],r.pos0.y+off[1],r.pos0.z+off[2]);
      r.obj.rotation.set(a.spin[0]*e,r.rot0+a.spin[1]*e,a.spin[2]*e); r.obj.scale.setScalar(sc); continue; }
    // rotate and shrink about the brick's own center, then move it
    const c=centerOf(p); eul.set(a.spin[0]*e,a.spin[1]*e,a.spin[2]*e);
    m4.makeTranslation(c.x+off[0],c.y+off[1],c.z+off[2]).multiply(m4b.makeRotationFromEuler(eul)).multiply(m4b.makeScale(sc,sc,sc)).multiply(m4b.makeTranslation(-c.x,-c.y,-c.z));
    r.mesh.setMatrixAt(r.i,hide?ZERO:m4b.copy(m4).multiply(r.m)); r.mesh.instanceMatrix.needsUpdate=true;
    for(const e of r.extra||[]){ e.mesh.setMatrixAt(e.i,hide?ZERO:m4b.copy(m4).multiply(e.m)); e.mesh.instanceMatrix.needsUpdate=true; }
    for(const si of studsOf.get(id)||[]){ const sr=studRecs[si]; if(sr.slot<0) continue; studs.setMatrixAt(sr.slot,hide?ZERO:m4b.copy(m4).multiply(sr.m)); touched=true; }
  }
  if(touched) studs.instanceMatrix.needsUpdate=true;
  if(done&&!anims.size) applyState(); // all settled: one full refresh (uncovered studs, colors)
  // shadows follow the moving bricks a few times a second, not every frame
  if(done||++shadowTick%4===0) renderer.shadowMap.needsUpdate=true;
  dirty=true;
}
let shadowTick=0;
// a brick that has finished moving goes to its resting place, or away if its group is lifted
function settle(p,r){ const v=partState(p)[0]; p._v=v;
  if(r.obj){ r.obj.visible=v; r.obj.position.copy(r.pos0); r.obj.rotation.set(0,r.rot0,0); r.obj.scale.setScalar(1); return; }
  r.mesh.setMatrixAt(r.i,v?r.m:ZERO); r.mesh.instanceMatrix.needsUpdate=true;
  for(const e of r.extra||[]){ e.mesh.setMatrixAt(e.i,v?e.m:ZERO); e.mesh.instanceMatrix.needsUpdate=true; }
  for(const si of studsOf.get(p.id)||[]){ const sr=studRecs[si]; if(sr.slot>=0) studs.setMatrixAt(sr.slot,v?sr.m:ZERO); }
  studs.instanceMatrix.needsUpdate=true; }
function animate(list,make){ if(reduceMotion||!root) return; const now=performance.now(); list.forEach((p,k)=>anims.set(p.id,make(p,k,now))); dirty=true; }
// a step's new bricks fall from above, one after another (a sub-build being placed comes down as one)
function dropStep(s){
  const ps=s.parts.map(id=>R.parts[id-1]).sort((a,b)=>a.y-b.y||a.id-b.id), whole=s.kind==='attach';
  const gap=whole?0:Math.min(30,260/Math.max(1,ps.length)), h=whole?9:6;
  animate(ps,(p,k,now)=>({t0:now+k*gap,dur:whole?520:340,from:[0,h,0],to:[0,0,0],spin:[0,0,0],ease:easeIn,hideBefore:true}));
}
// a lift-off group's bricks rise straight up, one by one in order: the top layer first, each layer swept
// front to back (putting back brings them straight down, bottom layer first)
function flyGroups(names,home){
  const ps=R.parts.filter(p=>names.includes(p.liftoff)); if(!ps.length) return;
  ps.sort((a,b)=>home?(a.y-b.y||a.z-b.z||a.x-b.x):(b.y-a.y||b.z-a.z||a.x-b.x));
  const gap=Math.min(14,1100/ps.length), rise=[0,55,0];
  animate(ps,(p,k,now)=>home?{t0:now+k*gap,dur:560,from:rise,to:[0,0,0],spin:[0,0,0],ease:easeOut,hideBefore:true}
    :{t0:now+k*gap,dur:640,from:[0,0,0],to:rise,spin:[0,0,0],ease:easeIn,hideBefore:false});
}

// ---------- manual ----------
const inventoryPages=()=>Math.ceil(R.inventory.length/24);
let shownIdx=-1, shownAll=true;
function renderStep(){
  // one step on (Play skips sub-build steps: their bricks come down with the placed sub-build)
  const forward=!showAll&&!shownAll&&stepIdx>shownIdx&&R.steps.slice(shownIdx+1,stepIdx).every(s=>s.kind==='sub'),
    fromStart=!showAll&&shownAll&&R.steps.slice(0,stepIdx).every(s=>s.kind==='sub');
  if(!forward&&!fromStart) anims.clear();
  shownIdx=stepIdx; shownAll=showAll;
  const n=R.steps.length; $('slider').max=n-1; $('slider').value=showAll?n-1:stepIdx;
  const box=$('stepParts'); box.innerHTML=''; const tag=$('subTag');
  if(showAll||!n){ $('stepNum').textContent='✓'; $('stepTitle').textContent='Finished model'; $('stepOf').textContent=`${R.stats.pieces.toLocaleString()} pieces in ${n} steps`; tag.hidden=true;
    box.innerHTML='<span class="note" style="margin:0">Press Next or Start from step 1 to walk through the build.</span>'; }
  else {
    const s=R.steps[stepIdx]; $('stepNum').textContent=stepIdx+1;
    $('stepTitle').textContent=s.kind==='main'?s.title:(s.kind==='sub'?R.subs[s.sub].name:s.title);
    $('stepOf').textContent=`Step ${stepIdx+1} of ${n}, page ${stepIdx+2+inventoryPages()}`;
    if(s.kind==='sub'){ const sub=R.subs[s.sub]; tag.hidden=false; tag.textContent=`Sub-build ${s.n} of ${s.of}`+(sub.copies>1?`, make ${sub.copies}`:''); }
    else if(s.kind==='main'&&s.of>1){ tag.hidden=false; tag.textContent=`${s.n} of ${s.of} in this section`; } else tag.hidden=true;
    if(s.kind==='attach'){ const sub=R.subs[s.sub]; const d=document.createElement('div'); d.className='chip'; d.innerHTML=`<span>${sub.name}</span><span class="q">×${sub.copies}</span>`; box.appendChild(d); }
    else { const agg=new Map(); s.parts.forEach(id=>{ const p=R.parts[id-1]; const k=p.name+'|'+p.color; agg.set(k,(agg.get(k)||0)+1); if(p.glass){ const g=p.glass.name+'|Trans-Clear'; agg.set(g,(agg.get(g)||0)+1); } });
      [...agg.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,q])=>{ const [name,color]=k.split('|'); const d=document.createElement('div'); d.className='chip'; d.title=color;
        d.innerHTML=`<span class="sw" style="background:${COLORS[color].hex}"></span><span>${name}</span><span class="q">×${q}</span>`; box.appendChild(d); }); }
  }
  $('prev').disabled=!showAll&&stepIdx===0; $('next').disabled=showAll;
  if((forward||fromStart)&&R.steps[stepIdx].kind!=='sub') dropStep(R.steps[stepIdx]);
  applyState(); updateShowLabel();
}
$('prev').onclick=()=>{ stopPlay(); if(showAll){ showAll=false; stepIdx=R.steps.length-1; } else stepIdx=Math.max(0,stepIdx-1); renderStep(); };
$('next').onclick=()=>{ stopPlay(); if(stepIdx>=R.steps.length-1) showAll=true; else stepIdx++; renderStep(); };
$('slider').oninput=e=>{ stopPlay(); showAll=false; stepIdx=+e.target.value; renderStep(); };
// Lift steps through the lift-off groups from the top (roof, then each floor), then puts them all back.
function liftLabel(){ const L=R.stats.liftoff||[]; return lifted>=L.length?'Put back':`Lift ${L[lifted].toLowerCase()}`; }
$('lift').onclick=()=>{ const L=R.stats.liftoff||[], was=lifted; lifted=(lifted+1)%(L.length+1);
  $('lift').setAttribute('aria-pressed',lifted>0); $('lift').textContent=liftLabel();
  if(lifted>was) flyGroups([L[was]],false); else flyGroups(L.slice(0,was),true);
  applyState(); };
$('startOver').onclick=()=>{ stopPlay(); showAll=false; stepIdx=0; renderStep(); };
$('finished').onclick=()=>{ stopPlay(); showAll=true; stepIdx=R.steps.length-1; renderStep(); };

// ---------- showcase playback ----------
let playTimer=null;
function updateShowLabel(){
  const lbl=$('showLbl'), bar=$('barFill'), mainSteps=R.steps.filter(s=>s.kind!=='sub');
  if(showAll){ lbl.innerHTML='<b>Finished</b> '+R.stats.pieces.toLocaleString()+' pieces'; bar.style.width='100%'; return; }
  const s=R.steps[stepIdx], k=mainSteps.indexOf(s);
  lbl.innerHTML=`<b>${stepIdx+1} / ${R.steps.length}</b> ${s.kind==='main'?s.title:(s.kind==='sub'?R.subs[s.sub].name:s.title)}`;
  bar.style.width=((stepIdx+1)/R.steps.length*100).toFixed(1)+'%';
}
function stopPlay(){ if(playTimer){ clearInterval(playTimer); playTimer=null; $('play').textContent='Play build'; } }
$('play').onclick=()=>{
  if(playTimer){ stopPlay(); return; }
  const order=R.steps.map((s,i)=>i).filter(i=>R.steps[i].kind!=='sub');
  let k=showAll?0:Math.max(0,order.findIndex(i=>i>=stepIdx)); showAll=false; $('play').textContent='Pause';
  const tick=()=>{ if(k>=order.length){ stopPlay(); showAll=true; renderStep(); return; } stepIdx=order[k++]; renderStep(); };
  tick(); playTimer=setInterval(tick,reduceMotion?400:130);
};

// ---------- parts ----------
let xml='';
function renderParts(){
  const rows=R.inventory.slice().sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})||b.q-a.q);
  $('pLots').textContent=rows.length; $('pPieces').textContent=R.stats.pieces.toLocaleString(); $('pCost').textContent='$'+Math.round(R.stats.cost);
  $('partsBody').innerHTML=rows.map(r=>`<tr><td><span class="sw" style="background:${COLORS[r.color].hex}"></span></td><td>${r.name}</td><td>${r.no}</td><td>${r.color}</td><td class="n">${r.q}</td></tr>`).join('');
  xml='<INVENTORY>\n'+rows.map(r=>`  <ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>${r.no}</ITEMID><COLOR>${COLORS[r.color].bl}</COLOR><MINQTY>${r.q}</MINQTY></ITEM>`).join('\n')+'\n</INVENTORY>';
  $('xmlOut').hidden=true;
}
$('copyXml').onclick=async()=>{ const b=$('copyXml');
  try{ await navigator.clipboard.writeText(xml); b.textContent='Copied wanted list'; setTimeout(()=>b.textContent='Copy BrickLink wanted list',1800); }
  catch(e){ const t=$('xmlOut'); t.value=xml; t.hidden=false; t.select(); b.textContent='Select and copy below'; } };

// ---------- model report ----------
function renderReport(){
  const st=R.stats;
  $('sPieces').textContent=st.pieces.toLocaleString(); $('sSteps').textContent=st.steps; $('sPages').textContent=st.pages; $('sMs').textContent=(st.ms/1000).toFixed(2)+' s';
  const e=$('sErr'), w=$('sWarn'); e.querySelector('b').textContent=R.errors.length+(R.errors.length?'':' ✓'); w.querySelector('b').textContent=R.warnings.length+(R.warnings.length?'':' ✓');
  e.className=R.errors.length?'bad':'ok'; w.className=R.warnings.length?'bad':'ok';
  $('verdict').textContent=R.errors.length?`${R.errors.length} problem${R.errors.length>1?'s':''} to fix before this can ship.`:`Every piece locks to the baseplate through ${st.joints.toLocaleString()} stud joints, checked in build order.`;
  const list=[...R.errors.map(x=>['e',x]),...R.warnings.map(x=>['w',x])].slice(0,12);
  $('problems').innerHTML=list.map(([t,x])=>`<li class="${t}">${x.msg}${x.op!=null?` (design step ${x.op+1})`:''}</li>`).join('');
  $('chips').innerHTML=`<span><b>${st.pieces.toLocaleString()}</b>pieces</span><span><b>${st.steps}</b>steps</span><span><b>${st.subBuilds}</b>sub-builds</span><span><b>${PLATE}×${PLATE}</b>studs</span><span><b>$${Math.round(st.cost)}</b>parts</span>`;
}
$('stress').onchange=e=>{ stress=e.target.checked; applyState(); };

// ---------- design & compile ----------
let curDesign=null;
function esc(t){ return String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function showDesign(d){
  curDesign=d; R=compile(d); lifted=0; $('lift').hidden=!(R.stats.liftoff&&R.stats.liftoff.length); $('lift').textContent=liftLabel(); $('lift').setAttribute('aria-pressed','false'); PLATE=R.stats.plate||32; OFF=PLATE/2; base.scale.set(PLATE/32,1,PLATE/32); stopPlay(); showAll=true; stepIdx=Math.max(0,R.steps.length-1); lastMode='';
  buildScene(); renderReport(); renderParts(); renderStep(); frame();
  $('title').textContent=d.name||'Brick house'; document.title=(d.name||'Brick house')+', brick model';
  $('subline').textContent=(d.place?d.place+'. ':'')+(d.unit?`Unit ${d.unit}, cut from its building. `:'')+'A closing-gift brick model with a full build manual.';
  $('factsTitle').textContent=d.source==='photos'?'What the photos show':'From the listing';
  $('facts').innerHTML=(d.facts||[]).map(f=>`<li>${esc(f)}</li>`).join('');
  $('assumed').textContent=d.assumed||'';
  const cr=d.photoCredits||[]; $('credits').hidden=!cr.length;
  $('credits').innerHTML=cr.map(c=>`<li>Photo: ${/^https:\/\//.test(c.page||'')?`<a href="${esc(c.page)}" target="_blank" rel="noopener">${esc(c.credit)}</a>`:esc(c.credit)}${c.license?', '+esc(c.license):''}</li>`).join('');
  return R;
}
function problemsHtml(){ return [...R.errors.map(x=>`<li class="e">${esc(x.msg)}${x.op!=null?` (design step ${x.op+1})`:''}</li>`),...R.warnings.map(x=>`<li>${esc(x.msg)}</li>`)].slice(0,15).join(''); }
function run(text){
  let d; try{ d=JSON.parse(text); }catch(err){ $('compileOut').innerHTML=`<span class="status-err">The design isn't valid JSON: ${esc(err.message)}</span>`; return false; }
  showDesign(d);
  const p=problemsHtml();
  $('compileOut').innerHTML=`<div>Compiled in ${(R.stats.ms/1000).toFixed(2)} s: ${R.stats.pieces.toLocaleString()} pieces, ${R.errors.length} errors, ${R.warnings.length} warnings.</div>${p?`<ul class="problems">${p}</ul>`:''}`;
  return true;
}
$('compileBtn').onclick=()=>run($('designSrc').value);
$('revertBtn').onclick=()=>{ $('designSrc').value=DESIGN_TEXT; run(DESIGN_TEXT); };

// ---------- design from photos (local server: POST /api/design, NDJSON progress) ----------
let photos=[], photoUrls=[], busyCtl=null, health=null, survey=null;
const photoCredit=new WeakMap(); // File -> credit for photos found by address lookup
function status(html,err){ $('photoStatus').innerHTML=err?`<span class="status-err">${html}</span>`:html; }
function setBusy(b){ $('planBtn').disabled=b; $('surveyBtn').disabled=b; $('designBtn').disabled=b; $('pickBtn').disabled=b; $('addrBtn').disabled=b; $('useCands').disabled=b; $('stopBtn').hidden=!b; $('compileBtn').disabled=b; $('revertBtn').disabled=b; }
function renderThumbs(){
  photoUrls.forEach(u=>URL.revokeObjectURL(u)); photoUrls=photos.map(f=>URL.createObjectURL(f));
  const html=photoUrls.map((u,i)=>`<img src="${u}" alt="House photo ${i+1}">`).join('');
  $('thumbs').innerHTML=photoUrls.map((u,i)=>`<img src="${u}" alt="House photo ${i+1}" title="Click to remove" data-i="${i}" style="cursor:pointer">`).join('');
  $('refPhotos').innerHTML=html; $('refWrap').hidden=!photos.length;
  $('designBtn').textContent=(photos.length?`Design from ${photos.length} photo${photos.length>1?'s':''}`:'Design from description')+feeText();
  $('surveyBtn').hidden=!photos.length; if(survey){ survey=null; $('survey').hidden=true; $('survey').innerHTML=''; } // new photos: ask again
}
async function toPayload(file,maxSide=1568){
  // Downscale on the device: Claude works at about 1.5 megapixels and uploads stay small. Floor plans
  // pass a larger limit so room labels stay readable.
  const bmp=await createImageBitmap(file); const s=Math.min(1,maxSide/Math.max(bmp.width,bmp.height));
  const c=document.createElement('canvas'); c.width=Math.round(bmp.width*s); c.height=Math.round(bmp.height*s);
  c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
  return {mediaType:'image/jpeg', data:c.toDataURL('image/jpeg',0.88).split(',')[1]};
}
$('pickBtn').onclick=()=>$('photoInput').click();
// Optional floor plan: the walls are laid out from it. Without one, a looked-up address locks the
// walls to the county or OpenStreetMap building outline; without either, they come from the photos.
let planFile=null;
$('planBtn').onclick=()=>$('planInput').click();
$('planInput').onchange=e=>{ planFile=e.target.files[0]||null; e.target.value='';
  $('planStatus').textContent=planFile?`Floor plan: ${planFile.name}. The walls will follow it.`:''; $('planBtn').textContent=planFile?'Change floor plan':'Add floor plan'; };
let lookedUp=''; // the address the last lookup found; the server adds its building, street and slope facts
$('photoInput').accept='image/jpeg,image/png,image/webp';
// photos add up across picks (the same file twice counts once); click a thumbnail to remove it
$('photoInput').onchange=e=>{ const max=(health&&health.maxPhotos)||12, same=(a,b)=>a.name===b.name&&a.size===b.size;
  const add=[...e.target.files].filter(f=>!photos.some(p=>same(p,f))), room=max-photos.length;
  photos=[...photos,...add.slice(0,Math.max(0,room))]; renderThumbs();
  status(add.length>room?`Up to ${max} photos; ${add.length-Math.max(0,room)} left out. Click a photo to remove it.`:''); e.target.value=''; };
$('thumbs').onclick=e=>{ const i=e.target&&e.target.dataset&&e.target.dataset.i; if(i===undefined||busyCtl) return;
  photos.splice(Number(i),1); renderThumbs(); status(''); };

// ---------- address lookup: POST /api/lookup, then pick candidate street photos ----------
let cands=[];
function addrStatus(html,err){ $('addrStatus').innerHTML=err?`<span class="status-err">${html}</span>`:html; }
$('addrForm').onsubmit=async e=>{
  e.preventDefault(); const address=$('addrInput').value.trim(); if(!address) return;
  $('addrBtn').disabled=true; cands=[]; $('cands').innerHTML=''; $('candRow').hidden=true; addrStatus('Looking up the address…');
  try{
    const res=await fetch('/api/lookup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({address})});
    const j=await res.json(); if(!res.ok) throw new Error(j.error||`Server error ${res.status}`);
    cands=j.photos.map(p=>({...p,on:false}));
    const where=j.place?`Found ${esc(j.place.label)} (${j.place.precision==='building'?'building':'street'} match, ${esc(j.place.source)}).`:'';
    addrStatus([where,...j.notes.map(esc)].filter(Boolean).join(' ')+(cands.length?` Tap the photos that show this house, front first.`:''));
    $('cands').innerHTML=cands.map((c,i)=>`<button type="button" class="cand" data-i="${i}" aria-pressed="false"><img loading="lazy" src="${esc(c.thumb&&/^https:\/\//.test(c.thumb)?c.thumb:'/api/photo/'+c.id)}" alt="Street photo ${i+1}"><span>${c.distanceM} m away${c.capturedAt?', '+esc(c.capturedAt):''}<br>${esc(c.credit)}</span></button>`).join('');
    $('cands').querySelectorAll('.cand').forEach(b=>b.onclick=()=>{ const c=cands[+b.dataset.i]; c.on=!c.on; b.setAttribute('aria-pressed',c.on); });
    $('candRow').hidden=!cands.length;
    lookedUp=j.place?address:'';
    if(j.terrain&&j.terrain.building) addrStatus($('addrStatus').innerHTML+` Found the building outline${j.terrain.streets&&j.terrain.streets.length>1?` on a corner of ${j.terrain.streets.map(esc).join(' and ')}`:''}: the walls will follow it unless you add a floor plan.`);
  }catch(err){ addrStatus(esc(err.message),true); }
  finally{ $('addrBtn').disabled=false; }
};
$('useCands').onclick=async()=>{
  const pick=cands.filter(c=>c.on), max=(health&&health.maxPhotos)||12;
  if(!pick.length){ addrStatus('Tap one or more photos first.',true); return; }
  $('useCands').disabled=true;
  try{
    for(const c of pick){ if(photos.length>=max) break; if(photos.some(f=>f.name===`mapillary-${c.id}.jpg`)) continue;
      const res=await fetch('/api/photo/'+c.id); if(!res.ok){ const j=await res.json().catch(()=>({})); throw new Error(j.error||`Couldn't download photo ${c.id}`); }
      const f=new File([await res.blob()],`mapillary-${c.id}.jpg`,{type:res.headers.get('content-type')||'image/jpeg'});
      photoCredit.set(f,{credit:c.credit,license:c.license,page:c.page}); photos.push(f); }
    renderThumbs(); addrStatus(`Added. ${photos.length} photo${photos.length===1?'':'s'} ready; you can still add your own.`);
  }catch(err){ addrStatus(esc(err.message),true); }
  finally{ $('useCands').disabled=false; }
};
$('stopBtn').onclick=()=>{ if(busyCtl) busyCtl.abort(); };
$('lastBtn').hidden=true;

// Designs run as jobs on the server. With a design fee set, a new job goes to Stripe Checkout first
// and starts when Stripe sends the owner back paid; either way the page polls the job for progress,
// so paying, reloading or closing the tab doesn't lose it (the job id is in the address bar).
let jobId=null, jobAfter=0, jobHave=0, jobT0=0;
const feeText=()=>health&&health.fee?` (${(health.fee.amountCents/100).toLocaleString(undefined,{style:'currency',currency:health.fee.currency.toUpperCase()})} design fee)`:'';
async function askServer(mode){
  if(busyCtl||jobId&&mode!=='fix') return;
  try{
    if(mode==='fix'){
      const r=await fetch(`/api/jobs/${jobId}/fix`,{method:'POST'}), j=await r.json();
      if(!r.ok) throw new Error(j.error||`Server error ${r.status}`);
      return watchJob(jobId,true);
    }
    const notes=$('notes').value.trim().slice(0,1500), target=Math.max(300,Math.min(2500,+$('target').value||1200));
    if(!photos.length&&!notes){ status('Add at least one photo or a short description first.',true); return; }
    setBusy(true); status('Preparing photos…');
    const big=$('bigPlate').checked;
    const body={notes,target:big?Math.max(target,2400):target,plate:big?48:32,address:lookedUp||undefined,
      plan:planFile?await toPayload(planFile,2400):undefined, photos:await Promise.all(photos.map(f=>toPayload(f))),
      credits:photos.map(f=>photoCredit.get(f)).filter(Boolean), choices:surveyChoices()};
    const res=await fetch('/api/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}), j=await res.json();
    if(!res.ok) throw new Error(j.error||`Server error ${res.status}`);
    if(j.checkout){ status('Taking you to the secure payment page for the design fee…'); location.href=j.checkout; return; }
    watchJob(j.id,false);
  }catch(e){ status(esc(e.message),true); setBusy(false); }
}
function watchJob(id,keep){
  jobId=id; if(!keep){ jobAfter=0; jobHave=0; } jobT0=Date.now(); setBusy(true); $('stopBtn').hidden=true;
  try{ history.replaceState(null,'','?job='+id); }catch(e){}
  status('Claude is studying the photos. This usually takes 15 to 25 minutes; you can close this page and come back with the same address.');
  pollJob();
}
async function pollJob(){
  let j;
  try{ const r=await fetch(`/api/jobs/${jobId}?after=${jobAfter}&have=${jobHave}`); j=await r.json(); if(!r.ok) throw new Error(j.error||`Server error ${r.status}`); }
  catch(e){ status(esc(e.message),true); setTimeout(pollJob,5000); return; }
  if(j.draft){ jobHave=j.draftN; showDesign(j.draft); $('designSrc').value=JSON.stringify(j.draft,null,2); }
  for(const ev of j.events) handleEvent(ev.type==='done'&&j.result?j.result:ev,jobT0);
  jobAfter=j.next;
  if(j.status==='awaiting_payment'){ status(`This design is waiting for its design fee.`); setBusy(false); return; }
  if(j.status==='interrupted'){ status('The server restarted during this design. Reload this page to pick it up again.',true); setBusy(false); return; }
  if(j.status==='done'||j.status==='error'){ setBusy(false); return; }
  setTimeout(pollJob,2000);
}
function handleEvent(ev,t0){
  const secs=()=>Math.round((Date.now()-t0)/1000);
  if(ev.type==='status') status(`${esc(ev.message)} <span style="color:var(--muted)">${secs()} s</span>`);
  else if(ev.type==='part') status(`Building part ${ev.n} of ${ev.of}: ${esc(ev.name)}… <span style="color:var(--muted)">${secs()} s</span>`);
  else if(ev.type==='draft') status(`Draft ${ev.n} compiled: ${ev.stats.pieces.toLocaleString()} pieces, ${ev.errors} errors, ${ev.warnings} warnings. Claude is revising… <span style="color:var(--muted)">${secs()} s</span>`);
  else if(ev.type==='done'&&ev.design){ const t=JSON.stringify(ev.design,null,2); $('designSrc').value=t; run(t); DESIGN_TEXT=t;
    status(`Done: ${ev.stats.pieces.toLocaleString()} pieces, ${ev.errors} errors, ${ev.warnings} warnings. Saved as designs/${esc(ev.saved)}.json.`
      +(ev.note?` ${esc(ev.note)}`:'')+((ev.errors||ev.warnings)?' <button class="btn sm" id="fixBtn">Ask Claude to fix these</button>':''));
    const fb=$('fixBtn'); if(fb) fb.onclick=()=>askServer('fix'); loadDesignList(ev.saved); }
  else if(ev.type==='error') status(esc(ev.message),true);
}
$('designBtn').onclick=()=>askServer('design');

// ---------- survey: POST /api/survey, a quick first look that asks about what the photos leave open ----------
function renderSurvey(sv){
  const opt=(q,o)=>`<label class="opt"><input type="radio" name="sq-${esc(q.id)}" value="${esc(o.id)}"${o.id===q.recommended?' checked':''}><span>${esc(o.label)}${o.id===q.recommended?'<span class="rec">what the photos suggest</span>':''}${o.detail?`<small>${esc(o.detail)}</small>`:''}</span></label>`;
  $('survey').innerHTML=(sv.summary?`<p class="sum">${esc(sv.summary)}</p>`:'')+sv.questions.map(q=>
    `<fieldset><legend>${esc(q.question)}</legend>${q.why?`<p class="why">${esc(q.why)}</p>`:''}${q.options.map(o=>opt(q,o)).join('')}</fieldset>`).join('');
  $('survey').hidden=false;
}
function surveyChoices(){
  if(!survey) return undefined;
  return survey.questions.map(q=>{ const v=(document.querySelector(`input[name="sq-${CSS.escape(q.id)}"]:checked`)||{}).value;
    const o=q.options.find(x=>x.id===v)||q.options.find(x=>x.id===q.recommended); return o&&{question:q.question,answer:o.label,detail:o.detail||''}; }).filter(Boolean);
}
$('surveyBtn').hidden=true;
$('surveyBtn').onclick=async()=>{
  if(busyCtl||!photos.length) return;
  const ctl=new AbortController(); busyCtl=ctl; setBusy(true);
  status('Taking a quick look at the photos for anything they leave open…');
  try{
    const body={notes:$('notes').value.trim().slice(0,1500),photos:await Promise.all(photos.map(f=>toPayload(f))),address:lookedUp||undefined,
      plate:$('bigPlate').checked?48:32,plan:planFile?await toPayload(planFile,2400):undefined};
    const res=await fetch('/api/survey',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:ctl.signal});
    const j=await res.json(); if(!res.ok) throw new Error(j.error||`Server error ${res.status}`);
    survey=j; renderSurvey(j);
    status(`${j.questions.length} question${j.questions.length===1?'':'s'}. The photos' best guess is picked; change any answer, then design.`);
  }catch(e){ status(e.name==='AbortError'?'Stopped.':esc(e.message),e.name!=='AbortError'); }
  finally{ busyCtl=null; setBusy(false); }
};

async function loadDesignList(selected){
  try{ const list=await (await fetch('/api/designs')).json(); const sel=$('designPick'); const cur=selected||new URLSearchParams(location.search).get('design')||'634-unit-a';
    sel.innerHTML=list.map(n=>`<option value="${esc(n)}"${n===cur?' selected':''}>${esc(n)}</option>`).join(''); $('pickWrap').hidden=!list.length;
    sel.onchange=()=>{ location.search='?design='+encodeURIComponent(sel.value); };
  }catch(e){}
}

// ---------- tabs & theme ----------
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.tabs button').forEach(x=>x.setAttribute('aria-selected',x===b));
  ['model','manual','parts','design'].forEach(t=>$('pane-'+t).hidden=t!==b.dataset.tab);
});
function applyTheme(){ const c=getComputedStyle(document.documentElement).getPropertyValue('--stage').trim()||'#D9E2EB'; stageLin=lin(c); scene.background=new THREE.Color(c); if(R) applyState(); dirty=true; }
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyTheme);

async function boot(){
  applyTheme();
  const embedded=document.getElementById('designJson');
  const name=new URLSearchParams(location.search).get('design')||'634-unit-a';
  try{
    DESIGN_TEXT=embedded?embedded.textContent.trim():await (await fetch('/designs/'+name.split('/').map(encodeURIComponent).join('/')+'.json')).text();
  }catch(e){ DESIGN_TEXT='{"name":"No design loaded","phases":[],"ops":[]}'; }
  $('designSrc').value=DESIGN_TEXT; run(DESIGN_TEXT); $('compileOut').innerHTML='';
  resize(); goal.radius=fitRadius(); radius=goal.radius*1.25; loop();
  if(embedded){ $('photoIntro').textContent='This is a standalone copy. Run the Brickhouse server (npm start) to design houses from photos.'; return; }
  try{ health=await (await fetch('/api/health')).json(); }catch(e){ health=null; }
  loadDesignList();
  if(!health){ $('photoIntro').textContent='Start the server with npm start to design from photos.'; return; }
  if(!health.ready){ $('photoIntro').textContent='Add BRICKHOUSE_ANTHROPIC_API_KEY to .env and restart the server to design from photos (or run with BRICKHOUSE_FAKE=1 to try the flow).'; return; }
  $('photoControls').hidden=false;
  $('photoIntro').textContent=`Enter the address to find street photos${health.streetPhotos?'':' (needs MAPILLARY_TOKEN)'}, or pick up to ${health.maxPhotos} exterior photos, front first, then each side, the back, the garage and any yard or patio: Claude builds only what a photo, the floor plan or your notes show, so a side no photo shows gets guessed. Claude (${health.model}) studies them, writes a design, compiles it here, fixes what the checker flags, and saves it.`;
  renderThumbs();
  // Back from Stripe (?job=…&session=…): confirm the payment and start the design; ?job=… alone
  // picks up a design in progress or finished.
  const q=new URLSearchParams(location.search), qj=q.get('job');
  if(qj&&q.get('canceled')){ status('Payment canceled; nothing was charged. Your photos are still here if you want to try again.'); try{ history.replaceState(null,'','/'); }catch(e){} }
  else if(qj&&q.get('session')){ status('Confirming the payment…');
    const r=await fetch(`/api/jobs/${qj}/start`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({session:q.get('session')})}), j=await r.json();
    if(!r.ok) status(esc(j.error||'The payment could not be confirmed.'),true); else watchJob(qj,false); }
  else if(qj) watchJob(qj,false);
}
boot();
