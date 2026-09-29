// Brickhouse viewer: rendering, manual, parts, design editor, photo jobs.
// Needs three.js r128 (global THREE) and src/engine/engine.js (global compile, COLORS).
const $=id=>document.getElementById(id);
// ?hero=1 (or window.BRICKHOUSE_HERO, for rendering its still picture) is the landing page's live picture:
// only the model, from one view, on a transparent background so the page shows through, its top story
// lifting a little while the pointer is over it (a tap on touch screens). ?hero=build plays the building
// guide instead, step after step, over and over (window.BRICKHOUSE_STILL shows it finished, for a picture).
const HERO_MODE=new URLSearchParams(location.search).get('hero')||(window.BRICKHOUSE_HERO===true?'1':window.BRICKHOUSE_HERO||null);
const HERO=HERO_MODE==='1'||HERO_MODE==='build', BUILD=HERO_MODE==='build';
if(HERO) document.documentElement.classList.add('hero');
// ?dev=1 shows the technical view (design list, checker counts, part numbers, suppliers, design code) and
// remembers it in this browser (?dev=0 forgets it); standalone copies are technical. Customers see neither.
const DEV=!HERO&&(()=>{ const q=new URLSearchParams(location.search).get('dev');
  try{ if(q==='1') localStorage.setItem('brickhouse-dev','1'); if(q==='0') localStorage.removeItem('brickhouse-dev'); if(localStorage.getItem('brickhouse-dev')==='1') return true; }catch(e){ if(q==='1') return true; }
  return !!document.getElementById('designJson'); })();
if(DEV) document.documentElement.classList.add('dev');
const canvas=$('cv'), stage=$('stage');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:HERO});
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
  if(p.shape==='palm'||p.key==='bush224') return [p.x+p.w/2-OFF,p.y*PH,p.z+p.d/2-OFF,0]; // drawn up from the base
  if(p.shape==='pine') return [p.x+p.w/2-OFF,(p.y+1)*PH,p.z+p.d/2-OFF,0]; // its base plate hangs a plate below LDraw's origin
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

function strengthHex(p){ if(!R.jn.has(p.id)) return COLORS[p.color].hex; const area=p.shape==='arch'?4:p.w*p.d; const r=R.jn.get(p.id)/area; return r<0.5?'#D64B34':r<1?'#E8A93A':'#3E9E68'; }

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
  } else if(p.shape==='pine'){ // a molded pine: a short base, then tiers of branches narrowing to the tip
    const r=p.w/2, n=p.w>2?4:3; put(new THREE.CylinderGeometry(0.7,0.7,PH*1.5,12),0,PH*0.75,0);
    for(let i=0;i<n;i++){ const hi=(H-PH*1.5)/n*1.35, rr=r*(1-i/(n+0.6)); put(new THREE.ConeGeometry(rr,hi,12),0,PH*1.5+(H-PH*1.5)/n*i+hi/2,0); }
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
  if(!showAll&&!cur&&!HERO) col.lerp(stageLin,0.42); // (the landing page's build keeps its colors)
  return col;
}
function applyState(){
  if(!R) return;
  mode=(!showAll&&R.steps[stepIdx].kind==='sub')?'sub':'main';
  for(const p of R.parts){ const [v,c]=partState(p); p._v=v||anims.has(p.id); p._c=c; }
  for(const r of inst){ r.mesh.setMatrixAt(r.i,r.p._v?r.m:ZERO); r.mesh.setColorAt(r.i,r.glass?col.copy(lin(COLORS['Trans-Clear'].hex)):colorFor(r.p,r.p._c)); }
  for(const m of meshes){ m.instanceMatrix.needsUpdate=true; if(m.instanceColor) m.instanceColor.needsUpdate=true; }
  for(const s of specials){ s.obj.visible=s.p._v; s.obj.position.copy(s.pos0); s.obj.rotation.set(0,s.rot0,0); s.obj.scale.setScalar(1); for(const o of s.mats){ if(o.glass) continue; o.mat.color.copy(colorFor(s.p,s.p._c)); } }
  const baseHex=COLORS[R.stats.baseColor||'Green'].hex;
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
function fitRadius(){ const a=camera.aspect, k=PLATE/32*(HERO?0.88:1); return Math.min(170*k,Math.max(82*k,77*k/Math.max(a,0.45))); }
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
if(HERO&&!BUILD){ // hovering (or tapping) lifts the top story; dragging tilts the house a little, which springs back
  // on release; no zooming, and an up-and-down swipe scrolls the page as usual
  canvas.addEventListener('pointerenter',e=>{ if(e.pointerType==='mouse'){ liftGoal=1; dirty=true; } });
  canvas.addEventListener('pointerleave',e=>{ if(e.pointerType==='mouse'&&!drag){ liftGoal=0; dirty=true; } });
  canvas.addEventListener('pointerdown',e=>{ drag={id:e.pointerId,x:e.clientX,y:e.clientY,t0:tilt.t,p0:tilt.p,moved:false,type:e.pointerType}; tilt.vt=tilt.vp=0;
    try{ canvas.setPointerCapture(e.pointerId); }catch(err){} });
  // rubber band: the further the drag, the less it turns
  const band=(v,m)=>m*Math.tanh(v/m);
  canvas.addEventListener('pointermove',e=>{ if(!drag||e.pointerId!==drag.id) return; const dx=e.clientX-drag.x, dy=e.clientY-drag.y;
    if(Math.hypot(dx,dy)>6) drag.moved=true; tilt.t=band(drag.t0-dx*0.006,0.5); tilt.p=band(drag.p0-dy*0.005,0.3); dirty=true; });
  const endDrag=e=>{ if(!drag||e.pointerId!==drag.id) return; const d=drag; drag=null;
    if(e.type==='pointerup'&&!d.moved&&d.type!=='mouse') liftGoal=liftGoal?0:1; dirty=true; };
  canvas.addEventListener('pointerup',endDrag); canvas.addEventListener('pointercancel',endDrag); }
else canvas.addEventListener('pointerdown',e=>{ canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY}); document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed','false'));
  if(ptrs.size===2){ const [a,b]=[...ptrs.values()]; pinch0=Math.hypot(a.x-b.x,a.y-b.y); r0=goal.radius; } });
