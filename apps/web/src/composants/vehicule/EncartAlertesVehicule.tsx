import { AlertTriangle, Award, Globe, Megaphone, ShieldAlert, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponseContexteAtelier } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { formaterDate, formaterKilometrage } from '@/lib/formats';
import { cn } from '@/lib/utils';

type TravailReporteContexte = ReponseContexteAtelier['travauxReportes']['elements'][number];
type CampagneContexte = ReponseContexteAtelier['campagnesOuvertes'][number];

/** Élément sur lequel un « Ajouter à ce … » a du sens (les familles informatives — expertise,
 *  garantie, importé — n'ont rien à ajouter, seules les familles à éléments individuels en ont
 *  un). Aucun appel API ici : le callback est un pur événement UI, l'appelant décide de la suite. */
export type ElementAjoutableAlerteVehicule =
  | { readonly famille: 'travailReporte'; readonly item: TravailReporteContexte }
  | { readonly famille: 'campagne'; readonly item: CampagneContexte };

export interface ProprietesEncartAlertesVehicule {
  readonly travauxReportes: ReponseContexteAtelier['travauxReportes'];
  readonly campagnesOuvertes: ReponseContexteAtelier['campagnesOuvertes'];
  readonly expertise: ReponseContexteAtelier['expertise'];
  readonly garantie: ReponseContexteAtelier['garantie'];
  readonly importe: ReponseContexteAtelier['vehicule']['importe'];
  readonly alertesClient: ReponseContexteAtelier['alertesClient'];
  /** Omis en lot 1 : il n'existe encore aucun contexte (RDV/OR) où « ajouter » cet élément. */
  readonly onAjouter?: (element: ElementAjoutableAlerteVehicule) => void;
  readonly className?: string;
}

interface LigneAlerte {
  readonly cle: string;
  readonly icone: ReactNode;
  readonly token: 'danger' | 'attention' | 'succes' | 'neutre';
  readonly contenu: ReactNode;
  readonly action?: ReactNode;
}

const TOKEN_CLASSES: Record<LigneAlerte['token'], string> = {
  danger: 'border-statut-danger/40 bg-statut-danger/10 text-statut-danger',
  attention: 'border-statut-attention/40 bg-statut-attention/10 text-statut-attention',
  succes: 'border-statut-succes/40 bg-statut-succes/10 text-statut-succes',
  neutre: 'border-statut-neutre/40 bg-statut-neutre/10 text-statut-neutre',
};

/**
 * Composant partagé RDV / réception / OR (invariant n°6) : ce qu'un garagiste doit voir SANS
 * CLIQUER quand une voiture se présente au comptoir. Source = projection `contexte-atelier`.
 *
 * Six familles, chacune bornée et comptée côté serveur — une famille vide **disparaît**, elle
 * n'affiche jamais « 0 ». Volontairement non compactable (`.densite-aeree` forcée) : c'est
 * l'élément le plus rentable de l'écran, il reste gros et lisible même en contexte bureau dense.
 */
