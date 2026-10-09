import { useFavorites } from '../data/favorites';
import '../favorites.css';

interface Props {
  id: string;
  /** Nom affiché dans l'infobulle (facultatif). */
  name?: string;
  size?: 'sm' | 'md';
}

/** Étoile favori : bouton bascule (aria-pressed), état partagé par toute l'application. */
export function FavoriteButton({ id, name, size = 'sm' }: Props) {
  const { has, toggle, full } = useFavorites();
  const on = has(id);
  const blocked = !on && full;
  const label = on ? 'Retirer des favoris' : 'Ajouter aux favoris';
  const title = blocked ? 'Limite de 200 favoris atteinte' : name ? `${label} : ${name}` : label;
  return (
    <button
      type="button"
      className={`fav-btn fav-${size}${on ? ' is-on' : ''}`}
      aria-pressed={on}
      aria-label={label}
      title={title}
      disabled={blocked}
      onClick={() => toggle(id)}
    >
      <svg viewBox="0 0 24 24" width={size === 'md' ? 20 : 16} height={size === 'md' ? 20 : 16} aria-hidden="true" focusable="false">
        <path
          className="fav-star"
          d="M12 2.8l2.83 5.73 6.33.92-4.58 4.46 1.08 6.3L12 17.23l-5.66 2.98 1.08-6.3-4.58-4.46 6.33-.92z"
        />
      </svg>
    </button>
  );
}