canvas.addEventListener('pointermove',e=>{ if(!ptrs.has(e.pointerId)) return; const p=ptrs.get(e.pointerId);
  if(ptrs.size===1){ goal.theta-=(e.clientX-p.x)*0.008; goal.phi=Math.max(0.06,Math.min(1.5,goal.phi-(e.clientY-p.y)*0.006)); theta=goal.theta; phi=goal.phi; }
  p.x=e.clientX; p.y=e.clientY;
  if(ptrs.size===2){ const [a,b]=[...ptrs.values()], d=Math.hypot(a.x-b.x,a.y-b.y); if(pinch0){ goal.radius=Math.max(10,Math.min(170,r0*pinch0/d)); radius=goal.radius; userZoom=true; } }
  dirty=true; });
const endPtr=e=>{ ptrs.delete(e.pointerId); if(ptrs.size<2) pinch0=0; };
canvas.addEventListener('pointerup',endPtr); canvas.addEventListener('pointercancel',endPtr);
if(!HERO) canvas.addEventListener('wheel',e=>{ e.preventDefault(); goal.radius=Math.max(10,Math.min(170,goal.radius*(1+e.deltaY*0.001))); radius=goal.radius; userZoom=true; dirty=true; },{passive:false});
function resize(){ const w=stage.clientWidth,h=stage.clientHeight; if(!w||!h) return; // hidden (the upload page)
  renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); if(!userZoom&&mode==='main'){ goal.radius=fitRadius(); } dirty=true; }
new ResizeObserver(resize).observe(stage);
const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function loop(){ requestAnimationFrame(loop);
  const k=reduceMotion?1:0.14; let moving=false;
  const ease=(a,b)=>{ const d=b-a; if(Math.abs(d)>1e-4){ moving=true; return a+d*k; } return b; };
  if(autoSpin){ goal.theta+=HERO?0.0028:0.004; moving=true; }
  if(HERO&&heroStep(performance.now())) moving=true;
  if(anims.size){ animFrame(performance.now()); moving=true; }
  theta=ease(theta,goal.theta); phi=ease(phi,goal.phi); radius=ease(radius,goal.radius);
  const tx=ease(target.x,goal.t.x), ty=ease(target.y,goal.t.y), tz=ease(target.z,goal.t.z); target.set(tx,ty,tz);
  if(moving||dirty){ placeCam(); renderer.render(scene,camera); dirty=false; } }

// ---------- hero: the top story lifts a little ----------
// the story whose walls stand highest on another, and the building above it (a one-story house: its roofs);
// not trees and plants, whose tops only reach that high
let liftT=0, liftGoal=0, liftV=0, liftParts=[];
// the hero's view, the drag's tilt away from it (springing back once let go), and the last frame's time
const HERO_VIEW=BUILD?{t:0.62,p:0.98}:{t:-0.35,p:1.1}; let drag=null, heroLast=0; const tilt={t:0,p:0,vt:0,vp:0};
// the lift springs up, overshooting a little, and falls back with a bounce; the tilt wobbles back into place
function heroStep(now){ const dt=Math.min(0.033,heroLast?(now-heroLast)/1000:0.016); heroLast=now; let busy=false;
  if(Math.abs(liftGoal-liftT)>1e-3||Math.abs(liftV)>1e-3){
    if(reduceMotion){ liftT=liftGoal; liftV=0; }
    // going up: a spring, overshooting a little; coming down: it falls, lands, and hops a plate or so, twice
    else if(liftGoal){ liftV+=(170*(liftGoal-liftT)-13*liftV)*dt; liftT+=liftV*dt; }
    else { liftV-=60*dt; liftT+=liftV*dt; if(liftT<=0){ liftT=0; liftV=-liftV*0.42; if(liftV<1.2) liftV=0; } }
    if(Math.abs(liftGoal-liftT)<1e-3&&Math.abs(liftV)<1e-3){ liftT=liftGoal; liftV=0; }
    liftTo(liftT); busy=true; }
  if(!drag&&(Math.abs(tilt.t)+Math.abs(tilt.p)+Math.abs(tilt.vt)+Math.abs(tilt.vp)>1e-4)){
    if(reduceMotion){ tilt.t=tilt.p=tilt.vt=tilt.vp=0; }
    else { tilt.vt+=(-120*tilt.t-11*tilt.vt)*dt; tilt.vp+=(-120*tilt.p-11*tilt.vp)*dt; tilt.t+=tilt.vt*dt; tilt.p+=tilt.vp*dt; }
    busy=true; }
  if(busy||drag){ theta=goal.theta=HERO_VIEW.t+tilt.t; phi=goal.phi=HERO_VIEW.p+tilt.p; }
  return busy||!!drag; }
const GROWN=['plant','sub','lawn','fence'];
function topStory(){ const ops=curDesign.ops||[], bases=ops.filter(o=>o.op==='walls'&&!o.context&&(o.base||0)>0).map(o=>o.base);
  const built=R.parts.filter(p=>!GROWN.includes((ops[p.op]||{}).op));
  return bases.length?built.filter(p=>p.y>=Math.max(...bases)):built.filter(p=>(ops[p.op]||{}).op==='roof'); }
// shadows are redrawn every frame here: between redraws a descending roof sits just under its own stale
// shadow and shades itself, then doesn't, which flickers
function liftTo(t){ const dy=7*PH*t; m4.makeTranslation(0,dy,0);
  for(const p of liftParts){ const r=recOf.get(p.id); if(!r) continue;
    if(r.obj){ r.obj.position.set(r.pos0.x,r.pos0.y+dy,r.pos0.z); continue; }
    r.mesh.setMatrixAt(r.i,p._v?m4b.copy(m4).multiply(r.m):ZERO); r.mesh.instanceMatrix.needsUpdate=true;
    for(const e of r.extra||[]){ e.mesh.setMatrixAt(e.i,p._v?m4b.copy(m4).multiply(e.m):ZERO); e.mesh.instanceMatrix.needsUpdate=true; }
    for(const si of studsOf.get(p.id)||[]){ const sr=studRecs[si]; if(sr.slot>=0) studs.setMatrixAt(sr.slot,m4b.copy(m4).multiply(sr.m)); } }
  studs.instanceMatrix.needsUpdate=true; renderer.shadowMap.needsUpdate=true; }

