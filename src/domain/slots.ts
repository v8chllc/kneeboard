/**
 * Repeating INS memory slots.
 *
 * Governed by `docs/tracker-behavior.md` §Memory slots.
 */

/** INS memory slots repeat from 1 through 9. */
export const SLOT_COUNT = 9;

/**
 * A memory slot number. Derived for every eligible fix from its position in the
 * eligible sequence: `slot = ((eligible index - 1) mod 9) + 1`. Only Skip and
 * the SID/STAR inclusion controls renumber; Save and Pass never do.
 */
export type SlotNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * Whether a slot may be written.
 *
 * A slot is `free` when it has never been written, or when it holds a passed
 * fix that is not the most recently passed one. The most recently passed fix is
 * the active leg's FROM waypoint and keeps its slot, so slot release is
 * deferred by one Pass.
 */
export type SlotAvailability = "free" | "occupied";
