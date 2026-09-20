export const bounds = { west: 16.05, east: 17.42, south: 47.99, north: 49.36 };
export function project(longitude: number, latitude: number): [number, number] {
  return [(longitude - bounds.west) / (bounds.east - bounds.west) * 1000, (bounds.north - latitude) / (bounds.north - bounds.south) * 850];
}
export interface MapFeature { kind: 'rail' | 'river'; points: [number, number][] }
export interface RegionMap { attribution: string; fetchedAt: string; features: MapFeature[] }
