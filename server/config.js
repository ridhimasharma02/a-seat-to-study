// Booking rules and demo data. Everything here is a design decision for the prototype,
// not an official LPU rule or a real seat count.

export const MIN = 60 * 1000;

export const RULES = {
  CHECKIN_EARLY_MIN: 10,   // you can check in up to 10 minutes before your slot starts
  CHECKIN_GRACE_MIN: 15,   // not checked in 15 minutes after the start? the seat is released
  BREAK_MAX_MIN: 20,       // a break keeps your seat for up to 20 minutes
  DURATIONS_MIN: [60, 90, 120, 150, 180],
  MAX_ACTIVE_BOOKINGS: 2,  // per student, and they can't overlap
  BOOK_AHEAD_HOURS: 48,
};

// Demo logins, created when the database is first set up.
// Students log in with their registration number; staff log in on the separate staff page with a Staff ID.
export const DEMO_ACCOUNTS = {
  student: { reg_no: '12345678', name: 'Demo Student', password: 'study1234' },
};
export const STAFF_ACCOUNTS = [
  { staff_id: 'LIB001', name: 'Library Desk', title: 'Librarian', password: 'staff1234' },
  { staff_id: 'LIB002', name: 'Reading Hall Desk', title: 'Reading hall attendant', password: 'staff1234' },
  { staff_id: 'MNT001', name: 'Maintenance Desk', title: 'Maintenance (sockets and furniture)', password: 'staff1234' },
];

// Study spaces. Seat counts for the two main library floors follow the team's paper prototype.
// `base` is how busy the space usually is at its peak (used by the demo activity).
export const SPACES = [
  { id: 'cl-ground', name: 'Central Library', area: 'Ground Floor', block: 'Block 37', kinds: ['library'],
    layout: 'tables6', count: 20, cols: 5, base: 0.62, blurb: 'Main reading hall with shared tables for six.' },
  { id: 'cl-first', name: 'Central Library', area: 'First Floor', block: 'Block 37', kinds: ['library'],
    layout: 'tables4', count: 20, cols: 5, base: 0.55, blurb: 'Smaller tables for four.' },
  { id: 'cl-quiet', name: 'Central Library', area: 'Second Floor · Quiet Reading', block: 'Block 37', kinds: ['library', 'quiet'],
    layout: 'carrels', count: 48, cols: 8, base: 0.78, blurb: 'Single study carrels. Silent zone.' },
  { id: 'ab-hall', name: 'Academic Block', area: 'Study Hall', block: 'Academic Block', kinds: ['academic'],
    layout: 'tables6', count: 10, cols: 5, base: 0.35, blurb: 'Open study hall near the classrooms.' },
  { id: 'group-rooms', name: 'Group Study Rooms', area: 'Central Library · First Floor', block: 'Block 37', kinds: ['library', 'group'],
    layout: 'rooms', count: 6, cols: 3, capacity: 6, base: 0.5, blurb: 'Bookable rooms for up to six people.' },
];

// How busy each hour of the day is, relative to the peak (index = hour, 0-23).
export const HOUR_CURVE = [
  0.08, 0.06, 0.05, 0.05, 0.05, 0.06, 0.12, 0.22, 0.38, 0.5, 0.6, 0.65,
  0.6, 0.55, 0.62, 0.7, 0.8, 0.9, 0.98, 1, 0.95, 0.82, 0.6, 0.3,
];

export function targetShare(base, hour) {
  return Math.min(0.95, Math.max(0.03, base * HOUR_CURVE[hour] * 1.25));
}
