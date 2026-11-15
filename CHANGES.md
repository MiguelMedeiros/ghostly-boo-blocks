# Changes

Each version Boo Blocks publishes, newest first. The manifest's `releaseNotes` is the one line people see with an update.

## Unreleased

- A person in the sea climbs out onto the shore: swimming up against a block one above the water, with the head out,
  they come up as from a jump. Before, swimming topped out with the feet just under the water's top, so no shore could
  be reached and the only way out was to fly.
- A block picked from the hotbar with the mouse or a finger gives the keys back to the world. Before, the slot kept
  the focus and took Space and Enter for itself, so holding Space neither jumped nor flew up until the person clicked
  the world again. A slot picked by keyboard keeps the focus, as before.

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
