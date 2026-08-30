"""
Analytics module — compares current and previous scraping sessions to produce insights.
"""

from db import (
    get_previous_session,
    get_session_followers,
    get_session_following,
    get_all_sessions,
)


def _users_by_id(user_list: list[dict]) -> dict[str, dict]:
    """Index a list of user dicts by user_id for fast lookup."""
    return {u["user_id"]: u for u in user_list}


def get_not_following_back(followers: list[dict], following: list[dict]) -> list[dict]:
    """People you follow who don't follow you back."""
    follower_ids = {u["user_id"] for u in followers}
    return [u for u in following if u["user_id"] not in follower_ids]


def get_you_dont_follow_back(followers: list[dict], following: list[dict]) -> list[dict]:
    """People who follow you but you don't follow back (fans)."""
    following_ids = {u["user_id"] for u in following}
    return [u for u in followers if u["user_id"] not in following_ids]


def get_mutual_followers(followers: list[dict], following: list[dict]) -> list[dict]:
    """People you follow who also follow you (mutuals)."""
    follower_ids = {u["user_id"] for u in followers}
    return [u for u in following if u["user_id"] in follower_ids]


def get_unfollowers(current_followers: list[dict], previous_followers: list[dict]) -> list[dict]:
    """People who were in previous followers but are no longer in current followers."""
    current_ids = {u["user_id"] for u in current_followers}
    return [u for u in previous_followers if u["user_id"] not in current_ids]


def get_new_followers(current_followers: list[dict], previous_followers: list[dict]) -> list[dict]:
    """People who are now following you but weren't in the previous scrape."""
    previous_ids = {u["user_id"] for u in previous_followers}
    return [u for u in current_followers if u["user_id"] not in previous_ids]


def get_you_unfollowed(current_following: list[dict], previous_following: list[dict]) -> list[dict]:
    """People you were following before but stopped following."""
    current_ids = {u["user_id"] for u in current_following}
    return [u for u in previous_following if u["user_id"] not in current_ids]


def get_newly_following(current_following: list[dict], previous_following: list[dict]) -> list[dict]:
    """People you started following since the last scrape."""
    previous_ids = {u["user_id"] for u in previous_following}
    return [u for u in current_following if u["user_id"] not in previous_ids]


def generate_full_report(
    username: str,
    current_session_id: int,
    current_followers: list[dict],
    current_following: list[dict],
    db_path: str = None,
) -> dict:
    """
    Generate a complete analytics report.
    Compares with the previous session if available.

    Returns a dict with all analytics results.
    """
    kwargs = {"db_path": db_path} if db_path else {}

    report = {
        "has_previous_data": False,
        "current_follower_count": len(current_followers),
        "current_following_count": len(current_following),
        # Always available
        "not_following_back": get_not_following_back(current_followers, current_following),
        "fans": get_you_dont_follow_back(current_followers, current_following),
        "mutuals": get_mutual_followers(current_followers, current_following),
        # Only if previous data exists
        "unfollowers": [],
        "new_followers": [],
        "you_unfollowed": [],
        "newly_following": [],
        "previous_session": None,
    }

    # Try to load previous session data
    prev_session = get_previous_session(username, **kwargs)
    if prev_session:
        report["has_previous_data"] = True
        report["previous_session"] = prev_session

        prev_followers = get_session_followers(prev_session["id"], **kwargs)
        prev_following = get_session_following(prev_session["id"], **kwargs)

        report["unfollowers"] = get_unfollowers(current_followers, prev_followers)
        report["new_followers"] = get_new_followers(current_followers, prev_followers)
        report["you_unfollowed"] = get_you_unfollowed(current_following, prev_following)
        report["newly_following"] = get_newly_following(current_following, prev_following)

    return report


