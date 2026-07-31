// profile.js — account identity, settings and profile history.
//
// Recovery identifiers (email, phone, date of birth, signup IP) are read into
// a `sensitive` object so the privacy audit can tell the user what their ZIP
// contains. That object is deliberately kept apart from everything else and is
// stripped before any snapshot is written — see history.js.

import {
  pickAll, nodes, nodesOf, field, section, when, parseStamp, iso, toBool,
} from './common.js';

function first(files, pattern) {
  const docs = pickAll(files, pattern);
  const all = docs.length ? nodes(docs[0].html) : [];
  return all[0] ?? null;
}

// Anchored to `media/` so the Instagram logo that every exported page carries
// under `files/` can never be mistaken for the account's picture.
const PHOTO_SRC = /<img[^>]+src="((?:[^"]*\/)?media\/[^"]+\.(?:jpe?g|png|webp|gif))"/i;

/**
 * Where the profile picture lives inside the archive.
 *
 * It is markup rather than a field value — both files embed it as an
 * `<img src="media/other/….jpg">` — so it has to be read from the raw HTML
 * instead of from a parsed record. The bytes are fetched separately by the
 * worker; this only resolves the path.
 */
function profilePhotoPath(files) {
  for (const pattern of [
    /personal_information\/personal_information\.html$/i,
    /media\/profile_photos\.html$/i,
  ]) {
    for (const doc of pickAll(files, pattern)) {
      const match = PHOTO_SRC.exec(doc.html);
      if (match) return match[1].replace(/^\.?\//, '');
    }
  }
  return null;
}

export function parseProfile(files) {
  const info = first(files, /personal_information\/personal_information\.html$/i);
  const account = first(files, /instagram_profile_information\.html$/i);
  const signup = first(files, /signup_details\.html$/i);
  const basedIn = first(files, /profile_based_in\.html$/i);
  const friendMap = first(files, /instagram_friend_map\.html$/i);

  const locationNode = basedIn ? (section(basedIn, 'Location') ?? basedIn) : null;

  const profileChanges = nodesOf(pickAll(files, /profile_changes\.html$/i)).map((node) => ({
    changed: field(node, 'Changed') ?? null,
    newValue: field(node, 'New Value') ?? null,
    previousValue: field(node, 'Previous Value') ?? null,
    at: iso(when(node, 'Change Date')),
  }));

  const privacyChanges = nodesOf(pickAll(files, /profile_privacy_changes\.html$/i)).map((node) => ({
    to: /public/i.test(node.heading ?? '') ? 'public' : 'private',
    at: iso(when(node)),
  }));

  const monetization = nodesOf(pickAll(files, /monetization\/eligibility\.html$/i)).map((node) => ({
    product: field(node, 'Product Name') ?? null,
    decision: field(node, 'Decision') ?? null,
  }));

  const stars = nodesOf(pickAll(files, /gifts\/your_stars_transfers\.html$/i)).map((node) => ({
    units: field(node, 'Units transferred') ?? null,
    type: field(node, 'Type') ?? null,
    status: field(node, 'Status') ?? null,
    at: iso(when(node, 'Creation Time')),
  }));

  const interests = [];
  for (const node of nodesOf(pickAll(files, /locations_of_interest\.html$/i))) {
    const value = field(node, 'Locations of interest');
    if (value) interests.push(...value.split('\n').map((s) => s.trim()).filter(Boolean));
  }

  return {
    // A path into the ZIP, not image data. Resolved to a blob: URL in the page
    // and never written to a snapshot — history.js allow-lists what it keeps.
    photoPath: profilePhotoPath(files),

    username: info ? field(info, 'Username') ?? null : null,
    name: info ? field(info, 'Name') ?? null : null,
    bio: info ? field(info, 'Bio') ?? null : null,
    gender: info ? field(info, 'Gender') ?? null : null,
    isPrivate: info ? toBool(field(info, 'Private Account')) : null,

    contactSyncing: account ? toBool(field(account, 'Contact Syncing')) : null,
    firstCountry: account ? field(account, 'First Country Code') ?? null : null,
    lastLogin: account ? iso(parseStamp(field(account, 'Last Login'))) : null,
    lastLogout: account ? iso(parseStamp(field(account, 'Last Logout'))) : null,
    firstStoryAt: account ? iso(parseStamp(field(account, 'First Story Time'))) : null,
    lastStoryAt: account ? iso(parseStamp(field(account, 'Last Story Time'))) : null,
    hasSharedLive: account ? toBool(field(account, 'Has Shared Live Video')) : null,

    createdAt: signup ? iso(when(signup)) : null,
    signupDevice: signup ? field(signup, 'Device') ?? null : null,

    basedIn: locationNode
      ? {
          country: field(locationNode, 'Country') ?? null,
          region: field(locationNode, 'Region') ?? null,
          city: field(locationNode, 'City') ?? null,
        }
      : null,
    locationsOfInterest: interests,

    friendMapAudience: friendMap ? field(friendMap, 'Sharing audience') ?? null : null,

    profileChanges,
    privacyChanges,
    monetization,
    stars,

    // Read for the audit tab only. Never serialized.
    sensitive: {
      email: info ? field(info, 'Email') ?? null : null,
      phone: info ? field(info, 'Phone Number') ?? null : null,
      dateOfBirth: info ? field(info, 'Date of birth') ?? null : null,
      signupIp: signup ? field(signup, 'IP Address') ?? null : null,
      signupEmail: signup ? field(signup, 'Email') ?? null : null,
    },
  };
}
