"""
Instagram scraper using instagrapi.
Handles login, session persistence, and fetching follower/following lists.
"""

import json
import os
import random
import time

import requests
from instagrapi import Client
from instagrapi.exceptions import (
    LoginRequired,
    TwoFactorRequired,
    ChallengeRequired,
    ClientThrottledError,
    PleaseWaitFewMinutes,
    RateLimitError,
    ClientRequestTimeout,
    FeedbackRequired,
)

# Exceptions that indicate Instagram rate-limiting / throttling
RATE_LIMIT_ERRORS = (
    ClientThrottledError,
    PleaseWaitFewMinutes,
    RateLimitError,
    FeedbackRequired,
)
TIMEOUT_ERRORS = (ClientRequestTimeout,)


class IGRateLimitError(Exception):
    """Raised when Instagram rate-limits the API.  May carry partial data."""

    def __init__(self, message, partial_data=None, cooldown=300):
        super().__init__(message)
        self.partial_data = partial_data   # dict with whatever was collected
        self.cooldown = cooldown           # suggested cooldown in seconds


class IGTimeoutError(Exception):
    """Raised when an Instagram API request times out."""

    def __init__(self, message, cooldown=120):
        super().__init__(message)
        self.cooldown = cooldown

_APP_DIR = os.path.dirname(os.path.abspath(__file__))
SESSION_FILE = os.path.join(_APP_DIR, "UserData", "ig_session.json")
os.makedirs(os.path.join(_APP_DIR, "UserData"), exist_ok=True)


def get_session_file(username: str) -> str:
    """Return a per-username session file path."""
    safe = "".join(c if c.isalnum() or c in ("_", "-", ".") else "_" for c in username)
    d = os.path.join(_APP_DIR, "UserData", safe)
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "ig_session.json")


def _get_client(username: str, password: str, session_file: str = SESSION_FILE,
                log=None, twofa_callback=None) -> Client:
    """Create and authenticate an Instagram client, reusing sessions when possible.

    Args:
        twofa_callback: Optional callable that returns the 2FA code string.
                        If None, falls back to terminal input().
    """
    _log = log or print
    cl = Client()
    cl.delay_range = [3, 7]  # be polite to avoid rate limits

    # Try to reuse an existing session
    if os.path.exists(session_file):
        try:
            cl.load_settings(session_file)
            cl.login(username, password)
            # Verify the session is still valid
            cl.get_timeline_feed()
            _log("Logged in using saved session.")
            return cl
        except (LoginRequired, Exception):
            _log("Saved session expired, logging in fresh...")
            # Clear stale settings and retry
            old_session = cl.get_settings()
            cl.set_settings({})
            cl.set_uuids(old_session["uuids"])

    # Fresh login
    try:
        cl.login(username, password)
    except TwoFactorRequired:
        if twofa_callback:
            code = twofa_callback()
        else:
            code = input("Enter 2FA code: ")
        if not code:
            raise ValueError("2FA code is required but was not provided.")
        cl.login(username, password, verification_code=code)
    except ChallengeRequired:
        _log("Instagram requires a challenge verification.")
        _log("Check your email/SMS and approve the login, then re-run.")
        raise

    # Save session for reuse
    cl.dump_settings(session_file)
    _log("Logged in and session saved.")
    return cl


