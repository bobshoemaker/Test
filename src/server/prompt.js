// The design language, written for Claude. This is the source of truth for what a
// design JSON may contain; src/engine/engine.js implements it. Keep them in sync.
const fs = require('node:fs');
const path = require('node:path');
const { scaleFor } = require('./scale');
const { COLORS } = require('../engine/engine.js');

const SPEC = `You design buildable brick models of real houses for a realtor's closing-gift kit. You study listing photos and write the house as a design in the JSON language below. A deterministic engine compiles it into real parts, checks every stud connection in build order, and writes the building manual.

WORLD
- One 32 x 32 stud baseplate (or 48 x 48 when the task says so: then set "plate": 48 and read every 31 below as 47). x runs 0..31 from left to right as seen from the street; z runs 0..31 from back to front; the street is along z=31.
- Heights are in plates: a brick is 3 plates tall, a plate or tile is 1. y=0 sits on the baseplate.
- Default scale is about 2 ft per stud, so a story is 4 brick courses (12 plates); on the 48 x 48 plate it is about 1.5 ft per stud and a story is 5 or 6 courses. Compress the yard so the house, driveway and some front and back yard fit.

OPS (run in list order; earlier ops claim space first, so list walls, then balcony and bay floors, then bands, then roofs, then landscaping, then sub-builds. Each op's "phase" must appear in "phases"; the manual builds phases in the order of that list, bottom to top)
- walls {"op":"walls","phase","color","courses":[c0,c1],"base":plate,"segments":[[x0,z0,x1,z1],...],"openings":[...],"trim":color?,"trimSides":bool?,"trimHeader":bool?,"trimSill":bool?,"block":name?,"mix":[[color,fraction],...]?,"seat":true|"flat"?,"slab":true|{"color","rects","cover"}?}
  Segments are straight, 1-stud-thick wall lines. Course c starts at plate base+(c-c0)*3.
  "block" ties the op to a block laid out from the floor plan; when the task gives locked walls, every op with that block keeps its segments exactly.
  Openings: {"cells":[x0,z0,x1,z1] (a run along one wall),"courses":[a,b],"fill":{...},"kind":"door"|"garage door"?}. Give every exterior door "kind": "door" (French and sliding doors too) and every garage door "kind": "garage door"; the compiler then checks the ground outside them (see the ground rules).
  fill {"part":"win22"} = window 2 wide, 2 courses; "win23" = 2 wide, 3 courses (tall windows, French doors); "win43" = 4 wide, 3 courses; "arch41" = arch 1x4, 1 course (put it on top of a 4-wide window for an arched window); "arch42" = arch 1x4, 2 courses. The opening must match the part exactly. Add "color" to set a window or arch color.
  fill {"color":C} fills the opening with bricks of another color (doors, garage doors). Use solid colors for these: transparent bricks render as a hole. {"color":C,"small":true} uses small bricks (stone, tile surrounds). fill {} leaves the opening empty (place something there yourself).
  "trim" colors the bricks around every window (sides, sill, header; turn parts off with trimSides/trimHeader/trimSill false).
- band {"op":"band","phase","rect":[x0,z0,x1,z1],"y":plate,"color","skip":[rects]?,"cap":"none"?} a plate course on a rectangular wall line plus a 1-stud projecting outer ring, capped with tiles (a belly band between floors). Upper walls then start at y+1. Skip the outer ring where something else needs it; skip all of it for a plain floor line.
- roof {"op":"roof","phase","rect":[x0,z0,x1,z1],"base":plate,"color","abut":[sides]?,"gable":[sides]?,"gableColor":C?,"fascia":C?,"mix":[[color,fraction],...]?} hip roof over a wall rectangle with 1-stud eaves, built from stepped plates covered with 1x1 slopes (about a 5:12 pitch). Sides are N (low z, back), S (high z, front), W (low x), E (high x). abut: sides that lean against a taller wall (no eave). gable: sides that end in a gable (no eave; the end row is gableColor, usually the wall color). fascia colors the eave plates (gutters). mix varies the slope colors for a tile-roof look.
  Roofs over joined wings: {"op":"roof","phase","rects":[[x0,z0,x1,z1],...],"against":[[x0,z0,x1,z1],...]?,"base":plate,"color","fascia"?,"mix"?} is ONE hip roof over the union of the rectangles (an L or T-shaped house), with valleys where wings meet. Use it whenever wings share a wall-top height; never build separate hips that butt into each other. "against" lists the rectangles of a taller building this roof leans on: the roof rises into that building's wall there and has an eave everywhere else (a lower wing or garage against a two-story house). The taller building's walls must rise above the roof where it leans.
  The compiler warns when a roof's abutted or leaning side leaves its stepped edge showing (another roof or a lower wall beside it). Fix it with one "rects" roof, "against", or a taller wall; never with a gap.
- fill {"op":"fill","phase","kind":"tile"|"plate"|"brick","color","rects":[[x0,z0,x1,z1],...],"y":plate?,"mix":[[color,fraction],...]?,"studs":fraction?} packs a region (street, sidewalk, driveway, walks, mulch beds, hedges, balcony or bay floors). It skips space already taken, so place studded pads, posts and bollards before paving. "mix" recolors a scattered few whole pieces in close colors (a weathered roof, varied pavers) to break up a big plain area, without changing the structure; Designs get "variation": "subtle", which already gives every walls, fill and roof op without its own mix one close color on a few pieces, chosen per material; so normally leave "mix" off. Write one only when the photos show a clear pattern the default lacks (two-tone brick, a visibly patched roof), and then keep it to one close color at 4 to 8 percent: the compiler warns above 10 percent in total, which reads as noise. Walls take "mix" too. Give an op "mix": [] to keep it plain.
- floor {"op":"floor","phase","color","kind":"tile"?,"y":plate?,"rects":[...]?,"studs":fraction?} tiles every stud inside the buildings (enclosed by walls at least 4 courses tall), at y 0 unless given, within rects if given. Every design needs one: the compiler warns when the baseplate shows inside a building. Put it last in the ops list with the ground floor's phase, so it only fills what nothing else claimed (porch pots, interior walls). Wood floors are Medium Nougat or Tan tiles. Paving and floors aren't all smooth: with the design's subtle variation, about 15% of a ground tile fill's tiles and 8% of a floor's become the same-size plate, in patches, so some studs show; "studs" sets the share on a fill or floor op (0 for none; a lift-off roof's tiles stay smooth unless set).
- Lift-off roof: give every op of a roof (the roof op, a flat roof's deck, parapet and cap, and anything else resting on them) the same "liftoff": "Main roof" (one name per roof). The roof is built on its own and set on the house, so it must hold together by itself, carry nothing that isn't part of it, and rest on the walls gripping only a few studs so it lifts off by hand. Seat it with "seat" on the walls ops under it: "seat": true tiles the wall top and leaves a 1 x 1 plate on its four outermost corners (the locating studs); "seat": "flat" tiles an inside wall's top with no studs. Then start the roof (its deck, or a roof op's base) one plate above the wall top, resting on the tiles. A lift-off hip roof over a wing only 4 studs across can't tie itself together; give that wing gable ends or a flat roof. The compiler checks all of it and warns when the roof grips too many studs. One layer of flat deck plates only holds together through the walls under it: lay a second layer (the roof tiles) over the whole deck so it crosses the seams. The viewer can lift it to show the floors and, when there is a floor plan, the rooms.
- Upper stories and overhangs: give the walls op of each upper story "slab": true. The compiler lays that story's floor itself: two layers of plates across each other's seams, under its walls and everything they enclose, in the two plates just below the walls' "base" (so the story below, seat tiles included, must end under base - 2). The slab is built on its own and set on the story below, so a story that juts out past the walls below (a bedroom over the drive, a bay) is carried by it: build the upper walls where the plan or photos put them and the slab takes care of the overhang, with no brackets or hand-laid slab. A story set back from the one below needs no extra work either: the slab also covers the whole story below it (where it overlaps it), which shows as a terrace or carries a skirt roof on the slab. "slab": {"color": ..., "rects": [...], "cover": false} sets its color (default the walls' color), adds rectangles beyond the walls (a balcony), or keeps it to the story's own walls (then it must rest on walls below). A slab hanging more than 4 studs past the outline below gets a warning: add a post or corbel under its far edge. For looks a jut may show corbels or brackets under it (places), but it doesn't need them.
- Lift-off floors: in a house of two or more stories, make each upper story lift off too, like a modular building: its walls op carries "slab": true and a "liftoff" name ("Second floor"), which the slab shares, seated on the story below (that story's walls get "seat": true, and the upper walls' base is 3 above the seat tiles' top, so the slab rests on the tiles). Its own walls get "seat" for the story or roof above. Each story then lifts off the one below; the viewer lifts the roof first, then each story from the top.
- place {"op":"place","phase","part","color","at":[x,y,z],"rot":0|1?,"dir":"N"|"S"|"E"|"W"?}; places {"op":"places","phase","part","color","y":plate,"at":[[x,z],...] or [[x,y,z],...],"dir"?}. dir sets which way a "cheese" slope faces down.
- fence {"op":"fence","phase","color","line":[x0,z0,x1,z1],"y":plate?} made of 1x4 fence pieces; the length must be a multiple of 4. Stack a second run at y=3 for a taller fence or gate.
- sub {"op":"sub","phase","name","copies":[[x,y,z],...],"parts":[{"part","color","at":[dx,dy,dz]},...]} a sub-build (tree, car) built on its own, then attached; parts are relative to each copy. Give each sub-build its own phase.
- plant {"op":"plant","phase","kind","at":[[x,y,z],...],"bloom":color?} places ready-made plants from the library, each checked to stand on its own and shown in the manual as a sub-build, built from real LEGO foliage (branching plant leaves with fruit or flowers on their tips, leafy and flower-edged round plates, spiky plant bushes, swordleaf palm fronds) in colors true to the plant. Trees spread well past their 2 x 2 base: "shade tree" (about 6 x 7) and "jacaranda" (7 x 7, purple in bloom) from 2 or 3 studs left and back of the base, "olive tree" and "lemon tree" (about 8 x 8 and 8 x 4, from 3 studs left), "bougainvillea" (4 x 8, magenta), "palm" (fronds 13 x 13 high up, centred on its base). Compact ones stay on their base: "cypress", "yucca", "grasses", "agave", "columnar cactus", "shrub", "boxwood" (a low clipped mound), "flowering shrub" (bloom color), "succulents" (2 x 2), "lavender" (2 x 1), "flower bed" (4 x 2, bloom color). "at" is the base's corner stud; leave a tree its spread clear of walls, fences, roofs and other plants at its height (the compiler reports collisions). Use the library for planting and a sub only for what it lacks; give plant ops their own phase. Planting is what ties the model together: be generous with it where the photos show it (a row of shrubs along a wall, a bed by the walk, trees at their real spots), and pick bloom colors from the photos (Red, Yellow, White, Coral, Magenta, Dark Pink, Orange, Medium Lavender).
- lawn {"op":"lawn","phase","texture":"lawn"|"meadow"|"dry"?,"rects":[...]?} finishes bare ground: patches of lighter and darker plates, grass tufts (leafy round plates) and a few small flowers scattered over the baseplate that nothing else covers ("meadow" is wilder with more flowers, "dry" is tan and olive for a dry yard). Without rects it covers all the bare ground outside the buildings, so list it last, after paving, planting and everything else on the ground; with rects, only there. The compiler warns when a big open stretch of bare baseplate is left (about 12 ft square); a model of the building alone, with no lot, sets "lot": false.
- fixture {"op":"fixture","phase","kind","at":[[x,y,z],...],"liftoff"?} places ready-made fixtures, each a small sub-build standing on studs from its corner stud: "skylight" (2 x 2), "hvac unit" (2 x 4), "vent pipe" (1 x 2 base), "solar panel" (2 x 4), "roof hatch" (2 x 2), "chimney" (2 x 2). On a flat roof, put them on the deck plates before the roof's tile fill (which then fills around them) and give the op the roof's "liftoff" so they come off with it. Add them where the photos or an overhead view show them, and say in "assumed" which are guesses.
- Wall details (sideways building): a walls opening with fill {"part":"snot","face":"N"|"S"|"E"|"W"} puts a brick with a stud on one side in every cell of the opening (one course), stud pointing the way "face" says (out of the wall). Then detail {"op":"detail","phase","kind","at":[[x,y,z],...],"color"?} hangs a detail on the side stud at [x,y,z] (the side-stud brick's position; y is its bottom plate): "lantern" (wall light: a black 1 x 1 bracket clipped to the side stud, a trans-yellow cone standing on it and a black round plate cap; it needs 5 plates of clear space above the side-stud brick's bottom, one stud out from the wall), "house number" (a 1 x 2 tile across two side-stud bricks side by side; at is the first), "plaque", "vent". Use them for the lights beside doors and the garage, the house number, and plaques the photos show.

PARTS
- "brick:WxD", "plate:WxD", "tile:WxD" with W along x and D along z. Bricks: 1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x3 2x4 2x6 2x8. Plates: the same plus 4x4 and 6x6. Tiles: 1x1 1x2 1x4 1x8 2x2 2x4 (no studs on top).
- "round1" (round brick 1x1), "roundplate1", "roundplate2" (2x2), "roundbrick2" (2x2 round brick), "win22", "win23", "win43", "arch41", "arch42", "fence4", "palmtop" (palm fronds), "cheese" (1x1 slope). rot 1 swaps W and D.
- Colors: ${Object.keys(COLORS).join(', ')}.

RULES
- Every part must sit on studs of something built earlier, or on the baseplate. Tiles, slopes and palm tops have no studs on top.
- Nothing may overlap, and everything stays inside 0..31.
- A part of 2 or more studs held by a single stud is a warning; sub-builds must attach with at least 2 studs.
- Brackets and corbels: put a 2-long brick in the top course so it sticks out one stud; a bay or balcony floor can then sit on it.
- Give each wing its own roof over its wall rectangle; upper walls sit on lower walls, a band or a floor line.
- Match the photos: number of stories, garage position and door, entry and porch, bays and balconies, roof shape and color, wall and trim colors, window count and placement on each visible side, driveway, walks, fences, trees and planting.
- Put what the photos show in "facts" (short strings) and what you had to guess in "assumed" (one or two sentences). Never present a guess as a fact.
- Parts must be easy to buy: the compiler knows, for every part and color, how many LEGO sets have included it and when (from Rebrickable), and warns about any part in a color that fewer than 6 sets have included or none since 2018 (old Light Gray, a window or arch LEGO never made in that color). It packs walls, fills and roofs only from sizes easy to get in their color by itself. When it warns, use one of the colors it names or another part; don't fight it.
- Windows stay clear: where a roof's eave meets a wall with a window above it, the compiler lays flat tiles instead of slopes for two studs in front of the glass, a flat ledge no higher than the sill, so the eave stays below the window. Anything else standing outside a window across its height (the roof's own courses rising past the sill, a wall, a raised bed) is a warning: set the window's courses above it, or keep it below the sill.
- Real detail beats filler: trim, stone, bands, brackets, planting, fences, trees. The piece target is a budget, not a quota: don't add hedge courses, oversized canopies or extra rows just to reach it.
- Garage doors: fill the opening with the door's own solid color from the photos (white, a wood tone, black or gray; a glass-paneled door takes its frame color), nearly as wide as the garage and about 7 ft tall (3 courses on the 32 plate, 4 on the 48), starting at the garage floor. Never a transparent color: it renders as a hole.
- Sloped lots: when the house sits above the street (steps up to the front door), build a solid foundation under the raised part first (a walls or fill op of bricks, as tall as the rise) and start those walls on top of it with "base". Keep the garage at street level when the photos show it there.
- Ground: the ground is what fills and walls build up from the baseplate. Every door must open onto ground at its own height, or one step (3 plates) below it with a landing or stairs; a door may not open into a terrace or a drop. A garage door opens at the level of its drive (within 1 plate), and the drive must reach a street or lane at the edge of the plate, stepping at most 1 plate from stud to stud, not crossing fences or walls. The compiler warns about each of these.
- Slopes and terraces: build rising ground as terraces stepping up a course at a time with planting or retaining walls on their faces, following the terrain note, not as one tall block. A building on raised ground starts on it: set its walls' "base" at the ground's height (with a foundation below where it shows). A garage at the low end stays at the level of its street or lane with its drive; the ground rises beside and behind it.
- Flat roofs: a parapet with no roof slope showing above it usually means a flat roof. Build it as a plate fill over the whole wall rectangle at the wall top (walls included; the deck), a walls op of 1 or 2 courses on the same segments with its base one plate above the deck (the parapet), a tile fill inside the parapet (the roof), and a tile cap on the parapet cells only (Dark Orange for clay coping). Don't use a roof op for it. A deck plate can't span a wide room on its own: where the compiler says a deck plate has nothing to hold on to, give it support from below with hidden interior walls from the plan or a post of 1 x 1 bricks rising from the floor, listed before the floor op, rather than reshuffling the deck.
- Attached homes and condos: when the home is one unit of a larger building (a townhouse in a row, a duplex half, a condo), set "property": "townhouse" or "condo" and "unit" (its number or letter), and model the unit itself in full detail, not the whole building. Where it joins the rest of the building, abstract it: a stub of each adjoining unit, 1 or 2 studs deep, as a solid block in one muted color (Light Bluish Gray), as tall as the neighbour, no windows or detail, capped with tiles, with "context": true on those ops; that's the clean cut face of an architectural model. An upper-floor condo stands on a muted "context" plinth as tall as the floors below it, the unit number on a plaque, and nothing above it: its ceiling is the lift-off roof. Shared grounds (a common driveway, an entry court) show only the unit's own frontage, cut the same way. A standalone house is "property": "house" (the default).
- Floor slabs over wide rooms: a floor plate can't hang over a room wider than one plate reaches (a garage under a bedroom, an overhanging upper floor). Under a story's walls use "slab": true. Any other slab (a deck, a floor with no walls on it) is an assembly: two layers of plates (the second across the first one's seams) with the same "assembly": "<name>" on both ops and their own phase, listed before the walls that stand on it. It's built on its own and set on the walls, so its plates needn't sit on studs as it goes up; the compiler checks that it holds together and presses onto at least two studs. Walls and floors may then stand on it.
- Stairs: build them from fill ops at rising y, each step at least 2 studs deep and resting on the step below; the top step meets the floor at the door.

OUTPUT: one JSON object with keys name, place, scale, facts, assumed, phases, ops (and plate, when it is 48; property and unit, for one unit of a larger building). No comments.`;

