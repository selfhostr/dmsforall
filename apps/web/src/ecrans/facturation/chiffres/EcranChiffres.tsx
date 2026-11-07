import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { Alert } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EtatVide } from '@/composants/commun/EtatVide';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { versDateIsoLocale } from '@/ecrans/accueil/semaine';
import { useSession } from '@/hooks/useSession';
import { formaterDate, formaterMontant } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { CarteChiffres } from './CarteChiffres';
import { peutVoirChiffres } from './droits';
import { periodesChiffres, type PeriodeIso } from './periodes';
import {
  useChiffreAffaires,
  useEncaissements,
  useFacturesOuvertes,
  useTravauxTermines,
  type EtatSection,
} from './useChiffres';

const chf = (centimes: number) => `CHF ${formaterMontant(centimes)}`;

function libellePeriode(periode: PeriodeIso): string {
  return `${formaterDate(periode.du)} – ${formaterDate(periode.au)}`;
}

/** Ligne « libellé / valeur » des sections à un seul chiffre. */
function LigneValeur({ libelle, valeur }: { readonly libelle: string; readonly valeur: string }) {
  return (
    <div className="flex items-baseline justify-between gap-groupe border-b py-2 last:border-0">
      <dt className="texte-corps text-muted-foreground">{libelle}</dt>
      <dd className="texte-corps font-semibold tabular-nums text-foreground">{valeur}</dd>
    </div>
  );
}

/**
 * Chiffres d'un petit garage : ce que le patron regarde une fois par semaine, en tableaux sobres.
 * Aucun nouvel endpoint — le chiffre d'affaires vient de `GET /tableau-bord/financier` (trois
 * fenêtres), les encaissements par moyen de `GET /paiements`, les factures ouvertes de
 * `GET /documents-vente` et les OR à facturer de `GET /ordres-reparation`. Réservé à la direction et
 * au comptable (`peutVoirChiffres`). Chaque section porte ses propres états chargement / vide /
 * erreur : une section en panne ne masque pas les autres.
 */
export function EcranChiffres() {
  const { t } = useTranslation(['facturation', 'commun', 'erreurs']);
  const { data: session, isPending: sessionEnCours } = useSession();
  const [searchParams] = useSearchParams();
  const siteId = searchParams.get('site') ?? undefined;
  const autorise = peutVoirChiffres(session?.actions);

  const periodes = useMemo(() => periodesChiffres(versDateIsoLocale(new Date())), []);

  if (sessionEnCours) {
    return (
      <GabaritEcran titre={t('facturation:chiffres.titre')}>
        <p role="status" className="texte-corps text-muted-foreground">
          {t('commun:chargement.enCours')}
        </p>
      </GabaritEcran>
    );
  }
  if (!autorise) {
    return (
      <GabaritEcran titre={t('facturation:chiffres.titre')}>
        <EtatVide
          titre={t('facturation:chiffres.refuse.titre')}
          description={t('facturation:chiffres.refuse.description')}
        />
      </GabaritEcran>
    );
  }

  return (
    <GabaritEcran titre={t('facturation:chiffres.titre')}>
      <SectionChiffreAffaires periodes={periodes} siteId={siteId} />
      <SectionEncaissements periode={periodes.moisCourant} siteId={siteId} />
      <div className="grid grid-cols-1 items-stretch gap-groupe md:grid-cols-2">
        <SectionFacturesOuvertes siteId={siteId} />
        <SectionTravauxTermines siteId={siteId} />
      </div>
      <p className="texte-libelle text-muted-foreground">
        <Link
          to={chemins.facturation.liste(siteId)}
          className="font-medium text-primary underline underline-offset-2"
        >
          {t('facturation:chiffres.voirFactures')}
        </Link>
      </p>
    </GabaritEcran>
  );
}

function AvertissementIncomplet({ visible }: { readonly visible: boolean }) {
  const { t } = useTranslation('facturation');
  if (!visible) return null;
  return (
    <Alert role="status" className="mt-groupe">
      {t('chiffres.incomplet')}
    </Alert>
  );
}

