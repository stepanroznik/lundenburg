import type { Language, Presenter } from './types.js';
export const presenters = [
  { id: 'knurpsi', name: 'Knurpsi', city: 'Lundenburg', latitude: 48.759, longitude: 16.882, language: 'de', voiceId: 'eerdi6005Xy1VVWpejx6', speed: 0.84, profile: 'warm-clear-v1', eq: 'highpass=f=70', color: '#dd9452' },
  { id: 'sisi', name: 'Sisi', city: 'Wien', latitude: 48.2082, longitude: 16.3738, language: 'de', voiceId: 'AAiTaAHdZuRZAfYWRq5V', speed: 0.82, profile: 'elegant-bright-v1', eq: 'highpass=f=80,treble=g=1.2:f=3500', color: '#d89fba' },
  { id: 'schalinka', name: 'Schalinka', city: 'Brno', latitude: 49.1951, longitude: 16.6068, language: 'cs', voiceId: '6Aa0226VrdZ4mFzZjj82', speed: 0.90, profile: 'lively-balanced-v1', eq: 'highpass=f=70', color: '#70a981' },
  { id: 'haluschka', name: 'Haluschka', city: 'Bratislava', latitude: 48.1486, longitude: 17.1077, language: 'sk', voiceId: 'AAiTaAHdZuRZAfYWRq5V', speed: 0.88, profile: 'gentle-warm-v1', eq: 'highpass=f=65,treble=g=-1.2:f=3500', color: '#a4a4d0' },
] as const satisfies ReadonlyArray<{ id: Presenter; name: string; city: string; latitude: number; longitude: number; language: Language; voiceId: string; speed: number; profile: string; eq: string; color: string }>;
export const presenter = (id: Presenter) => presenters.find(p => p.id === id)!;

export const personalities = {
  knurpsi: { energy: 1, description: 'Warm, practical beaver. Loves building; quietly literal, proud of useful work.' },
  sisi: { energy: 1, description: 'Elegant, proud White Vienna rabbit with blue eyes. Precise, dignified; dry reactions.' },
  schalinka: { energy: 1.7, description: 'Lively Czech crocodile from Brno. Bold, cheeky, proud of being the Brno dragon.' },
  haluschka: { energy: 0.5, description: 'Gentle Slovak sheep from Bratislava. Curious, warm; quietly devastating observations.' },
} as const;
