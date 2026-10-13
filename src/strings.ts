/**
 * Every string the page shows: English, and Brazilian Portuguese. Ghostly's other languages (Spanish, French,
 * Italian, Japanese, Chinese, Arabic) fall back to English for now. A missing string in a language fails the
 * typecheck.
 */
import type { BlockKind } from "./blocks.ts";

export interface Strings {
  title: string;
  alone: string;
  waiting: string;
  /** With the contact's name, or "your contact". */
  together: (name: string) => string;
  yourContact: string;
  contactLeft: (name: string) => string;
  contactCame: (name: string) => string;
  loading: string;
  noWebgl: string;
  newer: string;
  incompatible: string;
  storageFull: string;
  worldFull: string;
  storageFailed: string;
  worldReplaced: (name: string) => string;
  help: string;
  helpTitle: string;
  helpKeys: [string, string][];
  helpTouch: [string, string][];
  helpTogether: string;
  close: string;
  menu: string;
  newWorld: string;
  newWorldConfirm: string;
  newWorldYes: string;
  cancel: string;
  sound: string;
  fly: string;
  walk: string;
  jump: string;
  down: string;
  breakMode: string;
  placeMode: string;
  moveForward: string;
  moveBack: string;
  moveLeft: string;
  moveRight: string;
  blocks: Record<BlockKind["key"], string>;
}

export const en: Strings = {
  title: "Boo Blocks",
  alone: "Just you here. Open Boo Blocks in a chat to build with a contact.",
  waiting: "Waiting for your contact to open Boo Blocks",
  together: (name) => `Building with ${name}`,
  yourContact: "your contact",
  contactLeft: (name) => `${name} left. What you build now reaches them next time.`,
  contactCame: (name) => `${name} is here`,
  loading: "Loading the world…",
  noWebgl: "Boo Blocks needs WebGL 2 to draw its world, and this browser does not offer it here.",
  newer: "This world was made by a newer Boo Blocks. Update Boo Blocks to open it.",
  incompatible: "Your contact has a newer Boo Blocks. Update Boo Blocks to build together.",
  storageFull: "This chat's storage for Boo Blocks is full: new changes are not being kept.",
  worldFull: "The world is full of changes: break or place blocks where you already built.",
  storageFailed: "Boo Blocks could not save the world. Your changes are kept while it is open.",
  worldReplaced: (name) => `${name} started a new world.`,
  help: "How to play",
  helpTitle: "How to play",
  helpKeys: [
    ["Drag", "Look around"],
    ["W A S D", "Walk"],
    ["Space", "Jump, swim, fly up"],
    ["Shift", "Fly down"],
    ["F", "Fly or walk"],
    ["Click", "Break the block under the cursor"],
    ["Right-click", "Place a block"],
    ["1 to 9, wheel", "Choose a block"],
    ["Arrows", "Turn"],
    ["Q / E", "Break / place at the centre"],
  ],
  helpTouch: [
    ["Drag", "Look around"],
    ["Tap", "Break or place, as the hammer button says"],
    ["Arrows", "Walk"],
  ],
  helpTogether: "In a chat, your contact builds in the same world. Each of you keeps it for this chat, and the two merge whenever you are both in.",
  close: "Close",
  menu: "Menu",
  newWorld: "New world",
  newWorldConfirm: "Start a new world? Everything built here goes, for your contact too.",
  newWorldYes: "Start a new world",
  cancel: "Cancel",
  sound: "Sound",
  fly: "Fly",
  walk: "Walk",
  jump: "Jump",
  down: "Down",
  breakMode: "Breaking: tap to place instead",
  placeMode: "Placing: tap to break instead",
  moveForward: "Forward",
  moveBack: "Back",
  moveLeft: "Left",
  moveRight: "Right",
  blocks: {
    grass: "Grass",
    dirt: "Dirt",
    stone: "Stone",
    cobble: "Cobblestone",
    sand: "Sand",
    log: "Log",
    planks: "Planks",
    leaves: "Leaves",
    glass: "Glass",
    brick: "Brick",
    snow: "Snow",
    water: "Water",
    lantern: "Lantern",
    clay: "Clay",
    bedrock: "Bedrock",
  },
};