def scrape_followers_and_following(username: str, password: str, log=None,
                                   twofa_callback=None, client=None):
    """
    Scrapes the follower and following lists of the logged-in account.

    Args:
        username: Instagram username.
        password: Instagram password.
        log: Optional callable for status messages (e.g. log("message")).
        twofa_callback: Optional callable that returns a 2FA code string.

    Returns:
        dict with keys:
            - username: str
            - followers: list[dict] with user_id, username, full_name
            - following: list[dict] with user_id, username, full_name
            - follower_count: int
            - following_count: int
    """
    _log = log or print

    if client is not None:
        cl = client
        _log("Reusing active session.")
    else:
        session_file = get_session_file(username)
        cl = _get_client(username, password, session_file=session_file,
                         log=_log, twofa_callback=twofa_callback)
    # Store client for later reuse (e.g. unfollowing)
    scrape_followers_and_following._last_client = cl
    scrape_followers_and_following._last_client_username = username

    user_id = cl.user_id
    user_info = cl.user_info(user_id)

    _log(f"Fetching followers for @{username} (count: {user_info.follower_count})...")
    try:
        raw_followers = cl.user_followers(user_id, amount=0)  # 0 = fetch all
    except RATE_LIMIT_ERRORS as e:
        raise IGRateLimitError(
            f"Rate limited while fetching followers: {e}",
            cooldown=300,
        ) from e
    except TIMEOUT_ERRORS as e:
        raise IGTimeoutError(
            f"Request timed out while fetching followers: {e}",
            cooldown=120,
        ) from e

    _log(f"Fetching following for @{username} (count: {user_info.following_count})...")
    try:
        raw_following = cl.user_following(user_id, amount=0)
    except RATE_LIMIT_ERRORS as e:
        raise IGRateLimitError(
            f"Rate limited while fetching following: {e}",
            cooldown=300,
        ) from e
    except TIMEOUT_ERRORS as e:
        raise IGTimeoutError(
            f"Request timed out while fetching following: {e}",
            cooldown=120,
        ) from e

    followers = [
        {
            "user_id": str(uid),
            "username": user.username,
            "full_name": user.full_name or "",
            "profile_pic_url": str(user.profile_pic_url or ""),
        }
        for uid, user in raw_followers.items()
    ]

    following = [
        {
            "user_id": str(uid),
            "username": user.username,
            "full_name": user.full_name or "",
            "profile_pic_url": str(user.profile_pic_url or ""),
        }
        for uid, user in raw_following.items()
    ]

    return {
        "username": username,
        "followers": followers,
        "following": following,
        "follower_count": len(followers),
        "following_count": len(following),
        "profile_pic_url": str(user_info.profile_pic_url_hd or user_info.profile_pic_url or ""),
    }


def get_last_client():
    """Return the most recently authenticated client, or None."""
    return getattr(scrape_followers_and_following, "_last_client", None)


def get_last_client_username() -> str | None:
    """Return the username associated with the last authenticated client."""
    return getattr(scrape_followers_and_following, "_last_client_username", None)


def check_session(username: str, password: str, log=None,
                  twofa_callback=None) -> bool:
    """Verify that an existing session file is still valid.

    If the session is alive, stores the client for reuse and returns True.
    Returns False if no session exists or the session is expired.
    """
    session_file = get_session_file(username)
    if not os.path.exists(session_file):
        return False
    _log = log or (lambda *_: None)
    cl = Client()
    cl.delay_range = [3, 7]
    try:
        cl.load_settings(session_file)
        cl.login(username, password)
        cl.get_timeline_feed()
        scrape_followers_and_following._last_client = cl
        scrape_followers_and_following._last_client_username = username
        _log(f"Session for @{username} is active.")
        return True
    except Exception:
        return False


def session_keepalive(log=None) -> bool:
    """Perform lightweight actions that mimic normal app usage.

    Call periodically (every 5-15 min) to keep the session warm and
    make the API activity pattern look more natural.

    Returns True if successful, False otherwise.
    """
    cl = get_last_client()
    if cl is None:
        return False
    _log = log or (lambda *_: None)
    try:
        action = random.choice(["timeline", "timeline", "reels", "explore"])
        if action == "timeline":
            cl.get_timeline_feed()
        elif action == "reels":
            cl.get_timeline_feed()  # reels tab uses same endpoint internally
        else:
            cl.get_timeline_feed()
        _log(f"Session keep-alive ping ({action}).")
        return True
    except Exception as e:
        _log(f"Keep-alive failed: {e}")
        return False


