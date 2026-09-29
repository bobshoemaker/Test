// What happens before Claude designs, shared by the server and scripts/design.js, so every house
// goes through the same steps whatever it looks like and whatever the owner has:
//   - an address: geocode it; add the building, streets, lanes and slopes to the notes (terrain.js)
//   - a floor plan: the design loop reads the footprint off it and locks the walls to it
//   - no plan, but a building outline from the address: lock the walls to the outline
//   - neither: the walls come from the photos alone
const { lookupTerrain, outlineInput } = require('./terrain');
const { footprintFromOutline } = require('./footprint');
const { scaleFor } = require('./scale');

// Returns {notes, terrain, place, locked, lockSource, log[]}. Lookups are best effort: a failed
// geocode or map query leaves the notes as they were and says why in log.
async function prepareDesign({ address = null, place = null, notes = '', plan = null, plate = 32, frontStreet = null,
  lockToOutline = true, geocode = null, fetchImpl } = {}) {
  const log = [], sc = scaleFor(plate);
  let terrain = null, locked = null, lockSource = null;
  if (address && !place) {
    try { place = await (geocode || require('./lookup').geocode)(address); } catch (e) { log.push(`Address lookup failed: ${e.message}`); }
    if (!place) log.push(`Address not found: ${address}`);
  }
  if (place) {
    try {
      terrain = await lookupTerrain(place, address || '', { plate: sc.plate, ...(fetchImpl ? { fetchImpl } : {}) });
      notes = [notes, place.label ? `Address: ${place.label}.` : '', terrain.note].filter(Boolean).join(' ');
    } catch (e) { log.push(`Terrain skipped: ${e.message}`); }
  }
  if (plan) lockSource = 'plan'; // designHouse reads the plan and locks the walls itself
  else if (lockToOutline && terrain && terrain.property && terrain.property.multi) {
    // the outline is the whole building; the model is one unit, so its walls come from the plan or photos
    log.push(`Walls not locked to the building outline: it looks like one unit of a larger building (${terrain.property.why.join('; ')}).`);
  } else if (lockToOutline && terrain) {
    const input = outlineInput(terrain, { frontStreet });
    if (input) {
      locked = footprintFromOutline({ ...input, size: sc.size, ftPerStud: sc.ftPerStud, frontYard: sc.frontYard, streetRows: sc.streetRows });
      lockSource = 'outline';
      log.push(`Walls locked to the building outline, ${input.front} at the front${input.side && locked.sideStreet ? `, ${input.side} on the ${locked.sideStreet.side}` : ''}.`);
      locked.problems.forEach((p) => log.push(`Outline: ${p}`));
    } else log.push('No building outline found; the walls come from the photos.');
  }
  return { notes, terrain, place, locked, lockSource, log };
}

module.exports = { prepareDesign };
