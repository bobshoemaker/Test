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
  garage doors with no drive to the edge of the plate, baseplate showing inside a building,
  lift-off roofs that wouldn't come off in one piece or grip more than a few locating studs;
  a lift-off roof is built on its own like a sub-build and rests on tiled wall tops; an "assembly"
  such as a floor slab over a wide room is built the same way but stays put; upper stories can lift
  off too, each resting on the one below, and the viewer lifts them top first; "variation": "subtle",
  which the design loop sets, recolors a few pieces of each material), hints (never
  blocking) for big open stretches of plain tile, a fixture library for roofs (skylight, HVAC unit,
  vents, solar panel, hatch, chimney), manual step grouping, and the inventory.
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
- `src/server/server.js`: zero-dependency HTTP server. Serves the viewer and designs; `POST
  /api/design {photos, notes, address?, plan?, plate?, choices?}` runs the parts pipeline (renders
  when Playwright is installed) and streams NDJSON events (`status`, `draft`, `done`, `error`),
  saving results to `designs/generated/`. `POST /api/lookup {address}` returns the place and ranked candidate
  photos; `GET /api/photo/<mapillary id>` proxies one image.
- `src/viewer/`: single-page three.js (r128, CDN) viewer: model, manual (sub-builds shown on
  their own), parts and BrickLink XML, design editor, photo upload, and "Lift roof" for designs
  whose roof ops carry `"liftoff"` (floors show underneath; the rooms too when there was a plan).
- `designs/`: hand-built reference designs. `634-unit-a.json` was built by hand from three
  listing photos; use it as the quality bar for photo-generated designs.
- `scripts/`: `compile.js` (check a design), `design.js` (photos to design from the CLI),
  `bundle.js` (single-file HTML for sharing or publishing as a Claude artifact).

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

- BrickLink part numbers and color availability are unverified; costs are placeholder
  per-piece prices. Check before any real order.
- Part geometry is simplified in the renderer. Sideways building is limited to side-stud bricks
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
3. BrickLink price and availability check for the parts list.
4. Address box: done for geocoding and Mapillary street photos. Still to do: MLS feed (RESO)
   and oblique aerial imagery as photo sources, property facts (stories, size, year), and
   cropping Mapillary panoramas, which are skipped today and are much of recent coverage.
5. Mobile client (Flutter) on top of the server API.
6. Scale option: done as the 48 x 48 plate at 1.5 ft per stud, with a plant library, a details
   part, and side-stud wall details. More detail kinds (shutters, window boxes) could follow.
