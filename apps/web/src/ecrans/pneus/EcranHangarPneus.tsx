import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import type { ReponseDepotPneus, SaisonPneu } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { EtatVideFiltre } from '@/composants/motifs/EtatVideFiltre';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { EtatVideRecherche } from '@/composants/motifs/EtatVideRecherche';
import { useHangarPneus } from '@/hooks/pneus/useHangarPneus';
import { useRechercheHangarPneus } from '@/hooks/pneus/useRechercheHangarPneus';
import { useSession } from '@/hooks/useSession';
import { chemins } from '@/routes/chemins';

import { CarteJeuPneu } from './composants/CarteJeuPneu';
import { DialogueChangerSaisonPneu } from './DialogueChangerSaisonPneu';
import { DialogueNouveauDepotPneu } from './DialogueNouveauDepotPneu';
import { DialogueSortirDepotPneu } from './DialogueSortirDepotPneu';
import { peutGererDepotPneus } from './droits';

type FiltreStatutHangar = 'actifs' | 'a_relancer';

const STATUTS_PAR_FILTRE: Record<FiltreStatutHangar, readonly ('en_depot' | 'a_relancer')[]> = {
  // « Physiquement dans le hangar » (RPP-04) : `en_depot` + `a_relancer` — `monte` est sur le
  // véhicule, `sorti` n'y est plus (voir le commentaire de tête ci-dessous).
  actifs: ['en_depot', 'a_relancer'],
  a_relancer: ['a_relancer'],
};

/**
 * Hangar à pneus (Lot B, `docs/specification-parc-et-hangar-pneus.md` §5-6) — « retrouver un jeu
 * de pneus en deux secondes » (exigence @laupernoe).
 *
 * DEUX mécanismes de recherche distincts, volontairement pas fusionnés en un seul champ magique :
 *  1. **Plaque / nom client** (`useRechercheHangarPneus`) — réutilise `GET /recherche`, déjà
 *     indexé serveur ; peut trouver un jeu MÊME s'il n'est pas dans la page actuellement chargée
 *     du plan (ex. jeu `monté`, donc absent du plan par défaut — voir plus bas). C'est LE geste
 *     rapide visé par l'exigence.
 *  2. **Repère du hangar** (`codeCase`) — filtre LOCAL, instantané, sur les jeux déjà chargés à
 *     l'écran : aucun endpoint ne permet de chercher par `codeCase` côté serveur (le contrat livré
 *     ne l'expose pas), donc ce filtre ne porte que sur la page courante — acceptable ici, le plan
 *     par défaut charge déjà tout ce qui est physiquement dans le hangar (voir `BoutonChargerPlus`
 *     pour aller au-delà de la première page).
 *
 * GAP SIGNALÉ (voir aussi `useRechercheHangarPneus.ts`) : le plan par défaut n'enrichit PAS
 * chaque case avec la plaque/le client — `GET /sites/{siteId}/hangar-pneus` ne rend que
 * `vehiculeId` (voir `packages/shared/src/contrats/pneus/depot-pneus.ts`), et résoudre les N
 * véhicules d'une page de 50 en N requêtes systématiques à chaque chargement du plan serait un
 * coût réseau significatif pour un gain limité (le `codeCase` identifie déjà la case ; la plaque
 * ne sert qu'à CONFIRMER qu'on a la bonne, ce que `CarteJeuPneu` offre via le lien « Voir le
 * véhicule »). La recherche par plaque/client (mécanisme 1 ci-dessus), elle, enrichit exactement
 * les quelques candidats trouvés — coût borné, pas de N+1 systématique.
 *
 * GAP SIGNALÉ (API) : aucun endpoint ne permet de MODIFIER `codeCase` après la création d'un
 * dépôt (`schemaChangementSaisonDepotPneus`/`schemaSortieDepotPneus` ne portent pas ce champ) —
 * l'exigence « l'emplacement physique... doit être... modifiable simplement » n'est donc
 * réalisable qu'À LA CRÉATION (`DialogueNouveauDepotPneu`). Un `PATCH /depots-pneus/{id}` dédié
 * (codeCase, etat) comblerait ce manque ; non ajouté ici (hors périmètre d'écriture, l'API n'est
 * pas dans mon périmètre pour cette tâche).
 */
