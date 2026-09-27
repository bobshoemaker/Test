// Brickhouse engine: part catalog, design compiler, connection checker, manual steps.
// Dependency-free. Runs in the browser (globals) and in Node (require).
// The design language it compiles is documented in src/server/prompt.js (SPEC).

const COLORS = {
  'White':{hex:'#F2F3F2',bl:1}, 'Tan':{hex:'#E4CD9E',bl:2}, 'Dark Tan':{hex:'#958A73',bl:69},
  'Light Bluish Gray':{hex:'#A0A5A9',bl:86}, 'Dark Bluish Gray':{hex:'#6C6E68',bl:85}, 'Black':{hex:'#2B2B2B',bl:11},
  'Reddish Brown':{hex:'#582A12',bl:88}, 'Dark Orange':{hex:'#A95500',bl:68}, 'Green':{hex:'#237841',bl:6},
  'Dark Green':{hex:'#184632',bl:80}, 'Bright Green':{hex:'#4B9F4A',bl:36}, 'Trans-Clear':{hex:'#CFE6F2',bl:12},
  'Red':{hex:'#C91A09',bl:5}, 'Yellow':{hex:'#F2CD37',bl:3}, 'Bright Pink':{hex:'#E4ADC8',bl:104}, 'Sand Green':{hex:'#A0BCAC',bl:48},
  'Blue':{hex:'#0055BF',bl:7}, 'Medium Nougat':{hex:'#AA7D55',bl:150}, 'Light Gray':{hex:'#C8C8C8',bl:9}, 'Dark Red':{hex:'#720E0F',bl:59}, 'Sand Blue':{hex:'#6074A1',bl:55}, 'Olive Green':{hex:'#9B9A5A',bl:155}, 'Dark Brown':{hex:'#352100',bl:120}, 'Trans-Yellow':{hex:'#F5CD2F',bl:19}, 'Trans-Black':{hex:'#3B3F46',bl:13}
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
  palmtop:{no:'2566', name:'Palm tree top', w:1,d:1,h:1, studs:false, shape:'palm', cost:0.30},
  // Sideways building (SNOT): a brick with a stud on one side sits in a wall opening, facing out,
  // and wall details hang on that stud (the "detail" op). Mounted parts are drawn as small blocks.
  snot:{no:'87087', name:'Brick 1 x 1 with stud on 1 side', w:1,d:1,h:3, shape:'box', cost:0.08},
  bracket11:{no:'36840', name:'Bracket 1 x 1 - 1 x 1', w:1,d:1,h:1, shape:'bracket', cost:0.06},
  cone1:{no:'4589', name:'Cone 1 x 1', w:1,d:1,h:3, shape:'cyl', diam:0.9, cost:0.05},
  sidetile1:{no:'3070b', name:'Tile 1 x 1 (on a side stud)', w:1,d:1,h:3, studs:false, shape:'box', cost:0.05},
  sidetile2:{no:'3069b', name:'Tile 1 x 2 (on side studs)', w:2,d:1,h:3, studs:false, shape:'box', cost:0.06}
};
// Baseplates by size: a design sets "plate": 48 for the larger one (default 32).
const GLASS_COST = 0.10, BASEPLATES = {32:{no:'3811', name:'Baseplate 32 x 32', color:'Green', cost:12}, 48:{no:'4186', name:'Baseplate 48 x 48', color:'Green', cost:25}};
// Plant library for the "plant" op: sub-builds checked to stand on their own, placed by kind.
// Offsets are from the plant's corner stud; "bloom" parts take the op's bloom color.
const P=(part,color,x,y,z,dir)=>({part,color,at:[x,y,z],...(dir?{dir}:{})});
const PLANTS = {
  'olive tree':{name:'Olive tree', parts:[P('roundplate2','Dark Tan',0,0,0),P('round1','Reddish Brown',0,1,0),P('round1','Reddish Brown',1,1,1),P('round1','Reddish Brown',0,4,0),P('round1','Reddish Brown',1,4,1),
    P('plate:2x2','Olive Green',0,7,0),P('plate:4x4','Olive Green',-1,8,-1),P('plate:2x2','Olive Green',0,9,0),P('roundplate1','Sand Green',-1,9,-1),P('roundplate1','Sand Green',2,9,-1),P('roundplate1','Sand Green',-1,9,2),P('roundplate1','Sand Green',2,9,2),P('roundplate2','Sand Green',0,10,0)]},
  'yucca':{name:'Yucca', parts:[P('roundplate2','Dark Tan',0,0,0),P('round1','Tan',0,1,0),P('round1','Tan',0,4,0),P('palmtop','Sand Green',0,7,0)]},
  'agave':{name:'Agave', parts:[P('plate:2x2','Sand Green',0,0,0),P('cheese','Sand Green',0,1,0,'W'),P('cheese','Sand Green',1,1,0,'N'),P('cheese','Sand Green',1,1,1,'E'),P('cheese','Sand Green',0,1,1,'S')]},
  'columnar cactus':{name:'Columnar cactus', parts:[P('plate:2x2','Dark Tan',0,0,0),P('round1','Green',0,1,0),P('round1','Green',0,4,0),P('round1','Green',0,7,0),P('roundplate1','Green',0,10,0),P('round1','Green',1,1,1),P('round1','Green',1,4,1),P('roundplate1','Green',1,7,1)]},
  'palm':{name:'Palm tree', parts:[P('roundplate2','Dark Tan',0,0,0),P('round1','Reddish Brown',0,1,0),P('round1','Dark Tan',0,4,0),P('round1','Reddish Brown',0,7,0),P('round1','Dark Tan',0,10,0),P('round1','Reddish Brown',0,13,0),P('palmtop','Green',0,16,0)]},
  'cypress':{name:'Cypress', parts:[P('roundbrick2','Dark Green',0,0,0),P('roundbrick2','Dark Green',0,3,0),P('roundbrick2','Dark Green',0,6,0),P('roundbrick2','Dark Green',0,9,0),P('roundplate2','Dark Green',0,12,0)]},
  'shade tree':{name:'Shade tree', parts:[P('roundbrick2','Reddish Brown',0,0,0),P('roundbrick2','Reddish Brown',0,3,0),P('roundbrick2','Reddish Brown',0,6,0),P('plate:6x6','Green',-2,9,-2),
    P('brick:6x2','Green',-2,10,-2),P('brick:6x2','Dark Green',-2,10,0),P('brick:6x2','Green',-2,10,2),P('plate:4x4','Dark Green',-1,13,-1),P('brick:4x2','Green',-1,14,-1),P('brick:4x2','Green',-1,14,1),P('roundplate2','Dark Green',0,17,0)]},
  'shrub':{name:'Shrub', parts:[P('roundbrick2','Dark Green',0,0,0),P('roundplate2','Green',0,3,0)]},
  'flowering shrub':{name:'Flowering shrub', parts:[P('roundbrick2','Dark Green',0,0,0),P('roundplate1','bloom',0,3,0),P('roundplate1','Green',1,3,0),P('roundplate1','Green',0,3,1),P('roundplate1','bloom',1,3,1)]},
  'grasses':{name:'Grasses', parts:[P('plate:2x1','Olive Green',0,0,0),P('cheese','Olive Green',0,1,0,'W'),P('cheese','Olive Green',1,1,0,'E')]},
  'lavender':{name:'Lavender', parts:[P('plate:2x1','Sand Green',0,0,0),P('roundplate1','Sand Blue',0,1,0),P('roundplate1','Sand Blue',1,1,0)]},
  'flower bed':{name:'Flower bed', parts:[P('plate:4x2','Reddish Brown',0,0,0),...[0,1,2,3].flatMap(x=>[0,1].map(z=>P('roundplate1',(x+z)%2?'Green':'bloom',x,1,z)))]},
  'lemon tree':{name:'Lemon tree', parts:[P('roundplate2','Reddish Brown',0,0,0),P('round1','Reddish Brown',0,1,0),P('round1','Reddish Brown',1,1,1),P('plate:2x2','Dark Green',0,4,0),P('roundbrick2','Green',0,5,0),
    P('roundplate1','Yellow',0,8,0),P('roundplate1','Green',1,8,0),P('roundplate1','Green',0,8,1),P('roundplate1','Yellow',1,8,1)]},
};

