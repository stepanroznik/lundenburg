import fs from 'node:fs';
import { bounds, type MapFeature, type RegionMap } from './geography.js';
export async function prepareMap(): Promise<void> {
  const box = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  const query = `[out:json][timeout:20];(way[railway=rail][!service](${box});way[waterway=river](${box}););out geom;`;
  const response = await fetch(process.env.WEATHER_OVERPASS_URL || 'https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'User-Agent': 'LKP-Weather/1.0 (offline regional map preparation)' }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`Map download failed: HTTP ${response.status}`);
  const source = await response.json() as { elements: Array<{ tags?: Record<string, string>; geometry?: Array<{ lon: number; lat: number }> }> };
  const features: MapFeature[] = source.elements.filter(e => e.geometry && e.geometry.length >= 2).map(e => {
    const rail = e.tags?.railway === 'rail';
    const main = rail && (e.tags?.usage === 'main' || e.tags?.highspeed === 'yes' || Number(e.tags?.tracks) >= 2);
    return { kind: rail ? 'rail' : 'river', points: e.geometry!.map(p => [p.lon, p.lat]), ...(rail ? { importance: main ? 'main' as const : 'secondary' as const } : {}) };
  });
  if (!features.some(f => f.kind === 'rail') || !features.some(f => f.kind === 'river')) throw new Error('Map response lacks railways or rivers');
  const data: RegionMap = { attribution: '© OpenStreetMap contributors · ODbL 1.0', fetchedAt: new Date().toISOString(), features };
  fs.mkdirSync('assets/weather', { recursive: true });
  fs.writeFileSync('assets/weather/region.json.tmp', JSON.stringify(data));
  fs.renameSync('assets/weather/region.json.tmp', 'assets/weather/region.json');
  console.log(`Saved ${features.length} real railway and river features to assets/weather/region.json`);
}