export function EcranHangarPneus() {
  const { t } = useTranslation(['pneus', 'commun', 'erreurs']);
  const [searchParams, setSearchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const {
    data: session,
    isPending: sessionEnChargement,
    isError: sessionEnErreur,
    refetch: relancerSession,
  } = useSession();
  const role = session?.utilisateur.role;
  const peutGerer = peutGererDepotPneus(role);

  const [filtreStatut, setFiltreStatut] = useState<FiltreStatutHangar>('actifs');
  const [filtreSaison, setFiltreSaison] = useState<SaisonPneu | 'toutes'>('toutes');
  const [filtreRepere, setFiltreRepere] = useState('');
  const [depotChangementSaison, setDepotChangementSaison] = useState<ReponseDepotPneus | null>(
    null,
  );
  const [depotSortie, setDepotSortie] = useState<ReponseDepotPneus | null>(null);
  const [creationOuverte, setCreationOuverte] = useState(false);

  const recherche = useRechercheHangarPneus();

  const hangar = useHangarPneus(site, {
    statut: STATUTS_PAR_FILTRE[filtreStatut],
    saison: filtreSaison === 'toutes' ? undefined : filtreSaison,
    tri: 'dernierMouvementLe:desc',
  });

  const depotsFiltres =
    filtreRepere.trim() === ''
      ? hangar.depots
      : hangar.depots.filter((depot) =>
          (depot.codeCase ?? '').toLowerCase().includes(filtreRepere.trim().toLowerCase()),
        );

  if (sessionEnChargement) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pneus:hangar.titre')}</h1>
        <EtatChargement lignes={4} />
      </div>
    );
  }

  if (sessionEnErreur) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pneus:hangar.titre')}</h1>
        <EtatErreur
          titre={t('pneus:hangar.erreur.titre')}
          description={t('erreurs:inattendue.description')}
          onReessayer={() => void relancerSession()}
        />
      </div>
    );
  }

  const sites = (session?.sites ?? []).filter((s) => s.actif);

  if (!site) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-6">
        <h1 className="sr-only">{t('pneus:hangar.titre')}</h1>
        <EtatVide
          titre={t('pneus:hangar.siteRequis.titre')}
          description={t('pneus:hangar.siteRequis.description')}
          action={
            sites.length > 0 ? (
              <Select
                onValueChange={(siteId) => {
                  // Copie les paramètres EXISTANTS plutôt que de les remplacer (même patron que
                  // `EcranTableauBord.changerSite`) : `setSearchParams({ site })` écraserait tout
                  // autre paramètre déjà présent dans l'URL.
                  const parametres = new URLSearchParams(searchParams);
                  parametres.set('site', siteId);
                  setSearchParams(parametres);
                }}
              >
                <SelectTrigger aria-label={t('pneus:hangar.siteRequis.label')} className="w-64">
                  <SelectValue placeholder={t('pneus:hangar.siteRequis.label')} />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.nom}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pneus:hangar.titre')}</h1>
        {peutGerer ? (
          <Button type="button" onClick={() => setCreationOuverte(true)}>
            {t('pneus:creation.actions.ouvrir')}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pneus-recherche-plaque-client">
          {t('pneus:hangar.recherche.champLabel')}
        </Label>
        <Input
          id="pneus-recherche-plaque-client"
          value={recherche.saisie}
          placeholder={t('pneus:hangar.recherche.champPlaceholder')}
          onChange={(evenement) => recherche.onSaisieChange(evenement.target.value)}
        />
      </div>

      {recherche.actif ? (
        <div className="flex flex-col gap-4">
          {recherche.enErreur ? (
            <EtatErreur
              titre={t('pneus:hangar.recherche.erreur.titre')}
              description={messageErreur(recherche.erreur, t)}
              onReessayer={recherche.relancer}
            />
          ) : recherche.enChargement ? (
            <EtatChargement lignes={3} />
          ) : recherche.jeux.length === 0 ? (
            <EtatVideRecherche
              titre={t('pneus:hangar.recherche.aucunResultat.titre')}
              description={t('pneus:hangar.recherche.aucunResultat.description')}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recherche.jeux.map(({ depot, candidat }) => (
                <CarteJeuPneu
                  key={depot.id}
                  depot={depot}
                  identification={{
                    plaque: candidat.plaque,
                    designation: candidat.designation,
                    clientNom: candidat.clientNom,
                  }}
                  site={site}
                  peutGerer={peutGerer}
                  onChangerSaison={setDepotChangementSaison}
                  onSortir={setDepotSortie}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pneus-filtre-statut">{t('pneus:hangar.filtres.statut')}</Label>
              <Select
                value={filtreStatut}
                onValueChange={(valeur) => setFiltreStatut(valeur as FiltreStatutHangar)}
              >
                <SelectTrigger id="pneus-filtre-statut" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="actifs">{t('pneus:hangar.filtres.statutActifs')}</SelectItem>
                  <SelectItem value="a_relancer">
                    {t('pneus:hangar.filtres.statutARelancer')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pneus-filtre-saison">{t('pneus:hangar.filtres.saison')}</Label>
              <Select
                value={filtreSaison}
                onValueChange={(valeur) => setFiltreSaison(valeur as SaisonPneu | 'toutes')}
              >
                <SelectTrigger id="pneus-filtre-saison" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="toutes">{t('pneus:hangar.filtres.saisonToutes')}</SelectItem>
                  <SelectItem value="ete">{t('pneus:saison.ete')}</SelectItem>
                  <SelectItem value="hiver">{t('pneus:saison.hiver')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pneus-filtre-repere">{t('pneus:hangar.filtres.repere')}</Label>
              <Input
                id="pneus-filtre-repere"
                value={filtreRepere}
                placeholder={t('pneus:hangar.filtres.reperePlaceholder')}
                className="w-48"
                onChange={(evenement) => setFiltreRepere(evenement.target.value)}
              />
            </div>
          </div>

          {hangar.isPending ? (
            <EtatChargement lignes={6} />
          ) : hangar.isError ? (
            <EtatErreur
              titre={t('pneus:hangar.erreur.titre')}
              description={messageErreur(hangar.error, t)}
              onReessayer={() => void hangar.refetch()}
            />
          ) : depotsFiltres.length === 0 ? (
            filtreRepere.trim() !== '' ? (
              <EtatVideFiltre
                titre={t('pneus:hangar.vide.titre')}
                description={t('pneus:hangar.vide.filtreDescription')}
                onEffacerFiltres={() => setFiltreRepere('')}
              />
            ) : filtreStatut === 'a_relancer' ? (
              <EtatVideFiltre
                titre={t('pneus:hangar.vide.titre')}
                description={t('pneus:hangar.vide.aucunARelancer')}
                onEffacerFiltres={() => setFiltreStatut('actifs')}
              />
            ) : (
              <EtatVidePremierUsage
                titre={t('pneus:hangar.vide.titre')}
                description={t('pneus:hangar.vide.premierUsage')}
                action={
                  peutGerer ? (
                    <Button type="button" onClick={() => setCreationOuverte(true)}>
                      {t('pneus:creation.actions.ouvrir')}
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {depotsFiltres.map((depot) => (
                  <CarteJeuPneu
                    key={depot.id}
                    depot={depot}
                    site={site}
                    peutGerer={peutGerer}
                    onChangerSaison={setDepotChangementSaison}
                    onSortir={setDepotSortie}
                  />
                ))}
              </div>
              <BoutonChargerPlus
                aChargerPlus={Boolean(hangar.hasNextPage)}
                enChargement={hangar.isFetchingNextPage}
                onChargerPlus={() => void hangar.fetchNextPage()}
              />
            </>
          )}

          <p className="texte-libelle text-muted-foreground">
            {t('pneus:hangar.lienARelancer.description')}{' '}
            <Link to={chemins.pneus.aRelancer(site)} className="font-medium text-primary underline">
              {t('pneus:hangar.lienARelancer.lien')}
            </Link>
          </p>
        </>
      )}

      <DialogueChangerSaisonPneu
        depot={depotChangementSaison}
        onFerme={() => setDepotChangementSaison(null)}
      />
      <DialogueSortirDepotPneu depot={depotSortie} onFerme={() => setDepotSortie(null)} />
      <DialogueNouveauDepotPneu
        siteId={site}
        ouvert={creationOuverte}
        onFerme={() => setCreationOuverte(false)}
      />
    </div>
  );
}
