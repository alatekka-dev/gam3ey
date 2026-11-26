/**
 * Animated New Ismailia National University logo.
 * The official logo is split into layers (scripts/split-logo.py) so its parts move independently:
 * the ship scene bobs inside the porthole, the waves drift, the olive branches sway, light runs
 * around the gold ring and sweeps across the emblem. Everything stops under prefers-reduced-motion.
 */
import { useI18n } from '../i18n';

const L = '/brand/logo/';

export function AnimatedLogo({ size = 'lg', label }: { size?: 'sm' | 'lg'; label?: string }) {
  const { t } = useI18n();
  return (
    <span className={`nl ${size === 'sm' ? 'nl-sm' : 'nl-lg'}`} role="img" aria-label={label ?? t.university}>
      <span className="nl-halo" aria-hidden />
      <span className="nl-disc" aria-hidden />
      <span className="nl-art" aria-hidden>
        <span className="nl-glow" />
        <span className="nl-porthole">
          <img className="nl-scene" src={`${L}scene.webp`} alt="" draggable={false} />
          <span className="nl-sunlight" />
        </span>
        <img className="nl-base" src={`${L}base.webp`} alt="" draggable={false} />
        <span className="nl-ring-light" />
        <img className="nl-waves" src={`${L}waves.webp`} alt="" draggable={false} />
        <img className="nl-leaf nl-leaf-l" src={`${L}leaves-left.webp`} alt="" draggable={false} />
        <img className="nl-leaf nl-leaf-r" src={`${L}leaves-right.webp`} alt="" draggable={false} />
        <span className="nl-sweep" />
      </span>
    </span>);
}

export function Splash() {
  const { t } = useI18n();
  return (
    <div className="splash" role="status" aria-live="polite">
      <AnimatedLogo />
      <div className="splash-title">{t.brand} · GAM3EY</div>
      <div className="splash-sub">{t.university}</div>
      <div className="splash-bar" aria-hidden />
    </div>);
}
