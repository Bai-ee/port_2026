function normalizeValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value
      .map(normalizeValue)
      .filter((item) => item !== undefined);
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      code: value.code || null,
      stage: value.stage || null,
    };
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      const normalized = normalizeValue(nested);
      if (normalized !== undefined) out[key] = normalized;
    }
    return out;
  }
  return value;
}

function write(level, event, meta = {}) {
  const payload = normalizeValue({
    ts: new Date().toISOString(),
    level,
    event,
    ...meta,
  });

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

function logInfo(event, meta) {
  write('info', event, meta);
}

function logWarn(event, meta) {
  write('warn', event, meta);
}

function logError(event, meta) {
  write('error', event, meta);
}

module.exports = {
  logError,
  logInfo,
  logWarn,
};
