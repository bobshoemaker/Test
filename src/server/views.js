// Which view each photo shows, from the upload page's checklist (views[i] for photos[i]; extras have none).
// Only the known views count, numbered as the photos are once invalid ones are dropped (cleanPhotos).
const VIEWS = { front: 'the front of the house, straight on', left: 'the front left corner', right: 'the front right corner', back: 'the back',
  aerial: 'the house from above' }; // aerial: a view our team adds before the design (the owner's checklist has the first four)
const okPhoto = (p) => !!p && /^image\/(jpeg|png|webp|gif)$/.test(p.mediaType) && typeof p.data === 'string';
// The views of the photos that are kept: [key or null], aligned with the cleaned photos.
function cleanViews(photos, views, max = 12) {
  if (!Array.isArray(views)) return (photos || []).slice(0, max).filter(okPhoto).map(() => null);
  return (photos || []).slice(0, max).map((p, i) => (okPhoto(p) ? (VIEWS[views[i]] ? views[i] : null) : undefined)).filter((v) => v !== undefined);
}
// A sentence for the design: "The owner says photo 1 shows the front of the house, straight on, ..."
function viewsNote(photos, views, max = 12) {
  if (!Array.isArray(views)) return '';
  const said = cleanViews(photos, views, max).map((v, i) => (v ? `photo ${i + 1} shows ${VIEWS[v]}` : null)).filter(Boolean);
  return said.length ? `The owner says ${said.join(', ')} (left and right as seen from the street).` : '';
}
// "photo 1 (the front of the house, straight on), photo 2, ..." for the site steps
const photoList = (count, views = []) => Array.from({ length: count }, (_, i) => `photo ${i + 1}${views[i] && VIEWS[views[i]] ? ` (${VIEWS[views[i]]})` : ''}`).join(', ');
module.exports = { VIEWS, okPhoto, cleanViews, viewsNote, photoList };
