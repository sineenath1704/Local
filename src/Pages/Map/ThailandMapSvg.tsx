import React, { useMemo, useRef, useState, useCallback } from 'react';
import { View, PanResponder, GestureResponderEvent, PanResponderGestureState } from 'react-native';
import Svg, { Path, G, Text as SvgText, Rect } from 'react-native-svg';
import * as d3 from 'd3-geo';

import THAILAND_GEOJSON from '../../data/thailand_provinces.geojson.json';
import AMPHOE_GEOJSON from '../../data/thailand_amphoe.geojson.json';

interface ThailandMapSvgProps {
  width?: number;
  height?: number;
  viewLevel: 'region' | 'province' | 'district' | 'places';
  selectedRegionId?: string;
  selectedProvinceName?: string;
  selectedDistrictName?: string;
  onPressRegion?: (regionId: string) => void;
  onPressProvince?: (provinceName: string) => void;
  onPressDistrict?: (districtName: string) => void;
  onPressPlace?: (place: any) => void;
  places?: any[];
}

// Region colors for fill
const REGION_COLORS: Record<string, string> = {
  'reg-north': '#7C3AED',
  'reg-northeast': '#D97706',
  'reg-central': '#0284C7',
  'reg-west': '#059669',
  'reg-east': '#DC2626',
  'reg-south': '#DB2777',
};

const REGION_NAMES: Record<string, string> = {
  'reg-north': 'ภาคเหนือ',
  'reg-northeast': 'ภาคอีสาน',
  'reg-central': 'ภาคกลาง',
  'reg-west': 'ภาคตะวันตก',
  'reg-east': 'ภาคตะวันออก',
  'reg-south': 'ภาคใต้',
};

const MIN_SCALE = 1;
const MAX_SCALE = 8;

