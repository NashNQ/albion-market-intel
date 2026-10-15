// Réglages de la guilde : nom, politique de prêt sur gage, sauvegarde / import des données de guilde.
import { useEffect, useId, useRef, useState } from 'react';
import { DEFAULT_GUILD_SETTINGS, MAX_GUILD_NAME, useGuildSettings, type GuildSettings } from '../../data/guildSettings';
import { applyBackup, backupFileName, buildBackup, parseBackup, type GuildBackup } from '../../data/guildBackup';
import { fmtClock, plural } from '../../format';

type PolicyKey = Exclude<keyof GuildSettings, 'guildName'>;

interface PolicyField {
  key: PolicyKey;
  label: string;
  suffix: string;
  /** Valeur stockée → valeur affichée (fractions en %). */
  pct: boolean;
  min: number;
  max: number;
  help: string;
}

const POLICY: PolicyField[] = [
  {
    key: 'maxLtv',
    label: 'Prêt maximal (LTV)',
    suffix: '% du gage',
    pct: true,
    min: 5,
    max: 100,
    help: 'Part de la valeur de revente rapide du gage que la guilde accepte de prêter. 60 % : un gage revendable 1 M ag permet d’emprunter 600 000 ag.',
  },
  {
    key: 'defaultRate',
    label: 'Intérêt par défaut',
    suffix: '%',
    pct: true,
    min: 0,
    max: 200,
    help: 'Intérêt forfaitaire proposé pour toute la durée du prêt (modifiable prêt par prêt).',
  },
  {
    key: 'safetyMargin',
    label: 'Marge de sécurité',
    suffix: '%',
    pct: true,
    min: 0,
    max: 90,
    help: 'Décote supplémentaire appliquée à la valeur prudente du gage, au cas où le prix chuterait avant une saisie.',
  },
  {
    key: 'maxTermDays',
    label: 'Durée maximale',
    suffix: 'jours',
    pct: false,
    min: 1,
    max: 90,
    help: 'Aucune date limite conseillée ne dépasse cette durée, même pour un gage au prix très stable.',
  },
];

const toDisplay = (f: PolicyField, v: number) => String(f.pct ? Math.round(v * 10000) / 100 : v);

function parseNum(s: string): number {
  const t = s.replace(/\s/g, '').replace(',', '.');
  return t === '' ? NaN : Number(t);
}

function NameField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const t = draft.trim();
    if (t && t !== value) onCommit(t);
    else setDraft(value);
  };
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        Nom de la guilde
      </label>
      <input
        id={id}
        className="g-name-input"
        value={draft}
        maxLength={MAX_GUILD_NAME}
        aria-describedby={`${id}-help`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      <p className="field-help" id={`${id}-help`}>
        Affiché dans l’en-tête du mode Guilde et dans les résumés à coller sur Discord.
      </p>
    </div>
  );
}

