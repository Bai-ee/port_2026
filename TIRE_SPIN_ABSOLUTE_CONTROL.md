# Tire Spin - Absolute Independent Control

## Overview

**Tire Spin Speed is now 100% independent** - completely separate from Master Speed.

You now have **two independent speed controls**:
1. **Master Speed** (0.001-5.0): Controls particle motion only
2. **Tire Spin Speed** (0.001-5.0): Controls tire rotation only

---

## Tire Spin Speed Control

Located in **Tire Spin section** of Control Panel.

**Range**: 0.001 to 5.0
**Step**: 0.001 (ultra-precise)
**Default**: 1.4 (visible, moderate spin)
**Status**: INDEPENDENT from Master Speed

### What It Controls
- ✅ Tire/torus rotation around its axis
- ✅ Only the spinning motion (not particles)
- ✅ Completely independent of Master Speed
- ✅ Complete granular control from frozen to ultra-fast

### Speed Categories

| Speed | Status | Time per Rotation | Use Case |
|-------|--------|---|----------|
| **0** | ⏸️ Static | ∞ (Frozen) | Completely frozen tire |
| **0.001-0.005** | 🐢 Crawl | 6+ hours | Nearly imperceptible |
| **0.01-0.05** | 🐢 Very Slow | 20-120 minutes | Barely moving |
| **0.1-0.3** | 🐢 Slow | 2-10 minutes | Subtle, elegant |
| **0.5-0.9** | 🏃 Moderate | 7-12 seconds | Visible motion |
| **1.0-1.4** | 🏃 Moderate-Fast | 4-6 seconds | Balanced (default: 1.4) |
| **1.5-2.5** | ⚡ Fast | 2.5-4 seconds | Energetic |
| **3.0-5.0** | 🚀 Ultra | <2 seconds | Hyper-fast |

---

## Real Examples

### "Frozen Tire at Perfect Angle"
```
Tire Spin Speed: 0
Master Speed: 0.1
Result: Tire doesn't spin, particles move slowly
Use: Static hero with subtle ambient motion
```

### "Barely Rotating Tire"
```
Tire Spin Speed: 0.01
Master Speed: 0.1
Result: Tire rotates imperceptibly, particles move slowly
Time: One rotation every 6+ minutes
Use: Luxury, premium hero sections
```

### "Elegant Slow Spin" ⭐ RECOMMENDED
```
Tire Spin Speed: 0.2
Master Speed: 0.1
Result: Tire spins noticeably but slowly
Time: One rotation every ~30 seconds
Use: Professional, balanced hero
```

### "Tire Spinning at Normal Speed"
```
Tire Spin Speed: 1.0
Master Speed: 0.1
Result: Tire spins at normal rate despite slow particles
Time: One rotation every 6 seconds
Use: Mixed pace (slow particles, visible tire)
```

### "Fast Spinning Tire (Default Config)"
```
Tire Spin Speed: 1.4
Master Speed: 0.1
Result: Visible, energetic tire spin (current default)
Time: One rotation every 4.5 seconds
Use: Dynamic, engaging hero
```

### "Ultra-Fast Dramatic Spin"
```
Tire Spin Speed: 3.0
Master Speed: 0.1
Result: Tire spins very fast while particles move slowly
Time: One rotation every 2 seconds
Use: High-energy, dramatic focus
```

---

## Two Independent Controllers

### Master Speed (Particles/Waves)
- Controls particle orbital motion
- Controls wave distortions
- Range: 0.001-5.0
- Location: Top of Control Panel
- Visual: Bright accent styling

### Tire Spin Speed (Rotation Only)
- Controls tire rotation only
- Independent from particles
- Range: 0.001-5.0
- Location: Tire Spin section
- Visual: Bordered accent box

**They work together but independently!**

---

## How to Create Specific Effects

### "Giant Stationary Tire"
```
1. Tire Spin Speed: 0
2. Master Speed: 0.1
3. Static Tilt: (your angle)
Result: Tire is perfectly tilted but never rotates
```

### "Slow-Motion Rotating Tire"
```
1. Tire Spin Speed: 0.05 (barely rotating)
2. Master Speed: 0.05 (slow particles)
3. Scale: 150 (large)
Result: Everything moving in slow-motion
```

### "Mixed Speeds - Slow Particles, Fast Tire"
```
1. Tire Spin Speed: 2.0 (fast tire)
2. Master Speed: 0.1 (slow particles)
Result: Tire spins quickly while particles orbit slowly
Use: Dynamic contrast, attention-grabbing
```

