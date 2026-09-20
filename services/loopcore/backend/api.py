"""Phase 2/3 — minimal local API for the UI (stdlib only, no new deps).

Endpoints:
  GET  /api/tracks              -> candidate source tracks found on disk
  POST /api/upload?filename=<name> -> raw audio bytes as the body; saves into inputs/ and
                                     returns its repo-relative path (no multipart: the
                                     cgi module is gone in 3.13+)
  GET  /api/audio?path=<rel>    -> stream an allowlisted audio file
  POST /api/analyze             -> {path, meter, bars_per_loop} -> runs analyze_track(), returns analysis + loop preview
  GET  /api/analysis            -> last cached outputs/analysis.json
  POST /api/slice                -> {path, bars_per_loop} -> runs slice_track() against cached analysis.json, returns manifest
  POST /api/verify               -> {select_loop} -> runs verify_loops() against outputs/loops, returns report
  POST /api/repair               -> {loop_index, strategy} -> creates an explicit repaired loop artifact
  POST /api/update_grid          -> {phase_override, offset_nudge_samples, bpm_override, bars_per_loop} -> re-derives
                                     the downbeat grid from cached analysis.json's beats (no re-running inference)
  GET  /api/report               -> last cached outputs/loops/verification_report.json
"""
import hashlib
import json
import math
import os
import re
import sys
import uuid
import warnings
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

sys.path.insert(0, str(Path(__file__).parent))
import soundfile as sf  # noqa: E402

import analyze  # noqa: E402
import slice as slice_mod  # noqa: E402
import verify as verify_mod  # noqa: E402
import repair as repair_mod  # noqa: E402

TOOLS_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = TOOLS_ROOT.parent.parent
OUTPUTS_DIR = TOOLS_ROOT / "outputs"
INPUTS_DIR = TOOLS_ROOT / "inputs"
LOOPS_DIR = OUTPUTS_DIR / "loops"
ALLOWED_ROOTS = [REPO_ROOT / "public", INPUTS_DIR, OUTPUTS_DIR]
AUDIO_EXTS = {".wav", ".mp3", ".flac", ".aiff"}
CONTENT_TYPES = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".flac": "audio/flac", ".aiff": "audio/aiff"}
ANALYSIS_PATH = OUTPUTS_DIR / "analysis.json"
REPORT_PATH = LOOPS_DIR / "verification_report.json"

OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
INPUTS_DIR.mkdir(parents=True, exist_ok=True)


def resolve_allowlisted(raw_path):
    """Resolve raw_path (relative to REPO_ROOT or absolute) and require it
    fall under one of ALLOWED_ROOTS. Returns a Path or raises ValueError."""
    candidate = Path(raw_path)
    resolved = (candidate if candidate.is_absolute() else REPO_ROOT / candidate).resolve()
    for root in ALLOWED_ROOTS:
        root_resolved = root.resolve()
        if resolved == root_resolved or root_resolved in resolved.parents:
            if resolved.exists():
                return resolved
            raise ValueError(f"file not found: {resolved}")
    raise ValueError(f"path not under an allowed directory: {resolved}")


MAX_UPLOAD_BYTES = 400 * 1024 * 1024


def safe_upload_name(raw_name):
    """Reduce a client-supplied filename to a safe basename inside INPUTS_DIR.

    Any directory component is discarded outright, so '../../etc/passwd' can
    only ever become 'passwd' - and then fails the extension check."""
    name = Path(unquote(raw_name or "")).name
    if not name or name.startswith("."):
        raise ValueError("missing or invalid filename")
    suffix = Path(name).suffix.lower()
    if suffix not in AUDIO_EXTS:
        allowed = ", ".join(sorted(AUDIO_EXTS))
        raise ValueError(f"unsupported audio type '{suffix or 'none'}' (allowed: {allowed})")
    stem = re.sub(r"[^A-Za-z0-9._()\- ]+", "_", Path(name).stem).strip()
    return f"{stem or 'track'}{suffix}"