function example() {
  // A hand-built design made from three listing photos; compiles with 0 errors and 0 warnings.
  return fs.readFileSync(path.join(__dirname, '../../designs/634-unit-a.json'), 'utf8');
}

// Floor plans answer what photos can't: footprint, how the wings fit, which way doors face.
function planNote(hasPlan) {
  return hasPlan ? `
FLOOR PLAN. The last image is the listing's floor plan, not a photo. Take the footprint, how the wings and rooms fit together, which way each wall and door faces, and where the entries, stairs, garages and patio are from the plan; take heights, materials, colors, windows and roofs from the photos. Room sizes are in feet: at 2 ft per stud a 14 x 20 ft room is 7 x 10 studs. Match each photo to the side of the plan it shows, and work out which plan edge faces the street before placing anything.
` : '';
}

// What the owner picked where the photos left things open (from the survey); binding for the design.
function choicesNote(choices) {
  if (!choices || !choices.length) return '';
  return `
CHOICES FROM THE OWNER. These settle what the photos leave open. Follow them over your own reading of the photos:
${choices.map((c) => `- ${c.question} ${c.answer}${c.detail ? `: ${c.detail}` : ''}`).join('\n')}
`;
}

function designTask({ photoCount, notes, target, hasPlan = false, choices = null, plate = 32 }) {
  return `TASK
Design the house in the ${photoCount} attached photo${photoCount === 1 ? '' : 's'}${notes ? ` using these notes from the agent: "${notes}"` : ''}. Aim for about ${target} pieces (parts plus window glass plus the baseplate), within 10 percent.${plateNote(plate)}${planNote(hasPlan)}${choicesNote(choices)}
Call compile_design on your draft, fix every error and warning it reports, and compile again until it reports 0 errors and 0 warnings near the target (at most 4 compiles). Then reply with only the final design JSON.

EXAMPLE of a valid design (a two-story house built from three listing photos, 778 pieces, 0 errors):
${JSON.stringify(JSON.parse(example()))}`;
}

