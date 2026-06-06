"""
Database layer for Instagram Analytics.
Uses SQLite to store follower/following snapshots across scraping sessions.
"""

import sqlite3
import os
from datetime import datetime
from typing import Optional

DB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "UserData", "data")
DB_PATH = os.path.join(DB_DIR, "instagram_analytics.db")


def get_db_path_for_profile(username: str) -> str:
    """Return the database file path for a given profile username."""
    safe_name = "".join(c if c.isalnum() or c in ("_", "-", ".") else "_" for c in username)
    return os.path.join(DB_DIR, f"{safe_name}.db")


def get_connection(db_path: str = DB_PATH) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(db_path: str = DB_PATH):
    conn = get_connection(db_path)
    cursor = conn.cursor()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS scrape_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scraped_at TEXT NOT NULL,
            username TEXT NOT NULL,
            follower_count INTEGER NOT NULL,
            following_count INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS followers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            full_name TEXT DEFAULT '',
            FOREIGN KEY (session_id) REFERENCES scrape_sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS following (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            full_name TEXT DEFAULT '',
            FOREIGN KEY (session_id) REFERENCES scrape_sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_followers_session ON followers(session_id);
        CREATE INDEX IF NOT EXISTS idx_followers_user_id ON followers(user_id);
        CREATE INDEX IF NOT EXISTS idx_following_session ON following(session_id);
        CREATE INDEX IF NOT EXISTS idx_following_user_id ON following(user_id);

        CREATE TABLE IF NOT EXISTS media_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            media_pk TEXT NOT NULL,
            media_type INTEGER NOT NULL,
            product_type TEXT DEFAULT '',
            taken_at TEXT,
            caption TEXT DEFAULT '',
            like_count INTEGER DEFAULT 0,
            comment_count INTEGER DEFAULT 0,
            view_count INTEGER DEFAULT 0,
            play_count INTEGER DEFAULT 0,
            video_duration REAL DEFAULT 0,
            location TEXT DEFAULT '',
            usertags_count INTEGER DEFAULT 0,
            carousel_count INTEGER DEFAULT 0,
            is_paid_partnership INTEGER DEFAULT 0,
            code TEXT DEFAULT '',
            FOREIGN KEY (session_id) REFERENCES scrape_sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS media_interactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            media_pk TEXT NOT NULL,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            interaction_type TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES scrape_sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS story_viewers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            story_pk TEXT NOT NULL,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES scrape_sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_media_items_session ON media_items(session_id);
        CREATE INDEX IF NOT EXISTS idx_media_interactions_session ON media_interactions(session_id);
        CREATE INDEX IF NOT EXISTS idx_media_interactions_user ON media_interactions(user_id);
        CREATE INDEX IF NOT EXISTS idx_story_viewers_session ON story_viewers(session_id);
    """)

    # Migrate existing DBs: add new media_items columns if missing
    _new_cols = [
        ("play_count", "INTEGER DEFAULT 0"),
        ("video_duration", "REAL DEFAULT 0"),
        ("location", "TEXT DEFAULT ''"),
        ("usertags_count", "INTEGER DEFAULT 0"),
        ("carousel_count", "INTEGER DEFAULT 0"),
        ("is_paid_partnership", "INTEGER DEFAULT 0"),
    ]
    cursor.execute("PRAGMA table_info(media_items)")
    existing = {row["name"] for row in cursor.fetchall()}
    for col_name, col_def in _new_cols:
        if col_name not in existing:
            cursor.execute(
                f"ALTER TABLE media_items ADD COLUMN {col_name} {col_def}"
            )

    conn.commit()
    conn.close()


def create_session(username: str, follower_count: int, following_count: int,
                   db_path: str = DB_PATH) -> int:
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO scrape_sessions (scraped_at, username, follower_count, following_count) VALUES (?, ?, ?, ?)",
        (datetime.now().isoformat(), username, follower_count, following_count)
    )
    session_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return session_id


def store_followers(session_id: int, followers: list[dict], db_path: str = DB_PATH):
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.executemany(
        "INSERT INTO followers (session_id, user_id, username, full_name) VALUES (?, ?, ?, ?)",
        [(session_id, f["user_id"], f["username"], f.get("full_name", "")) for f in followers]
    )
    conn.commit()
    conn.close()


def store_following(session_id: int, following: list[dict], db_path: str = DB_PATH):
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.executemany(
        "INSERT INTO following (session_id, user_id, username, full_name) VALUES (?, ?, ?, ?)",
        [(session_id, f["user_id"], f["username"], f.get("full_name", "")) for f in following]
    )
    conn.commit()
    conn.close()


def get_latest_session(username: str, db_path: str = DB_PATH) -> Optional[dict]:
    """Get the most recent scrape session for a user."""
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM scrape_sessions WHERE username = ? ORDER BY id DESC LIMIT 1",
        (username,)
    )
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def get_previous_session(username: str, db_path: str = DB_PATH) -> Optional[dict]:
    """Get the second-most-recent scrape session (i.e., the one before the latest)."""
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM scrape_sessions WHERE username = ? ORDER BY id DESC LIMIT 1 OFFSET 1",
        (username,)
    )
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def get_session_followers(session_id: int, db_path: str = DB_PATH) -> list[dict]:
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT user_id, username, full_name FROM followers WHERE session_id = ?",
                   (session_id,))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def get_session_following(session_id: int, db_path: str = DB_PATH) -> list[dict]:
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT user_id, username, full_name FROM following WHERE session_id = ?",
                   (session_id,))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def get_all_sessions(username: str, db_path: str = DB_PATH) -> list[dict]:
    """Get all scrape sessions for timeline view."""
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM scrape_sessions WHERE username = ? ORDER BY id ASC",
        (username,)
    )
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def store_media_items(session_id: int, items: list[dict],
                      db_path: str = DB_PATH):
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.executemany(
        "INSERT INTO media_items "
        "(session_id, media_pk, media_type, product_type, taken_at, "
        " caption, like_count, comment_count, view_count, "
        " play_count, video_duration, location, usertags_count, "
        " carousel_count, is_paid_partnership, code) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (session_id, m["media_pk"], m["media_type"],
             m.get("product_type", ""), m.get("taken_at", ""),
             m.get("caption", ""), m.get("like_count", 0),
             m.get("comment_count", 0), m.get("view_count", 0),
             m.get("play_count", 0), m.get("video_duration", 0),
             m.get("location", ""), m.get("usertags_count", 0),
             m.get("carousel_count", 0),
             int(m.get("is_paid_partnership", False)),
             m.get("code", ""))
            for m in items
        ],
    )
    conn.commit()
    conn.close()


def store_media_interactions(session_id: int, interactions: list[dict],
                             db_path: str = DB_PATH):
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.executemany(
        "INSERT INTO media_interactions "
        "(session_id, media_pk, user_id, username, interaction_type) "
        "VALUES (?, ?, ?, ?, ?)",
        [
            (session_id, i["media_pk"], i["user_id"],
             i["username"], i["interaction_type"])
            for i in interactions
        ],
    )
    conn.commit()
    conn.close()


def store_story_viewers(session_id: int, viewers: list[dict],
                        db_path: str = DB_PATH):
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.executemany(
        "INSERT INTO story_viewers "
        "(session_id, story_pk, user_id, username) VALUES (?, ?, ?, ?)",
        [
            (session_id, v["story_pk"], v["user_id"], v["username"])
            for v in viewers
        ],
    )
    conn.commit()
    conn.close()


def get_session_media_items(session_id: int,
                            db_path: str = DB_PATH) -> list[dict]:
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT media_pk, media_type, product_type, taken_at, caption, "
        "like_count, comment_count, view_count, play_count, "
        "video_duration, location, usertags_count, carousel_count, "
        "is_paid_partnership, code "
        "FROM media_items WHERE session_id = ? ORDER BY id ASC",
        (session_id,),
    )
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def get_session_media_interactions(session_id: int,
                                   db_path: str = DB_PATH) -> list[dict]:
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT media_pk, user_id, username, interaction_type "
        "FROM media_interactions WHERE session_id = ?",
        (session_id,),
    )
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def get_session_story_viewers(session_id: int,
                              db_path: str = DB_PATH) -> list[dict]:
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT story_pk, user_id, username "
        "FROM story_viewers WHERE session_id = ?",
        (session_id,),
    )
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def has_engagement_data(session_id: int, db_path: str = DB_PATH) -> bool:
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT COUNT(*) FROM media_items WHERE session_id = ?",
        (session_id,),
    )
    count = cursor.fetchone()[0]
    conn.close()
    return count > 0


def purge_db(db_path: str = DB_PATH):
    """Delete the database file entirely. init_db() will recreate it on next use."""
    if os.path.exists(db_path):
        os.remove(db_path)
        # Also remove WAL/SHM files if they exist
        for suffix in ("-wal", "-shm"):
            p = db_path + suffix
            if os.path.exists(p):
                os.remove(p)
