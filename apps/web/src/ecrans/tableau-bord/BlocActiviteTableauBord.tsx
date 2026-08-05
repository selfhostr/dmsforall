import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';

import type { ReponseActiviteTableauBord } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { formaterDureeMoyenneTableauBord } from '@/hooks/tableau-bord/formats-tableau-bord';

interface Props {
  readonly resultat: UseQueryResult<ReponseActiviteTableauBord>;
}

/** Chiffre net et gros, libellé petit et discret en dessous — hiérarchie typographique du
 *  tableau de bord, jamais l'inverse. */
function Indicateur({ valeur, libelle }: { readonly valeur: string; readonly libelle: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="tabular-nums text-3xl font-semibold leading-none">{valeur}</span>
      <span className="text-sm text-muted-foreground">{libelle}</span>
    </div>
  );
}

/**
 * Bloc « Activité » (atelier + stock, en quantités seulement) — ouvert à tout rôle de PERSONNE
 * sauf `poste_atelier`, donc TOUJOURS rendu pour quiconque atteint `/tableau-bord` (la garde de
 * route l'assure déjà, voir `routeur.tsx`). Reçoit le résultat de `useActiviteTableauBord` en
 * PROPS plutôt que d'appeler le hook lui-même : `EcranTableauBord` a besoin de la même donnée
 * (`periode`) pour l'afficher au-dessus des deux blocs, un seul appel évite deux caches distincts
 * pour la même requête.
 *
 * Période/site sans aucune activité (tous les compteurs à 0, `delaiMoyenRestitutionMinutes: null`)
 * N'EST PAS une erreur ni un état « vide » au sens `EtatVide` — c'est un ZÉRO à afficher DIGNEMENT :
 * les chiffres eux-mêmes sont le contenu, ce bloc reste toujours rendu dans ce cas (jamais masqué,
 * jamais remplacé par un message « aucune donnée »).
 */
export function BlocActiviteTableauBord({ resultat }: Props) {
  const { t } = useTranslation(['tableauBord', 'or', 'commun']);
  const { data, isPending, isError, error, refetch } = resultat;

  if (isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('tableauBord:activite.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          <EtatChargement lignes={4} />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('tableauBord:activite.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          <EtatErreur
            titre={t('tableauBord:activite.erreur.titre')}
            description={messageErreur(error, t)}
            onReessayer={() => void refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  const maxParStatut = Math.max(1, ...data.ordresReparationParStatut.map((ligne) => ligne.nombre));
  const delai = formaterDureeMoyenneTableauBord(data.delaiMoyenRestitutionMinutes);
  // Composition TRADUITE ici (ce composant a `t()`, contrairement au hook qui décompose la durée
  // en nombres bruts) — une clé par granularité, jamais un « min »/« h »/« j » en dur : un
  // garagiste alémanique doit lire « Std »/« T », pas leur équivalent français. `deuxChiffres`
  // ne pad que le CHIFFRE (convention d'affichage « 1 h 00 »), pas une chaîne traduite.
  const deuxChiffres = (valeur: number) => String(valeur).padStart(2, '0');
  const delaiFormate =
    delai === null
      ? null
      : t(`tableauBord:activite.delaiRestitution.${delai.granularite}`, {
          jours: delai.jours,
          heures: delai.heures,
          minutes:
            delai.granularite === 'heuresMinutes' ? deuxChiffres(delai.minutes) : delai.minutes,
        });

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('tableauBord:activite.titre')}</h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <Indicateur
              valeur={String(data.ordresReparationOuvertsPeriode)}
              libelle={t('tableauBord:activite.ordresOuverts.libelle')}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <Indicateur
              valeur={String(data.ordresReparationRestituesPeriode)}
              libelle={t('tableauBord:activite.ordresRestitues.libelle')}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <Indicateur
              valeur={delaiFormate ?? t('tableauBord:activite.delaiRestitution.sansDonnee')}
              libelle={t('tableauBord:activite.delaiRestitution.libelle')}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <Indicateur
              valeur={String(data.lignesEnAttenteValidation)}
              libelle={t('tableauBord:activite.lignesEnAttenteValidation.libelle')}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('tableauBord:activite.repartitionStatuts.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          {data.ordresReparationParStatut.map((ligne) => (
            <div key={ligne.statut} className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-sm text-muted-foreground">
                {t(`or:statuts.${ligne.statut === 'en_cours' ? 'enCours' : ligne.statut}`)}
              </span>
              <div className="h-3 flex-1 rounded-full bg-muted" aria-hidden="true">
                <div
                  className="h-3 rounded-full bg-primary"
                  style={{ width: `${(ligne.nombre / maxParStatut) * 100}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right tabular-nums text-sm font-medium">
                {ligne.nombre}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Indicateur
            valeur={String(data.articlesSousSeuilReapprovisionnement)}
            libelle={t('tableauBord:activite.articlesSousSeuil.libelle')}
          />
        </CardContent>
      </Card>
    </div>
  );
}
