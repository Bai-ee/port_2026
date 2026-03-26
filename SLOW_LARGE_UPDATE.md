# Slow & Large Object Update

## What Was Updated

### 🐢 **Slower Animation Ranges** ⭐ KEY CHANGE

All animation/rotation speeds now support **MUCH slower motion**:

| Control | Old Range | New Range | Min Step |
|---------|-----------|-----------|----------|
| **Flow** | 0.1-3.0 | **0.01-3.0** | 0.01 |
| **Tire Spin Speed** | 0-5.0 | **0-3.0** | 0.01 |
| **Animation Speed** | 0.1-2.0 | **0.01-2.0** | 0.01 |

**Now you can set animations to barely perceptible motion:**
- Flow: 0.01 = particle orbits every 10+ minutes
- Tire Spin: 0.01 = rotation every 10+ minutes
- Animation Speed: 0.01 = 1% normal speed

### 📏 **Larger Object Support** ⭐ KEY CHANGE

Size controls now support **MUCH larger objects**:

| Control | Old Range | New Range |
|---------|-----------|-----------|
| **Scale** | 25-90 | **25-200** |
| **Torus Ring Size** | 0.5-2.0 | **0.5-5.0** |

**Now you can make massive objects:**
- Scale: 200 = 2.2x larger than before
- Torus Ring Size: 5.0 = 2.5x larger than before
- Combined = fills entire viewport!

### 📌 **Homepage Now Loads Hero-Config**

The default homepage now loads `hero-config (1).json`:
```json
{
  "scale": 90,               // Large
  "flow": 3,                 // Fast particle motion
  "tireSpinSpeed": 1.4,      // Z-axis spin (toward viewer)
  "torusMajorRadius": 2,     // 2x larger ring
  "animationSpeed": 0.1,     // Slow (10% speed)
  "particleSize": 0.1,       // Fine detail
  "bloomThreshold": 0.7,     // Selective glow
  "bloomStrength": 0,        // No bloom (clean)
  "rotationX": -2.44,        // Extreme angle
  "rotationY": -3.14,        // Nearly flipped
  "rotationZ": -3.09         // Rolled
}
```

---

## How to Make It Barely Move

### Method 1: Slow Flow (Particle Orbiting)
```
Go to: Animation Section
Set Flow: 0.01
Effect: Particles orbit every 10+ minutes
```

### Method 2: Slow Tire Spin
```
Go to: Tire Spin Section
Set Spin Speed: 0.01-0.05
Effect: Rotation is imperceptible
```

### Method 3: Slow Everything
```
Flow: 0.01
Animation Speed: 0.01
Tire Spin Speed: 0.01
Effect: Nearly static but with subtle motion
```

### Method 4: Completely Frozen
```
Tire Spin Speed: 0
Flow: Can be anything
Effect: Static, non-animated object
```

---

## How to Make It Much Larger

### Option 1: Increase Scale
```
Go to: Animation Section
Increase Scale: up to 200 (was 90 max)
Effect: Spreads particles further (fills screen)
```

### Option 2: Increase Torus Size
```
Go to: Shape Section
Increase Torus Ring Size: up to 5.0 (was 2.0 max)
Effect: Makes the geometry itself larger
```

### Option 3: Increase Particle Size
```
Go to: Effects Section
Increase Particle Size: 0.3-0.5
Effect: Each sphere is larger (adds mass)
```

### Option 4: Combine All Three
```
Scale: 200
Torus Ring Size: 4
Particle Size: 0.3
Effect: MASSIVE object filling entire viewport
```

---

## Speed Reference for "Barely Moving"

### Flow Speed (How fast particles orbit)
- **0.01**: 1 complete orbit every ~628 seconds (10.5 minutes!)
- **0.05**: 1 complete orbit every ~126 seconds (2 minutes)
- **0.1**: 1 complete orbit every ~63 seconds (1 minute)
- **0.5**: 1 complete orbit every ~12.6 seconds

