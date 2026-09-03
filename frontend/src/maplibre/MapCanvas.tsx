import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, NavigationControl, GeolocateControl, Popup, setWorkerUrl } from "maplibre-gl";
import type { GeoJSONSource, MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "../locations/styles/MapCanvas.css";

import type { ShuttleRouteData, ShuttleStopData } from "../types/route";

// MapLibre computes its worker script's URL relative to its own bundled module, which breaks
// once Vite inlines it into the app bundle. copy-maplibre-worker.js copies the worker (and the
// sibling chunk it imports) into public/ unbundled, verbatim, so this URL resolves correctly.
setWorkerUrl("/maplibre-gl/maplibre-gl-worker.mjs");

type MapCanvasProps = {
  routeData: ShuttleRouteData | null;
  selectedRoute?: string | null;
  setSelectedRoute?: (route: string | null) => void;
  isFullscreen?: boolean;
  onMapReady?: (map: MapLibreMap) => void;
};

// Free, no-API-key vector tiles - see https://openfreemap.org
// "bright" has a warm off-white background, soft yellow/orange highways, and light blue water -
// visually closer to Apple Maps' light style than "liberty" (which reads flatter/more saturated).
const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";

// center on RPI
const RPI_CENTER: [number, number] = [-73.675690, 42.730216]; // [lng, lat]
// Lowered from the campus-only default so fitBounds() can zoom out enough to fit every stop,
// even on the smaller embedded map size - it clamps the initial fit, not just manual zoom-out.
const MIN_ZOOM = 12.5;
const MAX_ZOOM = 19;
const INITIAL_FIT_PADDING_PX = 60;
// Floor for the initial fit-all-stops zoom - fitBounds alone can compute something quite far
// out on wide/short containers; this keeps the default view from feeling too zoomed out.
const MIN_INITIAL_FIT_ZOOM = 13.75;

// Fallback view, used only if routeData has no stops yet when the map is constructed.
const FALLBACK_CENTER = RPI_CENTER;
const FALLBACK_ZOOM = 15;
const FALLBACK_MAP_BOUNDS: [[number, number], [number, number]] = [
  [RPI_CENTER[0] - 0.03, RPI_CENTER[1] - 0.025],
  [RPI_CENTER[0] + 0.03, RPI_CENTER[1] + 0.025],
];

type StopExtent = { minLat: number; maxLat: number; minLon: number; maxLon: number };

function computeStopExtent(routeData: ShuttleRouteData | null): StopExtent | null {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;

  if (routeData) {
    for (const thisRouteData of Object.values(routeData)) {
      for (const stopKey of thisRouteData.STOPS) {
        const stopData = thisRouteData[stopKey] as ShuttleStopData;
        const [lat, lon] = stopData.COORDINATES;
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
      }
    }
  }

  return isFinite(minLat) ? { minLat, maxLat, minLon, maxLon } : null;
}

// Tight bounds (a little visual breathing room) used to pick the initial zoom, so all stops are
// visible by default without the user needing to zoom out.
function computeInitialViewBounds(extent: StopExtent | null): [[number, number], [number, number]] | null {
  if (!extent) return null;
  const { minLat, maxLat, minLon, maxLon } = extent;

  const latPadding = Math.max((maxLat - minLat) * 0.12, 0.003);
  const lonPadding = Math.max((maxLon - minLon) * 0.12, 0.003);
  return [
    [minLon - lonPadding, minLat - latPadding],
    [maxLon + lonPadding, maxLat + latPadding],
  ];
}

// Pan boundary, expanded further out from the initial view so every stop stays reachable by
// panning with room to spare. This MUST be derived from (and stay strictly wider than)
// initialViewBounds rather than computed independently: MapLibre's maxBounds doesn't just cap
// panning, it also forces a *minimum* zoom so the bounds always fill the viewport (no blank
// space beyond them) - so a maxBounds that isn't comfortably wider than the initial fit target
// silently overrides its padding and snaps the default view back in, discarding it entirely.
function computeMapBounds(initialViewBounds: [[number, number], [number, number]] | null): [[number, number], [number, number]] {
  if (!initialViewBounds) return FALLBACK_MAP_BOUNDS;
  const [[west, south], [east, north]] = initialViewBounds;

  const lonPadding = Math.max((east - west) * 0.5, 0.01);
  const latPadding = Math.max((north - south) * 0.5, 0.01);
  return [
    [west - lonPadding, south - latPadding],
    [east + lonPadding, north + latPadding],
  ];
}

const STOPS_SOURCE_ID = "shubble-stops";
const STOPS_LAYER_ID = "shubble-stops-circles";
const ROUTES_SOURCE_ID = "shubble-routes";
const ROUTES_LAYER_ID = "shubble-routes-lines";

const STOPS_SHADOW_LAYER_ID = "shubble-stops-shadow";
const ROUTES_CASING_LAYER_ID = "shubble-routes-casing";

const STOP_CIRCLE_RADIUS = 6;
// Solid white pin faces (Apple/Google-style stop dots) instead of the old translucent gray,
// so they read as a distinct UI element on top of the basemap rather than a map annotation.
const STOP_DEFAULT_COLOR = { stroke: "#8a8a8e", fill: "#FFFFFF", fillOpacity: 1 };
const STOP_HOVER_COLOR = { stroke: "#3b82f6", fill: "#eaf2ff", fillOpacity: 1 };

type StopFeature = {
  type: "Feature";
  id: number;
  properties: { routeKey: string; stopKey: string; stopName: string };
  geometry: { type: "Point"; coordinates: [number, number] };
};

type RouteFeature = {
  type: "Feature";
  properties: { color: string };
  geometry: { type: "LineString"; coordinates: [number, number][] };
};

function buildStopsGeoJSON(routeData: ShuttleRouteData) {
  const features: StopFeature[] = [];
  let id = 0;
  for (const [route, thisRouteData] of Object.entries(routeData)) {
    for (const stopKey of thisRouteData.STOPS) {
      const stopData = thisRouteData[stopKey] as ShuttleStopData;
      const [lat, lon] = stopData.COORDINATES;
      features.push({
        type: "Feature",
        id: id++,
        properties: { routeKey: route, stopKey, stopName: stopData.NAME },
        geometry: { type: "Point", coordinates: [lon, lat] },
      });
    }
  }
  return { type: "FeatureCollection" as const, features };
}

function buildRoutesGeoJSON(routeData: ShuttleRouteData) {
  const features: RouteFeature[] = [];
  for (const thisRouteData of Object.values(routeData)) {
    for (const segment of thisRouteData.ROUTES ?? []) {
      if (!segment || segment.length === 0) continue;
      features.push({
        type: "Feature",
        properties: { color: thisRouteData.COLOR },
        geometry: {
          type: "LineString",
          coordinates: segment.map(([lat, lon]) => [lon, lat]),
        },
      });
    }
  }
  return { type: "FeatureCollection" as const, features };
}

// Hides POI labels from the base style, mirroring MapKit's showsPointsOfInterest: false
function hidePoiLayers(map: MapLibreMap) {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    if ("source-layer" in layer && layer["source-layer"] === "poi") {
      map.setLayoutProperty(layer.id, "visibility", "none");
    }
  }
}

