import { useCallback, useState } from 'react';
import { DEFAULT_SETTINGS, type Settings } from '../../types';

export const SETTINGS_KEY = 'ami.settings.v1';

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Fusionne une entrée arbitraire avec les défauts. Un nombre hors bornes est ramené à la borne
 * la plus proche ; une valeur absente, non numérique ou NaN revient au défaut.
 */
export function sanitizeSettings(raw: unknown): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  if (typeof r.premium === 'boolean') s.premium = r.premium;
  if (typeof r.focus === 'boolean') s.focus = r.focus;
  if (r.dailyBonus === 0 || r.dailyBonus === 0.1 || r.dailyBonus === 0.2) s.dailyBonus = r.dailyBonus;
  if (num(r.stationFee)) s.stationFee = clamp(r.stationFee, 0, 5000);
  if (r.mode === 'instant' || r.mode === 'orders') s.mode = r.mode;
  if (num(r.marketShare)) s.marketShare = clamp(r.marketShare, 0, 1);
  if (num(r.dailyCap)) s.dailyCap = Math.max(1, r.dailyCap);
  if (num(r.maxPriceAgeH)) s.maxPriceAgeH = clamp(r.maxPriceAgeH, 1, 48);
  if (num(r.minVolume)) s.minVolume = Math.max(0, r.minVolume);
  if (typeof r.historyFallback === 'boolean') s.historyFallback = r.historyFallback;
  return s;
}

function load(): Settings {
  try {
    const txt = window.localStorage.getItem(SETTINGS_KEY);
    return sanitizeSettings(txt ? JSON.parse(txt) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function save(s: Settings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* stockage indisponible : réglages en mémoire seulement */
  }
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void, () => void] {
  const [settings, setSettings] = useState<Settings>(load);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = sanitizeSettings({ ...prev, ...patch });
      save(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    const next = { ...DEFAULT_SETTINGS };
    try {
      window.localStorage.removeItem(SETTINGS_KEY);
    } catch {
      /* ignore */
    }
    setSettings(next);
  }, []);

  return [settings, update, reset];
}
