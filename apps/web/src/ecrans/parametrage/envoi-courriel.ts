import {
  hoteSmtpValide,
  PREREGLAGES_ENVOI_COURRIEL,
  type EntreeModificationEnvoiCourriel,
  type PreregladeEnvoiCourriel,
  type ReglageEnvoiCourriel,
  type SecuriteSmtp,
} from '@dfa/shared';

/** Choix du menu « Fournisseur » : un préréglage connu, ou « Autre » (saisie libre). */
export type ChoixFournisseur = PreregladeEnvoiCourriel | 'autre';

export const CHOIX_FOURNISSEURS: readonly ChoixFournisseur[] = [
  'infomaniak',
  'google',
  'microsoft365',
  'autre',
];

export interface SaisieEnvoiCourriel {
  readonly hote: string;
  readonly port: string;
  readonly securite: SecuriteSmtp;
  readonly utilisateur: string;
  readonly motDePasse: string;
  readonly adresseExpediteur: string;
  readonly nomAffiche: string;
  readonly adresseReponse: string;
}

export const SAISIE_VIDE: SaisieEnvoiCourriel = {
  hote: '',
  port: '587',
  securite: 'starttls',
  utilisateur: '',
  motDePasse: '',
  adresseExpediteur: '',
  nomAffiche: '',
  adresseReponse: '',
};

export function saisieDepuisReglage(reglage: ReglageEnvoiCourriel | null): SaisieEnvoiCourriel {
  if (reglage === null) return SAISIE_VIDE;
  return {
    hote: reglage.hote,
    port: String(reglage.port),
    securite: reglage.securite,
    utilisateur: reglage.utilisateur ?? '',
    motDePasse: '',
    adresseExpediteur: reglage.adresseExpediteur,
    nomAffiche: reglage.nomAffiche ?? '',
    adresseReponse: reglage.adresseReponse ?? '',
  };
}

/** Le préréglage qui correspond au serveur enregistré, ou « Autre ». */
export function fournisseurDe(hote: string): ChoixFournisseur {
  const trouve = (
    Object.entries(PREREGLAGES_ENVOI_COURRIEL) as [PreregladeEnvoiCourriel, { hote: string }][]
  ).find(([, p]) => p.hote === hote.trim().toLowerCase());
  return trouve ? trouve[0] : 'autre';
}

/** Remplit hôte, port et sécurité ; le reste (identifiants, adresses) est propre au compte. */
export function appliquerFournisseur(
  saisie: SaisieEnvoiCourriel,
  choix: ChoixFournisseur,
): SaisieEnvoiCourriel {
  if (choix === 'autre') return saisie;
  const p = PREREGLAGES_ENVOI_COURRIEL[choix];
  return { ...saisie, hote: p.hote, port: String(p.port), securite: p.securite };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ChampEnErreur = 'hote' | 'port' | 'adresseExpediteur' | 'adresseReponse';

/** Champs invalides (obligatoire manquant, port hors plage, adresse mal formée). Vide = valide. */
export function champsInvalides(saisie: SaisieEnvoiCourriel): readonly ChampEnErreur[] {
  const erreurs: ChampEnErreur[] = [];
  if (!hoteSmtpValide(saisie.hote.trim())) {
    erreurs.push('hote');
  }
  const port = Number(saisie.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) erreurs.push('port');
  if (!EMAIL.test(saisie.adresseExpediteur.trim())) erreurs.push('adresseExpediteur');
  if (saisie.adresseReponse.trim() !== '' && !EMAIL.test(saisie.adresseReponse.trim())) {
    erreurs.push('adresseReponse');
  }
  return erreurs;
}

/** Corps du PATCH : le mot de passe n'est joint que s'il a été retapé (sinon « inchangé »). */
export function versEntree(saisie: SaisieEnvoiCourriel): EntreeModificationEnvoiCourriel {
  const utilisateur = saisie.utilisateur.trim();
  return {
    hote: saisie.hote.trim(),
    port: Number(saisie.port),
    securite: saisie.securite,
    utilisateur: utilisateur === '' ? null : utilisateur,
    ...(saisie.motDePasse !== '' ? { motDePasse: saisie.motDePasse } : {}),
    adresseExpediteur: saisie.adresseExpediteur.trim(),
    nomAffiche: saisie.nomAffiche.trim() === '' ? null : saisie.nomAffiche.trim(),
    adresseReponse: saisie.adresseReponse.trim() === '' ? null : saisie.adresseReponse.trim(),
  };
}

/** Le formulaire diffère-t-il du réglage enregistré ? (un mot de passe retapé compte.) */
export function estModifie(
  saisie: SaisieEnvoiCourriel,
  reglage: ReglageEnvoiCourriel | null,
): boolean {
  const ref = saisieDepuisReglage(reglage);
  return (Object.keys(ref) as (keyof SaisieEnvoiCourriel)[]).some(
    (k) => saisie[k].trim() !== ref[k].trim() || (k === 'motDePasse' && saisie[k] !== ''),
  );
}
