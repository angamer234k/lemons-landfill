/** Open-Meteo weather helpers (no API key required). */

async function geocodeCity(city) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const data = await res.json();
  const place = data.results?.[0];
  if (!place) return null;
  return {
    name: place.name,
    country: place.country || '',
    admin1: place.admin1 || '',
    lat: place.latitude,
    lon: place.longitude,
    timezone: place.timezone || 'auto',
  };
}

async function getWeather(city) {
  const place = await geocodeCity(city);
  if (!place) return { ok: false, error: `Could not find location: ${city}` };

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
    `&timezone=${encodeURIComponent(place.timezone)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather fetch failed (${res.status})`);
  const data = await res.json();
  const cur = data.current;
  if (!cur) return { ok: false, error: 'No current weather data' };

  const codeMap = {
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
  };

  const condition = codeMap[cur.weather_code] || `Code ${cur.weather_code}`;
  const locationLabel = [place.name, place.admin1, place.country].filter(Boolean).join(', ');

  return {
    ok: true,
    location: locationLabel,
    temperature_c: cur.temperature_2m,
    feels_like_c: cur.apparent_temperature,
    humidity_pct: cur.relative_humidity_2m,
    wind_kmh: cur.wind_speed_10m,
    condition,
    time: cur.time,
  };
}

module.exports = { getWeather, geocodeCity };