### Tire Spin Speed (How fast tire rotates)
- **0.01**: 1 complete rotation every ~628 seconds (10.5 minutes!)
- **0.05**: 1 complete rotation every ~126 seconds (2 minutes)
- **0.1**: 1 complete rotation every ~63 seconds (1 minute)
- **0.5**: 1 complete rotation every ~12.6 seconds
- **1.4**: 1 complete rotation every ~4.5 seconds (config default)

### Animation Speed (Master multiplier)
- **0.01**: 1% of normal particle speed
- **0.1**: 10% of normal (config default)
- **1.0**: Normal speed
- **2.0**: Double speed

---

## Recommended "Barely Moving + Large" Setup

For an absolutely stunning, barely-moving, large torus:

```
Animation Section:
  Flow: 0.05              (slow particle orbit)
  Scale: 150              (very large)
  Animation Speed: 0.05   (slow motion)

Shape Section:
  Torus Ring Size: 3      (large ring)
  Tire Thickness: 0.5     (matches config)

Tire Spin Section:
  Spin Speed: 0.1         (slow rotation)
  Spin Axis: Y or Z       (your choice)

Rotation Section:
  X: -2.44 (from config)  (dramatic angle)
  Y: -3.14 (from config)  (nearly flipped)
  Z: -3.09 (from config)  (rolled)
```

**Result**: Massive torus, barely moving, dramatically angled, fills viewport 🎨

---

## Current Config Performance

The loaded config features:
- ✅ **Large size**: scale 90 + torusMajorRadius 2
- ✅ **Slow animation**: animationSpeed 0.1 (10% speed)
- ✅ **Visible spin**: tireSpinSpeed 1.4 (noticeable but not frantic)
- ✅ **Dramatic angle**: rotations near π (heavily tilted/flipped)
- ✅ **Z-axis spin**: Rotates toward viewer (dramatic effect)
- ✅ **Clean look**: bloomStrength 0 (no glow, sharp particles)

---

## What You Can Now Do

✅ **Set animations to near-zero** - set anything to 0.01 for imperceptible motion
✅ **Make massive objects** - scale to 200 or ring size to 5
✅ **Freeze it completely** - set tire spin to 0
✅ **Combine both** - huge + barely moving = luxury feel
✅ **Fine control** - 0.01 step size allows micro-adjustments

---

## Practical Examples

### "Premium Luxury Hero"
```
Scale: 180
Torus Ring Size: 4
Flow: 0.02
Tire Spin Speed: 0.15
Animation Speed: 0.05
```
Massive, elegant, barely perceptible motion. Perfect for luxury brands.

### "Cosmic Background"
```
Scale: 200
Torus Ring Size: 5
Flow: 0.01
Tire Spin Speed: 0.03
Animation Speed: 0.01
```
Fills viewport, nearly frozen. Ambient, meditative.

### "Data Visualization"
```
Scale: 150
Torus Ring Size: 2.5
Flow: 1
Tire Spin Speed: 0
Animation Speed: 0.1
```
Large, particles orbit normally, tire static. Technical feel.

### "Motion Graphics"
```
Scale: 120
Torus Ring Size: 2
Flow: 2
Tire Spin Speed: 1.5
Animation Speed: 1
```
Large, fast motion, energetic. Great for startups.

---

## Export Ready

Your `hero-config.json` now exports with full extended ranges support:

```json
{
  "params": {
    "scale": 150,
    "flow": 0.05,
    "tireSpinSpeed": 0.1,
    "torusMajorRadius": 3.5,
    "animationSpeed": 0.02,
    ...
  }
}
```

Load on any page for identical animation! 📦

---

## Summary

**You now have:**
- 🐢 Animations that can be nearly imperceptible (0.01 range)
- 📏 Objects that can be massive (200+ scale, 5.0+ ring size)
- 🎯 Fine granularity (0.01 step increments)
- 📌 Pre-loaded hero config as the new default
- ✨ Complete creative control

**To test**: Open control panel → try setting **Flow to 0.05** and **Scale to 150**. Watch a massive, slowly-moving torus! 🎉

Perfect for premium, sophisticated hero sections! ✨
