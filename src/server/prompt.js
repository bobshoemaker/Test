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
- walls {"op":"walls","phase","color","courses":[c0,c1],"base":plate,"segments":[[x0,z0,x1,z1],...],"openings":[...],"trim":color?,"trimSides":bool?,"trimHeader":bool?,"trimSill":bool?,"block":name?}
  Segments are straight, 1-stud-thick wall lines. Course c starts at plate base+(c-c0)*3.
  "block" ties the op to a block laid out from the floor plan; when the task gives locked walls, every op with that block keeps its segments exactly.
  Openings: {"cells":[x0,z0,x1,z1] (a run along one wall),"courses":[a,b],"fill":{...}}.
  fill {"part":"win22"} = window 2 wide, 2 courses; "win23" = 2 wide, 3 courses (tall windows, French doors); "win43" = 4 wide, 3 courses; "arch41" = arch 1x4, 1 course (put it on top of a 4-wide window for an arched window); "arch42" = arch 1x4, 2 courses. The opening must match the part exactly. Add "color" to set a window or arch color.
  fill {"color":C} fills the opening with bricks of another color (doors, garage doors, dark glass with "Trans-Black"). {"color":C,"small":true} uses small bricks (stone, tile surrounds). fill {} leaves the opening empty (place something there yourself).
  "trim" colors the bricks around every window (sides, sill, header; turn parts off with trimSides/trimHeader/trimSill false).
- band {"op":"band","phase","rect":[x0,z0,x1,z1],"y":plate,"color","skip":[rects]?,"cap":"none"?} a plate course on a rectangular wall line plus a 1-stud projecting outer ring, capped with tiles (a belly band between floors). Upper walls then start at y+1. Skip the outer ring where something else needs it; skip all of it for a plain floor line.
- roof {"op":"roof","phase","rect":[x0,z0,x1,z1],"base":plate,"color","abut":[sides]?,"gable":[sides]?,"gableColor":C?,"fascia":C?,"mix":[[color,fraction],...]?} hip roof over a wall rectangle with 1-stud eaves, built from stepped plates covered with 1x1 slopes (about a 5:12 pitch). Sides are N (low z, back), S (high z, front), W (low x), E (high x). abut: sides that lean against a taller wall (no eave). gable: sides that end in a gable (no eave; the end row is gableColor, usually the wall color). fascia colors the eave plates (gutters). mix varies the slope colors for a tile-roof look.
  Roofs over joined wings: {"op":"roof","phase","rects":[[x0,z0,x1,z1],...],"against":[[x0,z0,x1,z1],...]?,"base":plate,"color","fascia"?,"mix"?} is ONE hip roof over the union of the rectangles (an L or T-shaped house), with valleys where wings meet. Use it whenever wings share a wall-top height; never build separate hips that butt into each other. "against" lists the rectangles of a taller building this roof leans on: the roof rises into that building's wall there and has an eave everywhere else (a lower wing or garage against a two-story house). The taller building's walls must rise above the roof where it leans.
  The compiler warns when a roof's abutted or leaning side leaves its stepped edge showing (another roof or a lower wall beside it). Fix it with one "rects" roof, "against", or a taller wall; never with a gap.
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
- Garage doors: fill the opening with a solid dark color ("Black" or "Dark Bluish Gray"; transparent colors render as a hole), nearly as wide as the garage and 3 or 4 courses tall, starting at the garage floor. Clear glass reads as a hole.
- Sloped lots: when the house sits above the street (steps up to the front door), build a solid foundation under the raised part first (a walls or fill op of bricks, as tall as the rise) and start those walls on top of it with "base". Keep the garage at street level when the photos show it there.
- Stairs: build them from fill ops at rising y, each step at least 2 studs deep and resting on the step below; the top step meets the floor at the door.

OUTPUT: one JSON object with keys name, place, scale, facts, assumed, phases, ops. No comments.`;

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

function designTask({ photoCount, notes, target, hasPlan = false, choices = null }) {
  return `TASK
