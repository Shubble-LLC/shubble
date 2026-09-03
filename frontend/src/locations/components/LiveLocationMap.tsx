import { useEffect, useState, useMemo } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ShuttleIcon from "./ShuttleIcon";
import config from "../../utils/config";

import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import type { ShuttleRouteData } from "../../types/route";
import type { VehicleLocationMap, VehicleVelocityMap, VehicleCombinedMap } from "../../types/vehicleLocation";
import type { Coordinate } from "../../utils/mapUtils";

import MapCanvas from "../../maplibre/MapCanvas";
import MapAnimation from "../../maplibre/MapAnimation";
import type { AnimatedAnnotation } from "../../maplibre/MapAnimation";
import MapOverlays from "../../maplibre/MapOverlays";

type LiveLocationMapProps = {
  routeData: ShuttleRouteData | null;
  displayVehicles?: boolean;
  selectedRoute?: string | null;
  setSelectedRoute?: (route: string | null) => void;
  isFullscreen?: boolean;
  showTrueLocation?: boolean;
  shuttleIconSize?: number;
};

export default function LiveLocationMap({
  routeData,
  displayVehicles = true,
  selectedRoute,
  setSelectedRoute,
  isFullscreen = false,
  showTrueLocation = true,
  shuttleIconSize = 25,
}: LiveLocationMapProps) {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [vehicles, setVehicles] = useState<VehicleCombinedMap | null>(null);
  const [vehicleAnnotations, setVehicleAnnotations] = useState<Record<string, Marker>>({});

  // Fetch location and velocity data on component mount and set up polling
  useEffect(() => {
    if (!displayVehicles) return;

    let abortController: AbortController | null = null;

    const pollLocation = async () => {
      // Cancel any in-flight request before starting a new one
      if (abortController) {
        abortController.abort();
      }
      abortController = new AbortController();
      const { signal } = abortController;

      try {
        // Fetch locations and velocities in parallel
        const [locationsResponse, velocitiesResponse] = await Promise.all([
          fetch(`${config.apiBaseUrl}/api/locations`, { cache: 'no-store', signal }),
          fetch(`${config.apiBaseUrl}/api/velocities`, { cache: 'no-store', signal })
        ]);

        if (!locationsResponse.ok) {
          throw new Error('Failed to fetch locations');
        }

        const locationsData: VehicleLocationMap = await locationsResponse.json() as VehicleLocationMap;

        // Velocities are optional - don't fail if they're unavailable
        let velocitiesData: VehicleVelocityMap = {};
        if (velocitiesResponse.ok) {
          velocitiesData = await velocitiesResponse.json() as VehicleVelocityMap;
        }

        // Merge location and velocity data
        const combined: VehicleCombinedMap = {};
        for (const [vehicleId, location] of Object.entries(locationsData)) {
          const velocity = velocitiesData[vehicleId];
          combined[vehicleId] = {
            ...location,
            route_name: velocity?.route_name ?? null,
            polyline_index: velocity?.polyline_index ?? null,
            segment_index: velocity?.segment_index ?? null,
            predicted_location: velocity && velocity.speed_kmh !== null && velocity.timestamp !== null ? {
              speed_kmh: velocity.speed_kmh,
              timestamp: velocity.timestamp
            } : undefined,
            is_at_stop: velocity?.is_at_stop,
            current_stop: velocity?.current_stop,
          };
        }

        setVehicles(combined);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.error('Error fetching location:', error);
      }
    }

    pollLocation();

    // refresh location every 5 seconds
    const refreshLocation = setInterval(pollLocation, 5000);

    return () => {
      clearInterval(refreshLocation);
      if (abortController) abortController.abort();
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Memoize flattened routes to avoid recalculating on every render
  const flattenedRoutes = useMemo(() => {
    if (!routeData) return {};
    const flattened: Record<string, Coordinate[]> = {};

    for (const [routeKey, data] of Object.entries(routeData)) {
      if (data.ROUTES) {
        // Flatten all route segments into one continuous polyline
        const points: Coordinate[] = [];
        data.ROUTES.forEach(segment => {
          segment.forEach(pt => {
            points.push({ latitude: pt[0], longitude: pt[1] });
          });
        });
        flattened[routeKey] = points;
      }
    }
    return flattened;
  }, [routeData]);

  // Compute vehicle annotation props (list)
  const vehicleAnnotationProps = useMemo(() => {
    // We need the map to be initialized before markers can be placed
    if (!vehicles || !routeData || !map) return [];

    const list: AnimatedAnnotation[] = [];

    Object.keys(vehicles).forEach((key) => {
      const vehicle = vehicles[key];

      // Build SVG dynamically using ShuttleIcon component
      const routeColor = (() => {
        if (!vehicle.route_name) {
          return "#444444";
        }
        const routeKey = vehicle.route_name as keyof typeof routeData;
        const info = routeData[routeKey] as { COLOR?: string };
        return info.COLOR ?? "#444444";
      })();

      // Render ShuttleIcon JSX to a static SVG string
      const svgHtml = renderToStaticMarkup(<ShuttleIcon color={routeColor} size={shuttleIconSize} />);

      // Use predicted speed if available, otherwise fall back to reported speed
      // If showTrueLocation is true, set speed to 0 to disable animation
      const displaySpeed = showTrueLocation ? 0 : (
        vehicle.predicted_location?.speed_kmh
          ? vehicle.predicted_location.speed_kmh * 0.621371  // Convert km/h to mph
          : vehicle.speed_mph
      );

      // Get route polyline
      let routePolyline: Coordinate[] | undefined;
      if (vehicle.route_name && flattenedRoutes[vehicle.route_name]) {
        routePolyline = flattenedRoutes[vehicle.route_name];
      }

      list.push({
        id: key,
        lngLat: [vehicle.longitude, vehicle.latitude],
        title: vehicle.name,
        subtitle: `${displaySpeed.toFixed(1)} mph`,
        svgHtml,
        size: shuttleIconSize,

        // AnimatedAnnotation specific
        heading: vehicle.heading_degrees,
        speedMph: vehicle.speed_mph,
        predictedSpeedKmh: vehicle.predicted_location?.speed_kmh,
        timestamp: new Date(vehicle.timestamp).getTime(),
        segmentIndex: vehicle.segment_index ?? 0,
        routePolylineIndex: vehicle.polyline_index ?? 0,
        routePolyline: routePolyline ? [routePolyline] : undefined,
      });
    });

    return list;
  }, [vehicles, routeData, map, shuttleIconSize, showTrueLocation, flattenedRoutes]);

  return (
    <>
      <MapCanvas
        routeData={routeData}
        selectedRoute={selectedRoute}
        setSelectedRoute={setSelectedRoute}
        isFullscreen={isFullscreen}
        onMapReady={setMap}
      />
      <MapOverlays
        map={map}
        overlays={vehicleAnnotationProps}
        onAnnotationsReady={setVehicleAnnotations}
      />
      <MapAnimation
        annotations={vehicleAnnotationProps}
        vehicleAnnotations={vehicleAnnotations}
        showTrueLocation={showTrueLocation}
      />
    </>
  );
}
