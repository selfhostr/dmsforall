/**
 * `GET /accueil/etat-demarrage` — ce qui est déjà réglé pour que le garage facture et planifie sans
 * aide, calculé côté serveur (une lecture par table) plutôt qu'en six appels côté écran.
 *
 * Chaque étape est un booléen DÉFINITIF (le serveur lit toujours toutes ses sources — l'état
 * « inconnu » de l'écran ne naît que d'un échec de l'appel lui-même) :
 *  - `coordonnees` : nom, rue, n° de rue, NPA, localité et pays du bloc créancier renseignés — les
 *    mêmes champs requis que l'émission d'une facture (`CHAMPS_REQUIS_BLOC_CREANCIER`) ;
 *  - `iban` : IBAN ou QR-IBAN renseigné ;
 *  - `numeroTva` : étape TVA faite — garage non assujetti (`assujettiTva = false`), ou assujetti
 *    avec son numéro TVA saisi ;
 *  - `tauxHoraire` : au moins un taux horaire existe ;
 *  - `motifsRdv` : au moins un motif de rendez-vous actif ;
 *  - `premierCollaborateur` : un compte de personne (hors compte de service) autre que l'appelant,
 *    invité ou actif ;
 *  - `borne` : au moins une borne d'atelier active.
 * Droit : direction/admin.
 */
export interface ReponseEtatDemarrage {
  readonly etapes: {
    readonly coordonnees: boolean;
    readonly iban: boolean;
    readonly numeroTva: boolean;
    readonly tauxHoraire: boolean;
    readonly motifsRdv: boolean;
    readonly premierCollaborateur: boolean;
    readonly borne: boolean;
  };
}