function fixTask({ design, problems }) {
  return `TASK
This design compiled with the problems below. Fix them with the smallest changes that keep the house the same and the piece count about the same. Use compile_design to confirm 0 errors and 0 warnings, then reply with only the fixed design JSON.

PROBLEMS
${problems.join('\n')}

DESIGN
${JSON.stringify(design)}`;
}

// Parts mode: the house is built over several short turns, each compiled right away, so a
// preview exists after every part and no single turn has to plan the whole model.
const PARTS = [
  { name: 'Walls', locked: 'PART 1 OF 5, WALLS. Set name, place, scale, facts, assumed and the full phases list for all four parts, including each locked op\'s phase. Start from the locked walls ops: set each block\'s heights (courses and base, a foundation where the house sits above the street), colors, trim, and each locked opening\'s courses and fill to match the photos, then add the windows and other openings the photos show, with "kind" on every door and garage door. Set each building\'s base at the ground it stands on (a garage at the level of its street or lane, a house on raised ground on top of it). Give every upper story\'s walls "slab": true (see Upper stories and overhangs) so it stands on its own floor, overhangs included. A locked block with a "floor" above 1 is an upper story read from the plan: keep its segments, and build it as a lift-off floor with its slab at that story\'s height. Nothing else yet.', task: 'PART 1 OF 5, WALLS. Set name, place, scale, facts, assumed and the full phases list for all four parts. Then write the walls of every building (house, garage, any outbuilding) with every door, window and garage-door opening ("kind" on every door and garage door), on a foundation where the house sits above the street. Give every upper story\'s walls "slab": true (see Upper stories and overhangs) so it stands on its own floor, overhangs included. Nothing else yet.' },
  { name: 'Roofs', task: 'PART 2 OF 5, ROOFS AND TRIM. Add roofs, parapets and their caps, bands, awnings and bay roofs. Make each building\'s roof a lift-off roof ("liftoff" on all its ops), seated on its walls with "seat" and starting one plate above the wall top; in a house of two or more stories, make each upper story lift off as well (see Lift-off floors). Leave the walls alone unless the compiler flags them.' },
  { name: 'Site', task: 'PART 3 OF 5, THE LOT. Add the streets and any lane, sidewalks, a drive from every garage door to its street or lane, entry stairs and railings, walks, the lot\'s rise as stepped terraces (following the terrain note) with planters and retaining walls, patio paving, fences and gates. Look at the back and side renders too: every door must meet the ground. End the ops list with a floor op so no baseplate shows inside. Follow the landscaping style in the owner\'s choices, if there is one, for beds, lawn, gravel and paving.' },
  { name: 'Planting', task: 'PART 4 OF 5, PLANTING. Add the trees, shrubs, cacti and flowers the photos show with plant ops from the library (sub-builds only for what it lacks), in the landscaping style from the owner\'s choices if there is one, then finish the ground that is still bare with a lawn op in its own phase, last (the texture that matches the yard in the photos).' },
  { name: 'Details', task: 'PART 5 OF 5, DETAILS AND FINISH. Compare the renders with each photo and add what the model still lacks: window sills and trim, awning brackets, railings along stairs, lights on posts, the mailbox, pots and planters, patio furniture, gates, low walls. Spend what is left of the piece budget on things the photos show, never on filler. Check that every roof is a lift-off roof and every building has a floor. Compile results may carry "hints" about big bare areas: fill them with what the photos show (fixtures, furniture, a color mix), or leave them if the photos show them plain; hints never block. Then fix every remaining error and warning. When it compiles with 0 errors and 0 warnings, reply with one sentence; the last compiled design is kept.' },
];

