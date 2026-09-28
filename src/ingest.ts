import type { MediaItem, SubtitleTrack } from './types.js';

export interface MediaEnricher {
  readonly name: string;
  enrich(item: Readonly<MediaItem>): Promise<Partial<Pick<MediaItem, 'externalIds' | 'editorialMarkers' | 'breakpoints' | 'subtitles'>>>;
}

export interface SubtitleSearch {
  imdb?: string;
  tmdb?: string;
  tvdb?: string;
  season?: number;
  episode?: number;
  filename: string;
  durationMs: number;
  languages: Array<'cs' | 'de' | 'en'>;
}

export interface SubtitleProvider {
  readonly name: string;
  findMissing(search: SubtitleSearch): Promise<SubtitleTrack[]>;
}

// Enrichers are deliberately failure-isolated: local probe data remains usable
// when TheIntroDB, ChaptersDB, SubDL, OpenSubtitles, or a sync tool is offline.
export async function runEnrichers(item: MediaItem, enrichers: MediaEnricher[]): Promise<MediaItem> {
  let current = item;
  const warnings = [...(item.qcWarnings ?? [])];
  for (const enricher of enrichers) {
    try {
      const patch = await enricher.enrich(current);
      current = {
        ...current,
        ...(patch.externalIds ? { externalIds: { ...(current.externalIds ?? {}), ...patch.externalIds } } : {}),
        ...(patch.editorialMarkers ? { editorialMarkers: [...(current.editorialMarkers ?? []), ...patch.editorialMarkers] } : {}),
        ...(patch.breakpoints ? { breakpoints: [...(current.breakpoints ?? []), ...patch.breakpoints] } : {}),
        ...(patch.subtitles ? { subtitles: [...current.subtitles, ...patch.subtitles] } : {}),
      };
    } catch (error) {
      warnings.push(`${enricher.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { ...current, qcWarnings: warnings, ingestState: warnings.length ? 'review' : 'ready' };
}
