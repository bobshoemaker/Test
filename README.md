# Brickhouse

Turn photos of a house into a buildable brick model with a checked, step-by-step build
manual and a BrickLink parts list.

## Quick start

    npm install
    npm test
    npm run demo      # try the photo flow with a scripted Claude, no API key
    open http://localhost:5173

To use real Claude, copy `.env.example` to `.env`, add your `ANTHROPIC_API_KEY`, and run
`npm start`. In the Design tab, pick exterior photos (front first) and choose "Design from photos".
Claude writes a design, the engine compiles and checks it, Claude fixes what the checker
flags, and the result is saved to `designs/generated/`.

Open a specific design with `?design=634-unit-a` or `?design=savannah-dr`.

## Command line

    node scripts/compile.js designs/634-unit-a.json --steps
    node scripts/design.js front.jpg side.jpg --notes "garage on the right" --target 1200
    node scripts/bundle.js designs/634-unit-a.json   # single-file HTML in dist/

See `CLAUDE.md` for architecture, rules and the roadmap, and `docs/photo-sources.md` for
where house photos can legitimately come from.
