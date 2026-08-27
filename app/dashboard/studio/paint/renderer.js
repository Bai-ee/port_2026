// Paint Studio p5 renderer adapter — client-only. Every mount function here
// must only ever be invoked from client code (never at module top-level
// during SSR/build); the top-level `import p5 from 'p5'` below is safe
// because importing the p5 package itself does not touch window/document —
// only constructing an instance (`new p5(...)`) does, and that only happens
// inside mountPaintPreview/renderRecipeToCanvas, which are call-time-only.
import p5 from 'p5';
import { drawBookTypography } from './book-typography.js';

// Bump ONLY when this adapter's drawing contract changes in a way that could
// alter rendered pixels for an otherwise-unchanged recipe (e.g. the
// setup/seed sequencing, pixelDensity handling) — independent of individual
// template `version` bumps, which track each template's own render() changes.
export const PAINT_RENDERER_REVISION = 4;

// Builds one p5 instance-mode sketch function. `getTemplate`/`getRecipe` are
// read at draw time (not captured once) so a live preview can swap the
// template/recipe in place via the returned controller's `update()`.
// `isDestroyed()` guards `p.setup` — see createInstance()'s comment for why
// this is required (p5 v2's own instance.remove() cannot cancel a
// not-yet-started instance).
function buildSketch({ width, height, getTemplate, getRecipe, onFirstDraw, isDestroyed }) {
  return function sketch(p) {
    // p5 v2 renamed the Catmull-Rom curve-vertex API from curveVertex() to
    // splineVertex() (identical call signature — see p5's v2 migration
    // notes); the installed p5 is v2.x, but the first-party template
    // catalogue (watercolour-bloom/botanical-weave/pigment-burst) was
    // authored against the pre-rename name. Rather than chase this rename
    // across every template (a first-party, growing catalogue), the adapter
    // aliases it once, here, so template code stays version-agnostic. A
    // no-op on any p5 build where curveVertex already exists.
    if (typeof p.curveVertex !== 'function' && typeof p.splineVertex === 'function') {
      p.curveVertex = p.splineVertex.bind(p);
    }
    // p5 v2 also changed bezierVertex()'s call contract: v1 packed one
    // cubic-bezier segment into a single 6-argument 2D call —
    // bezierVertex(cx1,cy1,cx2,cy2,x,y) — continuing from whatever point was
    // most recently added (via vertex()/bezierVertex()). v2's bezierVertex
    // instead takes exactly ONE point per call — see p5's own bezier()
    // primitive (p5.Renderer), which is defined as three sequential
    // bezierVertex(x,y) calls for the two control points and the end
    // anchor. Detect the legacy packed 6-arg 2D form and decompose it into
    // that same three-call sequence so template code stays version-agnostic;
    // any other arg count (already v2-native) passes straight through.
    const nativeBezierVertex = p.bezierVertex ? p.bezierVertex.bind(p) : null;
    if (nativeBezierVertex) {
      p.bezierVertex = (...args) => {
        if (args.length === 6) {
          nativeBezierVertex(args[0], args[1]);
          nativeBezierVertex(args[2], args[3]);
          nativeBezierVertex(args[4], args[5]);
          return;
        }
        nativeBezierVertex(...args);
      };
    }

    let resolvedFirstDraw = false;

    function drawOnce() {
      const template = getTemplate();
      const recipe = getRecipe();
      // Determinism rule: p5's own seeded RNG drives every stochastic choice
      // inside template.render() (p.random()/p.noise()) — never Math.random().
      p.randomSeed(recipe.seed);
      p.noiseSeed(recipe.seed);
      p.clear();
      if (template && typeof template.render === 'function') {
        template.render(p, { width: p.width, height: p.height }, recipe);
      }
      drawBookTypography(p, recipe, template);
      if (!resolvedFirstDraw && typeof onFirstDraw === 'function') {
        resolvedFirstDraw = true;
        onFirstDraw(p.canvas);
      }
    }

    p.setup = () => {
      // p5 v2's instance lifecycle (#_start/#_setup) is always deferred by
      // at least one microtask past `new p5(...)` returning — even when
      // document.readyState is already 'complete' — because those internal
      // methods are themselves `async` and yield at their own first
      // `await`. p5's own `instance.remove()` cannot cancel that in-flight
      // chain: its DOM-teardown/abort-signal logic all lives inside an
      // `if (this._curElement)` guard, which is still false before this
      // very callback has run. Concretely, this bites React StrictMode's
      // dev-only mount→cleanup→remount dance: the FIRST instance's
      // `destroy()` runs (and its `.remove()` no-ops, since setup hasn't
      // fired yet) before its deferred setup() finally arrives — without
      // this guard, that orphaned instance would still create a canvas and
      // draw into it, alongside the second (real) instance. Checking our
      // own destroyed flag here, synchronously inside the callback we
      // control, is the one place that reliably prevents that.
      if (isDestroyed && isDestroyed()) {
        // p5 v2's #_setup() unconditionally creates its own default 100x100
        // canvas BEFORE ever invoking this callback (see the comment
        // above) — normally replaced by our own createCanvas() below, but
        // since we're bailing out, that default canvas is otherwise left
        // orphaned in the DOM (and, per this adapter's own CSS, stretched
        // to fill the container) forever. Remove it.
        if (p.canvas && p.canvas.parentNode) p.canvas.parentNode.removeChild(p.canvas);
        return;
      }
      p.createCanvas(width, height);
      // Critical gotcha: p5 defaults pixelDensity() to devicePixelRatio,
      // which would make the canvas backing store a multiple of the
      // requested size on retina displays and silently break exact-size PNG
      // export. Force 1:1 so p.canvas.width/height always equal width/height.
      p.pixelDensity(1);
      p.noLoop();
      drawOnce();
    };

    // Exposed so a preview controller can trigger a redraw without
    // recreating the whole p5 instance when only template/recipe changed
    // (not the output dimensions).
    p.__paintDrawOnce = drawOnce;
  };
}

