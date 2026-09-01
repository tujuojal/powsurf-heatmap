import { json, withCors } from './cors.js';
import {
	insertTrip,
	getTripById,
	listTripsForUser,
	updateTrip as dbUpdateTrip,
	deleteTrip as dbDeleteTrip,
	getTripByShareToken,
	getUserById,
} from './db.js';

export class HttpError extends Error {
	constructor(status, code) {
		super(code);
		this.status = status;
	}
}

// Guards against pathological payloads — roughly a full day at 1 fix/sec.
const MAX_POINTS = 20000;
const ELEV_NOISE_M = 1;

function haversineM(a, b) {
	const R = 6371000;
	const toRad = (d) => (d * Math.PI) / 180;
	const dLat = toRad(b.lat - a.lat);
	const dLng = toRad(b.lng - a.lng);
	const lat1 = toRad(a.lat);
	const lat2 = toRad(b.lat);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(h));
}

export function computeTripStats(points) {
	if (!Array.isArray(points) || points.length < 2) throw new HttpError(400, 'too_few_points');

	let distanceM = 0;
	let elevationGainM = 0;
	let elevationLossM = 0;
	let maxSpeedKmh = 0;

	for (let i = 1; i < points.length; i++) {
		const prev = points[i - 1];
		const cur = points[i];
		const segM = haversineM(prev, cur);
		distanceM += segM;

		if (typeof prev.ele === 'number' && typeof cur.ele === 'number') {
			const dEle = cur.ele - prev.ele;
			if (dEle > ELEV_NOISE_M) elevationGainM += dEle;
			else if (dEle < -ELEV_NOISE_M) elevationLossM += -dEle;
		}

		const dtS = (cur.t - prev.t) / 1000;
		const segSpeedKmh = typeof cur.speedKmh === 'number' ? cur.speedKmh : dtS > 0 ? (segM / dtS) * 3.6 : 0;
		if (Number.isFinite(segSpeedKmh) && segSpeedKmh > maxSpeedKmh) maxSpeedKmh = segSpeedKmh;
	}

	const startedAt = points[0].t;
	const endedAt = points[points.length - 1].t;
	const durationS = (endedAt - startedAt) / 1000;
	const avgSpeedKmh = durationS > 0 ? (distanceM / durationS) * 3.6 : 0;

	return {
		pointCount: points.length,
		distanceM,
		durationS,
		elevationGainM,
		elevationLossM,
		avgSpeedKmh,
		maxSpeedKmh,
		startedAt: new Date(startedAt).toISOString(),
		endedAt: new Date(endedAt).toISOString(),
	};
}

function pointsFromPath(path) {
	const coords = path?.geometry?.coordinates;
	const timestamps = path?.properties?.timestamps;
	const speeds = path?.properties?.speeds_kmh;
	if (!Array.isArray(coords) || !Array.isArray(timestamps) || coords.length !== timestamps.length) {
		throw new HttpError(400, 'invalid_path');
	}
	if (coords.length > MAX_POINTS) throw new HttpError(400, 'too_many_points');

	return coords.map((c, i) => {
		if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number' || typeof timestamps[i] !== 'number') {
			throw new HttpError(400, 'invalid_path');
		}
		return {
			lng: c[0],
			lat: c[1],
			ele: typeof c[2] === 'number' ? c[2] : null,
			t: timestamps[i],
			speedKmh: Array.isArray(speeds) && typeof speeds[i] === 'number' ? speeds[i] : undefined,
		};
	});
}

function buildPathGeojson(points) {
	return {
		type: 'Feature',
		geometry: {
			type: 'LineString',
			coordinates: points.map((p) => (typeof p.ele === 'number' ? [p.lng, p.lat, p.ele] : [p.lng, p.lat])),
		},
		properties: {
			timestamps: points.map((p) => p.t),
			speeds_kmh: points.map((p) => (typeof p.speedKmh === 'number' ? p.speedKmh : null)),
		},
	};
}

function xmlEscape(s) {
	return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

export function buildGpx(trip) {
	const geojson = JSON.parse(trip.path_geojson);
	const coords = geojson.geometry.coordinates;
	const timestamps = geojson.properties.timestamps;
	const pts = coords
		.map((c, i) => {
			const ele = typeof c[2] === 'number' ? `<ele>${c[2].toFixed(1)}</ele>` : '';
			const time = typeof timestamps[i] === 'number' ? `<time>${new Date(timestamps[i]).toISOString()}</time>` : '';
			return `    <trkpt lat="${c[1]}" lon="${c[0]}">${ele}${time}</trkpt>`;
		})
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PowSurf" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${xmlEscape(trip.name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>`;
}

export function buildGeoJson(trip) {
	const geojson = JSON.parse(trip.path_geojson);
	return {
		...geojson,
		properties: {
			...geojson.properties,
			name: trip.name,
			note: trip.note,
			distance_m: trip.distance_m,
			duration_s: trip.duration_s,
		},
	};
}

function appOrigin(env) {
	return env.APP_ORIGIN || 'https://tujuojal.github.io';
}

function shareUrl(env, trip) {
	return trip.share_token ? `${appOrigin(env)}/?trip=${trip.share_token}` : null;
}

function tripSummary(env, trip) {
	return {
		id: trip.id,
		name: trip.name,
		note: trip.note,
		visibility: trip.visibility,
		shareUrl: shareUrl(env, trip),
		pointCount: trip.point_count,
		distanceM: trip.distance_m,
		durationS: trip.duration_s,
		elevationGainM: trip.elevation_gain_m,
		elevationLossM: trip.elevation_loss_m,
		avgSpeedKmh: trip.avg_speed_kmh,
		maxSpeedKmh: trip.max_speed_kmh,
		startedAt: trip.started_at,
		endedAt: trip.ended_at,
		createdAt: trip.created_at,
	};
}

function tripDetail(env, trip) {
	return { ...tripSummary(env, trip), path: JSON.parse(trip.path_geojson) };
}

function sharedTripDetail(trip, ownerName) {
	return {
		id: trip.id,
		name: trip.name,
		note: trip.note,
		ownerName,
		pointCount: trip.point_count,
		distanceM: trip.distance_m,
		durationS: trip.duration_s,
		elevationGainM: trip.elevation_gain_m,
		elevationLossM: trip.elevation_loss_m,
		avgSpeedKmh: trip.avg_speed_kmh,
		maxSpeedKmh: trip.max_speed_kmh,
		startedAt: trip.started_at,
		endedAt: trip.ended_at,
		createdAt: trip.created_at,
		path: JSON.parse(trip.path_geojson),
	};
}

function generateShareToken() {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	let out = '';
	for (const b of bytes) out += chars[b % chars.length];
	return out;
}

function slugify(name) {
	return (
		(name || 'trip')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)/g, '') || 'trip'
	);
}

