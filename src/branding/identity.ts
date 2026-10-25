/** Shared vector identity. The on-air bug and the films use this same geometry. */
export const nacht = {
  name: 'Lundenburg Nacht', abbreviation: 'LN', revision: 'nacht-orbit-v1',
  colors: { ink: '#101F2C', midnight: '#172C3E', horizon: '#284657', gold: '#DDB477', ivory: '#F3F0E7', dawn: '#F5E6CE' },
  fonts: { sans: 'LN Sans', serif: 'LN Serif' },
  mark: { width: 440, height: 180,
    letters: 'M8 18H38V142H101V172H8Z M121 18H151L227 124V18H257V172H227L151 66V172H121Z',
    moon: { x: 352, y: 83, radius: 73, cutX: 383, cutY: 54, cutRadius: 71 },
  },
} as const;

export const brandFilms = {
  evening: { title: 'Der Abend beginnt', seconds: 10, destination: 'ln', fullScreen: true },
  morning: { title: 'Ein neuer Tag', seconds: 10, destination: 'lkp', fullScreen: true },
  ident: { title: 'Lundenburg Nacht', seconds: 6, destination: 'ln', fullScreen: true },
  intro: { title: 'Gleich bei LN', seconds: 4, destination: 'ln', fullScreen: true },
  outro: { title: 'Mehr Nacht. Mehr entdecken.', seconds: 4, destination: 'ln', fullScreen: true },
  continuity: { title: 'Nachtbilder', seconds: 30, destination: 'ln', fullScreen: true },
  'day-continuity': { title: 'Eine kleine Pause', seconds: 30, destination: 'lkp', fullScreen: true },
} as const;
export type BrandFilm = keyof typeof brandFilms;
export const programmeBlocks = {
  aktuell: { title: 'Lundenburg Aktuell', subtitle: 'Nachrichten aus Břeclav', motif: 'horizon' },
  neugierig: { title: 'Neugierig?', subtitle: 'Ideen, die weiterführen', motif: 'orbit' },
  heimat: { title: 'Unsere Heimat', subtitle: 'Landschaften. Menschen. Geschichten.', motif: 'landscape' },
  internet: { title: 'Internet kaputt', subtitle: 'Ein guter Abend für seltsame Dinge', motif: 'signal' },
  geschichte: { title: 'Geschichte & Gesellschaft', subtitle: 'Die Welt im Zusammenhang', motif: 'orbit' },
  nachtruhe: { title: 'Nachtruhe', subtitle: 'Zeit, die Ruhe zu entdecken', motif: 'landscape' },
  feierabend: { title: 'Feierabend', subtitle: 'Zurücklehnen. Anschauen.', motif: 'horizon' },
  kino: { title: 'Lundenburg Kino', subtitle: 'Raum für große Geschichten', motif: 'horizon' },
} as const;
export type ProgrammeBlock = keyof typeof programmeBlocks;