// ?hero=build: the guide's steps, one after another, then the finished house for a moment, and again;
// the page pauses it while it's out of sight ({brickhouse:'pause'|'play'}) and hears which step it's on
function playBuildLoop(){
  const order=R.steps.map((s,i)=>i).filter(i=>R.steps[i].kind!=='sub'); let k=0, playing=true, timer=null;
  const tell=(n)=>{ try{ parent.postMessage({brickhouse:'step',n,of:order.length},location.origin); }catch(e){} };
  const tick=()=>{ if(!playing) return;
    if(k<order.length){ showAll=false; stepIdx=order[k++]; renderStep(); tell(k); timer=setTimeout(tick,reduceMotion?700:430); }
    else { showAll=true; renderStep(); tell(order.length); k=0; timer=setTimeout(tick,2800); } };
  addEventListener('message',e=>{ if(e.origin!==location.origin||!e.data) return;
    if(e.data.brickhouse==='pause'){ playing=false; clearTimeout(timer); }
    if(e.data.brickhouse==='play'&&!playing){ playing=true; tick(); } });
  tick(); }

// ---------- bricks in motion ----------
// Play build drops each step's bricks straight down into place one after another; lifting a roof or floor
// raises its bricks straight up one by one, top first, and putting it back lowers them, bottom first.
const m4=new THREE.Matrix4(), m4b=new THREE.Matrix4(), eul=new THREE.Euler(), v3=new THREE.Vector3();
const easeIn=t=>t*t, easeOut=t=>1-(1-t)*(1-t);
function centerOf(p){ return v3.set(p.x+p.w/2-OFF,(p.y+p.h/2)*PH,p.z+p.d/2-OFF); }
function animFrame(now){
  let done=false, touched=false, down=false;
  for(const [id,a] of anims){
    const t=(now-a.t0)/a.dur, p=R.parts[id-1], r=recOf.get(id); if(!r) { anims.delete(id); continue; }
    if(t>=1){ anims.delete(id); settle(p,r); done=true; continue; }
    const e=t<0?0:a.ease(t), hide=t<0&&a.hideBefore; if(t>=0&&a.to[1]<a.from[1]) down=true;
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
  // shadows follow the moving bricks a few times a second, not every frame; but every frame while any brick
  // comes down, since between redraws it sits under its own stale shadow and shades itself (a flicker)
  if(done||down||++shadowTick%4===0) renderer.shadowMap.needsUpdate=true;
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
const inventoryPages=()=>Math.ceil((R.stats.lots||R.inventory.length)/24);
let shownIdx=-1, shownAll=true;
function renderStep(){
  // one step on (Play skips sub-build steps: their bricks come down with the placed sub-build)
  const forward=!showAll&&!shownAll&&stepIdx>shownIdx&&R.steps.slice(shownIdx+1,stepIdx).every(s=>s.kind==='sub'),
    fromStart=!showAll&&shownAll&&R.steps.slice(0,stepIdx).every(s=>s.kind==='sub');
  if(!forward&&!fromStart) anims.clear();
  shownIdx=stepIdx; shownAll=showAll;
  const n=R.steps.length; $('slider').max=n-1; $('slider').value=showAll?n-1:stepIdx;
  const total=R.preview?R.stats.steps:n; // a preview carries only its first few steps
  const box=$('stepParts'); box.innerHTML=''; const tag=$('subTag');
  if(showAll||!n){ $('stepNum').textContent='✓'; $('stepTitle').textContent='Finished model'; $('stepOf').textContent=`${R.stats.pieces.toLocaleString()} pieces in ${total} steps`; tag.style.visibility=''; tag.textContent='\u00a0';
    box.innerHTML=R.preview?`<div class="guidelock"><p>This preview shows the first ${n} step${n===1?'':'s'}. The other ${total-n} come with your kit, along with every piece.</p><button class="btn primary" data-order>${orderLabel()}</button><p class="note kitordernote" data-ordernote></p></div>`
      :'<span class="note" style="margin:0">Press Next or Start from step 1 to walk through the build.</span>'; }
  else {
    const s=R.steps[stepIdx]; $('stepNum').textContent=stepIdx+1;
    $('stepTitle').textContent=s.kind==='main'?s.title:(s.kind==='sub'?R.subs[s.sub].name:s.title);
    $('stepOf').textContent=`Step ${stepIdx+1} of ${total}, page ${stepIdx+2+inventoryPages()}`;
    if(s.kind==='sub'){ const sub=R.subs[s.sub]; tag.style.visibility='visible'; tag.textContent=`Sub-build ${s.n} of ${s.of}`+(sub.copies>1?`, make ${sub.copies}`:''); }
    else if(s.kind==='main'&&s.of>1){ tag.style.visibility='visible'; tag.textContent=`${s.n} of ${s.of} in this section`; } else { tag.style.visibility=''; tag.textContent='\u00a0'; }
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
$('finished').onclick=$('showWhole').onclick=()=>{ stopPlay(); showAll=true; stepIdx=R.steps.length-1; renderStep(); };

// ---------- showcase playback ----------
let playTimer=null, draftOnly=false; // draftOnly: the stage shows a draft of a design still in progress
function updateShowLabel(){
  const lbl=$('showLbl'), bar=$('barFill'), mainSteps=R.steps.filter(s=>s.kind!=='sub');
  $('showWhole').hidden=showAll;
  if(showAll){ lbl.innerHTML=(draftOnly?'<b>Draft</b> so far, ':'<b>Finished</b> ')+R.stats.pieces.toLocaleString()+' pieces'; bar.style.width='100%'; return; }
  const s=R.steps[stepIdx], k=mainSteps.indexOf(s);
  lbl.innerHTML=`<b>${stepIdx+1} / ${R.preview?R.stats.steps:R.steps.length}</b> ${s.kind==='main'?s.title:(s.kind==='sub'?R.subs[s.sub].name:s.title)}`;
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
// GoBricks (compatible bricks): the engine's catalog snapshot gives each lot's GDS number and a catalog
// price; on the server, a quote (/api/quote) adds today's price and stock, asked for when the Parts tab shows
const GB=typeof SUPPLIERS!=='undefined'&&SUPPLIERS.gobricks;
let gq={key:null,q:null,busy:false,err:null};
const gdsLots=()=>R.inventory.map(e=>({no:e.no,color:e.color,q:e.q,name:e.name}));
const lotsKey=lots=>JSON.stringify(lots.map(l=>[l.no,l.color,l.q]));
const yuan=v=>'¥'+v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
// GoBricks' yuan prices to what its store, Brickwith, charges in dollars: the 634 sample's ¥153.07 came to
// $43.88 there on 2026-09-28, about ¥3.5 a dollar (twice what the exchange rate gives)
const cnyPerUsd=()=>(health&&health.cnyPerUsd)||3.5, usd=v=>'$'+Math.round(v/cnyPerUsd()).toLocaleString();
async function fetchQuote(){
  if(!GB||!health||!health.quote||!R) return;
  const lots=gdsLots(), key=lotsKey(lots); if(!lots.length||(gq.key===key&&(gq.q||gq.busy||gq.err))) return;
  gq={key,q:null,busy:true,err:null}; renderParts();
  try{ const r=await fetch('/api/quote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lots})}), j=await r.json();
    if(!r.ok) throw new Error(j.error||('HTTP '+r.status)); if(gq.key===key) gq.q=j; }
  catch(e){ if(gq.key===key) gq.err=e.message; }
  if(gq.key===key){ gq.busy=false; renderParts(); } }
function renderParts(){
  // before the kit is ordered: what's in it (a preview has no list)
  $('kitLock').hidden=!R.preview; $('kitList').hidden=!!R.preview;
  if(R.preview){ const st=R.stats, cs=st.colors||[];
    $('pLots').textContent=st.lots; $('pPieces').textContent=st.pieces.toLocaleString();
    $('kitLead').innerHTML=`Your kit: <b>${st.pieces.toLocaleString()}</b> pieces in <b>${st.lots}</b> kinds and <b>${cs.length}</b> colors, on a ${st.plate>32?'Grand':'Classic'} baseplate.`;
    $('kitSwatches').innerHTML=cs.map(c=>`<span title="${esc(c.color)}"><i style="background:${COLORS[c.color]?COLORS[c.color].hex:'#999'}"></i>${esc(c.color)}</span>`).join('');
    $('partsBody').innerHTML=''; xml=''; refreshOrderUI(); return; } // nothing of a list left in the page
  const rows=R.inventory.slice().sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})||b.q-a.q);
  $('pLots').textContent=rows.length; $('pPieces').textContent=R.stats.pieces.toLocaleString(); $('pCost').textContent='$'+Math.round(R.stats.cost);
  const live=GB&&gq.q&&gq.key===lotsKey(gdsLots())?gq.q:null, K=r=>r.no+'|'+r.color;
  const livePrice=new Map(live?live.items.map(i=>[K(i),i.price]):[]), oos=new Set(live?live.outOfStock.map(K):[]);
  // GoBricks' own baseplate carries its dollar price; everything else is priced in yuan
  const each=r=>r.usd!=null?r.usd*cnyPerUsd():live?(livePrice.has(K(r))?livePrice.get(K(r)):null):(GB&&GB.made[r.no]?GB.made[r.no][r.color]:null);
  const gdsNo=r=>supplierNo(GB,r.no,r.color)||r.gds||(r.kind==='baseplate'?'not at GoBricks':'—');
  const priceCell=r=>{ const p=each(r); if(p!=null) return `<span title="${yuan(p)} each">${yuan(p*r.q)}</span>`;
    return oos.has(K(r))?'out of stock':r.kind==='baseplate'?'not sold':'—'; };
  $('gdsHead').hidden=!GB;
  $('partsBody').innerHTML=rows.map(r=>`<tr><td><span class="sw" style="background:${COLORS[r.color].hex}"></span></td><td>${r.name}</td><td class="dev-only">${r.no}${GB?`<small class="gds" title="GoBricks part number">${gdsNo(r)}</small>`:''}</td><td>${r.color}</td><td class="n">${r.q}</td>${GB?`<td class="yuan dev-only">${priceCell(r)}</td>`:''}</tr>`).join('');
  $('gdsOrder').hidden=!GB; $('gdsNote').hidden=!GB; $('pGdsBox').hidden=!GB;
  if(GB){
    const gap=rows.filter(r=>r.kind!=='baseplate'&&!supplierNo(GB,r.no,r.color)), gp=gap.reduce((n,r)=>n+r.q,0);
    const est=rows.reduce((s,r)=>s+(GB.made[r.no]&&GB.made[r.no][r.color]!=null?r.q*GB.made[r.no][r.color]:0),0);
    const own=rows.filter(r=>r.usd!=null), ownY=own.reduce((s,r)=>s+r.q*each(r),0), total=(live?live.total:est)+ownY;
    // GoBricks sells no green baseplate; a design held to GoBricks takes a neutral one it does sell
    const plate=rows.find(r=>r.kind==='baseplate'), noPlate=plate&&each(plate)==null;
    $('pGds').textContent=yuan(total);
    $('pGdsLabel').textContent=(live?`GoBricks today, about ${usd(total)} at Brickwith`:gq.busy?`GoBricks, checking today's price…`:`GoBricks catalog, about ${usd(total)} at Brickwith`)+(noPlate?', no baseplate':'');
    const list=(a,f)=>a.slice(0,4).map(f).join(', ')+(a.length>4?', …':'');
    const says=live?`GoBricks quoted ${yuan(total)} (about ${usd(total)} at Brickwith) for the ${(live.pieces+own.reduce((n,r)=>n+r.q,0)).toLocaleString()} pieces it has in stock today, before shipping.`+
        (live.outOfStock.length?` Out of stock right now: ${list(live.outOfStock,i=>esc(`${i.name} in ${i.color} (${i.q})`))}; their tool offers substitutes.`:'')+
        (live.notMade.filter(i=>!plate||i.no!==plate.no).length?` It doesn't make ${list(live.notMade.filter(i=>!plate||i.no!==plate.no),i=>esc(`${i.name} in ${i.color} (${i.q})`))}.`:'')
      :`At GoBricks' catalog prices on ${GB.asOf} these parts come to about ${yuan(est)} (about ${usd(est)} at Brickwith) before shipping; `+
        (gq.err?`today's quote didn't come back (${esc(gq.err)}).`:health&&health.quote?`checking today's price and stock…`:`the Brickhouse server checks today's price and stock.`)+
        (gap.length?` It doesn't make ${gap.length} of these lots (${gp} piece${gp===1?'':'s'}: ${list(gap,r=>r.name+' in '+r.color)}); get those from BrickLink, or hold the design to GoBricks ("supplier": "gobricks") and it uses only what GoBricks makes.`:' It makes every part here.');
    $('gdsNote').innerHTML=`GoBricks makes compatible bricks at a fraction of the price. ${says} <b>Order from GoBricks</b> saves this list as a BrickLink XML file for their <a href="${GB.order}" target="_blank" rel="noopener">part list tool</a>. `+
      (noPlate?`GoBricks doesn't sell the ${plate.name.toLowerCase()} in ${plate.color} right now, so the total leaves it out: any compatible one fits, or hold the design to GoBricks ("supplier": "gobricks") and it uses GoBricks' own green baseplate. `:'')+
      own.map(r=>`The ${esc(r.name.toLowerCase())} (${r.gds.replace(/-\d+$/,'')}, green) is GoBricks' own part with no LEGO number, so the uploaded list can't carry it: add it by searching ${r.gds.replace(/-\d+$/,'')} at Brickwith. `).join('')+`Check colors against a sample before a big order.`;
    if(!$('pane-parts').hidden) fetchQuote();
  }
  xml='<INVENTORY>\n'+rows.map(r=>`  <ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>${r.no}</ITEMID><COLOR>${COLORS[r.color].bl}</COLOR><MINQTY>${r.q}</MINQTY></ITEM>`).join('\n')+'\n</INVENTORY>';
  $('xmlOut').hidden=true;
}
$('gdsOrder').onclick=()=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([xml],{type:'application/xml'}));
  a.download=((curDesign&&curDesign.name)||'brickhouse').replace(/[^\w.-]+/g,'-')+'-parts.xml'; document.body.appendChild(a); a.click(); a.remove();
  // (where a page can't save files, as in some embedded previews, the list is on the clipboard too)
  navigator.clipboard&&navigator.clipboard.writeText(xml).then(()=>{ $('gdsOrder').textContent='Saved (and copied) the parts list'; setTimeout(()=>$('gdsOrder').textContent='Order from GoBricks',2400); },()=>{});
  window.open(SUPPLIERS.gobricks.order,'_blank','noopener'); };
$('copyXml').onclick=async()=>{ const b=$('copyXml');
  try{ await navigator.clipboard.writeText(xml); b.textContent='Copied wanted list'; setTimeout(()=>b.textContent='Copy BrickLink wanted list',1800); }
  catch(e){ const t=$('xmlOut'); t.value=xml; t.hidden=false; t.select(); b.textContent='Select and copy below'; } };

// ---------- the kit order: unlocks the full guide and parts list ----------
let kitInfo=null; // from the job: {kit, kitCents, kitCurrency}
function orderLabel(){ const c=kitInfo&&kitInfo.kitCents; return c?`Order your kit, ${(c/100).toLocaleString(undefined,{style:'currency',currency:(kitInfo.kitCurrency||'usd').toUpperCase(),maximumFractionDigits:c%100?2:0})}`:'Order your kit'; }
function refreshOrderUI(){ document.querySelectorAll('[data-order]').forEach(b=>{ b.textContent=orderLabel(); b.hidden=!jobId; });
  const k=kitInfo&&kitInfo.kit, done=$('kitDone'); done.hidden=!k||!!R.preview;
  if(k) done.textContent=k.test?'Test order: this site takes no payments yet, so the full guide and parts list are unlocked.':'Your kit is ordered. Thank you! The full guide and parts list are unlocked.'; }
async function orderKit(b){
  const notes=document.querySelectorAll('[data-ordernote]'), say=t=>notes.forEach(n=>n.textContent=t);
  b.disabled=true; say('Taking you to the secure checkout…');
  try{ const r=await fetch(`/api/jobs/${jobId}/kit`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}), j=await r.json();
    if(!r.ok) throw new Error(j.error||`Server error ${r.status}`);
    if(j.checkout){ location.href=j.checkout; return; }
    location.href=`/app?job=${jobId}`; } // a test order: reload with the full design
  catch(e){ say(DEV||!TECHNICAL.test(e.message)?e.message:'We couldn\'t start the order just now. Please try again in a little while.'); b.disabled=false; } }
