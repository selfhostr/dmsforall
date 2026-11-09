---
title: Vérifier les images
description: Comment contrôler les images de conteneurs et les fichiers de version de dmsforall, et quels contrôles sont configurés sans avoir encore été exécutés.
---

À la fin de cette page, vous pouvez vérifier une image ou un fichier de version avec les commandes ci-dessous, et vous savez quels contrôles n'ont pas encore été exécutés.

:::caution
Le workflow de publication est configuré pour signer les images, joindre une nomenclature logicielle (SBOM) et publier des attestations de build. Aucun de ces éléments n'a encore été exécuté, car aucune version n'a été publiée. Tant que la première version n'existe pas, il n'y a rien à vérifier avec les commandes ci-dessous. En attendant, utilisez l'empreinte (digest) et le build depuis les sources.
:::

## Workflow de publication, une fois une version disponible

Chaque image est construite avec une SBOM (SPDX), une attestation de provenance de build SLSA et une signature Sigstore sans clé (keyless). Vérifiez une image avec la GitHub CLI :

```sh
gh attestation verify oci://ghcr.io/selfhostr/dmsforall:<tag> -R selfhostr/dmsforall
```

Vérifiez la signature Sigstore avec cosign :

```sh
cosign verify ghcr.io/selfhostr/dmsforall:<tag> \
  --certificate-identity-regexp 'https://github.com/selfhostr/dmsforall/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Les fichiers de version contiennent une somme de contrôle `.sha256` et un bundle `.sigstore.json`. Vérifiez un fichier avec `sha256sum -c` et son bundle avec `cosign verify-blob`.

Répétez les commandes pour `ghcr.io/selfhostr/dmsforall-web:<tag>`.

## Figer les images par empreinte

Utilisez un tag pour la version, et une empreinte pour l'image exacte que vous avez testée :

```sh
docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/selfhostr/dmsforall:<tag>
```

Renseignez l'empreinte dans `.env` sous la forme `DFA_VERSION`, ou dans votre propre fichier de déploiement, et conservez une trace écrite des empreintes que vous avez testées.

## Construire les images depuis un tag

Récupérez un tag, puis construisez les images depuis le dépôt :

```sh
git clone --branch <tag> https://github.com/selfhostr/dmsforall.git && cd dmsforall
docker compose -f docker-compose.yml -f docker-compose.build.yml build
```

La construction vous donne le code du tag, mais pas de signature. Comparez le résultat avec les sources que vous avez récupérées.

## État

| Contrôle                                                 | État                               |
| -------------------------------------------------------- | ---------------------------------- |
| Signature de l'image (cosign)                            | Configurée, pas encore exécutée.   |
| Attestation de provenance du build                       | Configurée, pas encore exécutée.   |
| SBOM (SPDX)                                              | Configurée, pas encore exécutée.   |
| Sommes de contrôle et signatures des fichiers de version | Configurées, pas encore exécutées. |
| Figer par empreinte                                      | Disponible maintenant.             |
| Construction depuis un tag                               | Disponible maintenant.             |

Cette page sera mise à jour après la vérification de la première version.
