# The Boo Blocks protocol

What two Boo Blocks send each other over a Ghostly chat (`apps/1` data frames, WISP 1200), and what each keeps. For a
bot, another client, or a later version that must stay compatible. The code is `src/protocol.ts` (frames and their
checks), `src/sync.ts` (when each is sent), `src/world.ts` (the world and the merge) and `src/codec.ts` (records).

## The world

A world is 128 × 64 × 128 cells (x, y, z), one block id (a byte) each. It is made of two parts:

- **The ground**, made from the world's id `[generator, seed, epoch]` by `src/terrain.ts`. Generator 1 uses only
  integer hashing and `+ - * /` on small numbers, so every engine makes the same bytes; the browser specs check that
  Chromium and WebKit agree with Node. A chat's first world is generator 1, seed `27404` (`0x6b0c`), epoch 0, the
  same for everyone, so two people who each start alone build on the same ground.
- **The edits**: every cell someone changed, with a stamp. A stamp is a Lamport clock (1 to 2³² − 1) and the block.
  Of two stamps for one cell the higher clock wins; on equal clocks, the higher block id. A side makes its next edit
  with the highest clock it has seen plus one. Merging is per cell and needs nothing else: any order, any number of
  times, gives the same world on both sides.

Cell index: `(y × 128 + z) × 128 + x`. Sections are 16 × 16 × 16 (256 of them); a cell's index in its section is
`(y mod 16 × 16 + z mod 16) × 16 + x mod 16`, sections numbered the same way as cells.

A section's **hash** is FNV-1a (32 bits) over its edits sorted by cell, each as the cell index, the clock and the
block, each a 32-bit little-endian number; 0 for a section with no edits. It is sent as a signed 32-bit integer.

At most 400,000 cells are edited in a world; past that, a new cell is refused (one already edited can still change).

## Frames

Every frame is a JSON object with `t`. Unknown keys are ignored. A frame that fails a check is dropped whole.

| `t` | Keys | When |
|---|---|---|
| `hello` | `p` protocol (1), `v` the app version, `n` the person's name (optional, at most 32 characters shown), `w` world id `[generator, seed, epoch]`, `h` the 256 section hashes, `a` 1 to ask for the contact's hello in answer (optional) | When the contact opens Boo Blocks while this side has it open (the `chat.peer` event, or `context().peer` at start), again after taking a newer world, and with `a: 1` two seconds after a frame was refused as `offline` while the contact is still there |
| `sec` | `w`, `k` section (0 to 255), `e` records | For each section whose hash differs from the contact's hello, when this side has edits there: all of its edits, in frames of at most 3000 records |
| `tick` | `w`, `p` pose `[x, y, z, yaw, pitch]` (optional), `e` records (optional) | Up to ten a second while both are in: the edits made since the last tick, and the pose when it moved (or once a second) |

Records are base64url without padding of fixed-size big-endian records:

- in `sec`: 7 bytes each, the cell's index in its section (2), the block (1), the clock (4);
- in `tick`: 8 bytes each, the cell's index in the world (3), the block (1), the clock (4).

A `sec` or `tick` whose `w` is not this side's world is ignored.

## Catching up

1. Both say `hello`.
2. If the worlds differ, both keep the **newer** one: the higher epoch, then the higher seed, then the higher
   generator. The side whose world lost drops its edits, takes the other's world, and says `hello` again (its hashes
   all 0 now). A generator a side does not know, or a protocol above its own, makes it say the contact needs a newer
   Boo Blocks, and it keeps its own world.
3. With the same world, each side sends `sec` frames for every section where its hash differs from the contact's and
   it has edits, and merges what it gets. Both end with the union.

Nothing is queued while the contact is away: a `tick` that does not go is lost, and the next hello finds what
differs. The client answers `offline` also when the chat's channel has no room for a frame (a long catch-up on a slow
link) while the contact is still there; Boo Blocks then says hello again with `a: 1` two seconds later, and both sides
send what still differs. **New world** (the menu) is a new random seed with the epoch one higher, so it wins on both sides.

## Storage

Per chat (and alone), in the app's storage (WISP 1200, 5 MiB a scope):

| Key | Value |
|---|---|
| `world` | `{"v": 1, "w": [generator, seed, epoch]}` |
| `p0`, `p1`, … | Pages of edits, each up to 5000 `tick`-style 8-byte records in base64url (under the 64 KiB a value may be). A cell stays in the page it was first written to |
| `me` | Where this side's person stood: `[x, y, z, yaw, pitch, flying]` |

400,000 edits fill about 4.3 MB with the keys' own cost, under the 5 MiB. A world made by a later generator than
this version knows is left alone, and the page asks to update.

## Rate

The broker takes at most 50 requests a second from an app, storage and frames together. Boo Blocks keeps under 40 with
one limiter (`src/limiter.ts`) for every call, frames first: ten ticks a second, section frames at most twenty a
second while catching up, pages written at most once a second.
