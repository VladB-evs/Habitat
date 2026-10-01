import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(maplibreWorkerUrl);
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../../api';
import { ask } from '../../confirm';
import { dialogIn, spring, stagger } from '../../motion';
import { useApp } from '../../store';
import type { StudyCategory, StudyPlace } from '../../types';
import { Icon, TypeIcon } from '../Icons';
import { SplitControls } from '../SplitControls';

type MapStyleKey = 'auto' | 'dark' | 'light' | 'voyager' | 'satellite';

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
  },
  layers: [
    {
      id: 'google-hybrid-layer',
      type: 'raster',
      source: 'google-hybrid',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

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
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('habitat:study-map:sidebar-open', String(isSidebarOpen));
    } catch {}
    const timer = setTimeout(() => {
      mapRef.current?.resize();
    }, 280);
    return () => clearTimeout(timer);
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
  const [geoResults, setGeoResults] = useState<any[]>([]);
  const [isSearchingGeo, setIsSearchingGeo] = useState(false);
  const [showGeoDropdown, setShowGeoDropdown] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [userLocMarker, setUserLocMarker] = useState<maplibregl.Marker | null>(null);
  const userLocMarkerRef = useRef<maplibregl.Marker | null>(null);

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

  const handleDropPinRef = useRef<(lat: number, lng: number, prefilledName?: string, prefilledAddress?: string) => Promise<void>>();
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
      maxZoom: 20,
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
      if (selectedPlaceIdRef.current) {
        setSelectedPlaceId(null);
        return;
      }
      if (modalPlaceRef.current && modalPlaceRef.current.mode === 'create') {
        moveDraftPinRef.current?.(lat, lng);
        return;
      }

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

    let resizeRaf: number | null = null;
    const ro = new ResizeObserver(() => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        map.resize();
      });
    });
    if (mapContainerRef.current) {
      ro.observe(mapContainerRef.current);
    }

    // Cleanup
    return () => {
      ro.disconnect();
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
      setIsSidebarOpen(true);
      mapRef.current?.flyTo({ center: [place.lng, place.lat], zoom: 18, duration: 1200 });
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
  const handleDropPin = useCallback(async (lat: number, lng: number, prefilledName?: string, prefilledAddress?: string) => {
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
    const defaultCat = currentActiveCat !== 'all' ? currentActiveCat : (currentCats[0]?.name || '');
    const matchedCat = currentCats.find((c) => c.name === defaultCat);
    const draftColor = matchedCat?.color || accent;

    const draftEl = createDraftMarkerElement(draftColor);
    const draftMarker = new maplibregl.Marker({ element: draftEl, anchor: 'bottom', draggable: true })
      .setLngLat([lng, lat])
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
        } else if (selectedPlaceId) {
          setSelectedPlaceId(null);
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
        el.className = `hab-pin-wrapper saved ${isSelected ? 'selected' : ''}`;
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
          .addTo(map);
        markersRef.current.set(p.id, marker);
      }
    }
  }, [places, categories, activeCategory, selectedPlaceId, userAccent]);

  // Selected place object
  const selectedPlace = useMemo(() => {
    return places.find((p) => p.id === selectedPlaceId) || null;
  }, [places, selectedPlaceId]);

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

  // Geocoding search handler
  const handleGeoSearch = async (query: string) => {
    setGeoQuery(query);
    if (!query.trim()) {
      setGeoResults([]);
      setShowGeoDropdown(false);
      return;
    }
    setIsSearchingGeo(true);
    setShowGeoDropdown(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`,
        { headers: { Accept: 'application/json' } }
      );
      if (res.ok) {
        const data = await res.json();
        setGeoResults(data);
      }
    } catch {
      setGeoResults([]);
    } finally {
      setIsSearchingGeo(false);
    }
  };

  // Fly to geocoded search result
  const handleSelectGeoResult = (item: any) => {
    setShowGeoDropdown(false);
    const shortName = item.display_name.split(',')[0];
    setGeoQuery(shortName);
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);

    mapRef.current?.flyTo({ center: [lng, lat], zoom: 18, duration: 1500 });
    handleDropPin(lat, lng, shortName, item.display_name);
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
        setSelectedPlaceId(created.id);
      } else if (modalPlace.mode === 'edit' && modalPlace.place) {
        await api.study.placePatch(modalPlace.place.id, {
          name: modalPlace.name.trim(),
          category: modalPlace.category,
          color: pinColor,
          notes: modalPlace.notes.trim(),
          address: modalPlace.address.trim(),
        });
        await loadData();
      }
    } catch (e) {
      console.error('Failed to save place:', e);
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
    if (!(await ask(`Delete “${name}”?`))) return;
    try {
      await api.study.placeDelete(id);
      if (selectedPlaceId === id) setSelectedPlaceId(null);
      await loadData();
    } catch (e) {
      console.error('Failed to delete place:', e);
    }
  };

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
    } catch (e) {
      console.error('Failed to save category:', e);
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
        {/* Left: Sidebar toggle & Title */}
        <div className="hab-map-bar-left">
          <button
            className={`btn ${isSidebarOpen ? 'active' : 'subtle'} hab-map-sidebar-toggle-btn`}
            onClick={() => setIsSidebarOpen((v) => !v)}
            title={isSidebarOpen ? 'Hide places sidebar (Full map view)' : 'Show places sidebar'}
            aria-label={isSidebarOpen ? 'Hide places sidebar' : 'Show places sidebar'}
          >
            <Icon name={isSidebarOpen ? 'panel-close' : 'panel-open'} size={15} />
            <span>{isSidebarOpen ? 'Hide Places' : 'Show Places'}</span>
          </button>
          <span className="hab-map-title">
            <Icon name="map" size={16} />
            <span>Map</span>
          </span>
          <span className="hab-map-place-count">{places.length} places</span>
        </div>

        {/* Center: Search places / addresses */}
        <div className="hab-map-search-box">
          <Icon name="search" size={14} className="hab-map-search-icon" />
          <input
            type="text"
            placeholder="Search places, streets, addresses…"
            value={geoQuery}
            onChange={(e) => handleGeoSearch(e.target.value)}
            onFocus={() => geoResults.length > 0 && setShowGeoDropdown(true)}
          />
          {isSearchingGeo && <span className="spinner-subtle" />}
          {geoQuery && (
            <button
              className="icon-btn subtle hab-search-clear"
              onClick={() => {
                setGeoQuery('');
                setGeoResults([]);
                setShowGeoDropdown(false);
              }}
            >
              <Icon name="x" size={12} />
            </button>
          )}

          {/* Autocomplete dropdown */}
          {showGeoDropdown && geoResults.length > 0 && (
            <div className="hab-map-geo-dropdown popover">
              {geoResults.map((r, i) => (
                <button key={i} className="hab-map-geo-item" onClick={() => handleSelectGeoResult(r)}>
                  <Icon name="map-pin" size={14} />
                  <div className="hab-map-geo-text">
                    <strong>{r.display_name.split(',')[0]}</strong>
                    <small>{r.display_name.split(',').slice(1, 3).join(',')}</small>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Actions */}
        <div className="hab-map-bar-right">
          <button
            className="btn primary"
            onClick={handleAddPinAtCenter}
            title="Drop a pin at the center of the current map view"
          >
            <Icon name="plus" size={14} />
            <span>Add Place</span>
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
          onClick={() => setActiveCategory('all')}
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
                onClick={() => setActiveCategory(c.name)}
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
                        <span className="hab-cat-inherit-note">
                          (Pin inherits category color)
                        </span>
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
                          className="btn subtle small"
                          onClick={handleAddPinAtCenter}
                          title="Add place at map center"
                        >
                          <Icon name="plus" size={13} />
                          <span>Add</span>
                        </button>
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
                              mapRef.current?.flyTo({ center: [p.lng, p.lat], zoom: 18, duration: 1200 });
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

          {/* Selected Place Popover / Detail Card */}
          <AnimatePresence>
            {selectedPlace && !modalPlace && (
              <motion.div
                className="hab-map-place-card"
                initial={{ opacity: 0, y: 15, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 15, scale: 0.95 }}
                transition={spring}
              >
                <div className="hab-card-head">
                  <div className="hab-card-title-group">
                    {selectedPlace.category ? (
                      <span
                        className="hab-card-cat-badge"
                        style={{
                          backgroundColor:
                            selectedPlace.color ||
                            categories.find((c) => c.name === selectedPlace.category)?.color ||
                            userAccent,
                        }}
                      >
                        {selectedPlace.category}
                      </span>
                    ) : null}
                    <h3>{selectedPlace.name}</h3>
                  </div>
                  <button
                    className="icon-btn subtle"
                    onClick={() => setSelectedPlaceId(null)}
                    aria-label="Close"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>

                {selectedPlace.address && (
                  <div className="hab-card-row address">
                    <Icon name="map-pin" size={13} />
                    <span>{selectedPlace.address}</span>
                  </div>
                )}

                {selectedPlace.notes && (
                  <div className="hab-card-notes">
                    <p>{selectedPlace.notes}</p>
                  </div>
                )}

                <div className="hab-card-coords">
                  <span>
                    {selectedPlace.lat.toFixed(5)}, {selectedPlace.lng.toFixed(5)}
                  </span>
                  <button
                    className="icon-btn subtle tiny"
                    title="Copy coordinates"
                    onClick={() => {
                      navigator.clipboard.writeText(`${selectedPlace.lat}, ${selectedPlace.lng}`);
                    }}
                  >
                    <Icon name="copy" size={12} />
                  </button>
                </div>

                <div className="hab-card-actions">
                  <button
                    className="btn subtle small"
                    onClick={() => {
                      const url = `https://www.google.com/maps/dir/?api=1&destination=${selectedPlace.lat},${selectedPlace.lng}`;
                      window.open(url, '_blank');
                    }}
                  >
                    <Icon name="compass" size={13} /> Directions
                  </button>

                  <button
                    className="btn subtle small"
                    onClick={() => {
                      const cat = categories.find((c) => c.name === selectedPlace.category);
                      const tint = cat?.color || userAccent;
                      setIsSidebarOpen(true);
                      setModalPlace({
                        mode: 'edit',
                        place: selectedPlace,
                        lat: selectedPlace.lat,
                        lng: selectedPlace.lng,
                        name: selectedPlace.name,
                        category: selectedPlace.category,
                        color: tint,
                        notes: selectedPlace.notes || '',
                        address: selectedPlace.address || '',
                      });
                    }}
                  >
                    <Icon name="settings" size={13} /> Edit
                  </button>

                  <button
                    className="btn subtle small danger"
                    onClick={() => handleDeletePlace(selectedPlace.id, selectedPlace.name)}
                  >
                    <Icon name="trash" size={13} /> Delete
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