function PolicyInput({ f, value, onCommit }: { f: PolicyField; value: number; onCommit: (v: number) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(toDisplay(f, value));
  useEffect(() => setDraft(toDisplay(f, value)), [f, value]);
  const n = parseNum(draft);
  const invalid = !Number.isFinite(n) || n < f.min || n > f.max || (!f.pct && !Number.isInteger(n));
  const commit = () => {
    if (invalid) return;
    onCommit(f.pct ? n / 100 : n);
  };
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {f.label}
      </label>
      <span className="num-input">
        <input
          id={id}
          inputMode="decimal"
          value={draft}
          aria-invalid={invalid || undefined}
          aria-describedby={`${id}-help${invalid ? ` ${id}-err` : ''}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
        />
        <span className="suffix">{f.suffix}</span>
      </span>
      {invalid && (
        <p className="field-err" id={`${id}-err`}>
          Entre {f.min} et {f.max}
          {f.pct ? ' %' : ' jours (nombre entier)'}.
        </p>
      )}
      <p className="field-help" id={`${id}-help`}>
        {f.help}
      </p>
    </div>
  );
}

function download(name: string, text: string): boolean {
  try {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

function Backup({ guildName }: { guildName: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const [pending, setPending] = useState<{ backup: GuildBackup; duplicates: number; fileName: string } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (pending) confirmRef.current?.focus();
  }, [pending]);

  const doExport = () => {
    const b = buildBackup();
    const ok = download(backupFileName(guildName), JSON.stringify(b, null, 2));
    setMsg(
      ok
        ? {
            tone: 'ok',
            text: `Fichier exporté : ${plural(b.investments.length, 'investissement')}, ${plural(b.loans.length, 'prêt')} et les réglages.`,
          }
        : { tone: 'err', text: 'Le navigateur a bloqué le téléchargement.' },
    );
  };

  const onFile = async (file: File | undefined) => {
    setPending(null);
    setMsg(null);
    if (!file) return;
    let text = '';
    try {
      text = await readFileText(file);
    } catch {
      setMsg({ tone: 'err', text: 'Impossible de lire ce fichier.' });
      return;
    }
    const res = parseBackup(text);
    if (!res.ok) setMsg({ tone: 'err', text: res.error });
    else setPending({ backup: res.backup, duplicates: res.duplicates, fileName: file.name.slice(0, 80) });
    if (fileRef.current) fileRef.current.value = '';
  };

  const confirm = () => {
    if (!pending) return;
    const ok = applyBackup(pending.backup);
    const b = pending.backup;
    setPending(null);
    setMsg(
      ok
        ? { tone: 'ok', text: `Données importées : ${plural(b.investments.length, 'investissement')}, ${plural(b.loans.length, 'prêt')}, réglages de ${b.settings.guildName}.` }
        : { tone: 'err', text: 'Import incomplet : le stockage du navigateur est plein ou bloqué.' },
    );
  };

  const exportedLabel = (iso: string) => {
    if (!iso) return 'date inconnue';
    const d = new Date(iso);
    return `${d.toLocaleDateString('fr-FR')} à ${fmtClock(d)}`;
  };

  return (
    <section className="g-card" aria-labelledby="g-backup-t">
      <h2 id="g-backup-t">Sauvegarde des données de guilde</h2>
      <p className="g-explain">
        Investissements, prêts et réglages sont enregistrés <strong>dans ce navigateur uniquement</strong> : rien n’est
        envoyé sur un serveur. Pour partager les comptes avec un autre officier, exportez un fichier, envoyez-le-lui
        (Discord, message privé), et il l’importe ici. L’import <strong>remplace</strong> ses données par celles du
        fichier : décidez qui tient le registre à jour.
      </p>
      <div className="g-actions">
        <button type="button" className="btn g-btn-primary" onClick={doExport}>
          Exporter un fichier JSON
        </button>
        <label className="btn g-file" htmlFor={inputId}>
          Importer un fichier…
        </label>
        <input
          ref={fileRef}
          id={inputId}
          className="sr-only"
          type="file"
          accept="application/json,.json"
          aria-label="Importer un fichier de sauvegarde"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>
      {pending && (
        <div className="g-confirm" role="group" aria-labelledby="g-confirm-t">
          <p id="g-confirm-t" className="g-confirm-title">
            Remplacer les données de ce navigateur ?
          </p>
          <p>
            « {pending.fileName} », exporté le {exportedLabel(pending.backup.exportedAt)} :
          </p>
          <ul className="g-confirm-list">
            <li>{plural(pending.backup.investments.length, 'investissement')}</li>
            <li>{plural(pending.backup.loans.length, 'prêt')} sur gage</li>
            <li>réglages de la guilde « {pending.backup.settings.guildName} »</li>
            {pending.duplicates > 0 && <li>{plural(pending.duplicates, 'doublon')} ignoré(s)</li>}
          </ul>
          <div className="g-actions">
            <button ref={confirmRef} type="button" className="btn g-btn-danger" onClick={confirm}>
              Remplacer mes données
            </button>
            <button type="button" className="btn-ghost" onClick={() => setPending(null)}>
              Annuler
            </button>
          </div>
        </div>
      )}
      <p className={msg ? `g-msg g-msg-${msg.tone}` : 'g-msg'} role="status" aria-live="polite">
        {msg?.text}
      </p>
    </section>
  );
}

export function GuildSettingsPage() {
  const [settings, update, reset] = useGuildSettings();
  const isDefault = POLICY.every((f) => settings[f.key] === DEFAULT_GUILD_SETTINGS[f.key]);
  return (
    <section className="page page-narrow g-page" aria-labelledby="page-title">
      <header className="page-head">
        <p className="g-kicker">Mode Guilde</p>
        <h1 id="page-title">Réglages guilde</h1>
        <p className="page-intro">
          Règles communes aux outils des officiers de {settings.guildName}. Elles sont enregistrées dans ce navigateur et
          s’appliquent aussitôt aux prêts sur gage.
        </p>
      </header>

      <section className="g-card" aria-labelledby="g-ident-t">
        <h2 id="g-ident-t">Identité</h2>
        <NameField value={settings.guildName} onCommit={(guildName) => update({ guildName })} />
      </section>

      <section className="g-card" aria-labelledby="g-policy-t">
        <h2 id="g-policy-t">Politique de prêt sur gage</h2>
        <p className="g-explain">
          Un membre laisse un objet en gage et reçoit de l’argent ; s’il ne rembourse pas à la date limite, la guilde
          garde l’objet. Ces règles bornent le montant prêté et la durée.
        </p>
        <div className="settings-grid">
          {POLICY.map((f) => (
            <PolicyInput key={f.key} f={f} value={settings[f.key]} onCommit={(v) => update({ [f.key]: v })} />
          ))}
        </div>
        <div className="g-actions">
          <button type="button" className="btn-ghost" onClick={reset} disabled={isDefault && settings.guildName === DEFAULT_GUILD_SETTINGS.guildName}>
            Rétablir les valeurs par défaut
          </button>
        </div>
      </section>

      <Backup guildName={settings.guildName} />
    </section>
  );
}
