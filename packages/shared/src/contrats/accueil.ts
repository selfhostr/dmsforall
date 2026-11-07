/**
 * `GET /accueil/etat-demarrage` — ce qui est déjà réglé pour que le garage facture et planifie sans
 * aide, calculé côté serveur (une lecture par table) plutôt qu'en six appels côté écran.
 *
 * Chaque étape est un booléen DÉFINITIF (le serveur lit toujours toutes ses sources — l'état
 * « inconnu » de l'écran ne naît que d'un échec de l'appel lui-même) :
 *  - `coordonnees` : nom, rue, NPA et localité du bloc créancier renseignés ;
 *  - `iban` : IBAN ou QR-IBAN renseigné ;
 *  - `numeroTva` : numéro TVA du garage saisi ;
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
