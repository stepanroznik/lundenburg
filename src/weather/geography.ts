export const bounds = { west: 16.05, east: 17.42, south: 47.99, north: 49.36 };
export function project(longitude: number, latitude: number): [number, number] {
  // Northern headroom keeps every city's weather card above its landmark.
  return [70 + (longitude - bounds.west) / (bounds.east - bounds.west) * 960, 165 + (bounds.north - latitude) / (bounds.north - bounds.south) * 510];
}
export interface MapFeature { kind: 'rail' | 'river'; points: [number, number][]; importance?: 'main' | 'secondary' }
export interface RegionMap { attribution: string; fetchedAt: string; features: MapFeature[] }
