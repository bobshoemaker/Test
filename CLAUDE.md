# Brickhouse

Photos of a house in, a buildable brick model out: a 3D model, a step-by-step build manual,
and a BrickLink parts list, with every stud connection checked. The business idea is a
closing gift that realtors give clients: a brick model of the house they just bought or sold.

## How it fits together

    photos ──> Claude (API) ──writes──> design JSON ──> engine ──> parts, checks, manual steps
                  ^                                        │
                  └──── compile_design tool results ───────┘   (Claude fixes errors in a loop)

- `src/engine/engine.js`: the core. Part catalog (BrickLink numbers and colors), the compiler
  that turns design ops into parts, the brick packer (staggers seams, repairs stacked seams),
  the checker (collisions, build-order support, sub-build attachment, connectivity to the
  baseplate, single-stud and seam warnings, doors that miss the ground in front of them and
  garage doors with no drive to the edge of the plate, a roof, wall or raised ground standing in front of a
  window (roof slopes within two studs of a window become flat tiles on their own, a ledge no higher than
  the sill; reaching one plate above the sill, the frame's foot, is allowed), baseplate showing inside a building,
  lift-off roofs that wouldn't come off in one piece or grip more than a few locating studs;
  a lift-off roof is built on its own like a sub-build and rests on tiled wall tops; an "assembly"
  such as a floor slab over a wide room is built the same way but stays put; a walls op with `"slab"`
  gets its story's floor laid under it that way (covering the story below too, so a set-back story
  rests on its walls), so a story that juts out past the one below needs no brackets (a warning past 4 studs of overhang, unless a post or wall spans it); upper stories can lift
  off too, each resting on the one below, and the viewer lifts them top first; "variation": "subtle",
  which the design loop sets, recolors a few pieces of each material and turns about 15% of ground
  paving tiles and 8% of floor tiles into same-size plates, in patches, so some studs show;
  `"studs"` on a fill or floor op sets the share), a plant library built from
  real LEGO foliage (branching "plant leaves" 4 x 3 and 6 x 5 with studs on their tips, stacked into
  canopies with fruit or flowers on the tips; leafy and flower-edged round plates; a palm top with
  swordleaf fronds clipped to its bars) in colors true to each plant, a `lawn` op that
  finishes bare ground (irregular patches of lighter and darker plates, grass tufts, a few flowers;
  textures lawn, meadow, dry) and a warning for a big open stretch of bare baseplate (about 12 ft
  square; `"lot": false` for a building alone, as most unit tests are), hints (never
  blocking) for big open stretches of plain tile, a fixture library for roofs (skylight, HVAC unit,
  vents, solar panel, hatch, chimney), manual step grouping (one layer a step, like a big LEGO set: split evenly past
  20 pieces, a step under 6 joins its neighbour), and the inventory.
  Parts must be easy to buy: `src/engine/parts-availability.js` (built by `scripts/availability.js`
  from Rebrickable's database downloads) says how many LEGO sets have included each part in each
  color and when; a part in a color is easy to get with 6+ sets, the latest 2018 or later. The packer
  only uses such sizes, mixes only recolor into such colors, and the checker warns about any other
  part (naming colors it does come in). The plant and fixture libraries are held to it by tests.
  A design with `"supplier": "gobricks"` is held to exactly what GoBricks (compatible bricks) makes, in place
  of LEGO availability (packer, mixes, texture and checker alike): `src/engine/suppliers.js` lists every
  part and palette color GoBricks makes with its catalog price, built by `scripts/gobricks.js`, which asks
  GoBricks' part-list matcher once about every engine part in every color (`src/server/gobricks.js`; the
  matcher takes LEGO design numbers, so the cone goes as 59900). The Parts tab shows GDS numbers and a price
  per lot, the total at catalog prices, and on the server today's price and stock (`POST /api/quote`); it
  saves the list for the part-list upload at Brickwith (brickwith.com), GoBricks' own store, which replaced Webrick.
  Dependency-free; runs in the browser (globals) and in Node (require).
- `src/server/prompt.js`: `SPEC`, the design language written for Claude. It is the source of
  truth for what a design may contain. When you add an op, part or field to the engine,
  document it in SPEC in the same change.