def login_only(username: str, password: str, log=None, twofa_callback=None):
    """Establish and store an authenticated session without scraping.

    Returns the authenticated Client instance.
    """
    _log = log or print
    session_file = get_session_file(username)
    cl = _get_client(username, password, session_file=session_file,
                     log=_log, twofa_callback=twofa_callback)
    scrape_followers_and_following._last_client = cl
    scrape_followers_and_following._last_client_username = username
    return cl


def unfollow_users(user_ids: list[str], log=None) -> dict:
    """
    Unfollow a list of users by their user_id using the last authenticated client.

    Returns:
        dict with 'success' (list of user_ids) and 'failed' (list of user_ids).
    """
    _log = log or print
    cl = get_last_client()
    if cl is None:
        raise RuntimeError("No active Instagram session. Run Scrape first.")

    success = []
    failed = []
    for uid in user_ids:
        try:
            cl.user_unfollow(int(uid))
            success.append(uid)
            _log(f"Unfollowed user {uid}")
        except Exception as e:
            failed.append(uid)
            _log(f"Failed to unfollow {uid}: {e}")

    return {"success": success, "failed": failed}


def scrape_engagement(media_count: int = 30, log=None) -> dict:
    """Scrape engagement data: last N media items with likers/commenters,
    and active story viewers.

    Requires a previous scrape (get_last_client() must return a client).

    Returns dict with media_items, interactions, story_viewers, media_count,
    and rate_limited (bool).
    """
    _log = log or print
    cl = get_last_client()
    if cl is None:
        raise RuntimeError("No active Instagram session. Run Scrape first.")

    user_id = cl.user_id
    rate_limited = False

    def _human_delay(lo=3, hi=8):
        """Sleep a random duration to mimic human browsing patterns."""
        time.sleep(random.uniform(lo, hi))

    # Fetch last N media items (posts, reels, IGTV, carousels)
    _log(f"Fetching last {media_count} media items...")
    try:
        medias = cl.user_medias(user_id, amount=media_count)
    except RATE_LIMIT_ERRORS as e:
        _log(f"⚠ Rate limited while fetching media list: {e}")
        raise IGRateLimitError(
            f"Rate limited while fetching media: {e}",
            partial_data={
                "media_items": [], "interactions": [],
                "story_viewers": [], "media_count": 0,
                "rate_limited": True,
            },
            cooldown=300,
        ) from e
    except TIMEOUT_ERRORS as e:
        _log(f"⚠ Timed out while fetching media list: {e}")
        raise IGTimeoutError(
            f"Timed out fetching media: {e}", cooldown=120,
        ) from e
    except Exception as e:
        _log(f"Failed to fetch media: {e}")
        medias = []

    media_data = []
    all_interactions = []

    for i, media in enumerate(medias, 1):
        product = getattr(media, "product_type", "") or ""
        mtype = media.media_type
        if product == "clips":
            label = "Reel"
        elif mtype == 8:
            label = "Carousel"
        elif mtype == 2 and product == "igtv":
            label = "IGTV"
        elif mtype == 2:
            label = "Video"
        else:
            label = "Photo"

        _log(f"Processing {label} {i}/{len(medias)} "
             f"({media.like_count or 0} likes, "
             f"{media.comment_count or 0} comments)...")

        item = {
            "media_pk": str(media.pk),
            "media_type": mtype,
            "product_type": product,
            "taken_at": media.taken_at.isoformat() if media.taken_at else "",
            "caption": (media.caption_text or "")[:200],
            "like_count": max(media.like_count or 0, 0),
            "comment_count": max(media.comment_count or 0, 0),
            "view_count": max(getattr(media, "view_count", 0) or 0, 0),
            "play_count": max(getattr(media, "play_count", 0) or 0, 0),
            "video_duration": round(getattr(media, "video_duration", 0) or 0, 1),
            "location": (
                getattr(media.location, "name", "") or ""
            ) if getattr(media, "location", None) else "",
            "usertags_count": len(getattr(media, "usertags", []) or []),
            "carousel_count": len(getattr(media, "resources", []) or []),
            "is_paid_partnership": bool(getattr(media, "sponsor_tags", None)),
            "code": media.code or "",
        }
        media_data.append(item)

        # Random delay between media items to appear human
        _human_delay(3, 8)

        # Fetch likers
        try:
            likers = cl.media_likers(media.pk)
            for user in likers:
                all_interactions.append({
                    "media_pk": str(media.pk),
                    "user_id": str(user.pk),
                    "username": user.username,
                    "interaction_type": "like",
                })
        except RATE_LIMIT_ERRORS as e:
            _log(f"  ⚠ Rate limit hit at media {i}/{len(medias)}. "
                 f"Continuing with {len(media_data)} items collected so far.")
            rate_limited = True
            break
        except TIMEOUT_ERRORS as e:
            _log(f"  ⚠ Request timed out at media {i}/{len(medias)}. "
                 f"Continuing with collected data.")
            rate_limited = True
            break
        except Exception as e:
            _log(f"  Could not fetch likers: {e}")

        # Delay between likers and comments fetch
        _human_delay(2, 5)

        # Fetch commenters (up to 100 per post)
        try:
            comments = cl.media_comments(media.pk, amount=100)
            for comment in comments:
                all_interactions.append({
                    "media_pk": str(media.pk),
                    "user_id": str(comment.user.pk),
                    "username": comment.user.username,
                    "interaction_type": "comment",
                })
        except RATE_LIMIT_ERRORS as e:
            _log(f"  ⚠ Rate limit hit at media {i}/{len(medias)}. "
                 f"Continuing with {len(media_data)} items collected so far.")
            rate_limited = True
            break
        except TIMEOUT_ERRORS as e:
            _log(f"  ⚠ Request timed out at media {i}/{len(medias)}. "
                 f"Continuing with collected data.")
            rate_limited = True
            break
        except Exception as e:
            _log(f"  Could not fetch comments: {e}")

        # Longer pause every 5 media items to break up the pattern
        if i % 5 == 0 and i < len(medias):
            pause = random.uniform(10, 20)
            _log(f"  Pausing {pause:.0f}s to avoid detection...")
            time.sleep(pause)

    # Fetch active stories and their viewers (skip if already rate-limited)
    story_viewer_data = []
    if not rate_limited:
        try:
            _log("Fetching active stories...")
            stories = cl.user_stories(user_id)
            _log(f"Found {len(stories)} active stories.")
            for j, story in enumerate(stories, 1):
                try:
                    _human_delay(3, 7)
                    _log(f"Fetching viewers for story {j}/{len(stories)}...")
                    viewers = cl.story_viewers(story.pk, amount=0)
                    for user in viewers:
                        story_viewer_data.append({
                            "story_pk": str(story.pk),
                            "user_id": str(user.pk),
                            "username": user.username,
                        })
                except RATE_LIMIT_ERRORS:
                    _log(f"  ⚠ Rate limit hit fetching story viewers. "
                         f"Skipping remaining stories.")
                    rate_limited = True
                    break
                except Exception as e:
                    _log(f"  Could not fetch story viewers: {e}")
        except RATE_LIMIT_ERRORS:
            _log("⚠ Rate limit hit fetching stories. Skipping.")
            rate_limited = True
        except Exception as e:
            _log(f"Could not fetch stories: {e}")
    else:
        _log("Skipping story fetch (rate-limited).")

    if rate_limited:
        _log(f"⚠ Engagement scrape partially complete (rate limited): "
             f"{len(media_data)} media, "
             f"{len(all_interactions)} interactions, "
             f"{len(story_viewer_data)} story views.")
    else:
        _log(f"Engagement scrape complete: {len(media_data)} media, "
             f"{len(all_interactions)} interactions, "
             f"{len(story_viewer_data)} story views.")

    return {
        "media_items": media_data,
        "interactions": all_interactions,
        "story_viewers": story_viewer_data,
        "media_count": len(media_data),
        "rate_limited": rate_limited,
    }