// Roof and yard fixtures for the "fixture" op, placed like plants (on studs, from the corner stud).
const FIXTURES = {
  'skylight':{name:'Skylight', parts:[P('plate:2x2','White',0,0,0),P('tile:2x2','Trans-Clear',0,1,0)]},
  'hvac unit':{name:'HVAC unit', parts:[P('plate:2x4','Light Bluish Gray',0,0,0),P('brick:2x4','Light Gray',0,1,0),P('tile:2x2','Dark Bluish Gray',0,4,0),P('tile:2x2','Light Gray',0,4,2)]},
  'vent pipe':{name:'Vent pipe', parts:[P('plate:1x2','Dark Bluish Gray',0,0,0),P('round1','Light Gray',0,1,0),P('roundplate1','Dark Bluish Gray',0,4,0)]},
  'solar panel':{name:'Solar panel', parts:[P('plate:2x4','Light Bluish Gray',0,0,0),P('tile:2x4','Black',0,1,0)]},
  'roof hatch':{name:'Roof hatch', parts:[P('plate:2x2','Light Bluish Gray',0,0,0),P('tile:2x2','Dark Bluish Gray',0,1,0)]},
  'chimney':{name:'Chimney', parts:[P('brick:2x2','White',0,0,0),P('brick:2x2','White',0,3,0),P('plate:2x2','Dark Bluish Gray',0,6,0),P('roundplate1','Black',0,7,0)]},
};

