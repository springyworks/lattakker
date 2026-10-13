import { getSettings } from '../aichat/config';
import { jobs } from '../aichat/jobs';
import { ERR, McpError, type Json, type McpServer } from '../mcp/router';

/**
 * The weather, for cell code (`weather.now('Amsterdam')`) and over MCP (the server `weather`).
 *
 * The data comes from Open-Meteo (open-meteo.com): free, no key, made for browsers. A lookup sends the place
 * name (or the coordinates) to open-meteo.com and nothing else; the person can switch weather off in the
 * helper's settings. Answers are kept for a while, so a cell that asks every second does not hammer the
 * service, and the page never makes more than a handful of requests a minute.
 */

const GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const PLACE_TTL_MS = 24 * 3600_000;
const WEATHER_TTL_MS = 10 * 60_000;
const MAX_REQUESTS_PER_MINUTE = 20;
const MAX_CACHE = 100;
const MAX_DAYS = 7;

export interface Place {
  name: string;
  country: string;
  /** Province, state or county, when there is one. */
  region: string;
  lat: number;
  lon: number;
  timezone: string;
}

export interface WeatherNow {
  /** Local time of the place when this was measured, e.g. '2026-10-13T08:30'. */
  time: string;
  /** °C */
  temperature: number;
  /** °C, how it feels. */
  feelsLike: number;
  /** % */
  humidity: number;
  /** km/h */
  wind: number;
  /** Where the wind comes from, in degrees (0 = north) and as a compass point. */
  windDegrees: number;
  windFrom: string;
  /** mm in the last hour. */
  rain: number;
  /** % of the sky covered by cloud. */
  clouds: number;
  isDay: boolean;
  /** The WMO weather code, a short text and an emoji for it. */
  code: number;
  text: string;
  icon: string;
}

export interface WeatherDay {
  /** '2026-10-13' */
  date: string;
  /** °C */
  min: number;
  max: number;
  /** mm */
  rain: number;
  /** % chance of rain (null when the model has none). */
  rainChance: number | null;
  /** km/h */
  wind: number;
  uv: number;
  sunrise: string;
  sunset: string;
  code: number;
  text: string;
  icon: string;
}

export interface Forecast {
  place: Place;
  now: WeatherNow;
  days: WeatherDay[];
}

export type PlaceInput = string | { lat: number; lon: number; name?: string };

/** WMO weather interpretation codes, as Open-Meteo reports them. */
const CODES: Record<number, [string, string]> = {
  0: ['Clear sky', '☀️'],
  1: ['Mostly clear', '🌤'],
  2: ['Partly cloudy', '⛅'],
  3: ['Overcast', '☁️'],
  45: ['Fog', '🌫'],
  48: ['Freezing fog', '🌫'],
  51: ['Light drizzle', '🌦'],
  53: ['Drizzle', '🌦'],
  55: ['Heavy drizzle', '🌦'],
  56: ['Freezing drizzle', '🌧'],
  57: ['Heavy freezing drizzle', '🌧'],
  61: ['Light rain', '🌧'],
  63: ['Rain', '🌧'],
  65: ['Heavy rain', '🌧'],
  66: ['Freezing rain', '🌧'],
  67: ['Heavy freezing rain', '🌧'],
  71: ['Light snow', '🌨'],
  73: ['Snow', '🌨'],
  75: ['Heavy snow', '❄️'],
  77: ['Snow grains', '🌨'],
  80: ['Light showers', '🌦'],
  81: ['Showers', '🌧'],
  82: ['Heavy showers', '⛈'],
  85: ['Snow showers', '🌨'],
  86: ['Heavy snow showers', '❄️'],
  95: ['Thunderstorm', '⛈'],
  96: ['Thunderstorm with hail', '⛈'],
  99: ['Thunderstorm with heavy hail', '⛈'],
};

export const describeCode = (code: number): { text: string; icon: string } => {
  const [text, icon] = CODES[code] ?? ['Unknown weather', '❔'];
  return { text, icon };
};

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (degrees: number): string => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];

export class WeatherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeatherError';
  }
}

const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
const requestTimes: number[] = [];

function remembered<T>(key: string, ttl: number): T | undefined {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < ttl ? (hit.value as T) : undefined;
}

function keep(key: string, value: unknown): void {
  cache.set(key, { at: Date.now(), value });
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
}

