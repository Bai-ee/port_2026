# Tire Spin Animation Guide

Complete control over your animated tire rotation with independent speed and axis selection.

## Two Types of Rotation Now Available

### 1. **Static Tilt** (Rotation section)
The angle at which the torus is tilted/positioned:
- **X Axis**: Forward/backward lean (-π to π)
- **Y Axis**: Left/right angle (-π to π)
- **Z Axis**: Side roll (-π to π)

These set the fixed orientation of your torus.

### 2. **Tire Spin** (Tire Spin section) ⭐ NEW
The animated spinning motion applied ON TOP of the static tilt:
- **Spin Speed**: How fast it rotates (0-5)
- **Spin Axis**: Which axis it spins around (X, Y, or Z)

These are completely independent from the static tilt!

---

## Tire Spin Controls

### 🛞 Spin Speed (0 - 5.0)

Controls how fast the tire spins/rotates.

| Speed | Visual | Use Case |
|-------|--------|----------|
| **0** | ⏸️ Static - No rotation | Frozen, tilted position |
| **0.1 - 0.3** | 🐢 Very slow creep | Subtle, meditative motion |
| **0.5** | 🐢 Slow | Gentle, elegant rotation (default) |
| **1.0 - 1.5** | 🏃 Medium | Balanced, natural spin |
| **2.0 - 2.5** | 🏃 Fast | Energetic motion |
| **3.0 - 5.0** | 🚀 Very fast | Hyper-speed, dramatic |

**Speed = 0.5 is a good starting point** - feels tire-like without being jarring.

### Spin Axis Selection (X, Y, Z)

Choose which axis the tire rotates around:

#### **Y Axis** ⭐ RECOMMENDED FOR TIRES
"Classic tire rolling motion"
```
Side view:
    ⭕  (spinning around vertical axis)
   ╱ ╲
  ╱   ╲
 ╱     ╲
```
- Looks like a tire rolling forward
- Most natural appearance for a "tire" aesthetic
- Default selection

#### **Z Axis**
"Spinning toward/away from viewer"
```
Top-down view:
    ╭─╮
    ┃⭕┃  (spinning toward viewer)
    ╰─╯
```
- Rim spinning directly at camera
- Creates a "wheel hub" effect
- Most dramatic visual

#### **X Axis**
"Side rolling/wobble motion"
```
Front view:
  ╲ ⭕ ╱
   ╲ ╱  (rolling left/right)
    ╲╱
```
- Rolls side to side
- Less commonly used for tires
- Good for abstract effects

---

## Workflow: Creating the Perfect Spinning Tire

### Step 1: Set Static Position
1. Adjust **Rotation X, Y, Z** (in Rotation section)
   - X: 0.2-0.3 (slight forward tilt)
   - Y: 0.5 (classic angled view) ⭐
   - Z: 0 (no roll)
2. This creates your **fixed viewing angle**

### Step 2: Set Tire Thickness
1. Go to **Shape** section
2. Set **Tire Thickness** to 0.1-0.15
3. This creates the sleek tire profile

### Step 3: Add Spin Animation
1. Go to **Tire Spin** section
2. Select **Spin Axis**: Y (for classic tire effect)
3. Set **Spin Speed**: 0.5 (slow, graceful rotation)
4. Watch the tire spin at your chosen angle! 🎉

### Step 4: Fine-Tune Speed
- **Too fast?** Reduce to 0.2-0.3
- **Too slow?** Increase to 0.8-1.2
- **Perfect?** Lock it and export!

---

## Common Configurations

### "Elegant Floating Tire"
```
Static Tilt:
  X: 0.3
  Y: 0.5
  Z: 0

Tire Spin:
  Axis: Y
  Speed: 0.3
```
Slow, meditative rotation. Very sophisticated.

### "Dynamic Hero Tire" ⭐ RECOMMENDED
```
Static Tilt:
  X: 0.3
  Y: 0.5
  Z: 0

Tire Spin:
  Axis: Y
  Speed: 0.5
```
Balanced, looks tire-like, perfect for hero sections.

