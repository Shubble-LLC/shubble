# MapLibre Components

This directory contains the map implementation, built on MapLibre GL JS with
free OpenFreeMap tiles (no API key required). It replaced an earlier Apple
MapKit JS implementation while preserving the same three-component split for
maintainability and separation of concerns.

## Components

### MapCanvas.tsx
**Purpose**: Base map initialization and rendering

**Responsibilities**:
- Creates and configures the MapLibre map instance (style, zoom/pan limits, center)
- Renders route polylines and stop circles as a GeoJSON source + layer each
- Handles map interactions (stop hover via feature-state, stop click, desktop-only
  schedule sync)
- Hides POI labels from the base style, mirroring the previous MapKit behavior

**Props**:
- `routeData`: Route and stop data to display
- `selectedRoute`: Currently selected route (unused internally, passed through for parity with sibling components)
- `setSelectedRoute`: Callback to update selected route
- `isFullscreen`: Whether to render in fullscreen mode
- `onMapReady`: Callback when map is initialized

### MapAnimation.tsx
**Purpose**: Vehicle animation along polylines

**Responsibilities**:
- Manages animation state for each vehicle (position, speed, direction)
- Implements prediction smoothing algorithm to avoid rubberbanding
- Runs animation loop using requestAnimationFrame
- Projects vehicles onto route polylines
- Moves MapLibre `Marker` instances via `setLngLat()` for smooth animation

**Props**:
- `annotations`: Current vehicle annotation data (including route/speed/heading)
- `vehicleAnnotations`: Record (keyed object) of `maplibregl.Marker` instances to animate
- `showTrueLocation`: Whether to disable animation and show raw GPS

**Relationship with MapOverlays**:
This component receives `maplibregl.Marker` objects that are created and managed by
MapOverlays. The animation loop directly calls `marker.setLngLat()` — since MapOverlays
tracks markers by key and reuses the same `Marker` instance across renders, these
position updates don't trigger a remove/add cycle, only the visual position changes.

**Algorithm**:
The animation uses a prediction smoothing algorithm that:
1. Calculates where the vehicle will be in 5 seconds based on current speed
2. Smoothly animates from current visual position to predicted position
3. Snaps to the server-reported position when the vehicle moves onto a new route segment

### MapOverlays.tsx
**Purpose**: Manages adding/removing shuttle markers on the map

**Responsibilities**:
- Accepts a list of `KeyedAnnotation` objects (stated props)
- Creates MapLibre `Marker` instances (DOM-element based) internally
- Efficiently adds new markers by comparing keys
- Updates existing markers in place (position, popup content, icon) without recreating them
- Removes markers whose keys are no longer present
- Exposes created markers via callback for animation
- Cleans up on unmount

**Props**:
- `map`: MapLibre map instance
- `overlays`: List of `KeyedAnnotation` to render
- `onAnnotationsReady`: Optional callback that receives created `Marker` objects

**Stated props approach**:
This component uses stated props — annotation properties are passed as a list keyed by
vehicle ID. The component:
1. Compares keys between renders to determine what to add/remove
2. Creates new `Marker` objects for new keys
3. Updates existing marker properties in place for existing keys
4. Never recreates `Marker` objects unless the key is removed and re-added

This prevents unnecessary remove/add operations and allows MapAnimation to safely
move markers every frame.

## Architecture: Stated Props Flow

```
LiveLocationMap
  ↓ computes
vehicleAnnotationProps: AnimatedAnnotation[]
  ↓ passed to
MapOverlays
  ↓ creates/manages
vehicleAnnotations: Record<string, maplibregl.Marker>
  ↓ exposed via callback
  ├─→ LiveLocationMap (via onAnnotationsReady)
  └─→ MapAnimation (moves markers via setLngLat)
```

## Notes on the MapLibre/OpenFreeMap port

- MapLibre uses `[lng, lat]` coordinate order everywhere (opposite of MapKit's `lat, lon`).
- Stop hover/click use native GeoJSON layer hit-testing and `feature-state` instead of the
  hand-rolled screen-space distance math the MapKit version used.
- Route polylines are rendered as a single GeoJSON `line` layer with data-driven
  `line-color`, instead of one `PolylineOverlay` per segment.
- The MapKit-only `/generate-static-routes` dev tool (which used MapKit's Directions API to
  regenerate `shared/routes.json`) was dropped — `routes.json` is pre-generated and committed,
  and nothing in the live app depended on that tool.

## File Structure

```
maplibre/
├── README.md              # This file
├── index.ts               # Exports for all map components
├── MapCanvas.tsx          # Map initialization, routes/stops, interactions
├── MapAnimation.tsx       # Vehicle animation logic
└── MapOverlays.tsx        # Marker management (add/remove/update)

locations/components/
└── LiveLocationMap.tsx    # Main orchestrator (uses components from maplibre/)
```