const N4 = [[1,0],[-1,0],[0,1],[0,-1]];
const DOOR_KINDS = ['door','garage door'];
const GRIP_MAX = 12; // studs a lift-off roof may grip: enough to locate it, few enough to lift it off
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
  const BASE=design&&design.plate!=null?Number(design.plate):32, BASEPLATE=BASEPLATES[BASE]||BASEPLATES[32];
  const clock=(typeof performance!=='undefined')?performance:Date;
  const t0=clock.now();
  const errors=[], warnings=[], parts=[], occ=new Map(), subs=[];
  if(!BASEPLATES[BASE]) errors.push({msg:`plate must be 32 or 48 (got ${design.plate})`, op:null});
  const phases=design.phases||[]; const phaseIdx=new Map(phases.map((p,i)=>[p,i]));
  // wall bricks by cell and height (not course number: each walls op counts its courses from its own base)
  const wallCourse=new Map(); const wallPairs=new Set(); const wallCourses=new Set();
  const abutEdges=[], doors=[];

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

  // Lengths the seam repair may merge or shift a 1-wide run to: only sizes this kind comes in
  // (tiles have no 1x3 or 1x6).
  const LEN_OK={}; for(const kind in SIZE_PARTS) LEN_OK[kind]=new Set(Object.keys(SIZE_PARTS[kind]).filter(s=>s.startsWith('1x')).map(s=>+s.slice(2)));
  function pack(level,kind,y,meta,sizesFor){
    const h=H[kind], cells=[], lenOk=LEN_OK[kind];
    // a lift-off roof is built on its own, so its pieces needn't sit on studs below (it rests on tiles)
    const floating=!!(meta&&design.ops&&design.ops[meta.op]&&design.ops[meta.op].liftoff);
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
          if(!ok||(supN===0&&!floating)) continue;
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
        if(lenOk.has(lenA+lenB)&&lenA+lenB<=8){
          const M={x0:Math.min(A.x0,B.x0),z0:Math.min(A.z0,B.z0),w:axisX?lenA+lenB:1,d:axisX?1:lenA+lenB,color:A.color};
          plan[ia]=M; plan[ib]=null;
          for(let i=0;i<M.w;i++) for(let j=0;j<M.d;j++) owner.set((M.x0+i)+','+(M.z0+j),ia);
          changed=true; continue; }
        // try shifting the seam by one stud either way
        for(const dir of [-1,1]){
          const nA=lenA+dir, nB=lenB-dir; if(nA<1||nB<1||!lenOk.has(nA)||!lenOk.has(nB)) continue;
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

  // "mix" on a fill or walls op: after packing, recolor a scattered few whole pieces of the op's main
  // color (a weathered roof, varied pavers or stucco). Whole pieces, so the structure doesn't change.
  function mixColors(ids,op,main,i){
    if(!op.mix) return;
    if(!Array.isArray(op.mix)||op.mix.some(m=>!Array.isArray(m)||!COLORS[m[0]]||!(m[1]>=0))){ errors.push({msg:'"mix" must be [[color, fraction], ...] with known colors', op:i}); return; }
    for(const id of ids){ const p=parts[id-1]; if(p.color!==main) continue;
      let u=((((p.x*73856093)^(p.z*19349663)^(p.y*83492791)^(i*2654435761))>>>0)%1000)/1000;
      for(const [mc,fr] of op.mix){ if(u<fr){ p.color=mc; break; } u-=fr; } }
  }

  // A hip roof over the union of several rectangles (an L or T): each plate course steps in one stud
  // from the outline of the whole shape (8-neighbour distance), so valleys form at inside corners
  // and wings meet without gaps. "against" lists rectangles of a taller building the roof leans on:
  // there the roof keeps rising into its wall (no eave), and everywhere else it has an eave.
  // Same fascia, mix and cheese slopes as a one-rectangle roof.
  function roofUnion(op,meta,i){
    const cellsOf=rs=>{ const out=new Set(); for(const r of rs||[]){ const [a,b,c,d]=r; for(let x=Math.min(a,c);x<=Math.max(a,c);x++) for(let z=Math.min(b,d);z<=Math.max(b,d);z++) out.add(x+','+z); } return out; };
    const inside=cellsOf(op.rects), against=cellsOf(op.against);
    for(const k of against) inside.delete(k);
    const eave=new Set(inside);
    for(const k of inside){ const [x,z]=k.split(',').map(Number); for(let dx=-1;dx<=1;dx++) for(let dz=-1;dz<=1;dz++){ const n=(x+dx)+','+(z+dz); if(!against.has(n)) eave.add(n); } }
    // depth: 8-neighbour steps to the nearest cell that is neither roof nor the building leaned on
    const solid=k=>eave.has(k)||against.has(k), depth=new Map(), q=[];
    for(const k of eave){ const [x,z]=k.split(',').map(Number); let edge=false;
      for(let dx=-1;dx<=1&&!edge;dx++) for(let dz=-1;dz<=1;dz++) if((dx||dz)&&!solid((x+dx)+','+(z+dz))){ edge=true; break; }
      if(edge){ depth.set(k,1); q.push([x,z]); } }
    for(let h=0;h<q.length;h++){ const [x,z]=q[h], d=depth.get(x+','+z);
      for(let dx=-1;dx<=1;dx++) for(let dz=-1;dz<=1;dz++){ const k=(x+dx)+','+(z+dz); if(eave.has(k)&&!depth.has(k)){ depth.set(k,d+1); q.push([x+dx,z+dz]); } } }
    if(!depth.size) return;
    const maxD=Math.max(...depth.values()), ids=[];
    for(let r=0;r+1<=maxD;r++){
      const last=r+3>maxD, level=new Map();
      for(const [k,d] of depth) if(d>=r+1&&(last||d<=r+2)) level.set(k,(r===0&&op.fascia)?op.fascia:op.color);
      if(!level.size) break;
      ids.push(...pack(level,'plate',op.base+r,meta));
      if(last) break;
    }
    // where it leans on the other building, that building has to rise above the roof
    const lean=[]; for(const k of eave){ const [x,z]=k.split(',').map(Number); for(const [dx,dz] of N4) if(against.has((x+dx)+','+(z+dz))) lean.push([x,z,dx,dz]); }
    if(lean.length) abutEdges.push({op:i, side:'leaning', cells:lean, ids});
    const dep=(x,z)=>against.has(x+','+z)?Infinity:(depth.get(x+','+z)||0);
    for(const id of ids){ const p=parts[id-1], top=p.y+p.h;
      for(let a=0;a<p.w;a++) for(let b=0;b<p.d;b++){ const x=p.x+a, z=p.z+b; if(occ.has(K3(x,z,top))) continue;
        let best=null; for(const [dn,dx,dz] of [['S',0,1],['N',0,-1],['E',1,0],['W',-1,0]]){ const v=dep(x+dx,z+dz); if(!best||v<best[1]) best=[dn,v]; }
        let cc=op.cap||op.color;
        if(op.mix){ const hsh=((x*73856093)^(z*19349663)^(top*83492791))>>>0; let u=(hsh%1000)/1000;
          for(const [mc,fr] of op.mix){ if(u<fr){ cc=mc; break; } u-=fr; } }
        const qq=place('cheese',x,top,z,0,cc,meta,false); if(qq) qq.dir=best[0]; } }
  }

  // inside the buildings: studs enclosed by walls ops at least a story (4 courses) tall
  const INSIDE=(()=>{ const barrier=new Set(), inside=new Set();
    (design.ops||[]).forEach(op=>{ if(op.op!=='walls'||!Array.isArray(op.segments)||!op.courses||op.courses[1]-op.courses[0]<3) return;
      try{ for(const sg of op.segments) for(const [x,z] of lineCells(sg)) barrier.add(x+','+z); }catch(e){} });
    if(!barrier.size) return inside;
    const seen=new Set(), q=[], inP=(x,z)=>x>=0&&z>=0&&x<BASE&&z<BASE;
    for(let t=0;t<BASE;t++) for(const [x,z] of [[t,0],[t,BASE-1],[0,t],[BASE-1,t]]){ const k=x+','+z; if(!barrier.has(k)&&!seen.has(k)){ seen.add(k); q.push([x,z]); } }
    while(q.length){ const [x,z]=q.pop(); for(const [dx,dz] of N4){ const nx=x+dx, nz=z+dz, k=nx+','+nz; if(inP(nx,nz)&&!barrier.has(k)&&!seen.has(k)){ seen.add(k); q.push([nx,nz]); } } }
    for(let x=0;x<BASE;x++) for(let z=0;z<BASE;z++){ const k=x+','+z; if(!barrier.has(k)&&!seen.has(k)) inside.add(k); }
    return inside; })();

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
        for(const o of opens) if(o.kind!==undefined){
          if(!DOOR_KINDS.includes(o.kind)) errors.push({msg:`Opening kind "${o.kind}" isn't one of ${DOOR_KINDS.join(', ')}`, op:i});
          else doors.push({op:i, kind:o.kind, line:o.line, along:o.cells[1]===o.cells[3], sill:wbase+(o.courses[0]-op.courses[0])*3, walls:cellSet}); }
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
          const y=wbase+(c-op.courses[0])*3; wallCourses.add(y);
          // side-stud bricks fill every cell of their opening, one course tall
          for(const o of opens) if(o.fill.part==='snot' && o.courses[0]===c){
            if(!'NSEW'.includes(o.fill.face||'-')||!o.fill.face) errors.push({msg:`A side-stud brick needs "face": "N", "S", "E" or "W" (the way its stud points)`, op:i});
            if(o.courses[1]!==o.courses[0]) errors.push({msg:`Side-stud bricks fill one course; the opening at (${o.line[0]}) spans ${o.courses[1]-o.courses[0]+1}`, op:i});
            for(const [cx,cz] of o.line){ const q=place('snot',cx,y,cz,0,o.fill.color||op.color,meta,true); if(q) q.face=o.fill.face; } }
          for(const o of opens) if(o.fill.part && o.fill.part!=='snot' && o.courses[0]===c){
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
          const ids=pack(level,'brick',y,meta,col=>smallC.has(col)?[[1,3],[1,2],[1,1]]:null); mixColors(ids,op,op.color,i);
          for(const id of ids){ const p=parts[id-1]; p.wall=true;
            for(let a=0;a<p.w;a++) for(let b=0;b<p.d;b++) wallCourse.set(K3(p.x+a,p.z+b,y),id); }
        }
        break; }
      case 'roof': {
        if(op.rects){ roofUnion(op,meta,i); break; }
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
        // An abutted side has no eave: its stepped edge must run against something at least as tall.
        for(const side of ab) if(!gb.has(side)){
          const cells=[]; if(side==='W'||side==='E') for(let z=z0;z<=z1;z++) cells.push([side==='W'?x0:x1,z,side==='W'?-1:1,0]);
          else for(let x=x0;x<=x1;x++) cells.push([x,side==='N'?z0:z1,0,side==='N'?-1:1]);
          abutEdges.push({op:i, side, cells, ids}); }
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
        mixColors(pack(level,op.kind||'tile',op.y||0,meta),op,op.color,i); break; }
      case 'floor': { // every stud inside the buildings (within rects, if given) at height y
        const lim=op.rects?new Set(op.rects.flatMap(r=>rectCells(r)).map(([x,z])=>x+','+z)):null, level=new Map();
        for(const k of INSIDE) if(!lim||lim.has(k)) level.set(k,op.color);
        if(!level.size) warnings.push({msg:'The floor op found no studs inside walls (it floors what walls at least 4 courses tall enclose)', op:i});
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
          if(q){ if(pp.dir) q.dir=pp.dir; subs[si].partIds.push(q.id); } }));
        break; }
      case 'detail': {
        const kind=String(op.kind||'').toLowerCase(), FACE={N:[0,-1],S:[0,1],E:[1,0],W:[-1,0]};
        const hostAt=(x,y,z)=>{ const id=occ.get(K3(x,z,y)); const h=id&&parts[id-1]; return h&&h.key==='snot'&&h.y===y?h:null; };
        for(const at of op.at||[]){ const [x,y,z]=at, h=hostAt(x,y,z);
          if(!h){ errors.push({msg:`No side-stud brick at (${x}, ${y}, ${z}) for the ${kind}; put one in a wall opening with fill {"part":"snot","face":...}`, op:i}); continue; }
          const [dx,dz]=FACE[h.face]||[0,0], ox=x+dx, oz=z+dz, hosts=[h.id];
          const mount=(q)=>{ if(q) q.mount=hosts.slice(); return q; };
          // lantern: a bracket clips its upright flange onto the side stud; its plate sticks out from the wall
          // with a stud on top, and the lamp stands on that stud (a trans cone capped with a round plate)
          if(kind==='lantern'){ const b=mount(place('bracket11',ox,y,oz,0,op.color||'Black',meta,true)); if(b) b.face=h.face;
            place('cone1',ox,y+1,oz,0,op.glow||'Trans-Yellow',meta,true); place('roundplate1',ox,y+4,oz,0,op.color||'Black',meta,true); }
          else if(kind==='house number'){
            const along=dx===0, h2=along?hostAt(x+1,y,z):hostAt(x,y,z+1);
            if(!h2||h2.face!==h.face){ errors.push({msg:`A house number needs two side-stud bricks side by side facing the same way, at (${x}, ${y}, ${z}) and the next stud ${along?'in x':'in z'}`, op:i}); continue; }
            hosts.push(h2.id); mount(place('sidetile2',ox,y,oz,along?0:1,op.color||'Black',meta,true)); }
          else if(kind==='plaque'||kind==='vent'){ mount(place('sidetile1',ox,y,oz,0,op.color||(kind==='vent'?'Dark Bluish Gray':'Tan'),meta,true)); }
          else errors.push({msg:`Unknown detail "${op.kind}"; details are lantern, house number, plaque, vent`, op:i});
        }
        break; }
      case 'plant': case 'fixture': {
        const LIB=op.op==='plant'?PLANTS:FIXTURES, def=LIB[String(op.kind||'').toLowerCase()];
        if(!def){ errors.push({msg:`Unknown ${op.op} "${op.kind}"; the library has ${Object.keys(LIB).join(', ')}`, op:i}); break; }
        const si=subs.length; subs.push({name:def.name, phase:op.phase, copies:op.at.length, op:i, partIds:[]});
        op.at.forEach((c,ci)=>def.parts.forEach((pp,pi)=>{
          const q=place(pp.part,c[0]+pp.at[0],c[1]+pp.at[1],c[2]+pp.at[2],0,pp.color==='bloom'?(op.bloom||'Bright Pink'):pp.color,Object.assign({},meta,{sub:si,copy:ci,tpl:pi}),true);
          if(q){ if(pp.dir) q.dir=pp.dir; subs[si].partIds.push(q.id); } }));
        break; }
      default: errors.push({msg:`Unknown operation "${op.op}"`, op:i});
    }
    }catch(e){ errors.push({msg:e.message, op:i}); }
  });

  // Lift-off roofs: ops sharing a "liftoff" name are built on their own, like a sub-build, and set
  // on the house as one piece (the manual shows them that way). They rest on the walls, gripping only
  // a few locating studs, so their plates needn't sit on studs as the house goes up.
  const liftGroups=new Map();
  for(const p of parts){ const op=design.ops[p.op]; if(op&&op.liftoff&&p.sub===undefined){ const n=String(op.liftoff); if(!liftGroups.has(n)) liftGroups.set(n,[]); liftGroups.get(n).push(p); } }
  for(const [name,ps] of liftGroups){
    const last=ps.reduce((a,b)=>phaseIdx.get(b.phase)>phaseIdx.get(a.phase)?b:a), si=subs.length;
    ps.sort((a,b)=>a.y-b.y||a.id-b.id).forEach((p,k)=>{ p.liftoff=name; p.sub=si; p.copy=0; p.tpl=k; });
    subs.push({name, phase:last.phase, copies:1, op:last.op, partIds:ps.map(p=>p.id), liftoff:true});
  }
  // plants and fixtures whose op names a lift-off roof stand on it and come off with it
  const riders=new Map();
  for(const p of parts){ const op=design.ops[p.op]; if(op&&op.liftoff&&p.liftoff===undefined){ p.liftoff=String(op.liftoff); if(!riders.has(p.liftoff)) riders.set(p.liftoff,[]); riders.get(p.liftoff).push(p.id); } }

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
  for(const p of parts) if(p.mount) for(const h of p.mount){ joints.push([p.id,h]); jn.set(p.id,jn.get(p.id)+1); jn.set(h,jn.get(h)+1); }
  const below=new Map(); parts.forEach(p=>below.set(p.id,[])); joints.forEach(([a,b])=>below.get(a).push(b));
  const flagged=new Set();
  for(const p of parts){
    if(p.sub===undefined){
      const ok=below.get(p.id).some(b=>b==='base'||parts[b-1].seq<p.seq);
      if(!ok){ flagged.add(p.id); errors.push({msg:`${p.name} #${p.id} at (${p.x}, ${p.y}, ${p.z}) has nothing to hold on to when it's placed`, op:p.op, part:p.id}); }
    }
  }
  subs.forEach((s,si)=>{
    if(s.liftoff) return; // checked as a whole below
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
  // roof edges left showing: an abutted side whose neighbour (a wall or another roof) stays lower
  if(abutEdges.length){
    const colTop=new Map(); for(const p of parts) for(let a=0;a<p.w;a++) for(let b=0;b<p.d;b++){ const k=(p.x+a)+','+(p.z+b); colTop.set(k,Math.max(colTop.get(k)||0,p.y+p.h)); }
    for(const e of abutEdges){
      const mine=new Map(); for(const id of e.ids){ const p=parts[id-1]; for(let a=0;a<p.w;a++) for(let b=0;b<p.d;b++){ const k=(p.x+a)+','+(p.z+b); mine.set(k,Math.max(mine.get(k)||0,p.y+p.h)); } }
      const bad=e.cells.filter(([x,z,dx,dz])=>{ const t=mine.get(x+','+z)||0; return t>0&&(colTop.get((x+dx)+','+(z+dz))||0)<t-1; });
      if(bad.length) warnings.push({msg:`Roof ${e.side==='leaning'?'leans on another building':`abuts on its ${e.side} side`}, but the roof's stepped edge shows above what's beside it at ${bad.length} stud${bad.length===1?'':'s'}, from (${bad[0][0]}, ${bad[0][1]}). Give wings that meet one roof with "rects", or abut only against a wall that rises above the roof`, op:e.op});
    }
  }
  // doors: the ground outside a door meets its bottom, and a garage door has a drive to the edge of the plate
  if(doors.length){
    // ground is built of fills and walls; cars, plants and furniture stand on it, and fences block a drive
    const kindOf=p=>(design.ops[p.op]||{}).op, cols=new Map(), fenced=new Set();
    for(const p of parts) for(let a=0;a<p.w;a++) for(let b=0;b<p.d;b++){ const k=(p.x+a)+','+(p.z+b), t=kindOf(p);
      if(t==='fence') fenced.add(k); if(t!=='fill'&&t!=='walls') continue; if(!cols.has(k)) cols.set(k,[]); cols.get(k).push(p); }
    // ground height: the stack that rises unbroken from the baseplate (eaves and wall lights overhead don't count)
    const ground=new Map(), groundAt=(x,z)=>{ const k=x+','+z; if(ground.has(k)) return ground.get(k);
      let g=0; for(const p of (cols.get(k)||[]).slice().sort((a,b)=>a.y-b.y)){ if(p.y>g) break; g=Math.max(g,p.y+p.h); }
      ground.set(k,g); return g; };
    const inPlate=(x,z)=>x>=0&&z>=0&&x<BASE&&z<BASE, outsides=new Map();
    const outsideOf=d=>{ if(outsides.has(d.walls)) return outsides.get(d.walls);
      const seen=new Set(), q=[];
      for(let t=0;t<BASE;t++) for(const [x,z] of [[t,0],[t,BASE-1],[0,t],[BASE-1,t]]){ const k=x+','+z; if(!d.walls.has(k)&&!seen.has(k)){ seen.add(k); q.push([x,z]); } }
      while(q.length){ const [x,z]=q.pop(); for(const [dx,dz] of N4){ const nx=x+dx, nz=z+dz, k=nx+','+nz; if(inPlate(nx,nz)&&!d.walls.has(k)&&!seen.has(k)){ seen.add(k); q.push([nx,nz]); } } }
      outsides.set(d.walls,seen); return seen; };
    for(const d of doors){
      const out=outsideOf(d), front=[];
      for(const [x,z] of d.line) for(const [dx,dz] of (d.along?[[0,1],[0,-1]]:[[1,0],[-1,0]])){ const nx=x+dx, nz=z+dz; if(out.has(nx+','+nz)) front.push([nx,nz]); }
      if(!front.length||front.length>d.line.length) continue; // a free-standing wall has no outside to check
      const g=Math.max(...front.map(([x,z])=>groundAt(x,z))), at=`(${d.line[0][0]}, ${d.line[0][1]})`, drop=d.kind==='door'?3:1;
      if(g>d.sill+1) warnings.push({msg:`The ${d.kind} at ${at} starts at height ${d.sill}, but the ground in front of it is at ${g}: it opens into the ground. Raise the door (its courses, or the walls' base) or lower what's in front of it`, op:d.op});
      else if(d.sill-g>drop) warnings.push({msg:`The ${d.kind} at ${at} starts at height ${d.sill}, ${d.sill-g} plates above the ground in front of it (${g}). ${d.kind==='door'?'Add a step or landing up to it':'A garage door opens at the level of its drive: raise the drive or lower the door'}`, op:d.op});
      else if(d.kind==='garage door'){
        const seen=new Set(front.map(c=>c.join(','))), q=front.slice(); let reached=false;
        while(q.length&&!reached){ const [x,z]=q.pop(), h=groundAt(x,z);
          if(x===0||z===0||x===BASE-1||z===BASE-1){ reached=true; break; }
          for(const [dx,dz] of N4){ const nx=x+dx, nz=z+dz, k=nx+','+nz; if(!inPlate(nx,nz)||seen.has(k)||d.walls.has(k)||fenced.has(k)||Math.abs(groundAt(nx,nz)-h)>1) continue; seen.add(k); q.push([nx,nz]); } }
        if(!reached) warnings.push({msg:`The garage door at ${at} has no drive to a street: from the ground in front of it no path reaches the edge of the plate without a step of more than one plate (fences, walls and terraces block it). Give it a driveway to the street or lane it opens onto`, op:d.op});
      }
    }
  }
  // the baseplate must not show inside a building (through windows, or under a lift-off roof)
  { const bare=[...INSIDE].filter(k=>{ const [x,z]=k.split(',').map(Number); return !occ.has(K3(x,z,0)); });
    if(bare.length) warnings.push({msg:`The baseplate shows inside a building at ${bare.length} stud${bare.length===1?'':'s'}, from (${bare[0]}): cover the floors inside the walls with a floor op (tiles at y 0) so no green shows through windows or under a lift-off roof`, op:null}); }
  // lift-off roofs: ops sharing a "liftoff" name come off as one piece, so they must hold together
  // on their own and nothing else may rest on them
  { for(const [name,ps] of liftGroups){ const ids=new Set([...ps.map(p=>p.id),...(riders.get(name)||[])]);
      const gp=new Map([...ids].map(id=>[id,id])), gf=a=>{ while(gp.get(a)!==a){ gp.set(a,gp.get(gp.get(a))); a=gp.get(a);} return a; };
      let held=0; const onTop=new Set();
      for(const [a,b] of joints){ const ia=ids.has(a), ib=b!=='base'&&ids.has(b);
        if(ia&&ib){ const ra=gf(a), rb=gf(b); if(ra!==rb) gp.set(ra,rb); }
        else if(ia&&!ib) held++;
        else if(!ia&&ib) onTop.add(a); }
      const comps=new Set([...ids].map(gf)).size;
      if(comps>1) errors.push({msg:`Lift-off roof "${name}" comes apart into ${comps} pieces when lifted; tie it together (plates or tiles across its seams) so it lifts as one`, op:null});
      if(onTop.size){ const p=parts[[...onTop][0]-1]; errors.push({msg:`${p.name} #${p.id} at (${p.x}, ${p.y}, ${p.z}) sits on lift-off roof "${name}" but isn't part of it, so the roof can't lift off; add "liftoff": "${name}" to its op or move it`, op:p.op, part:p.id}); }
      if(held<2) errors.push({msg:`Lift-off roof "${name}" is held on by ${held} stud${held===1?'':'s'}; leave at least two locating studs (at the corners) in the tiles it rests on`, op:null});
      else if(held>GRIP_MAX) warnings.push({msg:`Lift-off roof "${name}" grips the house with ${held} studs, too many to lift off by hand: tile the wall tops under it and leave only a few locating studs (2 to ${GRIP_MAX}, at the corners)`, op:null});
    } }
  // stacked seams
  const heights=[...wallCourses].sort((a,b)=>a-b);
  for(const pr of wallPairs){ const [a,b]=pr.split('|'); let run=0;
    for(let idx=0;idx<heights.length;idx++){ const y=heights[idx];
      const ia=wallCourse.get(a+','+y), ib=wallCourse.get(b+','+y);
      const seam=ia&&ib&&ia!==ib&&parts[ia-1].color===parts[ib-1].color;
      const contiguous=idx>0&&heights[idx-1]+3===y;
      run=seam?((contiguous&&run>0)?run+1:1):0;
      if(run===3) warnings.push({msg:`Wall seam between (${a}) and (${b}) runs straight up through 3 courses from height ${y-6}`, op:null});
    } }

  // ---------- hints (not problems): big bare stretches of plain tile, such as a roof or patio ----------
  const hints=[];
  { const topAt=new Map(); for(const p of parts) for(let a=0;a<p.w;a++) for(let b=0;b<p.d;b++){ const k=(p.x+a)+','+(p.z+b), t=topAt.get(k); if(!t||p.y+p.h>t.y+t.h) topAt.set(k,p); }
    const bare=k=>{ const p=topAt.get(k); return p&&p.kind==='tile'&&(p.sub===undefined||p.liftoff)?p:null; }, seen=new Set(), MIN=Math.round(BASE*BASE/16), SIDE=Math.ceil(BASE/5);
    for(const [k0] of topAt){ if(seen.has(k0)||!bare(k0)) continue;
      const h=bare(k0).y+1, comp=[], q=[k0], colors=new Set(); let edge=false; seen.add(k0);
      while(q.length){ const k=q.pop(), [x,z]=k.split(',').map(Number); comp.push([x,z]); colors.add(bare(k).color); if(x===0||z===0||x===BASE-1||z===BASE-1) edge=true;
        for(const [dx,dz] of N4){ const nk=(x+dx)+','+(z+dz), np=bare(nk); if(np&&np.y+1===h&&!seen.has(nk)){ seen.add(nk); q.push(nk); } } }
      if(edge||comp.length<MIN) continue;
      // the largest open square with nothing on it: scattered fixtures break it up, plain repetition doesn't
      const inC=new Set(comp.map(c=>c.join(','))), xs=comp.map(c=>c[0]), zs=comp.map(c=>c[1]), x0=Math.min(...xs), z0=Math.min(...zs);
      const dp=new Map(); let side=0, at=null;
      for(let x=x0;x<=Math.max(...xs);x++) for(let z=z0;z<=Math.max(...zs);z++){ if(!inC.has(x+','+z)) continue;
        const v=1+Math.min(dp.get((x-1)+','+z)||0,dp.get(x+','+(z-1))||0,dp.get((x-1)+','+(z-1))||0); dp.set(x+','+z,v); if(v>side){ side=v; at=[x-v+1,z-v+1]; } }
      if(side<SIDE) continue;
      const roof=parts[bare(k0).id-1].liftoff;
      hints.push({msg:`${roof?`Lift-off roof "${roof}"`:'A tiled area'} has an open ${side} x ${side} stretch of plain tile with nothing on it, from (${at[0]}, ${at[1]}) to (${at[0]+side-1}, ${at[1]+side-1}) at height ${h}. If the photos or an overhead view show what's there, add it (${roof?'fixture ops for skylights, vents, HVAC units, solar panels or a roof hatch, listed before the roof tiles so they stand on the deck, with the roof\'s "liftoff"':'furniture, pots, planters or a pattern'}); a "mix" of close colors also breaks up repetition. Not required.`, side, cells:comp.length}); }
  }

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
  return {parts,steps,subs,errors,warnings,hints,joints,jn,inventory,occ,
    stats:{liftoff:[...new Set(parts.filter(p=>p.liftoff).map(p=>p.liftoff))],pieces,steps:steps.length,subBuilds:subs.length,pages,lots:inventory.length,cost,joints:joints.length,baseJoints,ms,plate:BASEPLATES[BASE]?BASE:32}};
}
if(typeof module!=='undefined') module.exports={compile,COLORS,SPECIAL,SIZE_PARTS,PLANTS,FIXTURES};
