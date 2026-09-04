import type { SubNavItem } from '../../components/SubNav';

/**
 * The Assessments section's three views.
 *
 * Kept here rather than in one of the pages because all three import it, and a
 * tab strip that disagrees with itself between tabs is the specific bug this
 * shape exists to prevent. (The question bank's tabs are still declared in its
 * own two pages; they should move here too, but that is a separate change.)
 *
 * Why these are tabs and not three more slots in the top bar: the bar lists
 * *sections*, and a section with more than one view carries its own strip. Left
 * to grow, "Reports" and "Proctoring signals" would have sat beside
 * "Assessments" as though they were different parts of the product rather than
 * three ways of looking at the same one.
 */
export const ASSESSMENT_TABS: SubNavItem[] = [
  { to: '/admin/assessments', label: 'Assessments', end: true },
  { to: '/admin/reports', label: 'Reports' },
  { to: '/admin/proctoring', label: 'Proctoring signals' },
];
