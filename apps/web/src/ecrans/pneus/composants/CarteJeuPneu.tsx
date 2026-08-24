import { MapPin } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { ReponseDepotPneus } from '@dfa/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formaterDate } from '@/lib/formats';
import { cn } from '@/lib/utils';
import { chemins } from '@/routes/chemins';

import { BadgeSaisonPneu } from './BadgeSaisonPneu';
import { BadgeStatutDepotPneu } from './BadgeStatutDepotPneu';

/** Identification du véhicule/client — connue seulement quand la carte vient d'un résultat de
 *  recherche (`useRechercheHangarPneus`, déjà enrichi) ; ABSENTE dans le plan par défaut du
 *  hangar (`GET /sites/{siteId}/hangar-pneus` ne rend que `vehiculeId`, voir le commentaire de
 *  tête de `EcranHangarPneus.tsx` — pas de N+1 systématique sur chaque case du plan). */
export interface IdentificationJeuPneu {
  readonly plaque: string | null;
  readonly designation: string | null;
  readonly clientNom: string | null;
}

interface Props {
  readonly depot: ReponseDepotPneus;
  readonly identification?: IdentificationJeuPneu;
  readonly site?: string;
  /** Droits PAR ACTION, calqués un à un sur `apps/api/src/auth/matrice-droits.ts`
   *  (`ENTREE_PNEUS`/`SORTIE_PNEUS`) — DÉFAUT CORRIGÉ : un seul booléen `peutGerer` gouvernait
   *  auparavant les trois boutons ci-dessous alors que le serveur distingue deux périmètres
   *  (`technicien`/`magasinier` ont `changer_saison`/`deplacer` mais PAS `sortir`). Voir
   *  `ecrans/pneus/droits.ts` pour le détail de chaque liste de rôles. */
  readonly peutChangerSaison: boolean;
  readonly peutDeplacer: boolean;
  readonly peutSortir: boolean;
  /** Vrai quand ce jeu est celui ciblé par `?depot=` (venu d'un lien externe, ex. la fiche
   *  véhicule — voir le commentaire de tête d'`EcranHangarPneus.tsx`). Fait défiler la carte à
   *  l'écran ET la place au clavier/lecteur d'écran (`focus()` sur un conteneur `tabIndex={-1}`,
   *  MÊME patron que le lien d'évitement d'`AppShell.tsx`) : un simple contour de couleur serait
   *  invisible pour un lecteur d'écran, d'où aussi le badge textuel ci-dessous — la couleur seule
   *  ne porte jamais l'information dans ce dépôt. */
  readonly misEnEvidence?: boolean;
  readonly onChangerSaison: (depot: ReponseDepotPneus) => void;
  readonly onDeplacer: (depot: ReponseDepotPneus) => void;
  readonly onSortir: (depot: ReponseDepotPneus) => void;
}

/** Une case du hangar — le composant que `EcranHangarPneus` (plan) et `useRechercheHangarPneus`
 *  (résultats de recherche) partagent, pour qu'un jeu ait EXACTEMENT le même rendu qu'on l'ait
 *  trouvé en parcourant le plan ou en tapant une plaque. `codeCase` porte la lecture visuelle
 *  principale (spec §6 : « l'emplacement physique... doit être visible ») — gros, monospace, en
 *  tête de carte, jamais noyé parmi les autres champs. */
export function CarteJeuPneu({
  depot,
  identification,
  site,
  peutChangerSaison,
  peutDeplacer,
  peutSortir,
  misEnEvidence = false,
  onChangerSaison,
  onDeplacer,
  onSortir,
}: Props) {
  const { t } = useTranslation(['pneus', 'commun']);
  const estActif = depot.statut === 'en_depot' || depot.statut === 'monte';
  const carteRef = useRef<HTMLDivElement>(null);

  // Fait défiler jusqu'à la carte et y place le focus quand elle vient d'être ciblée par
  // `?depot=` — condition à l'existence de `matchMedia` (absent de jsdom sans polyfill dédié,
  // qu'on ne pose pas ici : `test/setup.ts` est hors périmètre d'écriture de cet agent) et
  // toujours en respectant `prefers-reduced-motion`.
  useEffect(() => {
    if (!misEnEvidence) return;
    const noeud = carteRef.current;
    if (!noeud) return;
    const reduireMouvement =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    noeud.scrollIntoView({ behavior: reduireMouvement ? 'auto' : 'smooth', block: 'center' });
    noeud.focus();
  }, [misEnEvidence]);

  return (
    <Card
      ref={carteRef}
      tabIndex={misEnEvidence ? -1 : undefined}
      aria-label={
        misEnEvidence
          ? t('pneus:jeu.misEnEvidence.ariaLabel', {
              repere: depot.codeCase ?? t('pneus:jeu.sansRepere'),
            })
          : undefined
      }
      className={cn(misEnEvidence && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}
    >
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 font-mono texte-annexe font-semibold text-foreground">
            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {depot.codeCase ?? (
              <span className="texte-corps font-sans italic text-muted-foreground">
                {t('pneus:jeu.sansRepere')}
              </span>
            )}
          </div>
          <BadgeStatutDepotPneu statut={depot.statut} />
        </div>

        {misEnEvidence ? (
          <Badge variant="outline" className="w-fit border-primary text-primary">
            {t('pneus:jeu.misEnEvidence.badge')}
          </Badge>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <BadgeSaisonPneu saison={depot.saison} />
          {depot.dimension ? (
            <span className="texte-libelle text-muted-foreground">{depot.dimension}</span>
          ) : null}
        </div>

        {identification ? (
          <div className="flex flex-col gap-0.5">
            <span className="texte-corps font-medium text-foreground">
              {identification.plaque ?? t('pneus:jeu.plaqueInconnue')}
              {identification.designation ? ` · ${identification.designation}` : ''}
            </span>
            {identification.clientNom ? (
              <span className="texte-libelle text-muted-foreground">
                {identification.clientNom}
              </span>
            ) : null}
          </div>
        ) : null}

        <p className="texte-libelle text-muted-foreground">
          {t('pneus:jeu.dernierMouvement', { date: formaterDate(depot.dernierMouvementLe) })}
        </p>

        {depot.statut === 'a_relancer' ? (
          <p className="texte-libelle text-destructive">{t('pneus:jeu.avertissementRelance')}</p>
        ) : null}
        {depot.statut === 'sorti' && depot.motifSortie ? (
          <p className="texte-libelle text-muted-foreground">
            {t(`pneus:motifSortie.${depot.motifSortie}`)}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Link
            to={chemins.vehicules.detail(depot.vehiculeId, site)}
            className="texte-libelle font-medium text-primary underline"
          >
            {t('pneus:jeu.actions.voirVehicule')}
          </Link>
          {peutChangerSaison && estActif ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onChangerSaison(depot)}
            >
              {t('pneus:jeu.actions.changerSaison')}
            </Button>
          ) : null}
          {peutDeplacer && depot.statut !== 'sorti' ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onDeplacer(depot)}>
              {t('pneus:jeu.actions.deplacer')}
            </Button>
          ) : null}
          {peutSortir && depot.statut !== 'sorti' ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => onSortir(depot)}>
              {t('pneus:jeu.actions.sortir')}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
