// forked from design-sync lib/bundle.mjs — shim Next.js + Firebase imports so
// the portfolio app's components bundle cleanly without framework context.

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { IIFE_IMPORT_META_DEFINE } from '../../.ds-sync/lib/common.mjs';

export function resolveDistEntry({ pkgDir, pkgJson, override, pkgName, soft = false }) {
  if (override) {
    const p = resolve(override);
    if (!existsSync(p)) {
      console.error(`[NO_DIST] --entry ${override} doesn't exist — run the DS's build.`);
      if (soft) return null;
      process.exit(1);
    }
    return p;
  }
  const str = (v) => (typeof v === 'string' ? v : v?.default ? str(v.default) : null);
  const cand = [
    pkgJson.module,
    str(pkgJson.exports?.['.']?.import),
    str(pkgJson.exports?.['.']?.default),
    str(pkgJson.exports?.['.']),
    pkgJson.main,
  ].filter((c) => typeof c === 'string');
  for (const c of cand) {
    const p = join(pkgDir, c);
    if (existsSync(p)) return p;
  }
  if (soft) return null;
  console.error(
    `[NO_DIST] ${pkgName} has no built entry (tried ${cand.join(', ')} under ${pkgDir}). ` +
      `Run the DS's build script, or use 'npm install ${pkgName}@latest' in a scratch dir and pass --node-modules.`,
  );
  process.exit(1);
}

export const reactShim = {
  name: 'react-global',
  setup(b) {
    b.onResolve({ filter: /^react(\/(jsx-(dev-)?runtime|compiler-runtime))?$/ }, () => ({
      path: 'react-shim',
      namespace: 'shim',
    }));
    b.onResolve({ filter: /^react-dom(\/client)?$/ }, () => ({
      path: 'react-dom-shim',
      namespace: 'shim',
    }));
    b.onResolve({ filter: /^react-is$/ }, () => ({ path: 'react-is-shim', namespace: 'shim' }));
    b.onResolve({ filter: /^scheduler(\/|$)/ }, () => ({ path: 'scheduler-shim', namespace: 'shim' }));
    b.onLoad({ filter: /^react-shim$/, namespace: 'shim' }, () => ({
      contents: `var R=window.React;
function jsx(t,p,k){return R.createElement(t,k===void 0?p:Object.assign({key:k},p));}
module.exports=R;
module.exports.jsx=jsx;module.exports.jsxs=jsx;module.exports.jsxDEV=jsx;
module.exports.Fragment=R.Fragment;`,
      loader: 'js',
    }));
    b.onLoad({ filter: /^react-dom-shim$/, namespace: 'shim' }, () => ({
      contents: 'var D=window.ReactDOM,n=function(){};' +
        'module.exports=Object.assign({preload:n,preinit:n,preconnect:n,prefetchDNS:n,preloadModule:n,preinitModule:n},D);',
      loader: 'js',
    }));
    b.onLoad({ filter: /^react-is-shim$/, namespace: 'shim' }, () => ({
      contents: `var R=window.React;
var FWD=Symbol.for("react.forward_ref"),MEMO=Symbol.for("react.memo"),PORTAL=Symbol.for("react.portal"),LAZY=Symbol.for("react.lazy");
function tt(o){return o!=null&&typeof o==="object"?(R.isValidElement(o)?(o.type&&o.type.$$typeof)||o.type:o.$$typeof):undefined}
exports.typeOf=tt;
exports.isElement=R.isValidElement;
exports.isValidElementType=function(t){return typeof t==="string"||typeof t==="function"||t===R.Fragment||t===R.Suspense||t===R.StrictMode||t===R.Profiler||(t!=null&&typeof t==="object"&&t.$$typeof!=null)};
exports.isFragment=function(o){return R.isValidElement(o)&&o.type===R.Fragment};
exports.isSuspense=function(o){return R.isValidElement(o)&&o.type===R.Suspense};
exports.isPortal=function(o){return o!=null&&o.$$typeof===PORTAL};
exports.isForwardRef=function(o){return tt(o)===FWD};
exports.isMemo=function(o){return tt(o)===MEMO};
exports.isLazy=function(o){return tt(o)===LAZY};
exports.isContextProvider=exports.isContextConsumer=exports.isProfiler=exports.isStrictMode=function(){return false};
exports.ForwardRef=FWD;exports.Memo=MEMO;exports.Portal=PORTAL;exports.Lazy=LAZY;
exports.Fragment=R.Fragment;exports.Suspense=R.Suspense;exports.StrictMode=R.StrictMode;exports.Profiler=R.Profiler;`,
      loader: 'js',
    }));
    b.onLoad({ filter: /^scheduler-shim$/, namespace: 'shim' }, () => ({
      contents: `throw new Error("[SCHEDULER_MISSING] this DS's dist/ imports 'scheduler' directly — usually react-dom leaked into the dist. Check the DS build's externals.");`,
      loader: 'js',
    }));
  },
};