/** One request to Open-Meteo: counted, timed out, and the same question asked twice at once is asked once. */
async function ask(url: string, title: string): Promise<Record<string, unknown>> {
  const running = inflight.get(url);
  if (running) return (await running) as Record<string, unknown>;
  const now = Date.now();
  while (requestTimes.length && now - requestTimes[0] > 60_000) requestTimes.shift();
  if (requestTimes.length >= MAX_REQUESTS_PER_MINUTE) throw new WeatherError(`That is a lot of weather questions in a minute (more than ${MAX_REQUESTS_PER_MINUTE}). Wait a little, or ask less often: the weather does not change every second.`);
  requestTimes.push(now);
  const job = jobs.start('weather', title, { stallAfterSeconds: 15 });
  const work = (async () => {
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    } catch (err) {
      const timeout = err instanceof DOMException && err.name === 'TimeoutError';
      throw new WeatherError(timeout ? 'open-meteo.com did not answer within 8 seconds.' : 'Could not reach open-meteo.com. Is this computer online?');
    }
    if (!res.ok) throw new WeatherError(`open-meteo.com said ${res.status}${res.status === 429 ? ' (too many questions: wait a minute)' : ''}.`);
    return (await res.json()) as Record<string, unknown>;
  })();
  inflight.set(url, work);
  try {
    const result = await work;
    job.done('answered');
    return result;
  } catch (err) {
    job.fail(err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    inflight.delete(url);
  }
}

