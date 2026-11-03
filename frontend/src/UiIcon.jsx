import { MATERIAL_SYMBOL_PATHS, MATERIAL_SYMBOL_FILLED_PATHS } from './assets/materialSymbols';

// Icons are bundled SVGs, not remote fonts. Controls provide accessible names.
export default function UiIcon({ name, size = 20, className = '', filled = false }) {
  return <svg className={`ui-icon ${className}`.trim()} width={size} height={size} viewBox="0 -960 960 960"
    fill="currentColor" aria-hidden="true" focusable="false" data-icon={name}>
    <path d={(filled && MATERIAL_SYMBOL_FILLED_PATHS[name]) || MATERIAL_SYMBOL_PATHS[name] || MATERIAL_SYMBOL_PATHS.image} />
  </svg>;
}
