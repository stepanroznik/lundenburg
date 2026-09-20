export type Edition = 'morning' | 'afternoon' | 'evening';
export type Period = 'current' | 'afternoon' | 'evening' | 'tomorrow';
export type Language = 'de' | 'cs' | 'sk';
export type Presenter = 'knurpsi' | 'sisi' | 'schalinka' | 'haluschka';
export type WeatherState = 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'showers' | 'heavy-rain' | 'thunderstorm' | 'snow' | 'windy' | 'hot' | 'cold';
export interface Fact {
  period: Period; state: WeatherState; temperatureC: number;
  minTemperatureC: number; maxTemperatureC: number;
  precipitationProbability: number; windSpeedKmh: number;
}
export interface Forecast {
  provider: string; fetchedAt: string; broadcastAt: string; stale: boolean;
  cities: Record<Presenter, Fact[]>;
}
export interface Atom {
  id: string; presenter: Presenter; language: Language; text: string;
  purpose: 'greeting' | 'context' | 'condition' | 'temperature' | 'reaction' | 'handoff' | 'goodbye';
  period: Period;
}
export type Mouth = 'rest' | 'closed' | 'open' | 'wide' | 'round' | 'teeth';
export interface MouthCue { start: number; end: number; value: Mouth }
export interface SpeechAsset { key: string; audio: string; duration: number; cues: MouthCue[] }
export interface Beat extends Atom { from: number; frames: number; asset: SpeechAsset }
export interface Episode {
  edition: Edition; broadcastAt: string; forecast: Forecast; beats: Beat[];
  fps: number; durationInFrames: number; preview: boolean;
}
export interface ProgrammeMetadata {
  id: string; title: string; edition: Edition; generatedAt: string;
  validFrom: string; validUntil: string; durationMs: number;
  mediaPath: string; subtitlePath: string; preview: boolean;
}
