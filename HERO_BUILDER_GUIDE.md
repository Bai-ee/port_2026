# Hero Section Builder - Interactive 3D Header Creator

A professional-grade React + Three.js interface for designing animated hero headers with dynamic color systems and real-time parameter controls.

## Quick Start

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` to launch the interactive builder.

## Features

### 📝 **Headline System**
Default headline displays **"IN THE LOOP"** with subheading **"Human Controlled AI Systems"**
- Full customization of main headline and subheading text
- Adjustable font sizes independently
- Positioning (top/center/bottom), alignment (left/center/right)
- Glow effect for dramatic presentation
- Smart contrast that adapts to background color

### 🍩 **Shape & Geometry Controls**
Transform the torus into a sleek, tire-like form:
- **Tire Thickness**: Create thin, elegant rings (0.05-0.8 range) ⭐ **Key for tire effect**
- **Ring Size**: Adjust major radius for compact or expansive appearance
- Full parametric control over torus geometry

### 🔄 **3D Rotation Controls**
Position the torus perfectly with XYZ axis rotation:
- **X Axis**: Tilt forward/backward
- **Y Axis**: Rotate left/right (primary viewing angle)
- **Z Axis**: Roll/spin the torus
- All ranges from -π to π for complete 360° control

### 🎨 **30/60/10 Color System**
Implements the professional color theory rule:
- **30%** - Dominant: Main background color
- **60%** - Secondary: Supporting/content color
- **10%** - Accent: Highlights and interactive elements

### 📊 **Real-Time Parameter Controls**
Organized into 5 collapsible sections with live feedback:

#### 🎬 **Animation Section**
- **Flow / Rotation Speed**: How fast particles orbit (0.1-3.0)
- **Chaos / Wave Amplitude**: Wave distortion intensity (0-2.0)
- **Scale / Expansion**: Particle cloud spread (25-90)
- **Wave Amplitude Multiplier**: Wave effect intensity (0.5-10.0)
- **Overall Animation Speed**: Master speed multiplier (0.1-2.0)

#### 🍩 **Shape Section**
- **Torus Ring Size**: Major radius for overall donut size (0.5-2.0)
- **Tire Thickness**: Tube radius for sleek tire-like appearance (0.05-0.8) ⭐

#### 🔄 **Rotation Section**
- **Rotate X Axis**: Forward/backward tilt (-π to π)
- **Rotate Y Axis**: Left/right spin (-π to π)
- **Rotate Z Axis**: Roll rotation (-π to π)

#### 🎨 **Colors Section**
- **Color Shift Speed**: Hue cycling speed (0-0.1)
- **Saturation**: Color vividness (0-1.0)
- **Lightness**: Brightness level (0-1.0)

#### ✨ **Effects Section**
- **Bloom Threshold**: Glow trigger brightness (0-1.0)
- **Bloom Strength**: Glow intensity (0-3.0)
- **Bloom Radius**: Glow spread (0-1.0)
- **Particle Size**: Individual sphere size (0.1-1.0)

### 📝 **Headline Overlay**
- Edit headline text in real-time (up to 60 characters)
- **Positioning**: Top, center, or bottom
- **Alignment**: Left, center, or right
- **Font Size**: 24px to 120px
- **Opacity**: Full transparency control
- **Glow Effect**: Adds cinematic shadow and accent glow
- **Smart Contrast**: Text color automatically adjusts based on background

### 🎭 **6 Preset Color Palettes**
Ready-to-use professional palettes:
1. **Deep Ocean** - Blue/teal gradient with cyan accent
2. **Midnight Gold** - Dark with golden highlights
3. **Dark Aurora** - Cool tones with emerald accent
4. **Cyberpunk** - High contrast magenta and dark blue
5. **Sunset** - Purple base with amber accent
6. **Forest** - Deep green with mint highlights

### 🔒 **Lock Feature**
Prevent accidental changes while presenting or refining:
- Click "🔒 Locked" to prevent all edits
- Greyed out controls indicate locked state

### ⬇️ **Export Configuration**
Save your perfect setup as `hero-config.json`:
```json
{
  "params": {
    "scale": 55,
    "chaos": 0.8,
    "flow": 0.6,
    ...
  },
  "colorPalette": {
    "dominant": "#0a0e27",
    "secondary": "#1e3a8a",
    "accent": "#60a5fa"
  },
  "headlineText": "Your Headline"
}
```

## UI Layout

```
┌─────────────────────────────────────┐
│ Hide Controls | Lock | Export       │  (Top Right)
├─────────────────────────────────────┤
│                                     │
│     📝 Headline               🎨    │
│                               Color │
│                               System│
│  3D Particle Visualization          │
│                                     │
│  (4D Hyper-Torus with Bloom)       │
│                                     │
│                                     │
│                                     │
├─────────────────────────────────────┤
│ ⚙️ Visualization Controls            │  (Bottom Left)
│ (Scale, Chaos, Flow, Bloom, etc.)  │
└─────────────────────────────────────┘
```

## Workflow

### Step 1: Choose Base Aesthetic
Select a preset color palette that matches your brand identity.

### Step 2: Fine-Tune Colors
Use the **Custom Colors** section to adjust:
- Dominant (background)
- Secondary (overlay/depth)
- Accent (interactive highlights)

### Step 3: Customize Visualization
Adjust the 3D particle swarm:
- **Scale**: How spread out the particles are
- **Chaos**: Wave-like distortions in the motion
- **Flow**: Speed and direction of rotation
- **Bloom**: Glow intensity for cinematic feel

### Step 4: Add Headline
- Click the headline text to edit
- Position it (top/center/bottom)
- Adjust font size for hierarchy
- Enable glow for dramatic effect

### Step 5: Lock & Export
- Click **🔒 Locked** to prevent edits
- Click **⬇️ Export** to save `hero-config.json`

## Integration with Website

Load the exported configuration:

```jsx
// In your website's header component
import heroConfig from './hero-config.json';
import HomePage from './HomePage';

