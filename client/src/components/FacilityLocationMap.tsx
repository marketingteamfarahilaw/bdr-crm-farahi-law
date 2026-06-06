/// <reference types="@types/google.maps" />
import { MapView } from "@/components/Map";

/**
 * Single-facility location map. Reuses the same Google Maps JS API loader as the
 * Facilities map (MapView). Centers on the facility's coordinates if present,
 * otherwise geocodes its address. Drops a marker once ready.
 */
export function FacilityLocationMap({
  name,
  latitude,
  longitude,
  address,
}: {
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  address?: string;
}) {
  const hasCoords =
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    !isNaN(latitude) &&
    !isNaN(longitude);

  const handleReady = (map: google.maps.Map) => {
    const place = (pos: google.maps.LatLngLiteral) => {
      map.setCenter(pos);
      map.setZoom(15);
      try {
        new google.maps.marker.AdvancedMarkerElement({ map, position: pos, title: name });
      } catch {
        // Fallback for environments without the marker library / mapId
        new google.maps.Marker({ map, position: pos, title: name });
      }
    };

    if (hasCoords) {
      place({ lat: latitude as number, lng: longitude as number });
    } else if (address) {
      try {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ address }, (results, status) => {
          if (status === "OK" && results && results[0]) {
            place(results[0].geometry.location.toJSON());
          }
        });
      } catch {
        /* geocoding unavailable — leave map at default view */
      }
    }
  };

  return (
    <MapView
      className="w-full h-72"
      initialCenter={hasCoords ? { lat: latitude as number, lng: longitude as number } : undefined}
      initialZoom={15}
      onMapReady={handleReady}
    />
  );
}
