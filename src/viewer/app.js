// Brickhouse viewer: rendering, manual, parts, design editor, photo jobs.
// Needs three.js r128 (global THREE) and src/engine/engine.js (global compile, COLORS).
const $=id=>document.getElementById(id);
const canvas=$('cv'), stage=$('stage');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
renderer.outputEncoding=THREE.sRGBEncoding;
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
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
const PH=0.4; let PLATE=32, OFF=16; // the baseplate size comes from the design ("plate": 32 or 48)
const tmp=new THREE.Object3D(), ZERO=new THREE.Matrix4().makeScale(0,0,0), col=new THREE.Color();
let stageLin=lin('#D9E2EB');

// ---------- geometries ----------
const boxGeo=new THREE.BoxGeometry(1,1,1);
const studGeo=new THREE.CylinderGeometry(0.3,0.3,0.17,12);
const cylGeo=new THREE.CylinderGeometry(0.5,0.5,1,24);
function wedgeGeo(){
  const a=0.485, hb=0.27, hf=0.035;
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
const frondGeo=(()=>{ const g=new THREE.BoxGeometry(2.3,0.07,0.5); g.translate(1.15,0,0); return g; })();

const matO=new THREE.MeshLambertMaterial({color:0xffffff});
const matT=new THREE.MeshLambertMaterial({color:0xffffff,transparent:true,opacity:0.62,depthWrite:false});
const matW=new THREE.MeshLambertMaterial({color:0xffffff,side:THREE.DoubleSide});
const glassMat=()=>new THREE.MeshLambertMaterial({color:lin('#BFE3F5'),transparent:true,opacity:0.42,depthWrite:false});

const base=new THREE.Mesh(new THREE.BoxGeometry(32,0.14,32),new THREE.MeshLambertMaterial({color:lin(COLORS['Green'].hex)}));
base.position.set(0,-0.07,0); base.receiveShadow=true; scene.add(base);

// ---------- state ----------
let R=null, root=null, inst=[], specials=[], studs=null, studRecs=[], meshes=[];
let stepIdx=0, showAll=true, stress=false, mode='main';
let DESIGN_TEXT='';

function strengthHex(p){ const area=p.shape==='arch'?4:p.w*p.d; const r=R.jn.get(p.id)/area; return r<0.5?'#D64B34':r<1?'#E8A93A':'#3E9E68'; }

function makeInstanced(geo,mat,list,cast){ const m=new THREE.InstancedMesh(geo,mat,Math.max(1,list.length)); m.castShadow=!!cast; m.receiveShadow=true;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); list.forEach((r,i)=>{ r.mesh=m; r.i=i; m.setMatrixAt(i,r.m); m.setColorAt(i,col.set(0xffffff)); });
  m.userData.recs=list; root.add(m); meshes.push(m); return m; }

function buildScene(){
  if(root){ scene.remove(root); meshes.forEach(m=>m.dispose&&m.dispose()); specials.forEach(s=>s.mats.forEach(o=>o.mat.dispose())); }
  root=new THREE.Group(); scene.add(root); inst=[]; specials=[]; meshes=[]; studRecs=[];
  const boxO=[], boxT=[], ch=[], cyl=[];
  for(const p of R.parts){
    const cx=p.x+p.w/2-OFF, cz=p.z+p.d/2-OFF, y0=p.y*PH, hh=p.h*PH;
    if(p.shape==='box'||p.shape==='cyl'){
      tmp.rotation.set(0,0,0); tmp.position.set(cx,y0+hh/2,cz);
      if(p.shape==='box') tmp.scale.set(p.w-0.035,hh-0.018,p.d-0.035); else tmp.scale.set(p.diam,hh-0.018,p.diam);
      tmp.updateMatrix(); const r={p,m:tmp.matrix.clone()}; (p.shape==='cyl'?cyl:(p.color.startsWith('Trans-')?boxT:boxO)).push(r); inst.push(r);
    } else if(p.shape==='cheese'){
      tmp.position.set(cx,y0,cz); tmp.scale.set(1,1,1); tmp.rotation.set(0,{S:0,N:Math.PI,E:Math.PI/2,W:-Math.PI/2}[p.dir]||0,0);
      tmp.updateMatrix(); const r={p,m:tmp.matrix.clone()}; ch.push(r); inst.push(r);
    } else specials.push(makeSpecial(p));
  }
  makeInstanced(boxGeo,matO,boxO,true); makeInstanced(boxGeo,matT,boxT,false); makeInstanced(cheeseGeo,matW,ch,true); makeInstanced(cylGeo,matO,cyl,true);
  // studs
  for(const p of R.parts) for(const [x,z] of p.studs){ const top=p.y+p.h; const cov=R.occ.get(x+','+z+','+top); studRecs.push({p,x,z,top,cov}); }
  for(let x=0;x<PLATE;x++) for(let z=0;z<PLATE;z++){ const cov=R.occ.get(x+','+z+',0'); studRecs.push({p:null,x,z,top:0,cov}); }
  studs=new THREE.InstancedMesh(studGeo,matO,studRecs.length); studs.instanceMatrix.setUsage(THREE.DynamicDrawUsage); studs.receiveShadow=true;
  studRecs.forEach((s,i)=>{ tmp.rotation.set(0,0,0); tmp.scale.set(1,1,1); tmp.position.set(s.x+0.5-OFF,s.top*PH+0.085,s.z+0.5-OFF); tmp.updateMatrix(); s.m=tmp.matrix.clone(); });
  root.add(studs); meshes.push(studs);
}

