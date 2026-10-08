import { iconUrl } from '../format';

export function ItemIcon({ id, name, size = 32 }: { id: string; name: string; size?: number }) {
  return (
    <img
      className="item-icon"
      src={iconUrl(id, 64)}
      alt={name}
      loading="lazy"
      width={size}
      height={size}
      decoding="async"
    />
  );
}
