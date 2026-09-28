// Brickhouse engine: part catalog, design compiler, connection checker, manual steps.
// Dependency-free. Runs in the browser (globals) and in Node (require).
// The design language it compiles is documented in src/server/prompt.js (SPEC).

const COLORS = {
  'White':{hex:'#F2F3F2',bl:1}, 'Tan':{hex:'#E4CD9E',bl:2}, 'Dark Tan':{hex:'#958A73',bl:69}, 'Light Nougat':{hex:'#F6D7B3',bl:90},
  'Light Bluish Gray':{hex:'#A0A5A9',bl:86}, 'Dark Bluish Gray':{hex:'#6C6E68',bl:85}, 'Black':{hex:'#2B2B2B',bl:11},
  'Reddish Brown':{hex:'#582A12',bl:88}, 'Dark Orange':{hex:'#A95500',bl:68}, 'Green':{hex:'#237841',bl:6},
  'Dark Green':{hex:'#184632',bl:80}, 'Bright Green':{hex:'#4B9F4A',bl:36}, 'Trans-Clear':{hex:'#CFE6F2',bl:12},
  'Red':{hex:'#C91A09',bl:5}, 'Yellow':{hex:'#F2CD37',bl:3}, 'Bright Pink':{hex:'#E4ADC8',bl:104}, 'Sand Green':{hex:'#A0BCAC',bl:48},
  'Blue':{hex:'#0055BF',bl:7}, 'Medium Nougat':{hex:'#AA7D55',bl:150}, 'Light Gray':{hex:'#C8C8C8',bl:9}, 'Dark Red':{hex:'#720E0F',bl:59}, 'Sand Blue':{hex:'#6074A1',bl:55}, 'Olive Green':{hex:'#9B9A5A',bl:155}, 'Dark Brown':{hex:'#352100',bl:120}, 'Trans-Yellow':{hex:'#F5CD2F',bl:19}, 'Trans-Black':{hex:'#3B3F46',bl:13},
  // foliage and flowers
  'Lime':{hex:'#BBE90B',bl:34}, 'Yellowish Green':{hex:'#DFEEA5',bl:158}, 'Medium Lavender':{hex:'#AC78BA',bl:157}, 'Lavender':{hex:'#E1D5ED',bl:154},
  'Magenta':{hex:'#923978',bl:71}, 'Dark Pink':{hex:'#C870A0',bl:47}, 'Coral':{hex:'#FF698F',bl:220}, 'Orange':{hex:'#FE8A18',bl:4},
  'Bright Light Orange':{hex:'#F8BB3D',bl:110}, 'Bright Light Yellow':{hex:'#FFF03A',bl:103}, 'Medium Blue':{hex:'#5A93DB',bl:42}
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
  cheese:{no:'54200', name:'Slope 30 1 x 1 x 2/3', w:1,d:1,h:2, studs:false, shape:'cheese', cost:0.07}, // 2/3 of a brick: 2 plates
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
  // palm top: a hub with four upright bars; fronds clip onto the bars
  palmtop:{no:'2566', name:'Palm tree top', w:1,d:1,h:3, studs:false, shape:'palm', cost:0.30},
  swordleaf:{no:'30239', name:'Plant leaves 6 x 5 swordleaf with clip', w:5,d:6,h:1, clip:true, shape:'swordleaf', cost:0.15},
  // foliage, laid out from the LDraw parts library (cells as [i, j] on the w x d footprint at rot 0):
  // "plant leaves" are flat branching stems with a stud on each tip. "at" is the stud a plant presses
  // them onto, "socks" every stud underneath that can grip, "tips" the studs on top.
  leaves43:{no:'2423', name:'Plant leaves 4 x 3', w:3,d:4,h:1, shape:'leaves', at:[1,3], socks:[[1,3]], tips:[[1,3],[0,2],[2,2],[0,1],[2,1],[1,0]], cost:0.08},
  leaves65:{no:'2417', name:'Plant leaves 6 x 5', w:5,d:6,h:1, shape:'leaves', at:[2,3], socks:[[4,5],[0,5],[4,3],[2,3],[0,3],[2,0]],
    tips:[[4,5],[3,5],[1,5],[0,5],[4,4],[0,4],[4,3],[2,3],[0,3],[3,2],[1,2],[3,1],[1,1],[2,0]], cost:0.12},
  bush224:{no:'6064', name:'Plant bush 2 x 2 x 4', w:2,d:2,h:12, studs:false, shape:'bush', cost:0.15},
  sprig1:{no:'32607', name:'Plant plate round 1 x 1 with 3 leaves', w:1,d:1,h:1, shape:'sprig', cost:0.05},
  flower1:{no:'33291', name:'Plate round 1 x 1 with flower edge', w:1,d:1,h:1, shape:'flower', cost:0.05},
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
const P=(part,color,x,y,z,dir)=>({part,color,at:[x,y,z],...(typeof dir==='number'?{rot:dir}:dir?{dir}:{})});
// a swordleaf clipped onto the palm top at (cx, cz) (the plant's part number "on"), fanning out toward dir
const FROND=(color,cx,y,cz,dir,on)=>{ const [x,z]={N:[cx-2,cz-6],S:[cx-2,cz+1],E:[cx+1,cz-2],W:[cx-6,cz-2]}[dir]; return {...P('swordleaf',color,x,y,z,'EW'.includes(dir)?1:0),dir,on}; };
// a leaf clipped onto the stud at (cx, cz): its corner is placed so its middle hole lands there
const LEAF=(part,color,cx,y,cz,rot=0)=>{ const [ax,az]=turnCell(SPECIAL[part],SPECIAL[part].at,rot); return P(part,color,cx-ax,y,cz-az,rot); };
// the studs on top of that leaf, other than the one it's pressed onto: where fruit, flowers or sprigs go
const TIPS=(part,cx,cz,rot=0)=>{ const d=SPECIAL[part], [ax,az]=turnCell(d,d.at,rot);
  return d.tips.map(c=>turnCell(d,c,rot)).filter(([i,j])=>i!==ax||j!==az).map(([i,j])=>[cx-ax+i,cz-az+j]); };
// Colors follow the real plants, in colors LEGO makes each part in (see parts-availability.js): olive leaves are gray-green with silvery undersides, citrus and
// boxwood a glossy deep green, cypress nearly black-green, agave and yucca blue-gray, palm fronds a
// mid green, bark brown or gray-tan; new growth shows as a lighter green on the tips.
const PLANTS = {
  // trees: a trunk, then "plant leaves" branches pointing different ways at stepped heights, with
  // sprigs, flowers or fruit on the branch tips
  'shade tree':{name:'Shade tree', parts:[P('roundbrick2','Reddish Brown',0,0,0),P('roundbrick2','Reddish Brown',0,3,0),P('roundplate2','Dark Green',0,6,0),
    LEAF('leaves65','Dark Green',0,7,0,0),LEAF('leaves65','Green',0,8,0,2),P('roundplate1','Dark Green',0,9,0),LEAF('leaves65','Green',0,10,0,1),
    LEAF('leaves43','Lime',0,11,0,0),LEAF('leaves43','Green',0,12,0,2),P('sprig1','Bright Green',0,13,0),
    ...TIPS('leaves43',0,0,2).map(([x,z],k)=>P('sprig1',k%2?'Green':'Bright Green',x,13,z))]},
  'jacaranda':{name:'Jacaranda', parts:[P('roundbrick2','Dark Brown',0,0,0),P('roundbrick2','Dark Brown',0,3,0),P('roundplate2','Green',0,6,0),
    LEAF('leaves65','Green',0,7,0,0),LEAF('leaves65','Lavender',0,8,0,2),P('flower1','Medium Lavender',0,9,0),LEAF('leaves65','Lavender',0,10,0,1),
    LEAF('leaves43','Lavender',0,11,0,3),P('flower1','Medium Lavender',0,12,0),...TIPS('leaves43',0,0,3).map(([x,z],k)=>P('flower1',k%2?'Lavender':'Medium Lavender',x,12,z))]},
  'olive tree':{name:'Olive tree', parts:[P('roundplate2','Dark Tan',0,0,0),P('round1','Dark Brown',0,1,0),P('round1','Dark Brown',1,1,1),P('round1','Dark Brown',0,4,0),P('round1','Dark Brown',1,4,1),
    P('plate:2x2','Olive Green',0,7,0),LEAF('leaves43','Olive Green',0,8,0,3),LEAF('leaves43','Sand Green',1,8,1,1),
    LEAF('leaves43','Sand Green',0,9,0,0),LEAF('leaves43','Olive Green',1,9,1,2),P('sprig1','Olive Green',0,10,0),P('sprig1','Olive Green',1,10,1),
    ...TIPS('leaves43',0,0,0).map(([x,z],k)=>P('sprig1',k%2?'Olive Green':'Yellowish Green',x,10,z)),...TIPS('leaves43',1,1,2).map(([x,z],k)=>P('sprig1',k%2?'Yellowish Green':'Olive Green',x,10,z))]},
  'lemon tree':{name:'Lemon tree', parts:[P('roundplate2','Reddish Brown',0,0,0),P('round1','Reddish Brown',0,1,0),P('round1','Reddish Brown',1,1,1),P('round1','Reddish Brown',0,4,0),P('round1','Reddish Brown',1,4,1),
    P('plate:2x2','Green',0,7,0),LEAF('leaves43','Green',0,8,0,3),LEAF('leaves43','Olive Green',1,8,1,1),P('sprig1','Dark Green',0,9,0),P('flower1','White',1,9,1),
    ...TIPS('leaves43',0,0,3).map(([x,z],k)=>k%2?P('roundplate1','Bright Light Yellow',x,9,z):P('sprig1','Dark Green',x,9,z)),
    ...TIPS('leaves43',1,1,1).map(([x,z],k)=>k%2?P('sprig1','Green',x,9,z):P('roundplate1','Bright Light Yellow',x,9,z))]},
  // its color is in papery bracts: magenta flowers over the leaves
  'bougainvillea':{name:'Bougainvillea', parts:[P('roundbrick2','Green',0,0,0),P('roundbrick2','Green',0,3,0),LEAF('leaves43','Green',0,6,0,0),LEAF('leaves43','Magenta',1,6,1,2),
    ...TIPS('leaves43',0,0,0).map(([x,z],k)=>P('flower1',k%2?'Dark Pink':'Magenta',x,7,z)),...TIPS('leaves43',1,1,2).map(([x,z],k)=>P('flower1',k%2?'Magenta':'Dark Pink',x,7,z)),
    P('flower1','Magenta',0,7,0),P('flower1','Magenta',1,7,1)]},
  'palm':{name:'Palm tree', parts:[P('roundplate2','Dark Tan',0,0,0),P('round1','Medium Nougat',0,1,0),P('round1','Tan',0,4,0),P('round1','Medium Nougat',0,7,0),P('round1','Tan',0,10,0),P('round1','Medium Nougat',0,13,0),
    P('roundplate1','Dark Brown',0,16,0),P('palmtop','Tan',0,17,0),FROND('Green',0,17,0,'N',7),FROND('Bright Green',0,17,0,'S',7),FROND('Green',0,18,0,'E',7),FROND('Bright Green',0,18,0,'W',7)]},
  'cypress':{name:'Cypress', parts:[P('brick:2x2','Dark Green',0,0,0),P('brick:2x2','Dark Green',0,3,0),P('brick:2x2','Dark Green',0,6,0),P('brick:2x2','Dark Green',0,9,0),
    P('cone1','Dark Green',0,12,0),P('sprig1','Dark Green',1,12,0),P('sprig1','Green',0,12,1),P('sprig1','Dark Green',1,12,1),P('sprig1','Dark Green',0,15,0)]},
  // spiky plants: the plant bush's stiff blades
  'yucca':{name:'Yucca', parts:[P('roundplate2','Dark Tan',0,0,0),P('round1','Medium Nougat',0,1,0),P('round1','Tan',1,1,1),P('plate:2x2','Dark Tan',0,4,0),P('bush224','Green',0,5,0)]},
  'grasses':{name:'Grasses', parts:[P('plate:2x2','Olive Green',0,0,0),P('bush224','Green',0,1,0)]},
  'agave':{name:'Agave', parts:[P('roundplate2','Dark Tan',0,0,0),P('cheese','Sand Green',0,1,0,'W'),P('cheese','Sand Green',1,1,0,'N'),P('cheese','Sand Green',1,1,1,'E'),P('cheese','Sand Green',0,1,1,'S')]},
  'columnar cactus':{name:'Columnar cactus', parts:[P('plate:2x2','Dark Tan',0,0,0),P('round1','Green',0,1,0),P('round1','Green',0,4,0),P('round1','Green',0,7,0),P('flower1','White',0,10,0),
    P('round1','Green',1,1,1),P('round1','Green',1,4,1),P('roundplate1','Green',1,7,1)]},
  // shrubs and beds: leafy round plates and flower plates on a mound
  'shrub':{name:'Shrub', parts:[P('roundbrick2','Green',0,0,0),P('sprig1','Green',0,3,0),P('sprig1','Dark Green',1,3,0),P('sprig1','Dark Green',0,3,1),P('sprig1','Green',1,3,1),P('sprig1','Bright Green',0,4,0),P('sprig1','Green',1,4,1)]},
  'boxwood':{name:'Boxwood', parts:[P('roundplate2','Dark Green',0,0,0),P('sprig1','Dark Green',0,1,0),P('sprig1','Green',1,1,0),P('sprig1','Green',0,1,1),P('sprig1','Dark Green',1,1,1)]},
  'flowering shrub':{name:'Flowering shrub', parts:[P('roundbrick2','Green',0,0,0),P('sprig1','Green',0,3,0),P('flower1','bloom',1,3,0),P('flower1','bloom',0,3,1),P('sprig1','Dark Green',1,3,1),
    P('flower1','bloom',0,4,0),P('flower1','bloom',1,4,1)]},
  'lavender':{name:'Lavender', parts:[P('plate:2x1','Sand Green',0,0,0),P('sprig1','Olive Green',0,1,0),P('sprig1','Olive Green',1,1,0),P('flower1','Medium Lavender',0,2,0),P('flower1','Medium Lavender',1,2,0)]},
  'succulents':{name:'Succulents', parts:[P('plate:2x2','Dark Tan',0,0,0),P('sprig1','Olive Green',0,1,0),P('cheese','Olive Green',1,1,0,'E'),P('cheese','Sand Green',0,1,1,'S'),P('sprig1','Yellowish Green',1,1,1),P('flower1','Coral',0,2,0)]},
  'flower bed':{name:'Flower bed', parts:[P('plate:4x2','Dark Brown',0,0,0),...[0,1,2,3].flatMap(x=>[0,1].map(z=>(x+z)%2?P('sprig1','Green',x,1,z):P('flower1','bloom',x,1,z))),
    ...[0,2].map(x=>P('flower1','bloom',x+1,2,0)),...[0,2].map(x=>P('flower1','bloom',x,2,1))]},
};


// Lawn textures for the "lawn" op: patches (plates) around scattered seeds, then tufts and flowers.
const LAWN = {
  lawn:{seeds:0.05, patch:['Bright Green','Dark Green'], tufts:0.05, tuft:['Green','Bright Green','Dark Green'], flowers:0.012, bloom:['White','Yellow']},
  meadow:{seeds:0.05, patch:['Bright Green','Lime','Green'], tufts:0.09, tuft:['Green','Bright Green','Lime'], flowers:0.05, bloom:['White','Yellow','Medium Lavender','Coral']},
  dry:{seeds:0.07, patch:['Tan','Dark Tan','Olive Green'], tufts:0.05, tuft:['Olive Green','Yellowish Green'], flowers:0.01, bloom:['Yellow','White']},
};

// Roof and yard fixtures for the "fixture" op, placed like plants (on studs, from the corner stud).
const FIXTURES = {
  'skylight':{name:'Skylight', parts:[P('plate:2x2','White',0,0,0),P('tile:1x2','Trans-Clear',0,1,0),P('tile:1x2','Trans-Clear',1,1,0)]},
  'hvac unit':{name:'HVAC unit', parts:[P('plate:2x4','Dark Bluish Gray',0,0,0),P('brick:2x4','Light Bluish Gray',0,1,0),P('tile:2x2','Dark Bluish Gray',0,4,0),P('tile:2x2','Light Bluish Gray',0,4,2)]},
  'vent pipe':{name:'Vent pipe', parts:[P('plate:1x2','Dark Bluish Gray',0,0,0),P('round1','Light Bluish Gray',0,1,0),P('roundplate1','Dark Bluish Gray',0,4,0)]},
  'solar panel':{name:'Solar panel', parts:[P('plate:2x4','Light Bluish Gray',0,0,0),P('tile:2x4','Black',0,1,0)]},
  'roof hatch':{name:'Roof hatch', parts:[P('plate:2x2','Light Bluish Gray',0,0,0),P('tile:2x2','Dark Bluish Gray',0,1,0)]},
  'chimney':{name:'Chimney', parts:[P('brick:2x2','White',0,0,0),P('brick:2x2','White',0,3,0),P('plate:2x2','Dark Bluish Gray',0,6,0),P('roundplate1','Black',0,7,0)]},
};

const N4 = [[1,0],[-1,0],[0,1],[0,-1]];
const N8 = [...N4,[1,1],[1,-1],[-1,1],[-1,-1]];
const DOOR_KINDS = ['door','garage door'];
// what the model shows: a whole house, or one unit of a larger building cut from its neighbours
const PROPERTY_TYPES = ['house','townhouse','condo'];
const GRIP_MAX = 12;
// how far (studs) a floor slab may hang out past what's under it before it needs a post or corbel
const OVERHANG_MAX = 4;
// "variation": "subtle" gives every walls, fill and roof op without its own "mix" one close color on a
// few pieces, by material; "mix": [] on an op keeps it plain.
const SUBTLE_MIX = { 'Tan':[['Light Nougat',0.06]], 'Green':[['Dark Green',0.06]], 'Dark Green':[['Green',0.06]], 'Dark Tan':[['Tan',0.06]], 'Medium Nougat':[['Dark Tan',0.06]],
  'Dark Bluish Gray':[['Black',0.04]], 'Reddish Brown':[['Dark Brown',0.06]], 'Dark Orange':[['Reddish Brown',0.08]] }; // studs a lift-off roof may grip: enough to locate it, few enough to lift it off
const K3 = (x,z,p)=>x+','+z+','+p;

// Availability: how many LEGO sets have included a part in a color, and the last year one did
// (src/engine/parts-availability.js, built from Rebrickable's database by scripts/availability.js).
// A part in a color is easy to get when at least AVAIL_SETS sets have included it, the latest in
// AVAIL_YEAR or later; the packer only uses those, and the checker warns about any other.
const AVAIL=(typeof PART_AVAILABILITY!=='undefined')?PART_AVAILABILITY
  :(typeof require==='function'?(()=>{ try{ return require('./parts-availability.js').PART_AVAILABILITY; }catch(e){ return null; } })():null);
const AVAIL_SETS=6, AVAIL_YEAR=2018;
// Compatible-brick suppliers (src/engine/suppliers.js): a design with "supplier": "gobricks" is held to
// exactly the parts and colors that supplier makes, in place of LEGO availability (the baseplate may come
// from anywhere): the packer, mixes and texture use only those, and the checker warns about any other.
const SUPPLY=(typeof SUPPLIERS!=='undefined')?SUPPLIERS
  :(typeof require==='function'?(()=>{ try{ return require('./suppliers.js').SUPPLIERS; }catch(e){ return null; } })():null);
const supplies=(S,no,color)=>!!(S&&S.made&&S.made[no]&&S.made[no][color]!=null);
// a supplier's part number for a part in a color (GDS-536-031), or null where it doesn't make it
const supplierNo=(S,no,color)=>supplies(S,no,color)?S.parts[no]+'-'+S.colors[color]:null;
const availOf=(no,color)=>{ const t=AVAIL&&AVAIL.parts[no]; if(!t) return null; const a=t[color]; return {sets:a?a[0]:0,last:a?a[1]:0}; };
const easyToGet=(no,color)=>{ const a=availOf(no,color); return !a||(a.sets>=AVAIL_SETS&&a.last>=AVAIL_YEAR); };
// the colors a part is easy to get in, most common first
const easyColors=no=>{ const t=(AVAIL&&AVAIL.parts[no])||{}; return Object.keys(t).filter(c=>easyToGet(no,c)).sort((a,b)=>t[b][0]-t[a][0]); };

function resolvePart(key){
  if(SPECIAL[key]) return Object.assign({key, kind:key}, SPECIAL[key]);
  const m=/^(brick|plate|tile):(\d+)x(\d+)$/.exec(key||'');
  if(!m) throw new Error('Unknown part "'+key+'"');
  const kind=m[1], w=+m[2], d=+m[3], sz=Math.min(w,d)+'x'+Math.max(w,d), no=SIZE_PARTS[kind][sz];
  if(!no) throw new Error('There is no '+kind+' in size '+sz);
  return {key, kind, w, d, h:H[kind], no, name:KIND_NAME[kind]+' '+sz.replace('x',' x '), shape:'box', studs:kind!=='tile', cost:KIND_COST[kind]};
}
// A footprint cell [i, j] of a part turned rot quarter turns (rot 1: what pointed to -z points to +x).
function turnCell(def,[i,j],rot){ const w=def.w, d=def.d;
  switch(((rot%4)+4)%4){ case 1: return [d-1-j,i]; case 2: return [w-1-i,d-1-j]; case 3: return [j,w-1-i]; default: return [i,j]; } }
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
    const set=L=>L?new Set(L.map(c=>turnCell(def,c,rot).join())):null, tips=set(def.tips), socks=set(def.socks||(def.at&&[def.at]));
    for(let i=0;i<sw;i++) for(let j=0;j<sd;j++){ const cx=x+i, cz=z+j, k=i+','+j;
      for(let q=0;q<def.h;q++) occ.push([cx,cz,y+q]);
      if(def.clip) continue; // held by a clip on a bar, not by studs
      if(tips?tips.has(k):def.studs!==false&&(!socks||socks.has(k))) studs.push([cx,cz]);
      if(!socks||socks.has(k)) sockets.push([cx,cz]); }
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
  const errors=[], warnings=[], parts=[], occ=new Map(), subs=[], lawned=new Set();
  // the parts this design may use: what its supplier makes, or else LEGO parts that are easy to get
  const SUP=design.supplier!=null&&SUPPLY?SUPPLY[design.supplier]||null:null;
  const canBuy=SUP?(no,color)=>supplies(SUP,no,color):easyToGet;
  if(!BASEPLATES[BASE]) errors.push({msg:`plate must be 32 or 48 (got ${design.plate})`, op:null});
  if(design.property!=null&&!PROPERTY_TYPES.includes(design.property)) errors.push({msg:`property must be one of ${PROPERTY_TYPES.join(', ')} (got ${design.property})`, op:null});
  const phases=design.phases||[]; const phaseIdx=new Map(phases.map((p,i)=>[p,i]));
  // wall bricks by cell and height (not course number: each walls op counts its courses from its own base)
  const wallCourse=new Map(); const wallPairs=new Set(); const wallCourses=new Set();
  const abutEdges=[], doors=[], windows=[];

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
  // the sizes of a kind that are easy to get in a color (a 1 x 1 at worst, which the checker then flags)
  const sizeMemo=new Map();
  function easySizes(kind,color,sizes){ const k=kind+'|'+color+'|'+sizes.length; if(sizeMemo.has(k)) return sizeMemo.get(k);
    const ok=sizes.filter(([a,b])=>canBuy(SIZE_PARTS[kind][Math.min(a,b)+'x'+Math.max(a,b)],color)); const r=ok.length?ok:[[1,1]]; sizeMemo.set(k,r); return r; }
  const easyLen=(kind,len,color)=>canBuy(SIZE_PARTS[kind]['1x'+len],color);
  function pack(level,kind,y,meta,sizesFor){
    const h=H[kind], cells=[], lenOk=LEN_OK[kind];
    // a lift-off roof is built on its own, so its pieces needn't sit on studs below (it rests on tiles)
    const floating=!!(meta&&(meta.slab||(design.ops&&design.ops[meta.op]&&(design.ops[meta.op].liftoff||design.ops[meta.op].assembly))));
    for(const [k,color] of level){ const [x,z]=k.split(',').map(Number);
      let ok=x>=0&&z>=0&&x<BASE&&z<BASE; for(let q=0;q<h&&ok;q++) if(occ.has(K3(x,z,y+q))) ok=false;
      if(ok) cells.push({x,z,color,k}); }
    const avail=new Map(cells.map(c=>[c.k,c])), owner=new Map(), plan=[];
    // cells with nothing under them are packed first, so their pieces reach over to cells that rest on
    // something (for a floating pack, resting on a tile counts)
    const rests=(x,z)=>supportAt(x,z,y)!==undefined||(floating&&y>0&&occ.has(K3(x,z,y-1)));
    for(const c of cells){ c.sup=rests(c.x,c.z); let n=0; for(const [dx,dz] of N4) if(rests(c.x+dx,c.z+dz)) n++; c.nsup=n; }
    // a layer built on its own holds together through the layer above, which covers its inside cells
    // (every neighbour in the layer or enclosed by it, diagonals too: at an inside corner a hip roof's
    // next course puts a slope over a cell whose only outside neighbour is diagonal), not its outer
    // edge: each piece should reach an inside cell, so the cells farthest from one are packed first,
    // and pieces reaching one score higher
    const anchor=new Set();
    // (only for plates and tiles in a ring around a hole, like a hip roof's courses: a full layer ties
    // itself by running bond, and walls by their courses)
    const within=floating&&kind!=='brick'?enclosed(new Set(avail.keys())):null;
    if(within&&within.size>avail.size){
      for(const c of cells) if(N8.every(([dx,dz])=>within.has((c.x+dx)+','+(c.z+dz)))) anchor.add(c.k);
      const dist=new Map([...anchor].map(k=>[k,0])), q=[...anchor];
      for(let h=0;h<q.length;h++){ const [x,z]=q[h].split(',').map(Number); for(const [dx,dz] of N4){ const k=(x+dx)+','+(z+dz); if(avail.has(k)&&!dist.has(k)){ dist.set(k,dist.get(q[h])+1); q.push(k); } } }
      for(const c of cells) c.far=anchor.size?(dist.has(c.k)?dist.get(c.k):99):0; }
    for(const c of cells) if(c.far===undefined) c.far=0;
    const par=Math.floor(y/h)%2;
    // floating layers (lift-off roofs, assemblies) hold together only through the layer above, so lay
    // them in running bond: alternate rows start from opposite ends and their seams can't line up
    const bond=(a,b)=>par?(a.x-b.x||(a.x%2?b.z-a.z:a.z-b.z)):(a.z-b.z||(a.z%2?b.x-a.x:a.x-b.x));
    cells.sort((a,b)=>(a.sup-b.sup)||(floating?(b.far-a.far):0)||((!floating||!a.sup)?(a.nsup-b.nsup):0)||(floating?bond(a,b):(par?(a.x-b.x||a.z-b.z):(a.z-b.z||a.x-b.x))));
    // would placing P leave an unpacked edge cell next to it with no piece that reaches an inside cell?
    const inP=(P,x,z)=>x>=P.x0&&x<P.x0+P.w&&z>=P.z0&&z<P.z0+P.d;
    const tied=(u,color,sizes,P)=>{ for(const [a,bb] of sizes) for(const [w,d] of (a===bb?[[a,bb]]:[[a,bb],[bb,a]])) for(let ox=0;ox<w;ox++) for(let oz=0;oz<d;oz++){
        const x0=u.x-ox, z0=u.z-oz; let ok=true, ins=false;
        for(let i=0;i<w&&ok;i++) for(let j=0;j<d;j++){ const kk=(x0+i)+','+(z0+j), cc=avail.get(kk);
          if(!cc||owner.has(kk)||cc.color!==color||inP(P,x0+i,z0+j)){ ok=false; break; } if(anchor.has(kk)) ins=true; }
        if(ok&&ins) return true; } return false; };
    const strands=(P,color,sizes)=>{ for(let x=P.x0-1;x<=P.x0+P.w;x++) for(let z=P.z0-1;z<=P.z0+P.d;z++){ const k=x+','+z, u=avail.get(k);
        if(!u||inP(P,x,z)||owner.has(k)||anchor.has(k)||u.color!==color) continue; if(!tied(u,color,sizes,P)) return true; } return false; };
    const seamBelow=(x,z,nx,nz,dy)=>{ const b1=occ.get(K3(x,z,y-dy)), b2=occ.get(K3(nx,nz,y-dy)); return !!(b1&&b2&&b1!==b2); };
    for(const c of cells){
      if(owner.has(c.k)) continue;
      const sizes=easySizes(kind,c.color,(sizesFor&&sizesFor(c.color))||PACK_SIZES[kind]), small=!!(sizesFor&&sizesFor(c.color));
      let best=null; const cands=anchor.size?[]:null;
      for(const [a,bb] of sizes){
        const ors=a===bb?[[a,bb]]:[[a,bb],[bb,a]];
        for(const [w,d] of ors) for(let ox=0;ox<w;ox++) for(let oz=0;oz<d;oz++){
          const x0=c.x-ox, z0=c.z-oz; let ok=true, supN=0, restN=0; const bel=new Set(), own=new Set();
          for(let i=0;i<w&&ok;i++) for(let j=0;j<d;j++){
            const kk=(x0+i)+','+(z0+j), cc=avail.get(kk);
            if(!cc||owner.has(kk)||cc.color!==c.color){ ok=false; break; }
            own.add(kk); const s=supportAt(x0+i,z0+j,y); if(s!==undefined){ supN++; bel.add(s); }
            if(floating&&y>0&&occ.has(K3(x0+i,z0+j,y-1))) restN++; }
          if(!ok||(supN===0&&!floating)) continue;
          let aligned=0, stacked=0;
          if(y>0) for(let i=0;i<w;i++) for(let j=0;j<d;j++){ const x=x0+i, z=z0+j;
            for(const [dx,dz] of N4){ const nx=x+dx, nz=z+dz, nk=nx+','+nz; if(own.has(nk)||!avail.has(nk)) continue;
              if(seamBelow(x,z,nx,nz,1)){ aligned++; if(y-1-h>=0&&seamBelow(x,z,nx,nz,1+h)) stacked++; } } }
          const orient=((w>=d)===(par===0))?1:0;
          const jit=small?(((x0*92821)^(z0*68917)^(y*31337)^(w*7))>>>0)%7*0.9:0;
          // a floating piece (lift-off roof, assembly) should still rest on something where it can, even a
          // tile, so an eave or edge row reaches back over the wall instead of hanging on its own
          let inside=false; if(anchor.size) for(const k of own) if(anchor.has(k)){ inside=true; break; }
          const score=w*d*3+Math.min(bel.size,3)*5-aligned*(floating?60:7)-stacked*30+orient+jit+(floating&&restN>0?1000:0)+(inside?400:0);
          if(cands) cands.push({score,x0,z0,w,d});
          if(!best||score>best.score) best={score,x0,z0,w,d};
        }
      }
      // in a ring, don't take the cells an edge cell next to this piece needs to reach an inside cell
      if(cands&&cands.length>1){ cands.sort((p,q)=>q.score-p.score);
        best=cands.find(P=>!strands(P,c.color,sizes))||cands[0]; }
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
        if(lenOk.has(lenA+lenB)&&lenA+lenB<=8&&easyLen(kind,lenA+lenB,A.color)){
          const M={x0:Math.min(A.x0,B.x0),z0:Math.min(A.z0,B.z0),w:axisX?lenA+lenB:1,d:axisX?1:lenA+lenB,color:A.color};
          plan[ia]=M; plan[ib]=null;
          for(let i=0;i<M.w;i++) for(let j=0;j<M.d;j++) owner.set((M.x0+i)+','+(M.z0+j),ia);
          changed=true; continue; }
        // try shifting the seam by one stud either way
        for(const dir of [-1,1]){
          const nA=lenA+dir, nB=lenB-dir; if(nA<1||nB<1||!lenOk.has(nA)||!lenOk.has(nB)||!easyLen(kind,nA,A.color)||!easyLen(kind,nB,B.color)) continue;
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

  // Stud texture: paving and floors aren't all smooth tile. A share of the tiles become the plate of the
  // same size and color, bunched in patches like worn paving; same footprint and height, so nothing
  // else changes. "studs" on the op sets the share (0 for none); by default, with the subtle variation,
  // ground paving gets 15% and floors 8% (not lift-off roofs or assemblies, which stay smooth).
  function studTexture(ids,op,i,dflt){
    const f=op.studs!==undefined?Number(op.studs):(design.variation==='subtle'?dflt:0); if(!(f>0)) return;
    const h=(a,b,c)=>((((a*73856093)^(b*19349663)^(c*83492791)^(i*2654435761))>>>0)%10000)/10000;
    for(const id of ids){ const p=parts[id-1]; if(p.kind!=='tile') continue;
      const worn=h(Math.floor(p.x/4),Math.floor(p.z/4),1)<0.4; if(h(p.x,p.z,2)>=f*(worn?2.2:0.3)) continue;
      const key='plate:'+p.w+'x'+p.d; let def; try{ def=resolvePart(key); }catch(e){ continue; }
      if(!canBuy(def.no,p.color)) continue;
      const q=makePart(def,p.x,p.y,p.z,0,p.color,{op:p.op,phase:p.phase}); q.id=p.id; parts[id-1]=q; } }

  // A roof's slope on (x, z) at height y, unless it would stand in front of a window: within WINDOW_CLEAR
  // studs out from the glass, a slope rising past the sill becomes a flat tile, so every window gets the
  // same flat ledge in front and the eave stays below it (a tile at the sill hides only the frame's foot).
  const WINDOW_CLEAR=2;
  const inFront=(x,z,y0,y1)=>windows.some(w=>w.y0+1<y1&&y0<w.y1&&w.line.some(([wx,wz])=>w.along
    ?(wx===x&&Math.abs(wz-z)>=1&&Math.abs(wz-z)<=WINDOW_CLEAR):(wz===z&&Math.abs(wx-x)>=1&&Math.abs(wx-x)<=WINDOW_CLEAR)));
  function eaveSlope(x,y,z,color,meta){
    if(!inFront(x,z,y,y+SPECIAL.cheese.h)) return place('cheese',x,y,z,0,color,meta,false);
    if(!inFront(x,z,y,y+1)&&canBuy(SIZE_PARTS.tile['1x1'],color)) place('tile:1x1',x,y,z,0,color,meta,false);
    return null; }

  // "mix" on a fill or walls op: after packing, recolor a scattered few whole pieces of the op's main
  // color (a weathered roof, varied pavers or stucco). Whole pieces, so the structure doesn't change.
  // an op's own mix, or the design's default variation for its color (not for context stubs or seats)
  const mixWarned=new Set();
  const mixOf=op=>{ const i=design.ops.indexOf(op);
    if(Array.isArray(op.mix)&&!mixWarned.has(i)){ mixWarned.add(i); const total=op.mix.reduce((a,m)=>a+(Array.isArray(m)&&m[1]>0?m[1]:0),0);
      if(total>0.1+1e-9) warnings.push({msg:`"mix" on ${op.phase} recolors ${Math.round(total*100)} percent of its pieces, which reads as noise: leave it off (the design's subtle variation covers it) or use one close color at 4 to 8 percent`, op:i}); }
    return op.mix!==undefined?op.mix:(design.variation==='subtle'&&!op.context?SUBTLE_MIX[op.color]||null:null); };
  function mixColors(ids,op,main,i){
    const mix=mixOf(op); if(!mix||!mix.length) return;
    if(!Array.isArray(mix)||mix.some(m=>!Array.isArray(m)||!COLORS[m[0]]||!(m[1]>=0))){ errors.push({msg:'"mix" must be [[color, fraction], ...] with known colors', op:i}); return; }
    for(const id of ids){ const p=parts[id-1]; if(p.color!==main) continue;
      let u=((((p.x*73856093)^(p.z*19349663)^(p.y*83492791)^(i*2654435761))>>>0)%1000)/1000;
      for(const [mc,fr] of mix){ if(u<fr){ if(canBuy(p.no,mc)) p.color=mc; break; } u-=fr; } }
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
        const rmix=mixOf(op); if(rmix&&rmix.length){ const hsh=((x*73856093)^(z*19349663)^(top*83492791))>>>0; let u=(hsh%1000)/1000;
          for(const [mc,fr] of rmix){ if(u<fr){ if(canBuy(SPECIAL.cheese.no,mc)) cc=mc; break; } u-=fr; } }
        const qq=eaveSlope(x,top,z,cc,meta); if(qq) qq.dir=best[0]; } }
  }

  // Inside the buildings at ground level: studs enclosed by walls (ops at least a story, 4 courses,
  // tall) that stand on the ground, their column solid from the baseplate up to the wall (a foundation,
  // a fill or walls below). An upper story's walls over a room below have air under them and don't
  // count. Computed from what's placed so far: the floor op (listed last) and the final check call it.
  function insideCells(){ const barrier=new Set(), inside=new Set();
    (design.ops||[]).forEach(op=>{ if(op.op!=='walls'||op.context||!Array.isArray(op.segments)||!op.courses||op.courses[1]-op.courses[0]<3) return;
      const base=op.base!==undefined?op.base:op.courses[0]*3;
      try{ for(const sg of op.segments) for(const [x,z] of lineCells(sg)){ let solid=true; for(let y=0;y<base&&solid;y++) if(!occ.has(K3(x,z,y))) solid=false; if(solid) barrier.add(x+','+z); } }catch(e){} });
    if(!barrier.size) return inside;
    const seen=new Set(), q=[], inP=(x,z)=>x>=0&&z>=0&&x<BASE&&z<BASE;
    for(let t=0;t<BASE;t++) for(const [x,z] of [[t,0],[t,BASE-1],[0,t],[BASE-1,t]]){ const k=x+','+z; if(!barrier.has(k)&&!seen.has(k)){ seen.add(k); q.push([x,z]); } }
    while(q.length){ const [x,z]=q.pop(); for(const [dx,dz] of N4){ const nx=x+dx, nz=z+dz, k=nx+','+nz; if(inP(nx,nz)&&!barrier.has(k)&&!seen.has(k)){ seen.add(k); q.push([nx,nz]); } } }
    for(let x=0;x<BASE;x++) for(let z=0;z<BASE;z++){ const k=x+','+z; if(!barrier.has(k)&&!seen.has(k)) inside.add(k); }
    return inside; }

  // the cells a set of cells encloses, with the set itself (the floor inside a ring of walls)
  function enclosed(ring){ const inside=new Set(); if(!ring.size) return inside;
    const pts=[...ring].map(k=>k.split(',').map(Number)), xs=pts.map(c=>c[0]), zs=pts.map(c=>c[1]);
    const bx0=Math.min(...xs)-1, bx1=Math.max(...xs)+1, bz0=Math.min(...zs)-1, bz1=Math.max(...zs)+1;
    const out=new Set([bx0+','+bz0]), q=[[bx0,bz0]];
    while(q.length){ const [x,z]=q.pop(); for(const [dx,dz] of N4){ const nx=x+dx, nz=z+dz, k=nx+','+nz;
      if(nx<bx0||nx>bx1||nz<bz0||nz>bz1||out.has(k)||ring.has(k)) continue; out.add(k); q.push([nx,nz]); } }
    for(let x=bx0;x<=bx1;x++) for(let z=bz0;z<=bz1;z++) if(!out.has(x+','+z)) inside.add(x+','+z);
    return inside; }

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
        // windows (window parts or glass-colored fills), to keep roofs and walls from standing in front of them
        for(const o of opens) if(o.kind===undefined&&((o.fill.part||'').startsWith('win')||(o.fill.color||'').startsWith('Trans-')))
          windows.push({op:i, phase:op.phase, line:o.line, along:o.cells[1]===o.cells[3], y0:wbase+(o.courses[0]-op.courses[0])*3, y1:wbase+(o.courses[1]-op.courses[0]+1)*3});
        for(const o of opens) if(o.kind!==undefined){
          if(!DOOR_KINDS.includes(o.kind)) errors.push({msg:`Opening kind "${o.kind}" isn't one of ${DOOR_KINDS.join(', ')}`, op:i});
          else doors.push({op:i, kind:o.kind, line:o.line, along:o.cells[1]===o.cells[3], sill:wbase+(o.courses[0]-op.courses[0])*3, walls:cellSet}); }
        // "slab": the story stands on its own floor, two layers of plates under its walls and everything
        // they enclose (plus any extra "rects", a balcony), laid across each other's seams. It's built on
        // its own and set on the story below like an assembly (or with the op's lift-off), so where the
        // story juts out past the walls below, the slab carries it: overhangs need no brackets.
        if(op.slab){ const sl=op.slab===true?{}:op.slab, scol=sl.color||op.color;
          const area=enclosed(new Set(cellSet.keys()));
          for(const r of sl.rects||[]) for(const [x,z] of rectCells(r)) area.add(x+','+z);
          // the outline of the story below (its walls' tops and what they enclose), for the cover and the overhang
          const under=new Set(); if(wbase>=3) for(let x=0;x<BASE;x++) for(let z=0;z<BASE;z++) if(occ.has(K3(x,z,wbase-3))) under.add(x+','+z);
          const below=enclosed(under);
          // a story set back from the one below still needs something to rest on: by default the slab covers
          // the story below it too (each piece of that outline it overlaps), which then shows as a terrace
          // or carries a skirt roof. "cover": false keeps it to the story's own walls.
          if(sl.cover!==false){ const seen=new Set();
            for(const k of [...area]) if(below.has(k)&&!seen.has(k)){ const q=[k]; seen.add(k);
              while(q.length){ const c=q.pop(); area.add(c); const [x,z]=c.split(',').map(Number);
                for(const [dx,dz] of N4){ const n=(x+dx)+','+(z+dz); if(below.has(n)&&!seen.has(n)){ seen.add(n); q.push(n); } } } } }
          if(!COLORS[scol]) errors.push({msg:'Unknown color "'+scol+'"', op:i});
          else if(wbase<2) errors.push({msg:`A slab goes under the walls, so its walls need a base of at least 2 (got ${wbase})`, op:i});
          else {
            const clash=[...area].filter(k=>{ const [x,z]=k.split(',').map(Number); return occ.has(K3(x,z,wbase-2))||occ.has(K3(x,z,wbase-1)); });
            if(clash.length) errors.push({msg:`The slab under ${op.phase} (plates at y ${wbase-2} and ${wbase-1}) runs into what's already there at (${clash[0]})${clash.length>1?` and ${clash.length-1} more`:''}: end the story below at y ${wbase-2} (its top course, or seat tiles, under ${wbase-2})`, op:i});
            else {
              // with the op's own lift-off or assembly it goes with that; otherwise it's an assembly of its own
              const smeta={op:i, phase:op.phase, slab:op.liftoff||op.assembly?true:`${op.phase} floor`};
              const lv=new Map([...area].map(k=>[k,scol]));
              for(const y of [wbase-2,wbase-1]) pack(lv,'plate',y,smeta);
              // how far it hangs out: steps from each stud outside the outline of what's under it (a room
              // below counts as under it; the slab spans that) to the nearest stud inside it
              const hold=new Set([...area].filter(k=>below.has(k)));
              // a stretch of slab between two held studs (a post and a wall) spans; only what reaches past them hangs
              for(let grew=true;grew;){ grew=false;
                for(const [ax,az] of [[1,0],[0,1]]) for(const k of area){ const [x,z]=k.split(',').map(Number);
                  if(area.has((x-ax)+','+(z-az))) continue; // walk each run of slab along x, then z, from its start
                  const run=[]; for(let t=0;area.has((x+ax*t)+','+(z+az*t));t++) run.push((x+ax*t)+','+(z+az*t));
                  const h=run.map((c,j)=>hold.has(c)?j:-1).filter(j=>j>=0);
                  if(h.length>1) for(let j=h[0];j<=h[h.length-1];j++) if(!hold.has(run[j])){ hold.add(run[j]); grew=true; } } }
              const held=[...hold];
              const dist=new Map(held.map(k=>[k,0])), dq=[...held];
              for(let h=0;h<dq.length;h++){ const [x,z]=dq[h].split(',').map(Number);
                for(const [dx,dz] of N4){ const k=(x+dx)+','+(z+dz); if(area.has(k)&&!dist.has(k)){ dist.set(k,dist.get(dq[h])+1); dq.push(k); } } }
              let far=null; for(const [k,d] of dist) if(!far||d>far[1]) far=[k,d];
              if(far&&far[1]>OVERHANG_MAX) warnings.push({msg:`${op.phase} hangs ${far[1]} studs out past what's under it at (${far[0]}); a slab carries up to ${OVERHANG_MAX}: add a post or corbel under the far edge (a places op of bricks from the ground or a wall), or bring it back`, op:i});
            } } }
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
        // "seat": a lift-off roof rests on this wall: tile its top, leaving a 1 x 1 plate on the four
        // outermost corners as locating studs ("flat": tiles only, for inside walls under the same roof)
        if(op.seat){ const top=wbase+(op.courses[1]-op.courses[0]+1)*3;
          const cells=[...cellSet.values()].filter(([x,z])=>{ const id=occ.get(K3(x,z,top-1)); return id&&parts[id-1].wall&&parts[id-1].op===i; });
          const locate=new Set();
          if(op.seat!=='flat'&&cells.length){ const xs=cells.map(c=>c[0]), zs=cells.map(c=>c[1]);
            for(const [cx,cz] of [[Math.min(...xs),Math.min(...zs)],[Math.max(...xs),Math.min(...zs)],[Math.min(...xs),Math.max(...zs)],[Math.max(...xs),Math.max(...zs)]])
              locate.add(cells.reduce((a,b)=>Math.hypot(b[0]-cx,b[1]-cz)<Math.hypot(a[0]-cx,a[1]-cz)?b:a).join(',')); }
          for(const k of locate){ const [x,z]=k.split(',').map(Number); place('plate:1x1',x,top,z,0,op.color,meta,true); }
          const level=new Map(cells.filter(c=>!locate.has(c.join(','))).map(c=>[c.join(','),op.color]));
          pack(level,'tile',top,meta); }
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
            const rmix=mixOf(op); if(rmix&&rmix.length){ const hsh=((x*73856093)^(z*19349663)^(top*83492791))>>>0; let u=(hsh%1000)/1000;
              for(const [mc,fr] of rmix){ if(u<fr){ if(canBuy(SPECIAL.cheese.no,mc)) cc=mc; break; } u-=fr; } }
            const q=eaveSlope(x,top,z,cc,meta); if(q) q.dir=best[0]; } }
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
        const ids=pack(level,op.kind||'tile',op.y||0,meta); if((op.kind||'tile')==='tile') studTexture(ids,op,i,op.liftoff||op.assembly?0:0.15);
        mixColors(ids,op,op.color,i); break; }
      case 'floor': { // every stud inside the buildings (within rects, if given) at height y
        const lim=op.rects?new Set(op.rects.flatMap(r=>rectCells(r)).map(([x,z])=>x+','+z)):null, level=new Map();
        for(const k of insideCells()) if(!lim||lim.has(k)) level.set(k,op.color);
        if(!level.size) warnings.push({msg:'The floor op found no studs inside walls (it floors what walls at least 4 courses tall enclose)', op:i});
        const fids=pack(level,op.kind||'tile',op.y||0,meta); if((op.kind||'tile')==='tile') studTexture(fids,op,i,0.08); break; }
      case 'lawn': { // bare ground made into a finished lawn: patches of lighter and darker green, tufts, a few flowers
        const T=LAWN[op.texture||'lawn']; if(!T){ errors.push({msg:`Lawn texture must be one of ${Object.keys(LAWN).join(', ')}`, op:i}); break; }
        const inside=insideCells(), area=[];
        for(const [x,z] of op.rects?op.rects.flatMap(r=>rectCells(r)):rectCells([0,0,BASE-1,BASE-1])){ const k=x+','+z;
          if(x<0||z<0||x>=BASE||z>=BASE||occ.has(K3(x,z,0))||inside.has(k)) continue; area.push([x,z]); lawned.add(k); }
        if(!area.length){ warnings.push({msg:'The lawn op found no bare baseplate to cover (list it after the paving, planting and everything else on the ground)', op:i}); break; }
        const inArea=new Set(area.map(c=>c.join(','))), hash=(x,z,s)=>((((x*73856093)^(z*19349663)^(s*83492791)^(i*2654435761))>>>0)%10000)/10000;
        // patches grow around scattered seeds, a stud or two across
        const level=new Map();
        for(const [x,z] of area) if(hash(x,z,1)<T.seeds){ const r=hash(x,z,2)<0.5?1:2, col=T.patch[Math.floor(hash(x,z,3)*T.patch.length)];
          // an irregular blob: the seed and its neighbours, then a ragged edge further out
          for(let dx=-r-1;dx<=r+1;dx++) for(let dz=-r-1;dz<=r+1;dz++){ const k=(x+dx)+','+(z+dz), dd=Math.abs(dx)+Math.abs(dz);
            if(!inArea.has(k)||level.has(k)||dd>r+1) continue; if(dd<=1||hash(x+dx,z+dz,7)<(dd<=r?0.7:0.25)) level.set(k,col); } }
        pack(level,'plate',0,meta);
        // tufts and flowers, on a patch or on the baseplate
        for(const [x,z] of area){ const u=hash(x,z,4), y=occ.has(K3(x,z,0))?1:0;
          if(u<T.flowers) place('flower1',x,y,z,0,T.bloom[Math.floor(hash(x,z,5)*T.bloom.length)],meta,false);
          else if(u<T.flowers+T.tufts) place('sprig1',x,y,z,0,T.tuft[Math.floor(hash(x,z,6)*T.tuft.length)],meta,false); }
        break; }
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
          if(q){ if(pp.dir) q.dir=pp.dir; if(pp.on!==undefined){ const h=subs[si].partIds.map(id=>parts[id-1]).find(o=>o.copy===ci&&o.tpl===pp.on); if(h) q.mount=[h.id]; }
            subs[si].partIds.push(q.id); } }));
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
          const q=place(pp.part,c[0]+pp.at[0],c[1]+pp.at[1],c[2]+pp.at[2],pp.rot||0,pp.color==='bloom'?(op.bloom||'Bright Pink'):pp.color,Object.assign({},meta,{sub:si,copy:ci,tpl:pi}),true);
          if(q){ if(pp.dir) q.dir=pp.dir; if(pp.on!==undefined){ const h=subs[si].partIds.map(id=>parts[id-1]).find(o=>o.copy===ci&&o.tpl===pp.on); if(h) q.mount=[h.id]; }
            subs[si].partIds.push(q.id); } }));
        break; }
      default: errors.push({msg:`Unknown operation "${op.op}"`, op:i});
    }
    }catch(e){ errors.push({msg:e.message, op:i}); }
  });

  for(const p of parts){ const op=design.ops[p.op]; if(op&&op.context) p.context=true; }
  // Lift-off roofs: ops sharing a "liftoff" name are built on their own, like a sub-build, and set
  // on the house as one piece (the manual shows them that way). They rest on the walls, gripping only
  // a few locating studs, so their plates needn't sit on studs as the house goes up.
  // "assembly" is the same idea for a piece that stays put, like a floor slab over a wide room: built on
  // its own, set on the walls, and other things may stand on it.
  const liftGroups=new Map(), asmGroups=new Map();
  for(const p of parts){ const op=design.ops[p.op]; if(!op||p.sub!==undefined) continue;
    const [G,n]=op.liftoff?[liftGroups,String(op.liftoff)]:op.assembly?[asmGroups,String(op.assembly)]:typeof p.slab==='string'?[asmGroups,p.slab]:[null];
    if(G){ if(!G.has(n)) G.set(n,[]); G.get(n).push(p); } }
  for(const [G,kind] of [[liftGroups,'liftoff'],[asmGroups,'assembly']]) for(const [name,ps] of G){
    const last=ps.reduce((a,b)=>phaseIdx.get(b.phase)>phaseIdx.get(a.phase)?b:a), si=subs.length;
    ps.sort((a,b)=>a.y-b.y||a.id-b.id).forEach((p,k)=>{ p[kind]=name; p.sub=si; p.copy=0; p.tpl=k; });
    subs.push({name, phase:last.phase, copies:1, op:last.op, partIds:ps.map(p=>p.id), [kind]:true});
  }
  // plants and fixtures whose op names a lift-off roof stand on it and come off with it
  const riders=new Map();
  for(const p of parts){ const op=design.ops[p.op]; if(op&&op.liftoff&&p.liftoff===undefined){ p.liftoff=String(op.liftoff); if(!riders.has(p.liftoff)) riders.set(p.liftoff,[]); riders.get(p.liftoff).push(p.id); } }

  // ---------- manual steps ----------
  const STEP_MAX=8, SUB_MAX=4, steps=[];
  const main=phases.map(()=>[]);
  for(const p of parts) if(p.sub===undefined) main[phaseIdx.get(p.phase)].push(p);
  phases.forEach((ph,pi)=>{
    const list=main[pi].sort((a,b)=>a.y-b.y||a.id-b.id), local=[], seq=[]; let cur=null;
    // an assembly in the same phase as parts that stand on it (a story's own slab) is placed when the
    // build reaches its height; other sub-builds are placed at the end of the phase
    const asm=subs.map((s,si)=>({s,si})).filter(a=>a.s.phase===ph&&a.s.assembly)
      .map(a=>({si:a.si,y:Math.min(...a.s.partIds.map(id=>parts[id-1].y))})).sort((a,b)=>a.y-b.y);
    const early=new Set();
    for(const p of list){
      while(asm.length&&p.y>=asm[0].y){ const a=asm.shift(); early.add(a.si); seq.push({sub:a.si}); cur=null; }
      const n=cur?cur.parts.length:0;
      if(!cur||n>=STEP_MAX||(p.y!==cur.lastY&&n>=4)){ cur={kind:'main',phase:ph,parts:[],lastY:p.y}; local.push(cur); seq.push(cur); }
      cur.parts.push(p.id); cur.lastY=p.y;
    }
    local.forEach((s,k)=>{ s.title=ph; s.n=k+1; s.of=local.length; });
    const subSteps=si=>{ const s=subs[si];
      const tpl=s.partIds.map(id=>parts[id-1]).filter(p=>p.copy===0).sort((a,b)=>a.y-b.y||a.id-b.id), ss=[];
      for(let k=0;k<tpl.length;k+=SUB_MAX) ss.push({kind:'sub',phase:ph,sub:si,parts:tpl.slice(k,k+SUB_MAX).map(p=>p.id)});
      ss.forEach((st,k)=>{ st.title=s.name; st.n=k+1; st.of=ss.length; steps.push(st); });
      steps.push({kind:'attach',phase:ph,sub:si,parts:s.partIds.slice(),title:s.copies>1?`Place the ${s.name.toLowerCase()}s`:`Place the ${s.name.toLowerCase()}`,n:1,of:1});
    };
    for(const it of seq) if(it.sub!==undefined) subSteps(it.sub); else steps.push(it);
    subs.forEach((s,si)=>{ if(s.phase===ph&&!early.has(si)) subSteps(si); });
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
    if(s.liftoff||s.assembly) return; // checked as a whole below
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
  // a part that grips only at one stud by design (plant leaves) isn't flagged for it
  for(const p of parts){ const area=p.shape==='arch'?4:p.sockets.length; if(area>=2&&jn.get(p.id)<=1&&!flagged.has(p.id)) warnings.push({msg:`${p.name} #${p.id} at (${p.x}, ${p.y}, ${p.z}) is held by a single stud`, op:p.op, part:p.id}); }
  // roof edges left showing: an abutted side whose neighbour (a wall or another roof) stays lower
  if(abutEdges.length){
    // (a slope hides only its low edge's height, a plate above what it sits on, not its full 2 plates)
    const colTop=new Map(); for(const p of parts) for(let a=0;a<p.w;a++) for(let b=0;b<p.d;b++){ const k=(p.x+a)+','+(p.z+b); colTop.set(k,Math.max(colTop.get(k)||0,p.y+(p.key==='cheese'?1:p.h))); }
    for(const e of abutEdges){
      const mine=new Map(); for(const id of e.ids){ const p=parts[id-1]; for(let a=0;a<p.w;a++) for(let b=0;b<p.d;b++){ const k=(p.x+a)+','+(p.z+b); mine.set(k,Math.max(mine.get(k)||0,p.y+p.h)); } }
      const bad=e.cells.filter(([x,z,dx,dz])=>{ const t=mine.get(x+','+z)||0; return t>0&&(colTop.get((x+dx)+','+(z+dz))||0)<t-1; });
      if(bad.length) warnings.push({msg:`Roof ${e.side==='leaning'?'leans on another building':`abuts on its ${e.side} side`}, but the roof's stepped edge shows above what's beside it at ${bad.length} stud${bad.length===1?'':'s'}, from (${bad[0][0]}, ${bad[0][1]}). Give wings that meet one roof with "rects", or abut only against a wall that rises above the roof`, op:e.op});
    }
  }
  // windows: nothing solid (a roof, its slopes, a wall, paving) stands just outside one, across its height
  { const solid=new Set(['roof','walls','fill','band']), seen=new Set();
    for(const w of windows){ let hit=null;
      for(const [x,z] of w.line){ for(const s of [-1,1]){ const nx=w.along?x:x+s, nz=w.along?z+s:z;
          for(let y=w.y0;y<w.y1&&!hit;y++){ const id=occ.get(K3(nx,nz,y)); if(!id) continue; const q=parts[id-1];
            if(q.op===w.op||q.sub!==undefined&&!q.liftoff&&!q.assembly) continue; if(!solid.has((design.ops[q.op]||{}).op)) continue;
            if(q.y+q.h<=w.y0+1) continue; // reaching only a plate above the sill hides just the frame's foot
            hit=q; } }
        if(hit) break; }
      if(hit){ const k=w.op+'|'+w.line[0].join(); if(seen.has(k)) continue; seen.add(k);
        warnings.push({msg:`${hit.key==='cheese'?'A roof slope':hit.name} #${hit.id} at (${hit.x}, ${hit.y}, ${hit.z}) stands in front of the ${w.phase} window at (${w.line[0].join(', ')}), whose glass runs from height ${w.y0} to ${w.y1}: raise the window above the roof or ground beside it, or keep that below the sill`, op:w.op, part:hit.id}); } } }
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
    for(const d of doors){ if((design.ops[d.op]||{}).context) continue;
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
  // bare ground: a big open stretch of baseplate with nothing on it reads as unfinished
  // (not for a model of the building alone, without its lot: "lot": false)
  if(design.lot!==false){ const inside=insideCells(), bare=(x,z)=>!occ.has(K3(x,z,0))&&!inside.has(x+','+z)&&!lawned.has(x+','+z), side=Math.max(4,Math.round(12/((design.plate||32)>32?1.5:2)));
    const dp=new Map(); let best=0, at=null;
    for(let x=0;x<BASE;x++) for(let z=0;z<BASE;z++){ if(!bare(x,z)) continue;
      const v=1+Math.min(dp.get((x-1)+','+z)||0,dp.get(x+','+(z-1))||0,dp.get((x-1)+','+(z-1))||0); dp.set(x+','+z,v); if(v>best){ best=v; at=[x-v+1,z-v+1]; } }
    if(best>=side) warnings.push({msg:`The baseplate is bare in an open ${best} x ${best} stretch from (${at[0]}, ${at[1]}) to (${at[0]+best-1}, ${at[1]+best-1}), which looks unfinished: plant it, pave it, or add a lawn op (listed last, it covers whatever ground is left)`, op:null}); }
  // the baseplate must not show inside a building (through windows, or under a lift-off roof)
  { const bare=[...insideCells()].filter(k=>{ const [x,z]=k.split(',').map(Number); return !occ.has(K3(x,z,0)); });
    if(bare.length) warnings.push({msg:`The baseplate shows inside a building at ${bare.length} stud${bare.length===1?'':'s'}, from (${bare[0]}): cover the floors inside the walls with a floor op (tiles at y 0) so no green shows through windows or under a lift-off roof`, op:null}); }
  // lift-off roofs: ops sharing a "liftoff" name come off as one piece, so they must hold together
  // on their own and nothing else may rest on them
  { for(const [name,ps] of liftGroups){ const ids=new Set([...ps.map(p=>p.id),...(riders.get(name)||[])]);
      const gp=new Map([...ids].map(id=>[id,id])), gf=a=>{ while(gp.get(a)!==a){ gp.set(a,gp.get(gp.get(a))); a=gp.get(a);} return a; };
      let held=0; const onTop=new Set();
      for(const [a,b] of joints){ const ia=ids.has(a), ib=b!=='base'&&ids.has(b);
        if(ia&&ib){ const ra=gf(a), rb=gf(b); if(ra!==rb) gp.set(ra,rb); }
        else if(ia&&!ib) held++;
        else if(!ia&&ib&&!parts[a-1].liftoff) onTop.add(a); } // another lift-off (a floor or roof above) may rest on it
      const comps=new Set([...ids].map(gf)).size;
      if(comps>1) errors.push({msg:`Lift-off "${name}" comes apart into ${comps} pieces when lifted; tie it together (plates or tiles across its seams) so it lifts as one`, op:null});
      if(onTop.size){ const p=parts[[...onTop][0]-1]; errors.push({msg:`${p.name} #${p.id} at (${p.x}, ${p.y}, ${p.z}) sits on lift-off "${name}" but isn't part of it, so it can't lift off; add "liftoff": "${name}" to its op or move it`, op:p.op, part:p.id}); }
      if(held<2) errors.push({msg:`Lift-off "${name}" is held on by ${held} stud${held===1?'':'s'}; leave at least two locating studs (at the corners) in the tiles it rests on`, op:null});
      else if(held>GRIP_MAX) warnings.push({msg:`Lift-off "${name}" grips what's below with ${held} studs, too many to lift off by hand: tile the wall tops under it and leave only a few locating studs (2 to ${GRIP_MAX}, at the corners)`, op:null});
    }
    for(const [name,ps] of asmGroups){ const ids=new Set(ps.map(p=>p.id));
      const gp=new Map([...ids].map(id=>[id,id])), gf=a=>{ while(gp.get(a)!==a){ gp.set(a,gp.get(gp.get(a))); a=gp.get(a);} return a; };
      let held=0;
      for(const [a,b] of joints){ const ia=ids.has(a), ib=b!=='base'&&ids.has(b);
        if(ia&&ib){ const ra=gf(a), rb=gf(b); if(ra!==rb) gp.set(ra,rb); } else if(ia&&!ib) held++; }
      const comps=new Set([...ids].map(gf)).size;
      if(comps>1) errors.push({msg:`Assembly "${name}" comes apart into ${comps} pieces; lay a second layer across its seams so it holds together on its own`, op:null});
      if(held<2) errors.push({msg:`Assembly "${name}" is held on by ${held} stud${held===1?'':'s'}; it must press onto at least two studs of what it rests on`, op:null});
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
    const bare=k=>{ const p=topAt.get(k); return p&&p.kind==='tile'&&!p.context&&(p.sub===undefined||p.liftoff)?p:null; }, seen=new Set(), MIN=Math.round(BASE*BASE/16), SIDE=Math.ceil(BASE/5);
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
  // a compatible-brick supplier: every part must be one it makes in that color (the baseplate can be any)
  if(design.supplier!=null&&!SUP) errors.push({msg:`Unknown supplier "${design.supplier}"${SUPPLY?`; known: ${Object.keys(SUPPLY).join(', ')}`:''}`, op:null});
  if(SUP) for(const e of inventory){ if(e.kind==='baseplate'||supplies(SUP,e.no,e.color)) continue;
    const first=parts.find(p=>p.no===e.no&&p.color===e.color), fop=first?design.ops[first.op]||{}:{};
    // the colors it does make the part in, those this design already uses first
    const used=new Set(inventory.map(x=>x.color)), all=Object.keys((SUP.made&&SUP.made[e.no])||{}).sort((a,b)=>used.has(b)-used.has(a));
    // a plant's colors come from the library (all but a bloom color), so the fix there is another plant
    const plant=fop.op==='plant'?` (the ${fop.kind} plant uses it: pick another plant${fop.bloom!==undefined?' or bloom color':''})`:'';
    e.hard=true;
    warnings.push({msg:all.length?`${SUP.name} doesn't make ${e.name} in ${e.color} (${e.q}): use a color it makes (${all.slice(0,6).join(', ')}${all.length>6?`, or ${all.length-6} more`:''}) or another part${plant}`
      :`${e.name} (${e.no}) isn't made by ${SUP.name}: use another part${plant}`, op:first?first.op:null, part:first?first.id:undefined}); }
  // parts that are hard to get in their color: few sets have included them, or none lately (LEGO parts only)
  if(!SUP) for(const e of inventory){ if(easyToGet(e.no,e.color)) continue;
    const a=availOf(e.no,e.color), alt=easyColors(e.no).slice(0,6), first=parts.find(p=>p.no===e.no&&p.color===e.color);
    e.hard=true;
    warnings.push({msg:`${e.name} in ${e.color} (${e.q}) is hard to get: ${a.sets?`${a.sets} LEGO set${a.sets===1?' has':'s have'} included it, the latest in ${a.last}`:'LEGO has not made it in that color'}. Use a color it's easy to get in${alt.length?` (${alt.join(', ')})`:''} or another part`, op:first?first.op:null, part:first?first.id:undefined}); }
  const cost=inventory.reduce((s,e)=>s+e.q*e.cost,0);
  const pieces=parts.length+glassN+1;
  const pages=1+Math.ceil(inventory.length/24)+steps.length;
  const ms=clock.now()-t0;
  return {parts,steps,subs,errors,warnings,hints,joints,jn,inventory,occ,
    stats:{liftoff:(()=>{ const lo=new Map(); for(const p of parts) if(p.liftoff) lo.set(p.liftoff,Math.min(lo.has(p.liftoff)?lo.get(p.liftoff):1e9,p.y)); return [...lo].sort((a,b)=>b[1]-a[1]).map(e=>e[0]); })(),pieces,steps:steps.length,subBuilds:subs.length,pages,lots:inventory.length,cost,joints:joints.length,baseJoints,ms,plate:BASEPLATES[BASE]?BASE:32}};
}
if(typeof module!=='undefined') module.exports={BASEPLATES,SUPPLY,supplies,supplierNo,easyToGet,availOf,easyColors,AVAIL_SETS,AVAIL_YEAR,compile,COLORS,SPECIAL,SIZE_PARTS,PLANTS,FIXTURES};
