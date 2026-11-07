import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AdresseStructureeQr, BlocPaiementQrFige } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formaterMontantAvecDevise } from '@/lib/formats';

/** IBAN par blocs de 4 (`CH93 0076 2011 6238 5295 7`), sans toucher à la valeur copiée. */
export function grouperIban(iban: string): string {
  return iban
    .replace(/\s+/g, '')
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

/** Référence de paiement : 27 chiffres = référence QR, affichée `21 00000 00003 13947 14300 09017`
 *  (2 puis 5 × 5, format du bulletin) ; toute autre (référence créancier `RF…`) par blocs de 4. */
export function grouperReference(reference: string): string {
  const brute = reference.replace(/\s+/g, '');
  if (/^\d{27}$/.test(brute)) {
    return `${brute.slice(0, 2)} ${brute
      .slice(2)
      .replace(/(.{5})/g, '$1 ')
      .trim()}`;
  }
  return brute.replace(/(.{4})/g, '$1 ').trim();
}

interface PropsValeurCopiable {
  readonly affichee: string;
  readonly brute: string;
  readonly libelleCopie: string;
}

/** Valeur en police mono qui retourne à la ligne plutôt que de déborder, avec son bouton copier
 *  (copie la valeur sans espaces, collable telle quelle dans un e-banking). */
function ValeurCopiable({ affichee, brute, libelleCopie }: PropsValeurCopiable) {
  const { t } = useTranslation('facturation');
  const [copie, setCopie] = useState(false);

  async function copier() {
    try {
      await navigator.clipboard.writeText(brute);
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2000);
    } catch {
      setCopie(false);
    }
  }

  return (
    <span className="flex min-w-0 items-start gap-2">
      <span className="min-w-0 flex-1 break-all font-mono tabular-nums text-foreground">
        {affichee}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="-my-2 shrink-0"
        aria-label={libelleCopie}
        title={libelleCopie}
        onClick={() => void copier()}
      >
        {copie ? (
          <Check aria-hidden className="h-4 w-4" />
        ) : (
          <Copy aria-hidden className="h-4 w-4" />
        )}
      </Button>
      <span role="status" className="sr-only">
        {copie ? t('facturation:fiche.bulletin.copie') : ''}
      </span>
    </span>
  );
}

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

  const copier = t('facturation:fiche.bulletin.copier');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="texte-titre-section">
          {t('facturation:document.type.bulletinPaiement')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Liste de définitions à 2 colonnes (libellé | valeur) ; la colonne valeur est `min-w-0`
            pour que IBAN et référence se replient dans la carte au lieu de la déborder. */}
        <dl className="grid grid-cols-[minmax(6rem,max-content)_minmax(0,1fr)] items-start gap-x-6 gap-y-3 texte-corps">
          <dt className="texte-libelle text-muted-foreground">
            {t('facturation:fiche.bulletin.payableA')}
          </dt>
          <dd className="min-w-0 break-words text-foreground">
            {qr.creancier.nom}
            <br />
            {ligneAdresse(qr.creancier.adresse)}
          </dd>
          {qr.debiteur ? (
            <>
              <dt className="texte-libelle text-muted-foreground">
                {t('facturation:fiche.bulletin.payablePar')}
              </dt>
              <dd className="min-w-0 break-words text-foreground">
                {qr.debiteur.nom}
                <br />
                {ligneAdresse(qr.debiteur)}
              </dd>
            </>
          ) : null}
          <dt className="texte-libelle text-muted-foreground">
            {t('facturation:fiche.bulletin.iban')}
          </dt>
          <dd className="min-w-0">
            <ValeurCopiable
              affichee={grouperIban(qr.creancier.iban)}
              brute={qr.creancier.iban.replace(/\s+/g, '')}
              libelleCopie={`${copier} — ${t('facturation:fiche.bulletin.iban')}`}
            />
          </dd>
          <dt className="texte-libelle text-muted-foreground">
            {t('facturation:fiche.bulletin.reference')}
          </dt>
          <dd className="min-w-0">
            {qr.qrReference ? (
              <ValeurCopiable
                affichee={grouperReference(qr.qrReference)}
                brute={qr.qrReference.replace(/\s+/g, '')}
                libelleCopie={`${copier} — ${t('facturation:fiche.bulletin.reference')}`}
              />
            ) : (
              <span className="text-muted-foreground">
                {t('facturation:fiche.bulletin.sansReference')}
              </span>
            )}
          </dd>
          <dt className="texte-libelle text-muted-foreground">{t('facturation:fiche.totalTtc')}</dt>
          <dd className="text-right font-semibold tabular-nums text-foreground">
            {formaterMontantAvecDevise(qr.qrMontantCentimes, qr.qrDevise)}
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}