function makeSpecial(p){
  const g=new THREE.Group(), mats=[]; const main=new THREE.MeshLambertMaterial({color:lin(COLORS[p.color].hex),side:THREE.DoubleSide}); mats.push({mat:main,p});
  const add=(geo,mat,x,y,z,cast=true)=>{ const m=new THREE.Mesh(geo,mat); m.position.set(x,y,z); m.castShadow=cast; m.receiveShadow=true; g.add(m); return m; };
  const H=p.h*PH;
  if(p.shape==='window'){
    const w=p.rot%2?p.d:p.w, t=0.17, dep=0.9;
    add(new THREE.BoxGeometry(w-0.03,t,dep),main,0,H-t/2-0.01,0); add(new THREE.BoxGeometry(w-0.03,t,dep),main,0,t/2,0);
    add(new THREE.BoxGeometry(t,H-0.02,dep),main,-w/2+t/2+0.015,H/2,0); add(new THREE.BoxGeometry(t,H-0.02,dep),main,w/2-t/2-0.015,H/2,0);
    add(new THREE.BoxGeometry(w-2*t,0.08,0.3),main,0,H*0.55,0);
    if(w>=4||p.h>=9) add(new THREE.BoxGeometry(0.1,H-2*t,0.3),main,0,H/2,0);
    const gm=glassMat(); mats.push({mat:gm,p,glass:true}); add(new THREE.BoxGeometry(w-2*t,H-2*t,0.06),gm,0,H/2,0,false);
  } else if(p.shape==='arch'){ add(archGeoFor(p.h,p.archTop||2),main,0,0,0);
  } else if(p.shape==='fence'){
    const w=4; add(new THREE.BoxGeometry(w-0.04,0.34,0.8),main,0,0.17,0); add(new THREE.BoxGeometry(w-0.04,0.2,0.34),main,0,1.08,0);
    const sg=new THREE.BoxGeometry(0.22,0.8,0.16); for(let i=0;i<7;i++) add(sg,main,-w/2+0.3+i*(w-0.6)/6,0.7,0);
  } else if(p.shape==='palm'){
    add(new THREE.CylinderGeometry(0.28,0.36,0.3,10),main,0,0.15,0);
    for(let i=0;i<7;i++){ const f=new THREE.Mesh(frondGeo,main); f.castShadow=true; f.position.y=0.28; f.rotation.set(0,i*Math.PI*2/7+0.3,-0.42-(i%2)*0.18); g.add(f); }
  }
  g.position.set(p.x+p.w/2-OFF,p.y*PH,p.z+p.d/2-OFF);
  if(p.rot%2&&p.shape!=='palm') g.rotation.y=Math.PI/2;
  root.add(g); return {p,obj:g,mats};
}

