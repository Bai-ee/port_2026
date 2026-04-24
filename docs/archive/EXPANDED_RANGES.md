# Expanded Control Ranges - Slower Animations & Larger Object

## What Changed

Control ranges have been dramatically expanded to allow:
- **Much slower animations** - down to barely perceptible motion
- **Much larger object** - scale and size increased significantly

---

## New Control Ranges

### 🎬 Animation Section

#### Flow / Rotation Speed
**Old**: 0.1 - 3.0
**New**: 0.01 - 3.0 ⭐ **10x slower possible**
- **0.01**: Extremely slow (1 orbit per 628 seconds = 10+ minutes!)
- **0.05**: Very slow (2 minutes per orbit)
- **0.1**: Slow (1 minute per orbit)
- **0.3**: Moderate
- **1.0**: Balanced
- **3.0**: Fast

#### Scale / Expansion
**Old**: 25 - 90
**New**: 25 - 200 ⭐ **2.2x larger possible**
- **25**: Compact
- **90**: Large (previous max)
- **150**: Very large
- **200**: Massive, fills entire screen

#### Overall Animation Speed
**Old**: 0.1 - 2.0
**New**: 0.01 - 2.0 ⭐ **10x slower possible**
- **0.01**: Extremely slow particle motion
- **0.05**: Very slow
- **0.1**: Slow (default)
- **1.0**: Normal
- **2.0**: Double speed

### 🍩 Shape Section

#### Torus Ring Size
**Old**: 0.5 - 2.0
**New**: 0.5 - 5.0 ⭐ **2.5x larger possible**
- **0.5**: Small compact ring
- **1.0**: Standard size
- **2.0**: Large (previous max)
- **3.0**: Very large
- **5.0**: Massive ring

### 🛞 Tire Spin Section

#### Tire Spin Speed
**Old**: 0 - 5.0
**New**: 0 - 3.0 (with 0.01 step) ⭐ **Finer granularity**
- **0**: Static (frozen)
- **0.01**: Nearly imperceptible (1 rotation per 628 seconds)
- **0.1**: Very slow (1 rotation per 63 seconds)
- **0.5**: Slow (1 rotation per 12.6 seconds)
- **1.4**: Moderate (1 rotation per 4.5 seconds)
- **3.0**: Fast (1 rotation per 2.1 seconds)

---

## New Default Configuration

The homepage now loads with `hero-config (1).json` defaults:

```json
{
  "params": {
    "scale": 90,
    "chaos": 1.55,
    "flow": 3,
    "tireSpinSpeed": 1.4,
    "torusMajorRadius": 2,
    "particleSize": 0.1,
    "animationSpeed": 0.1,
    "bloomThreshold": 0.7,
    "bloomStrength": 0,
    ...
  }
}
```

**Features**:
- ✅ Large object (scale: 90, torusMajorRadius: 2)
- ✅ Slow animations (flow: 3, animationSpeed: 0.1)
- ✅ Z-axis tire spin (tireSpinSpeed: 1.4)
- ✅ Dynamic rotation angles for dramatic tilt

---

## How to Make It Barely Move

### Option 1: Slow Flow (Particle Orbit)
1. Go to **Animation** section
2. Set **Flow** to `0.05` or lower
3. Particles orbit very slowly

### Option 2: Slow Tire Spin
1. Go to **Tire Spin** section
2. Set **Spin Speed** to `0.01` or `0.05`
3. Tire rotates almost imperceptibly

### Option 3: Slow Everything
1. **Flow**: 0.01
2. **Animation Speed**: 0.01
3. **Tire Spin Speed**: 0.01
4. Result: Almost frozen animation with subtle motion

### Option 4: Completely Frozen
1. Set **Tire Spin Speed**: 0
2. Leave **Flow** and **Animation Speed** at default
3. Result: Static, non-animated object

---

## Recommended Slow Configurations

### "Subtle Luxury" - Very Slow, Large, Elegant
```
Scale: 120
Flow: 0.1
Tire Spin Speed: 0.2
Animation Speed: 0.05
Torus Major Radius: 2.5
```
Barely moving, premium feel, fills viewport.

### "Ambient Background" - Imperceptible Motion
```
Scale: 150
Flow: 0.01
Tire Spin Speed: 0.05
Animation Speed: 0.01
Torus Major Radius: 3
```
So slow it's almost static, massive presence.

### "Meditative" - Slow Spin, Large
```
Scale: 100
Flow: 0.3
Tire Spin Speed: 0.3
Animation Speed: 0.1
Torus Major Radius: 2
```
Gently moving, professional, fills screen.

