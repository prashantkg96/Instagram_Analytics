"""
Instagram Analytics — GUI Application
Scrapes follower/following data, stores in SQLite, and shows analytics in a desktop UI.
"""

import json
import os
import random
import shutil
import threading
import time
import tkinter as tk
import webbrowser
from tkinter import ttk, messagebox, simpledialog
from io import BytesIO

try:
    from PIL import Image, ImageTk, ImageDraw
    HAS_PIL = True
except ImportError:
    HAS_PIL = False
import requests as _requests

from db import (
    init_db, create_session, store_followers, store_following,
    get_all_sessions, get_session_followers, get_session_following,
    get_db_path_for_profile, purge_db,
    store_media_items, store_media_interactions, store_story_viewers,
    get_session_media_items, get_session_media_interactions,
    get_session_story_viewers, has_engagement_data,
    get_last_engagement_time,
)
from scraper import (
    scrape_followers_and_following, unfollow_users, get_last_client,
    get_last_client_username, check_session,
    scrape_engagement, IGRateLimitError, IGTimeoutError,
    scrape_post_for_giveaway, login_only, session_keepalive,
)
from analytics import (
    generate_full_report, get_timeline, compute_account_insights,
    compute_engagement_report,
)

import base64 as _b64

APP_DIR = os.path.dirname(os.path.abspath(__file__))
USERDATA_DIR = os.path.join(APP_DIR, "UserData")
ICON_PATH = os.path.join(APP_DIR, "app_icon.ico")
CREDS_PATH = os.path.join(USERDATA_DIR, "saved_accounts.json")
PHOTO_DIR = os.path.join(USERDATA_DIR, "profile_photos")

os.makedirs(USERDATA_DIR, exist_ok=True)


class _Cancelled(Exception):
    """Raised inside worker threads when the user clicks Cancel."""


def _migrate_legacy_paths():
    """Move data from old flat layout into UserData/ on first run."""
    moves = [
        (os.path.join(APP_DIR, "data"), os.path.join(USERDATA_DIR, "data")),
        (os.path.join(APP_DIR, "profile_photos"), os.path.join(USERDATA_DIR, "profile_photos")),
        (os.path.join(APP_DIR, "saved_accounts.json"), CREDS_PATH),
        (os.path.join(APP_DIR, "ig_session.json"),
         os.path.join(USERDATA_DIR, "ig_session.json")),
    ]
    for src, dst in moves:
        if os.path.exists(src) and not os.path.exists(dst):
            try:
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.move(src, dst)
            except Exception:
                pass


_migrate_legacy_paths()


# ── Theme definitions ────────────────────────────────────────────────────────

THEMES = {
    "dark": {
        "BG":           "#0a0a0a",
        "BG_CARD":      "#141414",
        "BG_CARD2":     "#1c1c1c",
        "FG":           "#e8e8e8",
        "FG_DIM":       "#6b6b6b",
        "FG_MUTED":     "#404040",
        "ACCENT":       "#E1306C",
        "GREEN":        "#4ade80",
        "RED":          "#f87171",
        "YELLOW":       "#facc15",
        "MAGENTA":      "#c084fc",
        "CYAN":         "#22d3ee",
        "BLUE":         "#60a5fa",
        "ENTRY_BG":     "#1a1a1a",
        "BTN_BG":       "#E1306C",
        "BTN_FG":       "#ffffff",
        "BTN_HOVER":    "#c7245c",
        "BTN_SEC":      "#1e1e1e",
        "BTN_SEC_HVR":  "#2a2a2a",
        "TAB_SEL":      "#E1306C",
        "BORDER":       "#2a2a2a",
        "CARD_BORDER":  "#1e1e1e",
        "PROGRESS_BG":  "#1a1a1a",
        "PROGRESS_FG":  "#E1306C",
        "STRIPE":       "#111111",
        "TAB_FOLLOW":   "#5b21b6",
        "TAB_ENGAGE":   "#0e7490",
        "TAB_OTHER":    "#374151",
    },
    "light": {
        "BG":           "#f8f9fa",
        "BG_CARD":      "#ffffff",
        "BG_CARD2":     "#f0f0f0",
        "FG":           "#1a1a1a",
        "FG_DIM":       "#888888",
        "FG_MUTED":     "#b0b0b0",
        "ACCENT":       "#E1306C",
        "GREEN":        "#16a34a",
        "RED":          "#dc2626",
        "YELLOW":       "#ca8a04",
        "MAGENTA":      "#9333ea",
        "CYAN":         "#0891b2",
        "BLUE":         "#2563eb",
        "ENTRY_BG":     "#eaeaea",
        "BTN_BG":       "#E1306C",
        "BTN_FG":       "#ffffff",
        "BTN_HOVER":    "#c7245c",
        "BTN_SEC":      "#e5e5e5",
        "BTN_SEC_HVR":  "#d5d5d5",
        "TAB_SEL":      "#E1306C",
        "BORDER":       "#d0d0d0",
        "CARD_BORDER":  "#e0e0e0",
        "PROGRESS_BG":  "#e0e0e0",
        "PROGRESS_FG":  "#E1306C",
        "STRIPE":       "#f4f4f4",
        "TAB_FOLLOW":   "#7c3aed",
        "TAB_ENGAGE":   "#0891b2",
        "TAB_OTHER":    "#6b7280",
    },
}


# ── Tooltip helper ───────────────────────────────────────────────────────────

class _ToolTip:
    """Simple hover tooltip."""

    def __init__(self, widget, text):
        self.widget = widget
        self.text = text
        self.tip = None
        widget.bind("<Enter>", self._show)
        widget.bind("<Leave>", self._hide)

    def _show(self, _event=None):
        x = self.widget.winfo_rootx() + 20
        y = self.widget.winfo_rooty() + self.widget.winfo_height() + 2
        self.tip = tw = tk.Toplevel(self.widget)
        tw.wm_overrideredirect(True)
        tw.wm_geometry(f"+{x}+{y}")
        tk.Label(tw, text=self.text, background="#333", foreground="#fff",
                 font=("Segoe UI", 9), padx=8, pady=4, relief="solid", bd=1).pack()

    def _hide(self, _event=None):
        if self.tip:
            self.tip.destroy()
            self.tip = None


# ── Profile photo helpers ────────────────────────────────────────────────────

def _download_photo(url: str, username: str, size: int = 32,
                    photo_dir: str = PHOTO_DIR) -> str | None:
    if not url or not HAS_PIL:
        return None
    os.makedirs(photo_dir, exist_ok=True)
    path = os.path.join(photo_dir, f"{username}_{size}.png")
    if os.path.exists(path):
        return path
    try:
        resp = _requests.get(url, timeout=10)
        resp.raise_for_status()
        img = Image.open(BytesIO(resp.content)).convert("RGBA")
        img = img.resize((size, size), Image.LANCZOS)
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, size, size), fill=255)
        img.putalpha(mask)
        img.save(path, "PNG")
        return path
    except Exception:
        return None


def _load_photo_tk(path: str):
    if not path or not HAS_PIL or not os.path.exists(path):
        return None
    try:
        return ImageTk.PhotoImage(Image.open(path))
    except Exception:
        return None


# ── Hover effect helper ──────────────────────────────────────────────────────

def _hover_bind(btn, normal_bg, hover_bg):
    """Add hover color transition to a button."""
    btn.bind("<Enter>", lambda e: btn.configure(bg=hover_bg))
    btn.bind("<Leave>", lambda e: btn.configure(bg=normal_bg))


# ── Main application ─────────────────────────────────────────────────────────

