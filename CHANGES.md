# Changes

Each version Boo Blocks publishes, newest first. The manifest's `releaseNotes` is the one line people see with an update.

## Unreleased

- How to play and New world stand above the top bar, the hotbar and the touch buttons. In a short window (a phone on
  its side, a small window on a computer) the hotbar covered the help's Close button, so a click there picked a block
  instead, and the touch buttons still moved the person behind an open dialog.

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
