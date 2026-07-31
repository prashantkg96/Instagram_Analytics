// Parse an export and print what came out, so parser regressions are obvious.
//   node tools/parse-check.mjs <export.zip | extracted-dir>
import { loadExport } from './load.mjs';
import { parseExport } from '../src/js/parsers/index.js';

const path = process.argv[2];
if (!path) {
  console.error('usage: node tools/parse-check.mjs <export.zip | extracted-dir>');
  process.exit(1);
}

const files = await loadExport(path);
const t = performance.now();
const d = parseExport(files);
const ms = performance.now() - t;

const n = (v) => String(v ?? 0).padStart(7);
const row = (label, value, extra = '') => console.log(`  ${label.padEnd(26)}${n(value)}  ${extra}`);
const hr = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`);

console.log(`format=${d.format}  parsed in ${ms.toFixed(0)}ms  (${files.size} files)`);
console.log(`generated=${d.meta.generatedAt}  range=${d.meta.rangeStart} .. ${d.meta.rangeEnd}`);

hr('profile');
console.log(`  @${d.profile.username}  "${d.profile.name}"  private=${d.profile.isPrivate}`);
console.log(`  created=${d.profile.createdAt}  device=${d.profile.signupDevice}`);
console.log(`  basedIn=${JSON.stringify(d.profile.basedIn)}  contactSync=${d.profile.contactSyncing}`);

hr('connections');
row('followers', d.followers.length, d.followers[0] ? `first=${d.followers[0].u} @ ${d.followers[0].at}` : '');
row('following', d.following.length, d.following[0] ? `first=${d.following[0].u} @ ${d.following[0].at}` : '');
row('unfollowed', d.unfollowed.length);
row('blocked', d.blocked.length);
row('follow requests', d.followRequests.length);
row('removed suggestions', d.removedSuggestions.length);
row('synced contacts', d.syncedContactCount, '(count only — never stored)');

hr('own content');
row('posts', d.content.posts.length, `${d.content.mediaFileCount} media files`);
row('stories', d.content.stories.length);
row('reels', d.content.reels.length);
row('live / other / deleted', d.content.live.length + d.content.other.length + d.content.deleted.length);
row('published timeline', d.content.published.length);
const dated = d.content.published.filter((p) => p.at).sort((a, b) => a.at.localeCompare(b.at));
console.log(`    span ${dated[0]?.at?.slice(0, 10)} .. ${dated.at(-1)?.at?.slice(0, 10)}`);
console.log(`    geotagged: ${d.content.published.filter((p) => p.coords).length}`);

hr('outgoing engagement');
row('likes', d.engagement.likes.length);
row('liked comments', d.engagement.likedComments.length);
row('comments written', d.engagement.comments.length);
row('story likes', d.engagement.storyLikes.length);
row('saved', d.engagement.saved.length);

hr('consumption');
row('stories/reels viewed', d.consumption.storiesViewed.length);
row('posts viewed', d.consumption.postsViewed.length);
row('videos watched', d.consumption.videosWatched.length);
row('searches', d.consumption.searches.length);
row('link history', d.consumption.linkHistory.length);

hr('ads & tracking');
row('ads viewed', d.ads.adsViewed.length);
row('advertisers with data', d.ads.advertisers.length);
row('off-Meta apps', d.ads.offMeta.length,
  `${d.ads.offMeta.reduce((s, a) => s + a.events.length, 0)} events`);
row('ad topics', d.ads.topics.length);

hr('messages');
row('threads', d.messages.threads.length);
row('messages', d.messages.threads.reduce((s, t2) => s + t2.total, 0));
row('sent', d.messages.threads.reduce((s, t2) => s + t2.sent, 0));
console.log('  busiest:', d.messages.threads.slice(0, 3).map((t2) => `${t2.title}(${t2.total})`).join(', '));

hr('security (audit only — never stored)');
row('logins', d.security.logins.length);
row('unique IPs', d.security.uniqueIps.length);
row('device IDs', d.security.deviceIds.length);
console.log('  devices:', d.security.devices.join(' | '));

hr('field coverage');
const nulls = (arr, key) => arr.filter((x) => !x[key]).length;
console.log(`  followers missing date : ${nulls(d.followers, 'at')}`);
console.log(`  following missing date : ${nulls(d.following, 'at')}`);
console.log(`  likes missing owner    : ${nulls(d.engagement.likes, 'u')} / ${d.engagement.likes.length}`);
console.log(`  likes missing date     : ${nulls(d.engagement.likes, 'at')} / ${d.engagement.likes.length}`);
console.log(`  views missing owner    : ${nulls(d.consumption.storiesViewed, 'u')} / ${d.consumption.storiesViewed.length}`);
console.log(`  comments missing owner : ${nulls(d.engagement.comments, 'u')} / ${d.engagement.comments.length}`);
console.log(`  ads missing owner      : ${nulls(d.ads.adsViewed, 'u')} / ${d.ads.adsViewed.length}`);
console.log(`\n  peak RSS: ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`);