document.addEventListener('click',e=>{ const b=e.target.closest('[data-order]'); if(b&&!b.disabled) orderKit(b); });

// ---------- model report ----------
function renderReport(){
  const st=R.stats;
  $('sPieces').textContent=st.pieces.toLocaleString(); $('sSteps').textContent=st.steps; $('sPages').textContent=st.pages; $('sMs').textContent=(st.ms/1000).toFixed(2)+' s';
  const e=$('sErr'), w=$('sWarn'); e.querySelector('b').textContent=R.errors.length+(R.errors.length?'':' ✓'); w.querySelector('b').textContent=R.warnings.length+(R.warnings.length?'':' ✓');
  e.classList.toggle('bad',!!R.errors.length); e.classList.toggle('ok',!R.errors.length); w.classList.toggle('bad',!!R.warnings.length); w.classList.toggle('ok',!R.warnings.length);
  $('verdict').textContent=R.errors.length?(DEV?`${R.errors.length} problem${R.errors.length>1?'s':''} to fix before this can ship.`:'We\'re still finishing a few details of this design.')
    :DEV?`Every piece locks to the baseplate through ${st.joints.toLocaleString()} stud joints, checked in build order.`
    :`Checked brick by brick: all ${st.joints.toLocaleString()} connections hold, in the order you'll build it.`;
  const list=[...R.errors.map(x=>['e',x]),...R.warnings.map(x=>['w',x])].slice(0,12);
  $('problems').innerHTML=list.map(([t,x])=>`<li class="${t}">${x.msg}${x.op!=null?` (design step ${x.op+1})`:''}</li>`).join('');
  $('chips').innerHTML=`<span><b>${st.pieces.toLocaleString()}</b>pieces</span><span><b>${st.steps}</b>steps</span><span><b>${PLATE>32?'Grand':'Classic'}</b>size</span>`
    +(DEV?`<span><b>${st.subBuilds}</b>sub-builds</span><span><b>${PLATE}×${PLATE}</b>studs</span><span><b>$${Math.round(st.cost)}</b>parts</span>`:'');
}
$('stress').onchange=e=>{ stress=e.target.checked; applyState(); };

