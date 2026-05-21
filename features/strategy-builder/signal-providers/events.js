/**
 * Local events signal provider for Strategy Builder.
 * Events are user-supplied and stored at
 * dashboard_state/{clientId}.strategyBuilder.events; the generate route reads
 * that path and passes the array in here for normalization.
 */

/**
 * @param {{ events?: Array<{id?:string,name:string,date:string}>, enabled: boolean }} opts
 * @returns {Promise<{ enabled: boolean, items: import('../schemas.js').LocalEvent[] }>}
 */
export async function getLocalEvents({ events, enabled }) {
  if (!enabled) {
    return { enabled: false, items: [] };
  }

  const items = (Array.isArray(events) ? events : [])
    .filter((e) => e && e.name && e.date)
    .map((e, i) => ({
      id: e.id || `evt-${i}`,
      name: String(e.name).slice(0, 80),
      date: e.date,
    }))
    .filter((e) => !Number.isNaN(new Date(e.date).getTime()));

  return { enabled: true, items };
}
