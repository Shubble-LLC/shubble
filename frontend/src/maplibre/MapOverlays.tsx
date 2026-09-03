import { useEffect, useRef } from "react";
import { Marker, Popup } from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";

export interface KeyedAnnotation {
  id: string;
  lngLat: [number, number]; // [lng, lat]
  title: string;
  subtitle: string;
  svgHtml?: string;
  size?: number;
}

type MapOverlaysProps = {
  map: MapLibreMap | null;
  overlays: KeyedAnnotation[];
  onAnnotationsReady?: (markers: Record<string, Marker>) => void;
};

type TrackedMarker = {
  marker: Marker;
  element: HTMLDivElement;
  popup: Popup;
  svgHtml?: string;
};

function buildPopupContent(title: string, subtitle: string): HTMLElement {
  const container = document.createElement("div");
  const titleEl = document.createElement("strong");
  titleEl.textContent = title;
  const subtitleEl = document.createElement("div");
  subtitleEl.textContent = subtitle;
  container.appendChild(titleEl);
  container.appendChild(subtitleEl);
  return container;
}

/**
 * MapOverlays manages adding and removing shuttle markers on a MapLibre map.
 *
 * This component accepts a list of KeyedAnnotation objects and efficiently
 * manages which markers are rendered on the map by comparing keys, so
 * MapAnimation can move existing markers via setLngLat() without triggering
 * a remove/add cycle.
 */
export default function MapOverlays({ map, overlays, onAnnotationsReady }: MapOverlaysProps) {
  const renderedByKey = useRef<Map<string, TrackedMarker>>(new Map());

  useEffect(() => {
    if (!map) return;

    const newOverlaysMap = new Map(overlays.map((overlay) => [overlay.id, overlay]));
    const currentKeys = new Set(renderedByKey.current.keys());
    const newKeys = new Set(newOverlaysMap.keys());

    // Remove overlays no longer present
    for (const key of currentKeys) {
      if (!newKeys.has(key)) {
        renderedByKey.current.get(key)?.marker.remove();
        renderedByKey.current.delete(key);
      }
    }

    // Add new overlays
    for (const key of newKeys) {
      if (currentKeys.has(key)) continue;
      const overlay = newOverlaysMap.get(key)!;

      const element = document.createElement("div");
      if (overlay.size) {
        element.style.width = `${overlay.size}px`;
        element.style.height = `${overlay.size}px`;
      }
      if (overlay.svgHtml) element.innerHTML = overlay.svgHtml;

      const popup = new Popup({ offset: (overlay.size ?? 25) / 2, closeButton: false })
        .setDOMContent(buildPopupContent(overlay.title, overlay.subtitle));

      const marker = new Marker({ element, anchor: "center" })
        .setLngLat(overlay.lngLat)
        .setPopup(popup)
        .addTo(map);

      renderedByKey.current.set(key, { marker, element, popup, svgHtml: overlay.svgHtml });
    }

    // Update existing overlays in place
    for (const key of newKeys) {
      if (!currentKeys.has(key)) continue;
      const tracked = renderedByKey.current.get(key);
      const overlay = newOverlaysMap.get(key);
      if (!tracked || !overlay) continue;

      tracked.marker.setLngLat(overlay.lngLat);
      tracked.popup.setDOMContent(buildPopupContent(overlay.title, overlay.subtitle));
      if (overlay.svgHtml && overlay.svgHtml !== tracked.svgHtml) {
        tracked.element.innerHTML = overlay.svgHtml;
        tracked.svgHtml = overlay.svgHtml;
      }
    }

    if (onAnnotationsReady) {
      const record: Record<string, Marker> = {};
      renderedByKey.current.forEach((tracked, key) => {
        record[key] = tracked.marker;
      });
      onAnnotationsReady(record);
    }
  }, [map, overlays, onAnnotationsReady]);

  // Clean up all markers on unmount
  useEffect(() => {
    const currentOverlays = renderedByKey.current;
    return () => {
      currentOverlays.forEach((tracked) => tracked.marker.remove());
      currentOverlays.clear();
    };
  }, [map]);

  return null;
}