- `src/server/designer.js`: the Claude loop. Sends photos + SPEC + task, gives Claude a
  `compile_design` tool that runs the engine in-process, feeds errors back, returns the final
  design. Keeps whole assistant turns (thinking blocks included) as the API requires. Parts
  mode builds walls, roofs, lot and planting in separate appended turns; each compile result
  carries renders of the draft (front, front three-quarter and both back corners, capped so a
  request stays under the API's image limit) for Claude to compare with the photos.
- Survey (`surveyHouse` in designer.js, `POST /api/survey`, `scripts/survey.js`): a cheap first
  look (low effort by default; `BRICKHOUSE_SURVEY_MODEL` / `BRICKHOUSE_SURVEY_EFFORT`) that lists
  what the photos show and asks up to five questions about what they leave open (a roof hidden
  by a parapet, an unseen side), each with buildable options and a recommended one, plus a
  landscaping style. The owner's answers go into the design task as binding choices.
- `src/server/terrain.js`: the house's own building outline (OpenStreetMap; in LA County these carry
  county outlines with height, year built and parcel, so outbuildings on the same parcel show up),
  the streets its lot fronts (two on a corner lot), and USGS 3DEP elevations (public domain, no
  key). The note says, relative to each street, how it rises across the baseplate, which side a
  corner's second street is on, where each outbuilding sits and how the ground there compares with
  the house, any alley or service lane beside the house or an outbuilding (a garage there likely
  opens onto it), and roughly how the lot rises toward the back (`/api/lookup` adds
  it; `--address` on the scripts). Geocoders can land on a neighbour, so it measures from the
  outline when it finds one. The lot's rise is smoothed and interpolated under the house, so the
  note defers to the photos there. Not Street View: Google's terms bar it.
- `src/server/footprint.js`: floor plan to locked walls. With a plan, parts mode first has Claude
  read the footprint off a pixel-gridded copy (`submit_footprint`: labeled rooms for scale,
  blocks as rectangles, doors, stairs, street side). This module scales it to studs from the
  room labels, fits it on the baseplate with the street at z = 31 (pulling a detached back
  building forward if needed), and turns it into walls ops tagged with `block`.
  `checkFootprint` holds every draft to those walls and doors; changes count as errors. Without a
  plan, `footprintFromOutline` locks the walls to the house's building outline from the terrain
  lookup instead (squared to the grid, outbuildings as their own blocks, no doors). For 3221
  Griffith Park Blvd the county outline matched the plan's walls to about a stud. Pure and tested.
- Attached homes and condos: a design sets `"property": "townhouse" | "condo"` and `"unit"`, and
  models that unit in full, cut from its building: adjoining units are muted `"context": true` stubs
  (exempt from the room and door checks), an upper-floor condo stands on a context plinth. The
  terrain lookup flags a likely unit (a unit in the address, `building=apartments/terrace/...`,
  `building:units` > 1), and then the walls are not locked to the whole building's outline; the
  survey asks which unit it is.
- `src/server/pipeline.js`: `prepareDesign`, the steps before Claude designs, shared by the server
  and `scripts/design.js` so the website and the CLI build every house the same way: an address
  adds the terrain facts to the notes; a floor plan locks the walls (read in the design loop);
  without a plan, the building outline found by address locks them; with neither, the walls come
  from the photos. Keep house-specific facts out of code: they come from photos, plan, address
  lookups, the owner's survey answers and notes.
- `src/server/render.js`: optional (needs Playwright). Renders draft views with the viewer in
  headless Chromium, the gridded plan, and the footprint overlaid on the plan.
- `src/server/lookup.js`: address to candidate photos. Geocodes with OpenStreetMap Nominatim
  (building-level when OSM has the address) then the US Census geocoder (street-level), finds
  Mapillary street photos aimed at the house (`rankPhotos`, pure and tested), and fetches a
  chosen photo by numeric id only. Each photo carries credit and license; the server stores
  them on the design as `photoCredits` and the viewer shows them.