// ---------- design & compile ----------
let curDesign=null;
function esc(t){ return String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function showDesign(d){
  curDesign=d; R=d.preview?previewR(d):compile(d); lifted=0; $('lift').hidden=!(R.stats.liftoff&&R.stats.liftoff.length); $('lift').textContent=liftLabel(); $('lift').setAttribute('aria-pressed','false'); PLATE=R.stats.plate||32; OFF=PLATE/2; base.scale.set(PLATE/32,R.stats.baseThick?PH/0.14:1,PLATE/32); base.position.y=R.stats.baseThick?-PH/2:-0.07; base.material.color.copy(lin(COLORS[R.stats.baseColor||'Green'].hex)); stopPlay(); showAll=true; stepIdx=Math.max(0,R.steps.length-1); lastMode='';
  buildScene(); renderReport(); renderParts(); renderStep(); frame();
  $('title').textContent=d.name||'Brick house'; document.title=(d.name||'Brick house')+', brick model';
  $('subline').textContent=(d.place?d.place+'. ':'')+(d.unit?`Unit ${d.unit}, cut from its building. `:'')+'A brick model with a step-by-step building guide.';
  $('factsTitle').textContent='What we saw in the photos';
  $('facts').innerHTML=(d.facts||[]).map(f=>`<li>${esc(f)}</li>`).join('');
  $('assumed').textContent=d.assumed||'';
  const cr=d.photoCredits||[]; $('credits').hidden=!cr.length;
  $('credits').innerHTML=cr.map(c=>`<li>Photo: ${/^https:\/\//.test(c.page||'')?`<a href="${esc(c.page)}" target="_blank" rel="noopener">${esc(c.credit)}</a>`:esc(c.credit)}${c.license?', '+esc(c.license):''}</li>`).join('');
  return R;
}
// A design before its kit is ordered comes from the server as a preview (src/server/preview.js): parts to draw
// (plain bricks merged into made-up blocks), the first few guide steps, and totals. This fills in what the
// viewer reads from a compiled design.
function previewR(pv){ const occ=new Map();
  for(const p of pv.parts){ p.studs=p.studs||[]; for(let i=0;i<p.w;i++) for(let j=0;j<p.d;j++) for(let q=0;q<p.h;q++) occ.set((p.x+i)+','+(p.z+j)+','+(p.y+q),p.id); }
  return {preview:true,parts:pv.parts,steps:pv.steps,subs:pv.subs,stats:{...pv.stats,cost:0,ms:0},errors:pv.errors||[],warnings:pv.warnings||[],hints:[],joints:[],jn:new Map(),inventory:[],occ}; }
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
// customers see errors in plain words: anything naming the service behind the design, keys, settings or
// codes becomes a friendly line (the technical view shows it as it came)
const TECHNICAL=/claude|anthropic|\bai\b|api|key|\.env|brickhouse_|model|token|mapillary|stripe_|http \d|server error|fetch|json|undefined|econn|timeout/i;
// e.plain: a message meant for the owner as it is (the photo check's), never swapped for the generic one
function status(html,err,plain){ if(err&&!plain&&!DEV&&TECHNICAL.test(html)) html='Something went wrong on our side. Please try again in a little while.';
  $('photoStatus').innerHTML=err?`<span class="status-err">${html}</span>`:html; }
// A failed response as an Error; the photo check (422) says which photos to change, and marks them
function failed(res,j){ const e=new Error(j.error||`Server error ${res.status}`);
  if(res.status===422){ e.plain=true; flagPhotos((j.problems||[]).map(p=>p.photo)); } return e; }
function flagPhotos(nums){ $('thumbs').querySelectorAll('img').forEach(im=>im.classList.toggle('flagged',nums.includes(+im.dataset.i+1))); }
function setBusy(b){ $('planBtn').disabled=b; $('surveyBtn').disabled=b; $('designBtn').disabled=b; $('pickBtn').disabled=b; $('addrBtn').disabled=b; $('useCands').disabled=b; $('stopBtn').hidden=!b; $('compileBtn').disabled=b; $('revertBtn').disabled=b; }
// No page zoom on phones: Safari ignores user-scalable=no, so its pinch gesture is stopped here (the model's
// own pinch-to-zoom uses touch events, which this doesn't touch)
document.addEventListener('gesturestart',e=>e.preventDefault());
// A photo beside the model opens full size; a tap or Escape closes it
$('refPhotos').addEventListener('click',e=>{ const im=e.target.closest('img'); if(!im) return; $('lightImg').src=im.src; $('lightImg').alt=im.alt; $('lightbox').hidden=false; });
$('lightbox').onclick=()=>{ $('lightbox').hidden=true; };
document.addEventListener('keydown',e=>{ if(e.key==='Escape') $('lightbox').hidden=true; });
// Few photos mean guessed sides: say so before they design (a note, not a block)
const FEW_PHOTOS=3;
function fewPhotosNote(){ const n=photos.length, el=$('fewPhotos'), described=$('notes').value.trim();
  el.hidden=n>=FEW_PHOTOS||(!n&&!described);
  el.textContent=!n?'Without photos, the model is built from your description alone, so it will only be a rough likeness. Photos of the house make it far more accurate.'
    :`With only ${n} photo${n>1?'s':''}, we'll have to guess what the ${n>1?'other sides':'sides and back'} of the house look like, so the model won't be as accurate. Add photos of the sides, the back and the garage if you can (up to ${(health&&health.maxPhotos)||12}).`; }
$('notes').addEventListener('input',fewPhotosNote);
function renderThumbs(){
  photoUrls.forEach(u=>URL.revokeObjectURL(u)); photoUrls=photos.map(f=>URL.createObjectURL(f));
  const html=photoUrls.map((u,i)=>`<img src="${u}" alt="House photo ${i+1}">`).join('');
  $('thumbs').innerHTML=photoUrls.map((u,i)=>`<img src="${u}" alt="House photo ${i+1}" title="Click to remove" data-i="${i}" style="cursor:pointer">`).join('');
  $('refPhotos').innerHTML=html; $('refWrap').hidden=!photos.length;
  $('designBtn').textContent=(photos.length?`Design from ${photos.length} photo${photos.length>1?'s':''}`:'Design from description')+feeText();
  fewPhotosNote(); $('surveyBtn').hidden=!photos.length; if(survey){ survey=null; $('survey').hidden=true; $('survey').innerHTML=''; } // new photos: ask again
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
const houseAddress=()=>$('addrInput').value.trim().slice(0,300)||undefined; // the server adds its building, street and slope facts
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
// The address goes with the design (the server finds the outline and slope then). The dev view can also
// look for street photos of it (Mapillary, with MAPILLARY_TOKEN).
$('addrForm').onsubmit=async e=>{
  e.preventDefault(); const address=$('addrInput').value.trim(); if(!address||!DEV||$('addrBtn').hidden) return;
  $('addrBtn').disabled=true; cands=[]; $('cands').innerHTML=''; $('candRow').hidden=true; addrStatus('Looking up the address…');
  try{
    const res=await fetch('/api/lookup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({address})});
    const j=await res.json(); if(!res.ok) throw new Error(j.error||`Server error ${res.status}`);
    cands=j.photos.map(p=>({...p,on:false}));
    const where=j.place?`Found ${esc(j.place.label)} (${j.place.precision==='building'?'building':'street'} match, ${esc(j.place.source)}).`:'No match for that address.';
    addrStatus([where,...j.notes.map(esc)].join(' ')+(cands.length?' Tap the photos that show this house, front first.':''));
    $('cands').innerHTML=cands.map((c,i)=>`<button type="button" class="cand" data-i="${i}" aria-pressed="false"><img loading="lazy" src="${esc(c.thumb&&/^https:\/\//.test(c.thumb)?c.thumb:'/api/photo/'+c.id)}" alt="Street photo ${i+1}"><span>${c.distanceM} m away${c.capturedAt?', '+esc(c.capturedAt):''}<br>${esc(c.credit)}</span></button>`).join('');
    $('cands').querySelectorAll('.cand').forEach(b=>b.onclick=()=>{ const c=cands[+b.dataset.i]; c.on=!c.on; b.setAttribute('aria-pressed',c.on); });
    $('candRow').hidden=!cands.length;
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
    const body={notes,target:big?Math.max(target,2400):target,plate:big?48:32,address:houseAddress(),
      plan:planFile?await toPayload(planFile,2400):undefined, photos:await Promise.all(photos.map(f=>toPayload(f))),
      credits:photos.map(f=>photoCredit.get(f)).filter(Boolean), choices:surveyChoices()};
    if(photos.length) status('Checking your photos…');
    const res=await fetch('/api/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}), j=await res.json();
    if(!res.ok) throw failed(res,j);
    if(j.checkout){ status('Taking you to the secure payment page for the design fee…'); location.href=j.checkout; return; }
    watchJob(j.id,false);
  }catch(e){ status(esc(e.message),true,e.plain); setBusy(false); }
}
function watchJob(id,keep){
  jobId=id; if(!keep){ jobAfter=0; jobHave=0; } jobT0=Date.now(); setBusy(true); $('stopBtn').hidden=true;
  try{ history.replaceState(null,'','?job='+id); }catch(e){}
  status(DEV?'Claude is studying the photos. This usually takes 15 to 25 minutes; you can close this page and come back with the same address.'
    :'We\'re designing your house from the photos. It takes a while to get right; you can close this page and come back to this link any time.');
  pollJob();
}
async function pollJob(){
  let j;
  try{ const r=await fetch(`/api/jobs/${jobId}?after=${jobAfter}&have=${jobHave}`); j=await r.json(); if(!r.ok) throw new Error(j.error||`Server error ${r.status}`); }
  catch(e){ status(DEV?esc(e.message):'Reconnecting… your design keeps going on our side.',DEV); setTimeout(pollJob,5000); return; } // a restart or a dropped connection
  kitInfo={kit:j.kit,kitCents:j.kitCents,kitCurrency:j.kitCurrency}; if(R) refreshOrderUI();
  // the job's own photos beside the model, when this page didn't pick them (opened from the job's link)
  if(j.photos&&!photos.length&&!$('refPhotos').children.length){
    $('refPhotos').innerHTML=Array.from({length:j.photos},(_,i)=>`<img src="/api/jobs/${jobId}/photos/${i}" alt="Your photo ${i+1}" loading="lazy">`).join(''); $('refWrap').hidden=false; }
  if(j.draft){ jobHave=j.draftN; showOwn(); draftOnly=j.status!=='done'; showDesign(j.draft); $('designSrc').value=JSON.stringify(j.draft,null,2); }
  for(const ev of j.events) handleEvent(ev.type==='done'&&j.result?j.result:ev,jobT0);
  jobAfter=j.next;
  if(j.status==='awaiting_payment'){ status(`This design is waiting for its design fee.`); setBusy(false); return; }
  // cut off by a restart: the server picks it up again at the part it was on (jobs.resumeInterrupted)
  if(j.status==='interrupted'){ status('Picking your design up where it left off…'); setTimeout(pollJob,4000); return; }
  if(j.status==='done'||j.status==='error'){ setBusy(false); return; }
  setTimeout(pollJob,2000);
}
function handleEvent(ev,t0){
  const secs=()=>Math.round((Date.now()-t0)/1000);
  if(!DEV){ // the customer's view: what we're working on, not how
    if(ev.type==='part') status(`Designing your house: ${esc(String(ev.name).toLowerCase())} (${ev.n} of ${ev.of})…`);
    else if(ev.type==='draft') status('Checking every brick and refining the details…');
    else if(ev.type==='done'&&ev.design){ const t=JSON.stringify(ev.design,null,2); $('designSrc').value=t; showOwn(); draftOnly=false; run(t); DESIGN_TEXT=t;
      status((ev.errors||ev.warnings)?'Almost there: a few details still need finishing. <button class="btn sm primary" id="fixBtn">Finish the design</button>'
        :'Your house is ready. Turn it around, then open the building guide to see how it goes together.');
      const fb=$('fixBtn'); if(fb) fb.onclick=()=>askServer('fix'); }
    else if(ev.type==='error') status('Something went wrong on our side. Please try again in a little while.',true);
    return; }
  if(ev.type==='status') status(`${esc(ev.message)} <span style="color:var(--muted)">${secs()} s</span>`);
  else if(ev.type==='part') status(`Building part ${ev.n} of ${ev.of}: ${esc(ev.name)}… <span style="color:var(--muted)">${secs()} s</span>`);
  else if(ev.type==='draft') status(`Draft ${ev.n} compiled: ${ev.stats.pieces.toLocaleString()} pieces, ${ev.errors} errors, ${ev.warnings} warnings. Claude is revising… <span style="color:var(--muted)">${secs()} s</span>`);
  else if(ev.type==='done'&&ev.design){ const t=JSON.stringify(ev.design,null,2); $('designSrc').value=t; showOwn(); draftOnly=false; run(t); DESIGN_TEXT=t;
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
    const body={notes:$('notes').value.trim().slice(0,1500),photos:await Promise.all(photos.map(f=>toPayload(f))),address:houseAddress(),
      plate:$('bigPlate').checked?48:32,plan:planFile?await toPayload(planFile,2400):undefined};
    const res=await fetch('/api/survey',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:ctl.signal});
    const j=await res.json(); if(!res.ok) throw failed(res,j);
    survey=j; renderSurvey(j);
    status(`${j.questions.length} question${j.questions.length===1?'':'s'}. The photos' best guess is picked; change any answer, then design.`);
  }catch(e){ status(e.name==="AbortError"?"Stopped.":esc(e.message),e.name!=="AbortError",e.plain); }
  finally{ busyCtl=null; setBusy(false); }
};

async function loadDesignList(selected){
  try{ const list=await (await fetch('/api/designs')).json(); const sel=$('designPick'); const cur=selected||new URLSearchParams(location.search).get('design')||'634-unit-a';
    sel.innerHTML=list.map(n=>`<option value="${esc(n)}"${n===cur?' selected':''}>${esc(n)}</option>`).join(''); $('pickWrap').hidden=!list.length;
    sel.onchange=()=>{ location.search='?design='+encodeURIComponent(sel.value); };
  }catch(e){}
}

// ---------- tabs & theme ----------
let tab='model', ownShown=false; // ownShown: a draft or design of theirs is on the stage
// "Make yours" is a page of its own (upload mode) until a design of theirs is on the way: the sample
// house and the other tabs stay out of it, and come back with their house's first draft
function uploadMode(){ const on=tab==='design'&&!ownShown&&!HERO_MODE; document.documentElement.classList.toggle('upload',on);
  if(on){ if(location.hash!=='#design') try{ history.replaceState(null,'','#design'); }catch(e){} }
  else if(location.hash==='#design') try{ history.replaceState(null,'',location.pathname+location.search); }catch(e){}
  // the top bar's button: to the upload page, or from it to the example
  $('topCta').textContent=on?'See an example':'Make yours'; $('topCta').setAttribute('href',on?'/app':'/app#design');
  if(on||tab!=='design') dirty=true; }
function showOwn(){ if(ownShown) return; ownShown=true; uploadMode(); requestAnimationFrame(resize); }
function showTab(t){ tab=t;
  document.querySelectorAll('.tabs button').forEach(x=>x.setAttribute('aria-selected',x.dataset.tab===t));
  ['model','manual','parts','design'].forEach(k=>$('pane-'+k).hidden=k!==t);
  if(t==='parts') fetchQuote();
  const was=document.documentElement.classList.contains('upload'); uploadMode();
  if(was&&!document.documentElement.classList.contains('upload')){ scrollTo(0,0); requestAnimationFrame(resize); } }
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
$('seeExample').onclick=e=>{ e.preventDefault(); showTab('model'); };
$('topCta').onclick=e=>{ e.preventDefault(); showTab(document.documentElement.classList.contains('upload')?'model':'design'); if(innerWidth<960&&tab==='design') document.querySelector('.panel').scrollIntoView(); };
// /app#design (the landing page's "Make yours") opens on the upload page
if(location.hash==='#design') showTab('design');
function applyTheme(){ const c=getComputedStyle(document.documentElement).getPropertyValue('--stage').trim()||'#D9E2EB'; stageLin=lin(c); scene.background=HERO?null:new THREE.Color(c); if(R) applyState(); dirty=true; }
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
  if(HERO){ // the same view as the landing page's still picture; tell the page it can show us
    goal.theta=theta=HERO_VIEW.t; goal.phi=phi=HERO_VIEW.p; radius=goal.radius; liftParts=topStory(); dirty=true;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{ try{ parent.postMessage({brickhouse:'hero-ready'},location.origin); }catch(e){} }));
    if(BUILD&&!window.BRICKHOUSE_STILL) playBuildLoop();
    return; }
  if(embedded){ $('homeLink').hidden=true; $('topCta').hidden=true; $('photoIntro').textContent='This is a standalone copy. Run the Brickhouse server (npm start) to design houses from photos.'; return; }
  try{ health=await (await fetch('/api/health')).json(); }catch(e){ health=null; }
  loadDesignList();
  const closed='Designing new houses isn\'t open just yet. Please check back soon.';
  if(!health){ $('photoIntro').textContent=DEV?'Start the server with npm start to design from photos.':closed; return; }
  if(!health.ready){ $('photoIntro').textContent=DEV?'Add BRICKHOUSE_ANTHROPIC_API_KEY to .env and restart the server to design from photos (or run with BRICKHOUSE_FAKE=1 to try the flow).':closed; return; }
  $('photoControls').hidden=false; $('addrBtn').hidden=!health.streetPhotos;
  $('photoIntro').textContent=DEV?`Enter the address to find street photos${health.streetPhotos?'':' (needs MAPILLARY_TOKEN)'}, or pick up to ${health.maxPhotos} exterior photos, front first, then each side, the back, the garage and any yard or patio: Claude builds only what a photo, the floor plan or your notes show, so a side no photo shows gets guessed. Claude (${health.model}) studies them, writes a design, compiles it here, fixes what the checker flags, and saves it.`
    :`Add photos of the outside of the house: the front first, then the sides, the back and the garage if you have them (up to ${health.maxPhotos}). A floor plan helps us get the walls just right, and anything the photos don't show, you can tell us below.`;
  renderThumbs();
  // Back from Stripe (?job=…&session=…): confirm the payment and start the design; ?job=… alone
  // picks up a design in progress or finished.
  const q=new URLSearchParams(location.search), qj=q.get('job');
  if(qj&&q.get('canceled')){ status('Payment canceled; nothing was charged. Your photos are still here if you want to try again.'); try{ history.replaceState(null,'','/app'); }catch(e){} }
  else if(qj&&q.get('kit')){ status('Confirming your kit order…'); // back from the kit's checkout
    try{ const r=await fetch(`/api/jobs/${qj}/kit`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({session:q.get('kit')})}), j=await r.json();
      if(!r.ok) status(esc(j.error||'The kit order could not be confirmed.'),true); }catch(e){}
    try{ history.replaceState(null,'','/app?job='+qj); }catch(e){} watchJob(qj,false); }
  else if(qj&&q.get('session')){ status('Confirming the payment…');
    const r=await fetch(`/api/jobs/${qj}/start`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({session:q.get('session')})}), j=await r.json();
    if(!r.ok) status(esc(j.error||'The payment could not be confirmed.'),true); else watchJob(qj,false); }
  else if(qj) watchJob(qj,false);
}
boot();
