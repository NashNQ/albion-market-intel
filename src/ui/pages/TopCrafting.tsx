import { useAppData } from '../context';
import { RankingView } from '../components/RankingView';

export function TopCrafting() {
  const { rankings } = useAppData();
  return (
    <RankingView
      title="Top craft"
      intro="Équipements, sacs et consommables à fabriquer, classés par argent espéré par jour selon vos réglages."
      rows={rankings?.crafting ?? []}
      variant="ranked"
    />
  );
}