function allowed(): void {
  if (!getSettings().allowWeather) throw new WeatherError('Weather lookups are switched off. A grown-up can switch them on in the helper settings (⚙, “Other”). A lookup sends the place name to open-meteo.com.');
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Places that fit a name, best first. */
export async function findPlaces(query: string, count = 5): Promise<Place[]> {
  allowed();
  const name = String(query ?? '').trim().slice(0, 80);
  if (!name) throw new WeatherError('Give a place name, for example weather.now("Amsterdam").');
  const limit = Math.max(1, Math.min(10, Math.floor(count) || 5));
  const key = `place:${name.toLowerCase()}:${limit}`;
  const known = remembered<Place[]>(key, PLACE_TTL_MS);
  if (known) return structuredClone(known);
  const data = await ask(`${GEOCODING}?name=${encodeURIComponent(name)}&count=${limit}&language=en&format=json`, `finding “${name}”`);
  const results = Array.isArray(data.results) ? (data.results as Array<Record<string, unknown>>) : [];
  const places = results.map((r) => ({
    name: text(r.name),
    country: text(r.country),
    region: text(r.admin1),
    lat: num(r.latitude),
    lon: num(r.longitude),
    timezone: text(r.timezone),
  }));
  keep(key, places);
  return structuredClone(places);
}

/** A place from a name ("Amsterdam", "Paris, France", "52.37,4.89") or from coordinates. */
async function resolvePlace(input: PlaceInput): Promise<Place> {
  if (typeof input === 'object' && input !== null) {
    const { lat, lon } = input;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new WeatherError('lat must be between -90 and 90, and lon between -180 and 180.');
    return { name: input.name ? String(input.name).slice(0, 80) : `${round1(lat)}, ${round1(lon)}`, country: '', region: '', lat, lon, timezone: 'auto' };
  }
  const raw = String(input ?? '').trim();
  const pair = /^(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)$/.exec(raw);
  if (pair) return resolvePlace({ lat: Number(pair[1]), lon: Number(pair[2]) });
  // "Paris, France" searches "Paris" and prefers the result whose country or region mentions "France".
  const [first, ...rest] = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (!first) throw new WeatherError('Give a place name, for example weather.now("Amsterdam").');
  const found = await findPlaces(first, rest.length ? 10 : 1);
  const hint = rest.join(' ').toLowerCase();
  const best = (hint && found.find((p) => `${p.country} ${p.region}`.toLowerCase().includes(hint))) || found[0];
  if (!best) throw new WeatherError(`No place called “${first}” was found. Try another spelling, or a bigger town nearby.`);
  return best;
}

function parseNow(current: Record<string, unknown>): WeatherNow {
  const code = num(current.weather_code);
  const degrees = num(current.wind_direction_10m);
  return {
    time: text(current.time),
    temperature: num(current.temperature_2m),
    feelsLike: num(current.apparent_temperature),
    humidity: num(current.relative_humidity_2m),
    wind: num(current.wind_speed_10m),
    windDegrees: degrees,
    windFrom: compass(degrees),
    rain: num(current.precipitation),
    clouds: num(current.cloud_cover),
    isDay: num(current.is_day) === 1,
    code,
    ...describeCode(code),
  };
}

function parseDays(daily: Record<string, unknown>): WeatherDay[] {
  const column = (name: string): unknown[] => (Array.isArray(daily[name]) ? (daily[name] as unknown[]) : []);
  return column('time').map((date, i) => {
    const code = num(column('weather_code')[i]);
    const chance = column('precipitation_probability_max')[i];
    return {
      date: text(date),
      min: num(column('temperature_2m_min')[i]),
      max: num(column('temperature_2m_max')[i]),
      rain: num(column('precipitation_sum')[i]),
      rainChance: typeof chance === 'number' ? chance : null,
      wind: num(column('wind_speed_10m_max')[i]),
      uv: num(column('uv_index_max')[i]),
      sunrise: text(column('sunrise')[i]),
      sunset: text(column('sunset')[i]),
      code,
      ...describeCode(code),
    };
  });
}

/** The weather now and the coming days (1 to 7) for a place. */
export async function forecast(input: PlaceInput, days = 3): Promise<Forecast> {
  allowed();
  const place = await resolvePlace(input);
  const count = Math.max(1, Math.min(MAX_DAYS, Math.floor(Number(days)) || 3));
  const key = `forecast:${place.lat.toFixed(2)},${place.lon.toFixed(2)}:${count}`;
  const known = remembered<Forecast>(key, WEATHER_TTL_MS);
  if (known) return structuredClone({ ...known, place });
  const url =
    `${FORECAST}?latitude=${place.lat}&longitude=${place.lon}&timezone=auto&forecast_days=${count}` +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max,sunrise,sunset';
  const data = await ask(url, `weather in ${place.name}`);
  if (typeof data.current !== 'object' || data.current === null) throw new WeatherError('open-meteo.com sent no weather for that place.');
  const result: Forecast = {
    place: { ...place, timezone: text(data.timezone) || place.timezone },
    now: parseNow(data.current as Record<string, unknown>),
    days: parseDays((typeof data.daily === 'object' && data.daily !== null ? data.daily : {}) as Record<string, unknown>),
  };
  keep(key, result);
  return structuredClone(result);
}

/** The weather now for a place, with the place it was found for. */
export async function weatherNow(input: PlaceInput): Promise<WeatherNow & { place: Place }> {
  const { place, now } = await forecast(input, 1);
  return { place, ...now };
}

/** A sentence for a person: "🌧 Rain, 11°C (feels 9°C), wind 14 km/h from SW, humidity 88%". */
export function summary(now: WeatherNow): string {
  return `${now.icon} ${now.text}, ${Math.round(now.temperature)}°C (feels ${Math.round(now.feelsLike)}°C), wind ${Math.round(now.wind)} km/h from ${now.windFrom}, humidity ${Math.round(now.humidity)}%`;
}

// ------------------------------------------------------------ the MCP server

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const placeArg = { type: 'string', description: 'A place name like "Amsterdam" or "Paris, France", or coordinates like "52.37,4.89".' };

const TOOLS = [
  { name: 'now', description: 'The weather right now in a place: temperature, feels-like, wind, humidity, rain, clouds, and a short text with an emoji.', inputSchema: { type: 'object', properties: { place: placeArg }, required: ['place'] } },
  { name: 'forecast', description: 'The weather now and for the coming days (1 to 7): min and max temperature, rain, wind, sunrise and sunset.', inputSchema: { type: 'object', properties: { place: placeArg, days: { type: 'integer', description: '1 to 7, default 3.' } }, required: ['place'] } },
  { name: 'find', description: 'Places that fit a name, best first, with country and coordinates (to choose between two towns with the same name).', inputSchema: { type: 'object', properties: { query: { type: 'string' }, count: { type: 'integer' } }, required: ['query'] } },
];

/** The MCP server `weather`. */
export class WeatherServer implements McpServer {
  readonly name = 'weather';
  readonly description = 'The weather anywhere (now, the coming days, find a place), from open-meteo.com. A lookup sends the place name there.';

  async handle(method: string, params: Record<string, unknown>): Promise<Json> {
    switch (method) {
      case 'initialize':
        return { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'lattakker-weather', title: 'Weather', version: '1' } };
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: TOOLS };
      case 'tools/call':
        return this.call(String(params.name ?? ''), isRecord(params.arguments) ? params.arguments : {});
      default:
        throw new McpError(ERR.methodNotFound, `weather does not know the method "${method}"`);
    }
  }

  private async call(name: string, args: Record<string, unknown>): Promise<Json> {
    const reply = (value: Record<string, unknown>) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
    try {
      switch (name) {
        case 'now': {
          const now = await weatherNow(String(args.place ?? ''));
          return reply({ ...now, summary: summary(now) });
        }
        case 'forecast': {
          const f = await forecast(String(args.place ?? ''), typeof args.days === 'number' ? args.days : 3);
          return reply({ ...f, summary: summary(f.now) });
        }
        case 'find':
          return reply({ places: await findPlaces(String(args.query ?? ''), typeof args.count === 'number' ? args.count : 5) });
        default:
          throw new McpError(ERR.methodNotFound, `weather has no tool "${name}". Tools: now, forecast, find`);
      }
    } catch (err) {
      if (err instanceof WeatherError) return { content: [{ type: 'text', text: err.message }], isError: true };
      throw err;
    }
  }
}
