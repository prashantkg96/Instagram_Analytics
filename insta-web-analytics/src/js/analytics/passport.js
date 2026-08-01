// passport.js — what Meta actually sent, and what it left out.
//
// Every other tab reports on data that is present. This one reports on the
// archive itself, which is the only way an absence becomes visible: a section
// reading zero because you genuinely did nothing looks identical to a section
// reading zero because Meta shipped no file for it. Naming the missing files
// is what tells those two apart.
//
// The manifest comes from the ZIP central directory, so it covers the whole
// archive including the ~90% of it (media) that is never decompressed.

import { round } from './util.js';

/**
 * Files worth expecting, and what a reader loses without each.
 *
 * Matched as a substring of the path, because Meta moves files between parent
 * folders across export versions but keeps the leaf names stable. Only files
 * that genuinely affect the dashboard are listed — an exhaustive inventory of
 * an export would be noise, and every entry here has to earn its warning.
 */
const EXPECTED = [
  { file: 'followers_1', needed: 'follower list, growth, attribution' },
  { file: 'following', needed: 'mutuals, follow-back rate, one-sided follows' },
  { file: 'liked_posts', needed: 'creator affinity' },
  { file: 'post_comments', needed: 'your commenting activity' },
  { file: 'saved_posts', needed: 'saves in the affinity score' },
  { file: 'posts_1', needed: 'your own posting history', alt: ['posts.html', 'posts.json'] },
  { file: 'stories', needed: 'story cadence' },
  { file: 'ads_viewed', needed: 'ad exposure and ad share' },
  { file: 'posts_viewed', needed: 'what the feed showed you' },
  { file: 'videos_watched', needed: 'reel viewing' },
  { file: 'stories_viewed', needed: 'story viewing' },
  { file: 'advertisers_using_your_activity', needed: 'who holds your data' },
  { file: 'signup_details', needed: 'account age', alt: ['account_information'] },
  { file: 'login_activity', needed: 'the security audit' },
  { file: 'recently_unfollowed', needed: 'recent unfollows' },
];

/** Top-level folder of a path, or '(root)'. */
const folderOf = (name) => {
  const clean = name.replace(/^\.?\//, '');
  const slash = clean.indexOf('/');
  return slash === -1 ? '(root)' : clean.slice(0, slash);
};

/**
 * @param {Array<{name: string, uncompressedSize: number}>} manifest  every ZIP
 *   entry, including media. Absent when the dataset was loaded from a directory
 *   rather than a ZIP, in which case there is nothing to report.
 * @param {Map<string,string>} files  the subset actually parsed
 */
export function passport(manifest, files) {
  if (!manifest?.length) return null;

  const byFolder = new Map();
  let bytes = 0;
  let dataFiles = 0;

  for (const entry of manifest) {
    const size = entry.uncompressedSize ?? 0;
    bytes += size;
    const isData = /\.(html?|json|txt)$/i.test(entry.name);
    if (isData) dataFiles++;

    const key = folderOf(entry.name);
    const row = byFolder.get(key) ?? { key, count: 0, data: 0, bytes: 0 };
    row.count++;
    if (isData) row.data++;
    row.bytes += size;
    byFolder.set(key, row);
  }

  const present = (needle) => manifest.some((e) => e.name.toLowerCase().includes(needle.toLowerCase()));
  const missing = EXPECTED
    .filter((want) => !present(want.file) && !(want.alt ?? []).some(present))
    .map((want) => ({ file: want.file, needed: want.needed }));

  return {
    totals: {
      entries: manifest.length,
      dataFiles,
      // What the parsers actually read, versus what the archive holds.
      parsed: files?.size ?? 0,
      megabytes: round(bytes / 1048576, 1),
      folders: byFolder.size,
      missing: missing.length,
    },
    folders: [...byFolder.values()]
      .map((row) => ({ ...row, megabytes: round(row.bytes / 1048576, 2) }))
      .sort((a, b) => b.bytes - a.bytes),
    missing,
  };
}
