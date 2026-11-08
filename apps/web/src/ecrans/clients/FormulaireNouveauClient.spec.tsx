import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReponseClient, ReponseDoublonsClients } from '@dfa/shared';

import { lireBrouillon } from '@/hooks/brouillon/brouillon';
import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { CLE_BROUILLON_NOUVEAU_CLIENT, FormulaireNouveauClient } from './FormulaireNouveauClient';

/** Reproduit le patron réel de `EcranListeClients` : `FormulaireNouveauClient` est monté SOUS un
 *  `<Sheet>` (Radix) dont le contenu n'est PAS conditionné par `sheetOuvert` dans le JSX — c'est
 *  `ouvert` qui pilote sa visibilité, pas son montage. Défaut 1 constaté en test navigateur réel :
 *  une fermeture suivie d'une réouverture rapide (avant la fin de l'animation de sortie de
 *  `SheetContent`) peut laisser la MÊME instance montée d'une ouverture à l'autre. Ce harnais
 *  reproduit ce cas précis — le formulaire ne se démonte JAMAIS entre « Fermer » et « Ouvrir » —
 *  pour prouver que la réinitialisation vient de l'effet dépendant de `ouvert`, pas d'un
 *  démontage accidentel qui masquerait un formulaire encore bogué.
 */
function EnveloppeTiroir({ onCree }: { readonly onCree: (client: ReponseClient) => void }) {
  const [ouvert, setOuvert] = useState(true);
  return (
    <div>
      <button type="button" onClick={() => setOuvert(false)}>
        Fermer le tiroir
      </button>
      <button type="button" onClick={() => setOuvert(true)}>
        Ouvrir le tiroir
      </button>
      <FormulaireNouveauClient ouvert={ouvert} onCree={onCree} />
    </div>
  );
}

const CLIENT_CREE: ReponseClient = {
  id: 'cl-42',
  numeroClient: 'CL-000042',
  type: 'particulier',
  statut: 'actif',
  civilite: null,
  nom: 'Rossi',
  prenom: 'Isabelle',
  raisonSociale: null,
  nomAffiche: 'Isabelle Rossi',
  ide: null,
  langueCorrespondance: 'fr',
  email: null,
  telephone: null,
  telephoneE164: null,
  poObligatoire: false,
  groupeId: null,
  fusionneVersClientId: null,
  referenceExterne: null,
  dernierPassageLe: null,
  creeLe: '2026-07-28T08:00:00.000Z',
  modifieLe: '2026-07-28T08:00:00.000Z',
  notesAlerte: [],
  plusAucunContact: false,
  motif: null,
};

async function remplirIdentiteMinimale(utilisateur: ReturnType<typeof userEvent.setup>) {
  await utilisateur.type(screen.getByLabelText('Nom'), 'Rossi');
  await utilisateur.type(screen.getByLabelText('Rue et numéro'), 'Rue Neuve 5');
  await utilisateur.type(screen.getByLabelText('NPA'), '1000');
  await utilisateur.type(screen.getByLabelText('Localité'), 'Lausanne');
}

function rendreFormulaire(onCree = vi.fn(), routeInitiale = '/') {
  const resultat = renduAvecRoutes(
    [
      // `ouvert={true}` : le tiroir est déjà ouvert dans tous les scénarios existants (le montage
      // direct du composant simule un tiroir qui vient de s'ouvrir). Le comportement de
      // réouverture (défaut 1) a son propre harnais, `EnveloppeTiroir` ci-dessus.
      { path: '/', element: <FormulaireNouveauClient ouvert onCree={onCree} /> },
      { path: '/clients/:id', element: <div>PAGE_FICHE_CLIENT</div> },
    ],
    { routeInitiale },
  );
  return { ...resultat, onCree };
}

