import { useAppData } from '../context';
import { RankingView } from '../components/RankingView';

export function BlackMarket() {
  const { rankings } = useAppData();
  return (
    <RankingView
      title="Black Market"
      intro="Objets à fabriquer puis revendre au Black Market de Caerleon, classés par profit par unité."
      rows={rankings?.blackMarket ?? []}
      variant="black-market"
      notice={
        <aside className="warn-box" role="note">
          <strong>À lire avant de vous lancer.</strong> Le Black Market ne publie aucun volume fiable : rien ne garantit
          que vos objets seront achetés, ni en quelle quantité. Caerleon se trouve en zone rouge, le transport peut se
          solder par la perte totale de la cargaison.
        </aside>
      }
    />
  );
}