// Shim Next.js framework + Firebase so portfolio components bundle without
// needing a Next.js runtime or real Firebase credentials.
const nextFirebaseShim = {
  name: 'next-firebase-shim',
  setup(b) {
    // next/link → plain anchor
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'next-link', namespace: 'shim' }));
    // next/navigation → stub hooks
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'next-navigation', namespace: 'shim' }));
    // next/dynamic → React.lazy wrapper
    b.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: 'next-dynamic', namespace: 'shim' }));
    // next/script → null render
    b.onResolve({ filter: /^next\/script$/ }, () => ({ path: 'next-script', namespace: 'shim' }));
    // next/web-vitals → no-op
    b.onResolve({ filter: /^next\/web-vitals$/ }, () => ({ path: 'next-webvitals', namespace: 'shim' }));
    // next/image → plain img
    b.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'next-image', namespace: 'shim' }));
    // firebase/app → stub
    b.onResolve({ filter: /^firebase\/app$/ }, () => ({ path: 'firebase-app', namespace: 'shim' }));
    // firebase/auth → mock
    b.onResolve({ filter: /^firebase\/auth$/ }, () => ({ path: 'firebase-auth', namespace: 'shim' }));
    // firebase/firestore → mock
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'firebase-firestore', namespace: 'shim' }));
    // firebase/storage → mock
    b.onResolve({ filter: /^firebase\/storage$/ }, () => ({ path: 'firebase-storage', namespace: 'shim' }));
    // local firebase config (e.g. ../../firebase or ./firebase)
    b.onResolve({ filter: /^(\.\.?\/)*firebase(\.js)?$/ }, () => ({ path: 'local-firebase', namespace: 'shim' }));
    // local AuthContext
    b.onResolve({ filter: /^(\.\.?\/)*AuthContext(\.jsx?)?$/ }, () => ({ path: 'auth-context', namespace: 'shim' }));
    // pageSurfaceSystem + portfolioContent (local utilities)
    b.onResolve({ filter: /^(\.\.?\/)*pageSurfaceSystem(\.js)?$/ }, () => ({ path: 'page-surface-shim', namespace: 'shim' }));

    b.onLoad({ filter: /^next-link$/, namespace: 'shim' }, () => ({
      contents: `var R=window.React;
function Link({href,children,...p}){return R.createElement('a',Object.assign({href:href},p),children);}
module.exports=Link;module.exports.default=Link;`,
      loader: 'js',
    }));

    b.onLoad({ filter: /^next-navigation$/, namespace: 'shim' }, () => ({
      contents: `var n=function(){};
var router={push:n,replace:n,back:n,forward:n,prefetch:n,pathname:'/',query:{}};
exports.useRouter=function(){return router;};
exports.usePathname=function(){return '/';};
exports.useSearchParams=function(){return {get:function(){return null;},toString:function(){return '';},has:function(){return false;}};};
exports.useParams=function(){return {};};
exports.redirect=n;exports.notFound=n;`,
      loader: 'js',
    }));

    b.onLoad({ filter: /^next-dynamic$/, namespace: 'shim' }, () => ({
      contents: `var R=window.React;
module.exports=function dynamic(factory,opts){
  var C=R.lazy(factory);
  return function(props){return R.createElement(R.Suspense,{fallback:null},R.createElement(C,props));};
};
module.exports.default=module.exports;`,
      loader: 'js',
    }));

    b.onLoad({ filter: /^next-script$/, namespace: 'shim' }, () => ({
      contents: `function Script(){return null;}
module.exports=Script;module.exports.default=Script;`,
      loader: 'js',
    }));

    b.onLoad({ filter: /^next-webvitals$/, namespace: 'shim' }, () => ({
      contents: `exports.useReportWebVitals=function(){};`,
      loader: 'js',
    }));

    b.onLoad({ filter: /^next-image$/, namespace: 'shim' }, () => ({
      contents: `var R=window.React;
function Image({src,alt,width,height,...p}){return R.createElement('img',Object.assign({src:src,alt:alt||'',width:width,height:height},p));}
module.exports=Image;module.exports.default=Image;`,
      loader: 'js',
    }));

    b.onLoad({ filter: /^firebase-app$/, namespace: 'shim' }, () => ({
      contents: `exports.initializeApp=function(){return {};};
exports.getApp=function(){return {};};
exports.getApps=function(){return [];};`,
      loader: 'js',
    }));

    b.onLoad({ filter: /^firebase-auth$/, namespace: 'shim' }, () => ({
      contents: `var n=function(){return Promise.resolve({});};var nn=function(){};
exports.getAuth=function(){return {currentUser:null};};
exports.onAuthStateChanged=function(a,cb){cb(null);return nn;};
exports.signInWithEmailAndPassword=n;
exports.signOut=function(){return Promise.resolve();};
exports.createUserWithEmailAndPassword=n;
exports.GoogleAuthProvider=function(){return {};};
exports.signInWithPopup=n;
exports.sendPasswordResetEmail=function(){return Promise.resolve();};
exports.updateProfile=function(){return Promise.resolve();};
exports.sendEmailVerification=function(){return Promise.resolve();};`,
      loader: 'js',
    }));

    b.onLoad({ filter: /^firebase-firestore$/, namespace: 'shim' }, () => ({
      contents: `var n=function(){};var np=function(){return Promise.resolve({});};
var emptySnap={docs:[],empty:true,size:0,forEach:n,data:function(){return {};}};
exports.getFirestore=function(){return {};};
exports.collection=function(){return {};};
exports.doc=function(){return {};};
exports.getDoc=function(){return Promise.resolve({exists:function(){return false;},data:function(){return {};},id:'',ref:{}});};
exports.getDocs=function(){return Promise.resolve(emptySnap);};
exports.setDoc=np;exports.updateDoc=np;exports.deleteDoc=np;exports.addDoc=function(){return Promise.resolve({id:'mock-id'});};
exports.query=function(r){return r;};
exports.where=function(){return {};};
exports.orderBy=function(){return {};};
exports.limit=function(){return {};};
exports.limitToLast=function(){return {};};
exports.startAfter=function(){return {};};
exports.onSnapshot=function(r,cb){if(typeof cb==='function'){cb(emptySnap);}return n;};
exports.serverTimestamp=function(){return null;};
exports.Timestamp={now:function(){return {toDate:function(){return new Date();}};},fromDate:function(d){return {toDate:function(){return d;}};},fromMillis:function(){return {toDate:function(){return new Date();}};}};
exports.arrayUnion=function(){return {};};exports.arrayRemove=function(){return {};};exports.increment=function(){return {};};
exports.writeBatch=function(){return {set:n,update:n,delete:n,commit:function(){return Promise.resolve();}};};`,
      loader: 'js',
    }));

    b.onLoad({ filter: /^firebase-storage$/, namespace: 'shim' }, () => ({
      contents: `exports.getStorage=function(){return {};};
exports.ref=function(){return {};};
exports.uploadBytes=function(){return Promise.resolve({});};
exports.getDownloadURL=function(){return Promise.resolve('');};`,
      loader: 'js',
    }));

    b.onLoad({ filter: /^local-firebase$/, namespace: 'shim' }, () => ({
      contents: `exports.db=null;exports.auth=null;exports.firebaseApp=null;exports.isFirebaseConfigured=false;exports.storage=null;`,
      loader: 'js',
    }));

    b.onLoad({ filter: /^auth-context$/, namespace: 'shim' }, () => ({
      contents: `var R=window.React;
var Ctx=R.createContext({user:null,loading:false,logout:function(){return Promise.resolve();}});
exports.AuthContext=Ctx;
exports.useAuth=function(){return R.useContext(Ctx);};
exports.AuthProvider=function(props){return R.createElement(Ctx.Provider,{value:{user:null,loading:false,logout:function(){return Promise.resolve();}}},props.children);};`,
      loader: 'js',
    }));

    b.onLoad({ filter: /^page-surface-shim$/, namespace: 'shim' }, () => ({
      contents: `exports.getSurface=function(){return 'dark';};exports.pageSurface={};`,
      loader: 'js',
    }));
  },
};

