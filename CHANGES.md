# Changes

Each version Boo Blocks publishes, newest first. The manifest's `releaseNotes` is the one line people see with an update.

## Unreleased

- The published page has its `<main>` landmark too: the build wrote the page with a plain `<div>`, so the landmark
  above reached only the dev page. Start a new world's red button and a phone's Fly or place-mode button switched on
  read at 4.5:1 or more; before, white on red was 4.49:1, and Walk was white on purple at 3.99:1 (2.48:1 in the dark
  theme). A screen reader hears each hotbar slot's key (1-9, 0) as its shortcut, and no longer finds the picked
  block's name flashed over the hotbar as stray text outside the page's landmark.
- Screen readers: the world is an application to them, so it no longer sits as a silent, role-less stop that takes
  the focus (`role="application"`, named with the game and its keys), so W A S D, Q, E, the arrows and Space reach the
  game instead of being taken for reading. The notices' status line is always in the page (empty and unseen between
  notices), so "world full", "storage full" and "newer version" are read out the first time. Q and E say why when
  they do nothing (nothing in reach, a block that can't be broken, you or your contact in the way), at most once
  every 1.5 seconds; breaking a block in a full world now says the world is full too. The page's controls sit in a
  `<main>` landmark.
- The help and the New world question are named for a screen reader and keep the keyboard while open. Before, a
  screen reader said only "dialog"; the focus stayed behind them, and Tab from their buttons went on to the hotbar.
  Opened from ? or the menu, Close or Cancel has the keyboard, Tab goes round the dialog's buttons, and closing it
  gives the keys back to the world.
- A click with the mouse's wheel, or its back or forward button, breaks nothing. Before, every button but the right one
  broke the block under the cursor, so pressing the wheel while picking a block with it took a block away.
- A person in the sea climbs out onto the shore: swimming up against a block one above the water, with the head out,
  they come up as from a jump. Before, swimming topped out with the feet just under the water's top, so no shore could
  be reached and the only way out was to fly.
- A save of the old world's blocks refused (storage full or failed) just as New world starts, or as the contact's
  newer world arrives, no longer spoils the new world's next save. Before, it threw, the new world's first blocks were
  not saved until another edit came to their page, and "Storage full" could show for a world that is not full.
- A block picked from the hotbar with the mouse or a finger gives the keys back to the world. Before, the slot kept
  the focus and took Space and Enter for itself, so holding Space neither jumped nor flew up until the person clicked
  the world again. A slot picked by keyboard keeps the focus, as before.
- The wheel picks blocks a notch at a time on a trackpad too. Before, every wheel event moved one slot, so a short
  two-finger swipe went round the whole hotbar; now a slot goes by per 50 px of scroll, at most one per event, and
  the first event after a pause moves one slot at once, so a small Mac mouse notch still answers. A sideways scroll
  (Shift + wheel on macOS and in Chrome, while flying down) picks the next block, not the previous one, and an event
  with no movement picks nothing.
- A screen reader hears which block is picked in the hotbar (pressed), whether the ⋯ menu is open (expanded) and
  whether sound is on. Before, the picked slot and the sound switch showed it only by colour and by ✓ or ✗, which
  read out as "check mark" and "multiplication x".
- New world, and taking the contact's newer world, no longer leave the old world's blocks in the new one when the page
  closes (a reload, another chat) while the old blocks are being deleted: the stored world says which world its pages
  belong to, and the next open finishes deleting them. A delete that fails no longer stops the contact being told of
  the new world; it is tried again later. The stored `world` gets an `o` field while the deletes are pending (1.0.1
  ignores it).

## 1.0.1 (sequence 2)

- The page's count of changed blocks (`data-edits`, read by the end-to-end tests) is kept current on a timer too, not
  only in the frame loop: a window behind another gets few animation frames in WKWebView (Desktop on macOS).

## 1.0.0 (sequence 1)

The first version.

- A world of 128 × 128 blocks and 64 high: hills, beaches, a sea, snow on the peaks and trees, made from a seed the
  same way on every device.
- Fourteen blocks to place (grass, dirt, stone, cobblestone, planks, log, brick, glass, leaves, sand, snow, lantern,
  clay, water), drawn by code; sounds synthesized.
- Walk, jump, swim and fly. Look by dragging, build with the mouse or by keys; buttons on touch screens.
- In a chat: the contact's ghost with their name, both building live, and both copies of the world merging every time
  you are both in, so what one built alone reaches the other. The world and where you stood are kept per chat.
- New world, for both, from the menu.
- English and Brazilian Portuguese.
- Its own icon, drawn by code: a ghost holding a grass block.