def compute_account_insights(report: dict, timeline: list[dict]) -> dict:
    """Compute derived ratios and growth trends from report and timeline data."""
    followers = report["current_follower_count"]
    following = report["current_following_count"]
    mutuals = len(report["mutuals"])
    fans = len(report["fans"])
    nfb = len(report["not_following_back"])

    insights = {
        "follower_following_ratio": followers / following if following else 0,
        "follow_back_rate": mutuals / following * 100 if following else 0,
        "fan_percentage": fans / followers * 100 if followers else 0,
        "mutual_percentage": mutuals / followers * 100 if followers else 0,
        "nfb_percentage": nfb / following * 100 if following else 0,
    }

    if len(timeline) >= 2:
        latest = timeline[-1]
        prev = timeline[-2]
        first = timeline[0]

        insights["follower_change_last"] = latest["follower_count"] - prev["follower_count"]
        insights["following_change_last"] = latest["following_count"] - prev["following_count"]
        insights["total_follower_growth"] = latest["follower_count"] - first["follower_count"]
        insights["total_following_growth"] = latest["following_count"] - first["following_count"]
        insights["total_scans"] = len(timeline)

        if len(timeline) > 1:
            insights["avg_follower_growth"] = round(
                insights["total_follower_growth"] / (len(timeline) - 1), 1)
            insights["avg_following_growth"] = round(
                insights["total_following_growth"] / (len(timeline) - 1), 1)

    if report["has_previous_data"]:
        prev_session = report.get("previous_session")
        if prev_session:
            prev_fc = prev_session.get("follower_count", 0)
            if prev_fc:
                insights["churn_rate"] = round(
                    len(report["unfollowers"]) / prev_fc * 100, 1)
                insights["retention_rate"] = round(100 - insights["churn_rate"], 1)

    return insights


