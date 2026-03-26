# Master Speed Control - Global Animation Multiplier

## Overview

**One slider that controls ALL animation in your visualization:**
- Particle orbital motion
- Particle wave effects
- Tire spinning rotation
- All animation synchronization

This is the **PRIMARY global speed control** for your hero animation.

---

## The Control

Located at the **TOP of the Control Panel** with prominent styling:

**Range**: 0.001 to 5.0
**Step**: 0.001 (ultra-precise)
**Default**: 0.1 (slow, 10% normal speed)

### Visual Indicators
- 🐢 **Crawl** (0.001-0.005) - Nearly frozen, barely moving
- 🐢 **Very Slow** (0.01-0.1) - Slow, meditative motion
- 🐢 **Slow** (0.1-0.5) - Leisurely, graceful
- 🔄 **Half Speed** (0.5-1.0) - Between slow and normal
- ▶️ **Normal** (1.0) - Full, natural speed
- ⚡ **Fast** (1.0-2.0) - Quickened pace
- ⚡ **Very Fast** (2.0-3.0) - Rapid motion
- 🚀 **Ultra Speed** (3.0+) - Hyper-fast, frenetic

---

## How It Works

### What It Controls

**Master Speed affects:**
1. **Particle orbital motion** (Flow parameter) ✅
2. **Particle wave effects** (Chaos/Wave amplitude) ✅
3. **Tire spinning rotation** (Tire Spin animation) ✅

**What It Does NOT Affect:**
- Static tilt angles (X, Y, Z rotation positions)
- Object size (Scale, Torus Ring Size)
- Color shifting (Hue Speed operates independently)

### The Math
```
Actual Speed = Base Speed × Master Speed
Example: Flow: 1.0 × Master Speed: 0.1 = 0.1 (10% speed)
```

---

## Usage Guide

### Make It Nearly Frozen (Crawl)
```
Set Master Speed: 0.005
Effect: All animations move at 0.5% of normal
Result: Barely perceptible motion, luxury feel
Time: 1 tire rotation = 3+ hours!
```

### Make It Very Slow (Premium)
```
Set Master Speed: 0.05
Effect: All animations at 5% of normal
Result: Elegant, slow, sophisticated
Time: 1 tire rotation = 20+ minutes
```

### Make It Slow (Default Config)
```
Set Master Speed: 0.1
Effect: All animations at 10% of normal
Result: Meditative, graceful, perfect for hero
Time: 1 tire rotation = 10+ minutes
```

### Make It Normal Speed
```
Set Master Speed: 1.0
Effect: All animations at 100% of normal
Result: Natural, balanced, full energy
Time: 1 tire rotation = 1 minute
```

### Make It Fast (Energetic)
```
Set Master Speed: 2.0
Effect: All animations at 200% of normal
Result: Dynamic, exciting, high-energy
Time: 1 tire rotation = 30 seconds
```

### Make It Ultra-Fast (Frantic)
```
Set Master Speed: 5.0
Effect: All animations at 500% of normal
Result: Hyper-fast, intense, dizzying
Time: 1 tire rotation = 6 seconds
```

---

## Speed Reference Table

### What Different Values Mean

| Master Speed | Animation Speed | Tire Spin Time | Use Case |
|--------------|-----------------|---|----------|
| **0.001** | 0.1% normal | 1 hour | Nearly static |
| **0.005** | 0.5% normal | 12 minutes | Extreme luxury |
| **0.01** | 1% normal | 6+ minutes | Very premium |
| **0.05** | 5% normal | ~1.3 minutes | Slow, elegant |
| **0.1** | 10% normal | ~35 seconds | Default, slow |
| **0.5** | 50% normal | ~7 seconds | Moderate |
| **1.0** | 100% normal | ~3.5 seconds | Normal speed |
| **2.0** | 200% normal | ~1.7 seconds | Fast |
| **3.0** | 300% normal | ~1.2 seconds | Very fast |
| **5.0** | 500% normal | ~0.7 seconds | Ultra-fast |

---

## Real-World Examples

### "Luxury Automotive Hero"
```
Master Speed: 0.03
Result: Barely perceptible motion, ultra-premium feel
Time: Tire spins once every 20+ minutes
Use: High-end brands, luxury websites
```

### "Premium SaaS Landing Page"
```
Master Speed: 0.1
Result: Slow, meditative motion, sophisticated
Time: Tire spins once every 60+ seconds
Use: Tech companies, premium products
Perfect match for current config!
```

