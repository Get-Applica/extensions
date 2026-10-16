/**
 * Applica Extension - Seeker tabbed layout markup (Analyze + History).
 *
 * Pure HTML builders: drawer.js owns state, data fetching and event handling, and passes plain
 * view models in. Every string from the API is escaped here. Actions are wired by drawer.js
 * through `data-tb-action` attributes.
 */

(function (root) {
  const escapeHtml =
    (root.ApplicaUtil && root.ApplicaUtil.escapeHtml) ||
    ((s) =>
      String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[c])));

  const esc = (value) => escapeHtml(value == null ? '' : String(value));

  const ICON = {
    chevDown:
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    chevLeft:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    check:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    checkSmall:
      '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    refresh:
      '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
    trash:
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
    file:
      '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>',
    bolt:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
    spark:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>',
    alert:
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    external:
      '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>'
  };

  /** Same bands as drawer.js scoreColor (80 / 65 / 50). */
  function scoreTone(score) {
    const n = Number(score);
    if (n !== n) return 'neutral';
    if (n >= 80) return 'good';
    if (n >= 65) return 'ok';
    if (n >= 50) return 'warn';
    return 'bad';
  }

  function kbd(label) {
    return label ? '<span class="tb-kbd">' + esc(label) + '</span>' : '';
  }

  function formatElapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return minutes + ':' + String(seconds).padStart(2, '0');
  }

  function initialOf(text) {
    const s = String(text || '').trim();
    return s ? s[0].toUpperCase() : '?';
  }

  /** Stable avatar hue per company so rows are easy to tell apart. */
  function avatarStyle(text) {
    const s = String(text || '');
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    const hue = hash % 360;
    return 'background:hsl(' + hue + ' 42% 34%)';
  }

  function avatarHtml(company) {
    return (
      '<span class="tb-avatar" style="' + avatarStyle(company) + '" aria-hidden="true">' +
      esc(initialOf(company)) +
      '</span>'
    );
  }

  function pill(text, tone, withDot) {
    return (
      '<span class="tb-pill' + (tone ? ' tb-pill--' + tone : '') + '">' +
      (withDot ? '<span class="tb-dot" aria-hidden="true"></span>' : '') +
      esc(text) +
      '</span>'
    );
  }

  /* ---------------- Analyze: profile ---------------- */

  function profileSwitcherHtml(profile) {
    if (!profile.switcherOpen) return '';
    const items = profile.personas
      .map(
        (p) =>
          '<button type="button" class="tb-pop-item tb-persona-item" role="menuitemradio" aria-checked="' +
          (p.selected ? 'true' : 'false') +
          '" data-tb-action="pick-persona" data-persona-id="' +
          esc(p.id) +
          '">' +
          '<span class="tb-file-ico tb-file-ico--sm" aria-hidden="true">PDF</span>' +
          '<span class="tb-persona-text"><b>' +
          esc(p.title) +
          '</b><span>' +
          esc(p.cvFilename || 'No resume uploaded') +
          '</span></span>' +
          (p.score != null
            ? '<span class="tb-persona-score" title="Resume score">' + esc(p.score) + '</span>'
            : '') +
          '</button>'
      )
      .join('');
    return (
      '<div class="tb-pop tb-pop--block" role="menu" aria-label="Choose a profile">' +
      '<p class="tb-pop-title">Choose a profile</p>' +
      items +
      '<div class="tb-pop-sep" role="separator"></div>' +
      '<p class="tb-pop-note">Each profile has its own resume and target role. Jobs are scored per profile.</p>' +
      '</div>'
    );
  }

  function profileCardHtml(profile) {
    if (profile.error) {
      return (
        '<section class="tb-card" aria-label="Profile">' +
        '<div class="tb-card-head"><span class="tb-label">Profile</span></div>' +
        '<p class="tb-caption tb-caption--error">' + esc(profile.error) + '</p>' +
        '</section>'
      );
    }
    if (profile.loading) {
      return (
        '<section class="tb-card" aria-label="Profile">' +
        '<div class="tb-card-head"><span class="tb-label">Profile</span></div>' +
        '<p class="tb-caption">Loading your profiles…</p>' +
        '</section>'
      );
    }
    if (!profile.title) {
      return (
        '<section class="tb-card" aria-label="Profile">' +
        '<div class="tb-card-head"><span class="tb-label">Profile</span></div>' +
        '<p class="tb-caption">You don’t have a profile yet. Create one in Applica to score jobs against your resume.</p>' +
        (profile.manageHref
          ? '<a class="tb-btn tb-btn--secondary tb-btn--sm" href="' + esc(profile.manageHref) + '" target="_blank" rel="noopener">Create a profile</a>'
          : '') +
        '</section>'
      );
    }
    const canSwitch = profile.personas.length > 1;
    const file = profile.cvFilename
      ? profile.downloadPath
        ? '<button type="button" class="tb-profile-file tb-linkish" data-tb-action="download-resume" title="Download ' +
          esc(profile.cvFilename) +
          '">' +
          esc(profile.cvFilename) +
          '</button>'
        : '<span class="tb-profile-file">' + esc(profile.cvFilename) + '</span>'
      : '<span class="tb-profile-file">No resume uploaded</span>';
    const score =
      profile.resumeScore != null
        ? '<div class="tb-resume-score" title="How well this resume fits the profile’s target role">' +
          '<span class="tb-resume-score-num tb-tone-' + scoreTone(profile.resumeScore) + '">' + esc(profile.resumeScore) + '</span>' +
          '<span class="tb-resume-score-den">/100</span>' +
          '<span class="tb-resume-score-cap">Resume score</span>' +
          '</div>'
        : '';
    return (
      '<section class="tb-card tb-card--profile" aria-label="Profile">' +
      '<div class="tb-card-head"><span class="tb-label">Profile</span>' +
      (canSwitch
        ? '<button type="button" class="tb-link-btn" data-tb-action="switcher" aria-haspopup="menu" aria-expanded="' +
          (profile.switcherOpen ? 'true' : 'false') +
          '">Switch <span class="tb-muted">(' + profile.personas.length + ')</span>' + ICON.chevDown + '</button>'
        : '') +
      '</div>' +
      '<div class="tb-profile-row">' +
      '<span class="tb-file-ico" aria-hidden="true">PDF</span>' +
      '<div class="tb-profile-text"><div class="tb-profile-title">' + esc(profile.title) + '</div>' + file + '</div>' +
      score +
      '</div>' +
      profileSwitcherHtml(profile) +
      '</section>'
    );
  }

  /* ---------------- Analyze: this tab ---------------- */

  function jobRowHtml(title, company, host) {
    return (
      '<div class="tb-job-row">' +
      avatarHtml(company || host) +
      '<div class="tb-job-text">' +
      '<div class="tb-job-title">' + esc(title || 'This page') + '</div>' +
      '<div class="tb-job-sub">' +
      (company ? esc(company) + ' · ' : '') +
      '<code>' + esc(host || '') + '</code>' +
      '</div></div></div>'
    );
  }

  function thisTabCardHtml(ctx) {
    const page = ctx.page;
    const job = ctx.job;
    if (!page.inFrame) {
      return (
        '<section class="tb-card" aria-label="This tab">' +
        '<div class="tb-card-head"><span class="tb-label">This tab</span></div>' +
        '<p class="tb-caption">Open the drawer on a job posting to analyze it.</p>' +
        '</section>'
      );
    }
    const tracked = job.state !== 'ready';
    const statusPill = tracked
      ? pill('Saved to History', 'good', true)
      : page.detected
        ? pill('Job posting found', 'good', true)
        : pill('No job posting found', null, true);
    const title = tracked ? job.title : page.title;
    const company = tracked ? job.company : page.company;
    let body = '';
    if (!tracked) {
      const a = ctx.analyze;
      const primary = page.detected;
      const label = primary ? 'Analyze this job' : 'Analyze anyway';
      body =
        (primary
          ? jobRowHtml(title, company, page.host)
          : '<p class="tb-caption">This page doesn’t look like a job posting. If it is one, you can still analyze it.</p>') +
        '<button type="button" class="tb-btn tb-btn--block ' +
        (primary ? 'tb-btn--primary' : 'tb-btn--secondary') +
        '" data-tb-action="analyze"' +
        (a.disabled ? ' disabled' : '') +
        (a.disabledReason ? ' title="' + esc(a.disabledReason) + '"' : '') +
        '>' +
        (a.busy ? '<span class="tb-spinner tb-spinner--sm" aria-hidden="true"></span>' : ICON.spark) +
        '<span class="tb-grow">' + (a.busy ? 'Reading this page…' : label) + '</span>' +
        kbd(ctx.keys.analyze) +
        '</button>' +
        (a.atLimit
          ? '<p class="tb-caption tb-caption--warn">You’ve used all your job analyses for now.' +
            (a.upgradeHref ? ' <a href="' + esc(a.upgradeHref) + '" target="_blank" rel="noopener">Upgrade</a> to analyze more.' : '') +
            '</p>'
          : '<p class="tb-caption">Scores it against <strong>' + esc(ctx.profile.title || 'your profile') +
            '</strong>. Usually takes 1–2 minutes, and you can keep browsing.' +
            (a.usageHtml ? ' <span class="tb-usage">' + a.usageHtml + '</span>' : '') +
            '</p>');
    } else {
      body = jobRowHtml(title, company, page.host);
    }
    return (
      '<section class="tb-card" aria-label="This tab">' +
      '<div class="tb-card-head"><span class="tb-label">This tab</span>' + statusPill + '</div>' +
      body +
      '</section>'
    );
  }

  /* ---------------- Analyze: match ---------------- */

  function warningsHtml(warnings) {
    if (!warnings) return '';
    const parts = [];
    if (warnings.avoid) {
      parts.push(
        '<div class="tb-warning tb-warning--danger" role="alert">' + ICON.alert +
        '<span>This company is on your <b>Companies to Avoid</b> list.</span></div>'
      );
    }
    if (warnings.interview) {
      parts.push(
        '<div class="tb-warning" role="alert">' + ICON.alert +
        '<span>You’re already interviewing at this company.</span></div>'
      );
    }
    if (warnings.matching && warnings.matching.length) {
      const items = warnings.matching
        .map(
          (a) =>
            '<li>' + esc(a.title || 'Application') +
            (a.statusLabel ? ' · <span>' + esc(a.statusLabel) + '</span>' : '') +
            (a.appliedAt ? ' · ' + esc(a.appliedAt) : '') +
            '</li>'
        )
        .join('');
      parts.push(
        '<div class="tb-warning tb-warning--info" role="status">' + ICON.alert +
        '<div><span>You’ve applied at this company before:</span><ul>' + items + '</ul></div></div>'
      );
    }
    return parts.join('');
  }

  function scoreBlockHtml(score) {
    const r = 26;
    const c = 2 * Math.PI * r;
    const dash = ((c * Math.min(100, Math.max(0, score.total))) / 100).toFixed(2);
    const tone = scoreTone(score.total);
    const bar = (name, value) => {
      if (value == null) return '';
      return (
        '<div class="tb-bar" aria-label="' + esc(name) + ' ' + esc(value) + ' out of 100">' +
        '<div class="tb-bar-top"><span class="tb-bar-name">' + esc(name) + '</span><span class="tb-bar-val">' + esc(value) + '</span></div>' +
        '<div class="tb-track" aria-hidden="true"><div class="tb-fill tb-bg-' + scoreTone(value) + '" style="width:' + Math.min(100, Math.max(0, value)) + '%"></div></div>' +
        '</div>'
      );
    };
    const bars = bar('Skills', score.skill) + bar('Exp', score.exp) + bar('Edu', score.edu);
    return (
      '<div class="tb-score-hero">' +
      '<div class="tb-ring" role="img" aria-label="Match score ' + esc(score.total) + ' out of 100">' +
      '<svg viewBox="0 0 62 62" aria-hidden="true"><circle class="tb-ring-track" cx="31" cy="31" r="' + r + '"/>' +
      '<circle class="tb-ring-val tb-stroke-' + tone + '" cx="31" cy="31" r="' + r + '" stroke-dasharray="' + dash + ' ' + c.toFixed(2) + '"/></svg>' +
      '<span class="tb-ring-num">' + esc(score.total) + '</span>' +
      '</div>' +
      '<div class="tb-score-text">' +
      '<div class="tb-score-line">' + esc(score.label ? score.label + ' match' : 'Match score') + '</div>' +
      '<p class="tb-caption">' + esc(score.against ? 'Against your ' + score.against + ' profile' : 'Against your profile') + '</p>' +
      '</div></div>' +
      (bars ? '<div class="tb-bars">' + bars + '</div>' : '')
    );
  }

  function fillBlockHtml(job, ctx) {
    if (!job.canFill) return '';
    const fill = job.fill || {};
    if (fill.result && !fill.pending) {
      const r = fill.result;
      if (!r.filled) {
        return (
          '<div class="tb-result tb-result--muted">' +
          '<div class="tb-result-text"><div class="tb-result-title">No matching form fields found</div>' +
          '<div class="tb-result-sub">Open the application form on this page, then try again.</div></div>' +
          '<button type="button" class="tb-btn tb-btn--secondary tb-btn--sm" data-tb-action="fill">' + ICON.refresh + 'Try again</button>' +
          '</div>'
        );
      }
      let sub = 'Check every field before you submit.';
      if (r.resumeAttached > 0) sub = 'Resume attached. ' + sub;
      else if (r.resumeError) sub = r.resumeError + ' ' + sub;
      else sub = 'No resume upload found on the page. ' + sub;
      return (
        '<div class="tb-result">' +
        '<span class="tb-result-ico" aria-hidden="true">' + ICON.check + '</span>' +
        '<div class="tb-result-text"><div class="tb-result-title">Filled ' + esc(r.filled) + ' field' + (r.filled === 1 ? '' : 's') + ' from your profile</div>' +
        '<div class="tb-result-sub">' + esc(sub) + '</div></div>' +
        '<button type="button" class="tb-btn tb-btn--secondary tb-btn--sm" data-tb-action="fill">' + ICON.refresh + 'Fill again</button>' +
        '</div>'
      );
    }
    return (
      '<button type="button" class="tb-btn tb-btn--primary tb-btn--block" data-tb-action="fill"' + (fill.pending ? ' disabled' : '') + '>' +
      (fill.pending ? '<span class="tb-spinner tb-spinner--sm" aria-hidden="true"></span>' : ICON.bolt) +
      '<span class="tb-grow">' + (fill.pending ? 'Filling form…' : 'Fill application form') + '</span>' +
      kbd(ctx.keys.fill) +
      '</button>' +
      '<p class="tb-caption">Uses your profile and attaches <strong>' + esc(job.cvFilename || 'your resume') + '</strong>. Nothing is submitted.</p>'
    );
  }

  function appliedBlockHtml(job) {
    if (job.application) {
      return (
        '<div class="tb-applied-row">' +
        '<div class="tb-applied-text"><div class="tb-applied-q">' + pill(job.application.statusLabel || 'Applied', 'good') +
        (job.application.appliedAt ? '<span class="tb-muted">since ' + esc(job.application.appliedAt) + '</span>' : '') +
        '</div><p class="tb-caption">Track interviews, notes and contacts in History.</p></div>' +
        '<button type="button" class="tb-btn tb-btn--secondary tb-btn--sm" data-tb-action="view-application" data-application-id="' +
        esc(job.application.id) + '">Open in History</button>' +
        '</div>'
      );
    }
    if (!job.openingId) return '';
    return (
      '<div class="tb-applied-row">' +
      '<div class="tb-applied-text"><div class="tb-applied-q">Submitted it? ' + pill('Not applied') + '</div>' +
      '<p class="tb-caption">Mark it once you’ve submitted. It moves to Applied in History.</p></div>' +
      '<button type="button" class="tb-btn tb-btn--secondary tb-btn--sm" data-tb-action="mark-applied" data-opening-id="' +
      esc(job.openingId) + '"' + (job.applying ? ' disabled' : '') + '>' +
      (job.applying ? 'Saving…' : 'Mark as applied') +
      '</button>' +
      '</div>'
    );
  }

  function customResumeHtml(custom) {
    if (!custom) return '';
    if (custom.canCustomize) {
      return (
        '<div class="tb-custom-resume"><span>Tailored your resume for this job? Re-score with a PDF.</span>' +
        '<button type="button" class="tb-btn tb-btn--secondary tb-btn--sm" data-tb-action="upload-resume"' + (custom.busy ? ' disabled' : '') + '>' +
        (custom.busy ? 'Uploading…' : 'Upload PDF') + '</button></div>'
      );
    }
    return (
      '<div class="tb-custom-resume"><span>Re-scoring with a tailored resume is on the Essential plan.</span>' +
      (custom.upgradeHref
        ? '<a class="tb-btn tb-btn--secondary tb-btn--sm" href="' + esc(custom.upgradeHref) + '" target="_blank" rel="noopener">Upgrade</a>'
        : '') +
      '</div>'
    );
  }

  function matchCardHtml(ctx) {
    const job = ctx.job;
    if (job.state === 'ready') {
      if (!ctx.page.inFrame) return '';
      return (
        '<section class="tb-card tb-card--locked" aria-label="Match">' +
        '<div class="tb-card-head"><span class="tb-label">Match</span>' + pill('After analysis') + '</div>' +
        '<ul class="tb-locked-list">' +
        '<li>Match score with skills, experience and education</li>' +
        '<li>Form fill with your profile and resume</li>' +
        '<li>Applied status, saved to History</li>' +
        '</ul></section>'
      );
    }
    const divider = '<div class="tb-divider" aria-hidden="true"></div>';
    const tail = (inner) => (inner ? divider + inner : '');
    if (job.state === 'incomplete') {
      return (
        '<section class="tb-card" aria-label="Match">' +
        '<div class="tb-card-head"><span class="tb-label">Match</span>' + pill('Didn’t finish', 'bad', true) + '</div>' +
        '<p class="tb-caption">We couldn’t read this job posting. Remove it and analyze the page again, or try from the job’s own page.</p>' +
        '<button type="button" class="tb-btn tb-btn--secondary tb-btn--sm" data-tb-action="remove-current"' +
        (job.openingId ? ' data-opening-id="' + esc(job.openingId) + '"' : ' data-url="' + esc(job.url || '') + '"') +
        '>' + ICON.trash + 'Remove</button>' +
        '</section>'
      );
    }
    if (job.state === 'scoring') {
      const since = job.scoringSince;
      return (
        '<section class="tb-card" aria-label="Match">' +
        '<div class="tb-card-head"><span class="tb-label">Match</span>' + pill('Scoring', 'warn', true) + '</div>' +
        warningsHtml(job.warnings) +
        '<div class="tb-scoring">' +
        '<span class="tb-spinner" aria-hidden="true"></span>' +
        '<div><div class="tb-scoring-title">Comparing your resume to this job</div>' +
        '<div class="tb-scoring-sub">' +
        (since ? '<span id="tb-elapsed" data-since="' + esc(since) + '">' + esc(formatElapsed(Date.now() - since)) + '</span> · ' : '') +
        (job.slow ? 'taking longer than usual' : 'usually 1–2 minutes') +
        '</div></div></div>' +
        '<p class="tb-caption">You can close the drawer or switch tabs. It’s saved in History as Scoring.</p>' +
        tail(fillBlockHtml(job, ctx)) +
        tail(appliedBlockHtml(job)) +
        '</section>'
      );
    }
    const scorePart = job.score
      ? scoreBlockHtml(job.score)
      : '<p class="tb-caption">No match score for this job.</p>';
    const headPill =
      job.state === 'applied'
        ? pill('Applied', 'good', true)
        : job.score
          ? pill(job.score.total + ' / 100', scoreTone(job.score.total), true)
          : '';
    return (
      '<section class="tb-card tb-card--live" aria-label="Match">' +
      '<div class="tb-card-head"><span class="tb-label">Match</span>' + headPill + '</div>' +
      warningsHtml(job.warnings) +
      scorePart +
      (job.state === 'applied' ? '' : customResumeHtml(job.customResume)) +
      tail(job.state === 'applied' ? '' : fillBlockHtml(job, ctx)) +
      tail(appliedBlockHtml(job)) +
      '</section>'
    );
  }

  function analyzePanelHtml(ctx) {
    return profileCardHtml(ctx.profile) + thisTabCardHtml(ctx) + matchCardHtml(ctx);
  }

  /* ---------------- History ---------------- */

  function rowScorePill(row) {
    if (row.state === 'scoring') return pill('Scoring', 'warn', true);
    if (row.state === 'incomplete') return pill('Didn’t finish', 'bad', true);
    if (row.score == null) return '';
    return pill(row.score + (row.scoreLabel ? ' · ' + row.scoreLabel : ''), scoreTone(row.score));
  }

  function rowStatusPill(row) {
    if (row.kind === 'opening') return pill('Not applied');
    const s = row.status;
    if (s === 'rejected' || s === 'declined') return pill(row.statusLabel);
    if (s === 'offered' || s === 'hired') return pill(row.statusLabel, 'good');
    if (s === 'applied') {
      return '<span class="tb-pill tb-pill--good">' + ICON.checkSmall + 'Applied</span>';
    }
    return pill(row.statusLabel, 'ink');
  }

  function historyRowHtml(row, opts) {
    const confirming = opts && opts.confirmKey === row.key;
    const removable = row.kind === 'opening';
    const foot = confirming
      ? '<div class="tb-confirm"><span>Remove this job from History?</span>' +
        '<button type="button" data-tb-action="cancel-remove">Cancel</button>' +
        '<button type="button" class="tb-danger" data-tb-action="confirm-remove" data-row-key="' + esc(row.key) + '">Remove</button></div>'
      : '<div class="tb-hrow-foot">' +
        '<span class="tb-hrow-file">' + ICON.file + esc(row.cvFilename || '—') + '</span>' +
        rowStatusPill(row) +
        (removable
          ? '<button type="button" class="tb-trash" data-tb-action="ask-remove" data-row-key="' + esc(row.key) +
            '" aria-label="Remove ' + esc(row.title || 'job') + ' from History">' + ICON.trash + '</button>'
          : '') +
        '</div>';
    return (
      '<div class="tb-hrow' + (row.isCurrentPage ? ' tb-hrow--current' : '') + '">' +
      '<button type="button" class="tb-hrow-main" data-tb-action="open-row" data-row-key="' + esc(row.key) + '">' +
      avatarHtml(row.company || row.host) +
      '<span class="tb-hrow-text"><span class="tb-job-title">' + esc(row.title || row.url || 'Job posting') + '</span>' +
      '<span class="tb-job-sub">' + esc([row.company, row.when].filter(Boolean).join(' · ')) +
      (row.isCurrentPage ? ' · <b>This tab</b>' : '') + '</span></span>' +
      rowScorePill(row) +
      '</button>' +
      foot +
      '</div>'
    );
  }

  function historyListHtml(rows, opts) {
    if (!rows.length) {
      const q = opts && opts.query;
      const msg = q
        ? 'No jobs match “' + esc(q) + '”.'
        : opts && opts.filter === 'applied'
          ? 'Nothing marked as applied yet.'
          : opts && opts.filter === 'open'
            ? 'No jobs waiting. Analyze a posting to add one.'
            : 'No jobs yet. Analyze a job posting and it shows up here.';
      return '<div class="tb-empty">' + msg + '</div>';
    }
    return rows.map((row) => historyRowHtml(row, opts)).join('');
  }

  function historyOpeningDetailHtml(row, opts) {
    const confirming = opts && opts.confirmKey === row.key;
    const score = row.scoreDetail ? scoreBlockHtml(row.scoreDetail) : '';
    const stateNote =
      row.state === 'scoring'
        ? '<p class="tb-caption">Still scoring. This usually takes 1–2 minutes.</p>'
        : row.state === 'incomplete'
          ? '<p class="tb-caption">We couldn’t read this job posting. Remove it and analyze the page again.</p>'
          : '';
    return (
      '<button type="button" class="tb-back" data-tb-action="detail-back">' + ICON.chevLeft + 'History</button>' +
      '<section class="tb-card">' +
      '<div class="tb-job-row">' + avatarHtml(row.company || row.host) +
      '<div class="tb-job-text"><div class="tb-job-title">' + esc(row.title || row.url || 'Job posting') + '</div>' +
      '<div class="tb-job-sub">' + esc([row.company, row.when, row.cvFilename].filter(Boolean).join(' · ')) + '</div></div>' +
      rowScorePill(row) + '</div>' +
      warningsHtml(row.warnings) +
      score +
      stateNote +
      '</section>' +
      '<section class="tb-card">' +
      '<span class="tb-label">Next step</span>' +
      '<p class="tb-caption">Open the posting, then use <strong>Fill application form</strong> on the Analyze tab' +
      (opts && opts.fillKey ? ' or press ' + esc(opts.fillKey) : '') + '.</p>' +
      '<div class="tb-row-actions">' +
      (row.url
        ? '<button type="button" class="tb-btn tb-btn--secondary tb-btn--sm" data-tb-action="open-posting" data-url="' + esc(row.url) + '">' + ICON.external + 'Open job posting</button>'
        : '') +
      (row.openingId
        ? '<button type="button" class="tb-btn tb-btn--secondary tb-btn--sm" data-tb-action="mark-applied" data-opening-id="' + esc(row.openingId) + '"' +
          (opts && opts.applying ? ' disabled' : '') + '>' + (opts && opts.applying ? 'Saving…' : 'Mark as applied') + '</button>'
        : '') +
      '</div>' +
      (confirming
        ? '<div class="tb-confirm tb-confirm--inline"><span>Remove this job from History?</span>' +
          '<button type="button" data-tb-action="cancel-remove">Cancel</button>' +
          '<button type="button" class="tb-danger" data-tb-action="confirm-remove" data-row-key="' + esc(row.key) + '">Remove</button></div>'
        : '<button type="button" class="tb-text-danger" data-tb-action="ask-remove" data-row-key="' + esc(row.key) + '">' + ICON.trash + 'Remove from History</button>') +
      '</section>'
    );
  }

  root.ApplicaTabbedViews = {
    analyzePanelHtml,
    historyListHtml,
    historyOpeningDetailHtml,
    formatElapsed,
    scoreTone
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
