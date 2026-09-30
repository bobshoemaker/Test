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
  lift-off roofs that wouldn't come off in one piece or grip more than a few locating studs; roofs rise a plate a
  stud by default, or every 2 or 3 studs with `"pitch"` (the eave steps in a stud, then each course is a full layer, so
  a low hip still ties at its corners), and a one-sided roof is `"shed": side`, rising to that side and ending in an
  overhang there instead of against a wall raised to meet it (the wedge 157 Brisbane's first runs built);
  a lift-off roof is built on its own like a sub-build and rests on tiled wall tops; an "assembly"
  such as a floor slab over a wide room is built the same way but stays put; a walls op with `"slab"`
  gets its story's floor laid under it that way (covering the story below too, so a set-back story
  rests on its walls), so a story that juts out past the one below needs no brackets (a warning past 4 studs of overhang, unless a post or wall spans it); upper stories can lift
  off too, each resting on the one below, and the viewer lifts them top first; "variation": "subtle",
  which the design loop sets, recolors a few pieces of each material and turns about 15% of ground
  paving tiles and 8% of floor tiles into same-size plates, in patches, so some studs show;
  `"studs"` on a fill or floor op sets the share), a plant library built from
  real LEGO foliage the way LEGO's own sets build it: trees on round-brick trunks under deep canopies of
  "plant leaves" 6 x 5 and 4 x 3 turned a quarter each layer and lifted a plate apart, with sprigs, flowers or
  fruit on the tips (`CANOPY`), about as tall as a two-story house; LEGO's molded pines (3471, 2435) for
  conifers (GoBricks doesn't make them); leafy and flower-edged round plates; a palm top with swordleaf fronds
  clipped to its bars; one shared palette (Reddish Brown trunks, bases and soil, a few greens) so kinds share
  parts, and a warning when a design's planting passes 16 different parts and colors (`PLANT_LOTS`), naming the
  plants that add the most, a `lawn` op that
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
  GoBricks' part-list matcher once about every engine part in every color (monthly, `--fresh`, by
  `.github/workflows/gobricks-catalog.yml`, which opens a pull request naming what changed when anything did) (`src/server/gobricks.js`; the
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
- Photo check (`checkPhotos` in designer.js; the tool and its instructions in prompt.js): before a design request is
  saved or paid for, and before a survey, a quick low-effort look (`BRICKHOUSE_SURVEY_MODEL`) says what each photo
  shows; `photoVerdict`, plain code, refuses a photo of a different house from the rest, a building that isn't a home,
  or no building, a set with no clear outside view, and a floor plan that isn't one (422, naming the photos; the app
  outlines them). Inside shots and blurry ones pass; when in doubt it favours the owner. Tested with a fake client;
  not yet tried against real photos.
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
  opens onto it), and roughly how the lot rises toward the back (the design job with an address; `--address` on the
  scripts). The elevation samples take 15 s to a minute, so the app just asks for the address with the photos (and
  says why) and the job looks it up; each outside request has a time limit. Geocoders can land on a neighbour, so it measures from the
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
- `src/server/site.js`: finding the house and mapping it from above, for any US address, before the design (no
  plan needed). Candidates: house-sized buildings near the geocoded point from FEMA USA Structures (CC BY 4.0, about
  135 million US outlines) merged with OpenStreetMap, numbered on a USDA NAIP aerial (public domain, via USGS; 60 cm
  a pixel in California, resampled smoothly, its date looked up and told to Claude; USGS's basemap when the image
  server is busy), each described from its street (Census TIGER roads, public domain; OpenStreetMap as backup): which
  side, width across the front, depth. The pick: Claude compares the owner's photos with the numbered buildings
  (`view_candidates` close-ups turned street-side down, `submit_pick` with confidence and cues), told that the
  geocoder's pin is no evidence, since it often lands a few lots away (157 Brisbane St's pin was 140 ft off).
  Records: where a county publishes them (`COUNTIES`, LA County today, by the outline's FIPS code) its parcel checks
  the pick's address and overrides a wrong pick, and its sharper outline and lot line replace the national ones.
  Any other county: a parcel search (`src/server/parcels.js`, the design model with web search and fetch, while the
  pick runs) finds the county's (or state's) public ArcGIS parcel or address-point layer, tries layers at the house
  (`query_layer`, public https REST layers only) and submits one with its address fields; code keeps it only if it
  returns a house number at the house. Found once per county: `parcel-sources.json` (checked in, a seed) and
  `designs/generated/parcel-sources.json` (runtime); a county with nothing usable is retried after a month. It
  stops at $1.50 (`budgetUsd`); found layers have cost $0.08 to $0.42 (Orange, Travis, Monroe IN, Cook, King);
  Glynn County GA, whose parcels carry no addresses, spent the budget and found none. Its layer then checks and
  overrides the pick as LA's does (an address point checks the address but gives no lot line).
  The map: Claude (`BRICKHOUSE_SITE_MODEL`, a stronger model if wanted; falls back to the design model when the
  account can't use it) splits the house into blocks by height and roof, places garage and outside doors, and maps
  the lot (driveways, walks, patios, pools, lawn, beds, trees, fences, sheds and covers) in feet on the aerial turned
  street-side down, each submission drawn back over the aerial with its overlap with the outline (at most 3). The
  fit (`fitPlan`): the size's usual scale when the house, its drive and a little yard fit, else stretched within
  the size's range (`maxFtPerStud` in scale.js: Mini 4 to 5, Classic 2 to 3, Grand 1.5 to 2 ft per stud); past that
  the yards give way, never the house (it is shown whole even past the range, with a problem noted), and a bigger
  size is suggested only when this one can't show the house with its yard. `lockPlan` locks the walls to the map
  (footprint.js, source `site`); `siteInStuds` and `siteNoteText` give the design the lot in stud rectangles, and two
  map images (the blocks over the aerial, the plate in studs over it) go with the photos. A block's `upperRects` give an
  upper floor that sits differently (a second story jutting over the garage, read from the photos): it is locked as
  its own floor-2 block on a slab, and a jut under a stud is shown as one. Walls locked to the map bend a little
  (`tolerance` 1: a wall line may move a stud, a door slide 2 along its wall), since the photos correct the aerial.
  After the five parts a photo review (`review`, the site model unless `BRICKHOUSE_REVIEW_MODEL`; `BRICKHOUSE_REVIEW=0`
  turns it off) compares renders from four sides with the photos on a checklist (massing and juts, roofs and eaves,
  the front, windows, walls, the lot) and lists up to 8 fixes, which the design applies before the repair rounds.
  It knows roofs are built at a fixed pitch on purpose (a low real roof still reads right that way) and never asks to
  flatten one; SPEC says a pitched roof is always a roof op, never stacked flat fills. Then a second look compares
  renders from before and after the fixes with the photos: if the fixes made it read worse, the earlier version is
  restored with only the fixes that helped. (A first try let the review flatten 157 Brisbane's roofs into slabs.)
  The mapper also says
  whether the building matches the photos; with that and the records, `found.needsCheck` flags a doubtful house.
  Every stage is recorded with its pictures, reasoning and cost (`report.stages`); a job keeps it, and the admin
  page's Site map button shows it (`sitereport.js`). Corner lots aren't laid out with their second street here. The
  pure parts are tested; the rest was run against 157 Brisbane St.
- Attached homes and condos: a design sets `"property": "townhouse" | "condo"` and `"unit"`, and
  models that unit in full, cut from its building: adjoining units are muted `"context": true` stubs
  (exempt from the room and door checks), an upper-floor condo stands on a context plinth. The
  terrain lookup flags a likely unit (a unit in the address, `building=apartments/terrace/...`,
  `building:units` > 1), and then the walls are not locked to the whole building's outline; the
  survey asks which unit it is.
- `src/server/pipeline.js`: `prepareDesign`, the steps before Claude designs, shared by the server
  and `scripts/design.js` so the website and the CLI build every house the same way: an address
  adds the terrain facts to the notes; a floor plan locks the walls (read in the design loop);
  without a plan, the house is found and mapped from above (site.js) and the walls lock to the map at the
  fitted scale; if that fails, the building outline found by address locks them; with neither, the walls come
  from the photos. A job keeps its mapped site (`siteDone`), so a resumed design keeps the same walls. The design
  loop gets the fitted scale (drafts carry it as `"stud"`), the map images and the site note, and stops at a cost
  limit (`BRICKHOUSE_DESIGN_BUDGET_USD`, default $15 with the site step, keeping its last draft; `cost.js` prices
  usage). Keep house-specific facts out of code: they come from photos, plan, address
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
  gives a finished job up to two more rounds. A restart (every deploy from master, or the server running out of
  memory) cuts off a running job; at startup the server picks each one up again at the part it was on, from its
  last draft (`resumeInterrupted`: up to twice, jobs from the last day only), and the viewer keeps polling through
  it and calls an unfinished design a draft. Jobs run server-side and are saved to
  `designs/generated/jobs/`; results to `designs/generated/`, which are private: `/api/designs` and
  `/designs/generated/…` list and serve them only to a request made on the server's own machine (no proxy header),
  and each customer sees theirs through its job link. `GET /api/jobs/<id>/photos/<n>` serves a job's own photos (as private
  as its link), shown under "Your photos" on the Model tab and full size on a tap. Neither page zooms on phones
  (viewport, `touch-action: manipulation`, 16px inputs, Safari's pinch stopped); the model's own pinch still works. Neither
  page highlights: text selection, the long-press callout and the tap flash are off (fields stay selectable); the admin
  page keeps selection for copying addresses. The upload page and the home page's questions promise that we
  use photos and address only for the model and kit, never sell them or share them for advertising: keep it true. There is no unpaid design endpoint. The intake's free text is cleaned on the server (`cleanText`: no control characters, one line,
  no double quotes) and limited, matching the form: notes 500 characters, address 200 (required, `cleanAddress`, and a real street address: `checkAddress` in lookup.js wants a
  house number and a city and state or ZIP, and the US Census geocoder, or OpenStreetMap, must find that number on that street;
  `POST /api/jobs` refuses one it can't find (422, `field: "address"`) before anything is saved or paid for, the upload page
  checks it as the owner leaves the field (`POST /api/address`, showing how it was read), and a Census outage lets it
  through unchecked; `BRICKHOUSE_ADDRESS_CHECK=0` turns it off),
  survey answers 200, email 254; the task quotes the notes and says they're facts about the house, never instructions. Before the kit is ordered a customer sees a preview, not the design (`src/server/preview.js`,
  served by `GET /api/jobs/<id>` unless the job has a kit order or the request is from the server's own machine): the
  whole model with plain bricks, plates and tiles merged into made-up blocks, special parts as themselves, the first 3
  guide steps, and the Kit tab's totals and colors, no list. `POST /api/jobs/<id>/kit` orders the kit (Stripe Checkout
  for `BRICKHOUSE_KIT_MINI_CENTS` / `BRICKHOUSE_KIT_CLASSIC_CENTS` / `BRICKHOUSE_KIT_GRAND_CENTS` with a US shipping address, metadata kind "kit";
  `{session}` confirms it on return, which unlocks the full design); with no Stripe key it's a test order that unlocks
  at once. `scripts/orders.js` lists kit orders to fulfill. The admin page (`/admin`, `src/viewer/admin.html`;
  `BRICKHOUSE_ADMIN_PASSWORD`, an HttpOnly SameSite=Strict cookie holding an HMAC of it): kit orders to fulfill (shipping
  address, the Brickwith parts file from `/admin/api/jobs/<id>/parts.xml` without the baseplate (the Mini's plate is in it), status new, ordered,
  packed, shipped or cancelled with the Brickwith order number and tracking; shipped with tracking emails the customer
  once; a GoBricks stock check of the kit's parts, run when the kit is ordered and again on Check stock, naming lots short
  of stock and any the catalog snapshot says GoBricks no longer makes, kept on the job), designs that failed or have problems (Run again, from the part they reached), and all designs; the admin sees
  every design in full. Before its design, every paid request waits for the admin (`intake`, `BRICKHOUSE_HOLD_BEFORE_DESIGN=0` turns it off):
  status "intake", listed under "Ready to prepare", its owner's page saying our team is looking the photos over. Prepare
  (`/admin/intake?job=…`, `src/viewer/intake.html`) shows the request and every photo: the admin corrects each photo's view,
  leaves out misleading ones, adds up to 4 of their own (an aerial: view "aerial"), picks the house among the numbered
  buildings on our aerial (`POST …/candidates`, site.js `findCandidates`; the design then maps that building, `pickAt`,
  instead of picking one, and records don't override it), and writes instructions the design follows (`teamNotes`, a section
  of its own: the owner's notes stay facts, never instructions). `POST …/begin` starts it (`designPhotos` in server.js puts
  the owner's kept photos first, then the team's, with a sentence on which shows what). Every design is checked by the admin before its owner sees it (`hold`, `BRICKHOUSE_HOLD_FOR_REVIEW=0`
  turns it off): a finished design waits under "Waiting for your check" while its owner's page says it's being checked
  (status "review", no design, no "ready" email, no kit or fix round). Opening it (Check it) shows a review card on the
  Model tab: tap bricks to select them (blue; each listed by the design op that made it, with Select all), say in words
  what to change, and `POST /admin/api/jobs/<id>/revise {note, parts}` has Claude revise the design from the one it has
  (fix mode with `reviseTask`: the note, the selected pieces by op, renders; $5 cap), until it compiles clean. Every
  version is kept (`undo`), and `approve` releases it to its owner and sends the email. Designs finished before the hold
  (no `j.review`) stay as their owners saw them. Customer designs are held to GoBricks (`BRICKHOUSE_SUPPLIER`, default gobricks; not the scripted
  demo): designHouse's `supplier` stamps every draft and tells Claude. `POST /api/quote {lots}` returns GoBricks' price and stock
  for a parts list today (cached a day per list; `BRICKHOUSE_GOBRICKS_QUOTES=0` turns it off, `BRICKHOUSE_CNY_PER_USD`
  sets the viewer's dollar rate). `POST /api/lookup {address}` returns the place and ranked candidate
  photos (the dev view's Find photos); `GET /api/photo/<mapillary id>` proxies one image.
- `src/viewer/landing.html`: the home page at `/`, written for homeowners and gift buyers, not technical (moments,
  how it works, examples, sizes, questions); renders of the samples on its warm background in `src/viewer/img/`,
  made by `scripts/landing.js`; "Make yours" goes to `/app#design`. It promises a kit shipped to the customer (we order
  the parts from Brickwith, pack them and reship; the app's kit checkout isn't built yet) and names no prices in its questions.
- The landing hero is the viewer itself in an iframe (`/app?design=savannah-dr&hero=1`): only the model, from one
  view, on a transparent background, its top story (not plants) springing up on hover or tap and falling back with a
  bounce; a drag tilts it a little (rubber-banded) and it springs back on release. On touch the models don't follow the finger (a
  swipe scrolls the page natively, a tap on the hero lifts its top story); only a mouse drags them (the build loop too). It loads after the page and
  crossfades with its still picture (`hero-house.png`, the same view). `?hero=build` plays the building guide in a
  loop (the "Everything you need" section, `634-unit-a`, still `build-house.png`), loaded as it scrolls near, paused
  offscreen, posting its step to the page. Neither loads with reduced motion.
- The app at `/app` is consumer-facing in the home page's theme (warm palette, Jersey 10 headings, pill buttons;
  tabs Model, Guide, Kit, Make yours), under the same top bar as the home page: one component, `src/viewer/topbar.html`, that the server (and
  `bundle.js`) puts in place of each page's `<!-- topbar -->`, so it doesn't move between pages; its button reads
  "See an example" on the upload page). The upload page (above the Design button), the Model tab (under "What we filled
  in") and the home page's questions say the model takes some artistic license: a brick interpretation, not an exact
  or photorealistic copy; keep that said wherever the model is sold. "Make yours" (`/app#design`) is an upload page of its own, the sample house hidden,
  until the first draft of their house comes back. Photos go in through a checklist, a tile per view (front, front left
  corner, front right corner, back) with a small map of where to stand, then "More" for extras; the views go with the
  photos (`views`) and the server turns the known ones into a sentence after the owner's notes (`viewsNote`), so the
  design knows which photo shows which side. A missing front or side gets a note above the Design button that those
  sides get guessed, so the model won't be as accurate (not a block). The size is a choice of three cards,
  Mini, Classic and Grand, with the landing page's sizes and piece counts (`#sizeMini`, `#sizeClassic`, `#bigPlate`). After Design, the upload page gives way to a
  page of its own (`#sent`): thanks, the steps (photos received, designing with the live progress, ready), the private link
  with Copy, and what happens next; the job's link lands there too while the design is in progress. A job's link never shows the sample house first: the
  stage waits ("Loading your house…") for theirs, and the sample loads only when there's nothing of theirs to show. The owner never
  sees a design in progress: `GET /api/jobs/<id>` sends drafts only once it's finished (or to the server's own machine
  and the admin), so the house takes over from that page when it's done.
  Designs made in a browser are remembered there (localStorage `brickhouse-designs`: job id, name, address, date,
  status) and listed in a "Your designs" card under the form, by name or, until a draft names it, its address; each
  page load brings the list up to date (`POST /api/jobs/summary {ids}`, only for ids the device holds); "Made one on another device?" emails a sign-in link (`POST /api/mine
  {email}`, 5 an hour, the same answer either way), `/app?mine=<token>`: the email and an expiry signed with a server
  secret (`BRICKHOUSE_SECRET`, or one made once in the jobs folder), good for 24 hours, which lists that email's designs
  (`GET /api/mine?token=`) and adds them to the device. An email alone never shows anything. Email goes through Resend (`src/server/mail.js`, `RESEND_API_KEY`, sender `BRICKHOUSE_MAIL_FROM`
  on a verified domain): an optional email on the form (or the one from a Stripe checkout) gets the design's link
  once it's ready and a kit order's confirmation (jobs.js `notify`; the email is kept on the job, not in its
  parameters), and the Your designs sign-in link. Without a key the email fields don't show. `?dev=1` turns on the technical view in that browser (`?dev=0` off): the design
  list (samples only, unless the server is on your own machine), checker counts and problems, connection colors, part numbers, suppliers and
  prices, the piece target and the design code editor, all marked `dev-only`; standalone copies are technical.
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
    node scripts/design.js front.jpg right.jpg back.jpg --views front,right,back --address "157 Brisbane St, Monrovia, CA 91016" \
      --parts --effort high --site-model <stronger model> --budget 14 --out x.json
                                              # house found and mapped from above; <out>.site.json, .site-*.jpg, .run.json (stages, costs)
                                              # --site <out>.site.json --resume <draft>.json --from-part 4: continue a stopped run on the same map
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