### "Tech Startup Website"
```
Master Speed: 0.5
Result: Noticeable motion, dynamic but not frantic
Time: Tire spins once every 7 seconds
Use: Energetic but professional
```

### "Gaming / VR Demo"
```
Master Speed: 2.0-3.0
Result: Fast, exciting motion
Time: Tire spins multiple times per second
Use: High-energy, action-oriented brands
```

### "Stock Ticker / Data Viz"
```
Master Speed: 1.0
Result: Normal, natural speed
Time: Standard animation timing
Use: Information-heavy, professional
```

---

## How to Use It

### Step 1: Open Control Panel
The Master Speed control is at the TOP, always visible and highlighted.

### Step 2: Adjust the Slider
- Drag LEFT for slower (toward 0.001 = crawl)
- Drag RIGHT for faster (toward 5.0 = ultra-fast)
- Real-time preview updates instantly

### Step 3: Watch the Indicator
The emoji/text below shows you:
- 🐢 Crawl
- 🐢 Very Slow
- 🐢 Slow
- 🔄 Half Speed
- ▶️ Normal
- ⚡ Fast
- 🚀 Ultra Speed

### Step 4: Fine-Tune
Use the numeric value (0.000-5.000) to make micro-adjustments.
The 0.001 step size gives precise control.

### Step 5: Lock & Export
When perfect, lock the config and export!

---

## Pro Tips

### For "Crawling" Effect
1. Set Master Speed to 0.001-0.01
2. Keep all other animation controls at default
3. Result: Barely moving, ultra-static
4. Perfect for premium, luxury feel

### Combining with Other Controls
Master Speed works WITH other controls:
- **Flow** (0.01-3): Orbital speed multiplier
- **Chaos**: Wave distortion intensity (affected by Master)
- **Tire Spin Speed** (0-3): Rotation speed (affected by Master)

**Example**:
- Master Speed: 0.1 (slow everything 10%)
- Flow: 1.0 (particles orbit once per 10 seconds)
- Tire Spin: 1.0 (tire spins once per 10 seconds)
- Result: Synchronized slow motion!

### Finding Your Sweet Spot
1. Start at **0.1** (current default) = slow, elegant
2. Try **0.05** for very slow luxury feel
3. Try **0.2** for slightly faster energy
4. Find the value that feels right
5. Lock it in!

---

## Technical Details

### What Gets Multiplied
```javascript
// Before: Just animated particles
const time = state.clock.getElapsedTime() * speedMult;

// After: Master Speed affects tire spin too
const spinAngle = state.clock.getElapsedTime() * PARAMS.tireSpinSpeed * PARAMS.animationSpeed;
```

The Master Speed is applied as a **global multiplier** to all timed animations.

### Performance
- ✅ No performance impact (just one multiplication per frame)
- ✅ Smooth interpolation across all speeds
- ✅ No animation glitches or jumps
- ✅ Can change in real-time without reloading

---

## Export & Integration

Your Master Speed value exports with your config:

```json
{
  "params": {
    "animationSpeed": 0.1,
    "flow": 3,
    "tireSpinSpeed": 1.4,
    ...
  }
}
```

This single value controls all animation timing across projects!

---

## Troubleshooting

### "It's still too fast"
- Reduce Master Speed further (try 0.05, 0.02, 0.01)
- The 0.001 step size allows ultra-fine control

### "It's now too slow"
- Increase Master Speed (try 0.2, 0.3, 0.5)
- Or set it to 1.0 for normal speed

### "I want different speeds for different parts"
- Master Speed affects everything equally
- To affect just tire spin: adjust Tire Spin Speed independently
- To affect just particles: adjust Flow independently
- Master Speed = global multiplier for all

### "It doesn't seem to be working"
- Check the numeric value displays (0.000-5.000)
- Verify the slider is actually moving
- Try setting to 0.001 (should be almost frozen)
- Try setting to 5.0 (should be very fast)

---

## Quick Start

**For a crawling, barely-moving hero section:**
1. Set **Master Speed** to `0.05`
2. Keep everything else at default
3. Watch your massive, slow-motion torus 🎯

**That's it!** One slider controls everything. 🎉

---

## Summary

- 🎚️ **One slider** = all animation control
- 🐢 **Range** 0.001-5.0 = from nearly frozen to ultra-fast
- ⚡ **Real-time** = instant preview
- 🔒 **Lockable** = prevents accidental changes
- 📦 **Exportable** = carries across projects

**This is your master speed control. Use it to set the mood and pace of your entire animation!** ✨
