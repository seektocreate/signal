// Signal v1 source list. The frontier-lab builders and founders we monitor
// for signal. Edit this file to change Signal's coverage.

export const SIGNAL_HANDLES = [
  "AnthropicAI",
  "merettm",
  "JeffDean",
  "DarioAmodei",
  "GoogleDeepMind",
  "JustinLin610",
  "OpenAI",
  "ilyasut",
  "demishassabis",
  "MillionInt",
  "LiamFedus",
  "alexandr_wang",
  "miramurati",
  "arthurmensch",
  "sama",
] as const;

export type SignalHandle = (typeof SIGNAL_HANDLES)[number];