def scrape_post_for_giveaway(url: str, log=None, skip_followers=False) -> dict:
    """Scrape a single post's likers, commenters, and author's followers.

    Args:
        url: Instagram post/reel URL.
        log: Optional callable for status messages.
        skip_followers: If True, skip fetching author followers.

    Returns dict with keys:
        likers: list[dict] with user_id, username
        commenters: list[dict] with user_id, username
        author: dict with user_id, username, full_name, follower_count
        author_followers: list[dict] with user_id, username
        media_info: dict with basic post info
        is_own_post: bool — True if post author matches logged-in user
    """
    _log = log or print
    cl = get_last_client()
    if cl is None:
        raise RuntimeError("No active Instagram session. Run Scan first.")

    # Resolve URL → media pk
    _log(f"Resolving post URL...")
    try:
        media_pk = cl.media_pk_from_url(url)
    except Exception as e:
        raise ValueError(f"Could not parse URL: {e}") from e

    # Fetch media info
    _log(f"Fetching post info...")
    try:
        media = cl.media_info(media_pk)
    except RATE_LIMIT_ERRORS as e:
        raise IGRateLimitError(
            f"Rate limited fetching post info: {e}", cooldown=300,
        ) from e
    except Exception as e:
        raise RuntimeError(f"Could not fetch post info: {e}") from e

    author = {
        "user_id": str(media.user.pk),
        "username": media.user.username,
        "full_name": getattr(media.user, "full_name", "") or "",
    }
    _log(f"Post by @{author['username']} — "
         f"{media.like_count or 0} likes, "
         f"{media.comment_count or 0} comments")

    # Fetch likers
    likers = []
    _log("Fetching likers...")
    try:
        raw_likers = cl.media_likers(media_pk)
        likers = [
            {"user_id": str(u.pk), "username": u.username}
            for u in raw_likers
        ]
        _log(f"Found {len(likers)} likers.")
    except RATE_LIMIT_ERRORS as e:
        raise IGRateLimitError(
            f"Rate limited fetching likers: {e}", cooldown=300,
        ) from e
    except Exception as e:
        _log(f"Could not fetch likers: {e}")

    # Fetch commenters
    commenters = []
    _log("Fetching commenters...")
    try:
        raw_comments = cl.media_comments(media_pk, amount=0)
        seen = set()
        for c in raw_comments:
            uid = str(c.user.pk)
            if uid not in seen:
                seen.add(uid)
                commenters.append({
                    "user_id": uid,
                    "username": c.user.username,
                })
        _log(f"Found {len(commenters)} unique commenters.")
    except RATE_LIMIT_ERRORS as e:
        raise IGRateLimitError(
            f"Rate limited fetching comments: {e}", cooldown=300,
        ) from e
    except Exception as e:
        _log(f"Could not fetch commenters: {e}")

    # Fetch author's followers
    author_followers = []
    author_uid = int(author["user_id"])
    is_own_post = str(cl.user_id) == author["user_id"]
    if skip_followers:
        _log("Skipping follower fetch (not my post).")
    else:
        _log(f"Fetching @{author['username']}'s followers...")
        try:
            raw_followers = cl.user_followers(author_uid, amount=0)
            author_followers = [
                {"user_id": str(uid), "username": u.username}
                for uid, u in raw_followers.items()
            ]
            _log(f"Found {len(author_followers)} followers.")
        except RATE_LIMIT_ERRORS as e:
            raise IGRateLimitError(
                f"Rate limited fetching followers: {e}", cooldown=300,
            ) from e
        except TIMEOUT_ERRORS as e:
            raise IGTimeoutError(
                f"Timed out fetching followers: {e}", cooldown=120,
            ) from e
        except Exception as e:
            _log(f"Could not fetch author's followers: {e}")

    return {
        "likers": likers,
        "commenters": commenters,
        "author": author,
        "author_followers": author_followers,
        "is_own_post": is_own_post,
        "media_info": {
            "media_pk": str(media_pk),
            "like_count": media.like_count or 0,
            "comment_count": media.comment_count or 0,
            "caption": (media.caption_text or "")[:200],
            "taken_at": media.taken_at.isoformat() if media.taken_at else "",
            "code": media.code or "",
        },
    }