// ---------- visibility & color ----------
function partState(p){
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
  for(const p of R.parts){ const [v,c]=partState(p); p._v=v; p._c=c; }
  for(const r of inst){ r.mesh.setMatrixAt(r.i,r.p._v?r.m:ZERO); r.mesh.setColorAt(r.i,colorFor(r.p,r.p._c)); }
  for(const m of meshes){ m.instanceMatrix.needsUpdate=true; if(m.instanceColor) m.instanceColor.needsUpdate=true; }
  for(const s of specials){ s.obj.visible=s.p._v; for(const o of s.mats){ if(o.glass) continue; o.mat.color.copy(colorFor(s.p,s.p._c)); } }
  const baseHex=COLORS['Green'].hex;
  studRecs.forEach((s,i)=>{
    const ownerV=s.p?s.p._v:(mode==='main'); const covered=s.cov&&R.parts[s.cov-1]._v;
    studs.setMatrixAt(i,(ownerV&&!covered)?s.m:ZERO);
    studs.setColorAt(i, s.p?colorFor(s.p,s.p._c):col.copy(lin(baseHex)));
  });
  studs.instanceMatrix.needsUpdate=true; if(studs.instanceColor) studs.instanceColor.needsUpdate=true;
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
  theta=ease(theta,goal.theta); phi=ease(phi,goal.phi); radius=ease(radius,goal.radius);
  const tx=ease(target.x,goal.t.x), ty=ease(target.y,goal.t.y), tz=ease(target.z,goal.t.z); target.set(tx,ty,tz);
  if(moving||dirty){ placeCam(); renderer.render(scene,camera); dirty=false; } }