// The larger plate: said once in the task, since SPEC is written for 32 x 32.
function plateNote(plate) {
  const sc = scaleFor(plate);
  if (sc.plate === 32) return '';
  return `
PLATE AND SCALE. This model is on the ${sc.plate} x ${sc.plate} baseplate: set "plate": ${sc.plate} in the design. x and z run 0..${sc.last} and the street is along z = ${sc.last}. The scale is about ${sc.ftPerStud} ft per stud, so a story is about ${sc.storyCourses} courses. Use the extra room for what the photos show: yards and planting, both streets of a corner lot, trim, railings and details.
`;
}

// The walls laid out from the floor plan, which the design has to keep (checked on every compile).
function lockedNote(locked, ops) {
  if (!locked) return '';
  return `
LOCKED WALLS FROM THE ${locked.source === 'outline' ? "HOUSE'S BUILDING OUTLINE (county or OpenStreetMap building footprint; it has no doors or windows, so place those from the photos)" : 'FLOOR PLAN'}. These walls ops were laid out from the ${locked.source === 'outline' ? 'outline' : 'floor plan'} at ${locked.scale.ftPerStud} ft per stud, with the street along z=${(locked.size || 32) - 1}. Start the design from them. Keep every op's "block" and "segments", and each listed opening's "cells", exactly as given: every compile checks them and reports changes as errors. Everything else is yours to set from the photos: courses and base (heights, raised floors, foundations), colors, trim, each opening's courses and fill, windows and other openings, and more walls ops for the same block (a foundation course or a parapet) with the same block and segments.
${JSON.stringify(ops)}
Block rectangles for roofs ("rects"; blocks with the same wall-top height share one roof): ${JSON.stringify(locked.blocks.filter((b) => b.cells.length).map((b) => ({ block: b.name, rects: b.cellRects })))}
${locked.sideStreet ? `Corner lot: a second street runs along x = ${locked.sideStreet.side === 'left' ? 0 : (locked.size || 32) - 1} (columns ${locked.sideStreet.columns.join(' to ')} are kept free for its street and sidewalk; build them in part 3).` : ''}
${locked.stairs.length ? `Stairs on the plan (stud rectangles [x0,z0,x1,z1]; build them in part 3): ${JSON.stringify(locked.stairs)}` : ''}
`;
}

