import type { EntreeAccordClientLignes } from '@dfa/shared';

const LIBELLES_CANAL: Readonly<Record<EntreeAccordClientLignes['canal'], string>> = {
  telephone: 'téléphone',
  sms: 'SMS',
  email: 'courriel',
  comptoir: 'au comptoir',
  lien: 'lien de validation',
};

const FORMAT_HORODATE = new Intl.DateTimeFormat('fr-CH', {
  timeZone: 'Europe/Zurich',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Phrase de journal d'un accord client recueilli hors application — celle que `GET
 * /ordres-reparation/{orId}/journal` rend dans `motif` pour chaque ligne validée. Date et heure en
 * heure suisse (`jj.mm.aaaa hh:mm`) ; sans `horodate`, la phrase ne porte pas de date (l'entrée de
 * journal porte déjà son propre `survenuLe`, l'instant de l'enregistrement).
 */
export function phraseAccordClient(accord: EntreeAccordClientLignes): string {
  let phrase = `Accord du client : ${accord.nom} (${LIBELLES_CANAL[accord.canal]})`;
  if (accord.horodate) {
    const p = Object.fromEntries(
      FORMAT_HORODATE.formatToParts(new Date(accord.horodate)).map((x) => [x.type, x.value]),
    );
    phrase += `, le ${p['day']}.${p['month']}.${p['year']} à ${p['hour']}:${p['minute']}`;
  }
  phrase += '.';
  if (accord.commentaire) phrase += ` ${accord.commentaire}`;
  return phrase;
}
