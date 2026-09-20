import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import { presenters, type WeatherConfig } from './config.js';
import type { Edition, Fact, Forecast, Period, WeatherState } from './model.js';

export const periodsFor = (edition: Edition): Period[] => edition === 'morning' ? ['current', 'afternoon', 'evening', 'tomorrow'] : edition === 'afternoon' ? ['current', 'evening', 'tomorrow'] : ['current', 'tomorrow'];
export function editionWindow(edition: Edition, at: Date, c: WeatherConfig): { from: DateTime; until: DateTime } {
  const day = DateTime.fromJSDate(at, { zone: c.timezone }).startOf('day');
  const from = day.set({ hour: c.starts[edition] });
  const until = edition === 'morning' ? day.set({ hour: c.starts.afternoon }) : edition === 'afternoon' ? day.set({ hour: c.starts.evening }) : day.plus({ days: 1 });
  return { from, until };
}
export function normalizeWeather(code: number, temperature: number, wind: number): WeatherState {
  if ([95, 96, 99].includes(code)) return 'thunderstorm';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([65, 67, 82].includes(code)) return 'heavy-rain';
  if ([61, 63, 66].includes(code)) return 'rain';
  if ([80, 81].includes(code)) return 'showers';
  if ([51, 53, 55, 56, 57].includes(code)) return 'drizzle';
  if ([45, 48].includes(code)) return 'fog';
  if (![0, 1, 2, 3].includes(code)) throw new Error(`Unsupported weather code ${code}`);
  if (wind >= 40) return 'windy';
  if (temperature >= 30) return 'hot';
  if (temperature <= 0) return 'cold';
  return code <= 1 ? 'clear' : code === 2 ? 'partly-cloudy' : 'cloudy';
}
interface Hourly { time: number[]; temperature_2m: number[]; weather_code: number[]; precipitation_probability: number[]; wind_speed_10m: number[] }
interface LocationResponse { hourly: Hourly; hourly_units: Record<string, string> }
export interface WeatherProvider { getForecast(at: Date, edition: Edition): Promise<{ forecast: Forecast; source: unknown }> }
const severity: WeatherState[] = ['clear', 'partly-cloudy', 'cloudy', 'hot', 'cold', 'fog', 'windy', 'drizzle', 'showers', 'rain', 'snow', 'heavy-rain', 'thunderstorm'];
export function normalizeSource(source: LocationResponse[], at: Date, edition: Edition, c: WeatherConfig, fetchedAt = new Date()): Forecast {
  if (!Array.isArray(source) || source.length !== presenters.length) throw new Error('Weather response must contain all four cities');
  const local = DateTime.fromJSDate(at, { zone: c.timezone });
  const cities = Object.fromEntries(presenters.map((p, cityIndex) => {
    const location = source[cityIndex]!;
    if (location.hourly_units?.temperature_2m !== '°C' || location.hourly_units?.wind_speed_10m !== 'km/h') throw new Error('Unexpected weather units');
    const hourly = location.hourly;
    const rows = hourly.time.map((t, i) => {
      const values = [t, hourly.temperature_2m[i], hourly.weather_code[i], hourly.precipitation_probability[i], hourly.wind_speed_10m[i]];
      if (!values.every(v => typeof v === 'number' && Number.isFinite(v))) throw new Error('Incomplete hourly weather data');
      return { time: DateTime.fromSeconds(t, { zone: c.timezone }), temp: values[1]!, code: values[2]!, probability: values[3]!, wind: values[4]! };
    });
    const facts = periodsFor(edition).map(period => {
      const begin = period === 'current' ? local.startOf('hour') : period === 'tomorrow' ? local.plus({ days: 1 }).startOf('day') : local.startOf('day').set({ hour: period === 'afternoon' ? c.starts.afternoon : c.starts.evening });
      const end = period === 'current' ? begin.plus({ hours: 1 }) : period === 'tomorrow' ? begin.plus({ days: 1 }) : period === 'afternoon' ? local.startOf('day').set({ hour: c.starts.evening }) : local.plus({ days: 1 }).startOf('day');
      const selected = rows.filter(r => r.time >= begin && r.time < end);
      if (selected.length !== Math.round(end.diff(begin, 'hours').hours)) throw new Error(`Missing forecast hours for ${p.city}/${period}`);
      const temps = selected.map(r => r.temp);
      const representative = selected.reduce((a, b) => severity.indexOf(normalizeWeather(b.code, b.temp, b.wind)) > severity.indexOf(normalizeWeather(a.code, a.temp, a.wind)) ? b : a);
      const minTemperatureC = Math.round(Math.min(...temps));
      const maxTemperatureC = Math.round(Math.max(...temps));
      return { period, state: normalizeWeather(representative.code, representative.temp, representative.wind), temperatureC: period === 'current' ? Math.round(temps[0]!) : maxTemperatureC, minTemperatureC, maxTemperatureC, precipitationProbability: Math.max(...selected.map(r => r.probability)), windSpeedKmh: Math.round(Math.max(...selected.map(r => r.wind))) } satisfies Fact;
    });
    return [p.id, facts];
  })) as Forecast['cities'];
  return { provider: 'open-meteo', fetchedAt: fetchedAt.toISOString(), broadcastAt: at.toISOString(), stale: false, cities };
}
export class OpenMeteoProvider implements WeatherProvider {
  constructor(private c: WeatherConfig, private cacheDirectory: string) {}
  async getForecast(at: Date, edition: Edition): Promise<{ forecast: Forecast; source: unknown }> {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    Object.entries({ latitude: presenters.map(p => p.latitude).join(','), longitude: presenters.map(p => p.longitude).join(','), hourly: 'temperature_2m,weather_code,precipitation_probability,wind_speed_10m', forecast_days: '3', timezone: this.c.timezone, timeformat: 'unixtime', wind_speed_unit: 'kmh' }).forEach(([k, v]) => url.searchParams.set(k, v));
    fs.mkdirSync(this.cacheDirectory, { recursive: true });
    const cache = path.join(this.cacheDirectory, 'last-source.json');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
      const source = await response.json() as LocationResponse[];
      const fetchedAt = new Date();
      const forecast = normalizeSource(source, at, edition, this.c, fetchedAt);
      fs.writeFileSync(`${cache}.tmp`, JSON.stringify({ source, fetchedAt: fetchedAt.toISOString() }));
      fs.renameSync(`${cache}.tmp`, cache);
      return { forecast, source };
    } catch (error) {
      if (!fs.existsSync(cache)) throw error;
      const cached = JSON.parse(fs.readFileSync(cache, 'utf8')) as { source: LocationResponse[]; fetchedAt: string };
      const age = Date.now() - Date.parse(cached.fetchedAt);
      if (!Number.isFinite(age) || age < 0 || age > this.c.maxForecastAgeMinutes * 60_000) throw new Error('Live weather unavailable and cached forecast expired; skip this edition', { cause: error });
      const forecast = normalizeSource(cached.source, at, edition, this.c, new Date(cached.fetchedAt));
      forecast.stale = true;
      return { forecast, source: cached.source };
    }
  }
}
export const fixtures = ['sunny', 'rainy', 'storm', 'snow', 'heatwave', 'windy', 'mixed'] as const;
export function mockForecast(fixture: string, at: Date, edition: Edition): Forecast {
  if (!(fixtures as readonly string[]).includes(fixture)) throw new Error(`Unknown fixture ${fixture}`);
  const states: Record<string, WeatherState[]> = { sunny: ['clear'], rainy: ['rain'], storm: ['thunderstorm'], snow: ['snow'], heatwave: ['hot'], windy: ['windy'], mixed: ['rain', 'clear', 'thunderstorm', 'snow'] };
  const choices = states[fixture]!;
  return { provider: `fixture:${fixture}`, fetchedAt: at.toISOString(), broadcastAt: at.toISOString(), stale: false, cities: Object.fromEntries(presenters.map((p, i) => [p.id, periodsFor(edition).map((period, j) => {
    const state = choices[i % choices.length]!;
    const temp = state === 'snow' ? -2 : state === 'hot' ? 33 : 18 + i - j;
    return { period, state, temperatureC: temp, minTemperatureC: temp - 5, maxTemperatureC: temp, precipitationProbability: state === 'clear' ? 5 : 80, windSpeedKmh: state === 'windy' ? 48 : 12 };
  })])) as Forecast['cities'] };
}
