import { z } from 'zod';

const WEATHER_PROVIDERS = ['wttr', 'open-meteo'] as const;
const WEATHER_UNITS = ['metric', 'us'] as const;

type WeatherProvider = (typeof WEATHER_PROVIDERS)[number];
type WeatherUnits = (typeof WEATHER_UNITS)[number];

const PluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultLocation: z.string().default(''),
  defaultUnits: z.enum(WEATHER_UNITS).default('metric'),
  requestTimeoutMs: z.number().int().min(1000).max(30000).default(8000),
  preferProvider: z.enum(WEATHER_PROVIDERS).default('wttr'),
});

const CurrentWeatherSchema = z.object({
  location: z.string().optional().describe('Location such as "Colombo", "New York", or "JFK"'),
  units: z.enum(WEATHER_UNITS).optional().describe('Units: metric or us'),
});

const ForecastWeatherSchema = z.object({
  location: z.string().optional().describe('Location such as "Colombo", "New York", or "JFK"'),
  units: z.enum(WEATHER_UNITS).optional().describe('Units: metric or us'),
  days: z.number().int().min(1).max(3).default(3).describe('Forecast days (1-3)'),
});

const weatherPlugin = {
  id: 'weather',
  name: 'Weather',
  description: 'Current weather and short forecasts without API keys.',

  register(api: any) {
    const config = resolveConfig(api.pluginConfig);
    const logger = api.logger;

    if (!config.enabled) {
      logger.info('Weather skill disabled by plugin config (enabled=false).');
      return;
    }

    api.registerTool({
      name: 'weather_current',
      description: 'Get current weather for a location.',
      parameters: CurrentWeatherSchema,
      execute: async (args: z.infer<typeof CurrentWeatherSchema>) => {
        const location = resolveLocation(args.location, config.defaultLocation);
        if (!location) {
          return {
            error: 'Location required',
            guidance: 'Provide a location or set skills.entries.weather.config.defaultLocation.',
          };
        }

        const units = args.units || config.defaultUnits;
        return queryCurrentWeather(location, units, config, logger);
      },
    });

    api.registerTool({
      name: 'weather_forecast',
      description: 'Get weather forecast (up to 3 days) for a location.',
      parameters: ForecastWeatherSchema,
      execute: async (args: z.infer<typeof ForecastWeatherSchema>) => {
        const location = resolveLocation(args.location, config.defaultLocation);
        if (!location) {
          return {
            error: 'Location required',
            guidance: 'Provide a location or set skills.entries.weather.config.defaultLocation.',
          };
        }

        const units = args.units || config.defaultUnits;
        const days = clamp(args.days || 3, 1, 3);
        return queryForecast(location, units, days, config, logger);
      },
    });
  },
};

export default weatherPlugin;

function resolveConfig(raw: unknown): z.infer<typeof PluginConfigSchema> {
  const parsed = PluginConfigSchema.safeParse(raw || {});
  if (!parsed.success) return PluginConfigSchema.parse({});
  return parsed.data;
}