class InstagramAnalyticsApp:

    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Instagram Analytics")
        self.root.minsize(1100, 700)
        self.root.geometry("1180x800")

        if os.path.exists(ICON_PATH):
            self.root.iconbitmap(ICON_PATH)

        self.current_theme = "dark"
        self.t = THEMES[self.current_theme]
        self.root.configure(bg=self.t["BG"])

        self._saved_accounts = self._load_accounts()
        self._photo_refs: list = []
        self._action_tables: dict = {}  # key -> {"tree": Treeview, "users": list}
        self._last_report = None
        self._last_username = ""
        self._last_eng_report = None
        self._cancel_event = threading.Event()
        self._keepalive_id = None
        self._logged_in_user: str | None = None
        self._build_ui()
        self._show_disclaimer()

    # ── Disclaimer ───────────────────────────────────────────────────────

    def _show_disclaimer(self):
        flag_file = os.path.join(USERDATA_DIR, ".disclaimer_accepted")
        if os.path.exists(flag_file):
            return

        msg = (
            "DISCLAIMER — PLEASE READ\n\n"
            "This application uses instagrapi, an unofficial, "
            "third-party library that interacts with Instagram's "
            "private API.\n\n"
            "• Using unofficial API clients violates Instagram's "
            "Terms of Service and may result in temporary or "
            "permanent account restrictions, including bans.\n\n"
            "• This tool is provided for educational and personal "
            "use only. The developer assumes no responsibility for "
            "any consequences to your account.\n\n"
            "• By clicking OK you acknowledge these risks and agree "
            "that you use this application entirely at your own risk."
        )
        accepted = messagebox.askokcancel(
            "Disclaimer — Use at Your Own Risk", msg, icon="warning",
        )
        if accepted:
            try:
                with open(flag_file, "w") as f:
                    f.write("accepted")
            except OSError:
                pass
        else:
            self.root.destroy()

    # ── DB helpers ───────────────────────────────────────────────────────

    def _safe_username(self, username: str = None) -> str:
        u = username or self.username_var.get().strip() or "default"
        return "".join(c if c.isalnum() or c in ("_", "-", ".") else "_" for c in u)

    def _get_db_path(self) -> str:
        username = self.username_var.get().strip()
        return get_db_path_for_profile(username or "default")

    def _get_photo_dir(self, username: str = None) -> str:
        safe = self._safe_username(username)
        return os.path.join(USERDATA_DIR, safe, "profile_photos")

    def _ensure_db(self, db_path: str = None):
        init_db(db_path or self._get_db_path())

    # ── Account persistence ──────────────────────────────────────────────

    def _load_accounts(self) -> dict:
        if os.path.exists(CREDS_PATH):
            try:
                with open(CREDS_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return {u: (_b64.b64decode(p).decode() if p else "")
                        for u, p in data.items()}
            except Exception:
                return {}
        return {}

    def _save_accounts(self):
        os.makedirs(os.path.dirname(CREDS_PATH), exist_ok=True)
        data = {u: (_b64.b64encode(p.encode()).decode() if p else "")
                for u, p in self._saved_accounts.items()}
        with open(CREDS_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def _refresh_username_dropdown(self):
        self.combo_user["values"] = list(self._saved_accounts.keys())

    def _on_username_selected(self, _event=None):
        username = self.username_var.get().strip()
        pw = self._saved_accounts.get(username, "")
        if pw:
            self.password_var.set(pw)
            self.save_pw_var.set(True)
        else:
            self.password_var.set("")
            self.save_pw_var.set(False)
        self._update_own_photo(username)
        # Auto-load last report if data exists for this user
        self._auto_load_last_report(username)
        # Check if this user already has an active session
        self._check_login_state(username)

    def _check_login_state(self, username: str):
        """Grey out the login button if this user already has a live session."""
        # Case 1: we already verified this user in-memory
        if self._logged_in_user == username:
            self.btn_login.configure(
                state="disabled", text="\u2705 Already logged in",
            )
            return
        # Reset login button for a different user
        self._logged_in_user = None
        # Case 2: session file exists → show loading and verify in background
        pw = self.password_var.get().strip()
        if not pw:
            t = THEMES[self.current_theme]
            self.btn_login.configure(
                state="normal",
                text="\U0001F511 Login",
                bg=t["BTN_BG"], fg=t["BTN_FG"],
            )
            return
        # Disable button and show a spinner while checking
        self.btn_login.configure(
            state="disabled", text="\u23F3 Checking...",
        )

        def _bg_check():
            alive = check_session(username, pw)
            if alive:
                self.root.after(0, self._mark_logged_in, username)
            else:
                # Session expired or missing — enable login button
                def _enable():
                    # Guard: user may have switched to another account
                    if self.username_var.get().strip() != username:
                        return
                    t = THEMES[self.current_theme]
                    self.btn_login.configure(
                        state="normal",
                        text="\U0001F511 Login",
                        bg=t["BTN_BG"], fg=t["BTN_FG"],
                    )
                self.root.after(0, _enable)

        threading.Thread(target=_bg_check, daemon=True).start()

    def _mark_logged_in(self, username: str):
        """Update UI to reflect that *username* has an active session."""
        self._logged_in_user = username
        # Only update if the user hasn't switched to a different account
        if self.username_var.get().strip() == username:
            self.btn_login.configure(
                state="disabled", text="\u2705 Already logged in",
            )
            self._set_status(f"Session active for @{username}")
            self._start_keepalive()

    def _auto_load_last_report(self, username: str):
        """Load and display the most recent report for *username* if available."""
        if not username:
            return
        db_path = self._get_db_path()
        if not os.path.exists(db_path):
            return
        self._ensure_db(db_path)
        sessions = get_all_sessions(username, db_path=db_path)
        if not sessions:
            return
        latest = sessions[-1]
        current_followers = get_session_followers(
            latest["id"], db_path=db_path,
        )
        current_following = get_session_following(
            latest["id"], db_path=db_path,
        )
        report = generate_full_report(
            username=username, current_session_id=latest["id"],
            current_followers=current_followers,
            current_following=current_following, db_path=db_path,
        )
        self._display_report(report, username)
        self._set_status(
            f"Loaded report from session #{latest['id']} "
            f"({latest['scraped_at'][:19]})",
        )

    def _update_own_photo(self, username: str):
        if not HAS_PIL:
            return
        photo_dir = self._get_photo_dir(username)
        photo_path = os.path.join(photo_dir, f"{username}_48.png")
        img = _load_photo_tk(photo_path)
        if img:
            self._own_photo_ref = img
            self.lbl_own_photo.configure(image=img)
        else:
            self._own_photo_ref = None
            self.lbl_own_photo.configure(image="")

    def _on_save_account(self):
        username = self.username_var.get().strip()
        if not username:
            return
        pw = self.password_var.get() if self.save_pw_var.get() else ""
        self._saved_accounts[username] = pw
        self._save_accounts()
        self._refresh_username_dropdown()

    def _on_delete_account(self):
        username = self.username_var.get().strip()
        if not username:
            messagebox.showwarning("No Username", "Enter a username first.")
            return
        if username not in self._saved_accounts:
            messagebox.showinfo("Not Found", f"@{username} is not in saved accounts.")
            return
        if not messagebox.askyesno("Delete Account",
                                   f"Remove @{username} from saved accounts?"):
            return
        del self._saved_accounts[username]
        self._save_accounts()
        self._refresh_username_dropdown()
        self.username_var.set("")
        self.password_var.set("")
        self._set_status(f"Account @{username} removed.")

    # ── UI construction ──────────────────────────────────────────────────

    def _build_ui(self):
        t = self.t

        # ── Row 1: Title + Credentials ──
        self.top_frame = tk.Frame(self.root, bg=t["BG"], padx=20, pady=12)
        self.top_frame.pack(fill="x")

        self.lbl_title = tk.Label(
            self.top_frame, text="Instagram Analytics",
            font=("Segoe UI", 17, "bold"), bg=t["BG"], fg=t["ACCENT"],
        )
        self.lbl_title.pack(side="left", padx=(0, 6))

        self._own_photo_ref = None
        self.lbl_own_photo = tk.Label(self.top_frame, bg=t["BG"])
        self.lbl_own_photo.pack(side="left", padx=(0, 16))

        self.lbl_user = tk.Label(
            self.top_frame, text="Username", bg=t["BG"], fg=t["FG"],
            font=("Segoe UI", 10),
        )
        self.lbl_user.pack(side="left")

        self.username_var = tk.StringVar()
        self.combo_user = ttk.Combobox(
            self.top_frame, textvariable=self.username_var,
            width=18, font=("Segoe UI", 10),
            values=list(self._saved_accounts.keys()),
        )
        self.combo_user.pack(side="left", padx=4, ipady=3)
        self.combo_user.bind("<<ComboboxSelected>>", self._on_username_selected)

        self.btn_del_acct = tk.Button(
            self.top_frame, text="\u2716", command=self._on_delete_account,
            bg=t["BTN_SEC"], fg=t["RED"], relief="flat",
            font=("Segoe UI", 10), padx=4, pady=0, cursor="hand2", bd=0,
        )
        self.btn_del_acct.pack(side="left", padx=(0, 14))
        _ToolTip(self.btn_del_acct, "Remove from saved accounts")
        _hover_bind(self.btn_del_acct, t["BTN_SEC"], t["BTN_SEC_HVR"])

        self.lbl_pass = tk.Label(
            self.top_frame, text="Password", bg=t["BG"], fg=t["FG"],
            font=("Segoe UI", 10),
        )
        self.lbl_pass.pack(side="left")

        self.password_var = tk.StringVar()
        self.entry_pass = tk.Entry(
            self.top_frame, textvariable=self.password_var,
            show="\u2022", width=18,
            bg=t["ENTRY_BG"], fg=t["FG"], insertbackground=t["FG"],
            relief="flat", font=("Segoe UI", 10), bd=0,
        )
        self.entry_pass.pack(side="left", padx=4, ipady=4)

        self.save_pw_var = tk.BooleanVar(value=False)
        self.chk_save_pw = tk.Checkbutton(
            self.top_frame, text="Save", variable=self.save_pw_var,
            bg=t["BG"], fg=t["FG_DIM"], selectcolor=t["ENTRY_BG"],
            activebackground=t["BG"], activeforeground=t["FG"],
            font=("Segoe UI", 9), cursor="hand2",
        )
        self.chk_save_pw.pack(side="left", padx=(0, 4))

        self.btn_login = tk.Button(
            self.top_frame, text="\U0001F511 Login",
            command=self._on_login,
            bg=t["BTN_BG"], fg=t["BTN_FG"], relief="flat",
            font=("Segoe UI", 9, "bold"),
            padx=10, pady=2, cursor="hand2", bd=0,
        )
        self.btn_login.pack(side="left", padx=(0, 8))
        _hover_bind(self.btn_login, t["BTN_BG"], t["BTN_HOVER"])
        _ToolTip(self.btn_login,
                 "Establish a session without scraping.\n"
                 "Useful for the Winner tab.")

        self.btn_theme = tk.Button(
            self.top_frame, text="\u263e", command=self._toggle_theme,
            bg=t["BTN_SEC"], fg=t["FG"], relief="flat",
            font=("Segoe UI", 14), padx=8, pady=0, cursor="hand2", bd=0,
        )
        self.btn_theme.pack(side="right", padx=4)
        _hover_bind(self.btn_theme, t["BTN_SEC"], t["BTN_SEC_HVR"])

        # ── Row 2: Primary actions ──
        self.btn_frame = tk.Frame(self.root, bg=t["BG"], padx=20, pady=4)
        self.btn_frame.pack(fill="x")

        self.btn_scrape = tk.Button(
            self.btn_frame,
            text="\u25b6  Scan Followers & Following",
            command=self._on_scrape,
            bg="#5b21b6", fg="#fff", activebackground="#7c3aed",
            relief="flat", font=("Segoe UI", 11, "bold"),
            padx=20, pady=6, cursor="hand2", bd=0,
        )
        self.btn_scrape.pack(side="left", padx=(0, 6))
        _hover_bind(self.btn_scrape, "#5b21b6", "#7c3aed")

        self.btn_engagement = tk.Button(
            self.btn_frame,
            text="\U0001F4CA  Analyze Engagement",
            command=self._on_engagement,
            bg="#0e7490", fg="#fff", activebackground="#0891b2",
            relief="flat", font=("Segoe UI", 11, "bold"),
            padx=14, pady=6, cursor="hand2", bd=0,
        )
        self.btn_engagement.pack(side="left", padx=3)
        _hover_bind(self.btn_engagement, "#0e7490", "#0891b2")

        # Media count input
        self.lbl_media_n = tk.Label(
            self.btn_frame, text="Posts:", bg=t["BG"], fg=t["FG_DIM"],
            font=("Segoe UI", 9),
        )
        self.lbl_media_n.pack(side="left", padx=(8, 2))

        self.media_count_var = tk.StringVar(value="10")
        self.entry_media_n = tk.Entry(
            self.btn_frame, textvariable=self.media_count_var,
            width=4, bg=t["ENTRY_BG"], fg=t["FG"],
            insertbackground=t["FG"], relief="flat",
            font=("Segoe UI", 10), bd=0, justify="center",
        )
        self.entry_media_n.pack(side="left", ipady=3)
        self.media_count_var.trace_add("write", self._validate_media_count)

        self.lbl_media_warn = tk.Label(
            self.btn_frame, text="", bg=t["BG"], fg=t["RED"],
            font=("Segoe UI", 8),
        )
        self.lbl_media_warn.pack(side="left", padx=(4, 0))

        # Destructive buttons (right-aligned)
        self.btn_purge_creds = tk.Button(
            self.btn_frame, text="Delete Saved Credentials",
            command=self._on_purge_creds,
            bg="#7f1d1d", fg="#fca5a5", activebackground="#991b1b",
            relief="flat", font=("Segoe UI", 9),
            padx=12, pady=4, cursor="hand2", bd=0,
        )
        self.btn_purge_creds.pack(side="right", padx=3)
        _ToolTip(self.btn_purge_creds,
                 "Delete all saved usernames & passwords")
        _hover_bind(self.btn_purge_creds, "#7f1d1d", "#991b1b")

        self.btn_purge = tk.Button(
            self.btn_frame, text="Delete Analytics Data",
            command=self._on_purge,
            bg="#7f1d1d", fg="#fca5a5", activebackground="#991b1b",
            relief="flat", font=("Segoe UI", 9),
            padx=12, pady=4, cursor="hand2", bd=0,
        )
        self.btn_purge.pack(side="right", padx=3)
        _ToolTip(self.btn_purge,
                 "Delete all scraped data & photos for current profile")
        _hover_bind(self.btn_purge, "#7f1d1d", "#991b1b")

        # ── Progress bar (hidden until an operation starts) ──
        self.progress_frame = tk.Frame(self.root, bg=t["BG"], padx=20)

        self.progress_label = tk.Label(
            self.progress_frame, text="Working...",
            bg=t["BG"], fg=t["FG_DIM"], font=("Segoe UI", 9), anchor="w",
        )
        self.progress_label.pack(fill="x", pady=(4, 2))

        bar_row = tk.Frame(self.progress_frame, bg=t["BG"])
        bar_row.pack(fill="x", pady=(0, 6))

        self.progress_bar = ttk.Progressbar(
            bar_row, mode="indeterminate", length=400,
        )
        self.progress_bar.pack(side="left", fill="x", expand=True)

        self.btn_cancel = tk.Button(
            bar_row, text="✖ Cancel", command=self._on_cancel,
            bg="#7f1d1d", fg="#fca5a5", activebackground="#991b1b",
            relief="flat", font=("Segoe UI", 9, "bold"),
            padx=10, pady=1, cursor="hand2", bd=0,
        )
        self.btn_cancel.pack(side="right", padx=(8, 0))
        _hover_bind(self.btn_cancel, "#7f1d1d", "#991b1b")

        # ── Separator ──
        self.sep = ttk.Separator(self.root, orient="horizontal")
        self.sep.pack(fill="x", padx=16)

        # ── Status bar ──
        self.status_var = tk.StringVar(value="Ready.")
        self.status_bar = tk.Label(
            self.root, textvariable=self.status_var,
            bg=t["BG_CARD"], fg=t["FG_DIM"], anchor="w",
            font=("Segoe UI", 9), padx=20, pady=5,
        )
        self.status_bar.pack(fill="x")

        # ── Notebook ──
        self._nb_wrapper = tk.Frame(
            self.root, bg=t["BORDER"], bd=0,
            highlightbackground=t["BORDER"], highlightthickness=1,
        )
        self._nb_wrapper.pack(fill="both", expand=True, padx=10, pady=(6, 10))
        self.notebook = ttk.Notebook(self._nb_wrapper)
        self.notebook.pack(fill="both", expand=True)

        self._apply_ttk_style()

        self.summary_frame = tk.Frame(self.notebook, bg=t["BG"])
        self.notebook.add(self.summary_frame, text="  Summary  ")

        self.nfb_frame = tk.Frame(self.notebook, bg=t["BG"])
        self.notebook.add(self.nfb_frame, text="  Don't Follow Back  ")

        self.fans_frame = tk.Frame(self.notebook, bg=t["BG"])
        self.notebook.add(self.fans_frame, text="  Fans  ")

        self.unf_frame = tk.Frame(self.notebook, bg=t["BG"])
        self.notebook.add(self.unf_frame, text="  Unfollowers  ")

        self.new_frame = tk.Frame(self.notebook, bg=t["BG"])
        self.notebook.add(self.new_frame, text="  New Followers  ")

        self.content_frame = tk.Frame(self.notebook, bg=t["BG"])
        self.notebook.add(self.content_frame, text="  Content  ")

        self.engage_frame = tk.Frame(self.notebook, bg=t["BG"])
        self.notebook.add(self.engage_frame, text="  Engagement  ")

        self.ghost_frame = tk.Frame(self.notebook, bg=t["BG"])
        self.notebook.add(self.ghost_frame, text="  Ghosts  ")

        self.timeline_frame = tk.Frame(self.notebook, bg=t["BG"])
        self.notebook.add(self.timeline_frame, text="  Timeline  ")

        self.winner_frame = tk.Frame(self.notebook, bg=t["BG"])
        self.notebook.add(self.winner_frame, text="  Winner  ")

        self.log_frame = tk.Frame(self.notebook, bg=t["BG"])
        self.notebook.add(self.log_frame, text="  Log  ")

        log_toolbar = tk.Frame(self.log_frame, bg=t["BG"])
        log_toolbar.pack(fill="x", padx=10, pady=(8, 0))
        self.btn_clear_log = tk.Button(
            log_toolbar, text="\U0001F5D1 Clear Log",
            command=self._on_clear_log,
            bg=t["BTN_SEC"], fg=t["FG"], relief="flat",
            font=("Segoe UI", 9), padx=10, pady=2, cursor="hand2", bd=0,
        )
        self.btn_clear_log.pack(side="right")
        _hover_bind(self.btn_clear_log, t["BTN_SEC"], t["BTN_SEC_HVR"])

        self.log_text = tk.Text(
            self.log_frame, bg=t["BG_CARD"], fg=t["FG"],
            font=("Cascadia Code", 10), relief="flat", wrap="word",
            state="disabled", insertbackground=t["FG"], bd=0,
        )
        self.log_text.pack(fill="both", expand=True, padx=10, pady=(6, 10))

        self._apply_tab_colors()
        self._build_winner_tab()

    # ── TTK styling ──────────────────────────────────────────────────────

    def _apply_ttk_style(self):
        t = self.t
        style = ttk.Style()
        style.theme_use("default")

        style.configure("TNotebook", background=t["BG"], borderwidth=0)
        style.configure(
            "TNotebook.Tab", background=t["BG_CARD"], foreground=t["FG"],
            padding=[16, 7], font=("Segoe UI", 10),
        )
        style.map(
            "TNotebook.Tab",
            background=[("selected", t["TAB_SEL"])],
            foreground=[("selected", "#ffffff")],
        )

        style.configure(
            "Treeview", background=t["BG_CARD"], foreground=t["FG"],
            fieldbackground=t["BG_CARD"], font=("Segoe UI", 10),
            rowheight=38 if HAS_PIL else 26,
        )
        style.configure(
            "Treeview.Heading", background=t["ENTRY_BG"],
            foreground=t["ACCENT"], font=("Segoe UI", 10, "bold"),
        )
        style.map(
            "Treeview",
            background=[("selected", t["ACCENT"])],
            foreground=[("selected", "#ffffff")],
        )

        style.configure(
            "TCombobox",
            fieldbackground=t["ENTRY_BG"], background=t["ENTRY_BG"],
            foreground=t["FG"], selectbackground=t["ACCENT"],
            selectforeground="#fff",
        )
        style.map(
            "TCombobox",
            fieldbackground=[("readonly", t["ENTRY_BG"])],
            foreground=[("readonly", t["FG"])],
        )

        style.configure(
            "TProgressbar",
            background=t["PROGRESS_FG"],
            troughcolor=t["PROGRESS_BG"],
            borderwidth=0, thickness=4,
        )

        style.configure(
            "Vertical.TScrollbar",
            background=t["BG_CARD2"],
            troughcolor=t["BG"],
            borderwidth=0, relief="flat",
            arrowcolor=t["FG_DIM"],
        )
        style.map(
            "Vertical.TScrollbar",
            background=[("active", t["FG_DIM"])],
        )

    def _apply_tab_colors(self):
        """Color-code notebook tabs by category."""
        t = self.t
        # follower-analytics tabs: purple
        follow_tabs = (
            self.nfb_frame, self.fans_frame,
            self.unf_frame, self.new_frame,
        )
        # engagement tabs: teal
        engage_tabs = (
            self.content_frame, self.engage_frame, self.ghost_frame,
        )
        # other tabs: grey
        other_tabs = (
            self.summary_frame, self.timeline_frame, self.log_frame,
        )
        for frame in follow_tabs:
            self.notebook.tab(frame, sticky="nsew")
        for frame in engage_tabs:
            self.notebook.tab(frame, sticky="nsew")

        style = ttk.Style()
        # Use custom tab styles per category
        style.configure(
            "Follow.TNotebook.Tab",
            background=t["TAB_FOLLOW"], foreground="#fff",
            padding=[14, 6], font=("Segoe UI", 10),
        )
        style.configure(
            "Engage.TNotebook.Tab",
            background=t["TAB_ENGAGE"], foreground="#fff",
            padding=[14, 6], font=("Segoe UI", 10),
        )
        # TTK notebook doesn't support per-tab styles natively,
        # so we use the <<NotebookTabChanged>> event to color the tab bar
        # Instead, we color the tab text via the notebook.tab configure
        # We'll do this by adding colored emoji prefixes to tabs
        tab_config = {
            self.summary_frame: "\U0001F4CA Summary",
            self.nfb_frame: "\U0001F49C Don't Follow Back",
            self.fans_frame: "\U0001F49C Fans",
            self.unf_frame: "\U0001F49C Unfollowers",
            self.new_frame: "\U0001F49C New Followers",
            self.content_frame: "\U0001F30A Content",
            self.engage_frame: "\U0001F30A Engagement",
            self.ghost_frame: "\U0001F30A Ghosts",
            self.timeline_frame: "\U0001F554 Timeline",
            self.winner_frame: "\U0001F3C6 Winner",
            self.log_frame: "\U0001F4DD Log",
        }
        for frame, text in tab_config.items():
            self.notebook.tab(frame, text=f"  {text}  ")

    def _validate_media_count(self, *_args):
        """Validate the media count entry and enable/disable engagement btn."""
        val = self.media_count_var.get().strip()
        if not val:
            self.lbl_media_warn.configure(text="")
            self.btn_engagement.configure(state="normal")
            return
        try:
            n = int(val)
        except ValueError:
            self.lbl_media_warn.configure(text="Must be a number")
            self.btn_engagement.configure(state="disabled")
            return
        if n < 1:
            self.lbl_media_warn.configure(text="Min: 1")
            self.btn_engagement.configure(state="disabled")
        elif n > 200:
            self.lbl_media_warn.configure(text="Max: 200")
            self.btn_engagement.configure(state="disabled")
        else:
            self.lbl_media_warn.configure(text="")
            self.btn_engagement.configure(state="normal")

    def _get_media_count(self) -> int:
        """Get validated media count, default 30."""
        try:
            n = int(self.media_count_var.get().strip())
            return max(1, min(200, n))
        except (ValueError, AttributeError):
            return 30

    # ── Theme switching ──────────────────────────────────────────────────

    def _toggle_theme(self):
        self.current_theme = "light" if self.current_theme == "dark" else "dark"
        self.t = THEMES[self.current_theme]
        self._apply_theme()

        # Remember which tab was active so we can restore it
        try:
            active_tab = self.notebook.select()
        except Exception:
            active_tab = None

        # Re-render populated tabs so all inner widgets pick up new colors
        if self._last_report is not None:
            self._display_report(self._last_report, self._last_username)
        if self._last_eng_report is not None:
            self._display_engagement(self._last_eng_report)

        # Re-render winner tab (stateless)
        self._build_winner_tab()

        # Restore previously selected tab
        if active_tab:
            try:
                self.notebook.select(active_tab)
            except Exception:
                pass

    def _apply_theme(self):
        t = self.t
        self.root.configure(bg=t["BG"])

        # Frames
        self.top_frame.configure(bg=t["BG"])
        self.btn_frame.configure(bg=t["BG"])

        self._nb_wrapper.configure(bg=t["BORDER"],
                                   highlightbackground=t["BORDER"])
        self.progress_frame.configure(bg=t["BG"])
        self.progress_label.configure(bg=t["BG"], fg=t["FG_DIM"])
        for child in self.progress_frame.winfo_children():
            if isinstance(child, tk.Frame):
                child.configure(bg=t["BG"])

        # Title + photo
        self.lbl_title.configure(bg=t["BG"], fg=t["ACCENT"])
        self.lbl_own_photo.configure(bg=t["BG"])

        # Credential widgets
        self.lbl_user.configure(bg=t["BG"], fg=t["FG"])
        self.lbl_pass.configure(bg=t["BG"], fg=t["FG"])
        self.entry_pass.configure(
            bg=t["ENTRY_BG"], fg=t["FG"], insertbackground=t["FG"],
        )
        self.chk_save_pw.configure(
            bg=t["BG"], fg=t["FG_DIM"], selectcolor=t["ENTRY_BG"],
            activebackground=t["BG"], activeforeground=t["FG"],
        )
        self.btn_login.configure(bg=t["BTN_BG"], fg=t["BTN_FG"])
        _hover_bind(self.btn_login, t["BTN_BG"], t["BTN_HOVER"])

        # Media count input
        self.lbl_media_n.configure(bg=t["BG"], fg=t["FG_DIM"])
        self.entry_media_n.configure(
            bg=t["ENTRY_BG"], fg=t["FG"], insertbackground=t["FG"],
        )
        self.lbl_media_warn.configure(bg=t["BG"], fg=t["RED"])

        # Buttons
        self.btn_del_acct.configure(bg=t["BTN_SEC"], fg=t["RED"])
        _hover_bind(self.btn_del_acct, t["BTN_SEC"], t["BTN_SEC_HVR"])

        self.btn_theme.configure(
            bg=t["BTN_SEC"], fg=t["FG"],
            text="\u2600" if self.current_theme == "dark" else "\u263e",
        )
        _hover_bind(self.btn_theme, t["BTN_SEC"], t["BTN_SEC_HVR"])

        # Status + log
        self.status_bar.configure(bg=t["BG_CARD"], fg=t["FG_DIM"])
        self.log_text.configure(
            bg=t["BG_CARD"], fg=t["FG"], insertbackground=t["FG"],
        )
        self.btn_clear_log.configure(bg=t["BTN_SEC"], fg=t["FG"])
        _hover_bind(self.btn_clear_log, t["BTN_SEC"], t["BTN_SEC_HVR"])

        # Tab frames
        for frame in (
            self.summary_frame, self.nfb_frame, self.fans_frame,
            self.unf_frame, self.new_frame, self.content_frame,
            self.engage_frame, self.ghost_frame, self.timeline_frame,
            self.winner_frame, self.log_frame,
        ):
            frame.configure(bg=t["BG"])

        self._apply_ttk_style()
        self._apply_tab_colors()

    # ── Helpers ──────────────────────────────────────────────────────────

    def _log(self, msg: str):
        self.log_text.configure(state="normal")
        self.log_text.insert("end", msg + "\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _on_clear_log(self):
        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.configure(state="disabled")

    def _set_status(self, msg: str):
        self.status_var.set(msg)

    def _set_buttons_state(self, state: str):
        for btn in (self.btn_scrape,
                    self.btn_engagement, self.btn_purge, self.btn_purge_creds,
                    self.btn_login):
            btn.configure(state=state)
        # Keep login button greyed out if user is already logged in
        if state == "normal" and self._logged_in_user:
            current = self.username_var.get().strip()
            if current == self._logged_in_user:
                self.btn_login.configure(
                    state="disabled",
                    text="\u2705 Already logged in",
                )

    # ------ Cooldown timer for rate-limited buttons ------

    def _start_cooldown(self, button, original_text, seconds):
        """Disable *button* for *seconds*, showing a countdown on its label."""
        # Cancel any previous cooldown on this button
        prev = getattr(button, "_cd_after_id", None)
        if prev:
            self.root.after_cancel(prev)

        remaining = [seconds]  # mutable container for closure

        def _tick():
            if remaining[0] > 0:
                m, s = divmod(remaining[0], 60)
                button.configure(
                    text=f"{original_text} ({m}:{s:02d})",
                    state="disabled",
                )
                remaining[0] -= 1
                button._cd_after_id = self.root.after(1000, _tick)
            else:
                button.configure(text=original_text, state="normal")
                button._cd_after_id = None

        _tick()

    def _clear_frame(self, frame: tk.Frame):
        for w in frame.winfo_children():
            w.destroy()

    # ── Session keep-alive ───────────────────────────────────────────────

    def _start_keepalive(self):
        """Start periodic background pings to keep the Instagram session warm."""
        self._stop_keepalive()

        def _ping():
            interval_ms = int(random.uniform(5, 12) * 60 * 1000)  # 5-12 min
            def _do():
                threading.Thread(target=self._keepalive_tick, daemon=True).start()
                self._keepalive_id = self.root.after(interval_ms, _ping)
            self._keepalive_id = self.root.after(interval_ms, _do)

        _ping()
        self._log("Session keep-alive started (pings every 5-12 min).")

    def _keepalive_tick(self):
        ok = session_keepalive(
            log=lambda msg: self.root.after(0, self._log, msg),
        )
        if not ok:
            self.root.after(0, self._stop_keepalive)

    def _stop_keepalive(self):
        if self._keepalive_id is not None:
            self.root.after_cancel(self._keepalive_id)
            self._keepalive_id = None

    def _show_progress(self, text: str = "Working..."):
        self._cancel_event.clear()
        self.progress_label.configure(text=text)
        self.btn_cancel.configure(state="normal", text="\u2716 Cancel")
        self.progress_frame.pack(fill="x", after=self.btn_frame)
        self.progress_bar.start(12)

    def _update_progress_text(self, text: str):
        self.progress_label.configure(text=text)

    def _hide_progress(self):
        self.progress_bar.stop()
        self.progress_frame.pack_forget()

    def _on_cancel(self):
        self._cancel_event.set()
        self.btn_cancel.configure(state="disabled", text="Cancelling...")
        self._update_progress_text("Cancelling...")
        self._log("Cancel requested — waiting for current API call to finish...")

    @staticmethod
    def _format_elapsed(seconds: float) -> str:
        """Format elapsed seconds as human-readable string."""
        m, s = divmod(int(seconds), 60)
        if m:
            return f"{m}m {s}s"
        return f"{s}s"

    # ── Sortable / filterable table helpers ────────────────────────────

    def _make_sortable(self, tree, cols):
        """Bind heading clicks to sort the treeview by that column."""
        sort_state = {}  # col -> bool (True = ascending)

        def _sort(col):
            ascending = not sort_state.get(col, False)
            sort_state[col] = ascending
            col_idx = cols.index(col)

            items = [(tree.set(iid, col), iid) for iid in tree.get_children()]

            # Try numeric sort, fall back to string
            def sort_key(pair):
                val = pair[0]
                # strip leading @ and % suffix for comparison
                cleaned = val.lstrip("@").rstrip("%").replace(",", "")
                # Handle dash / em-dash as not-sortable (put at end)
                if cleaned in ("—", "-", ""):
                    return (1, 0, "")
                try:
                    return (0, float(cleaned), "")
                except ValueError:
                    return (0, 0, val.lower())

            items.sort(key=sort_key, reverse=not ascending)
            for idx, (_, iid) in enumerate(items):
                tree.move(iid, "", idx)

            # Update heading arrows
            for c in cols:
                label = tree.heading(c, "text").rstrip(" ↑↓")
                tree.heading(c, text=label)
            label = tree.heading(col, "text").rstrip(" ↑↓")
            arrow = " ↑" if ascending else " ↓"
            tree.heading(col, text=label + arrow)

            # Reapply stripe tags
            for idx, iid in enumerate(tree.get_children()):
                tags = ("stripe",) if idx % 2 == 1 else ()
                tree.item(iid, tags=tags)

        for col in cols:
            tree.heading(col, command=lambda c=col: _sort(c))

    def _add_filter_bar(self, parent, tree, cols, filter_cols=None):
        """Add a filter entry above *parent*. Filters rows matching text
        in any of *filter_cols* (defaults to all columns).

        Returns the filter frame so callers can manage layout.
        """
        t = self.t
        filter_cols = filter_cols or list(cols)

        bar = tk.Frame(parent, bg=t["BG"])

        tk.Label(
            bar, text="\U0001F50D", bg=t["BG"], fg=t["FG_DIM"],
            font=("Segoe UI", 10),
        ).pack(side="left", padx=(0, 4))

        filter_var = tk.StringVar()
        entry = tk.Entry(
            bar, textvariable=filter_var, width=28,
            bg=t["ENTRY_BG"], fg=t["FG"], insertbackground=t["FG"],
            relief="flat", font=("Segoe UI", 10), bd=0,
        )
        entry.pack(side="left", ipady=3, padx=(0, 6))

        # Store original items so we can restore them
        _original_data = []

        def _snapshot():
            if _original_data:
                return
            for iid in tree.get_children():
                _original_data.append({
                    "iid": iid,
                    "values": tree.item(iid, "values"),
                    "image": tree.item(iid, "image"),
                    "tags": tree.item(iid, "tags"),
                })

        def _apply_filter(*_args):
            _snapshot()
            query = filter_var.get().strip().lower()
            tree.delete(*tree.get_children())
            for idx, item in enumerate(_original_data):
                if query:
                    match = any(
                        query in str(item["values"][cols.index(c)]).lower()
                        for c in filter_cols
                        if cols.index(c) < len(item["values"])
                    )
                    if not match:
                        continue
                tags = ("stripe",) if idx % 2 == 1 else ()
                kw = {}
                if item["image"]:
                    kw["image"] = item["image"]
                tree.insert(
                    "", "end", iid=item["iid"],
                    values=item["values"], tags=tags, **kw,
                )

        filter_var.trace_add("write", _apply_filter)

        btn_clear = tk.Button(
            bar, text="Clear", command=lambda: filter_var.set(""),
            bg=t["BTN_SEC"], fg=t["FG"], relief="flat",
            font=("Segoe UI", 9), padx=8, pady=1, cursor="hand2", bd=0,
        )
        btn_clear.pack(side="left")
        _hover_bind(btn_clear, t["BTN_SEC"], t["BTN_SEC_HVR"])

        return bar

    # ── Actionable user table (with unfollow / browser / select) ────────

    def _build_actionable_table(self, parent, users, title, color, key):
        """Build a user table with unfollow, browser, and select controls.

        *key* identifies this table (e.g. 'nfb', 'unf', 'ghost') so that
        the generic action callbacks know which tree / user list to use.
        """
        t = self.t
        self._clear_frame(parent)
        self._action_tables[key] = {"tree": None, "users": users}

        header = tk.Frame(parent, bg=t["BG"], pady=10)
        header.pack(fill="x", padx=20)
        tk.Label(
            header, text=f"{title}  ({len(users)})",
            font=("Segoe UI", 13, "bold"), bg=t["BG"], fg=color,
        ).pack(anchor="w")

        if not users:
            tk.Label(
                parent, text="No users in this category.",
                font=("Segoe UI", 11), bg=t["BG"], fg=t["FG_DIM"],
            ).pack(padx=28, anchor="w", pady=8)
            return

        action_bar = tk.Frame(parent, bg=t["BG"])
        action_bar.pack(fill="x", padx=20, pady=(0, 8))

        btn_unfollow = tk.Button(
            action_bar, text="\u2716  Unfollow Selected",
            command=lambda k=key: self._on_unfollow_selected(k),
            bg=t["RED"], fg="#fff", activebackground="#dc2626",
            relief="flat", font=("Segoe UI", 10, "bold"),
            padx=14, pady=4, cursor="hand2", bd=0,
        )
        btn_unfollow.pack(side="left", padx=(0, 8))
        _hover_bind(
            btn_unfollow, t["RED"],
            "#dc2626" if self.current_theme == "dark" else "#b91c1c",
        )
        self._action_tables[key]["btn_unfollow"] = btn_unfollow

        btn_browser = tk.Button(
            action_bar, text="Open in Browser",
            command=lambda k=key: self._on_open_in_browser(k),
            bg=t["BTN_SEC"], fg=t["FG"], relief="flat",
            font=("Segoe UI", 10), padx=14, pady=4, cursor="hand2", bd=0,
        )
        btn_browser.pack(side="left", padx=(0, 8))
        _hover_bind(btn_browser, t["BTN_SEC"], t["BTN_SEC_HVR"])

        btn_sel = tk.Button(
            action_bar, text="Select All",
            command=lambda k=key: self._on_select_all(k),
            bg=t["BTN_SEC"], fg=t["FG"], relief="flat",
            font=("Segoe UI", 10), padx=12, pady=4, cursor="hand2", bd=0,
        )
        btn_sel.pack(side="left", padx=(0, 4))
        _hover_bind(btn_sel, t["BTN_SEC"], t["BTN_SEC_HVR"])

        btn_desel = tk.Button(
            action_bar, text="Deselect All",
            command=lambda k=key: self._on_deselect_all(k),
            bg=t["BTN_SEC"], fg=t["FG"], relief="flat",
            font=("Segoe UI", 10), padx=12, pady=4, cursor="hand2", bd=0,
        )
        btn_desel.pack(side="left")
        _hover_bind(btn_desel, t["BTN_SEC"], t["BTN_SEC_HVR"])

        table_frame = tk.Frame(parent, bg=t["BG"])
        table_frame.pack(fill="both", expand=True, padx=20, pady=(0, 10))

        cols = ("num", "username", "full_name")
        show_mode = "tree headings" if HAS_PIL else "headings"
        tree = ttk.Treeview(
            table_frame, columns=cols, show=show_mode, selectmode="extended",
        )
        if HAS_PIL:
            tree.heading("#0", text="")
            tree.column("#0", width=42, minwidth=42, stretch=False)
        tree.heading("num", text="#")
        tree.heading("username", text="Username")
        tree.heading("full_name", text="Full Name")
        tree.column(
            "num", width=50, minwidth=40, anchor="center", stretch=False,
        )
        tree.column("username", width=220, minwidth=120, stretch=True)
        tree.column("full_name", width=300, minwidth=120, stretch=True)

        tree.tag_configure("stripe", background=t["STRIPE"])

        photo_dir = self._get_photo_dir()
        for i, u in enumerate(users, 1):
            tags = ("stripe",) if i % 2 == 0 else ()
            photo_path = (
                os.path.join(photo_dir, f"{u['username']}_32.png") if HAS_PIL else None
            )
            img = (
                _load_photo_tk(photo_path)
                if photo_path and os.path.exists(photo_path) else None
            )
            kw = {"image": img} if img else {}
            if img:
                self._photo_refs.append(img)
            tree.insert(
                "", "end", iid=str(i - 1),
                values=(i, f"@{u['username']}", u.get("full_name", "")),
                tags=tags, **kw,
            )

        scrollbar = ttk.Scrollbar(
            table_frame, orient="vertical", command=tree.yview,
        )
        tree.configure(yscrollcommand=scrollbar.set)
        tree.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        self._make_sortable(tree, cols)
        self._add_filter_bar(
            parent, tree, cols, filter_cols=["username", "full_name"],
        ).pack(fill="x", padx=20, pady=(0, 0), before=table_frame)

        self._action_tables[key]["tree"] = tree

    def _get_selected_users(self, key):
        info = self._action_tables.get(key)
        if not info or not info["tree"]:
            return []
        tree = info["tree"]
        users = info["users"]
        selected = []
        for iid in tree.selection():
            idx = int(iid)
            if 0 <= idx < len(users):
                selected.append(users[idx])
        return selected

    def _on_select_all(self, key):
        info = self._action_tables.get(key)
        if info and info["tree"]:
            info["tree"].selection_set(info["tree"].get_children())

    def _on_deselect_all(self, key):
        info = self._action_tables.get(key)
        if info and info["tree"]:
            info["tree"].selection_remove(info["tree"].selection())

    def _on_open_in_browser(self, key="nfb"):
        selected = self._get_selected_users(key)
        if not selected:
            messagebox.showinfo("No Selection", "Select one or more users first.")
            return
        if len(selected) > 20:
            if not messagebox.askyesno(
                "Open Many Tabs",
                f"This will open {len(selected)} browser tabs. Continue?",
            ):
                return
        for u in selected:
            webbrowser.open(f"https://www.instagram.com/{u['username']}/")
        self._set_status(f"Opened {len(selected)} profile(s) in browser.")

    def _on_unfollow_selected(self, key="nfb"):
        selected = self._get_selected_users(key)
        if not selected:
            messagebox.showinfo("No Selection", "Select one or more users first.")
            return

        cl = get_last_client()
        if cl is None:
            if messagebox.askyesno(
                "No Active Session",
                "No active session (run Scan first for mass unfollow).\n\n"
                f"Open {len(selected)} profile(s) in browser instead?",
            ):
                self._on_open_in_browser(key)
            return

        names = ", ".join(f"@{u['username']}" for u in selected[:5])
        if len(selected) > 5:
            names += f" ... +{len(selected) - 5} more"
        if not messagebox.askyesno(
            "Confirm Unfollow",
            f"Unfollow {len(selected)} user(s)?\n\n{names}",
            icon="warning",
        ):
            return

        info = self._action_tables[key]
        btn_uf = info.get("btn_unfollow")
        self._set_buttons_state("disabled")
        if btn_uf:
            btn_uf.configure(state="disabled")
        self._show_progress(f"Unfollowing {len(selected)} users...")

        def _worker():
            try:
                user_ids = [u["user_id"] for u in selected]
                result = unfollow_users(
                    user_ids,
                    log=lambda m: self.root.after(0, self._log, m),
                )
                n_ok = len(result["success"])
                n_fail = len(result["failed"])
                msg = f"Unfollowed {n_ok} user(s)."
                if n_fail:
                    msg += f" {n_fail} failed."

                success_set = set(result["success"])
                tree = info["tree"]
                users = info["users"]

                def _update_tree():
                    for iid in list(tree.get_children()):
                        idx = int(iid)
                        if 0 <= idx < len(users):
                            if users[idx]["user_id"] in success_set:
                                tree.delete(iid)
                    self._set_status(msg)
                    self._log(msg)

                self.root.after(0, _update_tree)
            except Exception as e:
                self.root.after(0, self._log, f"ERROR: {e}")
                self.root.after(0, self._set_status, f"Error: {e}")
            finally:
                self.root.after(0, self._set_buttons_state, "normal")
                if btn_uf:
                    self.root.after(
                        0, lambda: btn_uf.configure(state="normal"))
                self.root.after(0, self._hide_progress)

        threading.Thread(target=_worker, daemon=True).start()

    # ── Generic user table ───────────────────────────────────────────────

    def _build_user_table(self, parent, users, title, color):
        t = self.t
        self._clear_frame(parent)

        header = tk.Frame(parent, bg=t["BG"], pady=10)
        header.pack(fill="x", padx=20)
        tk.Label(
            header, text=f"{title}  ({len(users)})",
            font=("Segoe UI", 13, "bold"), bg=t["BG"], fg=color,
        ).pack(anchor="w")

        if not users:
            tk.Label(
                parent, text="No users in this category.",
                font=("Segoe UI", 11), bg=t["BG"], fg=t["FG_DIM"],
            ).pack(padx=28, anchor="w", pady=8)
            return

        table_frame = tk.Frame(parent, bg=t["BG"])
        table_frame.pack(fill="both", expand=True, padx=20, pady=(0, 10))

        cols = ("num", "username", "full_name")
        show_mode = "tree headings" if HAS_PIL else "headings"
        tree = ttk.Treeview(table_frame, columns=cols, show=show_mode)
        if HAS_PIL:
            tree.heading("#0", text="")
            tree.column("#0", width=42, minwidth=42, stretch=False)
        tree.heading("num", text="#")
        tree.heading("username", text="Username")
        tree.heading("full_name", text="Full Name")
        tree.column(
            "num", width=50, minwidth=40, anchor="center", stretch=False,
        )
        tree.column("username", width=220, minwidth=120, stretch=True)
        tree.column("full_name", width=300, minwidth=120, stretch=True)

        tree.tag_configure("stripe", background=t["STRIPE"])

        photo_dir = self._get_photo_dir()
        for i, u in enumerate(users, 1):
            tags = ("stripe",) if i % 2 == 0 else ()
            photo_path = (
                os.path.join(photo_dir, f"{u['username']}_32.png") if HAS_PIL else None
            )
            img = (
                _load_photo_tk(photo_path)
                if photo_path and os.path.exists(photo_path) else None
            )
            kw = {"image": img} if img else {}
            if img:
                self._photo_refs.append(img)
            tree.insert(
                "", "end",
                values=(i, f"@{u['username']}", u.get("full_name", "")),
                tags=tags, **kw,
            )

        scrollbar = ttk.Scrollbar(
            table_frame, orient="vertical", command=tree.yview,
        )
        tree.configure(yscrollcommand=scrollbar.set)
        tree.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        self._make_sortable(tree, cols)
        self._add_filter_bar(
            parent, tree, cols, filter_cols=["username", "full_name"],
        ).pack(fill="x", padx=20, pady=(0, 0), before=table_frame)

    # ── Summary tab ──────────────────────────────────────────────────────

    def _build_summary(self, report, username=""):
        t = self.t
        self._clear_frame(self.summary_frame)
        f = self.summary_frame

        # Scrollable container
        canvas = tk.Canvas(f, bg=t["BG"], highlightthickness=0, bd=0)
        scroll = ttk.Scrollbar(f, orient="vertical", command=canvas.yview)
        inner = tk.Frame(canvas, bg=t["BG"])

        inner.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all")),
        )
        canvas.create_window((0, 0), window=inner, anchor="nw")
        canvas.configure(yscrollcommand=scroll.set)

        def _on_mousewheel(event):
            canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
        canvas.bind("<MouseWheel>", _on_mousewheel)
        inner.bind("<MouseWheel>", _on_mousewheel)

        canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

        # ── Primary stat cards ──
        stats = tk.Frame(inner, bg=t["BG"], pady=16)
        stats.pack(fill="x", padx=20)

        cards = [
            ("Followers", report["current_follower_count"], t["GREEN"]),
            ("Following", report["current_following_count"], t["ACCENT"]),
            ("Mutuals", len(report["mutuals"]), t["CYAN"]),
            ("Don't Follow Back", len(report["not_following_back"]), t["RED"]),
            ("Fans", len(report["fans"]), t["YELLOW"]),
        ]
        if report["has_previous_data"]:
            cards += [
                ("Unfollowers", len(report["unfollowers"]), t["RED"]),
                ("New Followers", len(report["new_followers"]), t["GREEN"]),
            ]

        cols_per_row = max(1, min(len(cards), 5))
        for idx, (label, value, color) in enumerate(cards):
            row, col = divmod(idx, cols_per_row)
            card = tk.Frame(
                stats, bg=t["BG_CARD"], padx=22, pady=14,
                highlightbackground=t["CARD_BORDER"], highlightthickness=1,
            )
            card.grid(row=row, column=col, padx=5, pady=5, sticky="nsew")
            tk.Label(
                card, text=str(value), font=("Segoe UI", 24, "bold"),
                bg=t["BG_CARD"], fg=color,
            ).pack()
            tk.Label(
                card, text=label, font=("Segoe UI", 9),
                bg=t["BG_CARD"], fg=t["FG_DIM"],
            ).pack(pady=(2, 0))
        for c in range(cols_per_row):
            stats.columnconfigure(c, weight=1)

        # ── Account Insights ──
        db_path = self._get_db_path()
        timeline = get_timeline(username, db_path=db_path) if username else []
        insights = compute_account_insights(report, timeline)

        ins_frame = tk.Frame(inner, bg=t["BG"])
        ins_frame.pack(fill="x", padx=20, pady=(4, 8))

        tk.Label(
            ins_frame, text="Account Insights",
            font=("Segoe UI", 13, "bold"), bg=t["BG"], fg=t["BLUE"],
        ).pack(anchor="w", pady=(0, 8))

        ins_grid = tk.Frame(ins_frame, bg=t["BG"])
        ins_grid.pack(fill="x")

        ratio = insights["follower_following_ratio"]
        fbr = insights["follow_back_rate"]

        # (label, value, color, tooltip)
        insight_items = [
            (
                "Follower / Following Ratio",
                f"{ratio:.2f}",
                t["CYAN"] if ratio >= 1 else t["YELLOW"],
                "Your followers divided by the number of people you follow.\n"
                "≥ 1.0 means more people follow you than you follow back.",
            ),
            (
                "Follow-Back Rate",
                f"{fbr:.1f}%",
                t["GREEN"] if fbr >= 50 else t["YELLOW"],
                "Percentage of people you follow who also follow you back.",
            ),
            (
                "Fan Rate",
                f"{insights['fan_percentage']:.1f}%",
                t["MAGENTA"],
                "Percentage of your followers who you don't follow back.\n"
                "These are your true fans / organic audience.",
            ),
            (
                "Mutual Rate",
                f"{insights['mutual_percentage']:.1f}%",
                t["CYAN"],
                "Percentage of your followers that you also follow back.\n"
                "These are your mutual connections.",
            ),
            (
                "Non-Follower Rate",
                f"{insights['nfb_percentage']:.1f}%",
                t["RED"] if insights["nfb_percentage"] > 30 else t["GREEN"],
                "Percentage of people you follow who don't follow you back.\n"
                "High values suggest you're following many non-reciprocal accounts.",
            ),
        ]

        for idx, (label, value, color, tip) in enumerate(insight_items):
            row, col = divmod(idx, 3)
            cell = tk.Frame(
                ins_grid, bg=t["BG_CARD"], padx=16, pady=10,
                highlightbackground=t["CARD_BORDER"], highlightthickness=1,
            )
            cell.grid(row=row, column=col, padx=5, pady=4, sticky="nsew")
            top_row = tk.Frame(cell, bg=t["BG_CARD"])
            top_row.pack(fill="x", anchor="w")
            tk.Label(
                top_row, text=value, font=("Segoe UI", 16, "bold"),
                bg=t["BG_CARD"], fg=color,
            ).pack(side="left")
            info_lbl = tk.Label(
                top_row, text="\u24d8", font=("Segoe UI", 10),
                bg=t["BG_CARD"], fg=t["FG_DIM"], cursor="hand2",
            )
            info_lbl.pack(side="right", padx=(4, 0))
            _ToolTip(info_lbl, tip)
            tk.Label(
                cell, text=label, font=("Segoe UI", 9),
                bg=t["BG_CARD"], fg=t["FG_DIM"],
            ).pack(anchor="w")
        for c in range(3):
            ins_grid.columnconfigure(c, weight=1)

        # ── Growth Trends ──
        if "follower_change_last" in insights:
            gf = tk.Frame(inner, bg=t["BG"])
            gf.pack(fill="x", padx=20, pady=(4, 8))

            tk.Label(
                gf, text="Growth Trends",
                font=("Segoe UI", 13, "bold"), bg=t["BG"], fg=t["GREEN"],
            ).pack(anchor="w", pady=(0, 8))

            gg = tk.Frame(gf, bg=t["BG"])
            gg.pack(fill="x")

            fc = insights["follower_change_last"]
            fgc = insights["following_change_last"]
            fc_color = t["GREEN"] if fc >= 0 else t["RED"]
            fgc_color = t["GREEN"] if fgc <= 0 else t["YELLOW"]
            fc_str = f"+{fc}" if fc > 0 else str(fc)
            fgc_str = f"+{fgc}" if fgc > 0 else str(fgc)

            growth_items = [
                (
                    "Follower Change (last)",
                    fc_str, fc_color,
                    "Net change in followers since your previous scan.",
                ),
                (
                    "Following Change (last)",
                    fgc_str, fgc_color,
                    "Net change in the number of people you follow\n"
                    "since your previous scan.",
                ),
                (
                    "Total Scans",
                    str(insights["total_scans"]), t["CYAN"],
                    "How many times you've scanned this account.\n"
                    "More scans = more data points for trend analysis.",
                ),
            ]

            tfg = insights.get("total_follower_growth", 0)
            if tfg != 0:
                tg_c = t["GREEN"] if tfg > 0 else t["RED"]
                tg_s = f"+{tfg}" if tfg > 0 else str(tfg)
                growth_items.append((
                    "Total Follower Growth", tg_s, tg_c,
                    "Net follower change from your very first scan\n"
                    "to the most recent one.",
                ))

            tfog = insights.get("total_following_growth", 0)
            if tfog != 0:
                tog_c = t["GREEN"] if tfog <= 0 else t["YELLOW"]
                tog_s = f"+{tfog}" if tfog > 0 else str(tfog)
                growth_items.append((
                    "Total Following Growth", tog_s, tog_c,
                    "Net change in people you follow from your first scan\n"
                    "to the most recent one.",
                ))

            avg = insights.get("avg_follower_growth")
            if avg is not None:
                avg_c = t["GREEN"] if avg >= 0 else t["RED"]
                avg_s = f"+{avg}" if avg > 0 else str(avg)
                growth_items.append((
                    "Avg Growth / Scan", avg_s, avg_c,
                    "Average follower gain or loss between each scan.\n"
                    "Calculated as total growth ÷ (number of scans − 1).",
                ))

            avg_fg = insights.get("avg_following_growth")
            if avg_fg is not None:
                avg_fg_c = t["GREEN"] if avg_fg <= 0 else t["YELLOW"]
                avg_fg_s = f"+{avg_fg}" if avg_fg > 0 else str(avg_fg)
                growth_items.append((
                    "Avg Following / Scan", avg_fg_s, avg_fg_c,
                    "Average change in following count between each scan.",
                ))

            if "churn_rate" in insights:
                cr = insights["churn_rate"]
                cr_c = t["RED"] if cr > 5 else t["GREEN"]
                growth_items.append((
                    "Churn Rate", f"{cr:.1f}%", cr_c,
                    "Percentage of previous followers who unfollowed you.\n"
                    "High churn (> 5%) may indicate content or audience issues.",
                ))

            if "retention_rate" in insights:
                rr = insights["retention_rate"]
                rr_c = t["GREEN"] if rr >= 95 else t["YELLOW"]
                growth_items.append((
                    "Retention Rate", f"{rr:.1f}%", rr_c,
                    "Percentage of previous followers who stayed.\n"
                    "The inverse of churn rate (100% − churn).",
                ))

            for idx, (label, value, color, tip) in enumerate(growth_items):
                row, col = divmod(idx, 3)
                cell = tk.Frame(
                    gg, bg=t["BG_CARD"], padx=16, pady=10,
                    highlightbackground=t["CARD_BORDER"], highlightthickness=1,
                )
                cell.grid(
                    row=row, column=col, padx=5, pady=4, sticky="nsew",
                )
                top_row = tk.Frame(cell, bg=t["BG_CARD"])
                top_row.pack(fill="x", anchor="w")
                tk.Label(
                    top_row, text=value, font=("Segoe UI", 16, "bold"),
                    bg=t["BG_CARD"], fg=color,
                ).pack(side="left")
                info_lbl = tk.Label(
                    top_row, text="\u24d8", font=("Segoe UI", 10),
                    bg=t["BG_CARD"], fg=t["FG_DIM"], cursor="hand2",
                )
                info_lbl.pack(side="right", padx=(4, 0))
                _ToolTip(info_lbl, tip)
                tk.Label(
                    cell, text=label, font=("Segoe UI", 9),
                    bg=t["BG_CARD"], fg=t["FG_DIM"],
                ).pack(anchor="w")
            for c in range(3):
                gg.columnconfigure(c, weight=1)

        # ── Previous-scrape comparison ──
        if report["has_previous_data"]:
            prev = report["previous_session"]
            tk.Label(
                inner, text=f"Compared with: {prev['scraped_at'][:19]}",
                font=("Segoe UI", 10), bg=t["BG"], fg=t["FG_DIM"],
            ).pack(padx=24, anchor="w", pady=(12, 4))

            changes = tk.Frame(inner, bg=t["BG"])
            changes.pack(fill="x", padx=20, pady=(0, 12))

            for label, users, color in [
                ("You Unfollowed", report["you_unfollowed"], t["MAGENTA"]),
                ("Newly Following", report["newly_following"], t["CYAN"]),
            ]:
                row = tk.Frame(
                    changes, bg=t["BG_CARD"], padx=14, pady=8,
                    highlightbackground=t["CARD_BORDER"],
                    highlightthickness=1,
                )
                row.pack(fill="x", pady=3)
                tk.Label(
                    row, text=f"{label}: {len(users)}",
                    font=("Segoe UI", 10, "bold"),
                    bg=t["BG_CARD"], fg=color,
                ).pack(side="left")
                if users:
                    names = ", ".join(
                        f"@{u['username']}" for u in users[:10]
                    )
                    if len(users) > 10:
                        names += f" ... +{len(users) - 10} more"
                    tk.Label(
                        row, text=f"  \u2014  {names}",
                        font=("Segoe UI", 9),
                        bg=t["BG_CARD"], fg=t["FG_DIM"],
                        wraplength=600, justify="left",
                    ).pack(side="left", padx=(8, 0))
        else:
            tk.Label(
                inner,
                text="No previous data yet. Run analytics again later "
                     "to track changes.",
                font=("Segoe UI", 10), bg=t["BG"], fg=t["FG_DIM"],
            ).pack(padx=24, anchor="w", pady=16)

    # ── Timeline tab ─────────────────────────────────────────────────────

    def _build_timeline_tab(self, username):
        t = self.t
        self._clear_frame(self.timeline_frame)
        f = self.timeline_frame

        db_path = self._get_db_path()
        timeline = get_timeline(username, db_path=db_path)
        if not timeline:
            tk.Label(
                f, text="No historical data yet.",
                font=("Segoe UI", 11), bg=t["BG"], fg=t["FG_DIM"],
            ).pack(padx=24, pady=24, anchor="w")
            return

        hdr = tk.Frame(f, bg=t["BG"])
        hdr.pack(fill="x", padx=20, pady=(12, 4))
        tk.Label(
            hdr, text="Follower / Following Timeline",
            font=("Segoe UI", 13, "bold"), bg=t["BG"], fg=t["ACCENT"],
        ).pack(side="left")
        tk.Label(
            hdr, text=f"{len(timeline)} session(s)",
            font=("Segoe UI", 10), bg=t["BG"], fg=t["FG_DIM"],
        ).pack(side="right")

        table_frame = tk.Frame(f, bg=t["BG"])
        table_frame.pack(fill="both", expand=True, padx=20, pady=(0, 10))

        cols = ("date", "followers", "following", "f_delta", "fg_delta", "ratio")
        tree = ttk.Treeview(table_frame, columns=cols, show="headings")
        tree.heading("date", text="Date")
        tree.heading("followers", text="Followers")
        tree.heading("following", text="Following")
        tree.heading("f_delta", text="\u0394 Followers")
        tree.heading("fg_delta", text="\u0394 Following")
        tree.heading("ratio", text="Ratio")
        tree.column("date", width=170, minwidth=130, stretch=True)
        tree.column(
            "followers", width=90, minwidth=70, anchor="center",
            stretch=False,
        )
        tree.column(
            "following", width=90, minwidth=70, anchor="center",
            stretch=False,
        )
        tree.column(
            "f_delta", width=100, minwidth=70, anchor="center",
            stretch=False,
        )
        tree.column(
            "fg_delta", width=100, minwidth=70, anchor="center",
            stretch=False,
        )
        tree.column(
            "ratio", width=80, minwidth=60, anchor="center", stretch=False,
        )

        tree.tag_configure("stripe", background=t["STRIPE"])

        prev_f = prev_fg = None
        for i, entry in enumerate(timeline):
            fc = entry["follower_count"]
            fgc = entry["following_count"]

            if prev_f is not None:
                fd = fc - prev_f
                fgd = fgc - prev_fg
                fd_str = f"+{fd}" if fd > 0 else str(fd)
                fgd_str = f"+{fgd}" if fgd > 0 else str(fgd)
            else:
                fd_str = fgd_str = "\u2014"

            ratio = f"{fc / fgc:.2f}" if fgc else "\u221e"
            tags = ("stripe",) if i % 2 == 0 else ()

            tree.insert("", "end", values=(
                entry["date"][:19], fc, fgc, fd_str, fgd_str, ratio,
            ), tags=tags)

            prev_f, prev_fg = fc, fgc

        scrollbar = ttk.Scrollbar(
            table_frame, orient="vertical", command=tree.yview,
        )
        tree.configure(yscrollcommand=scrollbar.set)
        tree.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        self._make_sortable(tree, cols)

    # ── Display report ───────────────────────────────────────────────────

    def _display_report(self, report, username=""):
        self._last_report = report
        self._last_username = username
        t = self.t
        self._photo_refs.clear()
        self._build_summary(report, username)
        self._build_actionable_table(
            self.nfb_frame, report["not_following_back"],
            "People You Follow Who Don't Follow Back", t["RED"], "nfb",
        )
        self._build_user_table(
            self.fans_frame, report["fans"],
            "Your Fans \u2014 Follow You But You Don't Follow Back",
            t["YELLOW"],
        )
        self._build_actionable_table(
            self.unf_frame, report["unfollowers"],
            "Unfollowers Since Last Scrape", t["RED"], "unf",
        )
        self._build_user_table(
            self.new_frame, report["new_followers"],
            "New Followers Since Last Scrape", t["GREEN"],
        )
        self._build_timeline_tab(username)

        # Load engagement data if available for latest session
        self._load_engagement_if_available(username)

        self.notebook.select(self.summary_frame)

    def _load_engagement_if_available(self, username):
        """If engagement data exists for latest session, populate tabs."""
        t = self.t
        db_path = self._get_db_path()
        sessions = get_all_sessions(username, db_path=db_path)
        if not sessions:
            self._show_engagement_placeholder()
            return

        latest = sessions[-1]
        try:
            if not has_engagement_data(latest["id"], db_path=db_path):
                self._show_engagement_placeholder()
                return
        except Exception:
            self._show_engagement_placeholder()
            return

        media_items = get_session_media_items(
            latest["id"], db_path=db_path,
        )
        interactions = get_session_media_interactions(
            latest["id"], db_path=db_path,
        )
        story_viewers = get_session_story_viewers(
            latest["id"], db_path=db_path,
        )
        current_followers = get_session_followers(
            latest["id"], db_path=db_path,
        )

        eng_report = compute_engagement_report(
            followers=current_followers,
            media_items=media_items,
            interactions=interactions,
            story_viewers=story_viewers,
            follower_count=latest["follower_count"],
        )

        self._build_content_tab(eng_report)
        self._build_engagement_tab(eng_report)
        self._build_ghost_tab(eng_report)

    def _show_engagement_placeholder(self):
        t = self.t
        for frame in (self.content_frame, self.engage_frame, self.ghost_frame):
            self._clear_frame(frame)
            tk.Label(
                frame,
                text='Click "Analyze Engagement" to scrape '
                     "post/reel interaction data.",
                font=("Segoe UI", 11), bg=t["BG"], fg=t["FG_DIM"],
            ).pack(padx=24, pady=24, anchor="w")

    # ── Actions ──────────────────────────────────────────────────────────

    def _ask_2fa_code(self) -> str:
        result = [None]
        event = threading.Event()

        def _ask():
            code = simpledialog.askstring(
                "Two-Factor Authentication",
                "Enter your Instagram 2FA code:",
                parent=self.root,
            )
            result[0] = code or ""
            event.set()

        self.root.after(0, _ask)
        event.wait()
        return result[0]

    def _on_login(self):
        """Establish a session without scraping any data."""
        username = self.username_var.get().strip()
        password = self.password_var.get().strip()
        if not username or not password:
            messagebox.showwarning(
                "Missing credentials",
                "Please enter both username and password.",
            )
            return

        self._on_save_account()
        self._set_buttons_state("disabled")
        self._show_progress("Logging in...")
        self._set_status("Logging in...")
        self._log(f"Establishing session for @{username}...")

        def _worker():
            try:
                def log_to_ui(msg):
                    self.root.after(0, self._log, msg)
                    self.root.after(
                        0, self._update_progress_text, msg[:60],
                    )

                if self._cancel_event.is_set():
                    raise _Cancelled()
                login_only(
                    username, password, log=log_to_ui,
                    twofa_callback=self._ask_2fa_code,
                )
                if self._cancel_event.is_set():
                    raise _Cancelled()
                self.root.after(
                    0, self._log, "Session established successfully.",
                )
                self.root.after(
                    0, self._mark_logged_in, username,
                )
            except _Cancelled:
                self.root.after(0, self._log, "Login cancelled.")
                self.root.after(0, self._set_status, "Cancelled.")
            except Exception as e:
                self.root.after(0, self._log, f"Login failed: {e}")
                self.root.after(
                    0, lambda: messagebox.showerror(
                        "Login Failed", str(e)),
                )
            finally:
                self.root.after(0, self._set_buttons_state, "normal")
                self.root.after(0, self._hide_progress)

        threading.Thread(target=_worker, daemon=True).start()

    def _on_scrape(self):
        username = self.username_var.get().strip()
        password = self.password_var.get().strip()
        if not username or not password:
            messagebox.showwarning(
                "Missing credentials",
                "Please enter both username and password.",
            )
            return

        self._on_save_account()
        db_path = self._get_db_path()
        self._ensure_db(db_path)

        self._set_buttons_state("disabled")
        if self._logged_in_user == username:
            self._show_progress("Scraping data...")
        else:
            self._show_progress("Logging in...")
        self._set_status(f"Scraping @{username}...")
        self._log(f"Starting follower/following scan for @{username}...")
        self.notebook.select(self.log_frame)
        t0 = time.time()

        def _worker():
            try:
                def log_to_ui(msg):
                    if self._cancel_event.is_set():
                        raise _Cancelled()
                    self.root.after(0, self._log, msg)
                    lower = msg.lower()
                    if "follower" in lower and "fetching" in lower:
                        self.root.after(
                            0, self._update_progress_text,
                            "Fetching followers...",
                        )
                    elif "following" in lower and "fetching" in lower:
                        self.root.after(
                            0, self._update_progress_text,
                            "Fetching following...",
                        )
                    elif "logged in" in lower:
                        self.root.after(
                            0, self._update_progress_text,
                            "Logged in. Scraping data...",
                        )

                if self._cancel_event.is_set():
                    raise _Cancelled()
                t_step = time.time()
                # Reuse existing client if already logged in for this user
                existing_cl = None
                if (self._logged_in_user == username
                        and get_last_client() is not None
                        and get_last_client_username() == username):
                    existing_cl = get_last_client()
                data = scrape_followers_and_following(
                    username, password, log=log_to_ui,
                    twofa_callback=self._ask_2fa_code,
                    client=existing_cl,
                )
                scrape_time = self._format_elapsed(time.time() - t_step)

                if self._cancel_event.is_set():
                    raise _Cancelled()

                self.root.after(
                    0, self._log,
                    f"Scraped {data['follower_count']} followers and "
                    f"{data['following_count']} following. "
                    f"({scrape_time})",
                )

                self.root.after(
                    0, self._update_progress_text, "Saving to database...",
                )
                t_step = time.time()
                session_id = create_session(
                    username, data["follower_count"],
                    data["following_count"], db_path=db_path,
                )
                store_followers(
                    session_id, data["followers"], db_path=db_path,
                )
                store_following(
                    session_id, data["following"], db_path=db_path,
                )
                db_time = self._format_elapsed(time.time() - t_step)
                self.root.after(
                    0, self._log,
                    f"Saved to database (session #{session_id}). "
                    f"({db_time})",
                )

                if self._cancel_event.is_set():
                    raise _Cancelled()

                if HAS_PIL:
                    self.root.after(
                        0, self._update_progress_text,
                        "Downloading profile photos...",
                    )
                    self.root.after(
                        0, self._log, "Downloading profile photos...",
                    )
                    t_step = time.time()
                    own_pic = data.get("profile_pic_url", "")
                    photo_dir = self._get_photo_dir(username)
                    if own_pic:
                        _download_photo(own_pic, username, size=48,
                                        photo_dir=photo_dir)
                    all_users = data["followers"] + data["following"]
                    seen = set()
                    for u in all_users:
                        if self._cancel_event.is_set():
                            raise _Cancelled()
                        if u["username"] not in seen:
                            seen.add(u["username"])
                            pic = u.get("profile_pic_url", "")
                            if pic:
                                _download_photo(pic, u["username"], size=32,
                                                photo_dir=photo_dir)
                    photo_time = self._format_elapsed(time.time() - t_step)
                    self.root.after(
                        0, self._log,
                        f"Downloaded {len(seen)} profile photos. "
                        f"({photo_time})",
                    )

                if self._cancel_event.is_set():
                    raise _Cancelled()

                self.root.after(
                    0, self._update_progress_text, "Generating report...",
                )
                t_step = time.time()
                report = generate_full_report(
                    username=username,
                    current_session_id=session_id,
                    current_followers=data["followers"],
                    current_following=data["following"],
                    db_path=db_path,
                )
                report_time = self._format_elapsed(time.time() - t_step)

                elapsed = time.time() - t0
                elapsed_str = self._format_elapsed(elapsed)

                self.root.after(
                    0, self._log,
                    f"Report generated. ({report_time})",
                )
                self.root.after(
                    0, self._display_report, report, username,
                )
                self.root.after(0, self._update_own_photo, username)
                self.root.after(
                    0, self._set_status,
                    f"Scan complete in {elapsed_str}.",
                )
                self.root.after(
                    0, self._log,
                    f"Done. Total time: {elapsed_str}.",
                )
                self.root.after(0, self._start_keepalive)
                self.root.after(
                    0, self._mark_logged_in, username,
                )

            except _Cancelled:
                self.root.after(0, self._log, "Scan cancelled.")
                self.root.after(0, self._set_status, "Scan cancelled.")
            except IGRateLimitError as e:
                cd = e.cooldown
                self.root.after(0, self._log,
                                f"⚠ RATE LIMITED: {e}")
                self.root.after(0, self._log,
                                f"Cooldown: {cd // 60}m {cd % 60}s "
                                f"before next scan.")
                self.root.after(0, self._set_status,
                                "Rate limited by Instagram. "
                                "Please wait before scanning again.")
                self.root.after(
                    0, lambda: messagebox.showwarning(
                        "Rate Limited",
                        "Instagram has rate-limited this request.\n\n"
                        f"The Scan button will be available again "
                        f"in {cd // 60} minutes.",
                    ),
                )
                self.root.after(
                    0, self._start_cooldown,
                    self.btn_scrape,
                    "Scan Followers && Following", cd,
                )
            except IGTimeoutError as e:
                cd = e.cooldown
                self.root.after(0, self._log,
                                f"⚠ TIMEOUT: {e}")
                self.root.after(0, self._log,
                                f"Cooldown: {cd // 60}m {cd % 60}s "
                                f"before next scan.")
                self.root.after(0, self._set_status,
                                "API request timed out. "
                                "Please wait before scanning again.")
                self.root.after(
                    0, lambda: messagebox.showwarning(
                        "Request Timed Out",
                        "The Instagram API request timed out.\n\n"
                        f"The Scan button will be available again "
                        f"in {cd // 60} minutes.",
                    ),
                )
                self.root.after(
                    0, self._start_cooldown,
                    self.btn_scrape,
                    "Scan Followers && Following", cd,
                )
            except Exception as e:
                self.root.after(0, self._log, f"ERROR: {e}")
                self.root.after(0, self._set_status, f"Error: {e}")
                self.root.after(
                    0,
                    lambda: messagebox.showerror("Scrape Failed", str(e)),
                )
            finally:
                self.root.after(0, self._set_buttons_state, "normal")
                self.root.after(0, self._hide_progress)

        threading.Thread(target=_worker, daemon=True).start()

    def _on_report(self):
        username = self.username_var.get().strip()
        if not username:
            messagebox.showwarning(
                "Missing username", "Please enter your username.",
            )
            return

        db_path = self._get_db_path()
        self._ensure_db(db_path)

        sessions = get_all_sessions(username, db_path=db_path)
        if not sessions:
            messagebox.showinfo(
                "No Data",
                f"No stored data for @{username}. Run Scrape first.",
            )
            return

        latest = sessions[-1]
        current_followers = get_session_followers(
            latest["id"], db_path=db_path,
        )
        current_following = get_session_following(
            latest["id"], db_path=db_path,
        )

        report = generate_full_report(
            username=username, current_session_id=latest["id"],
            current_followers=current_followers,
            current_following=current_following, db_path=db_path,
        )
        self._display_report(report, username)
        self._set_status(
            f"Report from session #{latest['id']} "
            f"({latest['scraped_at'][:19]})",
        )

    def _on_timeline(self):
        username = self.username_var.get().strip()
        if not username:
            messagebox.showwarning(
                "Missing username", "Please enter your username.",
            )
            return
        db_path = self._get_db_path()
        self._ensure_db(db_path)
        self._build_timeline_tab(username)
        self.notebook.select(self.timeline_frame)
        self._set_status("Showing timeline.")

    # ── Engagement scraping ──────────────────────────────────────────────

    def _on_engagement(self):
        username = self.username_var.get().strip()
        if not username:
            messagebox.showwarning(
                "Missing username", "Please enter your username.",
            )
            return

        password = self.password_var.get().strip()

        cl = get_last_client()
        cl_user = get_last_client_username()
        # If no active session or it belongs to a different user, try to
        # establish one automatically instead of just showing an error.
        if cl is None or cl_user != username:
            if not password:
                messagebox.showwarning(
                    "No Session",
                    "No active session for this account.\n"
                    "Enter your password and try again, or run "
                    "\"Scan Followers & Following\" first.",
                )
                return
            # Quick background session restore
            self._set_status("Checking session...")
            alive = check_session(username, password)
            if alive:
                cl = get_last_client()
                self._mark_logged_in(username)
            else:
                # Need a fresh login
                try:
                    login_only(
                        username, password,
                        log=self._log,
                        twofa_callback=self._ask_2fa_code,
                    )
                    cl = get_last_client()
                    self._mark_logged_in(username)
                except Exception as e:
                    messagebox.showerror("Login Failed", str(e))
                    return

        db_path = self._get_db_path()
        self._ensure_db(db_path)

        sessions = get_all_sessions(username, db_path=db_path)
        if not sessions:
            messagebox.showinfo(
                "No Data",
                f"No follower data for @{username}. "
                "Run a scan first.",
            )
            return

        # Warn if engagement was analyzed recently
        last_eng = get_last_engagement_time(db_path=db_path)
        if last_eng:
            try:
                from datetime import datetime as _dt
                last_dt = _dt.fromisoformat(last_eng)
                delta = _dt.now() - last_dt
                hours = delta.total_seconds() / 3600
                if hours < 24:
                    if hours < 1:
                        ago = f"{int(delta.total_seconds() / 60)} minutes"
                    else:
                        ago = f"{hours:.1f} hours"
                    proceed = messagebox.askyesno(
                        "Recent Analysis Detected",
                        f"Engagement was last analyzed {ago} ago "
                        f"for @{username}.\n\n"
                        "Running this too frequently increases the risk "
                        "of Instagram flagging your account.\n\n"
                        "It's recommended to wait at least 24 hours "
                        "between engagement analyses.\n\n"
                        "Continue anyway?",
                        icon="warning",
                    )
                    if not proceed:
                        return
            except Exception:
                pass

        media_n = self._get_media_count()

        self._set_buttons_state("disabled")
        self._show_progress(
            f"Scraping engagement data ({media_n} posts)...",
        )
        self._set_status(
            "Analyzing engagement... this may take several minutes.",
        )
        self._log(
            f"Starting engagement analysis (last {media_n} posts)...",
        )
        self.notebook.select(self.log_frame)
        t0 = time.time()

        def _worker():
            try:
                def log_to_ui(msg):
                    if self._cancel_event.is_set():
                        raise _Cancelled()
                    self.root.after(0, self._log, msg)
                    lower = msg.lower()
                    if "processing" in lower:
                        self.root.after(
                            0, self._update_progress_text, msg[:60],
                        )
                    elif "stories" in lower:
                        self.root.after(
                            0, self._update_progress_text,
                            "Fetching story viewers...",
                        )

                if self._cancel_event.is_set():
                    raise _Cancelled()

                t_step = time.time()
                data = scrape_engagement(
                    media_count=media_n, log=log_to_ui,
                )
                scrape_time = self._format_elapsed(time.time() - t_step)

                if self._cancel_event.is_set():
                    raise _Cancelled()

                self.root.after(
                    0, self._log,
                    f"Scraped engagement data. ({scrape_time})",
                )

                was_rate_limited = data.get("rate_limited", False)

                latest = sessions[-1]
                sid = latest["id"]

                self.root.after(
                    0, self._update_progress_text,
                    "Saving engagement data...",
                )
                t_step = time.time()
                store_media_items(
                    sid, data["media_items"], db_path=db_path,
                )
                store_media_interactions(
                    sid, data["interactions"], db_path=db_path,
                )
                store_story_viewers(
                    sid, data["story_viewers"], db_path=db_path,
                )
                db_time = self._format_elapsed(time.time() - t_step)

                self.root.after(
                    0, self._log,
                    f"Saved {data['media_count']} media items, "
                    f"{len(data['interactions'])} interactions, "
                    f"{len(data['story_viewers'])} story views. "
                    f"({db_time})",
                )

                if self._cancel_event.is_set():
                    raise _Cancelled()

                self.root.after(
                    0, self._update_progress_text,
                    "Generating engagement report...",
                )
                t_step = time.time()
                current_followers = get_session_followers(
                    sid, db_path=db_path,
                )
                eng_report = compute_engagement_report(
                    followers=current_followers,
                    media_items=data["media_items"],
                    interactions=data["interactions"],
                    story_viewers=data["story_viewers"],
                    follower_count=latest["follower_count"],
                )
                report_time = self._format_elapsed(time.time() - t_step)

                elapsed = time.time() - t0
                elapsed_str = self._format_elapsed(elapsed)

                self.root.after(
                    0, self._log,
                    f"Engagement report generated. ({report_time})",
                )

                self.root.after(
                    0, self._display_engagement, eng_report,
                )

                if was_rate_limited:
                    cd = 300  # 5-minute cooldown
                    self.root.after(
                        0, self._set_status,
                        f"Partial engagement data shown "
                        f"(rate limited) — {elapsed_str}.",
                    )
                    self.root.after(
                        0, self._log,
                        f"⚠ Engagement analysis completed with "
                        f"PARTIAL data (rate limited). "
                        f"Total time: {elapsed_str}.",
                    )
                    self.root.after(
                        0, lambda: messagebox.showwarning(
                            "Partial Results — Rate Limited",
                            "Instagram rate-limited the API.\n\n"
                            f"Results are based on "
                            f"{data['media_count']} media items "
                            f"collected before the limit was hit.\n\n"
                            f"The Engagement button will be available "
                            f"again in {cd // 60} minutes.",
                        ),
                    )
                    self.root.after(
                        0, self._start_cooldown,
                        self.btn_engagement,
                        "Analyze Engagement", cd,
                    )
                else:
                    self.root.after(
                        0, self._set_status,
                        f"Engagement analysis complete in {elapsed_str}.",
                    )
                    self.root.after(
                        0, self._log,
                        f"Engagement analysis done. "
                        f"Total time: {elapsed_str}.",
                    )

            except _Cancelled:
                self.root.after(0, self._log,
                                "Engagement analysis cancelled.")
                self.root.after(0, self._set_status, "Cancelled.")
            except IGRateLimitError as e:
                cd = e.cooldown
                self.root.after(0, self._log,
                                f"⚠ RATE LIMITED: {e}")
                self.root.after(0, self._set_status,
                                "Rate limited by Instagram.")
                self.root.after(
                    0, lambda: messagebox.showwarning(
                        "Rate Limited",
                        "Instagram has rate-limited this request.\n\n"
                        f"The Engagement button will be available "
                        f"again in {cd // 60} minutes.",
                    ),
                )
                self.root.after(
                    0, self._start_cooldown,
                    self.btn_engagement,
                    "Analyze Engagement", cd,
                )
            except IGTimeoutError as e:
                cd = e.cooldown
                self.root.after(0, self._log,
                                f"⚠ TIMEOUT: {e}")
                self.root.after(0, self._set_status,
                                "API request timed out.")
                self.root.after(
                    0, lambda: messagebox.showwarning(
                        "Request Timed Out",
                        "The Instagram API request timed out.\n\n"
                        f"The Engagement button will be available "
                        f"again in {cd // 60} minutes.",
                    ),
                )
                self.root.after(
                    0, self._start_cooldown,
                    self.btn_engagement,
                    "Analyze Engagement", cd,
                )
            except Exception as e:
                self.root.after(0, self._log, f"ERROR: {e}")
                self.root.after(0, self._set_status, f"Error: {e}")
                self.root.after(
                    0,
                    lambda: messagebox.showerror("Engagement Failed", str(e)),
                )
            finally:
                self.root.after(0, self._set_buttons_state, "normal")
                self.root.after(0, self._hide_progress)

        threading.Thread(target=_worker, daemon=True).start()

    def _display_engagement(self, eng_report):
        self._last_eng_report = eng_report
        self._build_content_tab(eng_report)
        self._build_engagement_tab(eng_report)
        self._build_ghost_tab(eng_report)
        self.notebook.select(self.content_frame)

    # ── Content tab ──────────────────────────────────────────────────────

    def _build_content_tab(self, eng):
        t = self.t
        self._clear_frame(self.content_frame)
        f = self.content_frame

        canvas = tk.Canvas(f, bg=t["BG"], highlightthickness=0, bd=0)
        scroll = ttk.Scrollbar(f, orient="vertical", command=canvas.yview)
        inner = tk.Frame(canvas, bg=t["BG"])
        inner.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all")),
        )
        canvas.create_window((0, 0), window=inner, anchor="nw")
        canvas.configure(yscrollcommand=scroll.set)
        canvas.bind(
            "<MouseWheel>",
            lambda e: canvas.yview_scroll(int(-1 * (e.delta / 120)), "units"),
        )
        inner.bind(
            "<MouseWheel>",
            lambda e: canvas.yview_scroll(int(-1 * (e.delta / 120)), "units"),
        )
        canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

        # ── Overall stats ──
        tk.Label(
            inner, text="Content Performance",
            font=("Segoe UI", 14, "bold"), bg=t["BG"], fg=t["ACCENT"],
        ).pack(anchor="w", padx=20, pady=(16, 8))

        stats_grid = tk.Frame(inner, bg=t["BG"])
        stats_grid.pack(fill="x", padx=20)

        overview = [
            ("Posts Analyzed", str(eng["total_posts_analyzed"]), t["CYAN"]),
            ("Total Likes", f"{eng['total_likes']:,}", t["RED"]),
            ("Total Comments", f"{eng['total_comments']:,}", t["BLUE"]),
            (
                "Avg Engagement Rate",
                f"{eng['avg_engagement_rate']:.2f}%",
                t["GREEN"] if eng["avg_engagement_rate"] >= 3 else t["YELLOW"],
            ),
            (
                "Comment / Like Ratio",
                f"{eng['comment_to_like_ratio']:.3f}",
                t["CYAN"],
            ),
        ]
        if eng.get("best_content_type"):
            overview.append(
                ("Best Content Type", eng["best_content_type"], t["GREEN"]),
            )
        if eng.get("worst_content_type") and eng["worst_content_type"] != eng.get("best_content_type"):
            overview.append(
                ("Worst Content Type", eng["worst_content_type"], t["RED"]),
            )

        for idx, (label, value, color) in enumerate(overview):
            row, col = divmod(idx, 5)
            cell = tk.Frame(
                stats_grid, bg=t["BG_CARD"], padx=18, pady=12,
                highlightbackground=t["CARD_BORDER"], highlightthickness=1,
            )
            cell.grid(row=row, column=col, padx=5, pady=5, sticky="nsew")
            tk.Label(
                cell, text=value, font=("Segoe UI", 18, "bold"),
                bg=t["BG_CARD"], fg=color,
            ).pack()
            tk.Label(
                cell, text=label, font=("Segoe UI", 9),
                bg=t["BG_CARD"], fg=t["FG_DIM"],
            ).pack(pady=(2, 0))
        for c in range(min(5, len(overview))):
            stats_grid.columnconfigure(c, weight=1)

        # ── Content type breakdown ──
        breakdown = eng.get("content_breakdown", {})
        if breakdown:
            tk.Label(
                inner, text="Performance by Content Type",
                font=("Segoe UI", 13, "bold"), bg=t["BG"], fg=t["BLUE"],
            ).pack(anchor="w", padx=20, pady=(16, 8))

            type_grid = tk.Frame(inner, bg=t["BG"])
            type_grid.pack(fill="x", padx=20)

            type_colors = {
                "Photo": t["CYAN"],
                "Reel": t["MAGENTA"],
                "Carousel": t["YELLOW"],
                "Video": t["GREEN"],
                "IGTV": t["BLUE"],
            }

            for idx, (ctype, data) in enumerate(breakdown.items()):
                col = idx
                color = type_colors.get(ctype, t["FG"])
                cell = tk.Frame(
                    type_grid, bg=t["BG_CARD"], padx=16, pady=10,
                    highlightbackground=t["CARD_BORDER"],
                    highlightthickness=1,
                )
                cell.grid(row=0, column=col, padx=5, pady=5, sticky="nsew")
                tk.Label(
                    cell, text=ctype,
                    font=("Segoe UI", 12, "bold"),
                    bg=t["BG_CARD"], fg=color,
                ).pack(anchor="w")
                tk.Label(
                    cell, text=f"{data['count']} posts",
                    font=("Segoe UI", 9),
                    bg=t["BG_CARD"], fg=t["FG_DIM"],
                ).pack(anchor="w", pady=(2, 6))

                for metric, val in [
                    ("Avg Likes", data["avg_likes"]),
                    ("Avg Comments", data["avg_comments"]),
                    ("Avg Views", data["avg_views"]),
                    ("Avg Eng. Rate", f"{data['avg_engagement_rate']}%"),
                ]:
                    if metric == "Avg Views" and val == 0:
                        continue
                    row_f = tk.Frame(cell, bg=t["BG_CARD"])
                    row_f.pack(fill="x")
                    tk.Label(
                        row_f, text=metric, font=("Segoe UI", 9),
                        bg=t["BG_CARD"], fg=t["FG_DIM"],
                    ).pack(side="left")
                    tk.Label(
                        row_f, text=str(val), font=("Segoe UI", 9, "bold"),
                        bg=t["BG_CARD"], fg=t["FG"],
                    ).pack(side="right")

            for c in range(len(breakdown)):
                type_grid.columnconfigure(c, weight=1)

        # ── Top posts table ──
        top = eng.get("top_posts", [])
        if top:
            tk.Label(
                inner, text="Top Posts by Engagement",
                font=("Segoe UI", 13, "bold"), bg=t["BG"], fg=t["GREEN"],
            ).pack(anchor="w", padx=20, pady=(16, 8))

            tbl_frame = tk.Frame(inner, bg=t["BG"])
            tbl_frame.pack(fill="x", padx=20, pady=(0, 16))

            cols = (
                "rank", "type", "date", "caption", "likes", "comments",
                "engagement", "views", "plays", "eng_rate",
                "duration", "location", "tags", "slides", "paid", "link",
            )
            tree = ttk.Treeview(
                tbl_frame, columns=cols, show="headings", height=12,
            )
            tree.heading("rank", text="#")
            tree.heading("type", text="Type")
            tree.heading("date", text="Date")
            tree.heading("caption", text="Caption")
            tree.heading("likes", text="Likes")
            tree.heading("comments", text="Cmts")
            tree.heading("engagement", text="Total")
            tree.heading("views", text="Views")
            tree.heading("plays", text="Plays")
            tree.heading("eng_rate", text="Eng %")
            tree.heading("duration", text="Duration")
            tree.heading("location", text="Location")
            tree.heading("tags", text="Tags")
            tree.heading("slides", text="Slides")
            tree.heading("paid", text="Paid")
            tree.heading("link", text="Link")
            tree.column("rank", width=35, anchor="center", stretch=False)
            tree.column("type", width=65, anchor="center", stretch=False)
            tree.column("date", width=80, stretch=False)
            tree.column("caption", width=160, stretch=True)
            tree.column("likes", width=50, anchor="center", stretch=False)
            tree.column("comments", width=50, anchor="center", stretch=False)
            tree.column("engagement", width=50, anchor="center", stretch=False)
            tree.column("views", width=55, anchor="center", stretch=False)
            tree.column("plays", width=55, anchor="center", stretch=False)
            tree.column("eng_rate", width=55, anchor="center", stretch=False)
            tree.column("duration", width=60, anchor="center", stretch=False)
            tree.column("location", width=100, stretch=True)
            tree.column("tags", width=40, anchor="center", stretch=False)
            tree.column("slides", width=45, anchor="center", stretch=False)
            tree.column("paid", width=40, anchor="center", stretch=False)
            tree.column("link", width=120, stretch=False)

            tree.tag_configure("stripe", background=t["STRIPE"])

            for i, p in enumerate(top, 1):
                tags = ("stripe",) if i % 2 == 0 else ()
                views = str(p["view_count"]) if p["view_count"] else "\u2014"
                plays = str(p.get("play_count") or 0) if p.get("play_count") else "\u2014"
                link = (
                    f"instagram.com/p/{p['code']}"
                    if p.get("code") else ""
                )
                caption = (p.get("caption") or "")[:80]
                dur = p.get("video_duration", 0)
                dur_str = f"{int(dur)}s" if dur else "\u2014"
                loc = (p.get("location") or "")[:30]
                utags = p.get("usertags_count", 0)
                slides = p.get("carousel_count", 0)
                paid = "\u2714" if p.get("is_paid_partnership") else ""
                engagement = p.get("engagement", p["like_count"] + p["comment_count"])
                tree.insert("", "end", values=(
                    i, p["type_label"],
                    p["taken_at"][:10] if p.get("taken_at") else "",
                    caption,
                    p["like_count"], p["comment_count"], engagement,
                    views, plays, f"{p['engagement_rate']}%",
                    dur_str, loc,
                    utags if utags else "\u2014",
                    slides if slides else "\u2014",
                    paid, link,
                ), tags=tags)

            # Single-click on link column → copy to clipboard
            def _copy_link(event):
                region = tree.identify_region(event.x, event.y)
                if region != "cell":
                    return
                col = tree.identify_column(event.x)
                col_idx = int(col.replace("#", "")) - 1
                if cols[col_idx] != "link":
                    return
                row_id = tree.identify_row(event.y)
                if not row_id:
                    return
                vals = tree.item(row_id, "values")
                link_val = vals[col_idx] if vals else ""
                if link_val:
                    full_url = f"https://{link_val}"
                    self.root.clipboard_clear()
                    self.root.clipboard_append(full_url)
                    self._set_status(f"Copied: {full_url}")

            tree.bind("<ButtonRelease-1>", _copy_link)

            # Double-click to open in browser
            def _open_post(event):
                sel = tree.selection()
                if sel:
                    idx = int(tree.item(sel[0])["values"][0]) - 1
                    if 0 <= idx < len(top) and top[idx].get("code"):
                        webbrowser.open(
                            f"https://www.instagram.com/p/{top[idx]['code']}/",
                        )

            tree.bind("<Double-1>", _open_post)

            sb = ttk.Scrollbar(
                tbl_frame, orient="vertical", command=tree.yview,
            )
            tree.configure(yscrollcommand=sb.set)
            tree.pack(side="left", fill="x", expand=True)
            sb.pack(side="right", fill="y")

            self._make_sortable(tree, cols)

            tk.Label(
                inner,
                text="Click a link to copy · Double-click a row to open in browser",
                font=("Segoe UI", 9), bg=t["BG"], fg=t["FG_MUTED"],
            ).pack(anchor="w", padx=24, pady=(0, 12))

        # ── Best Time to Post ──
        best_day = eng.get("best_day")
        best_hour = eng.get("best_hour")
        if best_day or best_hour:
            tk.Label(
                inner, text="Best Time to Post",
                font=("Segoe UI", 13, "bold"), bg=t["BG"], fg=t["MAGENTA"],
            ).pack(anchor="w", padx=20, pady=(16, 8))

            time_grid = tk.Frame(inner, bg=t["BG"])
            time_grid.pack(fill="x", padx=20)

            col = 0
            if best_day:
                cell = tk.Frame(
                    time_grid, bg=t["BG_CARD"], padx=18, pady=12,
                    highlightbackground=t["CARD_BORDER"],
                    highlightthickness=1,
                )
                cell.grid(row=0, column=col, padx=5, pady=5, sticky="nsew")
                tk.Label(
                    cell, text=best_day["day"],
                    font=("Segoe UI", 20, "bold"),
                    bg=t["BG_CARD"], fg=t["MAGENTA"],
                ).pack()
                tk.Label(
                    cell, text="Best Day",
                    font=("Segoe UI", 9),
                    bg=t["BG_CARD"], fg=t["FG_DIM"],
                ).pack()
                tk.Label(
                    cell,
                    text=f"{best_day['avg_rate']}% avg eng · "
                         f"{best_day['post_count']} posts",
                    font=("Segoe UI", 8),
                    bg=t["BG_CARD"], fg=t["FG_MUTED"],
                ).pack(pady=(2, 0))
                col += 1

            if best_hour:
                cell = tk.Frame(
                    time_grid, bg=t["BG_CARD"], padx=18, pady=12,
                    highlightbackground=t["CARD_BORDER"],
                    highlightthickness=1,
                )
                cell.grid(row=0, column=col, padx=5, pady=5, sticky="nsew")
                tk.Label(
                    cell, text=best_hour["label"],
                    font=("Segoe UI", 20, "bold"),
                    bg=t["BG_CARD"], fg=t["MAGENTA"],
                ).pack()
                tk.Label(
                    cell, text="Best Hour",
                    font=("Segoe UI", 9),
                    bg=t["BG_CARD"], fg=t["FG_DIM"],
                ).pack()
                tk.Label(
                    cell,
                    text=f"{best_hour['avg_rate']}% avg eng · "
                         f"{best_hour['post_count']} posts",
                    font=("Segoe UI", 8),
                    bg=t["BG_CARD"], fg=t["FG_MUTED"],
                ).pack(pady=(2, 0))
                col += 1

            for c in range(col):
                time_grid.columnconfigure(c, weight=1)

        # ── Engagement Trend ──
        trend = eng.get("engagement_trend")
        if trend and isinstance(trend, dict):
            tk.Label(
                inner, text="Engagement Trend",
                font=("Segoe UI", 13, "bold"), bg=t["BG"], fg=t["BLUE"],
            ).pack(anchor="w", padx=20, pady=(16, 8))

            trend_grid = tk.Frame(inner, bg=t["BG"])
            trend_grid.pack(fill="x", padx=20, pady=(0, 12))

            arrow = "\u2197" if trend["direction"] == "up" else (
                "\u2198" if trend["direction"] == "down" else "\u2192"
            )
            trend_color = (
                t["GREEN"] if trend["direction"] == "up"
                else t["RED"] if trend["direction"] == "down"
                else t["YELLOW"]
            )
            change_s = f"+{trend['change']}" if trend["change"] > 0 else str(trend["change"])

            trend_items = [
                (
                    f"Older Posts ({trend['older_count']})",
                    f"{trend['older_avg']}%",
                    t["FG_DIM"],
                ),
                (
                    f"Newer Posts ({trend['newer_count']})",
                    f"{trend['newer_avg']}%",
                    t["CYAN"],
                ),
                (
                    "Trend",
                    f"{arrow} {change_s}%",
                    trend_color,
                ),
            ]
            for idx, (lbl, val, clr) in enumerate(trend_items):
                cell = tk.Frame(
                    trend_grid, bg=t["BG_CARD"], padx=18, pady=12,
                    highlightbackground=t["CARD_BORDER"],
                    highlightthickness=1,
                )
                cell.grid(row=0, column=idx, padx=5, pady=5, sticky="nsew")
                tk.Label(
                    cell, text=val,
                    font=("Segoe UI", 18, "bold"),
                    bg=t["BG_CARD"], fg=clr,
                ).pack()
                tk.Label(
                    cell, text=lbl,
                    font=("Segoe UI", 9),
                    bg=t["BG_CARD"], fg=t["FG_DIM"],
                ).pack(pady=(2, 0))
            for c in range(3):
                trend_grid.columnconfigure(c, weight=1)

    # ── Engagement tab (top engagers + non-follower engagers) ────────────

    def _build_engagement_tab(self, eng):
        t = self.t
        self._clear_frame(self.engage_frame)
        f = self.engage_frame

        canvas = tk.Canvas(f, bg=t["BG"], highlightthickness=0, bd=0)
        scroll = ttk.Scrollbar(f, orient="vertical", command=canvas.yview)
        inner = tk.Frame(canvas, bg=t["BG"])
        inner.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all")),
        )
        canvas.create_window((0, 0), window=inner, anchor="nw")
        canvas.configure(yscrollcommand=scroll.set)
        canvas.bind(
            "<MouseWheel>",
            lambda e: canvas.yview_scroll(int(-1 * (e.delta / 120)), "units"),
        )
        inner.bind(
            "<MouseWheel>",
            lambda e: canvas.yview_scroll(int(-1 * (e.delta / 120)), "units"),
        )
        canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

        # ── Summary cards ──
        tk.Label(
            inner, text="Engagement Analysis",
            font=("Segoe UI", 14, "bold"), bg=t["BG"], fg=t["ACCENT"],
        ).pack(anchor="w", padx=20, pady=(16, 8))

        cards_grid = tk.Frame(inner, bg=t["BG"])
        cards_grid.pack(fill="x", padx=20)

        card_items = [
            (
                "Active Followers",
                str(eng["active_count"]),
                t["GREEN"],
            ),
            (
                "Ghost Followers",
                str(eng["ghost_count"]),
                t["RED"],
            ),
            (
                "Ghost Rate",
                f"{eng['ghost_percentage']:.1f}%",
                t["RED"] if eng["ghost_percentage"] > 50 else t["YELLOW"],
            ),
            (
                "Non-Follower Engagers",
                str(len(eng["non_follower_engagers"])),
                t["CYAN"],
            ),
        ]
        if eng.get("has_stories"):
            card_items.extend([
                (
                    "Story Viewers",
                    str(eng["story_viewer_count"]),
                    t["MAGENTA"],
                ),
                (
                    "Story Reach (count)",
                    str(eng["story_reach_followers"]),
                    t["CYAN"],
                ),
                (
                    "Story Reach %",
                    f"{eng['story_reach_pct']:.1f}%",
                    t["CYAN"]
                    if eng["story_reach_pct"] >= 10 else t["YELLOW"],
                ),
            ])

        if eng.get("loyal_count", 0):
            card_items.append((
                "Loyal Followers",
                str(eng["loyal_count"]),
                t["GREEN"],
            ))

        for idx, (label, value, color) in enumerate(card_items):
            row, col = divmod(idx, 4)
            cell = tk.Frame(
                cards_grid, bg=t["BG_CARD"], padx=18, pady=12,
                highlightbackground=t["CARD_BORDER"], highlightthickness=1,
            )
            cell.grid(row=row, column=col, padx=5, pady=5, sticky="nsew")
            tk.Label(
                cell, text=value, font=("Segoe UI", 20, "bold"),
                bg=t["BG_CARD"], fg=color,
            ).pack()
            tk.Label(
                cell, text=label, font=("Segoe UI", 9),
                bg=t["BG_CARD"], fg=t["FG_DIM"],
            ).pack(pady=(2, 0))
        for c in range(min(4, len(card_items))):
            cards_grid.columnconfigure(c, weight=1)

        # ── Top engagers table ──
        active = eng.get("active_followers", [])
        if active:
            tk.Label(
                inner, text=f"Top Engagers  ({len(active)})",
                font=("Segoe UI", 13, "bold"), bg=t["BG"], fg=t["GREEN"],
            ).pack(anchor="w", padx=20, pady=(16, 6))

            tbl = tk.Frame(inner, bg=t["BG"])
            tbl.pack(fill="x", padx=20, pady=(0, 12))

            cols = ("rank", "username", "likes", "comments", "total")
            tree = ttk.Treeview(
                tbl, columns=cols, show="headings",
                height=min(15, len(active)),
            )
            tree.heading("rank", text="#")
            tree.heading("username", text="Username")
            tree.heading("likes", text="Likes")
            tree.heading("comments", text="Comments")
            tree.heading("total", text="Total")
            tree.column("rank", width=40, anchor="center", stretch=False)
            tree.column("username", width=200, stretch=True)
            tree.column("likes", width=80, anchor="center", stretch=False)
            tree.column(
                "comments", width=90, anchor="center", stretch=False,
            )
            tree.column("total", width=80, anchor="center", stretch=False)
            tree.tag_configure("stripe", background=t["STRIPE"])

            for i, u in enumerate(active, 1):
                tags = ("stripe",) if i % 2 == 0 else ()
                tree.insert("", "end", values=(
                    i, f"@{u['username']}",
                    u["likes"], u["comments"],
                    u["total_interactions"],
                ), tags=tags)

            sb = ttk.Scrollbar(
                tbl, orient="vertical", command=tree.yview,
            )
            tree.configure(yscrollcommand=sb.set)
            tree.pack(side="left", fill="x", expand=True)
            sb.pack(side="right", fill="y")

            self._make_sortable(tree, cols)
            self._add_filter_bar(
                inner, tree, cols, filter_cols=["username"],
            ).pack(fill="x", padx=20, pady=(0, 0), before=tbl)

        # ── Non-follower engagers ──
        nfe = eng.get("non_follower_engagers", [])
        if nfe:
            tk.Label(
                inner,
                text=f"Non-Follower Engagers  ({len(nfe)})",
                font=("Segoe UI", 13, "bold"), bg=t["BG"], fg=t["CYAN"],
            ).pack(anchor="w", padx=20, pady=(12, 6))
            tk.Label(
                inner,
                text="People who like/comment on your posts "
                     "but don't follow you",
                font=("Segoe UI", 9), bg=t["BG"], fg=t["FG_DIM"],
            ).pack(anchor="w", padx=24, pady=(0, 6))

            tbl2 = tk.Frame(inner, bg=t["BG"])
            tbl2.pack(fill="x", padx=20, pady=(0, 16))

            cols2 = ("rank", "username", "likes", "comments", "total")
            tree2 = ttk.Treeview(
                tbl2, columns=cols2, show="headings",
                height=min(10, len(nfe)),
            )
            tree2.heading("rank", text="#")
            tree2.heading("username", text="Username")
            tree2.heading("likes", text="Likes")
            tree2.heading("comments", text="Comments")
            tree2.heading("total", text="Total")
            tree2.column("rank", width=40, anchor="center", stretch=False)
            tree2.column("username", width=200, stretch=True)
            tree2.column("likes", width=80, anchor="center", stretch=False)
            tree2.column(
                "comments", width=90, anchor="center", stretch=False,
            )
            tree2.column("total", width=80, anchor="center", stretch=False)
            tree2.tag_configure("stripe", background=t["STRIPE"])

            for i, u in enumerate(nfe, 1):
                tags = ("stripe",) if i % 2 == 0 else ()
                tree2.insert("", "end", values=(
                    i, f"@{u['username']}",
                    u["likes"], u["comments"], u["total"],
                ), tags=tags)

            sb2 = ttk.Scrollbar(
                tbl2, orient="vertical", command=tree2.yview,
            )
            tree2.configure(yscrollcommand=sb2.set)
            tree2.pack(side="left", fill="x", expand=True)
            sb2.pack(side="right", fill="y")

            self._make_sortable(tree2, cols2)
            self._add_filter_bar(
                inner, tree2, cols2, filter_cols=["username"],
            ).pack(fill="x", padx=20, pady=(0, 0), before=tbl2)

        # ── Loyal Followers (like + comment + story view) ──
        loyal = eng.get("loyal_followers", [])
        if loyal:
            tk.Label(
                inner,
                text=f"Most Loyal Followers  ({len(loyal)})",
                font=("Segoe UI", 13, "bold"), bg=t["BG"], fg=t["GREEN"],
            ).pack(anchor="w", padx=20, pady=(16, 6))
            tk.Label(
                inner,
                text="Followers who liked, commented, AND viewed "
                     "your stories",
                font=("Segoe UI", 9), bg=t["BG"], fg=t["FG_DIM"],
            ).pack(anchor="w", padx=24, pady=(0, 6))

            tbl3 = tk.Frame(inner, bg=t["BG"])
            tbl3.pack(fill="x", padx=20, pady=(0, 12))

            cols3 = ("num", "username", "full_name")
            show_mode = "tree headings" if HAS_PIL else "headings"
            tree3 = ttk.Treeview(
                tbl3, columns=cols3, show=show_mode,
                height=min(15, len(loyal)),
            )
            if HAS_PIL:
                tree3.heading("#0", text="")
                tree3.column("#0", width=42, minwidth=42, stretch=False)
            tree3.heading("num", text="#")
            tree3.heading("username", text="Username")
            tree3.heading("full_name", text="Full Name")
            tree3.column(
                "num", width=50, anchor="center", stretch=False,
            )
            tree3.column("username", width=220, stretch=True)
            tree3.column("full_name", width=300, stretch=True)
            tree3.tag_configure("stripe", background=t["STRIPE"])

            photo_dir = self._get_photo_dir()
            for i, u in enumerate(loyal, 1):
                tags = ("stripe",) if i % 2 == 0 else ()
                photo_path = (
                    os.path.join(photo_dir, f"{u['username']}_32.png")
                    if HAS_PIL else None
                )
                img = (
                    _load_photo_tk(photo_path)
                    if photo_path and os.path.exists(photo_path) else None
                )
                kw = {"image": img} if img else {}
                if img:
                    self._photo_refs.append(img)
                tree3.insert(
                    "", "end",
                    values=(i, f"@{u['username']}",
                            u.get("full_name", "")),
                    tags=tags, **kw,
                )

            sb3 = ttk.Scrollbar(
                tbl3, orient="vertical", command=tree3.yview,
            )
            tree3.configure(yscrollcommand=sb3.set)
            tree3.pack(side="left", fill="x", expand=True)
            sb3.pack(side="right", fill="y")

            self._make_sortable(tree3, cols3)
            self._add_filter_bar(
                inner, tree3, cols3, filter_cols=["username", "full_name"],
            ).pack(fill="x", padx=20, pady=(0, 0), before=tbl3)

        # ── Story Viewer List ──
        sv_list = eng.get("story_viewer_list", [])
        if sv_list:
            tk.Label(
                inner,
                text=f"Story Viewers  ({len(sv_list)})",
                font=("Segoe UI", 13, "bold"), bg=t["BG"],
                fg=t["MAGENTA"],
            ).pack(anchor="w", padx=20, pady=(16, 6))

            tbl4 = tk.Frame(inner, bg=t["BG"])
            tbl4.pack(fill="x", padx=20, pady=(0, 16))

            cols4 = ("num", "username", "follows_you")
            tree4 = ttk.Treeview(
                tbl4, columns=cols4, show="headings",
                height=min(15, len(sv_list)),
            )
            tree4.heading("num", text="#")
            tree4.heading("username", text="Username")
            tree4.heading("follows_you", text="Follows You")
            tree4.column(
                "num", width=50, anchor="center", stretch=False,
            )
            tree4.column("username", width=220, stretch=True)
            tree4.column(
                "follows_you", width=100, anchor="center",
                stretch=False,
            )
            tree4.tag_configure("stripe", background=t["STRIPE"])

            for i, v in enumerate(sv_list, 1):
                tags = ("stripe",) if i % 2 == 0 else ()
                follows = "\u2714" if v["is_follower"] else "\u2716"
                tree4.insert("", "end", values=(
                    i, f"@{v['username']}", follows,
                ), tags=tags)

            sb4 = ttk.Scrollbar(
                tbl4, orient="vertical", command=tree4.yview,
            )
            tree4.configure(yscrollcommand=sb4.set)
            tree4.pack(side="left", fill="x", expand=True)
            sb4.pack(side="right", fill="y")

            self._make_sortable(tree4, cols4)
            self._add_filter_bar(
                inner, tree4, cols4, filter_cols=["username"],
            ).pack(fill="x", padx=20, pady=(0, 0), before=tbl4)

    # ── Ghost Followers tab ──────────────────────────────────────────────

    def _build_ghost_tab(self, eng):
        t = self.t
        ghosts = eng.get("ghost_followers", [])
        n_posts = eng.get("total_posts_analyzed", 0)

        self._clear_frame(self.ghost_frame)
        parent = self.ghost_frame

        header = tk.Frame(parent, bg=t["BG"], pady=10)
        header.pack(fill="x", padx=20)
        tk.Label(
            header,
            text=f"Ghost Followers  ({len(ghosts)})",
            font=("Segoe UI", 13, "bold"), bg=t["BG"], fg=t["RED"],
        ).pack(anchor="w")
        tk.Label(
            header,
            text=f"Followers who haven't liked or commented "
                 f"on any of your last {n_posts} posts",
            font=("Segoe UI", 9), bg=t["BG"], fg=t["FG_DIM"],
        ).pack(anchor="w", pady=(2, 0))

        # Summary bar
        pct = eng.get("ghost_percentage", 0)
        bar_frame = tk.Frame(parent, bg=t["BG"])
        bar_frame.pack(fill="x", padx=20, pady=(4, 10))

        bar_bg = tk.Frame(
            bar_frame, bg=t["PROGRESS_BG"], height=20,
        )
        bar_bg.pack(fill="x")
        bar_bg.pack_propagate(False)

        fill_w = max(pct, 1)
        bar_fg = tk.Frame(bar_bg, bg=t["RED"])
        bar_fg.place(relx=0, rely=0, relwidth=fill_w / 100, relheight=1)

        tk.Label(
            bar_frame,
            text=f"{pct:.1f}% of your followers are ghosts  "
                 f"({len(ghosts)} / "
                 f"{len(ghosts) + eng.get('active_count', 0)})",
            font=("Segoe UI", 9), bg=t["BG"], fg=t["FG_DIM"],
        ).pack(anchor="w", pady=(4, 0))

        if not ghosts:
            tk.Label(
                parent, text="No ghost followers found!",
                font=("Segoe UI", 11), bg=t["BG"], fg=t["GREEN"],
            ).pack(padx=28, anchor="w", pady=12)
            return

        # Action bar (unfollow / browser / select)
        self._action_tables["ghost"] = {"tree": None, "users": ghosts}

        action_bar = tk.Frame(parent, bg=t["BG"])
        action_bar.pack(fill="x", padx=20, pady=(0, 8))

        btn_unfollow = tk.Button(
            action_bar, text="\u2716  Unfollow Selected",
            command=lambda: self._on_unfollow_selected("ghost"),
            bg=t["RED"], fg="#fff", activebackground="#dc2626",
            relief="flat", font=("Segoe UI", 10, "bold"),
            padx=14, pady=4, cursor="hand2", bd=0,
        )
        btn_unfollow.pack(side="left", padx=(0, 8))
        _hover_bind(
            btn_unfollow, t["RED"],
            "#dc2626" if self.current_theme == "dark" else "#b91c1c",
        )
        self._action_tables["ghost"]["btn_unfollow"] = btn_unfollow

        btn_browser = tk.Button(
            action_bar, text="Open in Browser",
            command=lambda: self._on_open_in_browser("ghost"),
            bg=t["BTN_SEC"], fg=t["FG"], relief="flat",
            font=("Segoe UI", 10), padx=14, pady=4, cursor="hand2", bd=0,
        )
        btn_browser.pack(side="left", padx=(0, 8))
        _hover_bind(btn_browser, t["BTN_SEC"], t["BTN_SEC_HVR"])

        btn_sel = tk.Button(
            action_bar, text="Select All",
            command=lambda: self._on_select_all("ghost"),
            bg=t["BTN_SEC"], fg=t["FG"], relief="flat",
            font=("Segoe UI", 10), padx=12, pady=4, cursor="hand2", bd=0,
        )
        btn_sel.pack(side="left", padx=(0, 4))
        _hover_bind(btn_sel, t["BTN_SEC"], t["BTN_SEC_HVR"])

        btn_desel = tk.Button(
            action_bar, text="Deselect All",
            command=lambda: self._on_deselect_all("ghost"),
            bg=t["BTN_SEC"], fg=t["FG"], relief="flat",
            font=("Segoe UI", 10), padx=12, pady=4, cursor="hand2", bd=0,
        )
        btn_desel.pack(side="left")
        _hover_bind(btn_desel, t["BTN_SEC"], t["BTN_SEC_HVR"])

        table_frame = tk.Frame(parent, bg=t["BG"])
        table_frame.pack(fill="both", expand=True, padx=20, pady=(0, 10))

        cols = ("num", "username", "full_name")
        show_mode = "tree headings" if HAS_PIL else "headings"
        tree = ttk.Treeview(
            table_frame, columns=cols, show=show_mode, selectmode="extended",
        )
        if HAS_PIL:
            tree.heading("#0", text="")
            tree.column("#0", width=42, minwidth=42, stretch=False)
        tree.heading("num", text="#")
        tree.heading("username", text="Username")
        tree.heading("full_name", text="Full Name")
        tree.column(
            "num", width=50, minwidth=40, anchor="center", stretch=False,
        )
        tree.column("username", width=220, minwidth=120, stretch=True)
        tree.column("full_name", width=300, minwidth=120, stretch=True)
        tree.tag_configure("stripe", background=t["STRIPE"])

        photo_dir = self._get_photo_dir()
        for i, u in enumerate(ghosts, 1):
            tags = ("stripe",) if i % 2 == 0 else ()
            photo_path = (
                os.path.join(photo_dir, f"{u['username']}_32.png")
                if HAS_PIL else None
            )
            img = (
                _load_photo_tk(photo_path)
                if photo_path and os.path.exists(photo_path) else None
            )
            kw = {"image": img} if img else {}
            if img:
                self._photo_refs.append(img)
            tree.insert(
                "", "end", iid=str(i - 1),
                values=(i, f"@{u['username']}", u.get("full_name", "")),
                tags=tags, **kw,
            )

        sb = ttk.Scrollbar(
            table_frame, orient="vertical", command=tree.yview,
        )
        tree.configure(yscrollcommand=sb.set)
        tree.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")

        self._make_sortable(tree, cols)
        self._add_filter_bar(
            parent, tree, cols, filter_cols=["username", "full_name"],
        ).pack(fill="x", padx=20, pady=(0, 0), before=table_frame)

        self._action_tables["ghost"]["tree"] = tree

    # ── Winner / Giveaway tab ────────────────────────────────────────────

    def _build_winner_tab(self):
        t = self.t
        self._clear_frame(self.winner_frame)
        parent = self.winner_frame

        canvas = tk.Canvas(parent, bg=t["BG"], highlightthickness=0, bd=0)
        scroll = ttk.Scrollbar(parent, orient="vertical", command=canvas.yview)
        inner = tk.Frame(canvas, bg=t["BG"])
        inner.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all")),
        )
        canvas.create_window((0, 0), window=inner, anchor="nw")
        canvas.configure(yscrollcommand=scroll.set)
        for w in (canvas, inner):
            w.bind(
                "<MouseWheel>",
                lambda e: canvas.yview_scroll(
                    int(-1 * (e.delta / 120)), "units"),
            )
        canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

        # Header
        tk.Label(
            inner, text="\U0001F3C6  Giveaway Winner Picker",
            font=("Segoe UI", 14, "bold"), bg=t["BG"], fg=t["ACCENT"],
        ).pack(anchor="w", padx=20, pady=(16, 4))
        tk.Label(
            inner,
            text="Enter an Instagram post/reel URL to fetch likers, "
                 "commenters, and the author's followers.",
            font=("Segoe UI", 9), bg=t["BG"], fg=t["FG_DIM"],
        ).pack(anchor="w", padx=24, pady=(0, 12))

        # URL input row
        url_row = tk.Frame(inner, bg=t["BG"])
        url_row.pack(fill="x", padx=20, pady=(0, 8))

        tk.Label(
            url_row, text="Post URL:", font=("Segoe UI", 10),
            bg=t["BG"], fg=t["FG"],
        ).pack(side="left", padx=(0, 6))

        self._giveaway_url_var = tk.StringVar()
        self._giveaway_url_entry = tk.Entry(
            url_row, textvariable=self._giveaway_url_var,
            font=("Segoe UI", 10), bg=t["ENTRY_BG"], fg=t["FG"],
            insertbackground=t["FG"], relief="flat", bd=2, width=50,
        )
        self._giveaway_url_entry.pack(side="left", fill="x", expand=True,
                                       padx=(0, 8))

        self._gw_not_my_post = tk.BooleanVar(value=True)
        self._chk_not_my_post = tk.Checkbutton(
            url_row, text="Not my post", variable=self._gw_not_my_post,
            bg=t["BG"], fg=t["FG"], selectcolor=t["ENTRY_BG"],
            activebackground=t["BG"], activeforeground=t["FG"],
            font=("Segoe UI", 9), cursor="hand2",
            command=self._on_not_my_post_toggled,
        )
        self._chk_not_my_post.pack(side="left", padx=(0, 8))
        _ToolTip(self._chk_not_my_post,
                 "Check if this post is NOT from your account.\n"
                 "Followers filter will be disabled for other accounts.\n"
                 "Uncheck to auto-include your own followers.")

        self._btn_fetch_giveaway = tk.Button(
            url_row, text="\U0001F50D  Fetch Data",
            command=self._on_fetch_giveaway,
            bg=t["ACCENT"], fg="#fff", relief="flat",
            font=("Segoe UI", 10, "bold"),
            padx=14, pady=4, cursor="hand2", bd=0,
        )
        self._btn_fetch_giveaway.pack(side="left")
        _hover_bind(self._btn_fetch_giveaway, t["ACCENT"], t["BTN_HOVER"])

        # Status / post info label
        self._giveaway_info_var = tk.StringVar(
            value="Enter a URL and click Fetch Data to begin.",
        )
        self._lbl_giveaway_info = tk.Label(
            inner, textvariable=self._giveaway_info_var,
            font=("Segoe UI", 10), bg=t["BG"], fg=t["FG_DIM"],
            wraplength=700, justify="left",
        )
        self._lbl_giveaway_info.pack(anchor="w", padx=24, pady=(0, 8))

        # Stats cards (hidden until data is fetched)
        self._giveaway_stats_frame = tk.Frame(inner, bg=t["BG"])
        self._giveaway_stats_frame.pack(fill="x", padx=20, pady=(0, 12))

        # Separator
        ttk.Separator(inner, orient="horizontal").pack(
            fill="x", padx=20, pady=(0, 12),
        )

        # Checkboxes
        chk_frame = tk.Frame(inner, bg=t["BG"])
        chk_frame.pack(anchor="w", padx=20, pady=(0, 8))

        tk.Label(
            chk_frame, text="Filter by (select at least one):",
            font=("Segoe UI", 10, "bold"), bg=t["BG"], fg=t["FG"],
        ).pack(anchor="w", pady=(0, 6))

        self._gw_chk_likes = tk.BooleanVar(value=True)
        self._gw_chk_comments = tk.BooleanVar(value=True)
        self._gw_chk_followers = tk.BooleanVar(value=False)
        self._gw_chk_saves = tk.BooleanVar(value=False)

        chk_row = tk.Frame(chk_frame, bg=t["BG"])
        chk_row.pack(anchor="w")

        for var, label in [
            (self._gw_chk_likes, "Likes"),
            (self._gw_chk_comments, "Comments"),
        ]:
            tk.Checkbutton(
                chk_row, text=label, variable=var,
                bg=t["BG"], fg=t["FG"], selectcolor=t["ENTRY_BG"],
                activebackground=t["BG"], activeforeground=t["FG"],
                font=("Segoe UI", 10), cursor="hand2",
                command=self._on_giveaway_filter_changed,
            ).pack(side="left", padx=(0, 16))

        # Followers checkbox — stored so we can enable/disable it
        self._chk_followers_widget = tk.Checkbutton(
            chk_row, text="Followers", variable=self._gw_chk_followers,
            bg=t["BG"], fg=t["FG"], selectcolor=t["ENTRY_BG"],
            activebackground=t["BG"], activeforeground=t["FG"],
            font=("Segoe UI", 10), cursor="hand2",
            command=self._on_giveaway_filter_changed,
        )
        self._chk_followers_widget.pack(side="left", padx=(0, 16))
        # Internal data store (must init before _on_not_my_post_toggled)
        self._giveaway_data = None
        self._giveaway_eligible = []
        # Apply initial state based on "Not my post" checkbox
        self._on_not_my_post_toggled()

        # Saves checkbox — disabled with note
        saves_chk = tk.Checkbutton(
            chk_row, text="Saves", variable=self._gw_chk_saves,
            bg=t["BG"], fg=t["FG_DIM"], selectcolor=t["ENTRY_BG"],
            activebackground=t["BG"], activeforeground=t["FG_DIM"],
            font=("Segoe UI", 10), state="disabled",
        )
        saves_chk.pack(side="left", padx=(0, 4))
        _ToolTip(saves_chk,
                 "Not available \u2014 Instagram's API does not\n"
                 "expose individual users who saved a post.")

        # Reshares checkbox — disabled with note
        self._gw_chk_reshares = tk.BooleanVar(value=False)
        reshares_chk = tk.Checkbutton(
            chk_row, text="Reshares", variable=self._gw_chk_reshares,
            bg=t["BG"], fg=t["FG_DIM"], selectcolor=t["ENTRY_BG"],
            activebackground=t["BG"], activeforeground=t["FG_DIM"],
            font=("Segoe UI", 10), state="disabled",
        )
        reshares_chk.pack(side="left", padx=(0, 4))
        _ToolTip(reshares_chk,
                 "Not available \u2014 Instagram's API does not\n"
                 "expose individual users who reshared a post.")

        # Eligible count
        self._giveaway_eligible_var = tk.StringVar(value="")
        tk.Label(
            inner, textvariable=self._giveaway_eligible_var,
            font=("Segoe UI", 11, "bold"), bg=t["BG"], fg=t["GREEN"],
        ).pack(anchor="w", padx=24, pady=(4, 8))

        # Eligible list (treeview)
        self._giveaway_list_frame = tk.Frame(inner, bg=t["BG"])
        self._giveaway_list_frame.pack(
            fill="both", expand=True, padx=20, pady=(0, 12),
        )

        # Separator
        ttk.Separator(inner, orient="horizontal").pack(
            fill="x", padx=20, pady=(0, 12),
        )

        # Seed + Pick Winner row
        pick_frame = tk.Frame(inner, bg=t["BG"])
        pick_frame.pack(anchor="w", padx=20, pady=(0, 8))

        tk.Label(
            pick_frame, text="Seed value:", font=("Segoe UI", 10),
            bg=t["BG"], fg=t["FG"],
        ).pack(side="left", padx=(0, 6))

        self._giveaway_seed_var = tk.StringVar(value="")
        self._giveaway_seed_entry = tk.Entry(
            pick_frame, textvariable=self._giveaway_seed_var,
            font=("Segoe UI", 10), bg=t["ENTRY_BG"], fg=t["FG"],
            insertbackground=t["FG"], relief="flat", bd=2, width=15,
        )
        self._giveaway_seed_entry.pack(side="left", padx=(0, 12))
        _ToolTip(self._giveaway_seed_entry,
                 "Optional seed for reproducible results.\n"
                 "Same seed + same eligible list = same winner.")

        self._btn_pick_winner = tk.Button(
            pick_frame, text="\U0001F3B2  Pick Winner",
            command=self._on_pick_winner,
            bg=t["GREEN"], fg="#fff", relief="flat",
            font=("Segoe UI", 11, "bold"),
            padx=18, pady=6, cursor="hand2", bd=0,
            state="disabled",
        )
        self._btn_pick_winner.pack(side="left")
        _hover_bind(self._btn_pick_winner, t["GREEN"], "#16a34a")

        # Winner display card (hidden until a winner is picked)
        self._winner_card = tk.Frame(
            inner, bg=t["BG_CARD"],
            highlightbackground=t["ACCENT"], highlightthickness=0,
        )
        # Don't pack yet — shown only when a winner is picked

        self._giveaway_confetti_var = tk.StringVar(value="")
        self._lbl_confetti_top = tk.Label(
            self._winner_card, textvariable=self._giveaway_confetti_var,
            font=("Segoe UI", 20), bg=t["BG_CARD"], fg=t["YELLOW"],
        )
        self._lbl_confetti_top.pack(pady=(0, 0))

        self._giveaway_winner_label_var = tk.StringVar(value="")
        tk.Label(
            self._winner_card, textvariable=self._giveaway_winner_label_var,
            font=("Segoe UI", 10, "bold"), bg=t["BG_CARD"],
            fg=t["FG_DIM"],
        ).pack(pady=(0, 2))

        self._giveaway_winner_var = tk.StringVar(value="")
        self._lbl_winner = tk.Label(
            self._winner_card, textvariable=self._giveaway_winner_var,
            font=("Segoe UI", 32, "bold"), bg=t["BG_CARD"],
            fg=t["ACCENT"],
        )
        self._lbl_winner.pack(padx=40, pady=(4, 4))

        self._giveaway_winner_sub_var = tk.StringVar(value="")
        tk.Label(
            self._winner_card,
            textvariable=self._giveaway_winner_sub_var,
            font=("Segoe UI", 9), bg=t["BG_CARD"], fg=t["FG_DIM"],
        ).pack(pady=(0, 0))

    def _on_not_my_post_toggled(self):
        """Enable/disable Followers checkbox based on 'Not my post'."""
        t = self.t
        if self._gw_not_my_post.get():
            # Not my post — disable followers checkbox
            self._gw_chk_followers.set(False)
            self._chk_followers_widget.configure(
                state="disabled", fg=t["FG_DIM"],
            )
            _ToolTip(self._chk_followers_widget,
                     "Disabled — followers can only be fetched\n"
                     "for your own account's posts.")
        else:
            # My post — enable followers checkbox
            self._chk_followers_widget.configure(
                state="normal", fg=t["FG"],
            )
            _ToolTip(self._chk_followers_widget,
                     "Include your followers in the filter.")
        self._on_giveaway_filter_changed()

    def _on_fetch_giveaway(self):
        url = self._giveaway_url_var.get().strip()
        if not url:
            messagebox.showwarning(
                "Missing URL", "Please enter an Instagram post URL.",
            )
            return

        cl = get_last_client()
        if cl is None:
            messagebox.showwarning(
                "No Session",
                'Run "Scan Followers & Following" first to establish '
                "a session.",
            )
            return

        self._btn_fetch_giveaway.configure(state="disabled")
        self._btn_pick_winner.configure(state="disabled")
        self._giveaway_info_var.set("Fetching post data...")
        self._giveaway_winner_var.set("")
        self._giveaway_winner_label_var.set("")
        self._giveaway_winner_sub_var.set("")
        self._giveaway_confetti_var.set("")
        self._winner_card.configure(highlightthickness=0)
        self._winner_card.pack_forget()
        self._giveaway_eligible_var.set("")
        self._show_progress("Fetching giveaway post data...")
        self.notebook.select(self.winner_frame)

        def _worker():
            try:
                def log_to_ui(msg):
                    self.root.after(0, self._log, msg)
                    self.root.after(
                        0, self._update_progress_text, msg[:60],
                    )

                data = scrape_post_for_giveaway(
                    url, log=log_to_ui,
                    skip_followers=self._gw_not_my_post.get(),
                )
                self.root.after(0, self._giveaway_fetch_done, data)

            except IGRateLimitError as e:
                self.root.after(0, self._log, f"⚠ RATE LIMITED: {e}")
                self.root.after(
                    0, self._giveaway_info_var.set,
                    "Rate limited. Please wait and try again.",
                )
                self.root.after(
                    0, lambda: messagebox.showwarning(
                        "Rate Limited", str(e)),
                )
            except IGTimeoutError as e:
                self.root.after(0, self._log, f"⚠ TIMEOUT: {e}")
                self.root.after(
                    0, self._giveaway_info_var.set,
                    "Request timed out. Please try again.",
                )
            except Exception as e:
                self.root.after(0, self._log, f"ERROR: {e}")
                self.root.after(
                    0, self._giveaway_info_var.set, f"Error: {e}",
                )
                self.root.after(
                    0, lambda: messagebox.showerror(
                        "Fetch Failed", str(e)),
                )
            finally:
                self.root.after(
                    0, lambda: self._btn_fetch_giveaway.configure(
                        state="normal"),
                )
                self.root.after(0, self._hide_progress)

        threading.Thread(target=_worker, daemon=True).start()

    def _giveaway_fetch_done(self, data):
        """Called on main thread after giveaway data is fetched."""
        self._giveaway_data = data
        t = self.t
        mi = data["media_info"]
        author = data["author"]
        is_own = data.get("is_own_post", False)

        # Auto-update "Not my post" checkbox based on detected author
        if is_own:
            self._gw_not_my_post.set(False)
            self._on_not_my_post_toggled()

        follower_label = (
            f"{len(data['author_followers'])} followers"
            if data["author_followers"]
            else "followers skipped"
        )
        own_tag = " (your post)" if is_own else ""
        info = (
            f"Post by @{author['username']}{own_tag}  ·  "
            f"{mi['like_count']} likes  ·  "
            f"{mi['comment_count']} comments  ·  "
            f"{follower_label}"
        )
        if mi.get("caption"):
            info += f"\n\"{mi['caption'][:100]}...\""
        self._giveaway_info_var.set(info)

        # Update stats cards
        for w in self._giveaway_stats_frame.winfo_children():
            w.destroy()

        follower_count = (
            str(len(data["author_followers"]))
            if data["author_followers"] else "N/A"
        )
        stats = [
            ("Likers", str(len(data["likers"])), t["RED"]),
            ("Commenters", str(len(data["commenters"])), t["BLUE"]),
            ("Followers", follower_count, t["CYAN"]),
        ]
        for idx, (lbl, val, clr) in enumerate(stats):
            cell = tk.Frame(
                self._giveaway_stats_frame, bg=t["BG_CARD"],
                padx=18, pady=10,
                highlightbackground=t["CARD_BORDER"],
                highlightthickness=1,
            )
            cell.grid(row=0, column=idx, padx=5, pady=5, sticky="nsew")
            tk.Label(
                cell, text=val, font=("Segoe UI", 18, "bold"),
                bg=t["BG_CARD"], fg=clr,
            ).pack()
            tk.Label(
                cell, text=lbl, font=("Segoe UI", 9),
                bg=t["BG_CARD"], fg=t["FG_DIM"],
            ).pack(pady=(2, 0))
        for c in range(3):
            self._giveaway_stats_frame.columnconfigure(c, weight=1)

        self._btn_pick_winner.configure(state="normal")
        self._on_giveaway_filter_changed()
        self._log(
            f"Giveaway data fetched: {len(data['likers'])} likers, "
            f"{len(data['commenters'])} commenters, "
            f"{len(data['author_followers'])} followers.",
        )

    def _on_giveaway_filter_changed(self):
        """Recompute eligible users based on checkbox selection."""
        if not self._giveaway_data:
            return

        data = self._giveaway_data
        t = self.t

        # Build sets
        sets_to_intersect = []
        labels = []

        if self._gw_chk_likes.get():
            sets_to_intersect.append(
                {u["user_id"] for u in data["likers"]},
            )
            labels.append("Likes")
        if self._gw_chk_comments.get():
            sets_to_intersect.append(
                {u["user_id"] for u in data["commenters"]},
            )
            labels.append("Comments")
        if self._gw_chk_followers.get():
            sets_to_intersect.append(
                {u["user_id"] for u in data["author_followers"]},
            )
            labels.append("Followers")

        if not sets_to_intersect:
            self._giveaway_eligible = []
            self._giveaway_eligible_var.set(
                "Select at least one filter checkbox.",
            )
            self._btn_pick_winner.configure(state="disabled")
            self._update_eligible_tree([])
            return

        # Intersect all selected sets
        common_ids = sets_to_intersect[0]
        for s in sets_to_intersect[1:]:
            common_ids = common_ids & s

        # Build username lookup from all sources
        user_map: dict[str, str] = {}
        for lst in (data["likers"], data["commenters"],
                    data["author_followers"]):
            for u in lst:
                user_map[u["user_id"]] = u["username"]

        eligible = sorted(
            [{"user_id": uid, "username": user_map.get(uid, uid)}
             for uid in common_ids],
            key=lambda u: u["username"],
        )
        self._giveaway_eligible = eligible

        filter_desc = " ∩ ".join(labels)
        self._giveaway_eligible_var.set(
            f"{len(eligible)} eligible users  ({filter_desc})",
        )
        self._btn_pick_winner.configure(
            state="normal" if eligible else "disabled",
        )
        self._giveaway_winner_var.set("")
        self._giveaway_winner_label_var.set("")
        self._giveaway_winner_sub_var.set("")
        self._giveaway_confetti_var.set("")
        self._winner_card.configure(highlightthickness=0)
        self._winner_card.pack_forget()
        self._update_eligible_tree(eligible)

    def _update_eligible_tree(self, eligible):
        """Rebuild the eligible users treeview."""
        t = self.t
        for w in self._giveaway_list_frame.winfo_children():
            w.destroy()

        if not eligible:
            return

        cols = ("num", "username")
        tree = ttk.Treeview(
            self._giveaway_list_frame, columns=cols,
            show="headings", height=min(12, len(eligible)),
        )
        tree.heading("num", text="#")
        tree.heading("username", text="Username")
        tree.column("num", width=50, anchor="center", stretch=False)
        tree.column("username", width=300, stretch=True)
        tree.tag_configure("stripe", background=t["STRIPE"])

        for i, u in enumerate(eligible, 1):
            tags = ("stripe",) if i % 2 == 0 else ()
            tree.insert("", "end", values=(i, f"@{u['username']}"),
                        tags=tags)

        sb = ttk.Scrollbar(
            self._giveaway_list_frame, orient="vertical",
            command=tree.yview,
        )
        tree.configure(yscrollcommand=sb.set)
        tree.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")

        self._make_sortable(tree, cols)

    def _on_pick_winner(self):
        import random

        if not self._giveaway_eligible:
            messagebox.showinfo(
                "No Eligible Users",
                "No users match the selected filters.",
            )
            return

        seed_val = self._giveaway_seed_var.get().strip()
        if seed_val:
            try:
                seed = int(seed_val)
            except ValueError:
                # Use string hash as seed
                seed = hash(seed_val)
            rng = random.Random(seed)
        else:
            rng = random.Random()

        winner = rng.choice(self._giveaway_eligible)
        self._giveaway_winner_var.set(f"@{winner['username']}")
        self._giveaway_winner_label_var.set("\U0001F3C6  WINNER  \U0001F3C6")
        self._giveaway_winner_sub_var.set(
            f"Selected from {len(self._giveaway_eligible)} eligible users  "
            f"\u00b7  Seed: {seed_val or 'random'}",
        )

        # Show the card with accent border
        t = self.t
        self._winner_card.configure(highlightthickness=2)
        if not self._winner_card.winfo_manager():
            self._winner_card.pack(anchor="center", padx=60, pady=(16, 20))

        # Confetti animation
        confetti_frames = [
            "\U0001F389 \U0001F38A \u2728 \U0001F38A \U0001F389",
            "\u2728 \U0001F389 \U0001F38A \U0001F389 \u2728",
            "\U0001F38A \u2728 \U0001F389 \u2728 \U0001F38A",
        ]
        self._giveaway_confetti_idx = 0

        def _animate_confetti(count=0):
            if count < 8:
                self._giveaway_confetti_var.set(
                    confetti_frames[count % len(confetti_frames)],
                )
                self.root.after(250, _animate_confetti, count + 1)
            else:
                self._giveaway_confetti_var.set(
                    "\U0001F389 \u2728 \U0001F3C6 \u2728 \U0001F389",
                )

        _animate_confetti()

        self._log(
            f"Giveaway winner: @{winner['username']} "
            f"(seed: {seed_val or 'random'}, "
            f"pool: {len(self._giveaway_eligible)})",
        )
        self._set_status(f"Winner: @{winner['username']}")

    def _on_purge(self):
        username = self.username_var.get().strip()
        if not username:
            messagebox.showwarning(
                "Missing username", "Enter a username to delete data for.",
            )
            return
        db_path = self._get_db_path()
        if not messagebox.askyesno(
            "Delete Analytics Data",
            f"Permanently delete ALL data for @{username}?\n\n"
            f"This includes the database and cached profile photos.\n\n"
            f"{db_path}",
            icon="warning",
        ):
            return
        purge_db(db_path)
        # Also purge cached profile photos
        photo_dir = self._get_photo_dir(username)
        if os.path.exists(photo_dir):
            try:
                shutil.rmtree(photo_dir)
                self._log(f"Deleted profile photo cache: {photo_dir}")
            except Exception as e:
                self._log(f"Could not delete photos: {e}")
        for frame in (
            self.summary_frame, self.nfb_frame, self.fans_frame,
            self.unf_frame, self.new_frame, self.content_frame,
            self.engage_frame, self.ghost_frame, self.timeline_frame,
            self.winner_frame,
        ):
            self._clear_frame(frame)
        self._own_photo_ref = None
        self.lbl_own_photo.configure(image="")
        self._log(f"All analytics data deleted for @{username}.")
        self._set_status(f"All analytics data deleted for @{username}.")

    def _on_purge_creds(self):
        if not self._saved_accounts:
            messagebox.showinfo(
                "No Credentials", "No saved credentials to purge.",
            )
            return
        if not messagebox.askyesno(
            "Delete Saved Credentials",
            f"Delete ALL saved credentials "
            f"({len(self._saved_accounts)} account(s))?",
            icon="warning",
        ):
            return
        self._saved_accounts.clear()
        if os.path.exists(CREDS_PATH):
            os.remove(CREDS_PATH)
        self._refresh_username_dropdown()
        self.username_var.set("")
        self.password_var.set("")
        self._log("All saved credentials purged.")
        self._set_status("All saved credentials purged.")


def main():
    root = tk.Tk()
    InstagramAnalyticsApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