async function requireOwnTrip(env, id, auth) {
	const trip = await getTripById(env, id);
	if (!trip) throw new HttpError(404, 'not_found');
	if (trip.user_id !== auth.sub) throw new HttpError(403, 'forbidden');
	return trip;
}

export async function handleListTrips(request, env, auth) {
	const trips = await listTripsForUser(env, auth.sub);
	return json({ trips: trips.map((t) => tripSummary(env, t)) }, 200, request);
}

export async function handleGetTrip(request, env, auth, id) {
	const trip = await requireOwnTrip(env, id, auth);
	return json(tripDetail(env, trip), 200, request);
}

export async function handleCreateTrip(request, env, auth) {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw new HttpError(400, 'invalid_body');

	const points = pointsFromPath(body.path);
	const stats = computeTripStats(points);
	const geojson = buildPathGeojson(points);

	const trip = await insertTrip(env, {
		id: crypto.randomUUID(),
		userId: auth.sub,
		name: (body.name ? String(body.name) : 'Untitled trip').slice(0, 200),
		note: body.note ? String(body.note).slice(0, 2000) : null,
		pathGeojson: JSON.stringify(geojson),
		pointCount: stats.pointCount,
		distanceM: stats.distanceM,
		durationS: stats.durationS,
		elevationGainM: stats.elevationGainM,
		elevationLossM: stats.elevationLossM,
		avgSpeedKmh: stats.avgSpeedKmh,
		maxSpeedKmh: stats.maxSpeedKmh,
		startedAt: stats.startedAt,
		endedAt: stats.endedAt,
	});

	return json(tripDetail(env, trip), 201, request);
}

export async function handleUpdateTrip(request, env, auth, id) {
	const existing = await requireOwnTrip(env, id, auth);

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw new HttpError(400, 'invalid_body');

	const fields = {};
	if ('name' in body) fields.name = String(body.name).slice(0, 200);
	if ('note' in body) fields.note = body.note ? String(body.note).slice(0, 2000) : null;
	if ('visibility' in body) {
		if (body.visibility !== 'public' && body.visibility !== 'private') throw new HttpError(400, 'invalid_visibility');
		fields.visibility = body.visibility;
		if (body.visibility === 'public' && !existing.share_token) {
			fields.share_token = generateShareToken();
		}
	}
	if (Object.keys(fields).length === 0) throw new HttpError(400, 'no_fields');

	const trip = await dbUpdateTrip(env, id, fields);
	return json(tripDetail(env, trip), 200, request);
}

export async function handleDeleteTrip(request, env, auth, id) {
	await requireOwnTrip(env, id, auth);
	await dbDeleteTrip(env, id);
	return withCors(new Response(null, { status: 204 }), request);
}

export async function handleGetShared(request, env, token) {
	const trip = await getTripByShareToken(env, token);
	if (!trip) throw new HttpError(404, 'not_found');
	const owner = await getUserById(env, trip.user_id);
	return json(sharedTripDetail(trip, owner?.username ?? 'unknown'), 200, request);
}

function exportResponse(request, trip, format) {
	if (format === 'gpx') {
		const res = new Response(buildGpx(trip), {
			status: 200,
			headers: {
				'Content-Type': 'application/gpx+xml',
				'Content-Disposition': `attachment; filename="${slugify(trip.name)}.gpx"`,
			},
		});
		return withCors(res, request);
	}
	if (format === 'geojson') {
		const res = new Response(JSON.stringify(buildGeoJson(trip)), {
			status: 200,
			headers: {
				'Content-Type': 'application/geo+json',
				'Content-Disposition': `attachment; filename="${slugify(trip.name)}.geojson"`,
			},
		});
		return withCors(res, request);
	}
	throw new HttpError(400, 'invalid_format');
}

export async function handleExportTrip(request, env, auth, id, format) {
	const trip = await requireOwnTrip(env, id, auth);
	return exportResponse(request, trip, format);
}

export async function handleExportShared(request, env, token, format) {
	const trip = await getTripByShareToken(env, token);
	if (!trip) throw new HttpError(404, 'not_found');
	return exportResponse(request, trip, format);
}
