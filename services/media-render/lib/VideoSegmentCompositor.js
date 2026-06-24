/**
 * VideoSegmentCompositor (normalized)
 *
 * Ported from EditVideos `worker/lib/VideoSegmentCompositor.js`, reduced to the
 * core render contract and stripped of Underground Existence specifics:
 *   - no Firebase Storage downloads (inputs are local files via MediaStore)
 *   - no global folders / artist images / default logos
 *   - no BPM/beat-sync, no DALL-E, no Arweave network calls
 *   - ffmpeg is spawned directly (no ffmpeg-static / fluent-ffmpeg dependency)
 *
 * Preserved FFmpeg behavior (the parts that matter for parity):
 *   - each segment is re-encoded to a fixed canvas, fps, yuv420p, with silent
 *     stereo audio added so segments are uniform and concat-safe
 *   - image inputs become zooming video segments (loop + zoompan)
 *   - quick-cut concatenation via the concat demuxer
 *   - a final pass applies the look filter (scale/pad/eq/curves/...) and muxes
 *     the music track if present
 *
 * FFmpeg env note (preserved from EditVideos): VFR iPhone `.mov` inputs and the
 * `drawtext` text-overlay filter require a *full* FFmpeg build, not the minimal
 * apt/npm default. See README.
 */

import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

function uniqueName(prefix, ext) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
}

export class VideoSegmentCompositor {
  /**
   * @param {object} opts
   * @param {string} [opts.tempDir]  working dir for intermediate files
   * @param {number} [opts.width]    canvas width  (default 720)
   * @param {number} [opts.height]   canvas height (default 720)
   * @param {number} [opts.fps]      output fps    (default 30)
   */
  constructor({ tempDir, width = 720, height = 720, fps = 30 } = {}) {
    this.tempDir = tempDir || path.join(os.tmpdir(), uniqueName('media-render', ''));
    this.width = width;
    this.height = height;
    this.fps = fps;
  }

  async init() {
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  async cleanup() {
    await fs.rm(this.tempDir, { recursive: true, force: true }).catch(() => {});
  }

  /** Probe duration in seconds via ffprobe; resolves null if unavailable. */
  async probeDuration(filePath) {
    return new Promise((resolve) => {
      execFile(
        FFPROBE,
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath],
        (err, stdout) => {
          if (err) return resolve(null);
          const d = parseFloat(String(stdout).trim());
          resolve(Number.isFinite(d) && d > 0 ? d : null);
        }
      );
    });
  }

  /**
   * Extract a `segmentDuration`s segment from a video file, normalized to the
   * canvas size / fps with silent stereo audio (mirrors EditVideos contract).
   */
  async extractVideoSegment(videoPath, segmentDuration = 5) {
    const out = path.join(this.tempDir, uniqueName('seg', '.mp4'));
    const dur = await this.probeDuration(videoPath);
    let startTime = 0;
    if (dur && dur > segmentDuration) {
      startTime = Math.random() * (dur - segmentDuration);
    }
    const realDuration = dur && dur < segmentDuration ? dur : segmentDuration;

    await this._run([
      '-i', videoPath,
      '-f', 'lavfi',
      '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-ss', startTime.toString(),
      '-t', realDuration.toString(),
      '-filter_complex',
      `[0:v]scale=${this.width}:${this.height}:force_original_aspect_ratio=increase,crop=${this.width}:${this.height},fps=${this.fps},format=yuv420p[v];[1:a]atrim=0:${realDuration}[a]`,
      '-map', '[v]',
      '-map', '[a]',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-r', this.fps.toString(),
      '-g', this.fps.toString(),
      '-c:a', 'aac',
      '-b:a', '128k',
      '-avoid_negative_ts', 'make_zero',
      '-y',
      out,
    ]);
    return out;
  }

  /**
   * Create a zooming video segment from a still image (loop + zoompan),
   * normalized to canvas/fps with silent stereo audio for concat parity.
   */
  async createImageSegment(imagePath, segmentDuration = 5) {
    const out = path.join(this.tempDir, uniqueName('img_seg', '.mp4'));
    const totalFrames = Math.max(2, Math.round(segmentDuration * 60));
    const zoomTarget = 1.5;
    const zoomExpr = `1+(${(zoomTarget - 1).toFixed(3)})*on/${totalFrames - 1}`;
    const vf = [
      `scale=${this.width}:${this.height}:force_original_aspect_ratio=increase`,
      `crop=${this.width}:${this.height}`,
      `zoompan=z='${zoomExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${this.width}x${this.height}:fps=60`,
      `fps=${this.fps}`,
    ].join(',');

    await this._run([
      '-loop', '1',
      '-framerate', '60',
      '-i', imagePath,
      '-f', 'lavfi',
      '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-filter_complex', `[0:v]${vf}[v];[1:a]atrim=0:${segmentDuration}[a]`,
      '-map', '[v]',
      '-map', '[a]',
      '-t', segmentDuration.toString(),
      '-r', this.fps.toString(),
      '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-y',
      out,
    ]);
    return out;
  }

  /** Concatenate normalized segments via the concat demuxer (quick cuts). */
  async concatSegments(segmentPaths, targetDuration) {
    if (!segmentPaths.length) throw new Error('[VideoSegmentCompositor] no segments to concat');
    const listPath = path.join(this.tempDir, uniqueName('concat', '.txt'));
    const list = segmentPaths
      .map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`)
      .join('\n');
    await fs.writeFile(listPath, list);

    const out = path.join(this.tempDir, uniqueName('concat', '.mp4'));
    await this._run([
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-t', targetDuration.toString(),
      '-y',
      out,
    ]);
    return out;
  }

  /**
   * Final pass: apply look filter and optionally mux a music track.
   * @param {string} concatPath  the concatenated silent/uniform video
   * @param {object} opts
   * @param {string|null} opts.filter     ffmpeg video filter string (from VideoFilters)
   * @param {string|null} opts.audioPath  local audio file to mux
   * @param {number} opts.durationSeconds output duration cap
   * @param {string} opts.outputPath      absolute output path to write
   */
  async finalize(concatPath, { filter = null, audioPath = null, durationSeconds = 30, outputPath }) {
    const args = ['-i', concatPath];
    if (audioPath) args.push('-i', audioPath);

    if (filter) {
      args.push('-vf', filter);
    }

    args.push(
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p'
    );

    if (audioPath) {
      // Use the external music track, drop the silent segment audio.
      args.push('-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k', '-shortest');
    } else {
      args.push('-c:a', 'aac', '-b:a', '128k');
    }

    args.push('-t', durationSeconds.toString(), '-movflags', '+faststart', '-y', outputPath);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await this._run(args);
    return outputPath;
  }

  /** Spawn ffmpeg and validate exit code; surfaces the tail of stderr on failure. */
  _run(args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => {
        if (code === 0) return resolve();
        const tail = stderr.length > 800 ? stderr.slice(-800) : stderr;
        reject(new Error(`[VideoSegmentCompositor] ffmpeg exited ${code}: ${tail.split('\n').slice(-3).join(' ')}`));
      });
    });
  }
}
