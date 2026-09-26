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
  baseplate, single-stud and seam warnings), manual step grouping, and the inventory.
  Dependency-free; runs in the browser (globals) and in Node (require).
- `src/server/prompt.js`: `SPEC`, the design language written for Claude. It is the source of
  truth for what a design may contain. When you add an op, part or field to the engine,
  document it in SPEC in the same change.
- `src/server/designer.js`: the Claude loop. Sends photos + SPEC + task, gives Claude a
  `compile_design` tool that runs the engine in-process, feeds errors back, returns the final
  design. Keeps whole assistant turns (thinking blocks included) as the API requires.
- `src/server/lookup.js`: address to candidate photos. Geocodes with OpenStreetMap Nominatim
  (building-level when OSM has the address) then the US Census geocoder (street-level), finds
  Mapillary street photos aimed at the house (`rankPhotos`, pure and tested), and fetches a
  chosen photo by numeric id only. Each photo carries credit and license; the server stores
  them on the design as `photoCredits` and the viewer shows them.
- `src/server/server.js`: zero-dependency HTTP server. Serves the viewer and designs; `POST
  /api/design` streams NDJSON events (`status`, `draft`, `done`, `error`) and saves results to
  `designs/generated/`. `POST /api/lookup {address}` returns the place and ranked candidate
  photos; `GET /api/photo/<mapillary id>` proxies one image.
- `src/viewer/`: single-page three.js (r128, CDN) viewer: model, manual (sub-builds shown on
  their own), parts and BrickLink XML, design editor, photo upload.
- `designs/`: hand-built reference designs. `634-unit-a.json` was built by hand from three
  listing photos; use it as the quality bar for photo-generated designs.
- `scripts/`: `compile.js` (check a design), `design.js` (photos to design from the CLI),
  `bundle.js` (single-file HTML for sharing or publishing as a Claude artifact).

## Commands

    npm install
    npm test                                  # engine + designer loop, no API key needed
    npm run demo                              # server with a scripted Claude (no key)
    npm start                                 # real Claude; needs BRICKHOUSE_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY)
    node scripts/compile.js designs/634-unit-a.json --steps
    node scripts/design.js a.jpg b.jpg --target 1200 --out designs/new.json
    node scripts/bundle.js designs/634-unit-a.json
    node scripts/lookup.js "12 Elm St, Springfield, IL" --take 1,2 --out photos/elm   # needs MAPILLARY_TOKEN

Model defaults to `claude-opus-5-5` (`BRICKHOUSE_MODEL`). Opus 5.5 always uses adaptive
thinking; set depth with `BRICKHOUSE_EFFORT` (low, medium, high, xhigh, max), which is sent
as `output_config.effort`. Don't send `thinking: {type: "enabled"}` or `temperature`, and
leave `tool_choice` on auto: newer models reject those. Check platform.claude.com docs
before changing API parameters.

## Coordinates and units

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
- Part geometry is simplified in the renderer. No SNOT, so wall-mounted details (lanterns,
  vents, house numbers) can't be built yet.
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
6. Scale option (studs per foot) so small houses can use more of the baseplate.
