"""Phase B — downbeat detection and phase-candidate ranking.

Primary source is Beat This! (ISMIR 2024, works on Python 3.14 unlike
madmom/BeatNet - see PHASE_A_REPORT.md). Its downbeat choice is cross-checked
against an independent audio-feature phase ranking (kick/low-freq energy,
onset strength, chroma novelty, consistency) rather than trusted blindly -
agreement between the two is itself a confidence signal. The same ranking
also serves as the fallback downbeat method if Beat This! is unavailable.

Known simplification: "section-level regularity" from the spec is approximated
by onset-strength consistency across candidate beats, not true structural
segmentation (self-similarity matrices) - that's out of scope for this POC.
"""
import numpy as np
import librosa


def detect_beats_and_downbeats_beat_this(wav_path):
    from beat_this.inference import File2Beats

    f2b = File2Beats(checkpoint_path="final0", device="cpu", dbn=False)
    beats, downbeats = f2b(str(wav_path))
    return np.asarray(beats, dtype=float), np.asarray(downbeats, dtype=float)


def selected_phase_from_downbeats(beats, downbeats, meter=4):
    """Which phase (0..meter-1) of the beats array Beat This!'s own downbeats
    correspond to, for comparison against the independent phase ranking."""
    if len(downbeats) == 0 or len(beats) == 0:
        return None
    first_downbeat_idx = int(np.argmin(np.abs(beats - downbeats[0])))
    return first_downbeat_idx % meter


def _low_freq_energy_envelope(mono, sr, cutoff_hz=200, hop_length=512, n_fft=2048):
    stft = np.abs(librosa.stft(mono, n_fft=n_fft, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    band = stft[freqs <= cutoff_hz]
    return band.sum(axis=0)


def _chroma_novelty_envelope(mono, sr, hop_length=512):
    chroma = librosa.feature.chroma_stft(y=mono, sr=sr, hop_length=hop_length)
    novelty = np.linalg.norm(np.diff(chroma, axis=1), axis=0)
    return np.concatenate([[0.0], novelty])


def _sample_envelope_at_times(envelope, sr, hop_length, times):
    frames = librosa.time_to_frames(times, sr=sr, hop_length=hop_length)
    frames = np.clip(frames, 0, len(envelope) - 1)
    return envelope[frames]


def _minmax(values):
    lo, hi = float(np.min(values)), float(np.max(values))
    if hi - lo < 1e-9:
        return np.ones_like(values) * 0.5
    return (values - lo) / (hi - lo)


def rank_downbeat_phases(mono, sr, beats, meter=4, hop_length=512):
    """Score each of `meter` beat phases as the likely true downbeat phase.
    Returns a list of {phase, score, reason} sorted best-first."""
    if len(beats) < meter * 2:
        return [{"phase": p, "score": 0.0, "reason": "not enough beats to score"} for p in range(meter)]

    onset_env = librosa.onset.onset_strength(y=mono, sr=sr, hop_length=hop_length)
    low_freq_env = _low_freq_energy_envelope(mono, sr, hop_length=hop_length)
    chroma_env = _chroma_novelty_envelope(mono, sr, hop_length=hop_length)

    onset_at_beats = _sample_envelope_at_times(onset_env, sr, hop_length, beats)
    lowfreq_at_beats = _sample_envelope_at_times(low_freq_env, sr, hop_length, beats)
    chroma_at_beats = _sample_envelope_at_times(chroma_env, sr, hop_length, beats)

    phase_scores = []
    onset_means, lowfreq_means, chroma_means, consistency_raw = [], [], [], []
    for p in range(meter):
        idx = np.arange(p, len(beats), meter)
        onset_means.append(float(np.mean(onset_at_beats[idx])))
        lowfreq_means.append(float(np.mean(lowfreq_at_beats[idx])))
        chroma_means.append(float(np.mean(chroma_at_beats[idx])))
        vals = onset_at_beats[idx]
        cv = float(np.std(vals) / (np.mean(vals) + 1e-9))
        consistency_raw.append(-cv)  # lower CV = more consistent = higher score

    onset_n = _minmax(np.array(onset_means))
    lowfreq_n = _minmax(np.array(lowfreq_means))
    chroma_n = _minmax(np.array(chroma_means))
    consistency_n = _minmax(np.array(consistency_raw))

    for p in range(meter):
        combined = 0.25 * onset_n[p] + 0.25 * lowfreq_n[p] + 0.25 * chroma_n[p] + 0.25 * consistency_n[p]
        parts = []
        if onset_n[p] > 0.7:
            parts.append("strong onset strength")
        if lowfreq_n[p] > 0.7:
            parts.append("strong kick/low-frequency energy")
        if chroma_n[p] > 0.7:
            parts.append("harmonic change support")
        if consistency_n[p] > 0.7:
            parts.append("consistent across the track")
        reason = ", ".join(parts) if parts else "no single feature dominant"
        phase_scores.append({"phase": p, "score": round(float(combined), 4), "reason": reason})

    return sorted(phase_scores, key=lambda x: -x["score"])
