/** Animated New Ismailia National University logo (ring, shine, float). Motion stops under prefers-reduced-motion. */
import { useI18n } from '../i18n';

export function AnimatedLogo({ size = 'lg', label }: { size?: 'sm' | 'lg'; label?: string }) {
  const { t } = useI18n();
  return (
    <span className={`logo-anim ${size === 'sm' ? 'sm' : ''}`} role="img" aria-label={label ?? t.university}>
      <span className="logo-core"><img src="/brand/ninu-logo-192.png" alt="" width={192} height={192} /><span className="logo-shine" aria-hidden /></span>
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