// ---------- manual ----------
const inventoryPages=()=>Math.ceil(R.inventory.length/24);
function renderStep(){
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
  applyState(); updateShowLabel();
}
$('prev').onclick=()=>{ stopPlay(); if(showAll){ showAll=false; stepIdx=R.steps.length-1; } else stepIdx=Math.max(0,stepIdx-1); renderStep(); };
$('next').onclick=()=>{ stopPlay(); if(stepIdx>=R.steps.length-1) showAll=true; else stepIdx++; renderStep(); };
$('slider').oninput=e=>{ stopPlay(); showAll=false; stepIdx=+e.target.value; renderStep(); };
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
  tick(); playTimer=setInterval(tick,reduceMotion?400:110);
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
  curDesign=d; R=compile(d); PLATE=R.stats.plate||32; OFF=PLATE/2; base.scale.set(PLATE/32,1,PLATE/32); stopPlay(); showAll=true; stepIdx=Math.max(0,R.steps.length-1); lastMode='';
  buildScene(); renderReport(); renderParts(); renderStep(); frame();
  $('title').textContent=d.name||'Brick house'; document.title=(d.name||'Brick house')+', brick model';
  $('subline').textContent=(d.place?d.place+'. ':'')+'A closing-gift brick model with a full build manual.';
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
function setBusy(b){ $('surveyBtn').disabled=b; $('designBtn').disabled=b; $('pickBtn').disabled=b; $('addrBtn').disabled=b; $('useCands').disabled=b; $('stopBtn').hidden=!b; $('compileBtn').disabled=b; $('revertBtn').disabled=b; }
function renderThumbs(){
  photoUrls.forEach(u=>URL.revokeObjectURL(u)); photoUrls=photos.map(f=>URL.createObjectURL(f));
  const html=photoUrls.map((u,i)=>`<img src="${u}" alt="House photo ${i+1}">`).join('');
  $('thumbs').innerHTML=html; $('refPhotos').innerHTML=html; $('refWrap').hidden=!photos.length;
  $('designBtn').textContent=photos.length?`Design from ${photos.length} photo${photos.length>1?'s':''}`:'Design from description';
  $('surveyBtn').hidden=!photos.length; if(survey){ survey=null; $('survey').hidden=true; $('survey').innerHTML=''; } // new photos: ask again
}
async function toPayload(file){
  // Downscale on the device: Claude works at about 1.5 megapixels and uploads stay small.
  const bmp=await createImageBitmap(file); const s=Math.min(1,1568/Math.max(bmp.width,bmp.height));
  const c=document.createElement('canvas'); c.width=Math.round(bmp.width*s); c.height=Math.round(bmp.height*s);
  c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
  return {mediaType:'image/jpeg', data:c.toDataURL('image/jpeg',0.88).split(',')[1]};
}
$('pickBtn').onclick=()=>$('photoInput').click();
$('photoInput').accept='image/jpeg,image/png,image/webp';
$('photoInput').onchange=e=>{ const max=(health&&health.maxPhotos)||6; photos=[...photos.filter(f=>photoCredit.has(f)),...e.target.files].slice(0,max); renderThumbs();
  status(photos.length>=max?`Using the first ${max} photos.`:''); e.target.value=''; };

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
    const n=$('notes'); if(j.place&&!n.value.includes(j.place.label)) n.value=(n.value?n.value+'\n':'')+`Address: ${j.place.label}`;
    if(j.terrain&&j.terrain.note&&!n.value.includes('Terrain (USGS')) n.value+='\n'+j.terrain.note;
  }catch(err){ addrStatus(esc(err.message),true); }
  finally{ $('addrBtn').disabled=false; }
};
$('useCands').onclick=async()=>{
  const pick=cands.filter(c=>c.on), max=(health&&health.maxPhotos)||6;
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

async function askServer(mode){
  if(busyCtl) return;
  const notes=$('notes').value.trim().slice(0,1500), target=Math.max(300,Math.min(2500,+$('target').value||1200));
  if(mode==='design'&&!photos.length&&!notes){ status('Add at least one photo or a short description first.',true); return; }
  const ctl=new AbortController(); busyCtl=ctl; setBusy(true); const t0=Date.now();
  status(mode==='design'?'Preparing photos…':'Sending the design back to Claude…');
  try{
    const body={mode,notes,target,photos:mode==='design'?await Promise.all(photos.map(toPayload)):[],design:mode==='fix'?curDesign:undefined,
      credits:mode==='design'?photos.map(f=>photoCredit.get(f)).filter(Boolean):undefined,
      choices:mode==='design'?surveyChoices():undefined};
    status(mode==='design'?'Claude is studying the photos. This usually takes a few minutes.':'Claude is fixing the design…');
    const res=await fetch('/api/design',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:ctl.signal});
    if(!res.ok){ const j=await res.json().catch(()=>({})); throw new Error(j.error||`Server error ${res.status}`); }
    const reader=res.body.getReader(), dec=new TextDecoder(); let buf='';
    for(;;){ const {value,done}=await reader.read(); if(done) break; buf+=dec.decode(value,{stream:true});
      let i; while((i=buf.indexOf('\n'))>=0){ const line=buf.slice(0,i).trim(); buf=buf.slice(i+1); if(line) handleEvent(JSON.parse(line),t0); } }
  }catch(e){ status(e.name==='AbortError'?'Stopped. The server finishes the job in the background and saves it to designs/generated.':esc(e.message),e.name!=='AbortError'); }
  finally{ busyCtl=null; setBusy(false); }
}
function handleEvent(ev,t0){
  const secs=()=>Math.round((Date.now()-t0)/1000);
  if(ev.type==='status') status(`${esc(ev.message)} <span style="color:var(--muted)">${secs()} s</span>`);
  else if(ev.type==='draft'){ showDesign(ev.design); $('designSrc').value=JSON.stringify(ev.design,null,2);
    status(`Draft ${ev.n} compiled: ${ev.stats.pieces.toLocaleString()} pieces, ${ev.errors} errors, ${ev.warnings} warnings. Claude is revising… <span style="color:var(--muted)">${secs()} s</span>`); }
  else if(ev.type==='done'){ const t=JSON.stringify(ev.design,null,2); $('designSrc').value=t; run(t); DESIGN_TEXT=t;
    status(`Done in ${ev.seconds} s after ${ev.compiles} compile${ev.compiles===1?'':'s'}: ${ev.stats.pieces.toLocaleString()} pieces, ${ev.errors} errors, ${ev.warnings} warnings. Saved as designs/${esc(ev.saved)}.json.`
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
    const body={notes:$('notes').value.trim().slice(0,1500),photos:await Promise.all(photos.map(toPayload))};
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
  $('photoIntro').textContent=`Enter the address to find street photos${health.streetPhotos?'':' (needs MAPILLARY_TOKEN)'}, or pick up to ${health.maxPhotos} exterior photos, front first. Claude (${health.model}) studies them, writes a design, compiles it here, fixes what the checker flags, and saves it.`;
  renderThumbs();
}
boot();
