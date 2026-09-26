// The design language, written for Claude. This is the source of truth for what a
// design JSON may contain; src/engine/engine.js implements it. Keep them in sync.
const fs = require('node:fs');
const path = require('node:path');
const { COLORS } = require('../engine/engine.js');

const SPEC = `You design buildable brick models of real houses for a realtor's closing-gift kit. You study listing photos and write the house as a design in the JSON language below. A deterministic engine compiles it into real parts, checks every stud connection in build order, and writes the building manual.

WORLD
- One 32 x 32 stud baseplate. x runs 0..31 from left to right as seen from the street; z runs 0..31 from back to front; the street is along z=31.
- Heights are in plates: a brick is 3 plates tall, a plate or tile is 1. y=0 sits on the baseplate.
- Default scale is about 2 ft per stud, so a story is 4 brick courses (12 plates). Compress the yard so the house, driveway and some front and back yard fit.

OPS (run in list order; earlier ops claim space first, so list walls, then balcony and bay floors, then bands, then roofs, then landscaping, then sub-builds. Each op's "phase" must appear in "phases"; the manual builds phases in the order of that list, bottom to top)
- walls {"op":"walls","phase","color","courses":[c0,c1],"base":plate,"segments":[[x0,z0,x1,z1],...],"openings":[...],"trim":color?,"trimSides":bool?,"trimHeader":bool?,"trimSill":bool?}
  Segments are straight, 1-stud-thick wall lines. Course c starts at plate base+(c-c0)*3.
  Openings: {"cells":[x0,z0,x1,z1] (a run along one wall),"courses":[a,b],"fill":{...}}.
  fill {"part":"win22"} = window 2 wide, 2 courses; "win23" = 2 wide, 3 courses (tall windows, French doors); "win43" = 4 wide, 3 courses; "arch41" = arch 1x4, 1 course (put it on top of a 4-wide window for an arched window); "arch42" = arch 1x4, 2 courses. The opening must match the part exactly. Add "color" to set a window or arch color.
  fill {"color":C} fills the opening with bricks of another color (doors, garage doors, dark glass with "Trans-Black"). {"color":C,"small":true} uses small bricks (stone, tile surrounds). fill {} leaves the opening empty (place something there yourself).
  "trim" colors the bricks around every window (sides, sill, header; turn parts off with trimSides/trimHeader/trimSill false).
- band {"op":"band","phase","rect":[x0,z0,x1,z1],"y":plate,"color","skip":[rects]?,"cap":"none"?} a plate course on a rectangular wall line plus a 1-stud projecting outer ring, capped with tiles (a belly band between floors). Upper walls then start at y+1. Skip the outer ring where something else needs it; skip all of it for a plain floor line.
- roof {"op":"roof","phase","rect":[x0,z0,x1,z1],"base":plate,"color","abut":[sides]?,"gable":[sides]?,"gableColor":C?,"fascia":C?,"mix":[[color,fraction],...]?} hip roof over a wall rectangle with 1-stud eaves, built from stepped plates covered with 1x1 slopes (about a 5:12 pitch). Sides are N (low z, back), S (high z, front), W (low x), E (high x). abut: sides that lean against a taller wall (no eave). gable: sides that end in a gable (no eave; the end row is gableColor, usually the wall color). fascia colors the eave plates (gutters). mix varies the slope colors for a tile-roof look.
- fill {"op":"fill","phase","kind":"tile"|"plate"|"brick","color","rects":[[x0,z0,x1,z1],...],"y":plate?} packs a region (street, sidewalk, driveway, walks, mulch beds, hedges, balcony or bay floors). It skips space already taken, so place studded pads, posts and bollards before paving.
- place {"op":"place","phase","part","color","at":[x,y,z],"rot":0|1?,"dir":"N"|"S"|"E"|"W"?}; places {"op":"places","phase","part","color","y":plate,"at":[[x,z],...] or [[x,y,z],...],"dir"?}. dir sets which way a "cheese" slope faces down.
- fence {"op":"fence","phase","color","line":[x0,z0,x1,z1],"y":plate?} made of 1x4 fence pieces; the length must be a multiple of 4. Stack a second run at y=3 for a taller fence or gate.
- sub {"op":"sub","phase","name","copies":[[x,y,z],...],"parts":[{"part","color","at":[dx,dy,dz]},...]} a sub-build (tree, car) built on its own, then attached; parts are relative to each copy. Give each sub-build its own phase.

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
- Real detail beats filler: trim, stone, bands, brackets, planting, fences, trees. The piece target is a budget, not a quota: don't add hedge courses, oversized canopies or extra rows just to reach it.
- Garage doors: fill the opening with a dark color ("Black", "Dark Bluish Gray", or "Trans-Black" for dark glass panels), nearly as wide as the garage and 3 or 4 courses tall, starting at the garage floor. Clear glass reads as a hole.
- Sloped lots: when the house sits above the street (steps up to the front door), build a solid foundation under the raised part first (a walls or fill op of bricks, as tall as the rise) and start those walls on top of it with "base". Keep the garage at street level when the photos show it there.
- Stairs: build them from fill ops at rising y, each step at least 2 studs deep and resting on the step below; the top step meets the floor at the door.

OUTPUT: one JSON object with keys name, place, scale, facts, assumed, phases, ops. No comments.`;

