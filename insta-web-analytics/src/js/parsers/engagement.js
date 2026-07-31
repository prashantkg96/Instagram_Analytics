// engagement.js — what the user did to other people's content.
//
// The export has no counters for engagement *received*, so this outgoing
// activity is the only first-party engagement signal available. It is the
// basis for creator affinity and for spotting follows that never pay off.

import {
  pickAll, nodesOf, field, ownerOf, hashtagsOf, handleFromUrl, when, iso,
} from './common.js';

/** Interaction with someone else's content: who made it, when, tagged how. */
function interaction(node, kind) {
  const owner = ownerOf(node);
  const url = field(node, 'URL') ?? node.links[0] ?? null;
  return {
    kind,
    at: iso(when(node)),
    url,
    // liked_comments names the author in the heading rather than an Owner
    // block, and story likes only encode it in the URL path.
    u: owner?.u ?? node.heading ?? handleFromUrl(url),
    name: owner?.name ?? null,
    hashtags: hashtagsOf(node),
  };
}

function listOf(files, pattern, kind) {
  return nodesOf(pickAll(files, pattern)).map((n) => interaction(n, kind));
}

export function parseEngagement(files) {
  const likes = listOf(files, /likes\/liked_posts(_\d+)?\.html$/i, 'like');
  const likedComments = listOf(files, /likes\/liked_comments(_\d+)?\.html$/i, 'likeComment');
  const storyLikes = listOf(files, /story_interactions\/story_likes\.html$/i, 'storyLike');
  const saved = listOf(files, /saved\/saved_posts(_\d+)?\.html$/i, 'save');

  // Outgoing story interactions, which Instagram files apart from likes:
  // polls answered, quizzes taken, sliders dragged, countdowns followed. All of
  // it is engagement the user gave, and none of it was being read.
  const storyResponses = [
    ...listOf(files, /story_interactions\/polls\.html$/i, 'poll'),
    ...listOf(files, /story_interactions\/quizzes\.html$/i, 'quiz'),
    ...listOf(files, /story_interactions\/emoji_sliders\.html$/i, 'slider'),
    ...listOf(files, /story_interactions\/countdowns\.html$/i, 'countdown'),
  ];

  // Comments carry the text the user wrote. Length and timing are kept for
  // analytics; the text itself is used only for emoji/word stats and is never
  // written to the history file.
  const comments = nodesOf(pickAll(files, /comments\/post_comments(_\d+)?\.html$/i)).map((node) => {
    const text = field(node, 'Comment') ?? '';
    return {
      kind: 'comment',
      at: iso(when(node)),
      u: field(node, 'Media Owner') ?? ownerOf(node)?.u ?? null,
      length: text.length,
      words: text ? text.trim().split(/\s+/).length : 0,
      emoji: (text.match(/\p{Extended_Pictographic}/gu) ?? []).length,
      mentions: (text.match(/@[A-Za-z0-9._]+/g) ?? []).map((s) => s.slice(1).toLowerCase()),
    };
  });

  const savedCollections = nodesOf(pickAll(files, /saved\/saved_collections\.html$/i)).length;
  const savedMusic = nodesOf(pickAll(files, /saved\/saved_music\.html$/i)).length;

  return {
    likes, likedComments, storyLikes, saved, comments, savedCollections, savedMusic,
    storyResponses,
  };
}