// distance between two active touches
function touchDistance(touches: any[]): number {
  const [a, b] = touches;
  const dx = a.pageX - b.pageX;
  const dy = a.pageY - b.pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

function touchMidpoint(touches: any[]): { x: number; y: number } {
  const [a, b] = touches;
  return { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 };
}

// deterministic pseudo-random in [0,1) from a seed, so pins stay put between renders
function seededRand(seed: number): number {
  const x = Math.sin(seed * 999.137) * 43758.5453;
  return x - Math.floor(x);
}

export default function ThailandMapSvg({
  width = 300,
  height = 400,
  viewLevel,
  selectedRegionId,
  selectedProvinceName,
  selectedDistrictName,
  onPressRegion,
  onPressProvince,
  onPressDistrict,
  onPressPlace,
  places = [],
}: ThailandMapSvgProps) {

  // ---- Free pinch-to-zoom + pan state (SVG group transform) ----
  const [transform, setTransform] = useState({ scale: 1, tx: 0, ty: 0 });

  // live gesture refs (avoid re-render churn during a gesture)
  const gesture = useRef({
    startScale: 1,
    startDist: 0,
    startTx: 0,
    startTy: 0,
    startMid: { x: 0, y: 0 },
    panStartX: 0,
    panStartY: 0,
    isPinching: false,
    lastTap: 0,
  });

  const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

  const resetTransform = useCallback(() => {
    setTransform({ scale: 1, tx: 0, ty: 0 });
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => {
        // Begin controlling the view on multi-touch (pinch) or a real drag
        return Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2;
      },
      onPanResponderGrant: (e: GestureResponderEvent) => {
        const touches = e.nativeEvent.touches;
        gesture.current.panStartX = 0;
        gesture.current.panStartY = 0;
        // snapshot current transform at gesture start
        setTransform((prev) => {
          gesture.current.startScale = prev.scale;
          gesture.current.startTx = prev.tx;
          gesture.current.startTy = prev.ty;
          return prev;
        });
        if (touches.length >= 2) {
          gesture.current.isPinching = true;
          gesture.current.startDist = touchDistance(touches);
          gesture.current.startMid = touchMidpoint(touches);
        } else {
          gesture.current.isPinching = false;
          // double-tap detection to reset zoom
          const now = Date.now();
          if (now - gesture.current.lastTap < 280) {
            resetTransform();
          }
          gesture.current.lastTap = now;
        }
      },
      onPanResponderMove: (e: GestureResponderEvent, g: PanResponderGestureState) => {
        const touches = e.nativeEvent.touches;

        if (touches.length >= 2) {
          // ---- Pinch to zoom ----
          if (!gesture.current.isPinching) {
            gesture.current.isPinching = true;
            gesture.current.startDist = touchDistance(touches);
            gesture.current.startMid = touchMidpoint(touches);
            gesture.current.startScale = transform.scale;
            gesture.current.startTx = transform.tx;
            gesture.current.startTy = transform.ty;
          }
          const dist = touchDistance(touches);
          if (gesture.current.startDist > 0) {
            const ratio = dist / gesture.current.startDist;
            const newScale = clampScale(gesture.current.startScale * ratio);
            // keep the pinch midpoint anchored
            const k = newScale / gesture.current.startScale;
            const mid = gesture.current.startMid;
            const tx = mid.x - k * (mid.x - gesture.current.startTx);
            const ty = mid.y - k * (mid.y - gesture.current.startTy);
            setTransform({ scale: newScale, tx, ty });
          }
        } else {
          // ---- One-finger pan (only meaningful when zoomed in) ----
          gesture.current.isPinching = false;
          setTransform({
            scale: gesture.current.startScale,
            tx: gesture.current.startTx + g.dx,
            ty: gesture.current.startTy + g.dy,
          });
        }
      },
      onPanResponderRelease: () => {
        gesture.current.isPinching = false;
        gesture.current.startDist = 0;
      },
      onPanResponderTerminate: () => {
        gesture.current.isPinching = false;
        gesture.current.startDist = 0;
      },
    })
  ).current;

  const { pathGenerator, renderFeatures, isAmphoe, activeDistrictFeat } = useMemo(() => {
    let featuresToRender: any[] = THAILAND_GEOJSON.features as any[];
    let featuresToFit: any[] = THAILAND_GEOJSON.features as any[];
    let usingAmphoe = false;
    let districtFeat: any = null;

    if (viewLevel === 'province' && selectedRegionId) {
      // Scope: zoom into ONLY the selected region's provinces
      featuresToRender = (THAILAND_GEOJSON.features as any[]).filter(
        (f) => f.properties.regionId === selectedRegionId
      );
      featuresToFit = featuresToRender;
    } else if (viewLevel === 'district' && selectedProvinceName) {
      // Scope: zoom into ONLY the selected province, draw all amphoe borders
      featuresToRender = (AMPHOE_GEOJSON.features as any[]).filter(
        (f) => f.properties.provinceName === selectedProvinceName
      );
      featuresToFit = featuresToRender;
      usingAmphoe = true;
    } else if (viewLevel === 'places' && selectedProvinceName) {
      featuresToRender = (AMPHOE_GEOJSON.features as any[]).filter(
        (f) => f.properties.provinceName === selectedProvinceName
      );
      usingAmphoe = true;
      // Scope zoom down to the specific district only
      const distMatch = featuresToRender.find(
        (f) => f.properties.districtName === selectedDistrictName ||
               f.properties.districtName?.replace('อำเภอ', '').trim() === selectedDistrictName?.replace('อำเภอ', '').trim() ||
               f.properties.districtName?.includes(selectedDistrictName || '') ||
               selectedDistrictName?.includes(f.properties.districtName || '')
      );
      districtFeat = distMatch || null;
      featuresToFit = distMatch ? [distMatch] : featuresToRender;
    }

    if (featuresToFit.length === 0) {
      featuresToFit = THAILAND_GEOJSON.features as any[];
    }

    // Tighter fit padding the deeper we scope in, so each level visibly zooms closer
    const padding =
      viewLevel === 'places' ? 0.72 :
      viewLevel === 'district' ? 0.8 :
      viewLevel === 'province' ? 0.84 : 0.88;

    const fitObject = { type: 'FeatureCollection', features: featuresToFit } as any;
    const proj = d3.geoMercator().fitSize([width * padding, height * padding], fitObject);
    const t = proj.translate();
    const offset = (1 - padding) / 2;
    proj.translate([t[0] + width * offset, t[1] + height * offset]);

    return {
      pathGenerator: d3.geoPath().projection(proj),
      renderFeatures: featuresToRender,
      isAmphoe: usingAmphoe,
      activeDistrictFeat: districtFeat,
    };
  }, [width, height, viewLevel, selectedRegionId, selectedProvinceName, selectedDistrictName]);

  const getFillColor = (feature: any) => {
    if (isAmphoe) {
      const dName = feature.properties.districtName;
      const isSelected = dName === selectedDistrictName ||
                         dName?.replace('อำเภอ', '').trim() === selectedDistrictName?.replace('อำเภอ', '').trim() ||
                         dName?.includes(selectedDistrictName || '') ||
                         selectedDistrictName?.includes(dName || '');
      if (viewLevel === 'places') {
        return isSelected ? '#A7F3D0' : '#E5E7EB';
      }
      return isSelected ? '#10B981' : '#D1FAE5';
    }
    const regionId = feature.properties.regionId;
    const provinceName = feature.properties.thaiName;
    if (viewLevel === 'region') {
      const base = REGION_COLORS[regionId] ?? '#E4E4E7';
      return regionId === selectedRegionId ? base : '#E4E4E7';
    }
    if (viewLevel === 'province') {
      return provinceName === selectedProvinceName ? '#EF4444' : '#FCA5A5';
    }
    return '#E4E4E7';
  };

  const getStrokeColor = (feature: any) => {
    if (isAmphoe) {
      const dName = feature.properties.districtName;
      const isSelected = dName === selectedDistrictName ||
                         dName?.replace('อำเภอ', '').trim() === selectedDistrictName?.replace('อำเภอ', '').trim();
      return isSelected ? '#059669' : '#6EE7B7';
    }
    const regionId = feature.properties.regionId;
    const provinceName = feature.properties.thaiName;
    if (viewLevel === 'region') {
      return regionId === selectedRegionId ? (REGION_COLORS[regionId] ?? '#6B7280') : '#D1D5DB';
    }
    if (viewLevel === 'province') {
      return provinceName === selectedProvinceName ? '#B91C1C' : '#FECACA';
    }
    return '#D1D5DB';
  };

  const handlePress = (feature: any) => {
    if (isAmphoe) {
      onPressDistrict?.(feature.properties.districtName);
    } else if (viewLevel === 'region') {
      onPressRegion?.(feature.properties.regionId);
    } else if (viewLevel === 'province') {
      onPressProvince?.(feature.properties.thaiName);
    }
  };

  // Labels for regions - calculate centroid per region group
  const regionLabels = useMemo(() => {
    if (viewLevel !== 'region') return [];
    const grouped: Record<string, any[]> = {};
    renderFeatures.forEach((f: any) => {
      const rid = f.properties.regionId;
      if (rid && rid !== 'unknown') {
        if (!grouped[rid]) grouped[rid] = [];
        grouped[rid].push(f);
      }
    });
    return Object.entries(grouped).map(([rid, feats]) => {
      const fc = { type: 'FeatureCollection', features: feats } as any;
      const [x, y] = pathGenerator.centroid(fc);
      return { id: rid, name: REGION_NAMES[rid] ?? rid, x, y };
    }).filter(l => !isNaN(l.x) && !isNaN(l.y));
  }, [renderFeatures, pathGenerator, viewLevel]);

  // Place pins scattered clearly INSIDE the selected district polygon.
  const placePins = useMemo(() => {
    if (viewLevel !== 'places' || places.length === 0) return [];

    const targetFeat = activeDistrictFeat || renderFeatures[0];

    // Compute the projected bounding box of the district so pins land inside it.
    let box = { x0: width * 0.2, y0: height * 0.2, x1: width * 0.8, y1: height * 0.8 };
    let center = [width / 2, height / 2];
    if (targetFeat) {
      const b = pathGenerator.bounds(targetFeat); // [[x0,y0],[x1,y1]]
      if (b && !isNaN(b[0][0]) && !isNaN(b[1][0])) {
        box = { x0: b[0][0], y0: b[0][1], x1: b[1][0], y1: b[1][1] };
      }
      const c = pathGenerator.centroid(targetFeat);
      if (!isNaN(c[0]) && !isNaN(c[1])) center = c;
    }

    const boxW = Math.max(box.x1 - box.x0, 40);
    const boxH = Math.max(box.y1 - box.y0, 40);
    const [cx, cy] = center;

    const count = places.length;
    return places.map((place, i) => {
      let x: number;
      let y: number;
      if (count === 1) {
        x = cx;
        y = cy;
      } else {
        // Spread on a jittered ring/grid inside the bounding box, biased toward centroid.
        const angle = (2 * Math.PI * i) / count - Math.PI / 2;
        // alternate radius rings so many pins don't collide
        const ring = 0.28 + 0.16 * ((i % 3));
        const jitter = (seededRand(i + 1) - 0.5) * 0.12;
        const rx = (boxW / 2) * (ring + jitter);
        const ry = (boxH / 2) * (ring + jitter);
        x = cx + Math.cos(angle) * rx;
        y = cy + Math.sin(angle) * ry;
        // clamp inside the box with a small margin
        x = Math.max(box.x0 + 8, Math.min(box.x1 - 8, x));
        y = Math.max(box.y0 + 10, Math.min(box.y1 - 6, y));
      }
      return { x, y, place, name: place.name || '' };
    });
  }, [places, activeDistrictFeat, renderFeatures, pathGenerator, viewLevel, width, height]);

  // MapPin SVG path (Heroicons MapPinIcon solid path, viewBox 24x24)
  const PIN_PATH = 'm11.54 22.351.07.04.028.016a.76.76 0 0 0 .723 0l.028-.015.071-.041a16.975 16.975 0 0 0 1.144-.742 19.58 19.58 0 0 0 2.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 0 0-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 0 0 2.682 2.282 16.975 16.975 0 0 0 1.145.742ZM12 13.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z';

  // Counter-scale labels/pins a bit so they stay readable while zoomed
  const labelScale = 1 / Math.sqrt(transform.scale);

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', width: '100%' }}>
      <View
        {...panResponder.panHandlers}
        style={{ width, height, overflow: 'hidden' }}
      >
        <Svg width={width} height={height}>
          {/* Pan/zoom group — pinch with two fingers, drag to pan, double-tap to reset */}
          <G transform={`translate(${transform.tx}, ${transform.ty}) scale(${transform.scale})`}>
            {/* Province/Amphoe polygons */}
            {renderFeatures.map((feature: any, i: number) => {
              const svgPath = pathGenerator(feature);
              if (!svgPath) return null;
              return (
                <Path
                  key={`poly-${i}`}
                  d={svgPath}
                  fill={getFillColor(feature)}
                  stroke={getStrokeColor(feature)}
                  strokeWidth={isAmphoe ? 0.8 : (viewLevel === 'province' && feature.properties.thaiName === selectedProvinceName ? 1.5 : 0.5)}
                  onPress={() => handlePress(feature)}
                />
              );
            })}

            {/* Region labels */}
            {viewLevel === 'region' && regionLabels.map((l) => (
              <SvgText
                key={l.id}
                x={l.x} y={l.y}
                fontSize={11 * labelScale} fontWeight="bold"
                fill={selectedRegionId === l.id ? '#FFFFFF' : '#374151'}
                textAnchor="middle"
                onPress={() => onPressRegion?.(l.id)}
              >
                {l.name}
              </SvgText>
            ))}

            {/* Province labels */}
            {viewLevel === 'province' && renderFeatures.map((f: any, i: number) => {
              const [x, y] = pathGenerator.centroid(f);
              if (isNaN(x) || isNaN(y)) return null;
              const isSel = f.properties.thaiName === selectedProvinceName;
              return (
                <SvgText
                  key={`lbl-${i}`}
                  x={x} y={y}
                  fontSize={(isSel ? 10 : 7) * labelScale}
                  fontWeight={isSel ? 'bold' : 'normal'}
                  fill={isSel ? '#FFFFFF' : '#7F1D1D'}
                  textAnchor="middle"
                  onPress={() => handlePress(f)}
                >
                  {f.properties.thaiName === 'กรุงเทพมหานคร' ? 'กทม.' : f.properties.thaiName}
                </SvgText>
              );
            })}

            {/* Amphoe (district) labels */}
            {viewLevel === 'district' && isAmphoe && renderFeatures.map((f: any, i: number) => {
              const [x, y] = pathGenerator.centroid(f);
              if (isNaN(x) || isNaN(y)) return null;
              const isSel = f.properties.districtName === selectedDistrictName;
              return (
                <SvgText
                  key={`albl-${i}`}
                  x={x} y={y}
                  fontSize={(isSel ? 9 : 7) * labelScale}
                  fontWeight={isSel ? 'bold' : 'normal'}
                  fill={isSel ? '#065F46' : '#374151'}
                  textAnchor="middle"
                  onPress={() => handlePress(f)}
                >
                  {f.properties.districtName}
                </SvgText>
              );
            })}

            {/* Place pins with name badges — spread across the district, tap to open video */}
            {viewLevel === 'places' && placePins.map((pin, i) => {
              const badgeWidth = Math.min(Math.max(pin.name.length * 9.5 + 16, 60), 130) * labelScale;
              const s = 0.75 * labelScale;
              return (
                <G
                  key={`pin-${i}`}
                  onPress={() => onPressPlace?.(pin.place)}
                >
                  {/* Map Pin Icon */}
                  <G transform={`translate(${pin.x - 9 * s}, ${pin.y - 18 * s}) scale(${s})`}>
                    <Path fill="#EF4444" stroke="#FFFFFF" strokeWidth={0.8} fillRule="evenodd" clipRule="evenodd" d={PIN_PATH} />
                  </G>
                  {/* Name Badge */}
                  <Rect
                    x={pin.x - badgeWidth / 2}
                    y={pin.y + 4 * labelScale}
                    width={badgeWidth}
                    height={18 * labelScale}
                    rx={9 * labelScale}
                    fill="rgba(17, 24, 39, 0.85)"
                    stroke="#FFFFFF"
                    strokeWidth={0.7}
                  />
                  <SvgText
                    x={pin.x}
                    y={pin.y + 16 * labelScale}
                    fontSize={8.5 * labelScale}
                    fontWeight="bold"
                    fill="#FFFFFF"
                    textAnchor="middle"
                  >
                    {pin.name.length > 12 ? pin.name.slice(0, 11) + '…' : pin.name}
                  </SvgText>
                </G>
              );
            })}
          </G>
        </Svg>
      </View>
    </View>
  );
}
