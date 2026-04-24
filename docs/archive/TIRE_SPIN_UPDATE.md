# Tire Spin Animation Update

## What Changed

### New Independent Tire Spinning Control 🛞

The torus now has **two separate rotation systems**:

1. **Static Tilt** (Rotation section)
   - X, Y, Z angles that set the fixed position
   - These don't change over time
   - Control the viewing perspective

2. **Animated Tire Spin** (Tire Spin section) ⭐ NEW
   - Independent rotation animation applied on top
   - **Spin Speed**: 0-5 (0 = frozen, 0.5 = moderate, 5 = ultra-fast)
   - **Spin Axis**: X, Y, or Z (which direction it spins)
   - Completely decoupled from static tilt

### Key Advantage
You can now:
- ✅ Tilt the torus at any angle (static)
- ✅ Make it spin like a tire at any speed (animated)
- ✅ Set spin speed to 0 for frozen, tilted look
- ✅ Control which axis it spins around
- ✅ All in real-time with instant preview

---

## New Controls

### In Control Panel → Tire Spin Section

#### Spin Speed Slider (0.0 - 5.0)
- **0**: ⏸️ Completely frozen (static)
- **0.3**: 🐢 Slow, meditative rotation
- **0.5**: 🐢 Default - slow, graceful spin (RECOMMENDED)
- **1.0**: 🏃 Medium speed
- **2.0**: 🏃 Fast spin
- **5.0**: 🚀 Ultra-fast, frantic

Visual indicators show your speed category!

#### Spin Axis Buttons (X, Y, Z)
Choose which direction the tire rotates:
- **X**: Side rolling/wobble (less common)
- **Y**: Classic tire roll - spins around vertical axis ⭐ RECOMMENDED
- **Z**: Rim facing camera - spins directly at viewer (dramatic)

Quick help text describes each axis below the buttons.

---

## How It Works

### Before (Static Only)
```
groupRef.current.rotation.x = PARAMS.rotationX;    // Fixed angle
groupRef.current.rotation.y = PARAMS.rotationY;    // Fixed angle
groupRef.current.rotation.z = PARAMS.rotationZ;    // Fixed angle
```

### After (Static + Animated Spin)
```
const spinAngle = time * PARAMS.tireSpinSpeed;

let rotX = PARAMS.rotationX;
let rotY = PARAMS.rotationY;
let rotZ = PARAMS.rotationZ;

// Add animated spin to selected axis
if (PARAMS.tireSpinAxis === 'y') {
  rotY += spinAngle;  // Spins over time
}

groupRef.current.rotation.x = rotX;
groupRef.current.rotation.y = rotY;
groupRef.current.rotation.z = rotZ;
```

The spin angle accumulates over time, creating smooth rotation!

---

## Recommended Starting Point

```
Rotation (Static Tilt):
  X: 0.3  (slight forward lean)
  Y: 0.5  (angled view)
  Z: 0    (no side roll)

Tire Spin:
  Axis: Y      (classic tire motion)
  Speed: 0.5   (gentle rotation)
```

This creates a beautifully angled, slowly spinning tire. Perfect for hero sections! 🎯

---

## Files Modified

### ox.jsx
- Added `tireSpinAxis` parameter (string: 'x', 'y', or 'z')
- Added `tireSpinSpeed` parameter (number: 0-5)
- Updated useFrame to:
  - Calculate animated spin angle from elapsed time
  - Apply spin to selected axis on top of static rotation

### HomePage.jsx
- Added default `tireSpinAxis: 'y'`
- Added default `tireSpinSpeed: 0.5`

### ControlPanel.jsx
- Updated rotation labels to say "Static Tilt"
- Added new **Tire Spin** section with:
  - Spin Speed slider with emoji indicators
  - Axis selection buttons (X, Y, Z)
  - Help text describing each axis
  - Visual feedback showing current selection

---

## Usage Examples

### Scenario 1: "Static, Tilted Tire"
```
Spin Speed: 0
Result: Frozen tire at perfect angle, no animation
Use: When you want just the geometry, no movement
```

### Scenario 2: "Elegant Floating Tire"
```
Spin Speed: 0.3
Spin Axis: Y
Result: Slow, graceful rotation around vertical axis
Use: Premium, sophisticated hero sections
```

### Scenario 3: "Dynamic Hero Header"
```
Spin Speed: 0.5
Spin Axis: Y
Result: Moderate tire rolling - natural looking
Use: Most websites, balanced feel
```

### Scenario 4: "Fast Energetic Wheel"
```
Spin Speed: 2.0
Spin Axis: Z
Result: Rim spinning directly at viewer - dynamic
Use: High-energy brands, startups
```

---

## Export Behavior

Your configuration now includes:
```json
{
  "params": {
    "rotationX": 0.3,
    "rotationY": 0.5,
    "rotationZ": 0,
    "tireSpinAxis": "y",
    "tireSpinSpeed": 0.5,
    ...
  },
  "headline": "IN THE LOOP",
  "subheading": "Human Controlled AI Systems",
  ...
}
```

Load this same config in any project to get identical animation behavior! 📦

---

## Performance Notes

- ✅ Spin calculation is just one multiplication per frame
- ✅ Zero performance impact (uses existing animation loop)
- ✅ Smooth interpolation built-in
- ✅ No additional geometry or particles needed

---

## Next Steps

1. **Test the tire spin**: Try setting Speed to 0.5 and Axis to Y
2. **Adjust speed**: Find the right pace for your brand
3. **Change axes**: Experiment with X and Z for different effects
4. **Lock it**: When you love it, lock and export
5. **Use it**: Load the config on your website

---

## Full Documentation

See **TIRE_SPIN_GUIDE.md** for:
- Detailed speed reference (how many rotations per second)
- All recommended presets
- Axis visualization diagrams
- Troubleshooting guide
- Advanced combinations

---

**You now have complete control over tire animation!** 🛞

Set it to 0 for frozen, 0.5 for elegant, or 2.0 for fast. All in real-time. Perfect! ✨
