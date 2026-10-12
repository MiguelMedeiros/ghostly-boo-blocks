# Blocks in Ghostly's own end-to-end suite

`apps-blocks.spec.ts` runs the built Blocks inside a real Ghostly web client, two peers in one chat, on Ghostly's
e2e harness. It is kept here, not in Ghostly, and run from a checkout of Ghostly's `dev`:

```sh
npm run build                                  # here: dist/index.html
git clone --branch dev https://github.com/MiguelMedeiros/ghostly /tmp/ghostly-dev
cd /tmp/ghostly-dev && npm ci
cp ~/code/ghostly-blocks/test/ghostly-e2e/apps-blocks.spec.ts e2e/web/
BLOCKS_DIST=~/code/ghostly-blocks/dist/index.html \
BLOCKS_MANIFEST=~/code/ghostly-blocks/ghostly-app.json \
BLOCKS_SHOTS=/tmp/blocks-shots \
E2E_WEB_PORT=4391 \
npx playwright test -c e2e/playwright.config.ts --project=web apps-blocks
```

The spec signs a bundle of the build with a throwaway key made from a fixed label (as Ghostly's own app specs do)
and serves it, with a store that lists it, at `raw.githubusercontent.com` URLs answered by the test: nothing leaves
the machine and no real key is used. Ana installs Blocks from the store and opens it in her chat with Bob, Bob
installs it from her card, they build at once and see each other's name, each closes and reopens Blocks, Ana leaves
while Bob builds and gets his work when she comes back, and Bob reloads Ghostly and finds the same world.
`BLOCKS_SHOTS` (optional) is where it saves screenshots. Pick an `E2E_WEB_PORT` no other run uses: locally the suite
reuses a server already listening on its port.
