export async function getOrCreateUser(env, provider, providerUserId, username, avatarUrl) {
	const existing = await env.DB.prepare('SELECT * FROM users WHERE provider = ? AND provider_user_id = ?')
		.bind(provider, providerUserId)
		.first();

	if (existing) {
		if (existing.username !== username || existing.avatar_url !== avatarUrl) {
			await env.DB.prepare('UPDATE users SET username = ?, avatar_url = ? WHERE id = ?')
				.bind(username, avatarUrl, existing.id)
				.run();
			return { ...existing, username, avatar_url: avatarUrl };
		}
		return existing;
	}

	return env.DB.prepare('INSERT INTO users (provider, provider_user_id, username, avatar_url) VALUES (?, ?, ?, ?) RETURNING *')
		.bind(provider, providerUserId, username, avatarUrl)
		.first();
}

export async function getUserById(env, id) {
	return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

export async function insertTrip(env, trip) {
	await env.DB.prepare(
		`INSERT INTO trips (
			id, user_id, name, note, visibility, share_token, path_geojson,
			point_count, distance_m, duration_s, elevation_gain_m, elevation_loss_m,
			avg_speed_kmh, max_speed_kmh, started_at, ended_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	)
		.bind(
			trip.id,
			trip.userId,
			trip.name,
			trip.note ?? null,
			trip.visibility ?? 'private',
			trip.shareToken ?? null,
			trip.pathGeojson,
			trip.pointCount,
			trip.distanceM,
			trip.durationS,
			trip.elevationGainM ?? null,
			trip.elevationLossM ?? null,
			trip.avgSpeedKmh ?? null,
			trip.maxSpeedKmh ?? null,
			trip.startedAt,
			trip.endedAt
		)
		.run();
	return getTripById(env, trip.id);
}

export async function getTripById(env, id) {
	return env.DB.prepare('SELECT * FROM trips WHERE id = ?').bind(id).first();
}

export async function listTripsForUser(env, userId) {
	const { results } = await env.DB.prepare(
		`SELECT id, name, note, visibility, share_token, point_count, distance_m, duration_s,
			elevation_gain_m, elevation_loss_m, avg_speed_kmh, max_speed_kmh, started_at, ended_at, created_at
		FROM trips WHERE user_id = ? ORDER BY started_at DESC`
	)
		.bind(userId)
		.all();
	return results;
}

// `fields` keys must already be trusted column names (callers only ever pass a
// fixed allowlist from trips.js — never forward request body keys directly).
export async function updateTrip(env, id, fields) {
	const sets = [];
	const values = [];
	for (const [col, val] of Object.entries(fields)) {
		sets.push(`${col} = ?`);
		values.push(val);
	}
	sets.push("updated_at = datetime('now')");
	values.push(id);
	await env.DB.prepare(`UPDATE trips SET ${sets.join(', ')} WHERE id = ?`)
		.bind(...values)
		.run();
	return getTripById(env, id);
}

export async function deleteTrip(env, id) {
	await env.DB.prepare('DELETE FROM trips WHERE id = ?').bind(id).run();
}

export async function getTripByShareToken(env, token) {
	return env.DB.prepare("SELECT * FROM trips WHERE share_token = ? AND visibility = 'public'").bind(token).first();
}
