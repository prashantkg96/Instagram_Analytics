// Smoke test for the HTML tokenizer against an extracted export directory.
//   node tools/smoke-scan.mjs <path-to-extracted-export>
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { records, parseRecord, field, section, leafValues, readHeader, trailingStamp } from '../src/js/scan.js';

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/smoke-scan.mjs <extracted-export-dir>');
  process.exit(1);
}

const read = (p) => readFile(join(root, p), 'utf8');
const hr = () => console.log('─'.repeat(72));

// ── record counts ──────────────────────────────────────────────────────────
const targets = [
  ['connections/followers_and_following/followers_1.html', 'followers'],
  ['connections/followers_and_following/following.html', 'following'],
  ['your_instagram_activity/likes/liked_posts.html', 'liked posts'],
  ['your_instagram_activity/likes/liked_comments.html', 'liked comments'],
  ['your_instagram_activity/comments/post_comments_1.html', 'comments made'],
  ['your_instagram_activity/story_interactions/stories_viewed.html', 'stories viewed'],
  ['your_instagram_activity/story_interactions/story_likes.html', 'story likes'],
  ['ads_information/ads_and_topics/videos_watched.html', 'videos watched'],
  ['ads_information/ads_and_topics/posts_viewed.html', 'posts viewed'],
  ['ads_information/ads_and_topics/ads_viewed.html', 'ads viewed'],
  ['your_instagram_activity/saved/saved_posts.html', 'saved posts'],
  ['your_instagram_activity/media/posts.html', 'own posts'],
  ['your_instagram_activity/media/stories.html', 'own stories'],
  ['your_instagram_activity/media/reels.html', 'own reels'],
];

console.log('RECORD COUNTS');
hr();
for (const [path, label] of targets) {
  let html;
  try {
    html = await read(path);
  } catch {
    console.log(`  ${label.padEnd(16)} — file absent`);
    continue;
  }
  const t = performance.now();
  const recs = records(html);
  console.log(
    `  ${label.padEnd(16)} ${String(recs.length).padStart(6)}  ` +
      `(${(html.length / 1048576).toFixed(1)} MB, ${(performance.now() - t).toFixed(0)}ms)`,
  );
}

// ── field extraction ───────────────────────────────────────────────────────
hr();
console.log('\nFIELD EXTRACTION');
hr();

const followers = records(await read('connections/followers_and_following/followers_1.html')).map(parseRecord);
console.log('follower[0]  link:', followers[0].links[0]);
console.log('             when:', trailingStamp(followers[0])?.toISOString());

const following = records(await read('connections/followers_and_following/following.html')).map(parseRecord);
console.log('following[0] heading:', following[0].heading);
console.log('             when:', trailingStamp(following[0])?.toISOString());

const liked = records(await read('your_instagram_activity/likes/liked_posts.html')).slice(0, 1).map(parseRecord)[0];
console.log('liked[0]     url:', field(liked, 'URL'));
console.log('             owner:', field(section(liked, 'Owner') ?? liked, 'Username'));
console.log('             name:', field(section(liked, 'Owner') ?? liked, 'Name'));
const tags = section(liked, 'Hashtags');
console.log('             hashtags:', tags ? leafValues(tags).join(', ') : '—');
console.log('             caption[0..60]:', field(liked, 'Caption')?.slice(0, 60));

const ownPosts = records(await read('your_instagram_activity/media/posts.html')).map(parseRecord);
console.log('ownPost[0]   lat/lng:', field(ownPosts[0], 'Latitude'), '/', field(ownPosts[0], 'Longitude'));
console.log('             published:', field(ownPosts[0], 'Published'), '| paid:', field(ownPosts[0], 'Paid partnership'));
console.log('             updated:', field(ownPosts[0], 'Update time'));

const comments = records(await read('your_instagram_activity/comments/post_comments_1.html')).slice(0, 1).map(parseRecord)[0];
console.log('comment[0]   owner:', field(comments, 'Media Owner'), '| at:', field(comments, 'Time'));

const profile = records(await read('personal_information/personal_information/personal_information.html')).map(parseRecord)[0];
console.log('profile      username:', field(profile, 'Username'), '| private:', field(profile, 'Private Account'));

hr();
console.log('\nHEADER');
hr();
console.log(readHeader(await read('connections/followers_and_following/followers_1.html')));