export function tsconfigPathsPlugin(tsconfigPath) {
  let paths, baseUrl;
  try {
    const raw = readFileSync(tsconfigPath, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    ({ paths, baseUrl = '.' } = JSON.parse(raw).compilerOptions ?? {});
  } catch { return null; }
  if (!paths) return null;
  const base = resolve(dirname(tsconfigPath), baseUrl);
  const rules = Object.entries(paths).map(([k, v]) => ({
    prefix: k.replace(/\*$/, ''),
    targets: (Array.isArray(v) ? v : [v]).map((t) => resolve(base, t.replace(/\*$/, ''))),
    wild: k.endsWith('*'),
  }));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter = new RegExp(`^(?:${rules.map((r) => esc(r.prefix)).join('|')})`);
  const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
  return {
    name: 'tsconfig-paths',
    setup(b) {
      b.onResolve({ filter }, (args) => {
        for (const r of rules) {
          if (r.wild ? !args.path.startsWith(r.prefix) : args.path !== r.prefix) continue;
          const tail = r.wild ? args.path.slice(r.prefix.length) : '';
          for (const t of r.targets) {
            const stem = join(t, tail);
            for (const ext of exts) {
              if (existsSync(stem + ext)) return { path: stem + ext };
            }
          }
        }
        return undefined;
      });
    },
  };
}

function sharedBuildOptions({ nodePaths, tsconfig }) {
  const pathsPlugin = tsconfig ? tsconfigPathsPlugin(tsconfig) : null;
  const plugins = [reactShim, nextFirebaseShim];
  if (pathsPlugin) plugins.unshift(pathsPlugin);
  return {
    bundle: true,
    platform: 'browser',
    target: 'es2020',
    nodePaths: [nodePaths],
    plugins,
    metafile: true,
    loader: {
      '.svg': 'dataurl',
      '.png': 'dataurl',
      '.woff': 'dataurl',
      '.woff2': 'dataurl',
    },
    minify: false,
    // 'process.env' catches all bare process.env.* refs (e.g. Stripe's
    // NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) that esbuild would otherwise leave
    // as-is, crashing the browser where process is undefined.
    // esbuild applies most-specific match first, so NODE_ENV still wins.
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  };
}

export async function bundleToIife({ entry, globalName, nodePaths, out, tsconfig }) {
  const bundleJs = join(out, '_ds_bundle.js');
  const bundleCss = join(out, '_ds_bundle.css');
  const shared = sharedBuildOptions({ nodePaths, tsconfig });
  let buildResult;
  try {
    buildResult = await build({
      ...shared,
      entryPoints: [entry],
      format: 'iife',
      globalName,
      footer: { js: `window.${globalName}=${globalName}.__dsMainNs?Object.assign({},${globalName},${globalName}.__dsMainNs,{__dsMainNs:undefined}):${globalName};` },
      outfile: bundleJs,
      logLevel: 'warning',
      define: { ...shared.define, ...IIFE_IMPORT_META_DEFINE },
    });
  } catch (e) {
    const unresolved = [...new Set((e.errors ?? []).map((er) => er.text.match(/Could not resolve "([^"]+)"/)?.[1]).filter(Boolean))];
    const siblings = unresolved.filter((p) => {
      const pj = join(nodePaths, p, 'package.json');
      if (!existsSync(pj)) return false;
      try {
        const j = JSON.parse(readFileSync(pj, 'utf8'));
        const ent = j.module ?? j.main ?? 'index.js';
        return !existsSync(join(nodePaths, p, ent));
      } catch { return false; }
    });
    if (siblings.length) {
      console.error(`[WORKSPACE_SIBLING] ${siblings.join(', ')} exist in node_modules but aren't built (no dist entry). Run their build, or npm install the published versions.`);
    } else if (unresolved.length) {
      console.error(`[UNRESOLVED_IMPORT] ${unresolved.join(', ')} — missing from node_modules.`);
    }
    throw e;
  }
  const REACT_PKGS = new Set(['react', 'react-dom', 'react-is']);
  const inlinedExternals = [
    ...new Set(
      Object.keys(buildResult?.metafile?.inputs ?? {})
        .map((p) => p.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//)?.[1])
        .filter((pkg) => pkg && !REACT_PKGS.has(pkg)),
    ),
  ].sort();
  console.error(`  bundle: ${(statSync(bundleJs).size / 1024).toFixed(0)} KB`);
  console.error(`  inlined npm packages: ${inlinedExternals.length}`);
  return { bundleJs, bundleCss, inlinedExternals };
}

export async function bundleExportEvidence({ entry, nodePaths, tsconfig }) {
  try {
    const r = await build({
      ...sharedBuildOptions({ nodePaths, tsconfig }),
      entryPoints: [entry],
      format: 'esm',
      write: false,
      outfile: '__ds_export_evidence.mjs',
      logLevel: 'silent',
    });
    const out = Object.values(r.metafile?.outputs ?? {})[0];
    const exports = new Set((out?.exports ?? []).filter((n) => n !== '__dsMainNs'));
    const cjsPresent = Object.entries(r.metafile?.inputs ?? {}).some(
      ([k, i]) => i.format === 'cjs' && !k.startsWith('shim:'),
    );
    return { exports, cjsPresent };
  } catch {
    return null;
  }
}

export function stampHeader(bundleJs, { namespace, components, inlinedExternals }) {
  const body = readFileSync(bundleJs, 'utf8');
  const out = dirname(bundleJs);
  const sourceHashes = Object.fromEntries(
    components.flatMap((c) => {
      const base = `components/${c.group}/${c.name}/${c.name}`;
      return ['.jsx', '.d.ts', '.prompt.md']
        .map((ext) => base + ext)
        .filter((rel) => existsSync(join(out, rel)))
        .map((rel) => [rel, createHash('sha256').update(readFileSync(join(out, rel))).digest('hex').slice(0, 12)]);
    }),
  );
  const meta = {
    namespace,
    components: components.map((c) => ({
      name: c.name,
      sourcePath: `components/${c.group}/${c.name}/${c.name}.jsx`,
    })),
    sourceHashes,
    inlinedExternals,
    builtBy: 'cc-design-sync',
  };
  const headerJson = JSON.stringify(meta).replace(/\*\//g, '*\\/');
  writeFileSync(bundleJs, `/* @ds-bundle: ${headerJson} */\n` + body);
}
