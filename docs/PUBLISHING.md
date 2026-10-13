# Publishing a version of Boo Blocks

A version of Boo Blocks is published in three places, in this order (as Chess is, see ghostly-chess's
`docs/PUBLISHING.md`):

1. **This repository** holds the signed bundle, `app.ghostlyapp`, at its root. The manifest's `sources` names it.
2. **The Ghostly store** ([ghostly-store](https://github.com/MiguelMedeiros/ghostly-store)) holds Boo Blocks's
   `listing.json`: the version (`sequence` and `digest`) and the URLs clients fetch it from.
3. **The store's signed index** names that listing. A Boo Blocks installed from the store updates only to the version
   the signed index lists (WISP 1200, Updates and rollback).

Only the holder of the Boo Blocks publisher key can sign a version: Ghostly refuses an update signed by another key. The
key is never in this repository, in a pull request, in CI or in a chat. Everything up to "Sign" can be done by anyone
and is checked by CI; "Sign" and the store's index are the owner's steps.

| | |
|---|---|
| Manifest `name` | `boo-blocks` (the app's permanent id with the key) |
| Boo Blocks's reference | `<publisher key>/boo-blocks`, known once the first version is signed |
| Publisher key file (owner's machine only) | `~/ghostly-keys/boo-blocks-publisher.key`, made by the first `ghostly app publish` |
| Store folder | `apps/boo-blocks.<first 16 characters of the publisher key>/` |
| Published so far | Nothing yet. See [CHANGES.md](../CHANGES.md) |

## 1. Prepare the version (a pull request)

1. Raise `version` in `ghostly-app.json`, `package.json` and `package-lock.json` (`npm version <x.y.z>
   --no-git-tag-version` does the last two; `test/version.test.ts` fails when the three differ). Write
   `releaseNotes` in `ghostly-app.json`: one line, at most 500 characters.
2. Add the version to [CHANGES.md](../CHANGES.md).
3. Run everything:

   ```sh
   npm ci
   npm run typecheck
   npm test
   npx playwright install chromium webkit   # once
   npm run test:browser
   ```

4. Run Boo Blocks in Ghostly with two peers ([test/ghostly-e2e/README.md](../test/ghostly-e2e/README.md)), and tick the
   README's [Checked by hand](../README.md#checked-by-hand) in the pull request, with the client versions.
5. Merge it. The commit on `main` is the one that is built and signed.

## 2. Build and stage

On the commit to publish, with a clean tree:

```sh
git switch main && git pull && git status --short     # nothing listed
npm ci && npm test && npm run build
npm run digest                    # the page's size and SHA-256: the same as CI's summary for this commit
npm run stage                     # release/index.html + release/ghostly-app.json
```

The build is reproducible (`test/bundle.test.ts` builds twice and compares; the bundler is pinned by `overrides`),
so the digest `npm run digest` prints is the one CI printed for that commit. If they differ, stop.

`ghostly app publish` takes every file in the folder it is given, so it is run on `release/`, never on the
repository. `release/` is ignored by git.

## 3. Sign (the owner)

The Ghostly CLI (`@ghostlytools/cli` 1.2.2 or later, or one built from Ghostly's `dev`) has `app publish`, `app
verify` and `store sign`, and knows `view: "full"`.

**The first version** makes the publisher key. There is no bundle at `--out` yet, so the sequence is 1:

```sh
ghostly app publish release --key ~/ghostly-keys/boo-blocks-publisher.key --out app.ghostlyapp --pretty
ghostly app verify app.ghostlyapp --pretty
```

- `publish` says `"keyCreated": true` this once. **Back the key up**: an app is updated only with the key that
  signed it, and a lost key means publishing Boo Blocks again as a new app.
- `verify` says `"valid": true`, `"ref": "<key>/boo-blocks"`, the version and `"sequence": 1`.
- Set `PUBLISHER` in `scripts/bundle.mjs` to the key (the part of `ref` before `/boo-blocks`) and the reference in the
  table above, in the same commit as the bundle. Then `npm run check:bundle` says the bundle is this build under
  that key.

**Later versions** leave `--sequence` out: `publish` reads the bundle at `--out`, raises its sequence by one, and
refuses another key. `publish` must say `"keyCreated": false`; if it says `true`, the key path was wrong: delete the
new key file and the bundle, and sign again with the right path. Before signing, `npm run check:bundle -- --expect
<sequence>` prints the digest the signed bundle will have.

A sequence is never signed twice. If a signed bundle is wrong and was already pushed, publish the fix as the next
sequence.

## 4. Commit the bundle here

The bundle goes in a commit of its own, straight after the commit it was built from, so the store can pin it:

```sh
git add app.ghostlyapp scripts/bundle.mjs docs/PUBLISHING.md
git commit -m "Boo Blocks 1.0.0 (sequence 1)"
git push origin main
npm run check:bundle -- --listing     # prints the store's listing.json, pinned to that commit
ghostly app verify https://raw.githubusercontent.com/MiguelMedeiros/ghostly-boo-blocks/HEAD/app.ghostlyapp
ghostly app verify https://cdn.jsdelivr.net/gh/MiguelMedeiros/ghostly-boo-blocks@<the commit>/app.ghostlyapp
```

`.gitignore` lets in `app.ghostlyapp` at the root only. Never commit `release/`, another bundle or a key.

For a **private** repository, neither URL answers (raw GitHub and jsDelivr serve public repositories only): the
bundle then has to be served from somewhere public (the store's own folder, as Chess 1.0.x was) and `sources` in
`ghostly-app.json` changed to that URL before signing.

## 5. List it in the store, and sign the index (the owner)

In a clone of [ghostly-store](https://github.com/MiguelMedeiros/ghostly-store), on a branch:

1. Make `apps/boo-blocks.<first 16 characters of the key>/listing.json` from what `npm run check:bundle -- --listing`
   printed (the jsDelivr URL pinned to a full commit first, then `HEAD`).
2. Build and sign the index **in the same pull request as the listing**:

   ```sh
   npm ci
   npm run build-index -- --out /tmp/ghostly-store.draft.json
   ghostly store sign /tmp/ghostly-store.draft.json --key ~/ghostly-keys/store.key --out .
   GHOSTLY=~/code/ghostly scripts/check.sh        # "The store is valid."
   git add apps/boo-blocks.* ghostly-store.json ghostly-store.sig
   git commit -m "Boo Blocks 1.0.0 (sequence 1)"
   ```

3. Open the pull request; its check fetches both URLs and verifies the bundle as a client does. Merge when green.

## Revoking a version

`ghostly app revoke . --key ~/ghostly-keys/boo-blocks-publisher.key --up-to <sequence>` (or `--digest <digest>`) writes
`ghostly-revoke.json` beside `app.ghostlyapp`. Commit it here, copy it to the store's folder for Boo Blocks, and sign
the index.
