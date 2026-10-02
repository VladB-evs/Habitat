import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol as PMTilesProtocol } from 'pmtiles';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

// Register pmtiles:// protocol for Overture Maps vector tiles
const pmtilesProtocol = new PMTilesProtocol();
maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../../api';
import { ask } from '../../confirm';
import { dialogIn, spring, stagger } from '../../motion';
import { useApp } from '../../store';
import type { StudyCategory, StudyPlace } from '../../types';
import { Icon, TypeIcon } from '../Icons';
import { SplitControls } from '../SplitControls';

type MapStyleKey = 'auto' | 'dark' | 'light' | 'voyager' | 'satellite';

const OVERTURE_PLACES_PMTILES = 'pmtiles://https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-09-23.1/places.pmtiles';

const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'google-hybrid': {
      type: 'raster',
      tiles: [
        'https://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
        'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
        'https://mt2.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
        'https://mt3.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      ],
      tileSize: 256,
      maxzoom: 22,
      attribution: '© Google',
    },
    'overture-places': {
      type: 'vector',
      url: OVERTURE_PLACES_PMTILES,
    },
  },
  layers: [
    {
      id: 'google-hybrid-layer',
      type: 'raster',
      source: 'google-hybrid',
      minzoom: 0,
      maxzoom: 22,
    },
    {
      id: 'poi-dots',
      type: 'circle',
      source: 'overture-places',
      'source-layer': 'places',
      minzoom: 14,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 3, 16, 5, 18, 7],
        'circle-color': '#ffffff',
        'circle-stroke-width': 1.8,
        'circle-stroke-color': 'rgba(0,0,0,0.5)',
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 14.5, 0.85],
        'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 14.5, 0.7],
      },
    },
    {
      id: 'poi-labels',
      type: 'symbol',
      source: 'overture-places',
      'source-layer': 'places',
      minzoom: 15.5,
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ''],
        'text-size': ['interpolate', ['linear'], ['zoom'], 15.5, 10, 18, 12.5],
        'text-offset': [0, 1.4],
        'text-anchor': 'top',
        'text-max-width': 9,
        'text-allow-overlap': false,
        'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.7)',
        'text-halo-width': 1.2,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 15.5, 0, 16, 1],
      },
    },
  ],
};

// Category keyword mapping: Overture basic_category → best matching user category name
const OVERTURE_CATEGORY_MAP: Record<string, string[]> = {
  coffee: ['cafe', 'coffee_shop', 'coffee', 'tea_house'],
  restaurant: ['restaurant', 'fast_food', 'food_court', 'diner', 'pizzeria', 'sushi', 'steakhouse', 'noodle', 'seafood', 'buffet', 'bistro', 'brasserie', 'ramen'],
  bar: ['bar', 'pub', 'nightclub', 'lounge', 'wine_bar', 'beer_garden', 'cocktail'],
  hotel: ['hotel', 'motel', 'hostel', 'resort', 'inn', 'bed_and_breakfast', 'lodge', 'guesthouse', 'accommodation'],
  library: ['library', 'bookstore', 'book_shop'],
  shopping: ['shop', 'store', 'mall', 'supermarket', 'market', 'retail', 'boutique', 'department_store', 'convenience', 'grocery'],
  gym: ['gym', 'fitness', 'sports_centre', 'yoga', 'pilates', 'swimming_pool'],
  park: ['park', 'garden', 'nature', 'trail', 'playground', 'forest', 'beach', 'recreation'],
  school: ['school', 'university', 'college', 'education', 'academy', 'kindergarten'],
  hospital: ['hospital', 'clinic', 'doctor', 'pharmacy', 'dentist', 'medical', 'healthcare', 'veterinary'],
  office: ['office', 'coworking', 'business', 'corporate', 'workspace'],
  transport: ['bus_station', 'train_station', 'airport', 'ferry', 'subway', 'metro', 'taxi', 'gas_station', 'fuel', 'parking'],
  museum: ['museum', 'gallery', 'art', 'exhibition', 'theater', 'theatre', 'cinema', 'concert'],
  worship: ['church', 'mosque', 'temple', 'synagogue', 'chapel', 'shrine', 'worship'],
  bank: ['bank', 'atm', 'finance', 'insurance', 'credit_union'],
};

function matchOvertureCategory(overtureCategory: string | undefined, userCategories: StudyCategory[]): string {
  if (!overtureCategory || userCategories.length === 0) return userCategories[0]?.name || '';
  const lower = overtureCategory.toLowerCase().replace(/[^a-z0-9_]/g, '_');

  // Try direct match against user category names first
  for (const uc of userCategories) {
    if (uc.name.toLowerCase() === lower || lower.includes(uc.name.toLowerCase()) || uc.name.toLowerCase().includes(lower)) {
      return uc.name;
    }
  }

  // Map Overture → canonical group, then match group to user categories
  let matchedGroup = '';
  for (const [group, keywords] of Object.entries(OVERTURE_CATEGORY_MAP)) {
    if (keywords.some((k) => lower.includes(k) || k.includes(lower))) {
      matchedGroup = group;
      break;
    }
  }

  if (matchedGroup) {
    for (const uc of userCategories) {
      const ucLower = uc.name.toLowerCase();
      if (ucLower.includes(matchedGroup) || matchedGroup.includes(ucLower)) {
        return uc.name;
      }
    }
  }

  return userCategories[0]?.name || '';
}

const MAP_STYLES: Record<Exclude<MapStyleKey, 'auto' | 'satellite'>, string> = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  voyager: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
};

const CATEGORY_ICONS = [
  'book',
  'coffee',
  'building',
  'library',
  'graduation-cap',
  'laptop',
  'notebook',
  'home',
  'trees',
  'pin',
  'star',
  'sparkles',
  'compass',
];

const PRESET_COLORS = [
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#10b981', // emerald
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#ef4444', // red
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#6366f1', // indigo
  '#14b8a6', // teal
];

// Fallback campus coordinates (Cambridge / Harvard yard)
const DEFAULT_CENTER: [number, number] = [-71.1167, 42.377];
const DEFAULT_ZOOM = 16;

export interface GeoSearchResult {
  id: string | number;
  name: string;
  address: string;
  lat: number;
  lng: number;
  tag: string;
  icon: string;
  category?: string;
  isHouse?: boolean;
  isPoi?: boolean;
}

function formatPhotonFeature(f: any, originalQuery: string): GeoSearchResult {
  const p = f.properties || {};
  const coords = f.geometry?.coordinates || [0, 0];
  const isHouse = p.osm_value === 'house' || p.type === 'house' || !!p.housenumber;

  // If user searched e.g. 65B and OSM node has housenumber 65, preserve the user's sub-letter
  let displayHouseNum = p.housenumber || '';
  if (p.housenumber) {
    const letterMatch = originalQuery.match(new RegExp(`\\b${p.housenumber}([a-zA-Z])\\b`, 'i'));
    if (letterMatch) {
      displayHouseNum = `${p.housenumber}${letterMatch[1].toUpperCase()}`;
    }
  }

  let name = p.name;
  if (!name) {
    if (p.street && displayHouseNum) {
      name = `${p.street} ${displayHouseNum}`;
    } else if (p.street) {
      name = p.street;
    } else if (p.city || p.locality) {
      name = p.locality || p.city;
    } else {
      name = originalQuery;
    }
  }

  const addrParts: string[] = [];
  if (displayHouseNum && p.street && name !== `${p.street} ${displayHouseNum}` && name !== p.street) {
    addrParts.push(`${p.street} ${displayHouseNum}`);
  } else if (p.street && name !== p.street && !name.includes(p.street)) {
    addrParts.push(p.street);
  }

  const loc = p.locality || p.district;
  if (loc && loc !== name && !addrParts.includes(loc)) addrParts.push(loc);
  if (p.city && p.city !== name && !addrParts.includes(p.city)) addrParts.push(p.city);
  if (p.postcode && !addrParts.includes(p.postcode)) addrParts.push(p.postcode);
  if (p.country && p.country !== name && !addrParts.includes(p.country)) addrParts.push(p.country);

  const address = addrParts.join(', ');

  let tag = 'Place';
  let icon = 'pin';
  const val = (p.osm_value || '').toLowerCase();
  const key = (p.osm_key || '').toLowerCase();

  if (val === 'hotel' || key === 'tourism') {
    tag = 'Hotel';
    icon = 'building';
  } else if (val === 'restaurant' || val === 'food' || val === 'fast_food') {
    tag = 'Restaurant';
    icon = 'coffee';
  } else if (val === 'cafe' || val === 'bar' || val === 'pub') {
    tag = val === 'cafe' ? 'Café' : 'Bar';
    icon = 'coffee';
  } else if (isHouse) {
    tag = 'Address';
    icon = 'home';
  } else if (key === 'highway' || p.type === 'street') {
    tag = 'Street';
    icon = 'compass';
  } else if (p.type === 'city' || p.type === 'district' || p.type === 'locality') {
    tag = 'Area';
    icon = 'globe';
  }

  return {
    id: p.osm_id || `${coords[0]}_${coords[1]}_${name}`,
    name,
    address,
    lat: coords[1],
    lng: coords[0],
    tag,
    icon,
    category: val || key || 'place',
    isHouse,
    isPoi: ['hotel', 'restaurant', 'cafe', 'bar', 'tourism', 'amenity'].includes(val),
  };
}