function example() {
  // A hand-built design made from three listing photos; compiles with 0 errors and 0 warnings.
  return fs.readFileSync(path.join(__dirname, '../../designs/634-unit-a.json'), 'utf8');
}

function designTask({ photoCount, notes, target }) {
  return `TASK
Design the house in the ${photoCount} attached photo${photoCount === 1 ? '' : 's'}${notes ? ` using these notes from the agent: "${notes}"` : ''}. Aim for about ${target} pieces (parts plus window glass plus the baseplate), within 10 percent.
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
  { name: 'Walls', task: 'PART 1 OF 4, WALLS. Set name, place, scale, facts, assumed and the full phases list for all four parts. Then write the walls of every building (house, garage, any outbuilding) with every door, window and garage-door opening, on a foundation where the house sits above the street. Nothing else yet.' },
  { name: 'Roofs', task: 'PART 2 OF 4, ROOFS AND TRIM. Add roofs, parapets and their caps, bands, awnings and bay roofs. Leave the walls alone unless the compiler flags them.' },
  { name: 'Site', task: 'PART 3 OF 4, THE LOT. Add the street, sidewalk, driveway, entry stairs and railings, walks, planters and retaining walls, patio paving, fences and gates.' },
  { name: 'Planting', task: 'PART 4 OF 4, PLANTING AND FINISH. Add trees, cacti, shrubs and other sub-builds. Then fix every remaining error and warning. When it compiles with 0 errors and 0 warnings, reply with one sentence; the last compiled design is kept.' },
];

function partsTask({ photoCount, notes, target }) {
  return `TASK
Design the house in the ${photoCount} attached photo${photoCount === 1 ? '' : 's'}${notes ? ` using these notes from the agent: "${notes}"` : ''}. The finished design should have about ${target} pieces (parts plus window glass plus the baseplate) and no more than 10 percent over. Fewer is fine when the house is simple.

WORK IN PARTS. You build the design in ${PARTS.length} parts, one part per turn; each turn tells you which part to do. In every part:
- Add that part's ops to the design so far and call compile_design on the complete design right away. The compiler is fast and exact. Send a rough draft early and let it find collisions and support problems; don't work out coordinates in your head.
- Each compile also returns renders of your model from the front and at three-quarters. Compare them with the photos: number of levels and relative heights, which walls face the street, garage door size, door and window sizes and positions, the entry and its stairs. Fix what looks different, not only what the compiler reports.
- Use at most 3 compiles per part. Problems caused by ops that belong to a later part can wait.
- Then reply with one or two short sentences: what you built and what still differs from the photos. Don't repeat the design JSON; the last compiled design is kept.

EXAMPLE of a valid finished design (a two-story house built from three listing photos, 778 pieces, 0 errors):
${JSON.stringify(JSON.parse(example()))}

${PARTS[0].task}`;
}

module.exports = { SPEC, designTask, fixTask, partsTask, PARTS, example };