def compute_engagement_report(
    followers: list[dict],
    media_items: list[dict],
    interactions: list[dict],
    story_viewers: list[dict],
    follower_count: int,
) -> dict:
    """Compute engagement analytics from media/interaction/story data.

    Returns a dict with content breakdown, ghost followers, active followers,
    top posts, story reach, and engagement rates.
    """
    follower_ids = {f["user_id"] for f in followers}
    follower_by_id = {f["user_id"]: f for f in followers}

    # ── Per-post stats ──
    post_stats = []
    for item in media_items:
        ptype = item.get("product_type", "")
        mtype = item["media_type"]
        if ptype == "clips":
            label = "Reel"
        elif mtype == 8:
            label = "Carousel"
        elif mtype == 2 and ptype == "igtv":
            label = "IGTV"
        elif mtype == 2:
            label = "Video"
        else:
            label = "Photo"

        likes = item["like_count"]
        comments = item["comment_count"]
        engagement = likes + comments
        eng_rate = (engagement / follower_count * 100) if follower_count else 0

        post_stats.append({
            **item,
            "type_label": label,
            "engagement": engagement,
            "engagement_rate": round(eng_rate, 2),
        })

    # ── Content type breakdown ──
    type_groups: dict[str, dict] = {}
    for ps in post_stats:
        lbl = ps["type_label"]
        if lbl not in type_groups:
            type_groups[lbl] = {
                "likes": [], "comments": [], "views": [], "rates": [],
            }
        type_groups[lbl]["likes"].append(ps["like_count"])
        type_groups[lbl]["comments"].append(ps["comment_count"])
        type_groups[lbl]["views"].append(ps["view_count"])
        type_groups[lbl]["rates"].append(ps["engagement_rate"])

    content_breakdown = {}
    for lbl, data in type_groups.items():
        n = len(data["likes"])
        content_breakdown[lbl] = {
            "count": n,
            "avg_likes": round(sum(data["likes"]) / n, 1),
            "avg_comments": round(sum(data["comments"]) / n, 1),
            "avg_views": (
                round(sum(data["views"]) / n, 1) if any(data["views"]) else 0
            ),
            "avg_engagement_rate": round(sum(data["rates"]) / n, 2),
        }

    # ── Overall engagement rate ──
    n_posts = len(media_items)
    total_likes = sum(i["like_count"] for i in media_items)
    total_comments = sum(i["comment_count"] for i in media_items)
    total_engagement = total_likes + total_comments
    avg_eng_rate = (
        (total_engagement / n_posts / follower_count * 100)
        if (n_posts and follower_count)
        else 0
    )

    # ── Ghost followers ──
    interacting_ids = {i["user_id"] for i in interactions}
    ghost_ids = follower_ids - interacting_ids
    ghost_followers = sorted(
        [follower_by_id[uid] for uid in ghost_ids if uid in follower_by_id],
        key=lambda u: u["username"],
    )

    # ── Active followers ranked by interaction count ──
    counts_by_user: dict[str, dict] = {}
    for i in interactions:
        uid = i["user_id"]
        if uid in follower_ids:
            if uid not in counts_by_user:
                counts_by_user[uid] = {"likes": 0, "comments": 0, "total": 0}
            if i["interaction_type"] == "like":
                counts_by_user[uid]["likes"] += 1
            else:
                counts_by_user[uid]["comments"] += 1
            counts_by_user[uid]["total"] += 1

    active_followers = []
    for uid, cnts in sorted(
        counts_by_user.items(), key=lambda x: -x[1]["total"],
    ):
        user = follower_by_id.get(uid)
        if user:
            active_followers.append({
                **user,
                "likes": cnts["likes"],
                "comments": cnts["comments"],
                "total_interactions": cnts["total"],
            })

    # ── Non-follower engagers ──
    nf_counts: dict[str, dict] = {}
    for i in interactions:
        uid = i["user_id"]
        if uid not in follower_ids:
            if uid not in nf_counts:
                nf_counts[uid] = {
                    "user_id": uid, "username": i["username"],
                    "likes": 0, "comments": 0, "total": 0,
                }
            if i["interaction_type"] == "like":
                nf_counts[uid]["likes"] += 1
            else:
                nf_counts[uid]["comments"] += 1
            nf_counts[uid]["total"] += 1

    non_follower_engagers = sorted(
        nf_counts.values(), key=lambda x: -x["total"],
    )

    # ── Story reach ──
    story_viewer_ids = {v["user_id"] for v in story_viewers}
    story_reach_followers = len(story_viewer_ids & follower_ids)
    story_reach_pct = (
        story_reach_followers / len(follower_ids) * 100
        if follower_ids else 0
    )

    # ── Best and worst performing type ──
    best_type = worst_type = ""
    if content_breakdown:
        best_type = max(
            content_breakdown, key=lambda k: content_breakdown[k]["avg_engagement_rate"],
        )
        worst_type = min(
            content_breakdown, key=lambda k: content_breakdown[k]["avg_engagement_rate"],
        )

    # ── Comment-to-like ratio ──
    comment_to_like_ratio = (
        round(total_comments / total_likes, 3) if total_likes else 0
    )

    # ── Top posts (all, sorted) ──
    top_posts = sorted(post_stats, key=lambda p: -p["engagement_rate"])

    # ── Best posting time analysis ──
    day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    day_eng: dict[int, list] = {}
    hour_eng: dict[int, list] = {}
    for ps in post_stats:
        taken = ps.get("taken_at", "")
        if not taken:
            continue
        try:
            from datetime import datetime
            dt = datetime.fromisoformat(taken)
            dow = dt.weekday()
            hr = dt.hour
            rate = ps["engagement_rate"]
            day_eng.setdefault(dow, []).append(rate)
            hour_eng.setdefault(hr, []).append(rate)
        except Exception:
            continue

    best_day = best_hour = None
    if day_eng:
        best_dow = max(day_eng, key=lambda d: sum(day_eng[d]) / len(day_eng[d]))
        best_day = {
            "day": day_names[best_dow],
            "avg_rate": round(sum(day_eng[best_dow]) / len(day_eng[best_dow]), 2),
            "post_count": len(day_eng[best_dow]),
        }
    if hour_eng:
        best_hr = max(hour_eng, key=lambda h: sum(hour_eng[h]) / len(hour_eng[h]))
        hr_12 = best_hr % 12 or 12
        ampm = "AM" if best_hr < 12 else "PM"
        best_hour = {
            "hour": best_hr,
            "label": f"{hr_12} {ampm}",
            "avg_rate": round(sum(hour_eng[best_hr]) / len(hour_eng[best_hr]), 2),
            "post_count": len(hour_eng[best_hr]),
        }

    # ── Engagement trend (chronological) ──
    sorted_by_date = sorted(
        [ps for ps in post_stats if ps.get("taken_at")],
        key=lambda p: p["taken_at"],
    )
    engagement_trend = []
    if len(sorted_by_date) >= 2:
        mid = len(sorted_by_date) // 2
        older = sorted_by_date[:mid]
        newer = sorted_by_date[mid:]
        older_avg = round(sum(p["engagement_rate"] for p in older) / len(older), 2)
        newer_avg = round(sum(p["engagement_rate"] for p in newer) / len(newer), 2)
        trend_dir = "up" if newer_avg > older_avg else (
            "down" if newer_avg < older_avg else "flat"
        )
        engagement_trend = {
            "older_avg": older_avg,
            "newer_avg": newer_avg,
            "change": round(newer_avg - older_avg, 2),
            "direction": trend_dir,
            "older_count": len(older),
            "newer_count": len(newer),
        }

    # ── Most loyal followers (like + comment + story view) ──
    likers = set()
    commenters = set()
    for ix in interactions:
        if ix["user_id"] in follower_ids:
            if ix["interaction_type"] == "like":
                likers.add(ix["user_id"])
            else:
                commenters.add(ix["user_id"])
    story_viewer_follower_ids = story_viewer_ids & follower_ids
    loyal_ids = likers & commenters & story_viewer_follower_ids
    loyal_followers = sorted(
        [follower_by_id[uid] for uid in loyal_ids if uid in follower_by_id],
        key=lambda u: u["username"],
    )
    # Also compute 2-of-3 "highly engaged"
    two_of_three = (likers & commenters) | (likers & story_viewer_follower_ids) | (
        commenters & story_viewer_follower_ids
    )
    highly_engaged_ids = two_of_three - loyal_ids

    # ── Story viewer list ──
    story_viewer_usernames: dict[str, str] = {}
    for v in story_viewers:
        story_viewer_usernames[v["user_id"]] = v["username"]
    story_viewer_list = sorted(
        [
            {
                "user_id": uid,
                "username": uname,
                "is_follower": uid in follower_ids,
            }
            for uid, uname in story_viewer_usernames.items()
        ],
        key=lambda u: u["username"],
    )

    return {
        "post_stats": post_stats,
        "top_posts": top_posts,
        "content_breakdown": content_breakdown,
        "best_content_type": best_type,
        "worst_content_type": worst_type,
        "total_posts_analyzed": n_posts,
        "total_likes": total_likes,
        "total_comments": total_comments,
        "avg_engagement_rate": round(avg_eng_rate, 2),
        "comment_to_like_ratio": comment_to_like_ratio,
        "best_day": best_day,
        "best_hour": best_hour,
        "engagement_trend": engagement_trend,
        "ghost_followers": ghost_followers,
        "ghost_count": len(ghost_followers),
        "ghost_percentage": (
            round(len(ghost_followers) / len(follower_ids) * 100, 1)
            if follower_ids else 0
        ),
        "active_followers": active_followers,
        "active_count": len(active_followers),
        "non_follower_engagers": non_follower_engagers,
        "loyal_followers": loyal_followers,
        "loyal_count": len(loyal_followers),
        "story_viewer_count": len(story_viewer_ids),
        "story_reach_followers": story_reach_followers,
        "story_reach_pct": round(story_reach_pct, 1),
        "story_viewer_list": story_viewer_list,
        "has_stories": len(story_viewers) > 0,
    }


def get_timeline(username: str, db_path: str = None) -> list[dict]:
    """Get the follower/following count timeline across all sessions."""
    kwargs = {"db_path": db_path} if db_path else {}
    sessions = get_all_sessions(username, **kwargs)
    return [
        {
            "date": s["scraped_at"],
            "follower_count": s["follower_count"],
            "following_count": s["following_count"],
        }
        for s in sessions
    ]
