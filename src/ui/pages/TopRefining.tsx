import { useAppData } from '../context';
import { RankingView } from '../components/RankingView';

export function TopRefining() {
  const { rankings } = useAppData();
  return (
    <RankingView
      title="Top raffinage"
      intro="Les ressources raffinées les plus rentables, classées par argent espéré par jour selon vos réglages."
      rows={rankings?.refining ?? []}
      variant="ranked"
    />
  );
}
