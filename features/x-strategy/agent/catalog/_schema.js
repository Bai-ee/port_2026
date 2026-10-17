// Tiny JSON-schema builders for the action catalog. Pure; no imports.
// Every `args` schema is a JSON-schema subset: object / string / number / integer / boolean / array, `enum`,
// `required`, `items`, `description`. `additionalProperties:false` is the default so the runtime can DROP unknown
// keys before they reach a route (the catalog splits dangerous fields into separate, higher-tier entries).

export const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
export const num = (description, extra = {}) => ({ type: 'number', description, ...extra });
export const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
export const bool = (description, extra = {}) => ({ type: 'boolean', description, ...extra });
export const arr = (items, description, extra = {}) => ({ type: 'array', items, description, ...extra });
export const obj = (properties = {}, required = [], extra = {}) => ({
  type: 'object', properties, required, additionalProperties: false, ...extra,
});
/** Free-form object the route validates itself (shape described in `description`). */
export const open = (description) => ({ type: 'object', description, additionalProperties: true });
export const none = () => obj({}, []);

export const iso = (d) => str(d, { format: 'date-time' });
export const day = (d) => str(d, { pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
export const postId = str('The social_posts id (social_...).');
export const expectedRevision = int('The post revision you read; the write is refused (409) if the post changed since.');