export const pt: Strings = {
  title: "Boo Blocks",
  alone: "Só você aqui. Abra o Boo Blocks numa conversa para construir com um contato.",
  waiting: "Esperando seu contato abrir o Boo Blocks",
  together: (name) => `Construindo com ${name}`,
  yourContact: "seu contato",
  contactLeft: (name) => `${name} saiu. O que você construir agora chega na próxima vez.`,
  contactCame: (name) => `${name} chegou`,
  loading: "Carregando o mundo…",
  noWebgl: "O Boo Blocks precisa de WebGL 2 para desenhar o mundo, e este navegador não oferece aqui.",
  newer: "Este mundo foi feito por um Boo Blocks mais novo. Atualize o Boo Blocks para abri-lo.",
  incompatible: "Seu contato tem um Boo Blocks mais novo. Atualize o Boo Blocks para construírem juntos.",
  storageFull: "O espaço do Boo Blocks nesta conversa acabou: as mudanças novas não estão sendo guardadas.",
  worldFull: "O mundo está cheio de mudanças: quebre ou coloque blocos onde já construiu.",
  storageFailed: "O Boo Blocks não conseguiu salvar o mundo. Suas mudanças ficam enquanto ele está aberto.",
  worldReplaced: (name) => `${name} começou um mundo novo.`,
  help: "Como jogar",
  helpTitle: "Como jogar",
  helpKeys: [
    ["Arrastar", "Olhar em volta"],
    ["W A S D", "Andar"],
    ["Espaço", "Pular, nadar, voar para cima"],
    ["Shift", "Voar para baixo"],
    ["F", "Voar ou andar"],
    ["Clique", "Quebrar o bloco sob o cursor"],
    ["Botão direito", "Colocar um bloco"],
    ["1 a 9, rodinha", "Escolher um bloco"],
    ["Setas", "Virar"],
    ["Q / E", "Quebrar / colocar no centro"],
  ],
  helpTouch: [
    ["Arrastar", "Olhar em volta"],
    ["Tocar", "Quebrar ou colocar, como diz o botão do martelo"],
    ["Setas", "Andar"],
  ],
  helpTogether: "Numa conversa, seu contato constrói no mesmo mundo. Cada um guarda o mundo desta conversa, e os dois se juntam sempre que vocês estão dentro.",
  close: "Fechar",
  menu: "Menu",
  newWorld: "Mundo novo",
  newWorldConfirm: "Começar um mundo novo? Tudo o que foi construído aqui some, para seu contato também.",
  newWorldYes: "Começar um mundo novo",
  cancel: "Cancelar",
  sound: "Som",
  fly: "Voar",
  walk: "Andar",
  jump: "Pular",
  down: "Descer",
  breakMode: "Quebrando: toque para colocar",
  placeMode: "Colocando: toque para quebrar",
  moveForward: "Frente",
  moveBack: "Trás",
  moveLeft: "Esquerda",
  moveRight: "Direita",
  blocks: {
    grass: "Grama",
    dirt: "Terra",
    stone: "Pedra",
    cobble: "Pedregulho",
    sand: "Areia",
    log: "Tronco",
    planks: "Tábuas",
    leaves: "Folhas",
    glass: "Vidro",
    brick: "Tijolo",
    snow: "Neve",
    water: "Água",
    lantern: "Lanterna",
    clay: "Argila",
    bedrock: "Rocha-mãe",
  },
};

/** The page's language for a BCP 47 tag: Portuguese for any `pt`, English otherwise. */
export function stringsFor(locale: string | undefined): { lang: string; strings: Strings } {
  return (locale ?? "").toLowerCase().startsWith("pt") ? { lang: "pt-BR", strings: pt } : { lang: "en", strings: en };
}