function formatNominatimItem(item: any): GeoSearchResult {
  const shortName = item.name || (item.display_name ? item.display_name.split(',')[0] : 'Location');
  const parts = (item.display_name || '').split(',').map((s: string) => s.trim());
  const address = parts.slice(1, 4).join(', ');
  const type = (item.type || item.class || '').toLowerCase();
  let tag = 'Place';
  let icon = 'pin';
  if (type.includes('hotel') || item.class === 'tourism') {
    tag = 'Hotel';
    icon = 'building';
  } else if (type.includes('restaurant') || type.includes('cafe')) {
    tag = 'Food';
    icon = 'coffee';
  } else if (item.class === 'highway') {
    tag = 'Street';
    icon = 'compass';
  } else if (item.class === 'place' || item.class === 'building') {
    tag = 'Address';
    icon = 'home';
  }

  return {
    id: item.place_id || item.osm_id || Math.random(),
    name: shortName,
    address: address || item.display_name || '',
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
    tag,
    icon,
    category: item.type || item.class,
  };
}

export function StudyMap({ initialPlaceId }: { initialPlaceId?: string }) {
  const { theme, navigate } = useApp();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const draftMarkerRef = useRef<maplibregl.Marker | null>(null);

  // Data states
  const [places, setPlaces] = useState<StudyPlace[]>([]);
  const [categories, setCategories] = useState<StudyCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(initialPlaceId ?? null);
  const [searchQuery, setSearchQuery] = useState('');

  // UI modes
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    try {
      const saved = localStorage.getItem('habitat:study-map:sidebar-open');
      return saved !== null ? saved === 'true' : false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('habitat:study-map:sidebar-open', String(isSidebarOpen));
    } catch {}
  }, [isSidebarOpen]);

  const [mapStyleKey, setMapStyleKey] = useState<MapStyleKey>(() => {
    try {
      const saved = localStorage.getItem('habitat:map:style') as MapStyleKey;
      if (saved && (saved === 'auto' || saved === 'dark' || saved === 'light' || saved === 'voyager' || saved === 'satellite')) {
        return saved;
      }
    } catch {}
    return 'auto';
  });
  const [showStyleMenu, setShowStyleMenu] = useState(false);

  // POI overlay visibility
  const [showPoi, setShowPoi] = useState(() => {
    try {
      const saved = localStorage.getItem('habitat:map:show-poi');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });
  const poiPopupRef = useRef<maplibregl.Popup | null>(null);
  const placePopupRef = useRef<maplibregl.Popup | null>(null);
  const showPlacePopupRef = useRef<(p: StudyPlace) => void>();

  const handleSelectStyle = (key: MapStyleKey) => {
    setMapStyleKey(key);
    setShowStyleMenu(false);
    try {
      localStorage.setItem('habitat:map:style', key);
    } catch {}
  };

  // Dialogs
  const [modalPlace, setModalPlace] = useState<{
    mode: 'create' | 'edit';
    place?: StudyPlace;
    lat: number;
    lng: number;
    name: string;
    category: string;
    color: string;
    notes: string;
    address: string;
  } | null>(null);

  const [editingCategory, setEditingCategory] = useState<StudyCategory | null>(null);
  const [newCategoryModal, setNewCategoryModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('pin');
  const [newCatColor, setNewCatColor] = useState('#3b82f6');

  // Search / geocoding
  const [geoQuery, setGeoQuery] = useState('');
  const [geoResults, setGeoResults] = useState<GeoSearchResult[]>([]);
  const [isSearchingGeo, setIsSearchingGeo] = useState(false);
  const [showGeoDropdown, setShowGeoDropdown] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [userLocMarker, setUserLocMarker] = useState<maplibregl.Marker | null>(null);
  const userLocMarkerRef = useRef<maplibregl.Marker | null>(null);

  // Close search dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | PointerEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setShowGeoDropdown(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick);
    return () => document.removeEventListener('pointerdown', handleOutsideClick);
  }, []);

  // Cleanup debounce and fetch abort controllers on unmount
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (searchAbortRef.current) searchAbortRef.current.abort();
    };
  }, []);

  // Dynamic user accent color from CSS variables
  const userAccent = useMemo(() => {
    if (typeof window === 'undefined') return '#eda100';
    const val = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return val || '#eda100';
  }, [theme]);

  // Refs for MapLibre event listeners to prevent stale closures
  const selectedPlaceIdRef = useRef(selectedPlaceId);
  selectedPlaceIdRef.current = selectedPlaceId;

  const modalPlaceRef = useRef(modalPlace);
  modalPlaceRef.current = modalPlace;

  const activeCategoryRef = useRef(activeCategory);
  activeCategoryRef.current = activeCategory;

  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;

  const userAccentRef = useRef(userAccent);
  userAccentRef.current = userAccent;

  const handleDropPinRef = useRef<(lat: number, lng: number, prefilledName?: string, prefilledAddress?: string, overtureCategory?: string) => Promise<void>>();
  const moveDraftPinRef = useRef<(lat: number, lng: number) => Promise<void>>();
  const handleLocateMeRef = useRef<(fly?: boolean) => Promise<void>>();

  // Load places and categories
  const loadData = useCallback(async () => {
    try {
      const [pList, cList] = await Promise.all([api.study.places(), api.study.categories()]);
      setPlaces(pList);
      setCategories(cList);
    } catch (e) {
      console.error('Failed to load study places or categories:', e);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Active style URL / StyleSpecification
  const resolvedStyleUrl: string | maplibregl.StyleSpecification = useMemo(() => {
    if (mapStyleKey === 'satellite') {
      return SATELLITE_STYLE;
    }
    if (mapStyleKey === 'auto') {
      return theme === 'light' ? MAP_STYLES.light : MAP_STYLES.dark;
    }
    return MAP_STYLES[mapStyleKey];
  }, [mapStyleKey, theme]);

  // Initialize MapLibre
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Read stored position if any
    let initCenter = DEFAULT_CENTER;
    let initZoom = DEFAULT_ZOOM;
    let hasStoredViewport = false;
    try {
      const stored = localStorage.getItem('habitat:study-map:viewport');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed.center) && typeof parsed.zoom === 'number') {
          initCenter = parsed.center;
          initZoom = parsed.zoom;
          hasStoredViewport = true;
        }
      }
    } catch {}

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: resolvedStyleUrl,
      center: initCenter,
      zoom: initZoom,
      minZoom: 1.5,
      maxZoom: 20,
      renderWorldCopies: false,
      trackResize: false,
      pitchWithRotate: true,
      dragRotate: true,
      attributionControl: { compact: true },
    });

    map.on('error', (e) => {
      console.warn('MapLibre error:', e?.error?.message || e);
    });

    mapRef.current = map;

    // Dynamic zoom-based pin scaling and tier classification
    const updateZoomMetrics = () => {
      const z = map.getZoom();
      const el = mapContainerRef.current;
      if (!el) return;

      const tier = z >= 14 ? 'close' : z >= 11.5 ? 'mid' : 'far';
      if (el.dataset.zoomTier !== tier) {
        el.dataset.zoomTier = tier;
      }

      // Smooth scale calculation:
      // z >= 15: 1.0
      // z = 13: 0.84
      // z = 11: 0.69
      // z <= 8: 0.45
      const clampedZ = Math.max(8, Math.min(15, z));
      const scale = 0.45 + ((clampedZ - 8) / (15 - 8)) * (1.0 - 0.45);
      el.style.setProperty('--map-pin-scale', scale.toFixed(2));
    };

    map.on('zoom', updateZoomMetrics);
    updateZoomMetrics();

    // Auto-locate user on initial launch if no viewport saved
    if (!hasStoredViewport && !initialPlaceId) {
      handleLocateMeRef.current?.(true);
    } else {
      // Quietly establish position to show marker without overriding user view
      handleLocateMeRef.current?.(false);
    }

    // Viewport persistence
    const saveViewport = () => {
      const c = map.getCenter();
      const z = map.getZoom();
      localStorage.setItem('habitat:study-map:viewport', JSON.stringify({ center: [c.lng, c.lat], zoom: z }));
      updateZoomMetrics();
    };
    map.on('moveend', saveViewport);

    // Click handler on map
    map.on('click', (e: maplibregl.MapMouseEvent) => {
      const { lng, lat } = e.lngLat;
      if (placePopupRef.current) {
        placePopupRef.current.remove();
        placePopupRef.current = null;
      }
      if (selectedPlaceIdRef.current) {
        setSelectedPlaceId(null);
        return;
      }
      if (modalPlaceRef.current && modalPlaceRef.current.mode === 'create') {
        moveDraftPinRef.current?.(lat, lng);
        return;
      }

      // Check if user clicked on an Overture POI dot/label
      try {
        const poiFeatures = map.queryRenderedFeatures(e.point, { layers: ['poi-dots', 'poi-labels'] });
        if (poiFeatures.length > 0) {
          const feat = poiFeatures[0];
          const props = feat.properties || {};
          const poiName = props.name || '';
          const poiCategory = props.basic_category || props.category || '';
          const geom = feat.geometry as { type: string; coordinates: [number, number] };
          const poiLng = geom.coordinates[0];
          const poiLat = geom.coordinates[1];

          // Close any existing POI popup
          if (poiPopupRef.current) {
            poiPopupRef.current.remove();
            poiPopupRef.current = null;
          }

          // Build popup HTML
          const catLabel = poiCategory ? poiCategory.replace(/_/g, ' ') : '';
          const popupDiv = document.createElement('div');

          const bodyDiv = document.createElement('div');
          bodyDiv.className = 'hab-poi-popup-body';
          if (poiName) {
            const nameEl = document.createElement('div');
            nameEl.className = 'hab-poi-popup-name';
            nameEl.textContent = poiName;
            bodyDiv.appendChild(nameEl);
          }
          if (catLabel) {
            const catEl = document.createElement('div');
            catEl.className = 'hab-poi-popup-cat';
            catEl.textContent = catLabel;
            bodyDiv.appendChild(catEl);
          }

          // Address placeholder — will be filled by reverse geocoding
          const addrEl = document.createElement('div');
          addrEl.className = 'hab-poi-popup-addr';
          addrEl.textContent = 'Loading address…';
          bodyDiv.appendChild(addrEl);
          popupDiv.appendChild(bodyDiv);

          const actionsDiv = document.createElement('div');
          actionsDiv.className = 'hab-poi-popup-actions';

          const saveBtn = document.createElement('button');
          saveBtn.className = 'btn primary small';
          saveBtn.innerHTML = '<span>Save to My Places</span>';

          const dirBtn = document.createElement('button');
          dirBtn.className = 'btn subtle small';
          dirBtn.innerHTML = '<span>Directions</span>';
          dirBtn.addEventListener('click', () => {
            window.open(`https://www.google.com/maps/dir/?api=1&destination=${poiLat},${poiLng}`, '_blank');
          });

          actionsDiv.appendChild(saveBtn);
          actionsDiv.appendChild(dirBtn);
          popupDiv.appendChild(actionsDiv);

          const popup = new maplibregl.Popup({
            offset: 14,
            closeButton: true,
            className: 'hab-poi-popup-wrap',
            maxWidth: '300px',
          })
            .setLngLat([poiLng, poiLat])
            .setDOMContent(popupDiv)
            .addTo(map);

          poiPopupRef.current = popup;

          // Save button handler
          saveBtn.addEventListener('click', () => {
            popup.remove();
            poiPopupRef.current = null;
            handleDropPinRef.current?.(poiLat, poiLng, poiName, addrEl.textContent !== 'Loading address…' ? addrEl.textContent || '' : '', poiCategory);
          });

          // Reverse geocode to fill address
          reverseGeocode(poiLat, poiLng).then((geo) => {
            if (geo?.address) {
              addrEl.textContent = geo.address;
            } else {
              addrEl.textContent = `${poiLat.toFixed(5)}, ${poiLng.toFixed(5)}`;
            }
          });

          return; // Don't drop a pin — we showed the POI popup instead
        }
      } catch {}

      // Check if user clicked directly on a rendered vector map feature (e.g. building, POI, landmark, street)
      let featureName = '';
      try {
        const features = map.queryRenderedFeatures(e.point);
        for (const feat of features) {
          const props = feat.properties || {};
          const candidate =
            props.name ||
            props.name_en ||
            props['name:en'] ||
            props.title ||
            props.housename ||
            props.brand;
          if (candidate && typeof candidate === 'string' && candidate.trim()) {
            featureName = candidate.trim();
            break;
          }
        }
      } catch {}

      handleDropPinRef.current?.(lat, lng, featureName);
    });

    // Right-click to drop pin
    map.on('contextmenu', (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      handleDropPinRef.current?.(e.lngLat.lat, e.lngLat.lng);
    });

    // POI hover: change cursor to pointer
    map.on('mouseenter', 'poi-dots', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'poi-dots', () => {
      map.getCanvas().style.cursor = '';
    });
    map.on('mouseenter', 'poi-labels', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'poi-labels', () => {
      map.getCanvas().style.cursor = '';
    });

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSize = { w: 0, h: 0 };

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const { width, height } = entry.contentRect;
      if (Math.abs(width - lastSize.w) < 1 && Math.abs(height - lastSize.h) < 1) {
        return;
      }

      if (resizeTimer) clearTimeout(resizeTimer);

      // Debounce resize so smooth spring animations and pane resizes don't clear WebGL framebuffers on every frame
      resizeTimer = setTimeout(() => {
        if (!mapRef.current) return;
        lastSize = { w: width, h: height };
        map.resize();
      }, 100);
    });

    if (mapContainerRef.current) {
      ro.observe(mapContainerRef.current);
    }

    // Cleanup
    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      ro.disconnect();
      if (poiPopupRef.current) {
        poiPopupRef.current.remove();
        poiPopupRef.current = null;
      }
      if (placePopupRef.current) {
        placePopupRef.current.remove();
        placePopupRef.current = null;
      }
      if (userLocMarkerRef.current) {
        userLocMarkerRef.current.remove();
        userLocMarkerRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update style when theme or style setting changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(resolvedStyleUrl);
  }, [resolvedStyleUrl]);

  // Toggle POI overlay visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try {
      localStorage.setItem('habitat:map:show-poi', String(showPoi));
    } catch {}

    const setVisibility = () => {
      const vis = showPoi ? 'visible' : 'none';
      try {
        if (map.getLayer('poi-dots')) map.setLayoutProperty('poi-dots', 'visibility', vis);
        if (map.getLayer('poi-labels')) map.setLayoutProperty('poi-labels', 'visibility', vis);
      } catch {}
    };

    if (map.isStyleLoaded()) {
      setVisibility();
    } else {
      map.once('styledata', setVisibility);
    }
  }, [showPoi, resolvedStyleUrl]);

  // High precision reverse geocode helper: uses Photon (Komoot OSM) first for fast POI/building names, with fallback to Nominatim
  const reverseGeocode = async (lat: number, lng: number) => {
    // 1. Try Photon (fast, unthrottled, specialized for POIs, venues, and addresses)
    try {
      const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`, {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        const feat = data?.features?.[0];
        if (feat && feat.properties) {
          const p = feat.properties;
          const name = p.name || p.housenumber || '';
          const addressParts = [
            p.housenumber,
            p.street,
            p.locality || p.district,
            p.city || p.county,
            p.country,
          ].filter(Boolean);
          const address = addressParts.join(', ');
          if (name || address) {
            return {
              name: name || addressParts[0] || '',
              address: address || name,
            };
          }
        }
      }
    } catch {}

    // 2. Fallback to OpenStreetMap Nominatim
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        const name =
          data.name ||
          data.address?.building ||
          data.address?.amenity ||
          data.address?.shop ||
          data.address?.office ||
          data.address?.tourism ||
          data.address?.college ||
          data.address?.university ||
          data.address?.road ||
          '';
        return {
          name,
          address: data.display_name || '',
        };
      }
    } catch {}

    return null;
  };

  // Teardrop pin marker creation DOM elements
  const createDraftMarkerElement = (accent: string) => {
    const el = document.createElement('div');
    el.className = 'hab-pin-wrapper draft';
    el.innerHTML = `
      <div class="hab-pin-ground-ripple" style="border-color: ${accent}"></div>
      <div class="hab-pin-ground-shadow"></div>
      <div class="hab-pin-body">
        <svg width="32" height="42" viewBox="0 0 32 42" fill="none" class="hab-pin-svg">
          <path
            d="M16 41C16 41 29 27 29 16A13 13 0 1 0 3 16C3 27 16 41 16 41Z"
            fill="${accent}"
            stroke="#ffffff"
            stroke-width="2.5"
            stroke-linejoin="round"
          />
          <circle cx="16" cy="16" r="5" fill="#ffffff" />
        </svg>
        <div class="hab-draft-badge">
          <span>Drag to adjust</span>
        </div>
      </div>
    `;
    return el;
  };

  const createPlaceMarkerElement = (place: StudyPlace, category?: StudyCategory, isSelected?: boolean) => {
    const el = document.createElement('div');
    el.className = `hab-pin-wrapper saved ${isSelected ? 'selected' : ''}`;
    const color = category?.color || userAccent;

    el.innerHTML = `
      <div class="hab-pin-ground-shadow"></div>
      <div class="hab-pin-body">
        <svg width="28" height="38" viewBox="0 0 32 42" fill="none" class="hab-pin-svg">
          <path
            d="M16 41C16 41 29 27 29 16A13 13 0 1 0 3 16C3 27 16 41 16 41Z"
            fill="${color}"
            stroke="#ffffff"
            stroke-width="2.5"
            stroke-linejoin="round"
          />
          <circle cx="16" cy="16" r="5" fill="#ffffff" />
        </svg>
      </div>
      <div class="hab-map-pin-label">
        <span class="hab-pin-label-dot" style="background:${color}"></span>
        <span class="hab-pin-label-text">${escapeHtml(place.name)}</span>
      </div>
    `;

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      setSelectedPlaceId(place.id);
      mapRef.current?.flyTo({ center: [place.lng, place.lat], zoom: 17, duration: 800 });
      showPlacePopupRef.current?.(place);
    });

    return el;
  };

  const updateDraftMarkerColor = useCallback((color: string) => {
    if (draftMarkerRef.current) {
      const el = draftMarkerRef.current.getElement();
      const svgPath = el.querySelector('.hab-pin-svg path');
      if (svgPath) svgPath.setAttribute('fill', color);
      const ripple = el.querySelector('.hab-pin-ground-ripple') as HTMLElement | null;
      if (ripple) ripple.style.borderColor = color;
    }
  }, []);

  // Drop pin handler
  const handleDropPin = useCallback(async (lat: number, lng: number, prefilledName?: string, prefilledAddress?: string, overtureCategory?: string) => {
    setSelectedPlaceId(null);
    setIsSidebarOpen(true);

    if (draftMarkerRef.current) {
      draftMarkerRef.current.remove();
      draftMarkerRef.current = null;
    }

    const map = mapRef.current;
    if (!map) return;

    const accent = userAccentRef.current;
    const currentActiveCat = activeCategoryRef.current;
    const currentCats = categoriesRef.current;
    // If we have an Overture category hint, try to auto-match to user's categories
    const defaultCat = overtureCategory
      ? matchOvertureCategory(overtureCategory, currentCats)
      : (currentActiveCat !== 'all' ? currentActiveCat : (currentCats[0]?.name || ''));
    const matchedCat = currentCats.find((c) => c.name === defaultCat);
    const draftColor = matchedCat?.color || accent;

    const draftEl = createDraftMarkerElement(draftColor);
    const draftMarker = new maplibregl.Marker({ element: draftEl, anchor: 'bottom', draggable: true })
      .setLngLat([lng, lat])
      .setSubpixelPositioning(true)
      .addTo(map);

    draftMarkerRef.current = draftMarker;

    setIsSidebarOpen(true);
    setModalPlace({
      mode: 'create',
      lat,
      lng,
      name: prefilledName || '',
      category: defaultCat,
      color: draftColor,
      notes: '',
      address: prefilledAddress || '',
    });

    draftMarker.on('drag', () => {
      const pos = draftMarker.getLngLat();
      setModalPlace((prev) => (prev ? { ...prev, lat: pos.lat, lng: pos.lng } : null));
    });

    draftMarker.on('dragend', async () => {
      const pos = draftMarker.getLngLat();
      const geo = await reverseGeocode(pos.lat, pos.lng);
      setModalPlace((prev) =>
        prev
          ? {
              ...prev,
              lat: pos.lat,
              lng: pos.lng,
              name: prev.name || geo?.name || '',
              address: geo?.address || prev.address,
            }
          : null
      );
    });

    if (!prefilledAddress || !prefilledName) {
      const geo = await reverseGeocode(lat, lng);
      setModalPlace((prev) =>
        prev
          ? {
              ...prev,
              name: prev.name || geo?.name || '',
              address: prev.address || geo?.address || '',
            }
          : null
      );
    }
  }, []);

  handleDropPinRef.current = handleDropPin;

  // Move draft pin handler
  const moveDraftPin = useCallback(async (lat: number, lng: number) => {
    if (draftMarkerRef.current) {
      draftMarkerRef.current.setLngLat([lng, lat]);
    }
    setModalPlace((prev) => (prev ? { ...prev, lat, lng } : null));
    const geo = await reverseGeocode(lat, lng);
    setModalPlace((prev) =>
      prev
        ? {
            ...prev,
            lat,
            lng,
            name: prev.name || geo?.name || '',
            address: geo?.address || prev.address,
          }
        : null
    );
  }, []);

  moveDraftPinRef.current = moveDraftPin;

  // Live sync draft pin color when swatch changes
  useEffect(() => {
    if (draftMarkerRef.current && modalPlace?.color) {
      const el = draftMarkerRef.current.getElement();
      const path = el.querySelector('path');
      if (path) path.setAttribute('fill', modalPlace.color);
      const ripple = el.querySelector('.hab-pin-ground-ripple') as HTMLElement;
      if (ripple) ripple.style.borderColor = modalPlace.color;
    }
  }, [modalPlace?.color]);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (newCategoryModal) {
          setNewCategoryModal(false);
        } else if (modalPlace) {
          if (draftMarkerRef.current) {
            draftMarkerRef.current.remove();
            draftMarkerRef.current = null;
          }
          setModalPlace(null);
          setIsSidebarOpen(false);
        } else if (selectedPlaceId || placePopupRef.current) {
          setSelectedPlaceId(null);
          if (placePopupRef.current) {
            placePopupRef.current.remove();
            placePopupRef.current = null;
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [newCategoryModal, modalPlace, selectedPlaceId]);

  // Sync markers with places and category filter
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Filter places
    const visiblePlaces = places.filter((p) => {
      if (activeCategory !== 'all' && p.category !== activeCategory) return false;
      return true;
    });

    // Remove obsolete markers
    const currentIds = new Set(visiblePlaces.map((p) => p.id));
    for (const [id, marker] of markersRef.current.entries()) {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    // Add or update markers
    for (const p of visiblePlaces) {
      const cat = categories.find((c) => c.name === p.category);
      const isSelected = p.id === selectedPlaceId;
      const color = cat?.color || userAccent;

      if (markersRef.current.has(p.id)) {
        const marker = markersRef.current.get(p.id)!;
        marker.setLngLat([p.lng, p.lat]);
        const el = marker.getElement();
        el.classList.toggle('selected', isSelected);
        const label = el.querySelector('.hab-pin-label-text') || el.querySelector('.hab-map-pin-label');
        if (label) label.textContent = p.name;
        const dot = el.querySelector('.hab-pin-label-dot') as HTMLElement | null;
        if (dot) dot.style.background = color;
        const path = el.querySelector('path');
        if (path) path.setAttribute('fill', color);
      } else {
        const el = createPlaceMarkerElement(p, cat, isSelected);
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([p.lng, p.lat])
          .setSubpixelPositioning(true)
          .addTo(map);
        markersRef.current.set(p.id, marker);
      }
    }
  }, [places, categories, activeCategory, selectedPlaceId, userAccent]);


  // Filtered places list for the sidebar
  const filteredPlaces = useMemo(() => {
    return places.filter((p) => {
      if (activeCategory !== 'all' && p.category !== activeCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesCat = p.category.toLowerCase().includes(q);
        const matchesNotes = p.notes?.toLowerCase().includes(q);
        const matchesAddr = p.address?.toLowerCase().includes(q);
        if (!matchesName && !matchesCat && !matchesNotes && !matchesAddr) return false;
      }
      return true;
    });
  }, [places, activeCategory, searchQuery]);

  // Input change handler with debounce
  const handleGeoInputChange = (value: string) => {
    setGeoQuery(value);

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
      searchAbortRef.current = null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      setGeoResults([]);
      setShowGeoDropdown(false);
      setIsSearchingGeo(false);
      return;
    }

    setShowGeoDropdown(true);
    setIsSearchingGeo(true);

    searchDebounceRef.current = setTimeout(() => {
      executeGeoSearch(trimmed);
    }, 280);
  };

  // Execute geo search against Photon (Komoot OSM) with candidate normalization and Nominatim fallback
  const executeGeoSearch = async (query: string, selectFirst = false) => {
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    const abortCtrl = new AbortController();
    searchAbortRef.current = abortCtrl;
    setIsSearchingGeo(true);

    try {
      const center = mapRef.current?.getCenter();
      const biasParams = center ? `&lat=${center.lat.toFixed(5)}&lon=${center.lng.toFixed(5)}` : '';

      // Normalize candidate queries (e.g. "65B" -> "65") to match building nodes
      const normalizedQuery = query.replace(/\b(\d+)[a-zA-Z]\b/g, '$1').trim();
      const candidateQueries = [query];
      if (normalizedQuery && normalizedQuery !== query) {
        candidateQueries.push(normalizedQuery);
      }

      const fetchCandidate = async (q: string) => {
        try {
          const res = await fetch(
            `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}${biasParams}&limit=6`,
            {
              headers: { Accept: 'application/json' },
              signal: abortCtrl.signal,
            }
          );
          if (!res.ok) return [];
          const data = await res.json();
          return ((data?.features as any[]) || []).map((f) => formatPhotonFeature(f, query));
        } catch {
          return [];
        }
      };

      const candidateResults = (await Promise.all(candidateQueries.map(fetchCandidate))).flat();

      let results: GeoSearchResult[] = [];

      if (candidateResults.length > 0) {
        // Deduplicate nearby or identical coordinates
        const seen = new Set<string>();
        for (const item of candidateResults) {
          const key = `${Math.round(item.lat * 10000)}_${Math.round(item.lng * 10000)}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push(item);
          }
        }

        // Rank: Exact address/building matches first, then POIs (hotels, restaurants), then streets
        results.sort((a, b) => {
          const scoreA = (a.isHouse ? 4 : 0) + (a.isPoi ? 3 : 0) + (a.tag === 'Street' ? 1 : 0);
          const scoreB = (b.isHouse ? 4 : 0) + (b.isPoi ? 3 : 0) + (b.tag === 'Street' ? 1 : 0);
          return scoreB - scoreA;
        });

        results = results.slice(0, 7);
      }

      // Fallback to Nominatim if Photon returned no results
      if (results.length === 0 && !abortCtrl.signal.aborted) {
        try {
          const nomRes = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`,
            {
              headers: { Accept: 'application/json' },
              signal: abortCtrl.signal,
            }
          );
          if (nomRes.ok) {
            const nomData = await nomRes.json();
            if (Array.isArray(nomData)) {
              results = nomData.map(formatNominatimItem);
            }
          }
        } catch {}
      }

      if (!abortCtrl.signal.aborted) {
        setGeoResults(results);
        setShowGeoDropdown(true);

        if (selectFirst && results.length > 0) {
          handleSelectGeoResult(results[0]);
        }
      }
    } catch {
      if (!abortCtrl.signal.aborted) {
        setGeoResults([]);
      }
    } finally {
      if (!abortCtrl.signal.aborted) {
        setIsSearchingGeo(false);
      }
    }
  };

  // Fly to geocoded search result and prefill venue name / address
  const handleSelectGeoResult = (item: GeoSearchResult) => {
    setShowGeoDropdown(false);
    setGeoQuery(item.name);
    mapRef.current?.flyTo({ center: [item.lng, item.lat], zoom: 17.5, duration: 1400 });
    handleDropPin(item.lat, item.lng, item.name, item.address, item.category);
  };

  // Helper to obtain location coordinates from hardware CoreLocation, browser GPS, or fast IP fallback
  const fetchCurrentLocation = useCallback(async (): Promise<{ lat: number; lng: number; label?: string } | null> => {
    let ipFallbackLoc: { lat: number; lng: number; label?: string } | null = null;

    // 1. In Habitat Electron app, backend native CoreLocation helper gives exact GPS/Wi-Fi fix
    if (typeof window !== 'undefined' && window.habitat && api.study?.currentLocation) {
      try {
        const loc = await api.study.currentLocation();
        if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
          const locStr = [loc.city, loc.country].filter(Boolean).join(', ');
          const locObj = {
            lat: loc.lat,
            lng: loc.lng,
            label: locStr ? `Your Location (${locStr})` : 'Your Location',
          };
          if (loc.isHardware) {
            return locObj;
          }
          // Store IP-based result as fallback in case native hardware wasn't available
          ipFallbackLoc = locObj;
        }
      } catch (e) {
        console.warn('IPC geolocation error:', e);
      }
    }

    // 2. Try browser / Chromium geolocation with high accuracy (Wi-Fi / CoreLocation via Webkit/Blink)
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 4000,
            maximumAge: 60000,
          });
        });
        if (pos?.coords) {
          return {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            label: 'Your Location (GPS)',
          };
        }
      } catch {
        // Fallback below
      }
    }

    if (ipFallbackLoc) {
      return ipFallbackLoc;
    }

    // 3. Direct fetch fallback for web browser or dev mode
    try {
      const res = await fetch('https://ipwho.is/', { signal: AbortSignal.timeout(3500) });
      const d = await res.json();
      if (d && d.success && typeof d.latitude === 'number' && typeof d.longitude === 'number') {
        const locStr = [d.city, d.country].filter(Boolean).join(', ');
        return {
          lat: d.latitude,
          lng: d.longitude,
          label: locStr ? `Your Location (${locStr})` : 'Your Location',
        };
      }
    } catch {}

    return null;
  }, []);

  // Update or create the pulsing user location dot on map
  const updateUserLocationMarker = useCallback((lat: number, lng: number, label?: string) => {
    const map = mapRef.current;
    if (!map) return;

    if (userLocMarkerRef.current) {
      userLocMarkerRef.current.setLngLat([lng, lat]);
      const popup = userLocMarkerRef.current.getPopup();
      if (popup) {
        popup.setHTML(`<div class="hab-user-loc-popup"><strong>${label || 'Your Location'}</strong></div>`);
      }
    } else {
      const el = document.createElement('div');
      el.className = 'hab-map-user-loc';
      el.title = label || 'Your Location';
      el.innerHTML = '<div class="hab-map-user-pulse"></div><div class="hab-map-user-dot"></div>';

      const popup = new maplibregl.Popup({ offset: 12, closeButton: false, className: 'hab-user-loc-popup-wrap' })
        .setHTML(`<div class="hab-user-loc-popup"><strong>${label || 'Your Location'}</strong></div>`);

      const m = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .setSubpixelPositioning(true)
        .setPopup(popup)
        .addTo(map);

      userLocMarkerRef.current = m;
      setUserLocMarker(m);
    }
  }, []);

  // "Find My Location" handler
  const handleLocateMe = useCallback(async (fly = true) => {
    setIsLocating(true);
    try {
      const loc = await fetchCurrentLocation();
      if (!loc) {
        if (fly) {
          alert('Could not determine your location. Please check your internet connection.');
        }
        return;
      }

      updateUserLocationMarker(loc.lat, loc.lng, loc.label);

      if (fly && mapRef.current) {
        mapRef.current.flyTo({ center: [loc.lng, loc.lat], zoom: 17, duration: 1500, essential: true });
        localStorage.setItem(
          'habitat:study-map:viewport',
          JSON.stringify({ center: [loc.lng, loc.lat], zoom: 17 })
        );
      }
    } catch (e) {
      console.warn('Locate error:', e);
    } finally {
      setIsLocating(false);
    }
  }, [fetchCurrentLocation, updateUserLocationMarker]);

  handleLocateMeRef.current = handleLocateMe;

  // Snap the draft pin to the user's current location while editing/saving
  const handleSnapToCurrentLocation = async () => {
    setIsLocating(true);
    try {
      const loc = await fetchCurrentLocation();
      if (!loc) {
        alert('Could not determine your location.');
        return;
      }
      updateUserLocationMarker(loc.lat, loc.lng, loc.label);
      mapRef.current?.flyTo({ center: [loc.lng, loc.lat], zoom: 18, duration: 1200 });

      if (modalPlaceRef.current?.mode === 'create') {
        moveDraftPinRef.current?.(loc.lat, loc.lng);
      } else if (modalPlaceRef.current) {
        const geoInfo = await reverseGeocode(loc.lat, loc.lng);
        setModalPlace((prev) =>
          prev
            ? {
                ...prev,
                lat: loc.lat,
                lng: loc.lng,
                address: geoInfo?.address || prev.address,
              }
            : null
        );
        if (draftMarkerRef.current) {
          draftMarkerRef.current.setLngLat([loc.lng, loc.lat]);
        }
      }
    } finally {
      setIsLocating(false);
    }
  };

  // Save place
  const handleSavePlace = async () => {
    if (!modalPlace) return;
    if (!modalPlace.name.trim()) return;

    const selectedCat = categories.find((c) => c.name === modalPlace.category);
    const pinColor = selectedCat?.color || userAccent;

    try {
      if (modalPlace.mode === 'create') {
        const created = await api.study.placeCreate({
          name: modalPlace.name.trim(),
          category: modalPlace.category,
          color: pinColor,
          lat: modalPlace.lat,
          lng: modalPlace.lng,
          notes: modalPlace.notes.trim(),
          address: modalPlace.address.trim(),
        });
        await loadData();
        setSelectedPlaceId(null);
        setIsSidebarOpen(false);
        mapRef.current?.flyTo({ center: [created.lng, created.lat], zoom: 17, duration: 800 });
      } else if (modalPlace.mode === 'edit' && modalPlace.place) {
        await api.study.placePatch(modalPlace.place.id, {
          name: modalPlace.name.trim(),
          category: modalPlace.category,
          color: pinColor,
          notes: modalPlace.notes.trim(),
          address: modalPlace.address.trim(),
        });
        await loadData();
        setSelectedPlaceId(null);
        setIsSidebarOpen(false);
      }
    } catch (e: any) {
      console.error('Failed to save place:', e);
      alert(e?.message || 'Failed to save place');
    } finally {
      if (draftMarkerRef.current) {
        draftMarkerRef.current.remove();
        draftMarkerRef.current = null;
      }
      setModalPlace(null);
    }
  };

  // Delete place
  const handleDeletePlace = async (id: string, name: string) => {
    if (placePopupRef.current) {
      placePopupRef.current.remove();
      placePopupRef.current = null;
    }
    if (!(await ask(`Delete “${name}”?`))) return;
    try {
      await api.study.placeDelete(id);
      if (selectedPlaceId === id) setSelectedPlaceId(null);
      await loadData();
    } catch (e) {
      console.error('Failed to delete place:', e);
    }
  };

  // Show anchored place detail popup directly over the map pin
  const showPlacePopup = useCallback((p: StudyPlace) => {
    if (placePopupRef.current) {
      placePopupRef.current.remove();
      placePopupRef.current = null;
    }
    const map = mapRef.current;
    if (!map) return;

    const cat = categoriesRef.current.find((c) => c.name === p.category);
    const color = cat?.color || userAccentRef.current;

    const popupDiv = document.createElement('div');
    popupDiv.className = 'hab-place-popup';

    popupDiv.innerHTML = `
      <div class="hab-place-popup-head">
        <div class="hab-place-popup-title-row">
          ${p.category ? `<span class="hab-place-popup-cat" style="background:${color}20; color:${color}; border:1px solid ${color}40;">${escapeHtml(p.category)}</span>` : ''}
          <h4 class="hab-place-popup-name">${escapeHtml(p.name)}</h4>
        </div>
      </div>
      ${p.address ? `<div class="hab-place-popup-addr">${escapeHtml(p.address)}</div>` : ''}
      ${p.notes ? `<div class="hab-place-popup-notes">${escapeHtml(p.notes)}</div>` : ''}
      <div class="hab-place-popup-actions">
        <button type="button" class="btn subtle small hab-btn-dir">Directions</button>
        <button type="button" class="btn subtle small hab-btn-edit">Edit</button>
        <button type="button" class="btn subtle small danger hab-btn-del">Delete</button>
      </div>
    `;

    popupDiv.querySelector('.hab-btn-dir')?.addEventListener('click', () => {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`, '_blank');
    });

    popupDiv.querySelector('.hab-btn-edit')?.addEventListener('click', () => {
      if (placePopupRef.current) {
        placePopupRef.current.remove();
        placePopupRef.current = null;
      }
      setIsSidebarOpen(true);
      setModalPlace({
        mode: 'edit',
        place: p,
        lat: p.lat,
        lng: p.lng,
        name: p.name,
        category: p.category,
        color: cat?.color || userAccentRef.current,
        notes: p.notes || '',
        address: p.address || '',
      });
    });

    popupDiv.querySelector('.hab-btn-del')?.addEventListener('click', () => {
      if (placePopupRef.current) {
        placePopupRef.current.remove();
        placePopupRef.current = null;
      }
      handleDeletePlace(p.id, p.name);
    });

    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      className: 'hab-place-popup-wrap',
      offset: [0, -38],
    })
      .setLngLat([p.lng, p.lat])
      .setDOMContent(popupDiv)
      .addTo(map);

    placePopupRef.current = popup;
  }, []);

  showPlacePopupRef.current = showPlacePopup;

  // Add pin directly at the center of the current map view
  const handleAddPinAtCenter = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    handleDropPin(c.lat, c.lng);
  }, [handleDropPin]);

  // Category management handlers
  const openCreateCategory = () => {
    setEditingCategory(null);
    setNewCatName('');
    setNewCatIcon('pin');
    setNewCatColor(PRESET_COLORS[categories.length % PRESET_COLORS.length] || '#3b82f6');
    setNewCategoryModal(true);
  };

  const openEditCategory = (c: StudyCategory) => {
    setEditingCategory(c);
    setNewCatName(c.name);
    setNewCatIcon(c.icon || 'pin');
    setNewCatColor(c.color || '#3b82f6');
    setNewCategoryModal(true);
  };

  const handleSaveCategory = async () => {
    if (!newCatName.trim()) return;
    try {
      if (editingCategory) {
        const updated = await api.study.categoryPatch(editingCategory.id, {
          name: newCatName.trim(),
          icon: newCatIcon,
          color: newCatColor,
        });
        await loadData();
        if (activeCategory === editingCategory.name) {
          setActiveCategory(updated.name);
        }
        const resolvedColor = updated.color || userAccent;
        if (modalPlace && modalPlace.category === editingCategory.name) {
          setModalPlace((curr) => (curr ? { ...curr, category: updated.name, color: resolvedColor } : null));
          updateDraftMarkerColor(resolvedColor);
        }
      } else {
        const cat = await api.study.categoryCreate({
          name: newCatName.trim(),
          icon: newCatIcon,
          color: newCatColor,
        });
        await loadData();
        setActiveCategory(cat.name);
        const resolvedColor = cat.color || userAccent;
        if (modalPlace) {
          setModalPlace((curr) => (curr ? { ...curr, category: cat.name, color: resolvedColor } : null));
          updateDraftMarkerColor(resolvedColor);
        }
      }
      setNewCategoryModal(false);
      setEditingCategory(null);
      setNewCatName('');
    } catch (e: any) {
      console.error('Failed to save category:', e);
      alert(e?.message || 'Failed to save category');
    }
  };

  const handleSelectPlaceCategory = (catName: string) => {
    if (!modalPlace) return;
    const cat = categories.find((c) => c.name === catName);
    const color = cat?.color || userAccent;
    setModalPlace({
      ...modalPlace,
      category: catName,
      color,
    });
    updateDraftMarkerColor(color);
  };

  // Delete category
  const handleDeleteCategory = async (cat: StudyCategory) => {
    if (!(await ask(`Delete category “${cat.name}”?`))) return;
    try {
      await api.study.categoryDelete(cat.id);
      if (activeCategory === cat.name) setActiveCategory('all');
      await loadData();
    } catch (e) {
      console.error('Failed to delete category:', e);
    }
  };

  // Export places as JSON
  const handleExport = () => {
    const data = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      places,
      categories,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `places-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="hab-map-view">
      {/* Top Header / Bar */}
      <div className="hab-map-top-bar">
        {/* Left: Title & place count */}
        <div className="hab-map-bar-left">
          <span className="hab-map-title">
            <Icon name="map" size={16} />
            <span className="hab-title-label">Map</span>
          </span>
          <button
            type="button"
            className={`hab-map-place-count ${isSidebarOpen ? 'active' : ''}`}
            onClick={() => setIsSidebarOpen((v) => !v)}
            title={isSidebarOpen ? 'Hide saved places' : 'Show saved places'}
          >
            <span className="hab-place-count-num">{places.length}</span>
            <span className="hab-place-count-text"> places</span>
          </button>
        </div>

        {/* Center: Search places / addresses */}
        <div className="hab-map-search-box" ref={searchBoxRef}>
          <Icon name="search" size={14} className="hab-map-search-icon" />
          <input
            type="text"
            placeholder="Search hotels, places, streets, addresses…"
            value={geoQuery}
            onChange={(e) => handleGeoInputChange(e.target.value)}
            onFocus={() => {
              if (geoQuery.trim()) {
                setShowGeoDropdown(true);
                if (geoResults.length === 0 && !isSearchingGeo) {
                  executeGeoSearch(geoQuery.trim());
                }
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (geoResults.length > 0) {
                  handleSelectGeoResult(geoResults[0]);
                } else if (geoQuery.trim()) {
                  if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                  executeGeoSearch(geoQuery.trim(), true);
                }
              } else if (e.key === 'Escape') {
                setShowGeoDropdown(false);
              }
            }}
          />
          {isSearchingGeo && <span className="hab-search-spinner" />}
          {geoQuery && (
            <button
              type="button"
              className="icon-btn subtle hab-search-clear"
              onClick={() => {
                setGeoQuery('');
                setGeoResults([]);
                setShowGeoDropdown(false);
                if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                if (searchAbortRef.current) searchAbortRef.current.abort();
              }}
              title="Clear search"
            >
              <Icon name="x" size={12} />
            </button>
          )}

          {/* Autocomplete dropdown */}
          {showGeoDropdown && (geoResults.length > 0 || isSearchingGeo || geoQuery.trim()) && (
            <div className="hab-map-geo-dropdown popover">
              {geoResults.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="hab-map-geo-item"
                  onClick={() => handleSelectGeoResult(r)}
                >
                  <div className="hab-map-geo-icon-box">
                    <Icon name={r.icon || 'map-pin'} size={15} />
                  </div>
                  <div className="hab-map-geo-text">
                    <div className="hab-map-geo-title-row">
                      <strong className="hab-map-geo-name">{r.name}</strong>
                      {r.tag && <span className={`hab-geo-tag hab-geo-tag-${r.tag.toLowerCase()}`}>{r.tag}</span>}
                    </div>
                    {r.address && <small className="hab-map-geo-addr">{r.address}</small>}
                  </div>
                </button>
              ))}
              {geoResults.length === 0 && isSearchingGeo && (
                <div className="hab-map-geo-status">
                  <span className="hab-search-spinner" style={{ position: 'static' }} />
                  <span>Searching places &amp; addresses…</span>
                </div>
              )}
              {geoResults.length === 0 && !isSearchingGeo && geoQuery.trim() && (
                <div className="hab-map-geo-status">
                  <span>No places found for “{geoQuery}”</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Actions */}
        <div className="hab-map-bar-right">
          <button
            className="btn primary hab-map-add-btn"
            onClick={handleAddPinAtCenter}
            title="Drop a pin at the center of the current map view"
          >
            <Icon name="plus" size={14} />
            <span className="hab-btn-label">Add Place</span>
          </button>

          <div style={{ position: 'relative' }}>
            <button
              className={`btn ${showStyleMenu ? 'active' : 'subtle'} icon-only`}
              onClick={() => setShowStyleMenu((v) => !v)}
              title="Map Views & Layers"
              aria-label="Map Views & Layers"
            >
              <Icon name="layers" size={15} />
            </button>
            {showStyleMenu && (
              <>
                <div className="backdrop transparent" onClick={() => setShowStyleMenu(false)} />
                <div className="popover hab-map-style-menu">
                  <div className="hab-style-menu-header">
                    <span>Map View &amp; Layers</span>
                  </div>

                  <div className="hab-style-menu-list">
                    <button
                      type="button"
                      className={`hab-style-card ${mapStyleKey === 'auto' ? 'active' : ''}`}
                      onClick={() => handleSelectStyle('auto')}
                    >
                      <div className="hab-style-icon-box">
                        <Icon name="sparkles" size={15} />
                      </div>
                      <div className="hab-style-info">
                        <div className="hab-style-name">Auto Theme</div>
                        <div className="hab-style-desc">Matches {theme} appearance</div>
                      </div>
                      {mapStyleKey === 'auto' && (
                        <div className="hab-style-check">
                          <Icon name="check" size={12} />
                        </div>
                      )}
                    </button>

                    <button
                      type="button"
                      className={`hab-style-card ${mapStyleKey === 'satellite' ? 'active' : ''}`}
                      onClick={() => handleSelectStyle('satellite')}
                    >
                      <div className="hab-style-icon-box">
                        <Icon name="globe" size={15} />
                      </div>
                      <div className="hab-style-info">
                        <div className="hab-style-name">Satellite</div>
                        <div className="hab-style-desc">Aerial imagery with places &amp; streets</div>
                      </div>
                      {mapStyleKey === 'satellite' && (
                        <div className="hab-style-check">
                          <Icon name="check" size={12} />
                        </div>
                      )}
                    </button>

                    <button
                      type="button"
                      className={`hab-style-card ${mapStyleKey === 'dark' ? 'active' : ''}`}
                      onClick={() => handleSelectStyle('dark')}
                    >
                      <div className="hab-style-icon-box">
                        <Icon name="moon" size={15} />
                      </div>
                      <div className="hab-style-info">
                        <div className="hab-style-name">Dark Matter</div>
                        <div className="hab-style-desc">High-contrast night vector view</div>
                      </div>
                      {mapStyleKey === 'dark' && (
                        <div className="hab-style-check">
                          <Icon name="check" size={12} />
                        </div>
                      )}
                    </button>

                    <button
                      type="button"
                      className={`hab-style-card ${mapStyleKey === 'light' ? 'active' : ''}`}
                      onClick={() => handleSelectStyle('light')}
                    >
                      <div className="hab-style-icon-box">
                        <Icon name="sun" size={15} />
                      </div>
                      <div className="hab-style-info">
                        <div className="hab-style-name">Positron (Light)</div>
                        <div className="hab-style-desc">Clean daylight minimalist map</div>
                      </div>
                      {mapStyleKey === 'light' && (
                        <div className="hab-style-check">
                          <Icon name="check" size={12} />
                        </div>
                      )}
                    </button>

                    <button
                      type="button"
                      className={`hab-style-card ${mapStyleKey === 'voyager' ? 'active' : ''}`}
                      onClick={() => handleSelectStyle('voyager')}
                    >
                      <div className="hab-style-icon-box">
                        <Icon name="compass" size={15} />
                      </div>
                      <div className="hab-style-info">
                        <div className="hab-style-name">Voyager</div>
                        <div className="hab-style-desc">Detailed streets &amp; buildings</div>
                      </div>
                      {mapStyleKey === 'voyager' && (
                        <div className="hab-style-check">
                          <Icon name="check" size={12} />
                        </div>
                      )}
                    </button>
                  </div>

                  <div className="hab-style-menu-divider" />

                  {mapStyleKey === 'satellite' && (
                    <>
                      <div
                        className="hab-poi-toggle-row"
                        onClick={() => setShowPoi((v) => !v)}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="hab-poi-toggle-label">
                          <div className="hab-style-icon-box">
                            <Icon name="building" size={13} />
                          </div>
                          <div className="hab-poi-toggle-info">
                            <span className="hab-poi-toggle-name">Nearby Places</span>
                            <span className="hab-poi-toggle-desc">Show clickable businesses &amp; POIs</span>
                          </div>
                        </div>
                        <div className={`hab-poi-switch ${showPoi ? 'on' : ''}`} />
                      </div>
                      <div className="hab-style-menu-divider" />
                    </>
                  )}

                  <button
                    type="button"
                    className="hab-style-action-btn"
                    onClick={() => {
                      handleExport();
                      setShowStyleMenu(false);
                    }}
                  >
                    <Icon name="copy" size={14} />
                    <span>Export Saved Places (JSON)</span>
                  </button>
                </div>
              </>
            )}
          </div>
          <SplitControls />
        </div>
      </div>

      {/* Categories Filter Strip */}
      <div className="hab-map-cats-strip">
        <button
          type="button"
          className={`hab-cat-chip ${activeCategory === 'all' ? 'active' : ''}`}
          onClick={() => {
            if (activeCategory === 'all') {
              setIsSidebarOpen((v) => !v);
            } else {
              setActiveCategory('all');
              setIsSidebarOpen(true);
            }
          }}
          title={isSidebarOpen && activeCategory === 'all' ? 'Hide saved places' : 'Show all saved places'}
          style={activeCategory === 'all' ? { backgroundColor: userAccent, color: '#ffffff' } : undefined}
        >
          <Icon name="map" size={13} />
          <span>All Places</span>
          <span className="hab-cat-badge">{places.length}</span>
        </button>

        {categories.map((c) => {
          const count = places.filter((p) => p.category === c.name).length;
          const isActive = activeCategory === c.name;
          const bg = c.color || userAccent;
          return (
            <div
              key={c.id || c.name}
              className={`hab-cat-chip ${isActive ? 'active' : ''}`}
              style={isActive ? { backgroundColor: bg, color: '#ffffff' } : undefined}
            >
              <span
                className="hab-cat-chip-label"
                onClick={() => {
                  setActiveCategory(c.name);
                  setIsSidebarOpen(true);
                }}
              >
                {!isActive && <span className="hab-cat-color-dot" style={{ backgroundColor: bg }} />}
                <TypeIcon icon={c.icon} size={13} />
                <span>{c.name}</span>
                <span className="hab-cat-badge">{count}</span>
              </span>
              <button
                type="button"
                className="hab-cat-edit-btn"
                title={`Edit category “${c.name}” (change color, icon)`}
                aria-label={`Edit category ${c.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  openEditCategory(c);
                }}
              >
                <Icon name="pencil" size={9} />
              </button>
              <button
                type="button"
                className="hab-cat-del-btn"
                title={`Delete category “${c.name}”`}
                aria-label={`Delete category ${c.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteCategory(c);
                }}
              >
                <Icon name="x" size={10} />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          className="hab-cat-chip add-btn"
          onClick={openCreateCategory}
          title="Add Custom Category"
        >
          <Icon name="plus" size={13} />
          <span>Category</span>
        </button>
      </div>

      {/* Main Content Area: Sidebar + Map */}
      <div className="hab-map-main-row">
        {/* Left Drawer / Sidebar */}
        <AnimatePresence initial={false}>
          {isSidebarOpen && (
            <motion.div
              className="hab-map-sidebar"
              initial={{ x: -320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -320, opacity: 0 }}
              transition={spring}
            >
              <div className="hab-sidebar-inner">
                {modalPlace ? (
                <div className="hab-sidebar-form">
                  <div className="hab-form-head">
                    <div className="hab-form-title-row">
                      <span className="hab-form-badge" style={{ backgroundColor: modalPlace.color || userAccent }}>
                        <Icon name="pin" size={14} />
                      </span>
                      <h3>{modalPlace.mode === 'create' ? 'Save New Place' : 'Edit Place'}</h3>
                    </div>
                    <button
                      className="icon-btn subtle"
                      title="Cancel"
                      onClick={() => {
                        if (draftMarkerRef.current) {
                          draftMarkerRef.current.remove();
                          draftMarkerRef.current = null;
                        }
                        setModalPlace(null);
                        setIsSidebarOpen(false);
                      }}
                    >
                      <Icon name="x" size={15} />
                    </button>
                  </div>

                  <div className="hab-form-scrollable">
                    <div className="hab-form-group">
                      <label className="hab-form-label">Place / Building Name</label>
                      <input
                        type="text"
                        className="hab-input"
                        placeholder="e.g. Science Library, 4th Floor Room 402…"
                        value={modalPlace.name}
                        autoFocus
                        onChange={(e) => setModalPlace({ ...modalPlace, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && modalPlace.name.trim()) handleSavePlace();
                        }}
                      />
                    </div>

                    <div className="hab-form-group">
                      <div className="hab-form-label-row">
                        <label className="hab-form-label">Category</label>
                        <button
                          type="button"
                          className="hab-link-btn"
                          onClick={openCreateCategory}
                        >
                          <Icon name="plus" size={11} /> New Category
                        </button>
                      </div>
                      {categories.length === 0 ? (
                        <div className="hab-cat-empty-notice">
                          <span>No custom categories yet.</span>
                          <button
                            type="button"
                            className="btn subtle small"
                            onClick={openCreateCategory}
                          >
                            <Icon name="plus" size={12} /> Add
                          </button>
                        </div>
                      ) : (
                        <div className="hab-cat-select-strip">
                          <button
                            type="button"
                            className={`hab-cat-select-chip ${!modalPlace.category ? 'selected' : ''}`}
                            onClick={() => handleSelectPlaceCategory('')}
                          >
                            <span className="hab-cat-color-dot" style={{ backgroundColor: userAccent }} />
                            <span>None</span>
                          </button>
                          {categories.map((c) => (
                            <button
                              key={c.name}
                              type="button"
                              className={`hab-cat-select-chip ${modalPlace.category === c.name ? 'selected' : ''}`}
                              style={
                                modalPlace.category === c.name
                                  ? { backgroundColor: c.color || userAccent, color: '#ffffff' }
                                  : undefined
                              }
                              onClick={() => handleSelectPlaceCategory(c.name)}
                            >
                              <span
                                className="hab-cat-color-dot"
                                style={{
                                  backgroundColor: modalPlace.category === c.name ? '#ffffff' : (c.color || userAccent),
                                }}
                              />
                              <TypeIcon icon={c.icon} size={12} />
                              <span>{c.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="hab-form-group">
                      <label className="hab-form-label">Notes &amp; Details (Optional)</label>
                      <textarea
                        className="hab-textarea"
                        placeholder="e.g. Best entrance on the west side, parking tips, quietest hours…"
                        rows={3}
                        value={modalPlace.notes}
                        onChange={(e) => setModalPlace({ ...modalPlace, notes: e.target.value })}
                      />
                    </div>

                    <div className="hab-form-loc-card">
                      <div className="hab-form-loc-top">
                        <Icon name="map-pin" size={13} />
                        <span className="hab-loc-coords">
                          {modalPlace.lat.toFixed(5)}, {modalPlace.lng.toFixed(5)}
                        </span>
                        <button
                          type="button"
                          className="icon-btn subtle tiny"
                          title="Copy coordinates"
                          onClick={() => {
                            navigator.clipboard.writeText(`${modalPlace.lat}, ${modalPlace.lng}`);
                          }}
                        >
                          <Icon name="copy" size={11} />
                        </button>
                        <button
                          type="button"
                          className="hab-loc-snap-btn"
                          title="Snap pin to your current location"
                          onClick={handleSnapToCurrentLocation}
                          disabled={isLocating}
                        >
                          <Icon name="target" size={11} className={isLocating ? 'spin-icon' : ''} />
                          <span>My Location</span>
                        </button>
                      </div>
                      {modalPlace.address && (
                        <div className="hab-form-loc-addr">{modalPlace.address}</div>
                      )}
                      {modalPlace.mode === 'create' && (
                        <div className="hab-form-loc-drag-tip">
                          <Icon name="compass" size={12} />
                          <span>Drag pin on map to adjust exact spot</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="hab-form-foot">
                    {modalPlace.mode === 'edit' && modalPlace.place && (
                      <button
                        type="button"
                        className="btn subtle small danger"
                        onClick={() => {
                          const p = modalPlace.place!;
                          setModalPlace(null);
                          handleDeletePlace(p.id, p.name);
                        }}
                      >
                        <Icon name="trash" size={13} /> Delete
                      </button>
                    )}
                    <div className="hab-form-foot-right">
                      <button
                        type="button"
                        className="btn subtle small"
                        onClick={() => {
                          if (draftMarkerRef.current) {
                            draftMarkerRef.current.remove();
                            draftMarkerRef.current = null;
                          }
                          setModalPlace(null);
                          setIsSidebarOpen(false);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn primary small"
                        onClick={handleSavePlace}
                        disabled={!modalPlace.name.trim()}
                      >
                        <Icon name="check" size={13} />
                        <span>{modalPlace.mode === 'create' ? 'Save Place' : 'Save Changes'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="hab-sidebar-head">
                    <div className="hab-sidebar-title-row">
                      <div className="hab-sidebar-title">
                        <Icon name="bookmark" size={14} />
                        <span>Saved Places</span>
                        <span className="hab-cat-badge">{places.length}</span>
                      </div>
                      <div className="hab-sidebar-title-actions">
                        <button
                          type="button"
                          className="icon-btn subtle hab-sidebar-collapse-btn"
                          onClick={() => setIsSidebarOpen(false)}
                          title="Hide sidebar (Full map view)"
                          aria-label="Hide sidebar"
                        >
                          <Icon name="panel-close" size={15} />
                        </button>
                      </div>
                    </div>
                    <div className="hab-sidebar-search">
                      <Icon name="filter" size={13} />
                      <input
                        type="text"
                        placeholder="Filter saved places…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                      {searchQuery && (
                        <button className="icon-btn subtle" onClick={() => setSearchQuery('')}>
                          <Icon name="x" size={11} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="hab-sidebar-list">
                    {filteredPlaces.length === 0 ? (
                      <div className="hab-sidebar-empty">
                        <Icon name="pin" size={24} />
                        <p>No places found</p>
                        <small>Click on the map or “Add Place” to mark your first location.</small>
                      </div>
                    ) : (
                      filteredPlaces.map((p) => {
                        const isSelected = p.id === selectedPlaceId;
                        const cat = categories.find((c) => c.name === p.category);
                        const tint = p.color || cat?.color || userAccent;
                        return (
                          <div
                            key={p.id}
                            className={`hab-sidebar-item ${isSelected ? 'selected' : ''}`}
                            onClick={() => {
                              setSelectedPlaceId(p.id);
                              mapRef.current?.flyTo({ center: [p.lng, p.lat], zoom: 17, duration: 800 });
                              showPlacePopup(p);
                            }}
                          >
                            <span className="hab-item-color-bar" style={{ background: tint }} />
                            <div className="hab-item-content">
                              <div className="hab-item-header">
                                <span className="hab-item-name">{p.name}</span>
                                {p.category ? (
                                  <span className="hab-item-cat-tag" style={{ color: tint, borderColor: tint }}>
                                    {p.category}
                                  </span>
                                ) : null}
                              </div>
                              {p.address && <div className="hab-item-sub">{p.address.split(',')[0]}</div>}
                              {p.notes && <div className="hab-item-notes">{p.notes}</div>}
                            </div>
                            <div className="hab-item-actions">
                              <button
                                className="icon-btn subtle"
                                title="Edit"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setModalPlace({
                                    mode: 'edit',
                                    place: p,
                                    lat: p.lat,
                                    lng: p.lng,
                                    name: p.name,
                                    category: p.category,
                                    color: cat?.color || userAccent,
                                    notes: p.notes || '',
                                    address: p.address || '',
                                  });
                                }}
                              >
                                <Icon name="settings" size={13} />
                              </button>
                              <button
                                className="icon-btn subtle danger"
                                title="Delete"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeletePlace(p.id, p.name);
                                }}
                              >
                                <Icon name="trash" size={13} />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Map Canvas Container */}
        <div className="hab-map-canvas-wrap">
          <div ref={mapContainerRef} className="hab-map-container" />

          {/* Floating Expand Sidebar Button when sidebar is collapsed */}
          {!isSidebarOpen && (
            <button
              type="button"
              className="hab-map-expand-pill"
              onClick={() => setIsSidebarOpen(true)}
              title="Show saved places sidebar"
              aria-label="Show saved places sidebar"
            >
              <Icon name="panel-open" size={14} />
              <span>Saved Places</span>
              <span className="hab-cat-badge">{places.length}</span>
            </button>
          )}

          {/* Floating Map Controls */}
          <div className="hab-map-floating-controls">
            <button
              className={`hab-float-btn ${isLocating ? 'locating' : ''}`}
              onClick={() => handleLocateMe(true)}
              title="Go to Current Location"
              aria-label="Current Location"
              disabled={isLocating}
            >
              <Icon name="target" size={15} className={isLocating ? 'spin-icon' : ''} />
            </button>
            <button
              className="hab-float-btn"
              onClick={() => mapRef.current?.zoomIn({ duration: 300 })}
              title="Zoom In"
              aria-label="Zoom In"
            >
              <Icon name="plus" size={14} />
            </button>
            <button
              className="hab-float-btn"
              onClick={() => mapRef.current?.zoomOut({ duration: 300 })}
              title="Zoom Out"
              aria-label="Zoom Out"
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>−</span>
            </button>
          </div>
        </div>
      </div>

      {/* Modal: Add / Edit Custom Category */}
      <AnimatePresence>
        {newCategoryModal && (
          <>
            <motion.div
              className="backdrop dim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setNewCategoryModal(false);
                setEditingCategory(null);
              }}
            />
            <div className="modal-layer">
              <motion.div
                className="modal hab-category-modal"
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={spring}
              >
                <h2>{editingCategory ? 'Edit Category' : 'New Category'}</h2>
                <p className="subtle" style={{ margin: '4px 0 16px', fontSize: '12px' }}>
                  {editingCategory
                    ? 'Update category color and icon. All pins in this category will inherit the new color.'
                    : 'Create a custom category to group your places. All pins in this category will share its color.'}
                </p>

                <div className="hab-form-group" style={{ marginBottom: 14 }}>
                  <label className="hab-form-label">Category Name</label>
                  <input
                    type="text"
                    className="hab-input"
                    placeholder="e.g. Restaurants, Shops, Home, Work…"
                    value={newCatName}
                    autoFocus
                    onChange={(e) => setNewCatName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveCategory();
                    }}
                  />
                </div>

                <div className="hab-form-group" style={{ marginBottom: 14 }}>
                  <label className="hab-form-label">Icon</label>
                  <div className="hab-icon-picker-grid">
                    {CATEGORY_ICONS.map((ic) => (
                      <button
                        key={ic}
                        type="button"
                        className={`hab-icon-choice ${newCatIcon === ic ? 'selected' : ''}`}
                        onClick={() => setNewCatIcon(ic)}
                      >
                        <TypeIcon icon={ic} size={16} />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="hab-form-group" style={{ marginBottom: 18 }}>
                  <label className="hab-form-label">Category Color (Inherited by pins)</label>
                  <div className="hab-color-swatches">
                    {PRESET_COLORS.map((col) => (
                      <button
                        key={col}
                        type="button"
                        className={`hab-color-swatch ${newCatColor === col ? 'selected' : ''}`}
                        style={{ backgroundColor: col }}
                        onClick={() => setNewCatColor(col)}
                      />
                    ))}
                    <button
                      type="button"
                      className={`hab-color-swatch ${newCatColor === userAccent ? 'selected' : ''}`}
                      style={{ backgroundColor: userAccent }}
                      title="User Accent Color"
                      onClick={() => setNewCatColor(userAccent)}
                    />
                  </div>
                </div>

                <div className="modal-actions">
                  <button
                    className="btn subtle"
                    onClick={() => {
                      setNewCategoryModal(false);
                      setEditingCategory(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn primary"
                    onClick={handleSaveCategory}
                    disabled={!newCatName.trim()}
                  >
                    {editingCategory ? 'Save Changes' : 'Create Category'}
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function escapeHtml(text: string) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