- `src/server/server.js`: zero-dependency HTTP server. Serves the viewer and designs; takes up to 12
  photos a design (`MAX_PHOTOS`; the design loop's 90-image budget keeps the rest for renders). A design is a
  job (`src/server/jobs.js`): `POST /api/jobs {photos, notes, address?, plan?, plate?, choices?}`
  saves it and, when `STRIPE_SECRET_KEY` is set, returns a Stripe Checkout link for the design fee
  (`BRICKHOUSE_DESIGN_FEE_CENTS`, `src/server/payments.js`); `POST /api/jobs/<id>/start {session}`
  runs it only once Stripe confirms that job's session is paid, and only once; `GET
  /api/jobs/<id>?after=&have=` is its progress, polled by the viewer; `POST /api/jobs/<id>/fix`
  gives a finished job up to two more rounds. Jobs run server-side and are saved to
  `designs/generated/jobs/`; results to `designs/generated/`. There is no unpaid design endpoint. `POST /api/quote {lots}` returns GoBricks' price and stock
  for a parts list today (cached a day per list; `BRICKHOUSE_GOBRICKS_QUOTES=0` turns it off, `BRICKHOUSE_CNY_PER_USD`
  sets the viewer's dollar rate). `POST /api/lookup {address}` returns the place and ranked candidate
  photos; `GET /api/photo/<mapillary id>` proxies one image.
- `src/viewer/landing.html`: the home page at `/` (what it is, how it works, the sample models, for realtors),
  with renders of the samples in `src/viewer/img/` made by `scripts/landing.js`; "Start a design" goes to `/app#design`.
- `src/viewer/`: single-page three.js (r128, CDN) viewer, at `/app`: model, manual (sub-builds shown on
  their own), parts and BrickLink XML, design editor, photo upload, and "Lift roof" for designs
  whose roof ops carry `"liftoff"` (floors show underneath; the rooms too when there was a plan).
  Play build drops each step's bricks straight down into place; lifting raises a roof's or floor's
  bricks straight up, layer by layer, and putting back lowers them (skipped with reduced motion).
- `designs/`: hand-built reference designs. `634-unit-a.json` was built by hand from three
  listing photos; use it as the quality bar for photo-generated designs.
- `src/viewer/ldraw-parts.js`: real part geometry from the LDraw Parts Library (CC BY 4.0, credited in
  the viewer and file header) for the plant parts and the specialty parts (cheese slope, round bricks
  and plates, cone, bracket, side-stud brick, windows and their glass, arches, fence), at low detail;
  plain bricks, plates and tiles stay boxes with drawn studs; `?ldraw=0` shows the simple shapes; `scripts/ldraw.js` regenerates it (`--lowres` uses
  8-sided round primitives). The engine's stud layouts for those parts follow the LDraw files.
- `scripts/`: `compile.js` (check a design), `design.js` (photos to design from the CLI),
  `bundle.js` (single-file HTML for sharing or publishing as a Claude artifact), `ldraw.js`,
  `availability.js` (rebuild the availability table; rerun now and then as LEGO releases sets),
  `landing.js` (re-render the landing page's sample pictures), `gobricks.js` (rebuild the GoBricks table: ten matcher requests, replies cached in `.gobricks-cache/`).

## Commands

    npm install
    npm test                                  # engine + designer loop, no API key needed
    npm run demo                              # server with a scripted Claude (no key)
    npm start                                 # real Claude; needs BRICKHOUSE_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY)
                                              # BRICKHOUSE_PASSWORD puts the site behind a password (hosting: docs/deploy.md)
                                              # an organization-scoped key also needs BRICKHOUSE_ANTHROPIC_WORKSPACE_ID
    node scripts/compile.js designs/634-unit-a.json --steps
    node scripts/design.js a.jpg b.jpg --target 1200 --out designs/new.json
    node scripts/design.js a.jpg b.jpg --plan plan.png --parts --effort high --out designs/generated/x.json
                                              # plan first, then four parts; drafts, renders and overlays saved next to --out
    node scripts/survey.js a.jpg b.jpg --out survey.json          # questions for the owner; then design.js --choices survey.json
    node scripts/terrain.js "3221 Griffith Park Blvd, Los Angeles, CA"   # street and slope; --address on survey.js/design.js adds it
    node scripts/bundle.js designs/634-unit-a.json
    node scripts/lookup.js "12 Elm St, Springfield, IL" --take 1,2 --out photos/elm   # needs MAPILLARY_TOKEN

Model defaults to `claude-opus-5-5` (`BRICKHOUSE_MODEL`). Opus 5.5 always uses adaptive
thinking; set depth with `BRICKHOUSE_EFFORT` (low, medium, high, xhigh, max), which is sent
as `output_config.effort`. Don't send `thinking: {type: "enabled"}` or `temperature`, and
leave `tool_choice` on auto: newer models reject those. Check platform.claude.com docs
before changing API parameters.

## Coordinates and units

- A design may set `"plate": 48` for the larger model (48 x 48 baseplate, 1.5 ft per stud, about
  2,400 pieces, room for yards and a corner lot's second street); `src/server/scale.js` holds the
  numbers and `--plate 48` / `plate` on /api/design select it. The rest of this section is 32.
- 32 x 32 stud baseplate. x = 0..31 left to right seen from the street; z = 0..31 back to
  front; the street runs along z = 31.
- Heights are in plates: brick = 3, plate/tile = 1. Wall course c starts at
  `base + (c - courses[0]) * 3`. Default scale about 2 ft per stud; a story is 4 courses.
- Roof sides: N = low z (back), S = high z (front), W = low x, E = high x.

## Rules

- A design ships only with 0 errors and 0 warnings. Never loosen a check to make a design
  pass; fix the design or fix a real bug in the check, with a test.
- Every design in `designs/` must compile clean; `test/engine.test.js` snapshots piece counts.
  Update the snapshot only when a design changes on purpose.
- Mark guesses as guesses. Designs carry `facts` (what the photos show) and `assumed` (what
  was guessed); the viewer shows both. Don't present an assumption as a fact.
- Keep the engine dependency-free and runnable in both browser and Node. Plain CommonJS, no
  build step.

## Known gaps

- Availability counts LEGO sets that included a part (Rebrickable), a good proxy for how easy it is to
  buy, not live BrickLink stock. BrickLink numbers mostly match Rebrickable's (aliases in
  scripts/availability.js). LDraw lists 2566 palm top and 6064 plant bush as obsolete molds, though
  sets still include both; costs are placeholder
  per-piece prices. Check before any real order.
- GoBricks quotes and the catalog snapshot use the part-list matcher gobricks.cn's own site calls, not a
  documented API: ask GoBricks (support@webrick.com) before customers rely on it. Prices come back in
  yuan (the reply names no currency), before shipping; the dollar figure uses what Brickwith, GoBricks' store, charged for the 634 sample
  (¥153.07 came to $43.88, about ¥3.5 a dollar), not the exchange rate. Under a
  supplier the engine warns about what it can't get; Claude, not the engine, swaps the part or color.
  GoBricks sells no green baseplate, so a design held to GoBricks takes a neutral one it does sell (the
  32 x 32 in Dark Brown, the 48 x 48 in Dark Bluish Gray) and the lawn op lays a full layer of grass over
  it; LEGO designs keep the green baseplate, and their Parts tab leaves it out of the GoBricks total.
  Brickwith's part-list upload doesn't know the 1 x 2 x 3 window (60593), so the catalog leaves it out.
- Plain bricks, plates and tiles are drawn as boxes with studs (no underside or logo). Sideways building is limited to side-stud bricks
  in wall openings with a few details hung on them (lantern, house number, plaque, vent); mounted
  parts are drawn as small blocks.
- The manual exists in the viewer only; there's no PDF export yet.
- The photo-to-design loop has only run against the scripted client in tests. The first
  real runs need prompt tuning; compare results with `designs/634-unit-a.json` using the
  same three photos.

## Photo sources (read before changing address lookup)

Don't scrape Zillow, Redfin or Google Street View: their terms prohibit it and listing photos
are copyrighted. Legitimate sources, in order of preference, are in `docs/photo-sources.md`:
agent uploads today, then an MLS data feed (RESO Web API through a broker, e.g. CRMLS in
Southern California), oblique aerial imagery (Nearmap, EagleView), photographer platforms
(Aryeo), and Mapillary street imagery (CC BY-SA, with commercial-use conditions). Each needs
its license terms checked for a physical derived product.

## Roadmap

1. Run the real loop on the 634 photos and tune SPEC and the task prompt until results come
   close to the hand-built reference.
2. PDF manual export (one step per page, parts callouts, cover, inventory).
3. BrickLink price check for the parts list (availability by set count is done).
4. Address box: done for geocoding and Mapillary street photos. Still to do: MLS feed (RESO)
   and oblique aerial imagery as photo sources, property facts (stories, size, year), and
   cropping Mapillary panoramas, which are skipped today and are much of recent coverage.
5. Mobile client (Flutter) on top of the server API.
6. Scale option: done as the 48 x 48 plate at 1.5 ft per stud, with a plant library, a details
   part, and side-stud wall details. More detail kinds (shutters, window boxes) could follow.
