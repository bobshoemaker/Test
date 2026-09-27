// Baseplate size and model scale. The 32 x 32 plate is 2 ft per stud; the 48 x 48 plate is 1.5 ft
// per stud, so the house is a third larger each way with room for yards, both streets of a corner
// lot, and detail (about 2,400 pieces). A course is 1.2 studs tall.
const SCALES = {
  32: { plate: 32, ftPerStud: 2, target: 1200, storyCourses: '4', frontYard: 0 },
  48: { plate: 48, ftPerStud: 1.5, target: 2400, storyCourses: '5 or 6', frontYard: 3 },
};
function scaleFor(plate) {
  const s = SCALES[Number(plate)] || SCALES[32];
  return { ...s, size: s.plate, last: s.plate - 1, ftPerCourse: 1.2 * s.ftPerStud, widthFt: s.plate * s.ftPerStud };
}
module.exports = { scaleFor, SCALES };
