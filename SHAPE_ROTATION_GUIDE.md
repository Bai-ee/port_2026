# Shape & Rotation Controls Guide

Advanced controls for crafting the perfect 3D torus visualization with dynamic rotation and animation.

## 🍩 Shape Section

### Torus Ring Size (0.5 - 2.0)
Controls the major radius of the torus (the overall size of the donut ring).
- **Lower values** (0.5-0.8): Smaller, tighter rings
- **Mid values** (1.0): Default balanced size
- **Higher values** (1.5-2.0): Larger, more expansive rings

### Tire Thickness (0.05 - 0.8)
**This is the key control for making a thin, tire-like appearance!**

Controls the tube radius (the width of the donut's cross-section).
- **0.05 - 0.15** ⭐ THIN & TIRE-LIKE - Recommended for sleek, elegant look
- **0.2 - 0.4**: Medium thickness - Default balance
- **0.5 - 0.8**: Thick, chunky - Heavy, substantial appearance

**Pro Tip**: Combine thin tube radius (0.1) with larger major radius (1.5) for an ultra-sleek racing tire effect.

## 🔄 Rotation Section

### Rotate X Axis (-π to π)
Rotation around the horizontal X axis (left-right line).
- **Negative values** (-π to -1.5): Tilts away from viewer at top
- **0**: Straight, no X rotation
- **Positive values** (0.3 to 1.5): Tilts toward viewer at top

**Visual Effect**: Makes the torus tilt forward/backward.

### Rotate Y Axis (-π to π)
Rotation around the vertical Y axis (up-down line).
- **Negative values**: Rotates counter-clockwise when viewed from above
- **0**: No Y rotation
- **Positive values** (0.5 to 2.0): Rotates clockwise when viewed from above

**Visual Effect**: Makes the torus spin left/right; changes which side faces camera.

### Rotate Z Axis (-π to π)
Rotation around the depth Z axis (viewer forward/backward).
- **Negative values**: Counter-clockwise roll
- **0**: No Z rotation
- **Positive values**: Clockwise roll

**Visual Effect**: Tilts/rolls the entire torus side to side.

## 🎬 Animation Section

### Flow / Rotation Speed (0.1 - 3.0)
Controls how fast the particle swarm orbits around the torus.
- **0.1 - 0.3**: Slow, meditative, cinematic
- **0.6 - 0.9**: Default, balanced pace
- **1.5 - 3.0**: Fast, energetic, dynamic

### Chaos / Wave Amplitude (0 - 2.0)
Controls how much the particles deviate from the perfect torus shape with wave distortions.
- **0 - 0.3**: Crisp, clean torus shape
- **0.8 - 1.2**: Default with subtle waves
- **1.5 - 2.0**: Dramatic, flowing, organic distortions

### Scale / Expansion (25 - 90)
Controls the overall spread/size of the particle cloud.
- **25 - 40**: Compact, concentrated
- **55** ⭐: Default, balanced
- **70 - 90**: Expansive, fills the screen

### Wave Amplitude Multiplier (0.5 - 10.0)
Controls the intensity of wave effects overlaid on the particle motion.
- **0.5 - 1.0**: Subtle undulation
- **3 - 5**: Noticeable waves
- **7 - 10**: Extreme, dramatic flowing motion

### Overall Animation Speed (0.1 - 2.0)
Master multiplier for all animation speeds.
- **0.1 - 0.5**: Slow-motion, surreal
- **1.0** ⭐: Default speed
- **1.5 - 2.0**: Double speed, frantic energy

## 🎨 Colors Section

### Color Shift Speed (0 - 0.1)
How fast the colors cycle and shift hues.
- **0**: Static colors, no shift
- **0.02** ⭐: Default subtle shift
- **0.05 - 0.1**: Rapid color cycling

### Color Saturation (0 - 1.0)
How vivid/muted the colors are.
- **0**: Grayscale, black and white
- **0.5**: Pastel, desaturated
- **0.85** ⭐: Default vibrant
- **1.0**: Maximum saturation, most vivid

### Color Lightness (0 - 1.0)
How bright/dark the colors are.
- **0**: Pure black
- **0.5**: Medium gray tone
- **0.5 - 0.7** ⭐: Default bright but not blown out
- **1.0**: Pure white, blown out

## ✨ Effects Section

### Bloom Threshold (0 - 1.0)
Minimum brightness level for bloom/glow effect to apply.
- **0** ⭐: All brightness levels glow
- **0.3 - 0.5**: Only bright areas glow
- **0.8 - 1.0**: Only the brightest particles glow

### Bloom Strength (0 - 3.0)
Intensity of the glow/bloom effect.
- **0**: No glow
- **0.5 - 1.0**: Subtle glow
- **1.8** ⭐: Default, cinematic glow
- **2.5 - 3.0**: Intense, ethereal glow

### Bloom Radius (0 - 1.0)
How far the glow spreads from bright areas.
- **0**: Sharp, no spread
- **0.2 - 0.4** ⭐: Default, natural bloom
- **0.7 - 1.0**: Wide, dreamy glow

### Particle Size (0.1 - 1.0)
Size of individual particle spheres.
- **0.1 - 0.2**: Tiny, detailed points
- **0.3** ⭐: Default, balanced
- **0.6 - 1.0**: Large, dramatic particles

## 📋 Recommended Presets

### "Racing Tire" - Fast & Sleek
```
torusTubeRadius: 0.1
scale: 65
chaos: 0.6
flow: 1.5
rotationX: 0.2
rotationY: 0.3
bloomStrength: 2.2
particleSize: 0.25
```

### "Cosmic Portal" - Meditative & Ethereal
```
torusTubeRadius: 0.25
scale: 75
chaos: 1.2
flow: 0.4
rotationX: 0.5
rotationY: 0.7
bloomStrength: 2.5
bloomRadius: 0.7
saturation: 0.9
```

### "Data Stream" - Technical & Sharp
```
torusTubeRadius: 0.12
scale: 50
chaos: 0.3
flow: 2.0
rotationX: 0.1
rotationY: 1.0
bloomStrength: 1.2
bloomRadius: 0.2
particleSize: 0.2
```

### "Organic Flow" - Smooth & Natural
```
torusTubeRadius: 0.35
scale: 60
chaos: 1.5
flow: 0.6
rotationX: 0.4
rotationY: 0.5
waveAmplitude: 5
bloomStrength: 1.8
saturation: 0.75
```

## 💡 Pro Tips

### Getting the Tire Effect
1. Set `torusTubeRadius` between **0.08-0.15**
2. Keep `torusMajorRadius` at **1.0-1.3**
3. Add slight rotations (X: 0.1-0.3, Y: 0.2-0.6) for dynamic angle
4. Reduce `particleSize` to 0.2-0.25 for cleaner detail

### Adding Drama & Movement
1. Increase `animationSpeed` to 1.3-1.8
2. Boost `chaos` to 1.0-1.5 for wave motion
3. Raise `bloomStrength` to 2.0-2.5
4. Increase `waveAmplitude` to 4-6

### Optimizing Performance
1. Reduce `particleCount` if animation is laggy
2. Lower `bloom.strength` and `bloom.radius`
3. Reduce animation speeds
4. Use simpler torus geometry (lower count values)

### Color Harmony with 30/60/10 System
- The accent color (10%) reflects in the particle colors
- Adjust `saturation` to match color intensity needs
- Use `hueSpeed` to create dynamic color shifts that stay harmonious
- Higher `lightness` works better on dark dominant colors

## 🎯 Next Steps

1. **Adjust tube radius** to achieve your desired tire thickness
2. **Set rotations** to position the torus perfectly for your composition
3. **Tweak animation** to match the mood and energy
4. **Fine-tune colors** and bloom for the final cinematic touch
5. **🔒 Lock** your configuration when happy with the result

---

**Remember**: The torus rotation is applied after the particle positioning, so experiment with combining shape + rotation for unique perspectives. The 30/60/10 color system accent color will influence particle hue cycling.
