import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FiltreSite } from '@/composants/commun/FiltreSite';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useFiltreSite } from '@/hooks/site/useFiltreSite';
import { useSession } from '@/hooks/useSession';

import { peutVoirEquipePointage } from './droits';
import { SelecteurSitePointage } from './SelecteurSitePointage';
import { VueEquipePointage } from './VueEquipePointage';
import { VueJournalPointage } from './VueJournalPointage';

type VueGlobale = 'journal' | 'equipe';

function estVueGlobale(valeur: string | null): valeur is VueGlobale {
  return valeur === 'journal' || valeur === 'equipe';
}

/**
 * Écran de pointage unifié — Lot D de la refonte de navigation (`docs/refonte-navigation.md`,
 * §1 point 5 et §5). Fusionne les anciens `EcranJournalPointage` et `EcranEquipePointage`, que le
 * diagnostic de la refonte relevait comme appelant tous deux `useListePointages`, même site, même
 * fenêtre du jour — deux entrées de menu pour une seule donnée.
 *
 * VÉRIFIÉ avant la fusion (consigne explicite du mandat) : le constat tient pour la SOURCE de
 * données, mais les deux écrans portaient chacun des capacités que l'autre n'avait pas — rien de
 * tout cela n'est perdu ici, seulement rangé différemment :
 *  - Journal (désormais `VueJournalPointage`) : bascule jour/semaine, cumuls par technicien ET
 *    total de la période — absent d'Équipe.
 *  - Équipe (désormais `VueEquipePointage`) : liste brute + vue « par OR » (temps réel vs facturé),
 *    correction manuelle d'un pointage (`atelier.pointage.corriger_autrui`) — absent de Journal.
 *  - Droits : Journal reste ouvert à tout rôle qui pointe (`ROLES_POINTAGE` — technicien, magasinier
 *    inclus, restriction serveur à ses propres pointages), Équipe reste réservée à l'encadrement
 *    (`ROLES_POINTAGE_ENCADREMENT`). La fusion NE change PAS ce périmètre : l'onglet « Équipe »
 *    n'est simplement pas monté pour qui n'y a pas droit (absent du DOM, jamais grisé) — un rôle
 *    sans vue équipe atterrit directement sur `VueJournalPointage`, sans les onglets globaux.
 *
 * Gate de site UNIQUE ici — auparavant dupliquée trois fois à l'identique (Journal, Équipe,
 * Clôture de période avaient chacun leur propre bloc `if (!siteId)`). Les vues reçoivent `siteId`
 * déjà résolu, jamais `undefined`.
 *
 * Lot E (même document) : la clôture de période (RM-95, ex-écran séparé `EcranCloturePeriodePointage`)
 * est devenue une action de la vue Équipe (`DialogueCloturePeriode`, monté par `VueEquipePointage`)
 * — « on clôture ce qu'on regarde ».
 *
 * SIGNALEMENT (hors périmètre d'écriture de ce module — `routes/` appartient à un autre chantier) :
 * `routes/routeur.tsx` monte encore `pointage/jour`, `pointage/equipe` et `pointage/cloture` comme
 * trois routes distinctes sur les anciens composants (`chemins.ts` : `pointage.jour()`,
 * `pointage.equipe()`, `pointage.cloture()`). Il faudra les faire pointer sur CET écran unique
 * (`EcranPointage`, garde `rolesAutorises={ROLES_POINTAGE}` — le plus large des deux gardes
 * actuelles, puisque `EcranPointage` gère lui-même la restriction interne de l'onglet Équipe) et
 * retirer `pointage.cloture()` de `chemins.ts` (son geste vit maintenant dans Équipe). Un paramètre
 * `?vue=journal|equipe` est déjà supporté ici pour un lien direct vers l'un ou l'autre.
 */
export function EcranPointage() {
  const { t } = useTranslation(['pointage', 'commun']);
  const { data: session } = useSession();
  const actions = session?.actions;

  const [searchParams, setSearchParams] = useSearchParams();
  // Même mécanique de site que les autres écrans : site principal par défaut, choix mémorisé,
  // `?site=` d'un lien profond respecté. Les vues Journal/Équipe/Clôture travaillent sur UN site
  // (`siteObligatoire`) : pas de « Tous ».
  const filtreSite = useFiltreSite('pointage', { siteObligatoire: true });
  const siteId = filtreSite.siteId;

  const vueEquipe = peutVoirEquipePointage(actions);
  const vueParam = searchParams.get('vue');
  const vue: VueGlobale = vueEquipe && estVueGlobale(vueParam) ? vueParam : 'journal';

  function changerVue(valeur: VueGlobale) {
    const parametres = new URLSearchParams(searchParams);
    parametres.set('vue', valeur);
    setSearchParams(parametres);
  }

  if (!siteId) {
    return (
      <GabaritEcran titre={t('pointage:titre')}>
        <SelecteurSitePointage onChoisir={(valeur) => filtreSite.choisir(valeur)} />
      </GabaritEcran>
    );
  }

  return (
    <GabaritEcran titre={t('pointage:titre')}>
      <FiltreSite filtre={filtreSite} />
      {vueEquipe ? (
        <Tabs value={vue} onValueChange={(valeur) => changerVue(valeur as VueGlobale)}>
          <TabsList>
            <TabsTrigger value="journal">{t('pointage:vues.journal')}</TabsTrigger>
            <TabsTrigger value="equipe">{t('pointage:vues.equipe')}</TabsTrigger>
          </TabsList>
          <TabsContent value="journal" className="pt-4">
            <VueJournalPointage siteId={siteId} />
          </TabsContent>
          <TabsContent value="equipe" className="pt-4">
            <VueEquipePointage siteId={siteId} actions={actions} />
          </TabsContent>
        </Tabs>
      ) : (
        <VueJournalPointage siteId={siteId} />
      )}
    </GabaritEcran>
  );
}
