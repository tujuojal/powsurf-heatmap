import { describe, it, expect } from 'vitest';
import { computeTripStats, buildGpx, buildGeoJson, HttpError } from '../src/trips';

describe('computeTripStats', () => {
	it('throws for fewer than 2 points', () => {
		expect(() => computeTripStats([])).toThrow(HttpError);
		expect(() => computeTripStats([{ lat: 0, lng: 0, t: 0 }])).toThrow(HttpError);
	});

	it('computes distance/duration/avg speed for a simple two-point trip', () => {
		// ~0.001 deg latitude at the equator is ~111.19 m; 60s apart.
		const points = [
			{ lat: 0, lng: 0, ele: 100, t: 0 },
			{ lat: 0.001, lng: 0, ele: 100, t: 60_000 },
		];
		const stats = computeTripStats(points);
		expect(stats.pointCount).toBe(2);
		expect(stats.distanceM).toBeCloseTo(111.19, 0);
		expect(stats.durationS).toBe(60);
		expect(stats.avgSpeedKmh).toBeCloseTo((111.19 / 60) * 3.6, 1);
		expect(stats.startedAt).toBe(new Date(0).toISOString());
		expect(stats.endedAt).toBe(new Date(60_000).toISOString());
	});

	it('accumulates elevation gain and loss separately, ignoring sub-threshold noise', () => {
		const points = [
			{ lat: 0, lng: 0, ele: 100, t: 0 },
			{ lat: 0, lng: 0.0001, ele: 100.5, t: 1000 }, // +0.5m, under the 1m noise threshold
			{ lat: 0, lng: 0.0002, ele: 105, t: 2000 }, // +4.5m real gain
			{ lat: 0, lng: 0.0003, ele: 95, t: 3000 }, // -10m real loss
		];
		const stats = computeTripStats(points);
		expect(stats.elevationGainM).toBeCloseTo(4.5, 5);
		expect(stats.elevationLossM).toBeCloseTo(10, 5);
	});

	it('uses submitted per-point speed for max speed when present', () => {
		const points = [
			{ lat: 0, lng: 0, t: 0, speedKmh: 5 },
			{ lat: 0, lng: 0.001, t: 1000, speedKmh: 40 },
			{ lat: 0, lng: 0.002, t: 2000, speedKmh: 12 },
		];
		expect(computeTripStats(points).maxSpeedKmh).toBe(40);
	});

	it('derives max speed from distance/time when per-point speed is absent', () => {
		const points = [
			{ lat: 0, lng: 0, t: 0 },
			{ lat: 0, lng: 0, t: 1000 }, // zero movement -> 0 km/h segment
			{ lat: 0.001, lng: 0, t: 2000 }, // ~111.19m in 1s -> fast segment
		];
		const stats = computeTripStats(points);
		expect(stats.maxSpeedKmh).toBeGreaterThan(300);
	});
});

function fakeTrip(overrides = {}) {
	const geojson = {
		type: 'Feature',
		geometry: {
			type: 'LineString',
			coordinates: [
				[25, 60, 100],
				[25.001, 60.001, 110],
			],
		},
		properties: {
			timestamps: [0, 60_000],
			speeds_kmh: [0, 12.5],
		},
	};
	return {
		name: 'Test <trip> & "run"',
		note: 'a note',
		distance_m: 111.19,
		duration_s: 60,
		path_geojson: JSON.stringify(geojson),
		...overrides,
	};
}

describe('buildGpx', () => {
	it('produces well-formed GPX with escaped name and per-point ele/time', () => {
		const gpx = buildGpx(fakeTrip());
		expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>');
		expect(gpx).toContain('<name>Test &lt;trip&gt; &amp; &quot;run&quot;</name>');
		expect(gpx).toContain('<trkpt lat="60" lon="25">');
		expect(gpx).toContain('<ele>100.0</ele>');
		expect(gpx).toContain(`<time>${new Date(0).toISOString()}</time>`);
		expect((gpx.match(/<trkpt/g) || []).length).toBe(2);
	});
});

describe('buildGeoJson', () => {
	it('merges trip metadata into the stored GeoJSON properties', () => {
		const result = buildGeoJson(fakeTrip());
		expect(result.type).toBe('Feature');
		expect(result.geometry.coordinates).toHaveLength(2);
		expect(result.properties.name).toBe('Test <trip> & "run"');
		expect(result.properties.note).toBe('a note');
		expect(result.properties.distance_m).toBeCloseTo(111.19, 2);
		expect(result.properties.duration_s).toBe(60);
		// Original per-point arrays are preserved alongside the merged metadata.
		expect(result.properties.timestamps).toEqual([0, 60_000]);
	});
});
