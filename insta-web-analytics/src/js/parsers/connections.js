// connections.js — followers, following, and the other relationship lists.
//
// The follow *dates* here are what make historical analysis possible from a
// single export: a growth curve and per-post attribution can both be
// reconstructed without any prior snapshot.

import { pick, pickAll, nodes, nodesOf, when, handleFromUrl, field, iso } from './common.js';

function handleOf(node) {
  return (
    field(node, 'Username') ??
    handleFromUrl(node.links[0]) ??
    node.heading ??
    node.text.split('\n')[0] ??
    null
  );
}

function person(node) {
  const u = handleOf(node);
  if (!u) return null;
  return { u, name: field(node, 'Name') ?? null, at: iso(when(node)) };
}

function peopleFrom(docs) {
  return nodesOf(docs).map(person).filter(Boolean);
}

export function parseConnections(files) {
  // Followers paginate (followers_1, followers_2, ...); following does not.
  const followers = peopleFrom(pickAll(files, /followers(_\d+)?\.html$/i));
  const following = peopleFrom(
    pickAll(files, /followers_and_following\/following\.html$/i),
  ).map((p) => ({ ...p, name: p.name ?? null }));

  const list = (re) => peopleFrom(pickAll(files, re));

  const contactsHtml = pick(files, 'connections/contacts/synced_contacts.html');

  return {
    followers,
    following,
    unfollowed: list(/recently_unfollowed_profiles\.html$/i),
    blocked: list(/blocked_profiles\.html$/i),
    followRequests: list(/recent_follow_requests\.html$/i),
    removedSuggestions: list(/removed_suggestions\.html$/i),
    pendingFollowRequests: list(/pending_follow_requests\.html$/i),
    // Present in complete-timeline exports. The apostrophe in
    // "profiles_you've_favorited" is literal in the filename.
    favourited: list(/profiles_you.?ve_favorited\.html$/i),
    restricted: list(/restricted_profiles\.html$/i),
    hiddenFromStory: list(/hide_story_from\.html$/i),
    closeFriends: list(/close_friends\.html$/i),
    // Contacts are other people's phone numbers. Only the count is kept, and
    // even that never reaches the history file — it exists for the privacy
    // audit, which needs to tell the user this data is in their ZIP.
    syncedContactCount: contactsHtml ? nodes(contactsHtml).length : 0,
  };
}