// Resuming: the design from the parts already done, to continue from.
function seedNote(seed, fromPart) {
  return `
THE DESIGN SO FAR. Parts 1 to ${fromPart - 1} are done and this design compiles. Keep what's there unless the photos or the compiler call for a change, and add the next part to it.
${JSON.stringify(seed)}
`;
}

function partsTask({ photoCount, notes, target, hasPlan = false, locked = null, lockedOps = null, seed = null, fromPart = 1, choices = null, plate = 32 }) {
  return `TASK
Design the house in the ${photoCount} attached photo${photoCount === 1 ? '' : 's'}${notes ? ` using these notes from the agent: "${notes}"` : ''}. The finished design should have about ${target} pieces (parts plus window glass plus the baseplate) and no more than 10 percent over. Fewer is fine when the house is simple.${plateNote(plate)}${planNote(hasPlan)}${choicesNote(choices)}

WORK IN PARTS. You build the design in ${PARTS.length} parts, one part per turn; each turn tells you which part to do. In every part:
- Add that part's ops to the design so far and call compile_design on the complete design right away. The compiler is fast and exact. Send a rough draft early and let it find collisions and support problems; don't work out coordinates in your head.
- Each compile also returns renders of your model from the front and at three-quarters. Compare them with the photos: number of levels and relative heights, which walls face the street, garage door size, door and window sizes and positions, the entry and its stairs. Fix what looks different, not only what the compiler reports.
- Use at most 3 compiles per part. Problems caused by ops that belong to a later part can wait.
- Then reply with one or two short sentences: what you built and what still differs from the photos. Don't repeat the design JSON; the last compiled design is kept.

EXAMPLE of a valid finished design (a two-story house built from three listing photos, 778 pieces, 0 errors):
${JSON.stringify(JSON.parse(example()))}

${lockedNote(locked, lockedOps)}${seed ? seedNote(seed, fromPart) : ''}
${seed ? PARTS[fromPart - 1].task : locked ? PARTS[0].locked : PARTS[0].task}`;
}