Design the house in the ${photoCount} attached photo${photoCount === 1 ? '' : 's'}${notes ? ` using these notes from the agent: "${notes}"` : ''}. Aim for about ${target} pieces (parts plus window glass plus the baseplate), within 10 percent.${planNote(hasPlan)}${choicesNote(choices)}
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
  { name: 'Walls', locked: 'PART 1 OF 4, WALLS. Set name, place, scale, facts, assumed and the full phases list for all four parts, including each locked op\'s phase. Start from the locked walls ops: set each block\'s heights (courses and base, a foundation where the house sits above the street), colors, trim, and each locked opening\'s courses and fill to match the photos, then add the windows and other openings the photos show. Nothing else yet.', task: 'PART 1 OF 4, WALLS. Set name, place, scale, facts, assumed and the full phases list for all four parts. Then write the walls of every building (house, garage, any outbuilding) with every door, window and garage-door opening, on a foundation where the house sits above the street. Nothing else yet.' },
  { name: 'Roofs', task: 'PART 2 OF 4, ROOFS AND TRIM. Add roofs, parapets and their caps, bands, awnings and bay roofs. Leave the walls alone unless the compiler flags them.' },
  { name: 'Site', task: 'PART 3 OF 4, THE LOT. Add the street, sidewalk, driveway, entry stairs and railings, walks, planters and retaining walls, patio paving, fences and gates. Follow the landscaping style in the owner\'s choices, if there is one, for beds, lawn, gravel and paving.' },
  { name: 'Planting', task: 'PART 4 OF 4, PLANTING AND FINISH. Add trees, cacti, shrubs and other sub-builds, in the landscaping style from the owner\'s choices if there is one. Then fix every remaining error and warning. When it compiles with 0 errors and 0 warnings, reply with one sentence; the last compiled design is kept.' },
];