### "Everything Very Slow"
```
1. Tire Spin Speed: 0.05 (slow rotation)
2. Master Speed: 0.05 (slow particles)
Result: Synchronized slow motion
Time: Everything moves at 5% normal speed
```

### "Everything Very Fast"
```
1. Tire Spin Speed: 4.0 (fast rotation)
2. Master Speed: 3.0 (fast particles)
Result: Synchronized hyper-speed
Time: Everything at 300%+ normal speed
```

---

## Precision Control

The **0.001 step size** means you can make micro-adjustments:
- 1.4 → 1.401 = minimal change
- 0.1 → 0.101 = minimal change

This gives you **absolute granular control** over the exact rotation speed.

---

## Speed Calculation

For tire rotation timing:

```
Time per rotation = 2π / (tire spin speed)

0.001: 6,283 seconds (104 minutes)
0.01: 628 seconds (10.5 minutes)
0.1: 63 seconds (1 minute)
0.5: 12.6 seconds
1.0: 6.3 seconds
1.4: 4.5 seconds (current default)
2.0: 3.1 seconds
3.0: 2.1 seconds
5.0: 1.26 seconds
```

---

## Workflow: Perfect Tire Animation

### Step 1: Set Tire Spin Speed
1. Go to **Tire Spin section**
2. Drag the slider to find your perfect rotation speed
3. Watch the emoji indicator update in real-time

### Step 2: Set Master Speed
1. Go to **Master Speed control** (top of panel)
2. Adjust particle speed independently
3. Tire rotation unaffected

### Step 3: Combine with Shape/Rotation
1. **Shape section**: Set size (Torus Ring Size, Scale)
2. **Rotation section**: Set static tilt angles
3. Everything works together!

### Step 4: Lock & Export
1. Click **🔒 Lock** when perfect
2. Click **⬇️ Export** to save config
3. Config includes both speed values

---

## Practical Tips

### Finding Your Speed
- Start at **1.4** (current default) for visible rotation
- Try **0.5** for slower, more elegant motion
- Try **0.1** for very slow, meditative feel
- Try **2.0-3.0** for fast, energetic effect

### With Different Scales
- **Large tire** (Scale 150+): Use slower speeds (0.5-1.0) so it doesn't seem frantic
- **Small tire** (Scale 60): Can handle faster speeds (1.5-2.5) without feeling chaotic

### Matching Brand Energy
- **Luxury brands**: 0.05-0.3 (barely moving)
- **Premium/Professional**: 0.5-1.0 (moderate, balanced)
- **Tech/Startup**: 1.0-2.0 (visible, energetic)
- **Gaming/VR**: 2.0-5.0 (fast, dynamic)

---

## Export & Integration

Your config exports both speeds independently:

```json
{
  "params": {
    "animationSpeed": 0.1,
    "tireSpinSpeed": 1.4,
    ...
  }
}
```

Change either value independently on any project! 📦

---

## FAQ

### "Can I have the tire spin fast while particles are slow?"
✅ **Yes!** That's the whole point of independent control.
```
Tire Spin: 2.0 (fast)
Master Speed: 0.1 (slow)
Result: Tire spins quickly, particles orbit slowly
```

### "Can I freeze the tire while keeping particle animation?"
✅ **Yes!** Set tire spin to 0, master speed to anything.
```
Tire Spin: 0 (static)
Master Speed: 1.0 (normal particles)
Result: Tire never rotates, particles animate normally
```

### "What's the difference between 0.001 and 0.005?"
The 0.001 step size means you can make 4x finer adjustments than before.
- 0.001 vs 0.005 = barely noticeable difference in rotation speed
- Perfect for finding your "sweet spot"

### "Does Master Speed affect tire spin anymore?"
✅ **No!** Tire spin is now completely independent.
- Master Speed = particles only
- Tire Spin Speed = rotation only
- They don't affect each other!

### "Why would I use 0.001?"
For luxury/premium hero sections where you want the tire spinning so slowly it's almost imperceptible - barely noticeable but still there.

---

## Summary

- 🛞 **Tire Spin Speed**: Controls rotation (0.001-5.0)
- ⚡ **Master Speed**: Controls particles (0.001-5.0)
- 🔓 **Independent**: They don't affect each other
- 🎯 **Absolute Control**: Set exactly what you need
- 📏 **Ultra-Precise**: 0.001 step size
- 📦 **Exportable**: Both values in config

**Use Tire Spin Speed to control tire rotation exactly how you want it!** ✨
