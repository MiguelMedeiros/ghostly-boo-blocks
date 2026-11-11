# Changes

Each version Boo Blocks publishes, newest first. The manifest's `releaseNotes` is the one line people see with an update.

## Unreleased

- New world, and taking the contact's newer world, no longer leave the old world's blocks in the new one when the page
  closes (a reload, another chat) while the old blocks are being deleted: the stored world says which world its pages
  belong to, and the next open finishes deleting them. A delete that fails no longer stops the contact being told of
  the new world; it is tried again later. The stored `world` gets an `o` field while the deletes are pending (1.0.1
  ignores it).
- An edit made in the moment between the contact's hello and the event that says they opened (under a tenth of a
  second) now reaches them; before, it stayed on this side until the next time both opened Boo Blocks.

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