- A design may set `"plate": 48` for the larger model (Grand: 48 x 48 baseplate, 1.5 ft per stud, about
  2,400 pieces, room for yards and a corner lot's second street) or `"plate": 16` for the smallest and cheapest
  (Mini: an ordinary 16 x 16 plate, 91405, a plate thick, at 4 ft per stud, so the same stretch of lot as the
  Classic at half the detail, about 250 to 450 pieces and about $15 of GoBricks parts; a story is 2 courses,
  windows are transparent bricks, and the task's plate note says what to leave out). `src/server/scale.js` holds
  the numbers (`sizeName`: Mini, Classic, Grand) and `--plate` / `plate` on /api/jobs select it; the engine's
  `BASEPLATES` carry each size's feet per stud, and a story's courses (enclosing a floor) follow it.
  `designs/634-unit-a-mini.json` is the Mini sample. A design may also set `"stud"` (feet per stud, 1 to 6)
  when the site step fitted the scale to a long house; the compiler's story and bare-ground checks follow it.
  The rest of this section is 32.
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
  GoBricks has no green LEGO-numbered baseplate, but makes its own thick (3.2 mm, a plate tall) green ones,
  GDS-2237 (32 x 32) and GDS-2238 (48 x 48), with no LEGO number: a design held to GoBricks uses them (entered
  by hand in scripts/gobricks.js with their dollar prices; the viewer draws the base a plate thick). Without
  a LEGO number the uploaded list can't carry them, so the Parts tab says to add them at Brickwith by hand.
  A supplier without its own baseplate gets a neutral one it sells, and the lawn op lays a full layer of grass.
  Brickwith's part-list upload doesn't know the 1 x 2 x 3 window (60593), so the catalog leaves it out.
- Plain bricks, plates and tiles are drawn as boxes with studs (no underside or logo). Sideways building is limited to side-stud bricks
  in wall openings with a few details hung on them (lantern, house number, plaque, vent); mounted
  parts are drawn as small blocks.
- Finding the house from photos and a 60 cm aerial alone isn't reliable yet: for 157 Brisbane St Claude picked a
  neighbour twice (145, then 133 Brisbane), and LA County's parcel records corrected it both times. The parcel
  search covers most other counties; where it finds nothing the pick stands unconfirmed (`found.needsCheck` flags it
  on the admin page). A nationwide parcel source (Regrid is paid) would cover the rest. The search has been run
  against real counties on its own, not yet inside a full design outside LA County.
  The public services it leans on (Overpass, the USGS image server) fail now and then; it retries, falls back to
  USGS's basemap, and carries on without terrain.
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