def unique_path(path):
    """Never silently overwrite an existing upload."""
    if not path.exists():
        return path
    for n in range(2, 1000):
        candidate = path.with_name(f"{path.stem} ({n}){path.suffix}")
        if not candidate.exists():
            return candidate
    raise ValueError("too many files with that name")


UPLOAD_STAGING_SUFFIX = ".upload-staging"  # never an AUDIO_EXTS suffix - stays invisible to find_tracks() and the dedupe scan


def _sha256_file(path, chunk_size=1024 * 1024):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def find_duplicate_upload(staged_path, staged_size):
    """Content-hash dedupe for uploads (2d, ACCURATE_TEMPO_PLAN.md): re-
    uploading identical bytes should reuse the already-stored file rather
    than writing another copy - inputs/ accumulated 4 copies of the same
    88MB track before this. Byte size is a cheap pre-filter (identical
    content is necessarily identical length) before falling back to a full
    sha256 compare, so unrelated tracks are never hashed at all."""
    staged_hash = None
    for existing in INPUTS_DIR.iterdir():
        if not existing.is_file() or existing == staged_path:
            continue
        if existing.suffix.lower() not in AUDIO_EXTS:
            continue
        try:
            if existing.stat().st_size != staged_size:
                continue
        except OSError:
            continue
        if staged_hash is None:
            staged_hash = _sha256_file(staged_path)
        if _sha256_file(existing) == staged_hash:
            return existing
    return None


def _cleanup_stray_upload_staging():
    """Best-effort cleanup of staging files left behind by a crashed/killed
    upload from a previous run - they're invisible to find_tracks() either
    way, this just keeps inputs/ tidy."""
    for stray in INPUTS_DIR.glob(f"{UPLOAD_STAGING_SUFFIX}-*"):
        try:
            stray.unlink()
        except OSError:
            pass


def find_tracks():
    found = []
    for root in [REPO_ROOT / "public", INPUTS_DIR]:
        if not root.exists():
            continue
        for p in sorted(root.iterdir()):
            if p.is_file() and p.suffix.lower() in AUDIO_EXTS:
                found.append(str(p.relative_to(REPO_ROOT)))
    return found


