import { useAppData } from '../context';
import { SettingsForm } from '../components/SettingsForm';

export function SettingsPage() {
  const { settings, updateSettings, resetSettings } = useAppData();
  return (
    <section className="page page-narrow" aria-labelledby="page-title">
      <header className="page-head">
        <h1 id="page-title">Réglages</h1>
        <p className="page-intro">
          Ces réglages s’appliquent à tous les classements et sont enregistrés dans ce navigateur. Les tableaux se
          recalculent aussitôt.
        </p>
      </header>
      <SettingsForm settings={settings} update={updateSettings} reset={resetSettings} />
    </section>
  );
}
