/**
 * Weather signal provider for Strategy Builder.
 * Real Open-Meteo 7-day forecast (no API key). Fails soft to disabled.
 */

/** WMO code → human description */
function wmoDescription(code) {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 48) return 'Fog';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 99) return 'Thunderstorm';
  return 'Unknown';
}

/**
 * Returns a 7-day weather forecast for the given location.
 * @param {{ location?: { lat?: number, lng?: number }, enabled: boolean }} opts
 * @returns {Promise<{ enabled: boolean, forecast: import('../schemas.js').DayForecast[] }>}
 */
export async function getWeatherForecast({ location, enabled }) {
  if (!enabled || !location?.lat || !location?.lng) {
    return { enabled: false, forecast: [] };
  }

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}` +
      `&longitude=${location.lng}` +
      `&daily=weathercode,temperature_2m_max,temperature_2m_min` +
      `&timezone=auto&forecast_days=7`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { enabled: false, forecast: [] };

    const data = await res.json();
    const days = data?.daily;
    if (!days?.time?.length) return { enabled: false, forecast: [] };

    const forecast = days.time.map((date, i) => {
      const code = days.weathercode?.[i];
      return {
        date,
        tempMax: days.temperature_2m_max?.[i],
        tempMin: days.temperature_2m_min?.[i],
        weatherCode: code,
        description: wmoDescription(code),
      };
    });

    return { enabled: true, forecast };
  } catch {
    // Non-fatal — strategy generation continues without weather.
    return { enabled: false, forecast: [] };
  }
}
