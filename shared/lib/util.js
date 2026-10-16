/**
 * Small DOM helpers shared by the drawer (and future extension pages).
 */
(function () {
  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function setVisible(el, visible) {
    if (!el) return;
    el.hidden = !visible;
  }

  /**
   * Parse a recruiter login URL or raw token (`id:key`, URL-encoded or not).
   * Matches admin-generated links like /recruiter/login?token=uuid%3Akey
   */
  function parseRecruiterLoginUrl(input) {
    const trimmed = (input || '').trim();
    if (!trimmed) {
      return { ok: false, message: 'Paste your recruiter login URL.' };
    }

    let token = trimmed;

    if (/^https?:\/\//i.test(trimmed)) {
      try {
        const url = new URL(trimmed);
        const fromQuery = url.searchParams.get('token');
        if (!fromQuery) {
          return { ok: false, message: 'That login URL is missing a token.' };
        }
        token = fromQuery;
      } catch (_) {
        return { ok: false, message: 'That does not look like a valid login URL.' };
      }
    }

    let decoded = token;
    try {
      decoded = decodeURIComponent(token);
    } catch (_) {
      decoded = token;
    }

    const colon = decoded.indexOf(':');
    if (colon <= 0) {
      return {
        ok: false,
        message: 'Login link should contain your recruiter id and key separated by a colon.',
      };
    }

    const id = decoded.slice(0, colon).trim();
    const key = decoded.slice(colon + 1).trim();
    if (!id || !key) {
      return { ok: false, message: 'Login link is missing recruiter id or key.' };
    }

    return { ok: true, id, key };
  }

  async function copyToClipboard(text) {
    const value = text == null ? '' : String(text);
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch (_) {
        // Fall through to execCommand below.
      }
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (!copied) {
      throw new Error('Could not copy to clipboard.');
    }
  }

  window.ApplicaUtil = {
    escapeHtml,
    setVisible,
    parseRecruiterLoginUrl,
    copyToClipboard,
  };
})();
