import { scoreXPost } from '/Users/bballi/Documents/Repos/Bballi_Portfolio/features/x-growth/index.js';

const drafts = [
  ['tool-artifact', 'video', 'grabbed the cloth and let go. the rebound is real verlet physics, not an easing curve'],
  ['tool-artifact', 'video', 'spent the weekend making paper behave like paper'],
  ['tool-artifact', 'video', 'every invoice i send now renders on simulated paper. absolutely nobody asked for this'],
  ['tool-artifact', 'video', 'sliced a break into 16 pads and dumped it straight to an SP-16 scene file. no daw involved'],
  ['quote-react', 'none', 'the mechanical engineering in this is unreal 😮‍💨'],
  ['quote-react', 'none', 'pre-internet designers were operating on a different plane'],
  ['craft-advice', 'none', 'if your webgl scene feels cheap it is almost always the lighting, not the geometry. three things that fixed mine:'],
  ['craft-advice', 'video', 'print pagination in the browser is a nightmare nobody warns you about. here is what actually works'],
  ['hot-take', 'none', 'hot take: most "AI design tools" are just a worse figma with a text box glued on'],
  ['hot-take', 'none', 'everyone shipping ai slop forgot that the craft was the product'],
  ['build-in-public', 'video', 'shipped a cloth simulation into my invoice generator because i could not stop thinking about it'],
  ['personal', 'none', 'i build design tools all day and still open figma to think. the tool you reach for first tells you what you actually trust'],
  ['bad-example-link', 'none', 'check out my new studio tool here https://hitloop.example.com/studio it does cloth simulation and more'],
  ['bad-example-hashtag', 'image', 'new project drop 🚀 #design #webgl #creativecoding #threejs'],
];

const rows = drafts.map(([pillar, mediaType, text]) => {
  const s = scoreXPost(text, { mediaType });
  return { pillar, mediaType, text, s };
});
rows.sort((a, b) => (b.s.xGrowthScore ?? 0) - (a.s.xGrowthScore ?? 0));

console.log('shape:', JSON.stringify(Object.keys(rows[0].s)));
console.log();
for (const r of rows) {
  const sc = r.s;
  console.log(`${String(sc.xGrowthScore).padStart(5)} [${r.pillar}/${r.mediaType}] ${r.text.slice(0, 95)}`);
  if (sc.warnings?.length) console.log(`        ⚠ ${sc.warnings.join(' | ')}`);
  if (sc.suggestions?.length) console.log(`        → ${sc.suggestions.slice(0, 2).join(' | ')}`);
}
