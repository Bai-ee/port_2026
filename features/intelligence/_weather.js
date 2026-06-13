'use strict';

// _weather.js — zip-code local weather for the daily brief.
// Geocodes a US zip (Zippopotam, keyless) → NWS forecast (keyless, needs only
// a User-Agent). Produces today's forecast + a 1-line 3-day summary. Config
// lives at client_configs/{clientId}.marketingBriefConfig.weather
// ({ enabled, zip, lat, lon, place }).

const fb = require('../../api/_lib/firebase-admin.cjs');

const NWS_UA =
  process.env.NWS_USER_AGENT ||
  process.env.WEATHER_USER_AGENT ||
  'HitLoopDailyBrief/1.0 (contact: bryanballi@gmail.com)';

/** Resolve a 5-digit US zip → { lat, lon, place }. Null on miss. */
async function geocodeZip(zip) {
  const z = String(zip || '').trim();
  if (!/^\d{5}$/.test(z)) return null;
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${z}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = await res.json();
    const p = data?.places?.[0];
    if (!p) return null;
    const lat = Number(p.latitude);
    const lon = Number(p.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon, place: `${p['place name'] || ''}, ${p['state abbreviation'] || ''}`.replace(/^, |, $/g, '') || z };
  } catch {
    return null;
  }
}

/**
 * NWS forecast for a lat/lon → today + a 1-line 3-day summary.
 * @returns {Promise<null | { today, threeDayLine, days }>}
 */
async function getForecast(lat, lon) {
  if (lat == null || lon == null) return null;
  const headers = { 'User-Agent': NWS_UA, Accept: 'application/geo+json' };
  try {
    const pRes = await fetch(
      `https://api.weather.gov/points/${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`,
      { headers, signal: AbortSignal.timeout(10_000) }
    );
    if (!pRes.ok) return null;
    const forecastUrl = (await pRes.json())?.properties?.forecast;
    if (!forecastUrl) return null;

    const fRes = await fetch(forecastUrl, { headers, signal: AbortSignal.timeout(10_000) });
    if (!fRes.ok) return null;
    const periods = ((await fRes.json())?.properties?.periods || []).slice(0, 8);
    if (!periods.length) return null;

    const today = periods[0];
    const daytime = periods.filter((p) => p.isDaytime).slice(0, 3);
    const threeDayLine = daytime
      .map((p) => `${p.name}: ${p.shortForecast}, ${p.temperature}°${p.temperatureUnit}`)
      .join(' · ');

    return {
      today: {
        name: today.name,
        temp: today.temperature,
        unit: today.temperatureUnit || 'F',
        short: today.shortForecast || '',
        detailed: today.detailedForecast || '',
        wind: today.windSpeed || '',
      },
      threeDayLine,
      days: daytime.map((p) => ({ name: p.name, temp: p.temperature, unit: p.temperatureUnit || 'F', short: p.shortForecast || '' })),
    };
  } catch {
    return null;
  }
}

/**
 * Read a client's weather config + fetch its forecast. Null when disabled,
 * unconfigured, or the fetch fails.
 * @returns {Promise<null | { place, zip, today, threeDayLine, days }>}
 */
async function getClientWeather(clientId) {
  if (!clientId) return null;
  let w = null;
  try {
    const cfg = (await fb.adminDb.collection('client_configs').doc(clientId).get()).data() || {};
    w = cfg.marketingBriefConfig?.weather || null;
  } catch {
    return null;
  }
  if (!w?.enabled || w.lat == null || w.lon == null) return null;
  const forecast = await getForecast(w.lat, w.lon);
  if (!forecast) return null;
  return { place: w.place || w.zip || '', zip: w.zip || '', ...forecast };
}

module.exports = { geocodeZip, getForecast, getClientWeather };