function SectionChiffreAffaires({
  periodes,
  siteId,
}: {
  readonly periodes: ReturnType<typeof periodesChiffres>;
  readonly siteId: string | undefined;
}) {
  const { t } = useTranslation('facturation');
  const etat = useChiffreAffaires(periodes, siteId);
  return (
    <CarteChiffres
      titre={t('chiffres.chiffreAffaires.titre')}
      description={t('chiffres.chiffreAffaires.description')}
      etat={etat}
      libelleErreur={t('chiffres.erreur')}
    >
      {(donnees) => {
        const lignes = [
          { cle: 'moisCourant', libelle: t('chiffres.periodes.moisCourant') },
          { cle: 'moisPrecedent', libelle: t('chiffres.periodes.moisPrecedent') },
          { cle: 'annee', libelle: t('chiffres.periodes.annee') },
        ] as const;
        if (lignes.every(({ cle }) => donnees[cle].chiffreAffaires.nombreDocuments === 0)) {
          return (
            <EtatVide
              titre={t('chiffres.chiffreAffaires.vide.titre')}
              description={t('chiffres.chiffreAffaires.vide.description')}
            />
          );
        }
        return (
          <Table densite="dense">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('chiffres.colonnes.periode')}</TableHead>
                <TableHead scope="col" className="text-right">
                  {t('chiffres.colonnes.factures')}
                </TableHead>
                <TableHead scope="col" className="text-right">
                  {t('chiffres.colonnes.ht')}
                </TableHead>
                <TableHead scope="col" className="text-right">
                  {t('chiffres.colonnes.tva')}
                </TableHead>
                <TableHead scope="col" className="text-right">
                  {t('chiffres.colonnes.ttc')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lignes.map(({ cle, libelle }) => {
                const ca = donnees[cle].chiffreAffaires;
                return (
                  <TableRow key={cle}>
                    <TableCell>
                      <span className="block font-medium">{libelle}</span>
                      <span className="block texte-libelle text-muted-foreground">
                        {libellePeriode(periodes[cle])}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{ca.nombreDocuments}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {chf(ca.totalHtCentimes)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {chf(ca.totalTvaCentimes)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {chf(ca.totalTtcCentimes)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        );
      }}
    </CarteChiffres>
  );
}

function SectionEncaissements({
  periode,
  siteId,
}: {
  readonly periode: PeriodeIso;
  readonly siteId: string | undefined;
}) {
  const { t } = useTranslation(['facturation']);
  const requete = useEncaissements(periode, siteId);
  const etat: EtatSection<NonNullable<typeof requete.data>> = {
    data: requete.data,
    isPending: requete.isPending,
    isError: requete.isError,
    error: requete.error,
    refetch: () => void requete.refetch(),
  };
  return (
    <CarteChiffres
      titre={t('facturation:chiffres.encaissements.titre')}
      description={t('facturation:chiffres.encaissements.description', {
        periode: libellePeriode(periode),
      })}
      etat={etat}
      libelleErreur={t('facturation:chiffres.erreur')}
    >
      {(donnees) =>
        donnees.parMoyen.length === 0 ? (
          <EtatVide
            titre={t('facturation:chiffres.encaissements.vide.titre')}
            description={t('facturation:chiffres.encaissements.vide.description')}
          />
        ) : (
          <>
            <Table densite="dense">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t('facturation:chiffres.colonnes.moyen')}</TableHead>
                  <TableHead scope="col" className="text-right">
                    {t('facturation:chiffres.colonnes.paiements')}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t('facturation:chiffres.colonnes.montant')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {donnees.parMoyen.map((ligne) => (
                  <TableRow key={ligne.moyen}>
                    <TableCell>{t(`facturation:moyensPaiement.${ligne.moyen}`)}</TableCell>
                    <TableCell className="text-right tabular-nums">{ligne.nombre}</TableCell>
                    <TableCell className="text-right tabular-nums">{chf(ligne.centimes)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-semibold">
                    {t('facturation:chiffres.encaissements.total')}
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-right font-semibold tabular-nums">
                    {chf(donnees.totalCentimes)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <AvertissementIncomplet visible={donnees.incomplet} />
          </>
        )
      }
    </CarteChiffres>
  );
}

function SectionFacturesOuvertes({ siteId }: { readonly siteId: string | undefined }) {
  const { t } = useTranslation('facturation');
  const requete = useFacturesOuvertes(siteId);
  const etat: EtatSection<NonNullable<typeof requete.data>> = {
    data: requete.data,
    isPending: requete.isPending,
    isError: requete.isError,
    error: requete.error,
    refetch: () => void requete.refetch(),
  };
  return (
    <CarteChiffres
      titre={t('chiffres.facturesOuvertes.titre')}
      description={t('chiffres.facturesOuvertes.description')}
      etat={etat}
      libelleErreur={t('chiffres.erreur')}
    >
      {(donnees) =>
        donnees.nombreOuvertes === 0 ? (
          <EtatVide
            titre={t('chiffres.facturesOuvertes.vide.titre')}
            description={t('chiffres.facturesOuvertes.vide.description')}
          />
        ) : (
          <>
            <dl>
              <LigneValeur
                libelle={t('chiffres.facturesOuvertes.ouvertes', {
                  count: donnees.nombreOuvertes,
                })}
                valeur={chf(donnees.soldeOuvertCentimes)}
              />
              <LigneValeur
                libelle={t('chiffres.facturesOuvertes.enRetard', {
                  count: donnees.nombreEnRetard,
                })}
                valeur={chf(donnees.soldeEnRetardCentimes)}
              />
            </dl>
            <AvertissementIncomplet visible={donnees.incomplet} />
          </>
        )
      }
    </CarteChiffres>
  );
}

function SectionTravauxTermines({ siteId }: { readonly siteId: string | undefined }) {
  const { t } = useTranslation('facturation');
  const requete = useTravauxTermines(siteId);
  const etat: EtatSection<NonNullable<typeof requete.data>> = {
    data: requete.data,
    isPending: requete.isPending,
    isError: requete.isError,
    error: requete.error,
    refetch: () => void requete.refetch(),
  };
  return (
    <CarteChiffres
      titre={t('chiffres.travauxTermines.titre')}
      description={t('chiffres.travauxTermines.description')}
      etat={etat}
      libelleErreur={t('chiffres.erreur')}
    >
      {(donnees) =>
        donnees.nombre === 0 ? (
          <EtatVide
            titre={t('chiffres.travauxTermines.vide.titre')}
            description={t('chiffres.travauxTermines.vide.description')}
          />
        ) : (
          <>
            <dl>
              <LigneValeur
                libelle={t('chiffres.travauxTermines.nombre', { count: donnees.nombre })}
                valeur={donnees.estimeTtcCentimes === null ? '—' : chf(donnees.estimeTtcCentimes)}
              />
            </dl>
            <AvertissementIncomplet visible={donnees.incomplet} />
          </>
        )
      }
    </CarteChiffres>
  );
}