def loop_boundaries_preview(analysis, bars_per_loop):
    sr = analysis["sample_rate"]
    bpm = analysis["bpm_final"]
    meter = analysis["meter"]
    offset_samples = analysis["offset_samples"]
    duration_samples = int(analysis["duration_seconds"] * sr)
    samples_per_bar = sr * 60.0 / bpm * meter

    # Mirror slice.py's compute_boundaries region-end bound (1e) so this
    # preview - shown right after /api/analyze, before Slice ever runs -
    # doesn't promise a trailing loop that the actual slice will then skip
    # as a partial past the detected musical region's end.
    effective_duration_samples = duration_samples
    region_end_seconds = analysis.get("region_end_seconds")
    if region_end_seconds is not None:
        region_end_samples = int(round(region_end_seconds * sr))
        if 0 < region_end_samples < duration_samples:
            effective_duration_samples = region_end_samples

    boundaries = []
    i = 0
    while True:
        start = round(offset_samples + i * samples_per_bar * bars_per_loop)
        if start >= duration_samples:
            break
        end = round(offset_samples + (i + 1) * samples_per_bar * bars_per_loop)
        complete = end <= effective_duration_samples
        boundaries.append({
            "index": i,
            "start_sample": start,
            "end_sample": min(end, duration_samples),
            "start_seconds": start / sr,
            "end_seconds": min(end, duration_samples) / sr,
            "complete": complete,
        })
        if not complete:
            break
        i += 1
    return boundaries


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"  # required for Range/206 to behave with persistent connections

    def end_headers(self):
        # The Loop Studio UI (Next.js, http://localhost:3000) calls this
        # engine cross-origin. Only local origins are ever allowed.
        origin = self.headers.get("Origin", "")
        if origin.startswith("http://localhost:") or origin.startswith("http://127.0.0.1:"):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, message):
        self._json(status, {"error": message})

    def log_message(self, fmt, *args):
        sys.stderr.write("[api] " + (fmt % args) + "\n")

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/tracks":
            return self._json(200, {"tracks": find_tracks()})

        if parsed.path == "/api/analysis":
            if ANALYSIS_PATH.exists():
                return self._json(200, json.loads(ANALYSIS_PATH.read_text()))
            return self._error(404, "no analysis.json yet, run /api/analyze first")

        if parsed.path == "/api/audio":
            return self._serve_audio(send_body=True)

        if parsed.path == "/api/report":
            if REPORT_PATH.exists():
                return self._json(200, json.loads(REPORT_PATH.read_text()))
            return self._error(404, "no verification_report.json yet, run /api/verify first")

        return self._error(404, "not found")

    def do_HEAD(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/audio":
            return self._serve_audio(send_body=False)
        return self._error(404, "not found")

    def _serve_audio(self, send_body):
        # Chrome's native <audio>/<video> pipeline issues Range requests and
        # stalls indefinitely (readyState never advances past HAVE_NOTHING)
        # against a server that always replies 200 with Accept-Ranges: none —
        # even though plain fetch()/decodeAudioData works fine against the
        # same bytes. Real Range support (206 + Content-Range) is required.
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        raw = unquote(qs.get("path", [""])[0])
        if not raw:
            return self._error(400, "missing path")
        try:
            resolved = resolve_allowlisted(raw)
        except ValueError as e:
            return self._error(403, str(e))

        content_type = CONTENT_TYPES.get(resolved.suffix.lower(), "application/octet-stream")
        total = resolved.stat().st_size
        range_header = self.headers.get("Range")

        if range_header:
            try:
                units, _, range_spec = range_header.partition("=")
                start_s, _, end_s = range_spec.partition("-")
                start = int(start_s) if start_s else 0
                end = int(end_s) if end_s else total - 1
                end = min(end, total - 1)
            except ValueError:
                start, end = 0, total - 1
            if units != "bytes" or start > end or start >= total:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{total}")
                self.end_headers()
                return
            chunk_len = end - start + 1
            self.send_response(206)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Range", f"bytes {start}-{end}/{total}")
            self.send_header("Content-Length", str(chunk_len))
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            if send_body:
                with open(resolved, "rb") as f:
                    f.seek(start)
                    self.wfile.write(f.read(chunk_len))
            return

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(total))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        if send_body:
            self.wfile.write(resolved.read_bytes())

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length) or b"{}")

    def do_POST(self):
        parsed = urlparse(self.path)

        # Uploads carry raw audio bytes, not JSON - dispatch before the body
        # is parsed as JSON.
        if parsed.path == "/api/upload":
            return self._handle_upload(parsed)

        try:
            body = self._read_json_body()
        except json.JSONDecodeError:
            return self._error(400, "invalid JSON body")

        if parsed.path == "/api/analyze":
            return self._handle_analyze(body)
        if parsed.path == "/api/slice":
            return self._handle_slice(body)
        if parsed.path == "/api/verify":
            return self._handle_verify(body)
        if parsed.path == "/api/repair":
            return self._handle_repair(body)
        if parsed.path == "/api/update_grid":
            return self._handle_update_grid(body)
        return self._error(404, "not found")

    def _handle_upload(self, parsed):
        params = parse_qs(parsed.query)
        try:
            name = safe_upload_name((params.get("filename") or [""])[0])
        except ValueError as e:
            return self._error(400, str(e))

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._error(400, "invalid Content-Length")
        if length <= 0:
            return self._error(400, "empty upload")
        if length > MAX_UPLOAD_BYTES:
            return self._error(413, f"file too large ({length} bytes, max {MAX_UPLOAD_BYTES})")

        # Stream into a staging file first - dedupe needs the full bytes
        # before we know whether this is a re-upload of an existing track.
        # Staged in INPUTS_DIR itself so the eventual finalize is a same-
        # filesystem rename, not a copy.
        staging = INPUTS_DIR / f"{UPLOAD_STAGING_SUFFIX}-{uuid.uuid4().hex}{Path(name).suffix}"
        remaining = length
        try:
            with staging.open("wb") as fh:
                while remaining > 0:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    fh.write(chunk)
                    remaining -= len(chunk)
        except OSError as e:
            staging.unlink(missing_ok=True)
            return self._error(500, f"could not write file: {e}")

        if remaining > 0:
            staging.unlink(missing_ok=True)
            return self._error(400, "upload truncated")

        duplicate = find_duplicate_upload(staging, length)
        if duplicate is not None:
            staging.unlink(missing_ok=True)
            try:
                info = sf.info(duplicate)
            except Exception as e:
                return self._error(500, f"stored duplicate is unreadable: {e}")
            return self._json(200, {
                "path": str(duplicate.relative_to(REPO_ROOT)),
                "name": duplicate.name,
                "bytes": duplicate.stat().st_size,
                "duration_seconds": info.duration,
                "sample_rate": info.samplerate,
                "channels": info.channels,
                "deduped": True,
            })

        # Reject anything the analyzer could not read anyway, and hand back the
        # duration so the UI can say something useful straight away.
        try:
            info = sf.info(staging)
        except Exception as e:
            staging.unlink(missing_ok=True)
            # soundfile puts the absolute server path in its message; report the
            # filename the caller actually sent instead.
            reason = str(e).replace(str(staging), name)
            return self._error(400, f"could not read audio: {reason}")

        try:
            dest = unique_path(INPUTS_DIR / name)
            staging.rename(dest)
        except (ValueError, OSError) as e:
            staging.unlink(missing_ok=True)
            return self._error(500, f"could not finalize upload: {e}")

        return self._json(201, {
            "path": str(dest.relative_to(REPO_ROOT)),
            "name": dest.name,
            "bytes": length,
            "duration_seconds": info.duration,
            "sample_rate": info.samplerate,
            "channels": info.channels,
            "deduped": False,
        })

    def _handle_analyze(self, body):
        raw_path = body.get("path")
        meter = int(body.get("meter", analyze.DEFAULT_METER))
        bars_per_loop = int(body.get("bars_per_loop", 4))
        if not raw_path:
            return self._error(400, "missing 'path'")

        try:
            resolved = resolve_allowlisted(raw_path)
        except ValueError as e:
            return self._error(403, str(e))

        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                result = analyze.analyze_track(resolved, meter=meter)
        except Exception as e:
            return self._error(500, f"analysis failed: {type(e).__name__}: {e}")

        ANALYSIS_PATH.write_text(json.dumps(result, indent=2))
        result["bars_per_loop"] = bars_per_loop
        result["loop_boundaries_preview"] = loop_boundaries_preview(result, bars_per_loop)
        result["audio_url"] = f"/api/audio?path={resolved.relative_to(REPO_ROOT)}"
        return self._json(200, result)

    def _handle_slice(self, body):
        raw_path = body.get("path")
        bars_per_loop = int(body.get("bars_per_loop", 4))
        bit_depth = int(body.get("bit_depth", 16))
        if not raw_path:
            return self._error(400, "missing 'path'")
        if not ANALYSIS_PATH.exists():
            return self._error(400, "no analysis.json yet, run /api/analyze first")

        try:
            resolved = resolve_allowlisted(raw_path)
        except ValueError as e:
            return self._error(403, str(e))

        analysis = json.loads(ANALYSIS_PATH.read_text())
        try:
            manifest = slice_mod.slice_track(resolved, analysis, bars_per_loop, LOOPS_DIR, bit_depth)
        except Exception as e:
            return self._error(500, f"slice failed: {type(e).__name__}: {e}")
        return self._json(200, manifest)

    def _handle_verify(self, body):
        select_loop = int(body.get("select_loop", 0))
        repeat_count = int(body.get("repeat_count", 4))
        if not (LOOPS_DIR / "manifest.json").exists():
            return self._error(400, "no manifest.json yet, run /api/slice first")
        try:
            report = verify_mod.verify_loops(LOOPS_DIR, select_loop, repeat_count)
        except Exception as e:
            return self._error(500, f"verify failed: {type(e).__name__}: {e}")
        return self._json(200, report)

    def _handle_update_grid(self, body):
        if not ANALYSIS_PATH.exists():
            return self._error(400, "no analysis.json yet, run /api/analyze first")

        phase_override = body.get("phase_override")
        if phase_override is not None:
            phase_override = int(phase_override)
        offset_nudge_samples = int(body.get("offset_nudge_samples", 0))
        bars_per_loop = int(body.get("bars_per_loop", 4))

        bpm_override = body.get("bpm_override")
        if bpm_override is not None:
            try:
                bpm_override = float(bpm_override)
            except (TypeError, ValueError):
                return self._error(400, "bpm_override must be a number")
            if not math.isfinite(bpm_override) or not (20 <= bpm_override <= 400):
                return self._error(400, "bpm_override must be a finite number between 20 and 400 BPM")

        analysis = json.loads(ANALYSIS_PATH.read_text())
        updated = analyze.apply_grid_override(analysis, phase_override, offset_nudge_samples, bpm_override=bpm_override)
        ANALYSIS_PATH.write_text(json.dumps(updated, indent=2))

        updated["bars_per_loop"] = bars_per_loop
        updated["loop_boundaries_preview"] = loop_boundaries_preview(updated, bars_per_loop)
        source_path = Path(updated["source_path"])
        updated["audio_url"] = f"/api/audio?path={source_path.relative_to(REPO_ROOT)}" if source_path.is_absolute() else f"/api/audio?path={source_path}"
        return self._json(200, updated)

    def _handle_repair(self, body):
        if not (LOOPS_DIR / "manifest.json").exists():
            return self._error(400, "no manifest.json yet, run /api/slice first")

        try:
            loop_index = int(body.get("loop_index", 0))
        except (TypeError, ValueError):
            return self._error(400, "loop_index must be an integer")

        requested_strategy = str(body.get("strategy", "microfade"))
        strategy_aliases = {
            "zero_cross_snap": "zero_cross",
            "zero_cross": "zero_cross",
            "microfade": "microfade",
            "equal_power_crossfade": "crossfade",
            "crossfade": "crossfade",
            "silence_trim": "silence_trim",
        }
        strategy = strategy_aliases.get(requested_strategy)
        if strategy is None:
            return self._error(
                400,
                "strategy must be one of zero_cross_snap, microfade, equal_power_crossfade, silence_trim",
            )

        manifest = json.loads((LOOPS_DIR / "manifest.json").read_text())
        loop_info = next((loop for loop in manifest["loops"] if loop["index"] == loop_index), None)
        if loop_info is None:
            return self._error(404, f"loop {loop_index} not found in manifest")

        loop_path = Path(loop_info["path"])
        if not loop_path.is_absolute():
            loop_path = (REPO_ROOT / loop_path).resolve()

        try:
            resolve_allowlisted(str(loop_path))
        except ValueError as e:
            return self._error(403, str(e))

        repair_dir = OUTPUTS_DIR / "repair"
        out_path = repair_dir / f"loop_{loop_index:04d}_{strategy}.wav"
        kwargs = {}
        if strategy == "zero_cross":
            kwargs["search_window"] = int(body.get("search_window", 220))
        if strategy in {"microfade", "crossfade"}:
            kwargs["fade_ms"] = float(body.get("fade_ms", 8 if strategy == "microfade" else 15))
        if strategy == "silence_trim":
            kwargs["amplitude_threshold"] = float(body.get("amplitude_threshold", 0.01))
            kwargs["max_trim_ms"] = float(body.get("max_trim_ms", 100))

        try:
            result = repair_mod.repair_loop(loop_path, strategy, out_path, **kwargs)
        except Exception as e:
            return self._error(500, f"repair failed: {type(e).__name__}: {e}")

        result["requested_strategy"] = requested_strategy
        result["audio_url"] = f"/api/audio?path={out_path}"
        return self._json(200, result)


def main():
    _cleanup_stray_upload_staging()
    # 8766 by default so this instance never clashes with the edittrax
    # workbench engine on 8765.
    port = int(os.environ.get("LOOPCORE_PORT", "8766"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"loopcore api listening on http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