export function EncartAlertesVehicule({
  travauxReportes,
  campagnesOuvertes,
  expertise,
  garantie,
  importe,
  alertesClient,
  onAjouter,
  className,
}: ProprietesEncartAlertesVehicule) {
  const { t } = useTranslation('vehicules');

  const lignes: LigneAlerte[] = [];

  for (const alerte of alertesClient) {
    lignes.push({
      cle: `alerte-client-${alerte.id}`,
      icone: <AlertTriangle aria-hidden className="h-5 w-5 shrink-0" />,
      token: 'danger',
      contenu: (
        <>
          <p className="font-medium text-foreground">{t('alertes.alerteClient')}</p>
          <p className="text-muted-foreground">{alerte.texte}</p>
        </>
      ),
    });
  }

  if (expertise && expertise.prochaineLe) {
    lignes.push({
      cle: 'expertise',
      icone: <ShieldAlert aria-hidden className="h-5 w-5 shrink-0" />,
      token: expertise.echue ? 'danger' : 'attention',
      contenu: (
        <>
          <p className="font-medium text-foreground">{t('alertes.expertise')}</p>
          <p className="text-muted-foreground">
            {formaterDate(expertise.prochaineLe)} · {t('expertise.source')} :{' '}
            {t(`expertise.sources.${expertise.source}`)}
            {expertise.echue ? ` · ${t('expertise.echue')}` : ''}
          </p>
        </>
      ),
    });
  }

  for (const garantieVehicule of [
    { titre: t('garantie.constructeur'), valeur: garantie.constructeur },
    { titre: t('garantie.garage'), valeur: garantie.garage },
  ]) {
    if (garantieVehicule.valeur?.active) {
      lignes.push({
        cle: `garantie-${garantieVehicule.titre}`,
        icone: <Award aria-hidden className="h-5 w-5 shrink-0" />,
        token: 'succes',
        contenu: (
          <>
            <p className="font-medium text-foreground">
              {t('alertes.garantie')} — {garantieVehicule.titre}
            </p>
            <p className="text-muted-foreground">
              {garantieVehicule.valeur.finLe ? formaterDate(garantieVehicule.valeur.finLe) : null}
              {garantieVehicule.valeur.finLe && garantieVehicule.valeur.plafondKm !== null ? ' · ' : null}
              {garantieVehicule.valeur.plafondKm !== null
                ? `${t('garantie.plafond')} : ${formaterKilometrage(garantieVehicule.valeur.plafondKm, 'km')}`
                : null}
            </p>
          </>
        ),
      });
    }
  }

  for (const campagne of campagnesOuvertes) {
    lignes.push({
      cle: `campagne-${campagne.id}`,
      icone: <Megaphone aria-hidden className="h-5 w-5 shrink-0" />,
      token: campagne.obligatoire ? 'attention' : 'neutre',
      contenu: (
        <>
          <p className="font-medium text-foreground">
            {t('alertes.campagnes')} — {campagne.code}
          </p>
          <p className="text-muted-foreground">{campagne.description}</p>
        </>
      ),
      action: onAjouter ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => onAjouter({ famille: 'campagne', item: campagne })}
        >
          {t('alertes.ajouter')}
        </Button>
      ) : undefined,
    });
  }

  for (const travail of travauxReportes.elements) {
    lignes.push({
      cle: `travail-${travail.id}`,
      icone: <Wrench aria-hidden className="h-5 w-5 shrink-0" />,
      token: travail.urgence === 'urgent' ? 'danger' : travail.urgence === 'a_faire' ? 'attention' : 'neutre',
      contenu: (
        <>
          <p className="font-medium text-foreground">
            {t('alertes.travauxReportes')} — {travail.designation}
          </p>
          <p className="text-muted-foreground">
            {formaterDate(travail.constateLe)}
            {travail.kilometrageAlors !== null ? ` · ${formaterKilometrage(travail.kilometrageAlors, 'km')}` : ''}
          </p>
        </>
      ),
      action: onAjouter ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => onAjouter({ famille: 'travailReporte', item: travail })}
        >
          {t('alertes.ajouter')}
        </Button>
      ) : undefined,
    });
  }

  if (importe.estImporte) {
    lignes.push({
      cle: 'importe',
      icone: <Globe aria-hidden className="h-5 w-5 shrink-0" />,
      token: 'neutre',
      contenu: (
        <>
          <p className="font-medium text-foreground">{t('alertes.importe')}</p>
          <p className="text-muted-foreground">
            {[importe.paysOrigine, importe.importeLe ? formaterDate(importe.importeLe) : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </>
      ),
    });
  }

  if (lignes.length === 0) {
    return null;
  }

  return (
    <div className={cn('densite-aeree flex flex-col gap-3', className)}>
      <h2 className="texte-titre-section font-semibold">{t('alertes.titre')}</h2>
      {lignes.map((ligne) => (
        <div
          key={ligne.cle}
          className={cn('flex items-start gap-3 rounded-md border p-4 texte-corps', TOKEN_CLASSES[ligne.token])}
        >
          {ligne.icone}
          <div className="flex-1">{ligne.contenu}</div>
          {ligne.action}
        </div>
      ))}
    </div>
  );
}
