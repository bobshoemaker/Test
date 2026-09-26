// Brickhouse engine: part catalog, design compiler, connection checker, manual steps.
// Dependency-free. Runs in the browser (globals) and in Node (require).
// The design language it compiles is documented in src/server/prompt.js (SPEC).
const BASE = 32;
const COLORS = {
  'White':{hex:'#F2F3F2',bl:1}, 'Tan':{hex:'#E4CD9E',bl:2}, 'Dark Tan':{hex:'#958A73',bl:69},
  'Light Bluish Gray':{hex:'#A0A5A9',bl:86}, 'Dark Bluish Gray':{hex:'#6C6E68',bl:85}, 'Black':{hex:'#2B2B2B',bl:11},
  'Reddish Brown':{hex:'#582A12',bl:88}, 'Dark Orange':{hex:'#A95500',bl:68}, 'Green':{hex:'#237841',bl:6},
  'Dark Green':{hex:'#184632',bl:80}, 'Bright Green':{hex:'#4B9F4A',bl:36}, 'Trans-Clear':{hex:'#CFE6F2',bl:12},
  'Red':{hex:'#C91A09',bl:5}, 'Yellow':{hex:'#F2CD37',bl:3}, 'Bright Pink':{hex:'#E4ADC8',bl:104}, 'Sand Green':{hex:'#A0BCAC',bl:48},
  'Blue':{hex:'#0055BF',bl:7}, 'Medium Nougat':{hex:'#AA7D55',bl:150}, 'Light Gray':{hex:'#C8C8C8',bl:9}, 'Dark Red':{hex:'#720E0F',bl:59}, 'Sand Blue':{hex:'#6074A1',bl:55}, 'Olive Green':{hex:'#9B9A5A',bl:155}, 'Dark Brown':{hex:'#352100',bl:120}, 'Trans-Black':{hex:'#3B3F46',bl:13}
};
const SIZE_PARTS = {
  brick:{'1x1':'3005','1x2':'3004','1x3':'3622','1x4':'3010','1x6':'3009','1x8':'3008','2x2':'3003','2x3':'3002','2x4':'3001','2x6':'2456','2x8':'3007'},
  plate:{'1x1':'3024','1x2':'3023','1x3':'3623','1x4':'3710','1x6':'3666','1x8':'3460','2x2':'3022','2x3':'3021','2x4':'3020','2x6':'3795','2x8':'3034','4x4':'3031','6x6':'3958'},
  tile:{'1x1':'3070b','1x2':'3069b','1x4':'2431','1x8':'4162','2x2':'3068b','2x4':'87079'}
};
const PACK_SIZES = {
  brick:[[2,8],[2,6],[2,4],[2,3],[2,2],[1,8],[1,6],[1,4],[1,3],[1,2],[1,1]],
  plate:[[2,8],[2,6],[2,4],[2,3],[2,2],[1,8],[1,6],[1,4],[1,3],[1,2],[1,1]],
  tile:[[2,4],[2,2],[1,8],[1,4],[1,2],[1,1]]
};
const H = {brick:3, plate:1, tile:1};
const KIND_NAME = {brick:'Brick', plate:'Plate', tile:'Tile'};
const KIND_COST = {brick:0.08, plate:0.05, tile:0.06};
const SPECIAL = {
  cheese:{no:'54200', name:'Slope 30 1 x 1 x 2/3', w:1,d:1,h:1, studs:false, shape:'cheese', cost:0.07},
  round1:{no:'3062b', name:'Brick round 1 x 1', w:1,d:1,h:3, shape:'cyl', diam:0.94, cost:0.06},
  roundplate1:{no:'4073', name:'Plate round 1 x 1', w:1,d:1,h:1, shape:'cyl', diam:0.94, cost:0.04},
  roundplate2:{no:'4032', name:'Plate round 2 x 2', w:2,d:2,h:1, shape:'cyl', diam:1.94, cost:0.08},
  roundbrick2:{no:'3941', name:'Brick round 2 x 2', w:2,d:2,h:3, shape:'cyl', diam:1.94, cost:0.12},
  win22:{no:'60592', name:'Window 1 x 2 x 2', w:2,d:1,h:6, shape:'window', glass:'60601', glassName:'Glass for window 1 x 2 x 2', cost:0.15},
  win43:{no:'60594', name:'Window 1 x 4 x 3', w:4,d:1,h:9, shape:'window', glass:'60603', glassName:'Glass for window 1 x 4 x 3', cost:0.30},
  arch42:{no:'6182', name:'Arch 1 x 4 x 2', w:4,d:1,h:6, shape:'arch', archTop:2, cost:0.20},
  arch41:{no:'3659', name:'Arch 1 x 4', w:4,d:1,h:3, shape:'arch', archTop:1, cost:0.10},
  win23:{no:'60593', name:'Window 1 x 2 x 3', w:2,d:1,h:9, shape:'window', glass:'60602', glassName:'Glass for window 1 x 2 x 3', cost:0.20},
  fence4:{no:'3633', name:'Fence 1 x 4 x 1', w:4,d:1,h:3, shape:'fence', cost:0.10},
  palmtop:{no:'2566', name:'Palm tree top', w:1,d:1,h:1, studs:false, shape:'palm', cost:0.30}
};
const GLASS_COST = 0.10, BASEPLATE = {no:'3811', name:'Baseplate 32 x 32', color:'Green', cost:12};
const N4 = [[1,0],[-1,0],[0,1],[0,-1]];
const K3 = (x,z,p)=>x+','+z+','+p;