### "Dramatic Frozen Tilt" - No Animation
```
Scale: 150
Tire Spin Speed: 0
Flow: 0.5 (particle animation off if desired)
Torus Major Radius: 2.5
```
Completely frozen, perfect tilted angle.

---

## Speed References

### Flow Speed (Particle Orbital Motion)

| Speed | Time per Orbit | Use Case |
|-------|--------|----------|
| 0.01 | ~628 sec (10+ min) | Barely perceptible |
| 0.05 | ~126 sec (2 min) | Extremely slow |
| 0.1 | ~63 sec (1 min) | Very slow |
| 0.3 | ~21 sec | Slow |
| 0.6 | ~10 sec | Moderate |
| 1.0 | ~6.3 sec | Balanced |
| 3.0 | ~2.1 sec | Fast |

### Tire Spin Speed (Rotation About Axis)

| Speed | Time per Rotation | Use Case |
|-------|--------|----------|
| 0 | ∞ (Frozen) | Static |
| 0.01 | ~628 sec (10+ min) | Imperceptible |
| 0.05 | ~126 sec (2 min) | Nearly invisible |
| 0.1 | ~63 sec (1 min) | Very subtle |
| 0.3 | ~21 sec | Slow |
| 0.5 | ~12.6 sec | Moderate |
| 1.0 | ~6.3 sec | Noticeable |
| 1.4 | ~4.5 sec | Default config |
| 3.0 | ~2.1 sec | Fast |

### Animation Speed Multiplier

| Speed | Effect | Use Case |
|-------|--------|----------|
| 0.01 | 1% of normal | Extremely slow particles |
| 0.05 | 5% of normal | Very slow |
| 0.1 | 10% of normal | Slow (default) |
| 0.5 | 50% of normal | Half-speed |
| 1.0 | 100% of normal | Normal |
| 2.0 | 200% of normal | Double-speed |

---

## Making the Object Larger

### Approach 1: Increase Scale
1. Go to **Animation** section
2. Increase **Scale** (was max 90, now max 200)
3. Spreads particles further apart

### Approach 2: Increase Torus Size
1. Go to **Shape** section
2. Increase **Torus Ring Size** (was max 2, now max 5)
3. Makes the ring geometry itself larger

### Approach 3: Combine Both
For **maximum size**:
- **Scale**: 200
- **Torus Ring Size**: 5
- **Particle Size**: 0.2-0.3
Result: Massive, fills viewport!

### Approach 4: Increase Particle Size
1. Go to **Effects** section
2. Increase **Particle Size** (0.1 is default in config)
3. Makes each sphere larger (adds visual mass)

---

## Current Hero Config Advantages

The loaded `hero-config (1).json` gives you:
- ✅ **Large**: scale 90, torusMajorRadius 2
- ✅ **Dramatic angle**: 3 rotations at extreme angles (nearly flipped)
- ✅ **Z-axis spin**: Spins toward viewer (dramatic effect)
- ✅ **Slow particle animation**: animationSpeed 0.1 = 10% normal speed
- ✅ **Moderate tire spin**: tireSpinSpeed 1.4 = visible but not frantic
- ✅ **Small particles**: particleSize 0.1 = detailed/sharp appearance
- ✅ **Minimal bloom**: bloomStrength 0 = clean look

---

## Workflow: Maximum Slowness

For "barely moving" animations:
1. **Animation** section → Set **Flow** to `0.01`
2. **Animation** section → Set **Animation Speed** to `0.01`
3. **Tire Spin** section → Set **Spin Speed** to `0.01`
4. **Shape** section → Increase **Torus Ring Size** to `3-4`
5. **Animation** section → Increase **Scale** to `150-200`
6. Result: Massive, barely-moving torus 🎯

---

## Export & Integration

Your config will now include the expanded ranges:

```json
{
  "params": {
    "scale": 150,
    "flow": 0.01,
    "tireSpinSpeed": 0.05,
    "torusMajorRadius": 3,
    "animationSpeed": 0.01
  }
}
```

These values work across projects with the new expanded ranges! 📦

---

## Tips

- **Slider Step Values**: Now 0.01 for speed/animation controls = precise control
- **Barely Moving**: Set any speed to 0.01-0.05 range
- **Large Object**: Use Scale 150+ OR Torus Ring Size 3+
- **Both**: Combined = massive, barely-moving sculpture

---

**Quick Start for Barely-Moving, Large Object**:
1. Set **Flow** to 0.05
2. Set **Scale** to 150
3. Set **Torus Ring Size** to 2.5
4. Set **Tire Spin Speed** to 0.1
5. Watch a massive, slowly rotating tire 🎨

Perfect for hero sections with sophisticated, slow motion! ✨
