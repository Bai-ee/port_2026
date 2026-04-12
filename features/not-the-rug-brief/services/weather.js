// services/weather.js — live weather sourcing for client operating windows

const DEFAULT_HEADERS = {
  Accept: 'application/geo+json',
};

function getWeatherConfig(config = {}) {
  return config.weather || null;
}

function getTimeZone(config = {}) {
  return config.timeZone || 'America/New_York';
}

function getLocalParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const read = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatLocalDateKey(date, timeZone) {
  const { year, month, day } = getLocalParts(date, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

function shiftLocalDate(dateKey, deltaDays) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

function buildOperationalWindow(config = {}, now = new Date()) {
  const weather = getWeatherConfig(config) || {};
  const timeZone = getTimeZone(config);
  const startHour = weather.operationalWindowStartHour ?? 7;
  const durationHours = weather.operationalWindowHours ?? 12;
  const localNow = getLocalParts(now, timeZone);
  const todayKey = formatLocalDateKey(now, timeZone);
  const windowDate = localNow.hour >= startHour + durationHours
    ? shiftLocalDate(todayKey, 1)
    : todayKey;

  return {
    timeZone,
    date: windowDate,
    startHour,
    endHour: startHour + durationHours,
    durationHours,
    startLocal: `${windowDate}T${pad(startHour)}:00`,
    endLocal: `${windowDate}T${pad(startHour + durationHours)}:00`,
  };
}

function buildRequestHeaders() {
  const userAgent = process.env.NWS_USER_AGENT
    || process.env.WEATHER_USER_AGENT
    || 'ScoutCrittersQuest/1.0 (contact required)';
  return {
    ...DEFAULT_HEADERS,
    'User-Agent': userAgent,
  };
}

async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url, { headers: buildRequestHeaders() });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`NWS fetch failed for ${url}: ${detail}`);
  }

  if (!response.ok) {
    throw new Error(`NWS request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

function parseWindSpeedMph(raw = '') {
  const matches = String(raw).match(/\d+/g);
  if (!matches || matches.length === 0) return null;
  return Math.max(...matches.map(Number));
}

function summarizeConditions(periods = []) {
  return [...new Set(
    periods
      .map((period) => period.shortForecast)
      .filter(Boolean)
  )].slice(0, 3);
}

function summarizeNeighborhood(periods = [], alerts = [], config = {}) {
  const thresholds = getWeatherConfig(config)?.thresholds || {};
  const temperatures = periods.map((period) => period.temperature).filter((value) => typeof value === 'number');
  const rainChances = periods
    .map((period) => {
      const value = period.probabilityOfPrecipitation;
      return typeof value === 'number' ? value : value?.value;
    })
    .filter((value) => typeof value === 'number');
  const windSpeeds = periods
    .map((period) => parseWindSpeedMph(period.windSpeed))
    .filter((value) => typeof value === 'number');
  const conditionLabels = summarizeConditions(periods);
  const alertLabels = alerts.map((alert) => alert.event);

  const maxTemp = temperatures.length ? Math.max(...temperatures) : null;
  const minTemp = temperatures.length ? Math.min(...temperatures) : null;
  const maxRainChance = rainChances.length ? Math.max(...rainChances) : 0;
  const maxWind = windSpeeds.length ? Math.max(...windSpeeds) : 0;

  const flags = [];
  if (maxTemp !== null && maxTemp >= (thresholds.heatRiskTempF ?? 85)) flags.push('heat-risk');
  else if (maxTemp !== null && maxTemp >= (thresholds.heatWatchTempF ?? 80)) flags.push('warm');
  if (minTemp !== null && minTemp <= (thresholds.coldRiskTempF ?? 35)) flags.push('cold-risk');
  if (maxRainChance >= (thresholds.highRainChancePct ?? 50)) flags.push('rain-risk');
  else if (maxRainChance >= (thresholds.moderateRainChancePct ?? 30)) flags.push('rain-possible');
  if (maxWind >= (thresholds.windyMph ?? 18)) flags.push('windy');
  if (alerts.length > 0) flags.push('official-alert');

  const summaryParts = [];
  if (conditionLabels.length > 0) summaryParts.push(conditionLabels.join(', '));
  if (maxTemp !== null && minTemp !== null) summaryParts.push(`${minTemp}–${maxTemp}F`);
  if (maxRainChance > 0) summaryParts.push(`up to ${maxRainChance}% precip chance`);
  if (maxWind > 0) summaryParts.push(`winds up to ${maxWind} mph`);
  if (alertLabels.length > 0) summaryParts.push(`alerts: ${alertLabels.join(', ')}`);

  let operationalTakeaway = 'No major weather disruption expected for the operating window.';
  if (flags.includes('official-alert')) {
    operationalTakeaway = 'Review official NWS alerts before assigning routes or promising timing.';
  } else if (flags.includes('heat-risk')) {
    operationalTakeaway = 'Favor earlier and shaded routes, shorten exposed pavement time, and watch for paw/heat stress.';
  } else if (flags.includes('rain-risk')) {
    operationalTakeaway = 'Expect wetter routes and slower transitions; plan towel, paw-cleanup, and shorter loop contingencies.';
  } else if (flags.includes('windy')) {
    operationalTakeaway = 'Waterfront routes may feel harsher than inland blocks; choose calmer segments for nervous dogs.';
  } else if (flags.includes('cold-risk')) {
    operationalTakeaway = 'Use shorter exterior exposure and prioritize quick-turn routes for small or senior dogs.';
  }

  return {
    summary: summaryParts.join(' | ') || 'No hourly forecast available for the operating window.',
    operationalTakeaway,
    maxTempF: maxTemp,
    minTempF: minTemp,
    maxPrecipChancePct: maxRainChance,
    maxWindMph: maxWind,
    flags,
  };
}

function toPeriodSnapshot(period, timeZone) {
  const start = new Date(period.startTime);
  const end = new Date(period.endTime);
  return {
    startTime: period.startTime,
    endTime: period.endTime,
    startLocalHour: getLocalParts(start, timeZone).hour,
    endLocalHour: getLocalParts(end, timeZone).hour,
    temperature: period.temperature,
    temperatureUnit: period.temperatureUnit,
    shortForecast: period.shortForecast,
    detailedForecast: period.detailedForecast,
    probabilityOfPrecipitation: period.probabilityOfPrecipitation?.value ?? null,
    windSpeed: period.windSpeed,
    windDirection: period.windDirection,
    isDaytime: period.isDaytime,
  };
}

function filterPeriodsForWindow(periods = [], window, timeZone) {
  return periods.filter((period) => {
    const start = new Date(period.startTime);
    const end = new Date(period.endTime);
    const startDate = formatLocalDateKey(start, timeZone);
    const endDate = formatLocalDateKey(end, timeZone);
    const startHour = getLocalParts(start, timeZone).hour;
    const endHour = getLocalParts(end, timeZone).hour;

    const overlapsDate = startDate === window.date || endDate === window.date;
    const overlapsHours = startHour < window.endHour && endHour > window.startHour;

    return overlapsDate && overlapsHours;
  });
}

async function fetchNeighborhoodForecast(neighborhood, config, window) {
  const pointUrl = `https://api.weather.gov/points/${neighborhood.latitude},${neighborhood.longitude}`;
  const pointData = await fetchJson(pointUrl);
  const forecastHourlyUrl = pointData?.properties?.forecastHourly;

  if (!forecastHourlyUrl) {
    throw new Error(`NWS points response missing hourly forecast URL for ${neighborhood.name}`);
  }

  const [hourlyData, alertsData] = await Promise.all([
    fetchJson(forecastHourlyUrl),
    fetchJson(`https://api.weather.gov/alerts/active?point=${neighborhood.latitude},${neighborhood.longitude}`),
  ]);

  const allPeriods = hourlyData?.properties?.periods || [];
  const periods = filterPeriodsForWindow(allPeriods, window, window.timeZone).map((period) => toPeriodSnapshot(period, window.timeZone));
  const alerts = (alertsData?.features || []).map((feature) => ({
    event: feature.properties?.event || 'Weather alert',
    headline: feature.properties?.headline || '',
    severity: feature.properties?.severity || '',
    urgency: feature.properties?.urgency || '',
    certainty: feature.properties?.certainty || '',
    onset: feature.properties?.onset || '',
    expires: feature.properties?.expires || '',
  }));

  return {
    name: neighborhood.name,
    latitude: neighborhood.latitude,
    longitude: neighborhood.longitude,
    source: 'NWS',
    sourceUrls: {
      points: pointUrl,
      forecastHourly: forecastHourlyUrl,
      alerts: `https://api.weather.gov/alerts/active?point=${neighborhood.latitude},${neighborhood.longitude}`,
    },
    periods,
    alerts,
    summary: summarizeNeighborhood(periods, alerts, config),
  };
}

function summarizeOverall(neighborhoods = [], window) {
  const populated = neighborhoods.filter((item) => item.periods.length > 0);
  if (populated.length === 0) {
    return {
      summary: 'No neighborhood forecast data was available for the operating window.',
      operationalTakeaway: 'Skip weather-led messaging until live forecast data is available.',
      affectedNeighborhoods: [],
      flags: [],
    };
  }

  const temps = populated.map((item) => item.summary.maxTempF).filter((value) => typeof value === 'number');
  const rains = populated.map((item) => item.summary.maxPrecipChancePct).filter((value) => typeof value === 'number');
  const winds = populated.map((item) => item.summary.maxWindMph).filter((value) => typeof value === 'number');
  const maxTemp = temps.length > 0 ? Math.max(...temps) : null;
  const maxRain = rains.length > 0 ? Math.max(...rains) : 0;
  const maxWind = winds.length > 0 ? Math.max(...winds) : 0;
  const flags = [...new Set(populated.flatMap((item) => item.summary.flags))];
  const affectedNeighborhoods = populated
    .filter((item) => item.summary.flags.length > 0)
    .map((item) => item.name);

  const summaryParts = [
    `${window.startLocal} to ${window.endLocal} ${window.timeZone}`,
    `max temp ${Number.isFinite(maxTemp) ? `${maxTemp}F` : 'n/a'}`,
    `max precip ${Number.isFinite(maxRain) ? `${maxRain}%` : '0%'}`,
    `max wind ${Number.isFinite(maxWind) ? `${maxWind} mph` : '0 mph'}`,
  ];

  let operationalTakeaway = 'Weather looks manageable across the service area.';
  if (flags.includes('official-alert')) {
    operationalTakeaway = 'There is an active NWS alert in at least one service neighborhood. Review it before locking routes or sending weather-led content.';
  } else if (flags.includes('heat-risk')) {
    operationalTakeaway = 'Plan the day like a heat-management window: earlier routes, more shade, shorter exposed loops, and clear paw-safety messaging.';
  } else if (flags.includes('rain-risk')) {
    operationalTakeaway = 'Build in rain slowdown and cleanup time. Content should focus on practical routine adjustments, not generic weather talk.';
  } else if (flags.includes('windy')) {
    operationalTakeaway = 'Waterfront neighborhoods may feel rougher than inland blocks. Keep route recommendations neighborhood-specific.';
  } else if (flags.includes('cold-risk')) {
    operationalTakeaway = 'Cold-sensitive dogs need shorter exposures and faster transitions than the full-service area average suggests.';
  }

    return {
      summary: summaryParts.join(' | '),
    operationalTakeaway,
    affectedNeighborhoods,
    flags,
  };
}

async function fetchOperationalWeather(config = {}) {
  const weather = getWeatherConfig(config);
  if (!weather || weather.provider !== 'nws') return null;

  const window = buildOperationalWindow(config);
  const neighborhoods = weather.serviceNeighborhoods || [];
  const results = [];

  for (const neighborhood of neighborhoods) {
    results.push(await fetchNeighborhoodForecast(neighborhood, config, window));
  }

  return {
    clientId: config.clientId,
    provider: 'nws',
    fetchedAt: new Date().toISOString(),
    operationalWindow: window,
    neighborhoods: results,
    overall: summarizeOverall(results, window),
  };
}

function buildWeatherContextBlock(weatherReport) {
  if (!weatherReport) return '';

  const lines = weatherReport.neighborhoods.map((neighborhood) => {
    const alerts = neighborhood.alerts.length > 0
      ? ` Alerts: ${neighborhood.alerts.map((alert) => alert.event).join(', ')}.`
      : '';
    return `- ${neighborhood.name}: ${neighborhood.summary.summary}. ${neighborhood.summary.operationalTakeaway}${alerts}`;
  });

  return `LIVE NWS WEATHER (${weatherReport.operationalWindow.startLocal} to ${weatherReport.operationalWindow.endLocal} ${weatherReport.operationalWindow.timeZone}):
Overall: ${weatherReport.overall.summary}. ${weatherReport.overall.operationalTakeaway}
Neighborhoods:
${lines.join('\n')}`;
}

module.exports = {
  buildOperationalWindow,
  buildWeatherContextBlock,
  fetchOperationalWeather,
};
