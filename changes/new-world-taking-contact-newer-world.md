- New world, and taking the contact's newer world, no longer leave the old world's blocks in the new one when the page
  closes (a reload, another chat) while the old blocks are being deleted: the stored world says which world its pages
  belong to, and the next open finishes deleting them. A delete that fails no longer stops the contact being told of
  the new world; it is tried again later. The stored `world` gets an `o` field while the deletes are pending (1.0.1
  ignores it).
