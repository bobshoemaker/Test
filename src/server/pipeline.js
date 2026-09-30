// What happens before Claude designs, shared by the server and scripts/design.js, so every house
// goes through the same steps whatever it looks like and whatever the owner has:
//   - an address: geocode it; add the building, streets, lanes and slopes to the notes (terrain.js)
//   - a floor plan: the design loop reads the footprint off it and locks the walls to it
//   - no plan, with photos: find the house on an aerial photo, map it from above, fit the scale to it and
//     lock the walls to the map (site.js); this needs the renderer and a client
//   - failing that, a building outline from the address: lock the walls to the outline
//   - none of these: the walls come from the photos alone
const { lookupTerrain, outlineInput } = require('./terrain');
const { footprintFromOutline } = require('./footprint');
const { scaleFor } = require('./scale');

// What the design needs from a mapped site (and what a job keeps, so a resumed design uses the same walls).
const siteForDesign = (m) => ({ locked: m.locked, ftPerStud: m.fit.ftPerStud, note: m.siteNote, images: m.images, terrainNote: (m.terrain && m.terrain.note) || '',
  credits: m.credits, costUsd: m.costUsd, fit: { ...m.fit }, facts: m.facts, found: m.found || null });

// Returns {notes, terrain, place, locked, lockSource, log[], site?, report?}. Lookups are best effort: a failed
// geocode, map query or site step leaves the notes as they were and says why in log.
// site: a site mapped earlier (siteForDesign), reused as it is.
async function prepareDesign({ address = null, place = null, notes = '', plan = null, plate = 32, frontStreet = null,
  lockToOutline = true, geocode = null, fetchImpl, photos = [], views = [], client = null, model = null, siteModel = null,
  tools = null, onEvent = () => {}, site = null, mapSiteImpl = null } = {}) {
  const log = [], sc = scaleFor(plate);
  let terrain = null, locked = null, lockSource = null;
  if (site) {
    notes = [notes, site.terrainNote].filter(Boolean).join(' ');
    if (site.locked) log.push(`Walls locked to the map made earlier, at ${site.ftPerStud} ft per stud.`);
    return { notes, terrain: null, place, locked: site.locked || null, lockSource: site.locked ? 'site' : null, log, site };
  }
  if (address && !place) {
    try { place = await (geocode || require('./lookup').geocode)(address); } catch (e) { log.push(`Address lookup failed: ${e.message}`); }
    if (!place) log.push(`Address not found: ${address}`);
  }
  // find the house from above and map it (not for a floor plan, which says more, or a lookup without walls)
  if (place && !plan && lockToOutline && photos.length && client && tools && tools.drawLayers) {
    try {
      const mapSite = mapSiteImpl || require('./site').mapSite;
      const m = await mapSite({ address, place, photos, views, client, callClaude: require('./designer').callClaude, model, siteModel,
        plate: sc.plate, tools, onEvent, ...(fetchImpl ? { fetchImpl } : {}) });
      const s = siteForDesign(m);
      notes = [notes, place.label ? `Address: ${place.label}.` : '', s.terrainNote].filter(Boolean).join(' ');
      if (s.locked) log.push(`Walls locked to the map of the house, at ${s.ftPerStud} ft per stud.`);
      else log.push('The home looks like one unit of a larger building, so its walls come from the photos.');
      if (s.found && s.found.needsCheck) log.push(`Check the house: the building was ${s.found.confirmed === 'unconfirmed' ? 'not confirmed by county records' : 'picked'}, and the mapper says it ${s.found.matchesPhotos.answer === 'no' ? "doesn't match" : 'may not match'} the photos (${s.found.matchesPhotos.reason}).`);
      (s.locked ? s.locked.problems : []).forEach((p) => log.push(`Map: ${p}`));
      return { notes, terrain: m.terrain, place, locked: s.locked || null, lockSource: s.locked ? 'site' : null, log, site: s, report: m.report };
    } catch (e) { log.push(`Site mapping skipped: ${e.message}`); }
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

module.exports = { prepareDesign, siteForDesign };