export default function MapCanvas({ routeData, setSelectedRoute, isFullscreen = false, onMapReady }: MapCanvasProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const selectedPopupRef = useRef<Popup | null>(null);
  const hoveredStopIdRef = useRef<number | null>(null);

  // create the map (once)
  useEffect(() => {
    if (!mapRef.current) return;

    const stopExtent = computeStopExtent(routeData);
    const initialViewBounds = computeInitialViewBounds(stopExtent);

    const thisMap = new MapLibreMap({
      container: mapRef.current,
      style: OPENFREEMAP_STYLE_URL,
      // Fit all stops in view by default (padded a little) rather than a fixed zoom, so users
      // see the whole service area first and can zoom in from there if they want. maxBounds is
      // deliberately NOT set here - passing it alongside bounds/fitBoundsOptions makes MapLibre's
      // constructor-time fitBounds() ignore the padding entirely (verified empirically). It's
      // applied via setMaxBounds() below instead, once the initial fit has already resolved.
      ...(initialViewBounds
        ? { bounds: initialViewBounds, fitBoundsOptions: { padding: INITIAL_FIT_PADDING_PX } }
        : { center: FALLBACK_CENTER, zoom: FALLBACK_ZOOM }),
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });

    thisMap.setMaxBounds(computeMapBounds(initialViewBounds));
    if (initialViewBounds && thisMap.getZoom() < MIN_INITIAL_FIT_ZOOM) {
      thisMap.setZoom(MIN_INITIAL_FIT_ZOOM);
    }
    thisMap.touchZoomRotate.disableRotation();
    thisMap.addControl(new NavigationControl({ showCompass: false }), "top-right");
    thisMap.addControl(new GeolocateControl({ trackUserLocation: true }), "top-right");

    thisMap.on("load", () => {
      hidePoiLayers(thisMap);
      setMap(thisMap);
      if (onMapReady) onMapReady(thisMap);
    });

    return () => {
      thisMap.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // add/update routes and stops, and wire up stop hover/click interactions
  useEffect(() => {
    if (!map || !routeData) return;

    const stopsGeoJSON = buildStopsGeoJSON(routeData);
    const routesGeoJSON = buildRoutesGeoJSON(routeData);

    const stopsSource = map.getSource(STOPS_SOURCE_ID) as GeoJSONSource | undefined;
    const routesSource = map.getSource(ROUTES_SOURCE_ID) as GeoJSONSource | undefined;

    if (stopsSource && routesSource) {
      // sources already exist (e.g. routeData reference changed on a re-render) - just refresh the data
      stopsSource.setData(stopsGeoJSON);
      routesSource.setData(routesGeoJSON);
      return;
    }

    map.addSource(ROUTES_SOURCE_ID, { type: "geojson", data: routesGeoJSON });
    // A white casing under the colored line gives routes a bit of separation from the basemap
    // (and from each other where they overlap), similar to how Apple/Google render transit lines.
    map.addLayer({
      id: ROUTES_CASING_LAYER_ID,
      type: "line",
      source: ROUTES_SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": 6,
        "line-opacity": 0.9,
      },
    });
    map.addLayer({
      id: ROUTES_LAYER_ID,
      type: "line",
      source: ROUTES_SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 3.5,
      },
    });

    map.addSource(STOPS_SOURCE_ID, { type: "geojson", data: stopsGeoJSON });
    // Soft drop shadow beneath the stop dots, offset slightly down, to lift them off the
    // basemap the way Apple/Google Maps annotations sit above the map rather than on it.
    map.addLayer({
      id: STOPS_SHADOW_LAYER_ID,
      type: "circle",
      source: STOPS_SOURCE_ID,
      paint: {
        "circle-radius": STOP_CIRCLE_RADIUS + 1.5,
        "circle-color": "#000000",
        "circle-opacity": 0.25,
        "circle-blur": 0.8,
        "circle-translate": [0, 1],
      },
    });
    map.addLayer({
      id: STOPS_LAYER_ID,
      type: "circle",
      source: STOPS_SOURCE_ID,
      paint: {
        "circle-radius": STOP_CIRCLE_RADIUS,
        "circle-color": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          STOP_HOVER_COLOR.fill,
          STOP_DEFAULT_COLOR.fill,
        ],
        "circle-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          STOP_HOVER_COLOR.fillOpacity,
          STOP_DEFAULT_COLOR.fillOpacity,
        ],
        "circle-stroke-width": 2,
        "circle-stroke-color": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          STOP_HOVER_COLOR.stroke,
          STOP_DEFAULT_COLOR.stroke,
        ],
      },
    });

    map.on("mousemove", STOPS_LAYER_ID, (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature || typeof feature.id !== "number") return;

      if (hoveredStopIdRef.current !== null && hoveredStopIdRef.current !== feature.id) {
        map.setFeatureState({ source: STOPS_SOURCE_ID, id: hoveredStopIdRef.current }, { hover: false });
      }
      hoveredStopIdRef.current = feature.id;
      map.setFeatureState({ source: STOPS_SOURCE_ID, id: feature.id }, { hover: true });
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", STOPS_LAYER_ID, () => {
      if (hoveredStopIdRef.current !== null) {
        map.setFeatureState({ source: STOPS_SOURCE_ID, id: hoveredStopIdRef.current }, { hover: false });
        hoveredStopIdRef.current = null;
      }
      map.getCanvas().style.cursor = "";
    });

    map.on("click", STOPS_LAYER_ID, (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature || feature.geometry.type !== "Point") return;

      const { routeKey, stopName } = feature.properties as { routeKey: string; stopKey: string; stopName: string };
      const [lon, lat] = feature.geometry.coordinates;

      selectedPopupRef.current?.remove();
      selectedPopupRef.current = new Popup({ closeButton: true })
        .setLngLat([lon, lat])
        .setText(stopName)
        .addTo(map);

      // Only change schedule selection on desktop-sized screens
      const isDesktop = window.matchMedia("(min-width: 800px)").matches;
      if (isDesktop && setSelectedRoute && routeKey) {
        setSelectedRoute(routeKey);
      }
    });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, routeData]);

  return (
    <div
      className={isFullscreen ? "map-fullscreen" : "map"}
      ref={mapRef}
    >
    </div>
  );
}
