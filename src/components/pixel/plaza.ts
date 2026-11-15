import type { PixelArt } from "./pixel-icon";

/*
 * Decor of the friends plaza (ADR-155): trees, lamps, benches, a fountain, bushes. Pure data.
 */

export const PLAZA_TREE: PixelArt = {
  palette: { g: "#2fae5a", G: "#1f7a3e", l: "#6fdc8c", t: "#8a5a32", T: "#5e3a20", k: "#173a24" },
  grid: [
    "......kkkk......",
    "....kkllggkk....",
    "...klllggggGk...",
    "..kllgggggggGk..",
    "..klggggggggGk..",
    ".kllgggggggggGk.",
    ".klgggggggggGGk.",
    ".kgggggggggGGGk.",
    ".kggggglggGGGGk.",
    "..kggglgggGGGk..",
    "..kGgggggGGGGk..",
    "...kGGGGGGGGk...",
    "....kkkttkkk....",
    "......ktTk......",
    "......ktTk......",
    "......ktTk......",
    ".....kttTTk.....",
    "....kkkkkkkk....",
  ],
};

export const PLAZA_LAMP: PixelArt = {
  palette: { y: "#ffe9a0", Y: "#ffd84a", m: "#3a4157", M: "#5d6679", k: "#232634" },
  grid: [
    "...kk...",
    "..kMMk..",
    ".kMMMMk.",
    ".kyyYYk.",
    ".kyyYYk.",
    ".kmmmmk.",
    "...mk...",
    "...mk...",
    "...mk...",
    "...mk...",
    "...mk...",
    "...mk...",
    "...mk...",
    "...mk...",
    "...mk...",
    "...mk...",
    "..mmkk..",
    ".kkkkkk.",
  ],
};

export const PLAZA_BENCH: PixelArt = {
  palette: { w: "#b07a44", W: "#8a5a30", m: "#3a4157", k: "#232634" },
  grid: [
    "kkkkkkkkkkkkkkkkkk",
    "kwwwwwwwwwwwwwwwwk",
    "kWWWWWWWWWWWWWWWWk",
    "kkkkkkkkkkkkkkkkkk",
    ".km............mk.",
    "kkkkkkkkkkkkkkkkkk",
    "kwwwwwwwwwwwwwwwwk",
    "kkkkkkkkkkkkkkkkkk",
    ".km............mk.",
    ".km............mk.",
  ],
};

export const PLAZA_FOUNTAIN: PixelArt = {
  palette: { s: "#c9ced9", S: "#8f9bb3", k: "#4a5068", w: "#62e0ff", W: "#2a9fd6", l: "#e8fbff" },
  grid: [
    "............llll............",
    "...........lw..wl...........",
    "..........lww..wwl..........",
    ".........kkkk..kkkk.........",
    "..........kS....Sk..........",
    ".......lw.kS....Sk.wl.......",
    "......lwwkSSk..kSSkwwl......",
    "....kkkkkkkkkkkkkkkkkkkk....",
    "...kssssssssssssssssssssk...",
    "...kSSSSSSSSSSSSSSSSSSSSk...",
    "....kwwWwwwWwwwwWwwwWwwk....",
    "..kkkkkkkkkkkkkkkkkkkkkkkk..",
    ".ksssssssssss..sssssssssssk.",
    "ksSSSSSSSSSSSSSSSSSSSSSSSSsk",
    "kswwlwwWwwwlwwwwlwwwWwwlwwsk",
    "kswWwwwwlwwWwwwwWwwlwwwwWwsk",
    "kssssssssssss..ssssssssssssk",
    ".kSSSSSSSSSSSSSSSSSSSSSSSSk.",
    "..kkkkkkkkkkkkkkkkkkkkkkkk..",
  ],
};

export const PLAZA_BUSH: PixelArt = {
  palette: { g: "#2fae5a", G: "#1f7a3e", l: "#6fdc8c", p: "#ff5fa2", y: "#ffd84a", k: "#173a24" },
  grid: [
    "...kkkkkk...",
    "..klglggGk..",
    ".klgpgggyGk.",
    "klgggggpgGGk",
    "kgyggggggGGk",
    "kGgggpgggGGk",
    ".kGGGGGGGGk.",
    "..kkkkkkkk..",
  ],
};
