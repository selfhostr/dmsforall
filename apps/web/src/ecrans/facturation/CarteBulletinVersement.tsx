import { useTranslation } from 'react-i18next';

import type { AdresseStructureeQr, BlocPaiementQrFige } from '@dfa/shared';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formaterMontantAvecDevise } from '@/lib/formats';

interface Props {
  readonly qr: BlocPaiementQrFige | null;
}

/** Même patron ligne-1/ligne-2 que `OngletAdresses.tsx` (`clients:adresses`) : rue + numéro sur
 *  une ligne, NPA + localité sur la suivante — le pays n'est montré que s'il diffère de la Suisse,
 *  seul cas où l'information ajoute quelque chose (créancier et débiteur sont CH par défaut). */
function ligneAdresse(adresse: AdresseStructureeQr): string {
  const rue = adresse.numero ? `${adresse.rue} ${adresse.numero}` : adresse.rue;
  const ville = `${adresse.npa} ${adresse.localite}`;
  return adresse.pays === 'CH' ? `${rue}, ${ville}` : `${rue}, ${ville}, ${adresse.pays}`;
}

/**
 * Bulletin de versement (RF-54 → RF-60, `ReponseDocumentVente.qr`) — affiché EN TEXTE. Le rendu
 * graphique du QR est fait côté serveur dans le PDF (`apps/api/src/facturation/impression/`) : le
 * dupliquer ici créerait deux implémentations qui divergeraient (voir le commentaire de tête de
 * `apps/api/src/facturation/documents/mappeurs.ts::construireBlocQrFige` — la charge est FIGÉE à
 * l'émission avec les coordonnées du garage telles qu'elles étaient à ce moment-là, jamais
 * recalculée ici non plus).
 *
 * `qr === null` est le cas NORMAL — pas une erreur — pour un devis, un bon de commande, un avoir
 * (il crédite le client, il ne se paie pas), un brouillon, OU pour un rôle sans droit aux montants
 * (`RF-116` : la charge QR contient le montant en clair, donc le serveur masque déjà `qr` à `null`
 * avant même d'atteindre ce composant — voir `mapperDocument`, `qr: voitMontants ? ... : null`).
 * Dans tous ces cas : PAS DE CARTE DU TOUT, même patron que `RecapitulatifTVA` (absent en bloc
 * plutôt qu'une zone vide à expliquer).
 *
 * Débloqué (10.08.2026) : les cinq clés i18n dont le contenu dépendait (`fiche.bulletin.payableA`,
 * `.payablePar`, `.iban`, `.reference`, `.sansReference`) sont posées dans les trois langues —
 * voir l'ancien commentaire de blocage, périmé, retiré d'ici. `debiteur` reste omis quand `null`
 * (`RF-59`, adresse incomplète à l'émission) plutôt que d'inventer une ligne « Payable par » vide.
 */
export function CarteBulletinVersement({ qr }: Props) {
  const { t } = useTranslation('facturation');

  if (!qr) return null;

  return (
    // DESIGN.md « bordure structurelle uniquement » — même correctif que `RecapitulatifTVA.tsx`,
    // juste au-dessus dans la même colonne de `EcranFicheFacture` : `Card` remplace l'ancien
    // `rounded-md border p-3` ad hoc, pour que les trois blocs de la colonne (récap TVA, bulletin,
    // documents liés) partagent la même surface plutôt que deux habillages différents.
    <Card>
      <CardHeader>
        <CardTitle className="texte-titre-section">
          {t('facturation:document.type.bulletinPaiement')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 texte-corps sm:grid-cols-2">
          <div>
            <dt className="texte-libelle text-muted-foreground">
              {t('facturation:fiche.bulletin.payableA')}
            </dt>
            <dd className="text-foreground">{qr.creancier.nom}</dd>
            <dd className="text-foreground">{ligneAdresse(qr.creancier.adresse)}</dd>
          </div>
          {qr.debiteur ? (
            <div>
              <dt className="texte-libelle text-muted-foreground">
                {t('facturation:fiche.bulletin.payablePar')}
              </dt>
              <dd className="text-foreground">{qr.debiteur.nom}</dd>
              <dd className="text-foreground">{ligneAdresse(qr.debiteur)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="texte-libelle text-muted-foreground">
              {t('facturation:fiche.bulletin.iban')}
            </dt>
            <dd className="font-mono text-foreground">{qr.creancier.iban}</dd>
          </div>
          <div>
            <dt className="texte-libelle text-muted-foreground">
              {t('facturation:fiche.bulletin.reference')}
            </dt>
            <dd className="font-mono text-foreground">
              {qr.qrReference ?? t('facturation:fiche.bulletin.sansReference')}
            </dd>
          </div>
        </dl>
        <div className="flex items-center justify-between border-t pt-2">
          <span className="texte-corps font-semibold text-foreground">
            {t('facturation:fiche.totalTtc')}
          </span>
          <span className="tabular-nums texte-corps font-semibold text-foreground">
            {formaterMontantAvecDevise(qr.qrMontantCentimes, qr.qrDevise)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
