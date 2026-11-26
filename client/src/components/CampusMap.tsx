/** Self-contained SVG campus map (no external map service). Coordinates are on a 0-100 grid. */
import { useI18n } from '../i18n';

export interface MapLocation { id: number; code: string; name_en: string; name_ar: string; kind: string; building: string; floor: number | null; map_x: number | null; map_y: number | null; directions_en: string; directions_ar: string }

const COLORS: Record<string, string> = { building: 'var(--c-primary)', hall: 'var(--c-accent-strong)', lab: '#3b6fd8', office: '#8a4fd1', service: '#5c6b66' };

export function CampusMap({ locations, selected, onSelect }: { locations: MapLocation[]; selected?: number | null; onSelect?: (id: number) => void }) {
  const { L, t } = useI18n();
  const pts = locations.filter((l) => l.map_x != null && l.map_y != null);
  return (
    <figure className="campus-map">
      <svg viewBox="0 0 100 100" role="img" aria-label={t.mapNote}>
        <rect x="0" y="0" width="100" height="100" rx="3" fill="var(--c-map-bg)" />
        <path d="M50 100 V60 M50 60 H25 M50 60 H75 M50 60 V20 M50 35 H25 M50 35 H75" stroke="var(--c-map-road)" strokeWidth="4" strokeLinecap="round" fill="none" />
        <circle cx="50" cy="60" r="4" fill="var(--c-map-green)" />
        <rect x="38" y="38" width="24" height="12" rx="1.5" fill="var(--c-map-block)" />
        <rect x="66" y="33" width="18" height="12" rx="1.5" fill="var(--c-map-block)" />
        <rect x="16" y="63" width="18" height="12" rx="1.5" fill="var(--c-map-block)" />
        <rect x="16" y="24" width="18" height="12" rx="1.5" fill="var(--c-map-block)" />
        <rect x="68" y="70" width="14" height="10" rx="1.5" fill="var(--c-map-block)" />
        {pts.map((l) => {
          const active = selected === l.id;
          return (
            <g key={l.id} transform={`translate(${l.map_x} ${l.map_y})`} className="map-pin" tabIndex={onSelect ? 0 : -1}
              role={onSelect ? 'button' : undefined} aria-label={L(l, 'name')} aria-pressed={active}
              onClick={() => onSelect?.(l.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(l.id); } }}>
              <circle r={active ? 3.4 : l.kind === 'building' ? 2.6 : 1.8} fill={COLORS[l.kind] ?? 'gray'} stroke="white" strokeWidth={active ? 0.9 : 0.5} />
              {(active || l.kind === 'building' || l.kind === 'service') && (
                <text y={-3.8} textAnchor="middle" fontSize="2.6" fontWeight={active ? 700 : 500} fill="var(--c-text)" stroke="var(--c-map-bg)" strokeWidth="0.6" paintOrder="stroke">{L(l, 'name')}</text>)}
            </g>);
        })}
      </svg>
      <figcaption className="muted small">{t.mapNote}</figcaption>
    </figure>);
}
