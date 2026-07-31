// privacy.js — what a copy of this ZIP would tell an attacker.
//
// The point of this tab is that the user knows what they are holding before
// they send it to anyone — a support agent, a developer, a forum thread. Every
// finding names the file it came from so it can be removed.
//
// Findings are computed in memory and rendered; none of it is ever written to
// the history file. See history.js, where the snapshot is built from an
// explicit allow-list rather than by deleting keys.

const SEVERITY = { critical: 3, high: 2, medium: 1, low: 0 };

function finding(severity, title, detail, file, present = true) {
  return { severity, title, detail, file, present };
}

export function privacy(data) {
  const s = data.profile.sensitive ?? {};
  const sec = data.security;
  const found = [];

  if (s.email || s.phone || s.dateOfBirth) {
    const parts = [
      s.email && 'email',
      s.phone && 'phone number',
      s.dateOfBirth && 'date of birth',
    ].filter(Boolean);
    found.push(
      finding(
        'critical',
        'Account recovery identifiers',
        `Your ${parts.join(', ')} sit in plain text. Combined with your username these are exactly what a password reset or support-impersonation attempt asks for, and a confirmed phone number is what SIM-swap attacks target.`,
        'personal_information/personal_information/personal_information.html',
      ),
    );
  }

  if (s.signupIp || data.profile.createdAt) {
    found.push(
      finding(
        'critical',
        'Original signup details',
        `Signup IP, the exact creation date${
          data.profile.signupDevice ? `, and the original device name "${data.profile.signupDevice}"` : ''
        }. These are the questions Meta's account-recovery flow asks to prove ownership.`,
        'security_and_login_information/login_and_profile_creation/signup_details.html',
      ),
    );
  }

  if (sec.uniqueIps.length) {
    found.push(
      finding(
        'high',
        `${sec.uniqueIps.length} IP addresses with timestamps`,
        `Login, logout and profile activity records expose your ISP, approximate location over time and travel pattern${
          sec.devices.length ? `, across ${sec.devices.length} identifiable devices (${sec.devices.slice(0, 3).join(', ')})` : ''
        }.`,
        'security_and_login_information/login_and_profile_creation/login_activity.html',
      ),
    );
  }

  const geo = data.content.published.filter((m) => m.coords);
  if (geo.length) {
    found.push(
      finding(
        'high',
        `${geo.length} precise GPS coordinates`,
        'Instagram strips EXIF from the exported image files but leaves the coordinates in the media manifests, at roughly metre precision. Repeated coordinates reveal home and routine locations.',
        'your_instagram_activity/media/posts.html, stories.html, reels.html',
      ),
    );
  }

  if (sec.deviceIds.length) {
    found.push(
      finding(
        'medium',
        `${sec.deviceIds.length} device identifiers`,
        'Stable per-device IDs, including a camera device ID, that can correlate you across other datasets.',
        'personal_information/device_information/camera_information.html',
      ),
    );
  }

  if (data.syncedContactCount) {
    found.push(
      finding(
        'high',
        `${data.syncedContactCount} other people's phone numbers`,
        'Contacts uploaded from your phonebook. This is other people\'s personal data in your custody — the biggest liability here if the ZIP ever leaks, and the first thing to delete.',
        'connections/contacts/synced_contacts.html',
      ),
    );
  }

  if (data.ads.advertisers.length > 100) {
    found.push(
      finding(
        'medium',
        `${data.ads.advertisers.length} advertisers hold data on you`,
        'Companies that uploaded a contact list matching your profile, or matched you from a visit to their site.',
        'ads_information/instagram_ads_and_businesses/advertisers_using_your_activity_or_information.html',
      ),
    );
  }

  if (data.ads.offMeta.length) {
    found.push(
      finding(
        'medium',
        `${data.ads.offMeta.length} apps sent your activity to Meta`,
        `${data.ads.offMeta.reduce((n, a) => n + a.events.length, 0)} events recorded from outside Instagram, including page views and checkouts.`,
        'apps_and_websites_off_of_instagram/',
      ),
    );
  }

  // Stating what is *absent* matters as much as what is present: it stops the
  // user assuming a leaked export means an immediately compromised account.
  const cleared = [
    { title: 'No password or password hash', detail: 'Only the date of the last change is recorded.' },
    { title: 'No usable session cookies', detail: 'Cookie values arrive already masked by Meta and cannot be replayed.' },
    { title: 'No payment card details', detail: 'Checkout records contain a name and email only.' },
    { title: 'No two-factor backup codes', detail: 'Not included in data exports.' },
  ];

  const settings = [
    { label: 'Account is private', value: data.profile.isPrivate, good: data.profile.isPrivate },
    { label: 'Contact syncing enabled', value: data.profile.contactSyncing, good: !data.profile.contactSyncing },
    {
      label: 'Friend Map sharing',
      value: data.profile.friendMapAudience ?? 'unknown',
      good: /only owner|no one/i.test(data.profile.friendMapAudience ?? ''),
    },
  ];

  found.sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity]);

  const score = found.reduce((n, f) => n + SEVERITY[f.severity] + 1, 0);
  return {
    findings: found,
    cleared,
    settings,
    exposureScore: score,
    // Shown so the user can confirm what the audit is reading; never stored.
    identifiers: {
      email: s.email ?? null,
      phone: s.phone ?? null,
      dateOfBirth: s.dateOfBirth ?? null,
      signupIp: s.signupIp ?? null,
      ipCount: sec.uniqueIps.length,
      deviceCount: sec.deviceIds.length,
      contactCount: data.syncedContactCount,
      gpsCount: geo.length,
    },
  };
}