describe('FormulaireNouveauClient', () => {
  // Le brouillon (issue #78) vit dans `sessionStorage`, sous une clé CONSTANTE
  // (`CLE_BROUILLON_NOUVEAU_CLIENT`) — sans ce nettoyage, un brouillon écrit par un test
  // resurgirait au montage du suivant (jsdom ne réinitialise pas `sessionStorage` entre les `it`
  // d'un même fichier), faisant passer ou échouer des tests selon leur ORDRE d'exécution plutôt
  // que sur leur propre mérite.
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('affiche les erreurs de validation par champ à la soumission de données invalides, sans perte de saisie ni rejet silencieux', async () => {
    // Régression @hookform/resolvers + zod 4 : avec @hookform/resolvers@3.10.0, l'adaptateur zod
    // teste `Array.isArray(err?.errors)` pour convertir un ZodError en erreurs de champ RHF — or
    // zod 4 a supprimé l'alias `.errors` (seul `.issues` subsiste sur ZodError). Ce test étant
    // toujours faux, l'ancien adaptateur relançait le ZodError au lieu de peupler
    // `formState.errors`. Dans `handleSubmit` (react-hook-form), `const { errors, values } =
    // await _runSchema()` n'est entouré d'aucun try/catch : la promesse retournée par `soumettre`
    // (passée telle quelle à `onSubmit` du <form>) rejetait alors sans jamais être awaitée par
    // React — un rejet de promesse non géré — et aucun message d'erreur n'apparaissait jamais
    // dans le DOM. Avec l'ancien adaptateur, les `findByText` ci-dessous auraient expiré
    // (timeout), pas échoué immédiatement : la validation ne renvoyait jamais d'erreur de champ.
    server.use(
      http.get('/api/v1/doublons-clients', () =>
        HttpResponse.json({ candidats: [] } satisfies ReponseDoublonsClients),
      ),
    );
    const utilisateur = userEvent.setup();
    const { onCree } = rendreFormulaire();

    // Nom vide (requis) + adresse PARTIELLE (seule la rue saisie) : depuis RF-59, une adresse
    // ENTIÈREMENT vide est acceptée (comptoir sans rendez-vous, cf. describe ci-dessous), mais une
    // adresse partielle reste refusée — ce scénario prouve encore plusieurs erreurs de champ
    // simultanées dans le DOM (nom, npa, localité), sans dépendre d'une adresse redevenue requise.
    await utilisateur.type(screen.getByLabelText('Rue et numéro'), 'Rue Neuve 5');
    await utilisateur.click(screen.getByRole('button', { name: 'Créer le client' }));

    // Les erreurs de champ apparaissent réellement dans le DOM (formState.errors peuplé), pas
    // seulement l'absence de throw.
    const erreursRequis = await screen.findAllByText('Ce champ est obligatoire.');
    expect(erreursRequis.length).toBeGreaterThanOrEqual(3); // nom, npa, localité

    expect(screen.getByLabelText('Nom')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('NPA')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Localité')).toHaveAttribute('aria-invalid', 'true');

    // La soumission n'a pas abouti — ni requête réseau, ni navigation.
    expect(onCree).not.toHaveBeenCalled();

    // La saisie n'est pas perdue : un champ déjà rempli reste rempli après l'échec de validation.
    await utilisateur.type(screen.getByLabelText('Nom'), 'Rossi');
    expect(screen.getByLabelText('Nom')).toHaveValue('Rossi');
  });

  it("crée directement quand l'aperçu de doublons ne remonte aucun candidat", async () => {
    server.use(
      http.get('/api/v1/doublons-clients', () =>
        HttpResponse.json({ candidats: [] } satisfies ReponseDoublonsClients),
      ),
      http.post('/api/v1/clients', () =>
        HttpResponse.json({ donnees: CLIENT_CREE, avertissements: [] }),
      ),
    );
    const utilisateur = userEvent.setup();
    const { onCree } = rendreFormulaire();

    await remplirIdentiteMinimale(utilisateur);
    await utilisateur.click(screen.getByRole('button', { name: 'Créer le client' }));

    // Issue #79 : `onCree` reçoit désormais la fiche COMPLÈTE (pas seulement l'id) — c'est ce que
    // `EcranListeClients` transmet à `EcranFicheClient` via l'état de navigation si la lecture qui
    // suit la création échoue (voir `EcranFicheClient.spec.tsx`).
    await waitFor(() => expect(onCree).toHaveBeenCalledWith(CLIENT_CREE));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ouvre la confirmation en deux temps (AvertissementConfirmable, pas un refus) quand un doublon probable existe, puis crée quand même', async () => {
    const REPONSE_DOUBLONS: ReponseDoublonsClients = {
      candidats: [
        {
          clientId: 'cl-1',
          numeroClient: 'CL-000001',
          nom: 'Isabelle Rossi',
          npa: '1000',
          critere: 'nom_npa',
          score: 0.92,
        },
      ],
    };
    server.use(
      http.get('/api/v1/doublons-clients', () => HttpResponse.json(REPONSE_DOUBLONS)),
      http.post('/api/v1/clients', () =>
        HttpResponse.json({ donnees: CLIENT_CREE, avertissements: [] }),
      ),
    );
    const utilisateur = userEvent.setup();
    const { onCree } = rendreFormulaire();

    await remplirIdentiteMinimale(utilisateur);

    // Aperçu live non bloquant : le candidat apparaît sous les champs avant toute soumission.
    // Timeout généreux (défaut 1000 ms sinon) : le composant applique un debounce de 400 ms avant
    // d'interroger /api/v1/doublons-clients (MSW), et l'ensemble peut dépasser la fenêtre par
    // défaut quand la suite tourne à pleine charge (CPU partagé entre workers) — sans que le
    // comportement réel change. Un timeout trop court ici fait échouer le test par lenteur
    // d'exécution, pas par régression du composant.
    expect(await screen.findByText(/Isabelle Rossi/, {}, { timeout: 3000 })).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Créer le client' }));

    const dialogue = await screen.findByRole('dialog');
    expect(within(dialogue).getByText('Doublons détectés')).toBeInTheDocument();
    expect(onCree).not.toHaveBeenCalled();

    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Créer quand même' }));

    await waitFor(() => expect(onCree).toHaveBeenCalledWith(CLIENT_CREE));
  });

  describe('propagation du site (?site=) au lien « Voir » d’un doublon', () => {
    const REPONSE_DOUBLONS: ReponseDoublonsClients = {
      candidats: [
        {
          clientId: 'cl-1',
          numeroClient: 'CL-000001',
          nom: 'Isabelle Rossi',
          npa: '1000',
          critere: 'nom_npa',
          score: 0.92,
        },
      ],
    };

    it('conserve `?site=` en ouvrant la fiche du doublon', async () => {
      server.use(http.get('/api/v1/doublons-clients', () => HttpResponse.json(REPONSE_DOUBLONS)));
      const utilisateur = userEvent.setup();
      const { routeur } = rendreFormulaire(vi.fn(), '/?site=site-1');

      await utilisateur.type(screen.getByLabelText('Nom'), 'Rossi');
      await utilisateur.click(await screen.findByRole('link', { name: 'Voir la fiche' }));

      expect(await screen.findByText('PAGE_FICHE_CLIENT')).toBeInTheDocument();
      expect(routeur.state.location.pathname).toBe('/clients/cl-1');
      expect(routeur.state.location.search).toBe('?site=site-1');
    });

    it('ne réinvente pas de `site` en ouvrant la fiche du doublon quand il est absent de l’URL', async () => {
      server.use(http.get('/api/v1/doublons-clients', () => HttpResponse.json(REPONSE_DOUBLONS)));
      const utilisateur = userEvent.setup();
      const { routeur } = rendreFormulaire(vi.fn(), '/');

      await utilisateur.type(screen.getByLabelText('Nom'), 'Rossi');
      await utilisateur.click(await screen.findByRole('link', { name: 'Voir la fiche' }));

      expect(await screen.findByText('PAGE_FICHE_CLIENT')).toBeInTheDocument();
      expect(routeur.state.location.search).toBe('');
    });
  });

  describe('défaut 1 — réinitialisation à la réouverture (corruption de saisie constatée en base)', () => {
    it("ne concatène jamais une saisie précédente à une nouvelle, MÊME quand le tiroir n'a jamais été démonté (brouillon rejeté explicitement)", async () => {
      server.use(
        http.get('/api/v1/doublons-clients', () =>
          HttpResponse.json({ candidats: [] } satisfies ReponseDoublonsClients),
        ),
      );
      const utilisateur = userEvent.setup();
      renduAvecRoutes([{ path: '/', element: <EnveloppeTiroir onCree={vi.fn()} /> }], {
        routeInitiale: '/',
      });

      // Reproduit exactement la donnée corrompue constatée : une raison sociale saisie pour une
      // tentative qui échoue (ou qu'on abandonne) sans jamais soumettre.
      await utilisateur.click(screen.getByRole('button', { name: 'Entreprise' }));
      await utilisateur.type(screen.getByLabelText('Raison sociale'), 'Café Zür-Brücke Sàrl');
      await utilisateur.type(screen.getByLabelText('Rue et numéro'), 'Place Centrale 3');
      await utilisateur.type(screen.getByLabelText('NPA'), '1920');
      await utilisateur.type(screen.getByLabelText('Localité'), 'Martigny');
      expect(screen.getByLabelText('Raison sociale')).toHaveValue('Café Zür-Brücke Sàrl');

      // Le tiroir « se ferme » puis « se rouvre » — SANS que `FormulaireNouveauClient` soit
      // démonté à aucun moment (`EnveloppeTiroir` le garde toujours dans l'arbre).
      await utilisateur.click(screen.getByRole('button', { name: 'Fermer le tiroir' }));
      await utilisateur.click(screen.getByRole('button', { name: 'Ouvrir le tiroir' }));

      // Issue #78 (postérieure au défaut 1) : la réouverture RESTAURE désormais la tentative
      // précédente au lieu de l'effacer silencieusement — annoncée par le bandeau de brouillon,
      // avec un moyen explicite de la rejeter (voir le describe « issue #78 » plus bas). On
      // rejette ICI ce brouillon pour reproduire fidèlement l'intention originale du défaut 1
      // (repartir d'une page blanche) et prouver que le coeur de sa garantie tient toujours :
      // aucune valeur de la tentative précédente ne doit JAMAIS se concaténer à une nouvelle
      // saisie sur le même champ.
      await utilisateur.click(screen.getByRole('button', { name: 'Ignorer le brouillon' }));

      // Le type revient au défaut (`particulier`) : les champs « entreprise » précédemment
      // remplis (Raison sociale/IDE) disparaissent complètement — remplacés par Nom/Prénom, tous
      // deux vides.
      expect(screen.queryByLabelText('Raison sociale')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Nom')).toHaveValue('');
      expect(screen.getByLabelText('Rue et numéro')).toHaveValue('');
      expect(screen.getByLabelText('NPA')).toHaveValue('');
      expect(screen.getByLabelText('Localité')).toHaveValue('');

      // La raison sociale de la tentative précédente ne resurgit pas non plus en repassant sur
      // « Entreprise » : preuve que `form.reset()` a bien vidé le champ RHF sous-jacent, pas
      // seulement masqué son affichage via le changement de type. Et le retour sur « Particulier »
      // ne fait pas non plus resurgir un « Nom » fantôme : les DEUX bascules sont propres.
      await utilisateur.click(screen.getByRole('button', { name: 'Entreprise' }));
      expect(screen.getByLabelText('Raison sociale')).toHaveValue('');
      await utilisateur.click(screen.getByRole('button', { name: 'Particulier' }));
      expect(screen.getByLabelText('Nom')).toHaveValue('');

      // Une NOUVELLE saisie, après réouverture, reste intacte (pas d'insertion dans un reliquat —
      // le symptôme exact du défaut 1 : « Café Zür-BrücCafé Zür-Brücke Sàrlke Sàrl »).
      await utilisateur.type(screen.getByLabelText('Nom'), 'Rossi');
      expect(screen.getByLabelText('Nom')).toHaveValue('Rossi');
    });
  });

  describe('issue #78 — le panneau perdait la saisie sur une fermeture accidentelle (Échap, clic hors du panneau)', () => {
    it("restaure la saisie ET l'annonce via un bandeau, à la réouverture d'un tiroir resté monté", async () => {
      server.use(
        http.get('/api/v1/doublons-clients', () =>
          HttpResponse.json({ candidats: [] } satisfies ReponseDoublonsClients),
        ),
      );
      const utilisateur = userEvent.setup();
      renduAvecRoutes([{ path: '/', element: <EnveloppeTiroir onCree={vi.fn()} /> }], {
        routeInitiale: '/',
      });

      // Verbatim terrain (issue #78) : « Nom, prénom, téléphone, rue : tout parti. »
      await utilisateur.type(screen.getByLabelText('Nom'), 'Rossier');
      await utilisateur.type(screen.getByLabelText('Prénom'), 'Jean');
      await utilisateur.type(screen.getByLabelText('Téléphone'), '079 123 45 67');
      await utilisateur.type(screen.getByLabelText('Rue et numéro'), 'Rue du Lac 8');

      // Aucun bandeau tant que rien n'a été perdu — il n'apparaît qu'à la REPRISE d'un brouillon,
      // jamais pendant la saisie elle-même.
      expect(screen.queryByText(/Brouillon repris de/)).not.toBeInTheDocument();

      // Le tiroir « se ferme » puis « se rouvre » — représente aussi bien une fermeture EXPLICITE
      // (bouton visible) qu'une fermeture accidentelle qu'`EcranListeClients` n'aurait pas
      // bloquée (voir `EcranListeClients.spec.tsx` pour le garde-fou Échap/clic extérieur
      // lui-même) : dans les deux cas, plus rien ne doit dépendre de CETTE instance React précise
      // pour retrouver la saisie.
      await utilisateur.click(screen.getByRole('button', { name: 'Fermer le tiroir' }));
      await utilisateur.click(screen.getByRole('button', { name: 'Ouvrir le tiroir' }));

      expect(screen.getByLabelText('Nom')).toHaveValue('Rossier');
      expect(screen.getByLabelText('Prénom')).toHaveValue('Jean');
      // Le téléphone n'est jamais persisté dans le brouillon (donnée personnelle).
      expect(screen.getByLabelText('Téléphone')).toHaveValue('');
      expect(screen.getByLabelText('Rue et numéro')).toHaveValue('Rue du Lac 8');
      expect(screen.getByText(/Brouillon repris de/)).toBeInTheDocument();
    });

    it('« Ignorer le brouillon » vide le formulaire et fait disparaître le bandeau', async () => {
      server.use(
        http.get('/api/v1/doublons-clients', () =>
          HttpResponse.json({ candidats: [] } satisfies ReponseDoublonsClients),
        ),
      );
      const utilisateur = userEvent.setup();
      renduAvecRoutes([{ path: '/', element: <EnveloppeTiroir onCree={vi.fn()} /> }], {
        routeInitiale: '/',
      });

      await utilisateur.type(screen.getByLabelText('Nom'), 'Rossier');
      await utilisateur.click(screen.getByRole('button', { name: 'Fermer le tiroir' }));
      await utilisateur.click(screen.getByRole('button', { name: 'Ouvrir le tiroir' }));
      expect(await screen.findByText(/Brouillon repris de/)).toBeInTheDocument();

      await utilisateur.click(screen.getByRole('button', { name: 'Ignorer le brouillon' }));

      expect(screen.queryByText(/Brouillon repris de/)).not.toBeInTheDocument();
      expect(screen.getByLabelText('Nom')).toHaveValue('');

      // Preuve FONCTIONNELLE que le rejet a bien été pris en compte, pas seulement l'écran
      // courant : une réouverture SUIVANTE ne restaure plus rien. `lireBrouillon` peut réécrire un
      // enregistrement techniquement non vide juste après (le vidage des champs redéclenche
      // `useSauvegardeBrouillon`, même artefact accepté et documenté sur le correctif jumeau
      // `FormulaireNouvelOrdreReparation`, issue #77) — ce n'est jamais RESTAURÉ tant que son
      // contenu est vide (`brouillonEstVide`), donc invisible et sans effet pour l'utilisateur.
      await utilisateur.click(screen.getByRole('button', { name: 'Fermer le tiroir' }));
      await utilisateur.click(screen.getByRole('button', { name: 'Ouvrir le tiroir' }));
      expect(screen.queryByText(/Brouillon repris de/)).not.toBeInTheDocument();
      expect(screen.getByLabelText('Nom')).toHaveValue('');
    });

    it('efface le brouillon après une création réussie — il ne doit jamais resurgir pour le client suivant', async () => {
      server.use(
        http.get('/api/v1/doublons-clients', () =>
          HttpResponse.json({ candidats: [] } satisfies ReponseDoublonsClients),
        ),
        http.post('/api/v1/clients', () =>
          HttpResponse.json({ donnees: CLIENT_CREE, avertissements: [] }),
        ),
      );
      const utilisateur = userEvent.setup();
      const { onCree } = rendreFormulaire();

      await remplirIdentiteMinimale(utilisateur);
      // Le brouillon existe bel et bien avant la soumission — condition nécessaire pour que
      // « effacé APRÈS succès » soit une preuve, pas un non-événement.
      expect(lireBrouillon(CLE_BROUILLON_NOUVEAU_CLIENT)).toBeDefined();

      await utilisateur.click(screen.getByRole('button', { name: 'Créer le client' }));

      await waitFor(() => expect(onCree).toHaveBeenCalledWith(CLIENT_CREE));
      // Sans ce nettoyage, le tiroir suivant reprendrait l'identité du client PRÉCÉDENT — le
      // risque nommé dans le correctif jumeau (`FormulaireNouvelOrdreReparation`, issue #77).
      expect(lireBrouillon(CLE_BROUILLON_NOUVEAU_CLIENT)).toBeUndefined();
    });
  });

  describe('défaut 2 — validation qui bloque la soumission sans jamais afficher son message (IDE)', () => {
    it("affiche l'erreur sur le champ IDE et n'envoie AUCUNE requête réseau quand l'IDE est mal formé", async () => {
      server.use(
        http.get('/api/v1/doublons-clients', () =>
          HttpResponse.json({ candidats: [] } satisfies ReponseDoublonsClients),
        ),
      );
      // Volontairement AUCUN handler `POST /clients` enregistré : `server.listen({
      // onUnhandledRequest: 'error' })` (test/setup.ts) fait échouer le test si la moindre
      // requête part malgré tout — la preuve la plus directe qu'aucun réseau n'est déclenché.
      const utilisateur = userEvent.setup();
      const { onCree } = rendreFormulaire();

      await utilisateur.click(screen.getByRole('button', { name: 'Entreprise' }));
      await utilisateur.type(screen.getByLabelText('Raison sociale'), 'Garage Exemple Sàrl');
      await utilisateur.type(screen.getByLabelText('Rue et numéro'), 'Rue Neuve 5');
      await utilisateur.type(screen.getByLabelText('NPA'), '1000');
      await utilisateur.type(screen.getByLabelText('Localité'), 'Lausanne');
      await utilisateur.type(screen.getByLabelText("N° d'entreprise (IDE)"), '12345');

      await utilisateur.click(screen.getByRole('button', { name: 'Créer le client' }));

      // Avant le correctif : rien ne s'affichait ici (impasse silencieuse).
      expect(
        await screen.findByText(
          'Certaines informations sont incorrectes ou incomplètes. Corrigez les champs signalés, puis réessayez.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("N° d'entreprise (IDE)")).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      expect(onCree).not.toHaveBeenCalled();

      // Avec un IDE valide, la même soumission part normalement (pas de régression du chemin
      // heureux) : on corrige le champ et on reconfirme que le formulaire se débloque.
      const clientEntreprise: ReponseClient = {
        ...CLIENT_CREE,
        id: 'cl-99',
        numeroClient: 'CL-000099',
        type: 'entreprise',
        raisonSociale: 'Garage Exemple Sàrl',
        nom: null,
        nomAffiche: 'Garage Exemple Sàrl',
      };
      server.use(
        http.post('/api/v1/clients', () =>
          HttpResponse.json({ donnees: clientEntreprise, avertissements: [] }),
        ),
      );
      await utilisateur.clear(screen.getByLabelText("N° d'entreprise (IDE)"));
      await utilisateur.type(screen.getByLabelText("N° d'entreprise (IDE)"), 'CHE-116.281.277');
      await utilisateur.click(screen.getByRole('button', { name: 'Créer le client' }));
      await waitFor(() => expect(onCree).toHaveBeenCalledWith(clientEntreprise));
    });
  });

  describe('adresse à la création (comptoir sans rendez-vous)', () => {
    // Défaut réel constaté en parcourant l'application comme un réceptionniste : un client se
    // présente sans rendez-vous, on veut ouvrir un OR tout de suite, l'adresse suivra — ou pas, s'il
    // paie comptant en repartant. Arbitrage rendu (RF-59) : `schemaCreationClient.adressePrincipale`
    // (`packages/shared/src/contrats/atelier/client.ts`) est désormais `.optional()` — l'aval
    // (émission de facture avec `debiteur: null`) gère déjà l'absence, prouvé en exécution avant ce
    // correctif. Ce test encodait le comportement cible en `it.fails` tant que le contrat bloquait ;
    // repassé en `it` normal maintenant qu'il passe.
    it('crée un client particulier sans indiquer aucune adresse', async () => {
      const clientSansAdresse: ReponseClient = { ...CLIENT_CREE, id: 'cl-sans-adresse' };
      server.use(
        http.get('/api/v1/doublons-clients', () =>
          HttpResponse.json({ candidats: [] } satisfies ReponseDoublonsClients),
        ),
        http.post('/api/v1/clients', () =>
          HttpResponse.json({ donnees: clientSansAdresse, avertissements: [] }),
        ),
      );
      const utilisateur = userEvent.setup();
      const { onCree } = rendreFormulaire();

      // Volontairement AUCUN champ d'adresse rempli — seule l'identité minimale.
      await utilisateur.type(screen.getByLabelText('Nom'), 'Rossi');
      await utilisateur.click(screen.getByRole('button', { name: 'Créer le client' }));

      await waitFor(() => expect(onCree).toHaveBeenCalledWith(clientSansAdresse));
    });

    it('conserve l’adresse saisie telle quelle dans la requête de création (aucune perte de saisie)', async () => {
      let corpsRecu: Record<string, unknown> | undefined;
      server.use(
        http.get('/api/v1/doublons-clients', () =>
          HttpResponse.json({ candidats: [] } satisfies ReponseDoublonsClients),
        ),
        http.post('/api/v1/clients', async ({ request }) => {
          corpsRecu = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ donnees: CLIENT_CREE, avertissements: [] });
        }),
      );
      const utilisateur = userEvent.setup();
      const { onCree } = rendreFormulaire();

      await remplirIdentiteMinimale(utilisateur);
      await utilisateur.click(screen.getByRole('button', { name: 'Créer le client' }));

      await waitFor(() => expect(onCree).toHaveBeenCalledWith(CLIENT_CREE));
      expect(corpsRecu?.adressePrincipale).toMatchObject({
        rue: 'Rue Neuve 5',
        npa: '1000',
        localite: 'Lausanne',
      });
    });
  });

  describe('défaut 3 — messages métier du serveur perdus (erreurs de champ)', () => {
    it('affiche le message serveur SUR le champ concerné pour un code métier (non-zod), au lieu du seul bandeau générique', async () => {
      server.use(
        http.get('/api/v1/doublons-clients', () =>
          HttpResponse.json({ candidats: [] } satisfies ReponseDoublonsClients),
        ),
        http.post('/api/v1/clients', () =>
          HttpResponse.json(
            {
              type: 'https://docs.dmsforall.example/erreurs/VALIDATION_ECHOUEE',
              title: 'Validation échouée',
              status: 400,
              code: 'VALIDATION_ECHOUEE',
              instance: 'req-champ-1',
              erreurs: [
                {
                  champ: 'nom',
                  code: 'nom_client_conflit',
                  message: 'Un client « Rossi » existe déjà avec ce numéro de téléphone.',
                },
              ],
            },
            { status: 400, headers: { 'content-type': 'application/problem+json' } },
          ),
        ),
      );
      const utilisateur = userEvent.setup();
      const { onCree } = rendreFormulaire();

      await remplirIdentiteMinimale(utilisateur);
      await utilisateur.click(screen.getByRole('button', { name: 'Créer le client' }));

      expect(
        await screen.findByText('Un client « Rossi » existe déjà avec ce numéro de téléphone.'),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Nom')).toHaveAttribute('aria-invalid', 'true');
      expect(onCree).not.toHaveBeenCalled();
    });

    it('traduit un code natif zod connu (e-mail refusé par le serveur) via la clé i18n existante, sans jamais afficher le message anglais brut', async () => {
      server.use(
        http.get('/api/v1/doublons-clients', () =>
          HttpResponse.json({ candidats: [] } satisfies ReponseDoublonsClients),
        ),
        http.post('/api/v1/clients', () =>
          HttpResponse.json(
            {
              type: 'https://docs.dmsforall.example/erreurs/VALIDATION_ECHOUEE',
              title: 'Validation échouée',
              status: 400,
              code: 'VALIDATION_ECHOUEE',
              instance: 'req-champ-2',
              erreurs: [
                { champ: 'email', code: 'invalid_format', message: 'Invalid email address' },
              ],
            },
            { status: 400, headers: { 'content-type': 'application/problem+json' } },
          ),
        ),
      );
      const utilisateur = userEvent.setup();
      const { onCree } = rendreFormulaire();

      await remplirIdentiteMinimale(utilisateur);
      await utilisateur.type(screen.getByLabelText('E-mail'), 'jean@example.com');
      await utilisateur.click(screen.getByRole('button', { name: 'Créer le client' }));

      expect(await screen.findByText("Cette adresse e-mail n'est pas valide.")).toBeInTheDocument();
      expect(screen.getByLabelText('E-mail')).toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByText(/Invalid email address/)).not.toBeInTheDocument();
      expect(onCree).not.toHaveBeenCalled();
    });
  });

  describe('issue #79 — un échec réseau sur la création laisse croire que rien n’a été tenté', () => {
    it('affiche « Connexion impossible » ET une précision : rejouer ne créera pas de doublon (même clé d’idempotence)', async () => {
      server.use(
        http.get('/api/v1/doublons-clients', () =>
          HttpResponse.json({ candidats: [] } satisfies ReponseDoublonsClients),
        ),
        http.post('/api/v1/clients', () => HttpResponse.error()),
      );
      const utilisateur = userEvent.setup();
      const { onCree } = rendreFormulaire();

      await remplirIdentiteMinimale(utilisateur);
      await utilisateur.click(screen.getByRole('button', { name: 'Créer le client' }));

      expect(await screen.findByText('Connexion impossible')).toBeInTheDocument();
      // Verbatim terrain (client Rossier, CL-000013) : sans cette précision, le seul message
      // affiché laisse croire que rien n'a été tenté, ce qui a failli faire ressaisir le client
      // une seconde fois — un doublon, en garage, s'adresse au mauvais dossier.
      expect(await screen.findByText(/ne créera pas de doublon/)).toBeInTheDocument();
      expect(onCree).not.toHaveBeenCalled();
      // La saisie survit à l'échec réseau — un réceptionniste qui rejoue ne retape rien.
      expect(screen.getByLabelText('Nom')).toHaveValue('Rossi');
    });
  });
});
