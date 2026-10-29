const PATHS = {
  home: 'm3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9',
  message: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2ZM7 9h10M7 13h6',
  cards: 'M8 3h11a2 2 0 0 1 2 2v12M5 7h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2ZM7 12h7M7 16h4',
  grid: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',
  chart: 'M4 3v17h17M8 16v-5M13 16V6M18 16V9',
  book: 'M12 5v16M3 4h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3Z',
  accessibility: 'M14 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM4 8l8 2 8-2M12 10v5M12 15l-5 6M12 15l5 6',
  check: 'm5 12 4 4L19 6',
  'check-square': 'M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8M8 10l4 4L21 3',
  key: 'M15 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM11 11v10M11 16h4M11 20h3',
  settings: 'M9 2h6v3l2 1 2.5-1.5 3 5-2.5 1.5v2l2.5 1.5-3 5L17 18l-2 1v3H9v-3l-2-1-2.5 1.5-3-5L4 13v-2L1.5 9.5l3-5L7 6l2-1ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2',
  users: 'M14 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM2 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2M18 3a4 4 0 0 1 0 8M18 14a5 5 0 0 1 4 5v2',
  shield: 'm12 2 9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6ZM8 12l3 3 5-6',
  reader: 'M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8 8a6 6 0 0 1 0 8M11 10a3 3 0 0 1 0 4M15 12h1',
  tag: 'M3 3h7l11 11-7 7L3 10ZM7 7h.01',
  volume: 'm11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14',
  'volume-off': 'm11 4-6 5H2v6h3l6 5ZM16 9l6 6M22 9l-6 6',
  'arrow-left': 'M20 12H4m6-6-6 6 6 6',
  'arrow-right': 'M4 12h16m-6-6 6 6-6 6',
  'arrow-up': 'M12 20V4m-6 6 6-6 6 6',
  'arrow-down': 'M12 4v16m-6-6 6 6 6-6',
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-right': 'm9 6 6 6-6 6',
  close: 'm6 6 12 12M18 6 6 18',
  undo: 'M3 10h11a6 6 0 0 1 0 12M3 10l5-5M3 10l5 5',
  refresh: 'M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-3l2 3M4 17l2 3a8 8 0 0 0 13-3',
  erase: 'm9 4 11 11-6 6H9L2 14ZM5.5 10.5l11 11M14 21h8',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z',
  text: 'm4 20 6-16 6 16M6 14h8M18 7h4M20 7v13',
  sequence: 'M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4',
  heart: 'M20.5 4.5a5 5 0 0 0-7 0L12 6l-1.5-1.5a5 5 0 0 0-7 7L12 20l8.5-8.5a5 5 0 0 0 0-7Z',
  image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM3 17l6-6 4 4 3-3 5 5M16 7h.01',
  logout: 'M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M9 12h12m-5-5 5 5-5 5',
  plus: 'M12 4v16M4 12h16',
};

// Interface icons are decorative; the surrounding control supplies its accessible name.
export default function UiIcon({ name, size = 20, className = '' }) {
  return <svg className={`ui-icon ${className}`.trim()} width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false"><path d={PATHS[name] || PATHS.image} /></svg>;
}