### "Fast-Spinning Wheel"
```
Static Tilt:
  X: 0.2
  Y: 0.3
  Z: 0

Tire Spin:
  Axis: Z
  Speed: 2.0
```
Rim spins directly at camera, very dynamic.

### "Gentle Wobble"
```
Static Tilt:
  X: 0.1
  Y: 0.4
  Z: 0.1

Tire Spin:
  Axis: X
  Speed: 0.4
```
Subtle side-to-side rolling. Unique aesthetic.

### "Frozen Tilted Tire"
```
Static Tilt:
  X: 0.4
  Y: 0.6
  Z: 0.2

Tire Spin:
  Axis: Y
  Speed: 0
```
No animation - just a perfectly angled static tire.

---

## Speed Reference Guide

### Speed: 0.1
- 1 full rotation every 63 seconds
- Barely perceptible motion
- Use for very subtle, premium feel

### Speed: 0.3
- 1 full rotation every 21 seconds
- Gentle, meditative
- Perfect for ambient backgrounds

### Speed: 0.5 ⭐ DEFAULT
- 1 full rotation every 12.6 seconds
- Balanced, noticeable but not distracting
- Great for hero sections

### Speed: 1.0
- 1 full rotation every 6.3 seconds
- Moderate, energetic
- Good for dynamic websites

### Speed: 2.0
- 1 full rotation every 3.1 seconds
- Fast, attention-grabbing
- Use for high-energy brands

### Speed: 5.0
- 1 full rotation every 1.3 seconds
- Ultra-fast, dizzying
- Use for special effects only

---

## Pro Tips

### Creating Realism
1. Set **Spin Speed: 0.4-0.6** for natural tire feel
2. Use **Spin Axis: Y** for classic rolling motion
3. Add slight **X Rotation: 0.2-0.3** for perspective
4. Set **Y Rotation: 0.4-0.6** for interesting viewing angle

### Making it "Pop"
1. Increase **Spin Speed: 1.5-2.0** for energy
2. Use **Z Axis** spin for rim-facing camera effect
3. Boost **Bloom Strength** to 2.2-2.5 for glow
4. Increase **Particle Size** to 0.4-0.5

### Keeping it Minimal
1. Set **Spin Speed: 0** for frozen, static look
2. Use subtle **X Rotation: 0.1** tilt
3. Set **Y Rotation: 0.3** for understated angle
4. Lower **Bloom Strength** to 1.2-1.5

### Combining with Other Animations
The **Tire Spin** is separate from:
- **Flow** (particle orbiting animation) - Keep independent!
- **Chaos** (wave distortion) - Doesn't affect spin
- **Animation Speed** (particle motion multiplier) - Doesn't affect spin

This means you can have:
- Slow tire spinning (0.3)
- Fast particle motion (Flow: 1.5, Animation Speed: 1.5)
- The two animations work together beautifully!

---

## Troubleshooting

### "The tire isn't spinning"
- Check **Spin Speed** isn't 0
- Make sure **Spin Axis** is selected (should be highlighted)
- Verify the visualization is animating (particles moving)

### "The spin looks wrong"
- Try different **Spin Axis** options
- Adjust **Static Tilt** angles to change perspective
- The combination of static tilt + spin direction matters!

### "Too slow for my brand"
- Increase **Spin Speed** to 1.0-2.0
- Consider switching to **Z Axis** for more visual impact
- Boost particle **Bloom Strength** for drama

### "I want it frozen but tilted"
- Set **Spin Speed: 0**
- Adjust **X, Y, Z rotations** to your desired angle
- Lock it!

---

## Export & Integration

Your configuration exports as `hero-config.json`:

```json
{
  "params": {
    "rotationX": 0.3,
    "rotationY": 0.5,
    "rotationZ": 0,
    "tireSpinAxis": "y",
    "tireSpinSpeed": 0.5,
    ...
  }
}
```

Use this across projects for consistent hero animations!

---

**Remember**:
- **Static Tilt** = where it's positioned
- **Tire Spin** = how it animates
- Together = perfect animated hero! 🎉

---

**Quick Start**: Set Y-axis spin to 0.5 speed and watch your tilted tire gracefully rotate. Perfect. 🛞
