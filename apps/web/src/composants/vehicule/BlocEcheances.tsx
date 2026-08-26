import { AlertTriangle, CalendarClock, ShieldCheck, ShieldOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { GarantieVehicule, ReponseContexteAtelier } from '@dfa/shared';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formaterDate, formaterKilometrage } from '@/lib/formats';
import { cn } from '@/lib/utils';

/** Sous-forme de `ReponseContexteAtelier.expertise` — indexée plutôt que redéclarée pour ne
 *  jamais diverger du contrat partagé. */
type EcheanceExpertise = ReponseContexteAtelier['expertise'];

export interface ProprietesBlocEcheances {
  readonly expertise: EcheanceExpertise;
  readonly garantieConstructeur: GarantieVehicule | null;
  readonly garantieGarage: GarantieVehicule | null;
  readonly className?: string;
}

/**
 * RM-28 / CT-10 : la source de l'échéance d'expertise (`calculee` vs `convocation`) est
 * **toujours affichée**, jamais masquée derrière une infobulle — une convocation cantonale prime
 * sur une périodicité calculée et le réceptionnaire doit le voir sans avoir à cliquer.
 *
 * RM-33 : une garantie affiche **sa date de fin ET son plafond kilométrique** ensemble — jamais
 * l'un sans l'autre, pour ne jamais laisser un réceptionnaire promettre une garantie caduque.
 *
 * Forme + mot pour les états (échue/active), jamais un token `--statut-*` : ce budget couleur est
 * réservé au statut d'OR/de ligne (docs/design-comptoir.md §2, cf. composants/identite/BadgeStatutClient.tsx).
 */
export function BlocEcheances({
  expertise,
  garantieConstructeur,
  garantieGarage,
  className,
}: ProprietesBlocEcheances) {
  const { t } = useTranslation('vehicules');

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="texte-titre-section">{t('expertise.titre')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-groupe">
        <LigneEcheanceExpertise expertise={expertise} />
        <div className="grid gap-groupe sm:grid-cols-2">
          <LigneGarantie titre={t('garantie.constructeur')} garantie={garantieConstructeur} />
          <LigneGarantie titre={t('garantie.garage')} garantie={garantieGarage} />
        </div>
      </CardContent>
    </Card>
  );
}

function LigneEcheanceExpertise({ expertise }: { readonly expertise: EcheanceExpertise }) {
  const { t } = useTranslation('vehicules');

  if (!expertise || !expertise.prochaineLe) {
    return <p className="texte-corps text-muted-foreground">{t('expertise.prochaine')} : —</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <CalendarClock aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="flex flex-col gap-0.5">
        <p
          className={cn(
            'texte-donnee-proeminente',
            expertise.echue && 'font-semibold text-foreground',
          )}
        >
          {formaterDate(expertise.prochaineLe)}
          {expertise.echue ? (
            <span className="ml-2 inline-flex items-center gap-1 align-middle texte-libelle font-semibold text-foreground">
              <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
              {t('expertise.echue')}
            </span>
          ) : null}
        </p>
      </div>
      {/* Source toujours visible, jamais uniquement au survol — RM-28. */}
      <Badge variant="secondary" className="ml-auto">
        {t('expertise.source')} : {t(`expertise.sources.${expertise.source}`)}
      </Badge>
    </div>
  );
}

function LigneGarantie({
  titre,
  garantie,
}: {
  readonly titre: string;
  readonly garantie: GarantieVehicule | null;
}) {
  const { t } = useTranslation('vehicules');

  // `garantie === null` signifie « aucune garantie renseignée » — on ignore l'état, ce n'est PAS
  // une garantie expirée. Confondre les deux (défaut constaté) fait dire « Échue » à un véhicule
  // qui n'a simplement jamais reçu de garantie : état neutre, jamais d'icône d'alarme ici.
  if (!garantie) {
    // BORDURE POINTILLÉE CONSERVÉE — même convention que `EtatVide` (composants/commun/) : le
    // signal visuel « rien à voir ici », pas une décoration. Les deux garanties (constructeur/
    // garage) sont comparées côte à côte (grille 2 colonnes du parent) ; sans cadre, une case
    // « non renseignée » se distinguerait mal d'une case renseignée simplement plus courte.
    return (
      <div className="flex flex-col gap-champ rounded-md border border-dashed p-carte">
        <p className="texte-libelle text-muted-foreground">{titre}</p>
        <p className="texte-corps text-muted-foreground">{t('garantie.nonRenseignee')}</p>
      </div>
    );
  }

  // À partir d'ici, la garantie existe réellement : `active` (calculé côté serveur) fait foi, on ne
  // le redérive jamais des dates/plafond côté écran.
  const active = garantie.active;
  const Icone = active ? ShieldCheck : ShieldOff;

  return (
    // BORDURE CONSERVÉE — même raison que le repli « non renseignée » ci-dessus : ce cadre est
    // l'unité de comparaison de la grille 2 colonnes (garantie constructeur / garage), pas un
    // simple groupe de contenu.
    <div className="flex flex-col gap-champ rounded-md border p-carte">
      <div className="flex items-center gap-2">
        <Icone
          aria-hidden
          className={cn('h-4 w-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground')}
        />
        <p className="texte-libelle text-muted-foreground">{titre}</p>
        <span
          className={cn(
            'ml-auto texte-libelle',
            active ? 'font-semibold text-foreground' : 'text-muted-foreground',
          )}
        >
          {active ? t('garantie.enchantier') : t('garantie.echue')}
        </span>
      </div>
      <p className="texte-corps">
        {garantie.finLe ? (
          <>
            {t('garantie.duree')} : {formaterDate(garantie.finLe)}
          </>
        ) : null}
        {garantie.finLe && garantie.plafondKm !== null ? ' · ' : null}
        {garantie.plafondKm !== null ? (
          <>
            {t('garantie.plafond')} : {formaterKilometrage(garantie.plafondKm, 'km')}
          </>
        ) : null}
      </p>
    </div>
  );
}
