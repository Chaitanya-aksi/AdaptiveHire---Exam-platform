import { NavLink } from 'react-router-dom';

/**
 * The tab strip inside one section of the product.
 *
 * It exists to keep the top bar honest. Every page that needed reaching used to
 * be a top-level nav item, so "Question performance" sat beside "Question bank"
 * as though they were different parts of the product rather than two views of
 * the same one — and the bar grew a link every time anything was added. A
 * section that has more than one page owns its own tabs; the top bar lists
 * sections.
 */
export interface SubNavItem {
  to: string;
  label: string;
  /** Set on the index tab, so a child route does not light it up as well. */
  end?: boolean;
}

export function SubNav({ items }: { items: SubNavItem[] }) {
  return (
    <nav className="subnav" aria-label="Section">
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end}>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
