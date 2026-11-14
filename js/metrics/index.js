// Publieke ingang van de kerncijfers en de kostenraming (pure functies, geen DOM).
export { kerncijfers, brutoNiveau, dakOppervlak, isPlatDak, openingM2 } from './kerncijfers.js';
export { raming, leesPrijzen, btwTekst, POSTEN, POST_SLEUTELS, DISCLAIMER } from './kosten.js';
export {
  vergelijkingsRijen, naarCsv, csvGetal, fmtGetal, fmtM2, fmtM3, fmtBedrag, fmtEenheidsprijs, fmtWaarde, fmtDelta,
} from './vergelijk.js';
