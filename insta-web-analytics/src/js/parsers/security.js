// security.js — login history and device fingerprints.
//
// This section exists to power the privacy audit: it tells the user what an
// attacker would learn from their ZIP. Everything here is high-sensitivity —
// IPs, user agents, device IDs — and none of it is ever serialized.

import { pickAll, nodes, nodesOf, field, section, when, iso } from './common.js';

function sessionRows(files, pattern) {
  return nodesOf(pickAll(files, pattern)).map((node) => ({
    at: iso(when(node)),
    ip: field(node, 'IP Address') ?? field(node, 'IP address') ?? null,
    port: field(node, 'Port') ?? field(node, 'Port number') ?? null,
    userAgent: field(node, 'User Agent') ?? null,
    language: field(node, 'Language Code') ?? field(node, 'Language') ?? null,
    // Cookie values arrive already masked by Meta; kept only to confirm that.
    cookie: field(node, 'Cookie Name') ?? field(node, 'Cookie') ?? null,
  }));
}

/** Device model and platform, read out of an Instagram user-agent string. */
export function deviceOf(userAgent) {
  if (!userAgent) return null;
  const app = /^Instagram ([\d.]+) (Android|iOS)[^;]*;[^;]*;[^;]*;[^;]*;\s*([^;]+);\s*([^;]+);/.exec(userAgent);
  if (app) return { platform: app[2], model: app[4].trim(), app: app[1] };
  if (/Windows NT/.test(userAgent)) return { platform: 'Windows', model: 'desktop', app: null };
  if (/Macintosh/.test(userAgent)) return { platform: 'macOS', model: 'desktop', app: null };
  if (/Android/.test(userAgent)) return { platform: 'Android', model: 'browser', app: null };
  if (/iPhone|iPad/.test(userAgent)) return { platform: 'iOS', model: 'browser', app: null };
  return { platform: 'unknown', model: 'unknown', app: null };
}

export function parseSecurity(files) {
  const logins = sessionRows(files, /login_activity\.html$/i);
  const logouts = sessionRows(files, /logout_activity\.html$/i);

  const profileActivity = nodesOf(pickAll(files, /profile_activity\.html$/i)).map((node) => {
    const details = section(node, 'Details');
    return {
      at: iso(when(node)),
      type: field(node, 'Type') ?? null,
      ip: field(node, 'IP address') ?? null,
      userAgent: field(node, 'User Agent') ?? null,
      deviceId: field(node, 'Device ID') ?? null,
      location: (details ? field(details, 'Location') : null) ?? field(node, 'Location') ?? null,
    };
  });

  const passwordChanges = nodesOf(pickAll(files, /password_change_activity\.html$/i))
    .map((node) => iso(when(node)))
    .filter(Boolean);

  const cameraDeviceIds = new Set();
  for (const node of nodesOf(pickAll(files, /camera_information\.html$/i))) {
    const id = field(node, 'Device ID');
    if (id) cameraDeviceIds.add(id);
  }

  const secretConversations = nodesOf(pickAll(files, /secret_conversations\.html$/i)).map((node) => ({
    manufacturer: field(node, 'Device manufacturer') ?? null,
    model: field(node, 'Device model') ?? null,
    os: field(node, 'OS version') ?? null,
    ip: field(node, 'Full IP address') ?? field(node, 'IP address') ?? null,
  }));

  const lastLocationNode = nodes(
    pickAll(files, /last_known_location\.html$/i)[0]?.html ?? '',
  )[0];
  const lastKnownLocation = lastLocationNode
    ? {
        lat: Number(field(lastLocationNode, 'Precise Latitude') ?? 0),
        lng: Number(field(lastLocationNode, 'Precise Longitude') ?? 0),
      }
    : null;

  const ips = new Set();
  const deviceIds = new Set(cameraDeviceIds);
  for (const row of [...logins, ...logouts, ...profileActivity]) {
    if (row.ip) ips.add(row.ip);
    if (row.deviceId) deviceIds.add(row.deviceId);
  }
  for (const row of secretConversations) if (row.ip) ips.add(row.ip);

  return {
    logins,
    logouts,
    profileActivity,
    passwordChanges,
    secretConversations,
    lastKnownLocation,
    uniqueIps: [...ips],
    deviceIds: [...deviceIds],
    devices: [...new Set(
      [...logins, ...profileActivity]
        .map((r) => deviceOf(r.userAgent))
        .filter(Boolean)
        .map((d) => `${d.platform} ${d.model}`),
    )],
  };
}
