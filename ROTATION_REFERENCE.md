# Rotation Reference Card

Quick visual reference for XYZ rotation angles.

## Understanding Radians

All rotation values are in **radians** (-π to π range).

| Degrees | Radians | Description |
|---------|---------|------------|
| 0° | 0 | No rotation |
| 45° | 0.785 | One-eighth turn |
| 90° | 1.571 | Quarter turn |
| 180° | 3.142 (π) | Half turn |
| 360° | 6.283 (2π) | Full rotation |

**Quick Conversion**: Radians = Degrees × 0.01745

## Visual Guide

### X Axis Rotation (Forward/Backward Tilt)

```
Looking from the side (Y-Z plane):

rotationX: -π to -1.5    rotationX: 0          rotationX: 0.3 to 1.5
(Tilts away at top)      (Straight)            (Tilts toward viewer)

        ╱╲                   ⭕                    ╲╱
       ╱  ╲                 ╱ ╲                    ╱ ╲
      ╱    ╲               ╱   ╲                  ╱   ╲
```

**Use Cases**:
- `-0.5 to -1.0`: Dramatic lean-back (vintage look)
- `0`: Straight, flat presentation
- `0.2 to 0.4`: Subtle forward lean (default: 0.3) ⭐
- `0.5 to 1.0`: Pronounced forward tilt (engagement)

---

### Y Axis Rotation (Left/Right Spin)

```
Looking from above (X-Z plane):

rotationY: -π to -1.5    rotationY: 0          rotationY: 0.5 to π
(Facing left)            (Center view)         (Facing right)

    ╱─╲                  ╱─╲                  ╱─╲
   ╱   ╲                ╱   ╲                ╱   ╲
  ╱     ╲              ╱     ╲              ╱     ╲
 ╱       ╲            ╱       ╲            ╱       ╲
```

**Most Impactful Rotation** - Changes primary viewing angle significantly!

**Use Cases**:
- `-1.0 to -0.5`: Rotated far left
- `-0.3 to 0.3`: Subtle angle (balanced)
- `0.5` ⭐: Default - Classic dynamic angle (recommended starting point)
- `1.0 to 1.5`: Far right rotation
- `π (3.14)`: 180° turn (viewing from opposite side)

**Pro Tips**:
- `0.3 to 0.7` range creates most visually interesting perspectives
- Combine with X rotation for maximum 3D effect
- Y rotation is the "star" rotation - use it first

---

### Z Axis Rotation (Roll/Spin)

```
Looking straight at screen (X-Y plane):

rotationZ: -1.57       rotationZ: 0           rotationZ: 0.785
(90° counter-clock)    (No roll)              (45° clockwise)

     ╱╲                  ⊙                      ◇
    ╱  ╲                ╱ ╲                    ╱ ╲
   ╱    ╲              ╱   ╲                  ╱   ╲
```

**Use Cases**:
- `-π to -1.5`: Dramatic left roll (dynamic, energetic)
- `-0.3 to -0.1`: Subtle left tilt (modern)
- `0` ⭐: No roll (default - balanced)
- `0.1 to 0.3`: Subtle right tilt
- `1.0 to 1.57`: Significant right roll (dramatic)

**Note**: Z rotation is subtle - use sparingly unless going for artistic/dramatic effect

---

## Common Angle Combinations

### Classic Isometric View
```
rotationX: 0.615 (35°)
rotationY: 0.785 (45°)
rotationZ: 0
```
Clean, professional 3D presentation commonly used in games.

### Dynamic Presentation ⭐ RECOMMENDED
```
rotationX: 0.3 (17°)
rotationY: 0.5 (29°)
rotationZ: 0
```
Default - balanced, engaging, professional. Great for hero sections.

### Dramatic Angle
```
rotationX: 0.6 (34°)
rotationY: 1.0 (57°)
rotationZ: 0
```
More intense tilt, very dynamic. Good for high-energy brands.

### Subtle & Elegant
```
rotationX: 0.1 (6°)
rotationY: 0.3 (17°)
rotationZ: 0
```
Minimal tilt, sophisticated. Perfect for luxury brands.

### Tilted/Modern
```
rotationX: 0.2 (11°)
rotationY: 0.4 (23°)
rotationZ: 0.2 (11°)
```
Adds slight Z-roll for contemporary feel.

### Wild & Artistic
```
rotationX: 0.8 (46°)
rotationY: 1.3 (74°)
rotationZ: 0.5 (29°)
```
Extreme angle - use for artistic/creative brands.

---

## Quick Reference Slider Values

| Visual Goal | X Value | Y Value | Z Value |
|-------------|---------|---------|---------|
| Straight up | 0 | 0 | 0 |
| Slightly forward | 0.2 | 0 | 0 |
| Forward & right | 0.3 | 0.5 | 0 |
| Isometric | 0.6 | 0.8 | 0 |
| Dramatic lean | 0.8 | 1.2 | 0 |
| Side view | 0 | π | 0 |
| Upside down | π | 0 | 0 |
| Spinning fast | 0 | varies | 0 |
| Rolled left | 0 | 0 | -0.8 |
| Rolled right | 0 | 0 | 0.8 |

---

## Animation Tip

Combine rotation with animation speed for dynamic effect:

```
Slow, meditative spin:
animationSpeed: 0.3
rotationY: slow increment (e.g., 0.1 per second)

Fast, energetic view:
animationSpeed: 1.5
rotationX: 0.5
rotationY: 0.8

Orbiting camera effect:
(Manually animate rotationY over time)
```

---

## Testing Rotation Values

1. Start with **default**: X: 0.3, Y: 0.5, Z: 0
2. Adjust **Y first** (most visible impact)
3. Then fine-tune **X** (adds depth)
4. Finally add **Z** (subtle artistic touch)

**Range Guide**:
- Slider shows values from **-π (-3.14)** to **π (3.14)**
- **Most useful range**: -2.0 to 2.0 (safe, predictable)
- **Extreme range**: Beyond ±2.5 (artistic, risky)

---

**Pro Tip**: Export your perfect rotation angle as part of your `hero-config.json` so you can recreate it across projects! 🎯