function resolvePart(key){
  if(SPECIAL[key]) return Object.assign({key, kind:key}, SPECIAL[key]);
  const m=/^(brick|plate|tile):(\d+)x(\d+)$/.exec(key||'');
  if(!m) throw new Error('Unknown part "'+key+'"');
  const kind=m[1], w=+m[2], d=+m[3], sz=Math.min(w,d)+'x'+Math.max(w,d), no=SIZE_PARTS[kind][sz];
  if(!no) throw new Error('There is no '+kind+' in size '+sz);
  return {key, kind, w, d, h:H[kind], no, name:KIND_NAME[kind]+' '+sz.replace('x',' x '), shape:'box', studs:kind!=='tile', cost:KIND_COST[kind]};
}
function makePart(def,x,y,z,rot,color,meta){
  rot=rot||0; const sw=rot%2?def.d:def.w, sd=rot%2?def.w:def.d;
  const p=Object.assign({key:def.key, kind:def.kind, no:def.no, name:def.name, shape:def.shape, diam:def.diam, archTop:def.archTop, color, x,y,z, w:sw, d:sd, h:def.h, rot, cost:def.cost,
    glass:def.glass?{no:def.glass,name:def.glassName}:null}, meta);
  const occ=[], sockets=[], studs=[];
  if(def.shape==='arch'){
    const along=rot%2===0;
    for(let i=0;i<4;i++){ const cx=along?x+i:x, cz=along?z:z+i, leg=(i===0||i===3);
      for(let q=leg?0:def.h-def.archTop;q<def.h;q++) occ.push([cx,cz,y+q]);
      if(leg) sockets.push([cx,cz]); studs.push([cx,cz]); }
  } else {
    for(let i=0;i<sw;i++) for(let j=0;j<sd;j++){ const cx=x+i, cz=z+j;
      for(let q=0;q<def.h;q++) occ.push([cx,cz,y+q]);
      sockets.push([cx,cz]); if(def.studs!==false) studs.push([cx,cz]); }
  }
  p.occ=occ; p.sockets=sockets; p.studs=studs; p.studSet=new Set(studs.map(s=>s[0]+','+s[1]));
  return p;
}
function lineCells(s){
  const [x0,z0,x1,z1]=s, out=[];
  if(x0!==x1&&z0!==z1) throw new Error('Wall segment '+JSON.stringify(s)+' must run straight along x or z');
  for(let x=Math.min(x0,x1);x<=Math.max(x0,x1);x++) for(let z=Math.min(z0,z1);z<=Math.max(z0,z1);z++) out.push([x,z]);
  return out;
}
function rectCells(r){ const out=[]; for(let x=Math.min(r[0],r[2]);x<=Math.max(r[0],r[2]);x++) for(let z=Math.min(r[1],r[3]);z<=Math.max(r[1],r[3]);z++) out.push([x,z]); return out; }

