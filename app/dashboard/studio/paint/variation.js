// Paint's authoring-time randomizer. It is deliberately allowed to use an
// injected entropy source to create a *new* recipe; the result is then fully
// normalized and serialized, so every saved/exported result is reproducible.

import { createRecipe } from './recipe.js';

export function buildStartOptions(templates) {
  return (templates || []).flatMap((template) => {
    if (Array.isArray(template.directions) && template.directions.length) {
      return template.directions.map((direction, artDirection) => ({
        key: `${template.id}:${direction.id}`,
        templateId: template.id,
        artDirection,
        label: direction.label,
      }));
    }
    return [{ key: template.id, templateId: template.id, artDirection: null, label: template.label }];
  });
}

function randomParam(bounds, random) {
  const min = Number.isFinite(bounds?.min) ? bounds.min : 0;
  const max = Number.isFinite(bounds?.max) ? bounds.max : 1;
  const step = Number.isFinite(bounds?.step) && bounds.step > 0 ? bounds.step : 0.01;
  const steps = Math.max(0, Math.round((max - min) / step));
  return min + Math.floor(random() * (steps + 1)) * step;
}

export function createRandomStart(currentRecipe, templates, random = Math.random) {
  const starts = buildStartOptions(templates);
  if (!starts.length) throw new Error('Paint needs at least one registered template to randomize.');
  const currentTemplate = templates.find((template) => template.id === currentRecipe?.templateId);
  const currentDirection = currentTemplate?.directions?.[Math.round(currentRecipe?.params?.artDirection || 0)];
  const currentKey = currentDirection
    ? `${currentTemplate.id}:${currentDirection.id}`
    : currentRecipe?.templateId;
  const alternatives = starts.filter((start) => start.key !== currentKey);
  const selected = (alternatives.length ? alternatives : starts)[Math.floor(random() * (alternatives.length || starts.length))];
  const template = templates.find((entry) => entry.id === selected.templateId);
  const params = {};
  Object.entries(template?.schema?.params || {}).forEach(([key, bounds]) => {
    params[key] = randomParam(bounds, random);
  });
  if (selected.artDirection !== null) params.artDirection = selected.artDirection;
  const palettes = template?.palettes || [];
  const palette = palettes.length ? palettes[Math.floor(random() * palettes.length)] : null;
  return createRecipe(selected.templateId, {
    seed: Math.floor(random() * 0xffffffff),
    paletteId: palette?.id,
    params,
    output: { formatId: currentRecipe?.output?.formatId },
  });
}
