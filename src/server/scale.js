// Baseplate size and model scale. The 32 x 32 plate (Classic) is 2 ft per stud; the 48 x 48 plate (Grand) is
// 1.5 ft per stud, so the house is a third larger each way with room for yards, both streets of a corner
// lot, and detail (about 2,400 pieces). The 16 x 16 plate (Mini) is 4 ft per stud: the same stretch of lot as
// the Classic at half the detail, about 250 to 450 pieces. A course is 1.2 studs tall.
const SIZE_NAMES = { 16: 'Mini', 32: 'Classic', 48: 'Grand' };
// maxFtPerStud: how far a size's scale may stretch so a long or wide house fits whole (the site step picks the
// scale from the building's outline, between ftPerStud and this; a house that needs more is better on a bigger size).
const SCALES = {
  16: { plate: 16, ftPerStud: 4, maxFtPerStud: 5, target: 350, storyCourses: '2', frontYard: 0, streetRows: 1 },
  32: { plate: 32, ftPerStud: 2, maxFtPerStud: 3, target: 1200, storyCourses: '4', frontYard: 0, streetRows: 2 },
  48: { plate: 48, ftPerStud: 1.5, maxFtPerStud: 2, target: 2400, storyCourses: '5 or 6', frontYard: 3, streetRows: 2 },
};
// Courses in a story of about 9 ft at a scale (a course is 1.2 studs tall).
const storyCoursesAt = (ft) => Math.max(2, Math.round(9 / (1.2 * ft)));
// A size's numbers; ftPerStud, when given, is the scale the site step fitted for this house.
function scaleFor(plate, ftPerStud = null) {
  const s = SCALES[Number(plate)] || SCALES[32];
  const ft = Number(ftPerStud) > 0 ? Number(ftPerStud) : s.ftPerStud;
  return { ...s, ftPerStud: ft, fitted: ft !== s.ftPerStud, ...(ft !== s.ftPerStud ? { storyCourses: String(storyCoursesAt(ft)) } : {}),
    size: s.plate, last: s.plate - 1, ftPerCourse: 1.2 * ft, widthFt: s.plate * ft };
}
const sizeName = (plate) => SIZE_NAMES[Number(plate)] || 'Classic';
module.exports = { scaleFor, SCALES, sizeName, storyCoursesAt };