function compile(design){
  const clock=(typeof performance!=='undefined')?performance:Date;
  const t0=clock.now();
  const errors=[], warnings=[], parts=[], occ=new Map(), subs=[];
  const phases=design.phases||[]; const phaseIdx=new Map(phases.map((p,i)=>[p,i]));
  const wallCourse=new Map(); const wallPairs=new Set(); const wallCourses=new Map();

  const commit=p=>{ p.id=parts.length+1; parts.push(p); for(const v of p.occ) occ.set(K3(v[0],v[1],v[2]),p.id); return p; };
  const blocked=p=>{ for(const v of p.occ){ if(v[0]<0||v[1]<0||v[0]>=BASE||v[1]>=BASE) return -1; const o=occ.get(K3(v[0],v[1],v[2])); if(o) return o; } return 0; };
  const supportAt=(x,z,y)=>{ if(y===0) return (x>=0&&z>=0&&x<BASE&&z<BASE)?'base':undefined;
    const id=occ.get(K3(x,z,y-1)); if(!id) return undefined; const q=parts[id-1];
    return (q.y+q.h===y && q.studSet.has(x+','+z))?id:undefined; };

  function place(key,x,y,z,rot,color,meta,strict){
    let def; try{ def=resolvePart(key); }catch(e){ errors.push({msg:e.message, op:meta.op}); return null; }
    if(!COLORS[color]){ errors.push({msg:'Unknown color "'+color+'"', op:meta.op}); return null; }
    const p=makePart(def,x,y,z,rot,color,meta), b=blocked(p);
    if(b){ if(strict) errors.push({msg: b===-1?`${def.name} at (${x}, ${z}) runs off the baseplate`:`${def.name} at (${x}, ${y}, ${z}) collides with ${parts[b-1].name.toLowerCase()} #${b}`, op:meta.op}); return null; }
    return commit(p);
  }

  const LEN_OK=new Set([1,2,3,4,6,8]);
  function pack(level,kind,y,meta,sizesFor){
    const h=H[kind], cells=[];
    for(const [k,color] of level){ const [x,z]=k.split(',').map(Number);
      let ok=x>=0&&z>=0&&x<BASE&&z<BASE; for(let q=0;q<h&&ok;q++) if(occ.has(K3(x,z,y+q))) ok=false;
      if(ok) cells.push({x,z,color,k}); }
    const avail=new Map(cells.map(c=>[c.k,c])), owner=new Map(), plan=[];
    for(const c of cells){ c.sup=supportAt(c.x,c.z,y)!==undefined; let n=0; for(const [dx,dz] of N4) if(supportAt(c.x+dx,c.z+dz,y)!==undefined) n++; c.nsup=n; }
    const par=Math.floor(y/h)%2;
    cells.sort((a,b)=>(a.sup-b.sup)||(a.nsup-b.nsup)||(par?(a.x-b.x||a.z-b.z):(a.z-b.z||a.x-b.x)));
    const seamBelow=(x,z,nx,nz,dy)=>{ const b1=occ.get(K3(x,z,y-dy)), b2=occ.get(K3(nx,nz,y-dy)); return !!(b1&&b2&&b1!==b2); };
    for(const c of cells){
      if(owner.has(c.k)) continue;
      const sizes=(sizesFor&&sizesFor(c.color))||PACK_SIZES[kind], small=!!(sizesFor&&sizesFor(c.color));
      let best=null;
      for(const [a,bb] of sizes){
        const ors=a===bb?[[a,bb]]:[[a,bb],[bb,a]];
        for(const [w,d] of ors) for(let ox=0;ox<w;ox++) for(let oz=0;oz<d;oz++){
          const x0=c.x-ox, z0=c.z-oz; let ok=true, supN=0; const bel=new Set(), own=new Set();
          for(let i=0;i<w&&ok;i++) for(let j=0;j<d;j++){
            const kk=(x0+i)+','+(z0+j), cc=avail.get(kk);
            if(!cc||owner.has(kk)||cc.color!==c.color){ ok=false; break; }
            own.add(kk); const s=supportAt(x0+i,z0+j,y); if(s!==undefined){ supN++; bel.add(s); } }
          if(!ok||supN===0) continue;
          let aligned=0, stacked=0;
          if(y>0) for(let i=0;i<w;i++) for(let j=0;j<d;j++){ const x=x0+i, z=z0+j;
            for(const [dx,dz] of N4){ const nx=x+dx, nz=z+dz, nk=nx+','+nz; if(own.has(nk)||!avail.has(nk)) continue;
              if(seamBelow(x,z,nx,nz,1)){ aligned++; if(y-1-h>=0&&seamBelow(x,z,nx,nz,1+h)) stacked++; } } }
          const orient=((w>=d)===(par===0))?1:0;
          const jit=small?(((x0*92821)^(z0*68917)^(y*31337)^(w*7))>>>0)%7*0.9:0;
          const score=w*d*3+Math.min(bel.size,3)*5-aligned*7-stacked*30+orient+jit;
          if(!best||score>best.score) best={score,x0,z0,w,d};
        }
      }
      if(!best) best={x0:c.x,z0:c.z,w:1,d:1};
      best.color=c.color; const idx=plan.length; plan.push(best);
      for(let i=0;i<best.w;i++) for(let j=0;j<best.d;j++) owner.set((best.x0+i)+','+(best.z0+j),idx);
    }
    // repair: seams that would stack through three courses (1-wide runs only)
    if(y-1-h>=0) for(let pass=0;pass<3;pass++){ let changed=false;
      for(const c of cells){ for(const [dx,dz] of [[1,0],[0,1]]){
        const nk=(c.x+dx)+','+(c.z+dz); if(!owner.has(c.k)||!owner.has(nk)) continue;
        const ia=owner.get(c.k), ib=owner.get(nk); if(ia===ib) continue;
        const A=plan[ia], B=plan[ib]; if(!A||!B||A.color!==B.color) continue;
        if(!(seamBelow(c.x,c.z,c.x+dx,c.z+dz,1)&&seamBelow(c.x,c.z,c.x+dx,c.z+dz,1+h))) continue;
        const axisX=dx===1, lenA=axisX?A.w:A.d, lenB=axisX?B.w:B.d, thinA=axisX?A.d===1:A.w===1, thinB=axisX?B.d===1:B.w===1;
        const lineOK=axisX?(A.z0===B.z0&&thinA&&thinB):(A.x0===B.x0&&thinA&&thinB);
        const aOK=(axisX?A.d:A.w)===1||lenA===1, bOK=(axisX?B.d:B.w)===1||lenB===1;
        if(!lineOK&&!(aOK&&bOK&&((axisX?A.d:A.w)===1)&&((axisX?B.d:B.w)===1))) continue;
        // try merge
        if(LEN_OK.has(lenA+lenB)&&lenA+lenB<=8){
          const M={x0:Math.min(A.x0,B.x0),z0:Math.min(A.z0,B.z0),w:axisX?lenA+lenB:1,d:axisX?1:lenA+lenB,color:A.color};
          plan[ia]=M; plan[ib]=null;
          for(let i=0;i<M.w;i++) for(let j=0;j<M.d;j++) owner.set((M.x0+i)+','+(M.z0+j),ia);
          changed=true; continue; }
        // try shifting the seam by one stud either way
        for(const dir of [-1,1]){
          const nA=lenA+dir, nB=lenB-dir; if(nA<1||nB<1||!LEN_OK.has(nA)||!LEN_OK.has(nB)) continue;
          const A2=axisX?{x0:A.x0,z0:A.z0,w:nA,d:1,color:A.color}:{x0:A.x0,z0:A.z0,w:1,d:nA,color:A.color};
          const B2=axisX?{x0:B.x0+dir,z0:B.z0,w:nB,d:1,color:B.color}:{x0:B.x0,z0:B.z0+dir,w:1,d:nB,color:B.color};
          const ex=axisX?A2.x0+A2.w-1:A2.x0, ez=axisX?A2.z0:A2.z0+A2.d-1;
          if(seamBelow(ex,ez,ex+dx,ez+dz,1)&&seamBelow(ex,ez,ex+dx,ez+dz,1+h)) continue;
          const sup=P=>{ for(let i=0;i<P.w;i++) for(let j=0;j<P.d;j++) if(supportAt(P.x0+i,P.z0+j,y)!==undefined) return true; return false; };
          if(!sup(A2)||!sup(B2)) continue;
          plan[ia]=A2; plan[ib]=B2;
          for(let i=0;i<A2.w;i++) for(let j=0;j<A2.d;j++) owner.set((A2.x0+i)+','+(A2.z0+j),ia);
          for(let i=0;i<B2.w;i++) for(let j=0;j<B2.d;j++) owner.set((B2.x0+i)+','+(B2.z0+j),ib);
          changed=true; break; }
      } }
      if(!changed) break; }
    const out=[];
    for(const P of plan){ if(!P) continue;
      const p=commit(makePart(resolvePart(kind+':'+P.w+'x'+P.d),P.x0,y,P.z0,0,P.color,meta)); out.push(p.id); }
    return out;
  }

  (design.ops||[]).forEach((op,i)=>{
    const meta={op:i, phase:op.phase};
    if(op.phase===undefined || !phaseIdx.has(op.phase)){ errors.push({msg:`Step ${i+1} uses phase "${op.phase}", which isn't in the phase list`, op:i}); return; }
    try{
    switch(op.op){
      case 'walls': {
        const cellSet=new Map();
        for(const s of op.segments) for(const [x,z] of lineCells(s)) cellSet.set(x+','+z,[x,z]);
        for(const [k,[x,z]] of cellSet) for(const [dx,dz] of N4){ const nk=(x+dx)+','+(z+dz); if(cellSet.has(nk)) wallPairs.add(k<nk?k+'|'+nk:nk+'|'+k); }
        const opens=(op.openings||[]).map(o=>{ const line=lineCells(o.cells); return Object.assign({},o,{line,set:new Set(line.map(c=>c[0]+','+c[1]))}); });
        for(const o of opens) for(const k of o.set) if(!cellSet.has(k)) errors.push({msg:`Opening cell (${k}) isn't on a wall`, op:i});
        const wbase=op.base!==undefined?op.base:op.courses[0]*3;
        const trim=new Map();
        if(op.trim) for(const o of opens){ if(!o.fill.part) continue;
          const along=o.cells[1]===o.cells[3], L=o.line, first=L[0], last=L[L.length-1];
          const before=along?[first[0]-1,first[1]]:[first[0],first[1]-1], after=along?[last[0]+1,last[1]]:[last[0],last[1]+1];
          const span=[before,...L,after];
          const put=(x,z,c)=>{ const k=x+','+z; if(!cellSet.has(k)||c<op.courses[0]||c>op.courses[1]) return;
            if(opens.some(q=>q.set.has(k)&&c>=q.courses[0]&&c<=q.courses[1])) return; trim.set(k+'|'+c,op.trim); };
          if(op.trimSides!==false) for(let c=o.courses[0];c<=o.courses[1];c++){ put(before[0],before[1],c); put(after[0],after[1],c); }
          if(op.trimHeader!==false) (op.trimSides===false?L:span).forEach(([x,z])=>put(x,z,o.courses[1]+1));
          if(op.trimSill!==false) (op.trimSides===false?L:span).forEach(([x,z])=>put(x,z,o.courses[0]-1));
        }
        for(let c=op.courses[0];c<=op.courses[1];c++){
          const y=wbase+(c-op.courses[0])*3; wallCourses.set(c,y);
          for(const o of opens) if(o.fill.part && o.courses[0]===c){
            const along=o.cells[1]===o.cells[3], def=resolvePart(o.fill.part), span=o.line.length;
            if(def.w!==span||def.h!==(o.courses[1]-o.courses[0]+1)*3) errors.push({msg:`${def.name} doesn't fit the ${span}-stud, ${o.courses[1]-o.courses[0]+1}-course opening at (${o.line[0]})`, op:i});
            else place(o.fill.part,o.line[0][0],y,o.line[0][1],along?0:1,o.fill.color||'White',meta,true);
          }
          const level=new Map();
          for(const [k] of cellSet){
            const o=opens.find(o=>o.set.has(k)&&c>=o.courses[0]&&c<=o.courses[1]);
            if(!o) level.set(k,trim.get(k+'|'+c)||op.color); else if(o.fill.color&&!o.fill.part) level.set(k,o.fill.color);
          }
          const smallC=new Set(opens.filter(o=>o.fill.small&&o.fill.color).map(o=>o.fill.color));
          for(const id of pack(level,'brick',y,meta,col=>smallC.has(col)?[[1,3],[1,2],[1,1]]:null)){ const p=parts[id-1]; p.wall=true;
            for(let a=0;a<p.w;a++) for(let b=0;b<p.d;b++) wallCourse.set(K3(p.x+a,p.z+b,c),id); }
        }
        break; }
      case 'roof': {
        const [x0,z0,x1,z1]=op.rect, gb=new Set(op.gable||[]), ab=new Set([...(op.abut||[]),...gb]);
        const m={W:ab.has('W')?0:1,E:ab.has('E')?0:1,N:ab.has('N')?0:1,S:ab.has('S')?0:1};
        const reg=r=>({x0:x0+r*m.W,x1:x1-r*m.E,z0:z0+r*m.N,z1:z1-r*m.S});
        const valid=r=>r.x0<=r.x1&&r.z0<=r.z1, inR=(r,x,z)=>x>=r.x0&&x<=r.x1&&z>=r.z0&&z<=r.z1;
        const ids=[];
        for(let r=0;r<64;r++){
          const outer=reg(r-1), hole=reg(r+1), last=!valid(hole);
          if(!valid(outer)) break;
          const level=new Map();
          for(let x=outer.x0;x<=outer.x1;x++) for(let z=outer.z0;z<=outer.z1;z++) if(last||!inR(hole,x,z)) level.set(x+','+z,op.color);
          if(r===0&&op.fascia) for(const k of level.keys()) level.set(k,op.fascia);
          if(gb.size) for(const k of level.keys()){ const [gx,gz]=k.split(',').map(Number);
            if((gb.has('S')&&gz===z1)||(gb.has('N')&&gz===z0)||(gb.has('W')&&gx===x0)||(gb.has('E')&&gx===x1)) level.set(k,op.gableColor||op.color); }
          ids.push(...pack(level,'plate',op.base+r,meta));
          if(last) break;
        }
        const E=reg(-1);
        for(const id of ids){ const p=parts[id-1], top=p.y+p.h;
          for(let a=0;a<p.w;a++) for(let b=0;b<p.d;b++){ const x=p.x+a, z=p.z+b; if(occ.has(K3(x,z,top))) continue;
            const c=[]; if(m.S) c.push(['S',E.z1-z]); if(m.N) c.push(['N',z-E.z0]); if(m.E) c.push(['E',E.x1-x]); if(m.W) c.push(['W',x-E.x0]);
            let best=c[0]; for(const q of c) if(q[1]<best[1]) best=q;
            let cc=op.cap||op.color;
            if(op.mix){ const hsh=((x*73856093)^(z*19349663)^(top*83492791))>>>0; let u=(hsh%1000)/1000;
              for(const [mc,fr] of op.mix){ if(u<fr){ cc=mc; break; } u-=fr; } }
            const q=place('cheese',x,top,z,0,cc,meta,false); if(q) q.dir=best[0]; } }
        break; }
      case 'band': {
        const [x0,z0,x1,z1]=op.rect, skip=op.skip||[];
        const inSkip=(x,z)=>skip.some(r=>x>=Math.min(r[0],r[2])&&x<=Math.max(r[0],r[2])&&z>=Math.min(r[1],r[3])&&z<=Math.max(r[1],r[3]));
        const level=new Map(), outer=new Map();
        for(let x=x0-1;x<=x1+1;x++) for(let z=z0-1;z<=z1+1;z++){
          const out=x<x0||x>x1||z<z0||z>z1, line=!out&&(x===x0||x===x1||z===z0||z===z1);
          if((out||line)&&!inSkip(x,z)){ level.set(x+','+z,op.color); if(out) outer.set(x+','+z,op.capColor||op.color); } }
        pack(level,'plate',op.y,meta);
        if(op.cap!=='none') pack(outer,'tile',op.y+1,meta);
        break; }
      case 'fill': {
        const level=new Map(); for(const r of op.rects) for(const [x,z] of rectCells(r)) level.set(x+','+z,op.color);
        pack(level,op.kind||'tile',op.y||0,meta); break; }
      case 'place': { const q=place(op.part,op.at[0],op.at[1],op.at[2],op.rot||0,op.color,meta,true); if(q&&op.dir) q.dir=op.dir; break; }
      case 'places': for(const a of op.at){ const [x,y,z]=a.length===3?a:[a[0],op.y||0,a[1]]; const q=place(op.part,x,y,z,op.rot||0,op.color,meta,true); if(q&&op.dir) q.dir=op.dir; } break;
      case 'fence': {
        const [x0,z0,x1,z1]=op.line, along=z0===z1, L=along?Math.abs(x1-x0)+1:Math.abs(z1-z0)+1;
        if(L%4) warnings.push({msg:`Fence run from (${x0}, ${z0}) is ${L} studs long, so ${L%4} studs stay open`, op:i});
        for(let s=0;s+4<=L;s+=4) place('fence4',along?Math.min(x0,x1)+s:x0,op.y||0,along?z0:Math.min(z0,z1)+s,along?0:1,op.color,meta,true);
        break; }
      case 'sub': {
        const si=subs.length; subs.push({name:op.name, phase:op.phase, copies:op.copies.length, op:i, partIds:[]});
        op.copies.forEach((c,ci)=>op.parts.forEach((pp,pi)=>{
          const q=place(pp.part,c[0]+pp.at[0],c[1]+pp.at[1],c[2]+pp.at[2],pp.rot||0,pp.color,Object.assign({},meta,{sub:si,copy:ci,tpl:pi}),true);
          if(q) subs[si].partIds.push(q.id); }));
        break; }
      default: errors.push({msg:`Unknown operation "${op.op}"`, op:i});
    }
    }catch(e){ errors.push({msg:e.message, op:i}); }
  });

  // ---------- manual steps ----------
  const STEP_MAX=8, SUB_MAX=4, steps=[];
  const main=phases.map(()=>[]);
  for(const p of parts) if(p.sub===undefined) main[phaseIdx.get(p.phase)].push(p);
  phases.forEach((ph,pi)=>{
    const list=main[pi].sort((a,b)=>a.y-b.y||a.id-b.id), local=[]; let cur=null;
    for(const p of list){
      const n=cur?cur.parts.length:0;
      if(!cur||n>=STEP_MAX||(p.y!==cur.lastY&&n>=4)){ cur={kind:'main',phase:ph,parts:[],lastY:p.y}; local.push(cur); }
      cur.parts.push(p.id); cur.lastY=p.y;
    }
    local.forEach((s,k)=>{ s.title=ph; s.n=k+1; s.of=local.length; steps.push(s); });
    subs.forEach((s,si)=>{ if(s.phase!==ph) return;
      const tpl=s.partIds.map(id=>parts[id-1]).filter(p=>p.copy===0).sort((a,b)=>a.y-b.y||a.id-b.id), ss=[];
      for(let k=0;k<tpl.length;k+=SUB_MAX) ss.push({kind:'sub',phase:ph,sub:si,parts:tpl.slice(k,k+SUB_MAX).map(p=>p.id)});
      ss.forEach((st,k)=>{ st.title=s.name; st.n=k+1; st.of=ss.length; steps.push(st); });
      steps.push({kind:'attach',phase:ph,sub:si,parts:s.partIds.slice(),title:s.copies>1?`Place the ${s.name.toLowerCase()}s`:`Place the ${s.name.toLowerCase()}`,n:1,of:1});
    });
  });
  steps.forEach((s,si)=>{ s.index=si;
    if(s.kind==='main') s.parts.forEach(id=>{ parts[id-1].mainStep=si; });
    if(s.kind==='sub') s.parts.forEach(id=>{ parts[id-1].buildStep=si; });
    if(s.kind==='attach') s.parts.forEach(id=>{ parts[id-1].mainStep=si; });
  });
  for(const s of subs){ const byTpl=new Map(); s.partIds.forEach(id=>{ const p=parts[id-1]; if(p.copy===0) byTpl.set(p.tpl,p.buildStep); });
    s.partIds.forEach(id=>{ const p=parts[id-1]; if(p.copy!==0) p.buildStep=byTpl.get(p.tpl); }); }
  // global placement sequence
  let seq=0; steps.forEach(s=>{ if(s.kind!=='sub') s.parts.forEach(id=>{ const p=parts[id-1]; if(p.seq===undefined) p.seq=seq++; }); });

  // ---------- connection check ----------
  const joints=[], jn=new Map(); parts.forEach(p=>jn.set(p.id,0)); let baseJoints=0;
  for(const p of parts) for(const [x,z] of p.sockets){ const s=supportAt(x,z,p.y); if(s===undefined) continue;
    joints.push([p.id,s]); jn.set(p.id,jn.get(p.id)+1); if(s==='base') baseJoints++; else jn.set(s,jn.get(s)+1); }
  const below=new Map(); parts.forEach(p=>below.set(p.id,[])); joints.forEach(([a,b])=>below.get(a).push(b));
  const flagged=new Set();
  for(const p of parts){
    if(p.sub===undefined){
      const ok=below.get(p.id).some(b=>b==='base'||parts[b-1].seq<p.seq);
      if(!ok){ flagged.add(p.id); errors.push({msg:`${p.name} #${p.id} at (${p.x}, ${p.y}, ${p.z}) has nothing to hold on to when it's placed`, op:p.op, part:p.id}); }
    }
  }
  subs.forEach((s,si)=>{
    for(let ci=0;ci<s.copies;ci++){
      const cp=s.partIds.map(id=>parts[id-1]).filter(p=>p.copy===ci).sort((a,b)=>a.y-b.y||a.id-b.id);
      const inCopy=new Set(cp.map(p=>p.id)), before=new Set(); let attach=0;
      cp.forEach((p,k)=>{
        const bl=below.get(p.id);
        if(k>0&&!bl.some(b=>b!=='base'&&before.has(b))&&!bl.some(b=>b==='base'||!inCopy.has(b))){ flagged.add(p.id); errors.push({msg:`${s.name}: ${p.name.toLowerCase()} #${p.id} isn't attached to the rest of the sub-build`, op:s.op, part:p.id}); }
        attach+=bl.filter(b=>b==='base'||!inCopy.has(b)).length; before.add(p.id);
      });
      if(attach===0) errors.push({msg:`${s.name} ${ci+1} doesn't attach to the model`, op:s.op});
      else if(attach===1) warnings.push({msg:`${s.name} ${ci+1} is held on by a single stud`, op:s.op});
    }
  });
  // global connectivity
  const par=new Map(); const f=a=>{ while(par.get(a)!==a){ par.set(a,par.get(par.get(a))); a=par.get(a);} return a; };
  par.set('base','base'); parts.forEach(p=>par.set(p.id,p.id)); joints.forEach(([a,b])=>{ const ra=f(a), rb=f(b); if(ra!==rb) par.set(ra,rb); });
  const root=f('base');
  for(const p of parts) if(f(p.id)!==root&&!flagged.has(p.id)){ errors.push({msg:`${p.name} #${p.id} at (${p.x}, ${p.y}, ${p.z}) isn't connected to the baseplate`, op:p.op, part:p.id}); flagged.add(p.id); }
  for(const p of parts){ const area=p.shape==='arch'?4:p.w*p.d; if(area>=2&&jn.get(p.id)<=1&&!flagged.has(p.id)) warnings.push({msg:`${p.name} #${p.id} at (${p.x}, ${p.y}, ${p.z}) is held by a single stud`, op:p.op, part:p.id}); }
  // stacked seams
  const courses=[...wallCourses.keys()].sort((a,b)=>a-b);
  for(const pr of wallPairs){ const [a,b]=pr.split('|'); let run=0;
    for(let idx=0;idx<courses.length;idx++){ const c=courses[idx];
      const ia=wallCourse.get(a+','+c), ib=wallCourse.get(b+','+c);
      const seam=ia&&ib&&ia!==ib&&parts[ia-1].color===parts[ib-1].color;
      const contiguous=idx>0&&courses[idx-1]===c-1&&wallCourses.get(c-1)+3===wallCourses.get(c);
      run=seam?((contiguous&&run>0)?run+1:1):0;
      if(run===3) warnings.push({msg:`Wall seam between (${a}) and (${b}) runs straight up through 3 courses from course ${c-2}`, op:null});
    } }

  // ---------- inventory ----------
  const lots=new Map(); const add=(no,name,color,cost,kind)=>{ const k=no+'|'+color; const e=lots.get(k)||{no,name,color,q:0,cost,kind}; e.q++; lots.set(k,e); };
  add(BASEPLATE.no,BASEPLATE.name,BASEPLATE.color,BASEPLATE.cost,'baseplate');
  let glassN=0;
  for(const p of parts){ add(p.no,p.name,p.color,p.cost,p.kind); if(p.glass){ add(p.glass.no,p.glass.name,'Trans-Clear',GLASS_COST,'glass'); glassN++; } }
  const inventory=[...lots.values()];
  const cost=inventory.reduce((s,e)=>s+e.q*e.cost,0);
  const pieces=parts.length+glassN+1;
  const pages=1+Math.ceil(inventory.length/24)+steps.length;
  const ms=clock.now()-t0;
  return {parts,steps,subs,errors,warnings,joints,jn,inventory,occ,
    stats:{pieces,steps:steps.length,subBuilds:subs.length,pages,lots:inventory.length,cost,joints:joints.length,baseJoints,ms}};
}
if(typeof module!=='undefined') module.exports={compile,COLORS,SPECIAL,SIZE_PARTS};