// The plan-reading step: Claude reads the footprint off a gridded plan; code lays it out in studs.
const FOOTPRINT_SPEC = `You read a house's listing floor plan and photos and report its footprint for a brick model. Code turns your report into walls on the baseplate at the model's scale (2 ft per stud on 32 x 32, 1.5 on 48 x 48), so you only read the plan; you don't place bricks.

Work in the plan's own pixel coordinates: x to the right, y down. The gridded copy of the plan is drawn twice as large, with a thin line every 10 plan pixels and labels every 50 (red across the top, blue down the side). Read positions from the labels, which are original plan pixels, not from the enlarged copy's own pixels.

Report with submit_footprint:
- street: the plan side that faces the street (N top, S bottom, E right, W left). The street-level garage door opens toward the street, a lower level sits on the street side of a sloping lot, and exterior stairs run down toward it. A garage door is on the garage's short side (a one-car garage is about 10 ft wide and 17 to 20 ft deep). If the agent's notes name the street side, use it.
- sideStreet (corner lots only): the plan side that faces a second street, if the lot has one. The agent's notes or terrain say whether it's a corner lot.
- rooms: three or more rooms with size labels (like "14 X 20"), each with rectPx along its wall lines. They set the scale, so pick rooms whose four walls are clear. If the plan has no size labels, give rooms with the labels they have (no sizes) and instead give lengths.
- lengths (only when no room has a size label): two or three things of standard size drawn on the plan, each as a line along it [x0, y0, x1, y1] with its usual length in feet: a two-car garage door opening (about 16 ft), a one-car garage door (about 9 ft), a garage's depth (about 20 ft), an exterior door (about 3 ft). The scale then counts as an estimate.
- Several floors side by side (1st floor, 2nd floor...): read every floor. Each block gets "floor" (1 = the ground floor) and "levels": 1; a floor whose outline differs from the one below (a set-back or jutting bedroom, an overhang) is its own block with its own rectangles. Give anchors: the same point that stacks straight up, marked on every floor's drawing ({"floor": n, "atPx": [x, y]}), such as the corner of the main stair where it starts or an outside corner that runs up the full height, so the floors line up. Openings go on the ground floor's blocks only. The overlay draws every floor over the ground floor's drawing.
- blocks: the exterior of every building, split into parts that differ in height (a two-level wing, the one-level main house, a detached garage). Each is one or more rectangles along the exterior wall center lines; rectangles of one block may touch or overlap. levels is the number of stories seen from outside (2 for a garage with rooms above it). List the tallest blocks first. A lower level drawn separately on the plan (like a garage under a bedroom wing) is not its own block when it sits under a main-level block; give that block 2 levels and put the lower level's doors on it.
- openings: every exterior door, garage door, and sliding or French door, as the point on the wall line at its center (atPx), its block, kind and width in feet. Windows come later from the photos.
- stairs: exterior stairs and steps as rectangles.
Rectangles are [x0, y0, x1, y1] with x0 < x1 and y0 < y1.

Each submission comes back with the layout in studs and an overlay of those walls on the plan, drawn as it will sit on the baseplate. Check the overlay: every wall on a plan wall line, doors on the plan's door swings, stairs where the plan draws them, and the street along the bottom. Fix what's off and submit again (at most 4 submissions). When it matches, reply with one sentence.`;

