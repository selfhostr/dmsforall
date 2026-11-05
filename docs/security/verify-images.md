---
title: Verify the images
description: How to check the dmsforall container images and release files, and which checks are configured but have not run yet.
---

At the end of this page, you can verify an image or a release file with the commands below, and you know which checks have not run yet.

:::caution
The release workflow is configured to sign images, attach a software bill of materials (SBOM) and publish build attestations. None of these has run yet, because no release has been published. Until the first release, there is nothing to verify with the commands below. Use the digest and the source build in the meantime.
:::

## Release workflow, once a release exists

Each image is built with an SBOM (SPDX), a SLSA build provenance attestation and a keyless Sigstore signature. Verify an image with the GitHub CLI:

```sh
gh attestation verify oci://ghcr.io/selfhostr/dmsforall:<tag> -R selfhostr/dmsforall
```

Verify the Sigstore signature with cosign:

```sh
cosign verify ghcr.io/selfhostr/dmsforall:<tag> \
  --certificate-identity-regexp 'https://github.com/selfhostr/dmsforall/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Release files carry a `.sha256` checksum and a `.sigstore.json` bundle. Check a file with `sha256sum -c` and verify its bundle with `cosign verify-blob`.

Repeat the commands for `ghcr.io/selfhostr/dmsforall-web:<tag>`.

## Pin the images by digest

Use a tag for the version, and a digest for the exact image you tested:

```sh
docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/selfhostr/dmsforall:<tag>
```

Set the digest in `.env` as `DFA_VERSION` or in your own deployment file, and keep a written record of the digests you tested.

## Build the images from a tag

Check out a tag, then build the images from the repository:

```sh
git clone --branch <tag> https://github.com/selfhostr/dmsforall.git && cd dmsforall
docker compose -f docker-compose.yml -f docker-compose.build.yml build
```

Building gives you the code of the tag, but not a signature. Compare the result with the source you checked out.

## Status

| Check                                 | Status                   |
| ------------------------------------- | ------------------------ |
| Image signature (cosign)              | Configured, not yet run. |
| Build provenance attestation          | Configured, not yet run. |
| SBOM (SPDX)                           | Configured, not yet run. |
| Release file checksums and signatures | Configured, not yet run. |
| Digest pinning                        | Available now.           |
| Build from a tag                      | Available now.           |

This page will be updated after the first release has been checked.