// Creates one p5 instance plus a `markDestroyed()` companion function. Every
// caller that later tears an instance down MUST call `instance.__paintMarkDestroyed()`
// (in addition to `instance.remove()`) so a StrictMode-doubled or
// dimension-change-superseded instance whose setup() hasn't fired yet is
// guaranteed to stay inert once its deferred setup eventually arrives — see
// the comment inside buildSketch's `p.setup` above for why `.remove()` alone
// is not sufficient.
function createInstance({ container, width, height, getTemplate, getRecipe, onFirstDraw }) {
  let destroyed = false;
  const instance = new p5(
    buildSketch({ width, height, getTemplate, getRecipe, onFirstDraw, isDestroyed: () => destroyed }),
    container
  );
  instance.__paintMarkDestroyed = () => {
    destroyed = true;
  };
  return instance;
}

function destroyInstance(instance) {
  if (!instance) return;
  if (typeof instance.__paintMarkDestroyed === 'function') instance.__paintMarkDestroyed();
  instance.remove();
}

// Live preview: mounts a p5 instance into `container` (a real DOM element
// the caller owns and sizes via CSS), sized to the recipe's exact output
// pixel dimensions, and draws once (noLoop). Returns a controller so the
// caller can push a new template/recipe (redraw) or tear down (unmount /
// StrictMode / recipe change) without leaking p5 instances.
export function mountPaintPreview(container, { template, recipe }) {
  if (!container) {
    throw new Error('mountPaintPreview requires a container element');
  }
  if (!recipe || !recipe.output) {
    throw new Error('mountPaintPreview requires recipe.output.{width,height}');
  }

  let currentTemplate = template;
  let currentRecipe = recipe;
  let instance = createInstance({
    container,
    width: currentRecipe.output.width,
    height: currentRecipe.output.height,
    getTemplate: () => currentTemplate,
    getRecipe: () => currentRecipe,
  });

  return {
    // Push a new template and/or recipe and redraw. If the output dimensions
    // changed, the p5 instance is torn down and recreated (canvas size can't
    // change without a new createCanvas); otherwise the existing instance is
    // reused and just redraws — cheaper for a param-slider drag.
    update(nextTemplate, nextRecipe) {
      const template2 = nextTemplate || currentTemplate;
      const recipe2 = nextRecipe || currentRecipe;
      if (!recipe2 || !recipe2.output) {
        throw new Error('update requires a recipe with recipe.output.{width,height}');
      }
      const dimensionsChanged =
        !instance ||
        instance.width !== recipe2.output.width ||
        instance.height !== recipe2.output.height;

      currentTemplate = template2;
      currentRecipe = recipe2;

      if (dimensionsChanged) {
        destroyInstance(instance);
        instance = createInstance({
          container,
          width: currentRecipe.output.width,
          height: currentRecipe.output.height,
          getTemplate: () => currentTemplate,
          getRecipe: () => currentRecipe,
        });
        return;
      }

      if (instance && typeof instance.__paintDrawOnce === 'function') {
        instance.__paintDrawOnce();
      }
    },
    destroy() {
      if (instance) {
        destroyInstance(instance);
        instance = null;
      }
    },
  };
}

// One-shot exact-size render for export. Creates its own throwaway,
// non-visible container, mounts a p5 instance sized EXACTLY to
// recipe.output.{width,height}, draws once, and resolves with the resulting
// canvas element from inside the sketch's own single draw pass — so the
// caller can safely assume the canvas is fully drawn the moment the promise
// resolves (no setTimeout/requestAnimationFrame guessing).
//
// The caller (the integration agent) is responsible for reading pixels
// (toDataURL/toBlob) from the resolved canvas before it goes away. This
// function deliberately does not remove the throwaway container on success
// (only on a setup error) since the caller still needs to read from the
// live canvas after the promise resolves; as a convenience (not part of the
// contract) a `_paintCleanup()` function is attached to the resolved canvas
// so a caller that no longer needs the node can dispose of it explicitly.
export function renderRecipeToCanvas(recipe, template) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('renderRecipeToCanvas requires a DOM environment'));
      return;
    }
    if (!recipe || !recipe.output) {
      reject(new Error('renderRecipeToCanvas requires recipe.output.{width,height}'));
      return;
    }

    const width = recipe.output.width;
    const height = recipe.output.height;

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-99999px';
    container.style.top = '0';
    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    container.setAttribute('aria-hidden', 'true');
    document.body.appendChild(container);

    let instance = null;
    const cleanup = () => {
      if (instance) {
        destroyInstance(instance);
        instance = null;
      }
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    };

    try {
      instance = createInstance({
        container,
        width,
        height,
        getTemplate: () => template,
        getRecipe: () => recipe,
        onFirstDraw: (canvas) => {
          // eslint-disable-next-line no-param-reassign
          canvas._paintCleanup = cleanup;
          resolve(canvas);
        },
      });
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}