const FOOTPRINT_TOOL = (() => {
  const rect = { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 };
  return {
    name: 'submit_footprint',
    description: 'Lays out the footprint read from the floor plan in studs at the model scale and returns the layout, any problems, and an overlay of the walls on the plan. Coordinates are original plan pixels.',
    input_schema: {
      type: 'object',
      properties: {
        street: { type: 'string', enum: ['N', 'S', 'E', 'W'] },
        sideStreet: { type: 'string', enum: ['N', 'S', 'E', 'W'], description: 'Corner lots only: the plan side facing the second street.' },
        rooms: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, label: { type: 'string' }, rectPx: rect }, required: ['name', 'rectPx'] } },
        lengths: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, linePx: rect, ft: { type: 'number' } }, required: ['what', 'linePx', 'ft'] } },
        blocks: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, floor: { type: 'integer' }, levels: { type: 'integer' }, rectsPx: { type: 'array', items: rect }, note: { type: 'string' } }, required: ['name', 'levels', 'rectsPx'] } },
        openings: { type: 'array', items: { type: 'object', properties: { block: { type: 'string' }, kind: { type: 'string', enum: ['door', 'double door', 'sliding door', 'garage door'] }, atPx: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, widthFt: { type: 'number' }, note: { type: 'string' } }, required: ['block', 'kind', 'atPx', 'widthFt'] } },
        anchors: { type: 'array', items: { type: 'object', properties: { floor: { type: 'integer' }, atPx: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } }, required: ['floor', 'atPx'] } },
        stairs: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, rectPx: rect }, required: ['rectPx'] } },
        notes: { type: 'string' },
      },
      required: ['street', 'rooms', 'blocks', 'openings'],
    },
  };
})();