// The walls laid out from the floor plan, which the design has to keep (checked on every compile).
function lockedNote(locked, ops) {
  if (!locked) return '';
  return `
LOCKED WALLS FROM THE ${locked.source === 'outline' ? "HOUSE'S BUILDING OUTLINE (county or OpenStreetMap building footprint; it has no doors or windows, so place those from the photos)" : 'FLOOR PLAN'}. These walls ops were laid out from the ${locked.source === 'outline' ? 'outline' : 'floor plan'} at ${locked.scale.ftPerStud} ft per stud, with the street along z=31. Start the design from them. Keep every op's "block" and "segments", and each listed opening's "cells", exactly as given: every compile checks them and reports changes as errors. Everything else is yours to set from the photos: courses and base (heights, raised floors, foundations), colors, trim, each opening's courses and fill, windows and other openings, and more walls ops for the same block (a foundation course or a parapet) with the same block and segments.
${JSON.stringify(ops)}
Block rectangles for roofs ("rects"; blocks with the same wall-top height share one roof): ${JSON.stringify(locked.blocks.filter((b) => b.cells.length).map((b) => ({ block: b.name, rects: b.cellRects })))}
${locked.sideStreet ? `Corner lot: a second street runs along x = ${locked.sideStreet.side === 'left' ? 0 : 31} (columns ${locked.sideStreet.columns.join(' to ')} are kept free for its street and sidewalk; build them in part 3).` : ''}
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

function partsTask({ photoCount, notes, target, hasPlan = false, locked = null, lockedOps = null, seed = null, fromPart = 1, choices = null }) {
  return `TASK
Design the house in the ${photoCount} attached photo${photoCount === 1 ? '' : 's'}${notes ? ` using these notes from the agent: "${notes}"` : ''}. The finished design should have about ${target} pieces (parts plus window glass plus the baseplate) and no more than 10 percent over. Fewer is fine when the house is simple.${planNote(hasPlan)}${choicesNote(choices)}

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
const FOOTPRINT_SPEC = `You read a house's listing floor plan and photos and report its footprint for a brick model. Code turns your report into walls on a 32 x 32 stud baseplate at 2 ft per stud, so you only read the plan; you don't place bricks.

Work in the plan's own pixel coordinates: x to the right, y down. The gridded copy of the plan has a thin line every 10 px and labels every 50 px (red across the top, blue down the side), all in original plan pixels. Read positions off that grid.

Report with submit_footprint:
- street: the plan side that faces the street (N top, S bottom, E right, W left). The street-level garage door opens toward the street, a lower level sits on the street side of a sloping lot, and exterior stairs run down toward it. A garage door is on the garage's short side (a one-car garage is about 10 ft wide and 17 to 20 ft deep). If the agent's notes name the street side, use it.
- sideStreet (corner lots only): the plan side that faces a second street, if the lot has one. The agent's notes or terrain say whether it's a corner lot.
- rooms: three or more rooms with size labels (like "14 X 20"), each with rectPx along its wall lines. They set the scale, so pick rooms whose four walls are clear.
- blocks: the exterior of every building, split into parts that differ in height (a two-level wing, the one-level main house, a detached garage). Each is one or more rectangles along the exterior wall center lines; rectangles of one block may touch or overlap. levels is the number of stories seen from outside (2 for a garage with rooms above it). List the tallest blocks first. A lower level drawn separately on the plan (like a garage under a bedroom wing) is not its own block when it sits under a main-level block; give that block 2 levels and put the lower level's doors on it.
- openings: every exterior door, garage door, and sliding or French door, as the point on the wall line at its center (atPx), its block, kind and width in feet. Windows come later from the photos.
- stairs: exterior stairs and steps as rectangles.
Rectangles are [x0, y0, x1, y1] with x0 < x1 and y0 < y1.

Each submission comes back with the layout in studs and an overlay of those walls on the plan, drawn as it will sit on the baseplate. Check the overlay: every wall on a plan wall line, doors on the plan's door swings, stairs where the plan draws them, and the street along the bottom. Fix what's off and submit again (at most 4 submissions). When it matches, reply with one sentence.`;

const FOOTPRINT_TOOL = (() => {
  const rect = { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 };
  return {
    name: 'submit_footprint',
    description: 'Lays out the footprint read from the floor plan in studs at 2 ft per stud and returns the layout, any problems, and an overlay of the walls on the plan. Coordinates are original plan pixels.',
    input_schema: {
      type: 'object',
      properties: {
        street: { type: 'string', enum: ['N', 'S', 'E', 'W'] },
        sideStreet: { type: 'string', enum: ['N', 'S', 'E', 'W'], description: 'Corner lots only: the plan side facing the second street.' },
        rooms: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, label: { type: 'string' }, rectPx: rect }, required: ['name', 'label', 'rectPx'] } },
        blocks: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, levels: { type: 'integer' }, rectsPx: { type: 'array', items: rect }, note: { type: 'string' } }, required: ['name', 'levels', 'rectsPx'] } },
        openings: { type: 'array', items: { type: 'object', properties: { block: { type: 'string' }, kind: { type: 'string', enum: ['door', 'double door', 'sliding door', 'garage door'] }, atPx: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, widthFt: { type: 'number' }, note: { type: 'string' } }, required: ['block', 'kind', 'atPx', 'widthFt'] } },
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

Ask only when the answer changes what gets built and the photos don't settle it. Typical cases: a roof hidden behind a parapet or seen only edge-on (flat, or low-sloped tile?), a side or the back never shown, a garage door style or color seen only at night, what sits behind a fence. Don't ask about anything the photos show clearly, and don't ask about taste; landscaping style is asked separately. Ask at most 5 questions, each with 2 to 4 options that the design language below can build. Mark the option the photos point to as recommended and say in "why" what you see and what's unclear. Keep option labels to a few words and details to one sentence. Say in landscapeSeen what planting the photos show, in a few words.

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