function resolveLocation(location: string | undefined, fallback: string): string {
  const explicit = (location || '').trim();
  if (explicit) return explicit;
  return (fallback || '').trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function queryCurrentWeather(
  location: string,
  units: WeatherUnits,
  config: z.infer<typeof PluginConfigSchema>,
  logger: { warn: (message: string) => void },
) {
  const order = providerOrder(config.preferProvider);
  const errors: string[] = [];

  for (const provider of order) {
    try {
      if (provider === 'wttr') {
        return await fetchCurrentFromWttr(location, units, config.requestTimeoutMs);
      }
      return await fetchCurrentFromOpenMeteo(location, units, config.requestTimeoutMs);
    } catch (err: any) {
      const msg = `${provider}: ${err?.message || String(err)}`;
      errors.push(msg);
      logger.warn(`weather_current fallback -> ${msg}`);
    }
  }

  return {
    error: 'Failed to fetch current weather',
    location,
    units,
    details: errors,
  };
}

async function queryForecast(
  location: string,
  units: WeatherUnits,
  days: number,
  config: z.infer<typeof PluginConfigSchema>,
  logger: { warn: (message: string) => void },
) {
  const order = providerOrder(config.preferProvider);
  const errors: string[] = [];

  for (const provider of order) {
    try {
      if (provider === 'wttr') {
        return await fetchForecastFromWttr(location, units, days, config.requestTimeoutMs);
      }
      return await fetchForecastFromOpenMeteo(location, units, days, config.requestTimeoutMs);
    } catch (err: any) {
      const msg = `${provider}: ${err?.message || String(err)}`;
      errors.push(msg);
      logger.warn(`weather_forecast fallback -> ${msg}`);
    }
  }

  return {
    error: 'Failed to fetch weather forecast',
    location,
    units,
    days,
    details: errors,
  };
}

function providerOrder(preferred: WeatherProvider): WeatherProvider[] {
  return preferred === 'wttr' ? ['wttr', 'open-meteo'] : ['open-meteo', 'wttr'];
}

async function fetchCurrentFromWttr(
  location: string,
  units: WeatherUnits,
  timeoutMs: number,
) {
  const data = await fetchWttr(location, units, timeoutMs);
  const current = data.current_condition?.[0];
  if (!current) {
    throw new Error('wttr current_condition missing');
  }

  return {
    provider: 'wttr',
    location,
    units,
    observedAt: current.observation_time || null,
    condition: current.weatherDesc?.[0]?.value || 'Unknown',
    temperature: pickUnit(units, current.temp_C, current.temp_F),
    feelsLike: pickUnit(units, current.FeelsLikeC, current.FeelsLikeF),
    humidity: toNumber(current.humidity),
    wind: {
      speed: pickUnit(units, current.windspeedKmph, current.windspeedMiles),
      direction: current.winddir16Point || null,
    },
    sourceUrl: `https://wttr.in/${encodeURIComponent(location)}?format=j1`,
  };
}

async function fetchForecastFromWttr(
  location: string,
  units: WeatherUnits,
  days: number,
  timeoutMs: number,
) {
  const data = await fetchWttr(location, units, timeoutMs);
  const daily = Array.isArray(data.weather) ? data.weather.slice(0, days) : [];
  if (daily.length === 0) {
    throw new Error('wttr weather forecast missing');
  }

  return {
    provider: 'wttr',
    location,
    units,
    days: daily.length,
    forecast: daily.map((entry: any) => ({
      date: entry.date,
      condition: entry.hourly?.[4]?.weatherDesc?.[0]?.value
        || entry.hourly?.[0]?.weatherDesc?.[0]?.value
        || 'Unknown',
      tempMax: pickUnit(units, entry.maxtempC, entry.maxtempF),
      tempMin: pickUnit(units, entry.mintempC, entry.mintempF),
      avgTemp: pickUnit(units, entry.avgtempC, entry.avgtempF),
      sunHours: toNumber(entry.sunHour),
      chanceOfRainPercent: toNumber(entry.hourly?.[4]?.chanceofrain || entry.hourly?.[0]?.chanceofrain),
    })),
    sourceUrl: `https://wttr.in/${encodeURIComponent(location)}?format=j1`,
  };
}

async function fetchWttr(location: string, units: WeatherUnits, timeoutMs: number): Promise<any> {
  const unitFlag = units === 'us' ? '&u' : '&m';
  const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1${unitFlag}`;
  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response.ok) {
    throw new Error(`wttr request failed: ${response.status}`);
  }
  return response.json();
}

async function fetchCurrentFromOpenMeteo(
  location: string,
  units: WeatherUnits,
  timeoutMs: number,
) {
  const geo = await geocodeLocation(location, timeoutMs);
  const unitConfig = openMeteoUnits(units);
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(geo.latitude));
  url.searchParams.set('longitude', String(geo.longitude));
  url.searchParams.set(
    'current',
    'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code',
  );
  url.searchParams.set('temperature_unit', unitConfig.temp);
  url.searchParams.set('wind_speed_unit', unitConfig.wind);
  url.searchParams.set('timezone', 'auto');

  const response = await fetchWithTimeout(url.toString(), timeoutMs);
  if (!response.ok) {
    throw new Error(`open-meteo request failed: ${response.status}`);
  }
  const data = await response.json();
  const current = data.current;
  if (!current) {
    throw new Error('open-meteo current missing');
  }

  return {
    provider: 'open-meteo',
    location: geo.name,
    units,
    observedAt: current.time || null,
    condition: weatherCodeLabel(current.weather_code),
    temperature: current.temperature_2m ?? null,
    feelsLike: current.apparent_temperature ?? null,
    humidity: current.relative_humidity_2m ?? null,
    wind: {
      speed: current.wind_speed_10m ?? null,
      direction: null,
    },
    coordinates: {
      latitude: geo.latitude,
      longitude: geo.longitude,
      country: geo.country,
      admin1: geo.admin1 || null,
    },
    sourceUrl: url.toString(),
  };
}

async function fetchForecastFromOpenMeteo(
  location: string,
  units: WeatherUnits,
  days: number,
  timeoutMs: number,
) {
  const geo = await geocodeLocation(location, timeoutMs);
  const unitConfig = openMeteoUnits(units);
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(geo.latitude));
  url.searchParams.set('longitude', String(geo.longitude));
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min');
  url.searchParams.set('forecast_days', String(days));
  url.searchParams.set('temperature_unit', unitConfig.temp);
  url.searchParams.set('timezone', 'auto');

  const response = await fetchWithTimeout(url.toString(), timeoutMs);
  if (!response.ok) {
    throw new Error(`open-meteo request failed: ${response.status}`);
  }
  const data = await response.json();
  const daily = data.daily;
  if (!daily || !Array.isArray(daily.time)) {
    throw new Error('open-meteo daily forecast missing');
  }

  const forecast = daily.time.map((date: string, idx: number) => ({
    date,
    condition: weatherCodeLabel(daily.weather_code?.[idx]),
    tempMax: daily.temperature_2m_max?.[idx] ?? null,
    tempMin: daily.temperature_2m_min?.[idx] ?? null,
  }));

  return {
    provider: 'open-meteo',
    location: geo.name,
    units,
    days: forecast.length,
    forecast,
    coordinates: {
      latitude: geo.latitude,
      longitude: geo.longitude,
      country: geo.country,
      admin1: geo.admin1 || null,
    },
    sourceUrl: url.toString(),
  };
}

async function geocodeLocation(location: string, timeoutMs: number) {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', location);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const response = await fetchWithTimeout(url.toString(), timeoutMs);
  if (!response.ok) {
    throw new Error(`open-meteo geocoding failed: ${response.status}`);
  }
  const data = await response.json();
  const first = Array.isArray(data.results) ? data.results[0] : undefined;
  if (!first) {
    throw new Error(`Location not found: ${location}`);
  }

  return {
    name: first.name || location,
    latitude: first.latitude,
    longitude: first.longitude,
    country: first.country || '',
    admin1: first.admin1 || '',
  };
}

function openMeteoUnits(units: WeatherUnits): { temp: string; wind: string } {
  if (units === 'us') {
    return { temp: 'fahrenheit', wind: 'mph' };
  }
  return { temp: 'celsius', wind: 'kmh' };
}

function pickUnit(units: WeatherUnits, metricValue: unknown, usValue: unknown): number | null {
  if (units === 'us') return toNumber(usValue);
  return toNumber(metricValue);
}

function toNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return null;
}

function weatherCodeLabel(code: unknown): string {
  const value = Number(code);
  if (!Number.isFinite(value)) return 'Unknown';

  const map: Record<number, string> = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    71: 'Slight snow',
    73: 'Moderate snow',
    75: 'Heavy snow',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail',
  };

  return map[value] || `Weather code ${value}`;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  return fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Adytum-Weather/0.1',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}
