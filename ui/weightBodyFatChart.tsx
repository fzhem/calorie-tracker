import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Line,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";

// ── Data helpers ────────────────────────────────────────────────

function toStartOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function averageValue(values: number[]) {
  if (!values.length) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 100) / 100;
}

export type TrendPoint = {
  recordedAt: string;
  value: number;
};

export type AggregatedPoint = {
  date: Date;
  value: number;
  label: string;
  tooltip: string;
};

const FOUR_MONTHS = 120;

/**
 * Build a series from raw trend points depending on the selected range.
 *
 * - days === 7 (weekly tab): show daily values, capped to last 4 months.
 * - days === 90 (3M tab): show weekly averages.
 * - days === 365 (1Y tab): show monthly averages.
 */
export function buildTrendSeries(
  points: TrendPoint[],
  days: number,
): AggregatedPoint[] {
  if (!points.length) return [];

  const sorted = [...points].sort(
    (a, b) =>
      new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  );

  const now = toStartOfDay(new Date());

  if (days <= 7) {
    // Daily values, capped to last 4 months
    const cutoff = toStartOfDay(addDays(now, -FOUR_MONTHS));
    // Only show daily values in the last FOUR_MONTHS window
    const byDay = new Map<string, number>();
    const byDayDate = new Map<string, Date>();
    for (const pt of sorted) {
      const when = toStartOfDay(new Date(pt.recordedAt));
      if (when < cutoff) continue;
      const key = formatDateKey(when);
      byDay.set(key, pt.value);
      byDayDate.set(key, when);
    }

    // Build a continuous date range
    const result: AggregatedPoint[] = [];
    let cursor = toStartOfDay(addDays(now, -(FOUR_MONTHS - 1)));
    const end = now;
    while (cursor <= end) {
      const key = formatDateKey(cursor);
      const val = byDay.get(key);
      if (val !== undefined) {
        result.push({
          date: new Date(cursor),
          value: val,
          label: cursor.toLocaleDateString(undefined, { weekday: "short" }),
          tooltip: cursor.toLocaleDateString(undefined, {
            weekday: "short",
            day: "numeric",
            month: "short",
          }),
        });
      }
      cursor = addDays(cursor, 1);
    }

    return result;
  }

  if (days <= 90) {
    // Weekly averages: group by week from earliest data
    const earliest = toStartOfDay(new Date(sorted[0].recordedAt));

    const buckets = new Map<
      number,
      { start: Date; end: Date; values: number[] }
    >();

    for (const pt of sorted) {
      const when = toStartOfDay(new Date(pt.recordedAt));
      const diffDays = Math.floor(
        (when.getTime() - earliest.getTime()) / 86_400_000,
      );
      const bucketIndex = Math.floor(diffDays / 7);
      const bucket = buckets.get(bucketIndex) ?? {
        start: addDays(earliest, bucketIndex * 7),
        end: addDays(earliest, bucketIndex * 7 + 6),
        values: [],
      };
      bucket.values.push(pt.value);
      buckets.set(bucketIndex, bucket);
    }

    const sortedBuckets = Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, bucket]) => bucket);

    return sortedBuckets.map((bucket, index) => {
      const prev = index > 0 ? sortedBuckets[index - 1] : null;
      const monthChanged =
        !prev ||
        prev.end.getMonth() !== bucket.end.getMonth() ||
        prev.end.getFullYear() !== bucket.end.getFullYear();

      return {
        date: new Date(bucket.end),
        value: averageValue(bucket.values),
        label: monthChanged
          ? bucket.end.toLocaleDateString(undefined, { month: "short" })
          : "",
        tooltip: `${bucket.start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}-${bucket.end.getDate()} ${bucket.end.getFullYear()}`,
      };
    });
  }

  // Monthly averages
  const byMonth = new Map<string, { monthStart: Date; values: number[] }>();
  for (const pt of sorted) {
    const when = new Date(pt.recordedAt);
    const monthStart = new Date(when.getFullYear(), when.getMonth(), 1);
    const key = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`;
    const bucket = byMonth.get(key) ?? { monthStart, values: [] };
    bucket.values.push(pt.value);
    byMonth.set(key, bucket);
  }

  return Array.from(byMonth.values())
    .sort((a, b) => a.monthStart.getTime() - b.monthStart.getTime())
    .map((bucket) => ({
      date: new Date(bucket.monthStart),
      value: averageValue(bucket.values),
      label: bucket.monthStart.toLocaleDateString(undefined, {
        month: "short",
        year: "2-digit",
      }),
      tooltip: bucket.monthStart.toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      }),
    }));
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// ── Chart dimensions ────────────────────────────────────────────

const CHART_HEIGHT = 210;
const PADDING_TOP = 36;
const PADDING_BOTTOM = 48;
const PADDING_LEFT = 66;
const PADDING_RIGHT = 16;
const GRID_SECTIONS = 4;
const POINT_RADIUS = 5;
const POINT_OFFSET = 5; // vertical offset for alternating points
const DOT_GAP = 40; // horizontal spacing between points
const LABEL_OFFSET = 18;

// ── Chart component ─────────────────────────────────────────────

interface WeightBodyFatChartProps {
  data: AggregatedPoint[];
  unit: string; // "kg" or "%"
  accentColor: string;
  onSurfaceVariant: string;
  backgroundColor: string;
  surfaceColor?: string; // e.g. elevation.level2 for the tooltip background
  onPrimaryContainer?: string; // text colour for tooltip / pill (defaults to white)
}

function computeChartMetrics(data: AggregatedPoint[]) {
  if (!data.length) return null;

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const paddedMin = min - range * 0.15;
  const paddedMax = max + range * 0.15;
  const paddedRange = paddedMax - paddedMin || 1;

  return { min, max, paddedMin, paddedMax, paddedRange };
}

/**
 * Render a scrollable line chart with:
 * - horizontal grid lines (no y-axis text)
 * - points alternating above/below the connecting line
 * - latest data point on the right
 * - bottom labels
 */
function ChartSvg({
  data,
  unit,
  accentColor,
  onSurfaceVariant,
  tooltipBg,
  onPrimaryContainer,
}: {
  data: AggregatedPoint[];
  unit: string;
  accentColor: string;
  onSurfaceVariant: string;
  tooltipBg: string;
  onPrimaryContainer: string;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  // Reset selection synchronously at render time when dataset changes
  const validSelectedIndex =
    selectedIndex !== null && selectedIndex < data.length
      ? selectedIndex
      : null;
  const metrics = useMemo(() => computeChartMetrics(data), [data]);
  const screenWidth = Dimensions.get("window").width;
  const totalWidth = Math.max(
    data.length * DOT_GAP + PADDING_LEFT + PADDING_RIGHT,
    screenWidth - 32,
  );
  const plotHeight = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  if (!metrics || data.length === 0) {
    return (
      <Svg width={totalWidth} height={CHART_HEIGHT}>
        <SvgText
          x={totalWidth / 2}
          y={CHART_HEIGHT / 2}
          textAnchor="middle"
          fontSize={12}
          fill={onSurfaceVariant}
        >
          No data
        </SvgText>
      </Svg>
    );
  }

  const { paddedMin, paddedMax, paddedRange } = metrics;

  const yForValue = (value: number) => {
    return PADDING_TOP + ((paddedMax - value) / paddedRange) * plotHeight;
  };

  const xForIndex = (index: number) => {
    return PADDING_LEFT + index * DOT_GAP;
  };

  const gridTop = PADDING_TOP;
  const gridBottom = CHART_HEIGHT - PADDING_BOTTOM;
  const gridLeft = PADDING_LEFT;
  const gridRight = totalWidth - PADDING_RIGHT;

  // Grid lines - all horizontal lines (including top/bottom borders) at consistent opacity
  const gridLines: React.ReactNode[] = [];
  for (let i = 0; i <= GRID_SECTIONS; i++) {
    const y = gridTop + (i / GRID_SECTIONS) * (gridBottom - gridTop);
    gridLines.push(
      <Line
        key={`hgrid-${i}`}
        x1={gridLeft}
        y1={y}
        x2={gridRight}
        y2={y}
        stroke={onSurfaceVariant}
        strokeOpacity={0.2}
        strokeWidth={1}
      />,
    );
  }

  // Left y-axis border
  gridLines.push(
    <Line
      key="grid-left"
      x1={gridLeft}
      y1={gridTop}
      x2={gridLeft}
      y2={gridBottom}
      stroke={onSurfaceVariant}
      strokeOpacity={0.2}
      strokeWidth={1}
    />,
  );

  // Vertical grid lines (one per data point)
  for (let i = 1; i < data.length; i++) {
    const x = xForIndex(i);
    gridLines.push(
      <Line
        key={`vgrid-${i}`}
        x1={x}
        y1={gridTop}
        x2={x}
        y2={gridBottom}
        stroke={onSurfaceVariant}
        strokeOpacity={0.1}
        strokeWidth={1}
      />,
    );
  }

  // Smooth curve via cubic bezier path
  const linePath = useMemo(() => {
    if (data.length < 2) return "";

    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < data.length; i++) {
      const x = xForIndex(i);
      const y = yForValue(data[i].value);
      pts.push({ x, y });
    }

    // Build smooth cubic bezier path
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const tension = 0.3;

      const cp1x = p1.x + (p2.x - p0.x) * tension;
      const cp1y = p1.y + (p2.y - p0.y) * tension;
      const cp2x = p2.x - (p3.x - p1.x) * tension;
      const cp2y = p2.y - (p3.y - p1.y) * tension;

      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }

    return d;
    // Exclude yForValue/xForIndex from deps — they're pure functions of constants + data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Pressable hit areas (full vertical columns) and selection line
  const hitAreas: React.ReactNode[] = [];
  const selectedX = selectedIndex !== null ? xForIndex(selectedIndex) : null;

  const handlePress = useCallback((index: number) => {
    setSelectedIndex((prev) => (prev === index ? null : index));
  }, []);

  // Points, value labels, bottom labels, and latest pill badge
  const points: React.ReactNode[] = [];
  const valueLabels: React.ReactNode[] = [];
  const bottomLabels: React.ReactNode[] = [];

  for (let i = 0; i < data.length; i++) {
    const x = xForIndex(i);
    const y = yForValue(data[i].value);

    const isLatest = i === data.length - 1;
    const isSelected = i === selectedIndex;

    points.push(
      <Circle
        key={`pt-${i}`}
        cx={x}
        cy={y}
        r={isLatest ? 5 : POINT_RADIUS}
        fill={isLatest || isSelected ? accentColor : "transparent"}
        stroke={accentColor}
        strokeWidth={2}
      />,
    );

    // Compact value label for all non-latest points
    if (!isLatest) {
      valueLabels.push(
        <SvgText
          key={`val-${i}`}
          x={x}
          y={y - 10}
          textAnchor="middle"
          fontSize={9}
          fontWeight="600"
          fill={accentColor}
          opacity={0.85}
        >
          {data[i].value.toFixed(1)}
        </SvgText>,
      );
    }

    // Sparsify bottom labels: always show the latest, and show ~6 evenly spaced labels
    const showBottomLabel =
      data.length <= 8 ||
      i === data.length - 1 ||
      i === 0 ||
      i === Math.floor(data.length / 3) ||
      i === Math.floor((data.length * 2) / 3);
    bottomLabels.push(
      <SvgText
        key={`lbl-${i}`}
        x={x}
        y={CHART_HEIGHT - LABEL_OFFSET}
        textAnchor="middle"
        fontSize={10}
        fill={onSurfaceVariant}
        opacity={showBottomLabel ? 0.8 : 0}
      >
        {data[i].label}
      </SvgText>,
    );

    // Full-height invisible hit area for tapping
    hitAreas.push(
      <Rect
        key={`hit-${i}`}
        x={x - DOT_GAP / 2}
        y={0}
        width={DOT_GAP}
        height={CHART_HEIGHT}
        fill="transparent"
        onPress={() => handlePress(i)}
      />,
    );
  }

  // Latest pill badge
  const latestPoint = data[data.length - 1];
  const latestX = xForIndex(data.length - 1);
  const latestY = yForValue(latestPoint.value);
  const pillLabel = `${latestPoint.value.toFixed(1)} ${unit}`;

  // Build gradient area fill path (curve -> bottom -> close)
  const areaPath = useMemo(() => {
    if (!linePath || data.length < 2) return "";
    const lastX = xForIndex(data.length - 1);
    const firstX = xForIndex(0);
    const bottomY = CHART_HEIGHT - PADDING_BOTTOM;
    return `${linePath} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <Svg width={totalWidth} height={CHART_HEIGHT}>
      {/* Gradient definition */}
      <Defs>
        <LinearGradient id={`gradient-${unit}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={accentColor} stopOpacity="0.25" />
          <Stop offset="1" stopColor={accentColor} stopOpacity="0.02" />
        </LinearGradient>
      </Defs>

      {/* Grid */}
      {gridLines}

      {/* Gradient fill under curve */}
      {areaPath ? <Path d={areaPath} fill={`url(#gradient-${unit})`} /> : null}

      {/* Smooth connecting curve */}
      {linePath ? (
        <Path
          d={linePath}
          stroke={accentColor}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
        />
      ) : null}

      {/* Value labels (non-latest) */}
      {valueLabels}

      {/* Points */}
      {points}

      {/* Latest pill badge */}
      <Rect
        x={latestX - 22}
        y={Math.max(latestY - 20, 2)}
        width={42}
        height={13}
        rx={3}
        fill={tooltipBg}
      />
      <SvgText
        x={latestX}
        y={Math.max(latestY - 10, 14)}
        textAnchor="middle"
        fontSize={10}
        fontWeight="bold"
        fill={onPrimaryContainer}
      >
        {pillLabel}
      </SvgText>

      {/* Selection vertical line + tooltip */}
      {validSelectedIndex !== null ? (
        <>
          <Line
            x1={xForIndex(validSelectedIndex)}
            y1={PADDING_TOP - 4}
            x2={xForIndex(validSelectedIndex)}
            y2={CHART_HEIGHT - PADDING_BOTTOM + 4}
            stroke={accentColor}
            strokeWidth={1.5}
            strokeDasharray="4,3"
            opacity={0.6}
          />
          {/* Tooltip legend box */}
          <Rect
            x={Math.max(xForIndex(validSelectedIndex) - 58, 2)}
            y={4}
            width={116}
            height={34}
            rx={6}
            fill={tooltipBg}
          />
          <SvgText
            x={xForIndex(validSelectedIndex)}
            y={20}
            textAnchor="middle"
            fontSize={11}
            fontWeight="bold"
            fill={onPrimaryContainer}
          >
            {data[validSelectedIndex].tooltip}
          </SvgText>
          <SvgText
            x={xForIndex(validSelectedIndex)}
            y={32}
            textAnchor="middle"
            fontSize={11}
            fontWeight="bold"
            fill={onPrimaryContainer}
          >
            {`${data[validSelectedIndex].value.toFixed(1)} ${unit}`}
          </SvgText>
        </>
      ) : null}

      {/* Bottom labels */}
      {bottomLabels}

      {/* Hit areas (on top so they catch taps) */}
      {hitAreas}
    </Svg>
  );
}

export default function WeightBodyFatChart({
  data,
  unit,
  accentColor,
  onSurfaceVariant,
  backgroundColor,
  surfaceColor,
  onPrimaryContainer,
}: WeightBodyFatChartProps) {
  const scrollRef = useRef<ScrollView>(null);
  const screenWidth = Dimensions.get("window").width;
  const hasScrolledRef = useRef(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    if (data.length > 0) {
      fadeAnim.setValue(0);
      slideAnim.setValue(20);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 350,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 350,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [data, fadeAnim, slideAnim]);

  // Only render points that will fit on screen to avoid SVG lag.
  // Show enough for full screen width + a bit of overscroll.
  const maxVisiblePoints = Math.ceil(screenWidth / DOT_GAP) + 4;
  const sliced =
    data.length > maxVisiblePoints ? data.slice(-maxVisiblePoints) : data;
  const totalWidth = Math.max(
    sliced.length * DOT_GAP + PADDING_LEFT + PADDING_RIGHT,
    screenWidth - 32,
  );

  // Key changes when data content changes, forcing ChartSvg to remount with fresh state
  const chartKey = useMemo(() => {
    if (!sliced.length) return "empty";
    return `${sliced.length}-${sliced[0].date.getTime()}-${sliced[sliced.length - 1].date.getTime()}`;
  }, [sliced]);

  const handleLayout = useCallback(() => {
    if (!hasScrolledRef.current && sliced.length > 0) {
      hasScrolledRef.current = true;
      scrollRef.current?.scrollToEnd({ animated: false });
    }
  }, [sliced.length]);

  return (
    <View style={styles.container} onLayout={handleLayout}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { width: totalWidth }]}
      >
        <Animated.View
          style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
        >
          <ChartSvg
            key={chartKey}
            data={sliced}
            unit={unit}
            accentColor={accentColor}
            onSurfaceVariant={onSurfaceVariant}
            tooltipBg={surfaceColor ?? onSurfaceVariant}
            onPrimaryContainer={onPrimaryContainer ?? "white"}
          />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    borderRadius: 12,
    marginBottom: 4,
  },
  scrollContent: {
    alignItems: "flex-start",
  },
});