export function HeroSection() {
  return (
    <HomePage
      initialParams={heroConfig.params}
      initialColorPalette={heroConfig.colorPalette}
      headlineText={heroConfig.headlineText}
    />
  );
}
```

## Technical Details

### Architecture
- **HomePage.jsx** - Main container & state management
- **ox.jsx** - 3D visualization engine (React Three Fiber)
- **ControlPanel.jsx** - Parameter sliders
- **ColorPalette.jsx** - 30/60/10 color system
- **TextOverlay.jsx** - Headline text with smart contrast

### 3D Visualization
- **Engine**: Three.js with React Three Fiber
- **Effect**: Clifford torus (4D hyper-torus projected to 3D)
- **Particles**: 25,000 instanced meshes for performance
- **Shaders**: Custom vertex/fragment shaders for metallic effect
- **Bloom**: Unreal Bloom post-processing for glow

### Color Theory
The 30/60/10 rule ensures visual balance:
- Large dominant areas create mood
- Secondary colors support the dominant
- Small accent pops guide user attention

## Tips & Tricks

### Best Practices
- Keep accent color brightness 20-30% different from secondary
- Use opposite colors on the color wheel for punch
- Test contrast ratios for accessibility
- Lock when happy with a configuration

### Performance
- Reduce particle count on slower devices
- Lower bloom strength to improve performance
- Disable glow if unnecessary

### Accessibility
- Use high contrast between text and background
- Test headline readability with vision simulator
- Provide text alternative if headline is purely decorative

## Keyboard Shortcuts
- **Ctrl/Cmd + S** → Export configuration (when implemented)
- **L** → Toggle lock (when implemented)
- **H** → Hide/show controls (when implemented)

## Troubleshooting

**Visualization not animating?**
- Check browser console for WebGL errors
- Ensure hardware acceleration is enabled
- Try a different browser

**Colors not matching between preview and export?**
- Verify hex color values in custom color inputs
- Color management may vary by screen/OS

**Performance issues?**
- Reduce particleCount (currently 25,000)
- Lower bloomStrength or bloomRadius
- Close other browser tabs

## Future Enhancements
- [ ] Animated camera paths
- [ ] Multiple text layers
- [ ] Video background option
- [ ] SVG shape overlays
- [ ] Preset animations library
- [ ] Brand kit integration

---

**Built for creative technologists. Optimized for hero sections. Designed for impact.**