function footprintTask({ photoCount, notes, gridded }) {
  return `TASK
The first ${photoCount} image${photoCount === 1 ? ' is a photo' : 's are photos'} of the house; then comes the floor plan${gridded ? ', then the same plan with a pixel grid' : ''}.${notes ? ` Notes from the agent: "${notes}"` : ''}
Read the footprint and submit it with submit_footprint.`;
}

// The survey: a cheap first look that lists what the photos show and asks the owner about what
// they leave open, before any design work. Landscaping is always asked (see LANDSCAPE_STYLES).
const LANDSCAPE_STYLES = [
  { id: 'photos', label: 'Match the photos', detail: '' },
  { id: 'drought', label: 'Drought-tolerant', detail: 'Agaves, yucca, cacti and grasses in gravel and mulch beds, no lawn.' },
  { id: 'lush', label: 'Lush garden', detail: 'Lawn, clipped hedges, flowering shrubs and a shade tree.' },
  { id: 'mediterranean', label: 'Mediterranean', detail: 'Olive trees, lavender and rosemary, terracotta pots, paved paths.' },
  { id: 'minimal', label: 'Minimal', detail: 'Lawn with one or two trees and clean edges; the fewest pieces.' },
];

const SURVEY_SPEC = `You take a first look at a house's listing photos (and floor plan, if there is one) before anyone builds a brick model of it. You don't design anything. You say what the photos show, and you ask the owner about what they leave open.

If the photos, notes or address suggest the home is one unit of a larger building (a unit number, a row of matching units, shared walls), always ask which it is: a standalone house, an end unit, a middle unit, or a condo on an upper floor (and which floor), recommending what the photos show; the model then shows that unit, cut cleanly from its neighbours. Ask only when the answer changes what gets built and the photos don't settle it. Typical cases: a roof hidden behind a parapet or seen only edge-on (flat, or low-sloped tile?), a side or the back never shown, a garage door style or color seen only at night, what sits behind a fence. Don't ask about anything the photos show clearly, and don't ask about taste; landscaping style is asked separately. Ask at most 5 questions, each with 2 to 4 options that the design language below can build. A roof edge that is only a cap along the wall top, with no slope visible above it from any photo, points to a flat roof behind a parapet: a pitched roof would show above the wall from the street. Mark the option the photos point to as recommended and say in "why" what you see and what's unclear. Keep option labels to a few words and details to one sentence. Say in landscapeSeen what planting the photos show, in a few words.

Submit with submit_survey.

DESIGN LANGUAGE (what the model can be built from):
${SPEC}`;

const SURVEY_TOOL = {
  name: 'submit_survey',
  description: 'Reports what the photos show and the questions for the owner about what they leave open.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One or two sentences on the house.' },
      seen: { type: 'array', items: { type: 'string' }, description: 'Short facts the photos show clearly.' },
      landscapeSeen: { type: 'string', description: 'The planting the photos show, in a few words.' },
      questions: {
        type: 'array', maxItems: 5,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            topic: { type: 'string', enum: ['roof', 'walls', 'windows', 'doors', 'garage', 'entry', 'site', 'other'] },
            question: { type: 'string' },
            why: { type: 'string' },
            options: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, detail: { type: 'string' } }, required: ['id', 'label'] } },
            recommended: { type: 'string' },
          },
          required: ['id', 'topic', 'question', 'options', 'recommended'],
        },
      },
    },
    required: ['summary', 'seen', 'questions'],
  },
};

function surveyTask({ photoCount, notes, hasPlan }) {
  return `TASK
The first ${photoCount} image${photoCount === 1 ? ' is a photo' : 's are photos'} of the house${hasPlan ? '; the last image is its floor plan' : ''}.${notes ? ` Notes from the agent: "${notes}"` : ''}
Look them over and submit the survey with submit_survey.`;
}

module.exports = { SPEC, designTask, fixTask, partsTask, PARTS, FOOTPRINT_SPEC, FOOTPRINT_TOOL, footprintTask,
  SURVEY_SPEC, SURVEY_TOOL, surveyTask, LANDSCAPE_STYLES, choicesNote, example };
