/** How far (px) a row must be swiped before letting go triggers the action. */
export const SWIPE_TRIGGER = 80;

/**
 * Which action a horizontal swipe of `dx` pixels triggers. Swiping towards the start of the line
 * deletes, towards the end edits: left to delete / right to edit, mirrored in right-to-left.
 */
export function swipeAction(dx: number, rtl: boolean): 'delete' | 'edit' | null {
  if (Math.abs(dx) < SWIPE_TRIGGER) return null;
  const towardsStart = rtl ? dx > 0 : dx < 0;
  return towardsStart ? 'delete' : 'edit';
}
