// Compartment colors.
//
// Validated with the dataviz palette checker rather than chosen by eye. Both
// modes pass the lightness band, adjacent-pair CVD separation, the
// normal-vision floor, and contrast against their own surface, on the stack
// order used everywhere in this app (S -> E -> I -> D -> R -> Dead).
//
//   light  worst adjacent CVD dE 14.7 · normal-vision dE 20.8
//   dark   worst adjacent CVD dE 10.2 · normal-vision dE 16.9
//
// Two deliberate deviations, both documented rather than silently accepted:
//
//   Dead is a near-neutral and fails the chroma floor. That floor exists so a
//   category is not mistaken for "no data"; this chart has no no-data state,
//   and Dead is an absorbing compartment where desaturation is the intended
//   reading. Every separation gate still passes.
//
//   In light mode Exposed sits at 2.1:1 against the surface, below the 3:1
//   bar. The relief rule applies, so the legend is always present, series are
//   direct-labelled with their values, and a table view of the same numbers is
//   one click away - identity never rests on color alone.

export interface Palette {
  states: string[]
  surface: string
  panel: string
  page: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  grid: string
  axis: string
  border: string
  edge: string
  accent: string
}

export const LIGHT: Palette = {
  states: ['#2a78d6', '#eda100', '#e34948', '#4a3aa7', '#008300', '#8d7b93'],
  surface: '#fcfcfb',
  panel: '#ffffff',
  page: '#f9f9f7',
  textPrimary: '#0b0b0b',
  textSecondary: '#52514e',
  textMuted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  border: 'rgba(11,11,11,0.10)',
  edge: 'rgba(11,11,11,0.055)',
  accent: '#2a78d6',
}

export const DARK: Palette = {
  states: ['#3987e5', '#c98500', '#d03b3b', '#9085e9', '#0ca30c', '#8a8496'],
  surface: '#1a1a19',
  panel: '#141413',
  page: '#0d0d0d',
  textPrimary: '#ffffff',
  textSecondary: '#c3c2b7',
  textMuted: '#898781',
  grid: '#2c2c2a',
  axis: '#383835',
  border: 'rgba(255,255,255,0.10)',
  edge: 'rgba(255,255,255,0.05)',
  accent: '#3987e5',
}
