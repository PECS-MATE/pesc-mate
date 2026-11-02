import mascot from './assets/pecsmate-mascot.png';

export default function Mascot({ className = '' }) {
  return <img className={`mascot ${className}`} src={mascot} alt="" aria-hidden="true" width="128" height="128" draggable="false" />;
}

export function EmptyState({ children }) {
  return <div className="empty mascot-empty"><Mascot /><p>{children}</p></div>;
}
