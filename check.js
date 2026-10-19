// @ts-check
/**
 * On-device check for the packOS kiosk: screen, browser engine, H.264 decode, real playback of the
 * bundled films (dropped frames and stalls), touch, storage, offline readiness. Results show as a list
 * with plain-language fixes and as a QR code, so staff can copy them off an offline device with a phone.
 * Baseline: Chromium 83 (Android 11's original System WebView).
 */
(() => {
  const data = /** @type {any} */ (self).PACKOS_KIOSK;
  const QR = /** @type {any} */ (self).PACKOS_QR;
  const page = /** @type {HTMLElement} */ (document.getElementById('check'));
  /** @param {string} s @returns {any} */
  const $ = (s) => page.querySelector(s);
  const list = $('.kiosk-check-list');
  const video = /** @type {HTMLVideoElement} */ ($('.kiosk-check-video'));
  /** @type {Record<string, any>} */
  let summary = {};
  /** @type {{name:string,status:string}[]} */
  let results = [];

  /** @param {string} tag @param {string} cls @param {string} [text] */
  const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  /**
   * @param {string} name
   * @param {'pass'|'warn'|'fail'|'info'|'run'} status
   * @param {string} detail
   * @param {string} [fix]
   */
  const report = (name, status, detail, fix) => {
    let item = /** @type {HTMLElement|null} */ (list.querySelector('[data-name="' + name + '"]'));
    if (!item) {
      item = el('li', 'kiosk-check-item'); item.dataset.name = name;
      item.appendChild(el('span', 'kiosk-check-status'));
      const body = el('div', ''); body.appendChild(el('p', 'kiosk-check-name', name));
      body.appendChild(el('p', 'kiosk-check-detail')); body.appendChild(el('p', 'kiosk-check-fix'));
      item.appendChild(body); list.appendChild(item);
    }
    item.dataset.status = status;
    /** @type {HTMLElement} */ (item.querySelector('.kiosk-check-status')).textContent = status === 'run' ? '…' : status.toUpperCase();
    /** @type {HTMLElement} */ (item.querySelector('.kiosk-check-detail')).textContent = detail;
    /** @type {HTMLElement} */ (item.querySelector('.kiosk-check-fix')).textContent = fix || '';
    if (status !== 'run') results = results.filter((r) => r.name !== name).concat([{ name: name, status: status }]);
  };
  /** @param {number} ms */
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));

  function screenCheck() {
    const w = window.innerWidth, h = window.innerHeight, dpr = window.devicePixelRatio || 1;
    const px = Math.round(w * dpr) + 'x' + Math.round(h * dpr);
    summary.s = px + '@' + dpr;
    const portrait = h > w, ratio = h / w;
    if (!portrait) report('Screen', 'warn', 'Landscape ' + px + ' (' + w + 'x' + h + ' CSS px).', 'Set the display to portrait: the films are 1080x1920.');
    else if (Math.abs(ratio - 16 / 9) < .02) report('Screen', 'pass', 'Portrait ' + px + ', 9:16: the films fill the screen.');
    else report('Screen', 'warn', 'Portrait ' + px + ', not 9:16.', 'The films will show thin bars at the sides; the kiosk page fits any size.');
  }

  function engineCheck() {
    const match = /Chrome\/(\d+)/.exec(navigator.userAgent);
    const version = match ? Number(match[1]) : 0;
    summary.c = version || navigator.userAgent.slice(0, 40);
    if (version >= 83) report('Browser engine', 'pass', 'Chromium ' + version + '.');
    else if (version >= 70) report('Browser engine', 'warn', 'Chromium ' + version + ' is older than the kiosk baseline (83).', 'Update "Android System WebView" (or the kiosk browser) from the app store or an APK.');
    else report('Browser engine', 'fail', version ? 'Chromium ' + version + '.' : 'Not a Chromium browser: ' + navigator.userAgent.slice(0, 80), 'Install a current Chromium-based kiosk browser.');
  }

  async function codecCheck() {
    const type = 'video/mp4; codecs="avc1.4D4028"';
    const answer = document.createElement('video').canPlayType(type);
    let smooth = null, efficient = null;
    const caps = /** @type {any} */ (navigator).mediaCapabilities;
    if (caps && caps.decodingInfo) {
      try {
        const info = await caps.decodingInfo({ type: 'file', video: { contentType: type, width: 1080, height: 1920, bitrate: 8000000, framerate: 25 } });
        smooth = info.smooth; efficient = info.powerEfficient;
      } catch (e) { /* not supported for this query */ }
    }
    summary.h = answer + (smooth === null ? '' : (smooth ? '+s' : '-s') + (efficient ? '+hw' : '-hw'));
    const detail = 'H.264 Main 4.0: ' + (answer || 'not supported') + (smooth === null ? '' : '; smooth ' + smooth + ', hardware ' + efficient) + '.';
    if (answer === 'probably' && smooth !== false) report('Video decoding', efficient === false ? 'warn' : 'pass', detail,
      efficient === false ? 'Decoding in software drains the battery faster; check the playback test below.' : '');
    else if (answer) report('Video decoding', 'warn', detail, 'Rely on the playback test below.');
    else report('Video decoding', 'fail', detail, 'This browser cannot play the films; use the stock player for the loops.');
  }

  /** Plays a bundled film for up to `seconds` and measures dropped frames and stalls. @param {string} src @param {number} seconds */
  async function playback(src, seconds) {
    const name = 'Playback: ' + src.split('/').pop();
    report(name, 'run', 'Playing…');
    video.src = src; video.currentTime = 0;
    const started = Date.now();
    try { await video.play(); } catch (e) { report(name, 'fail', 'Could not start: ' + (e && /** @type {any} */ (e).message), 'Allow video autoplay in the kiosk browser settings.'); return; }
    const begin = video.currentTime, beginQuality = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
    const length = Math.min(seconds, (video.duration || seconds) - .3);
    while (!video.ended && Date.now() - started < (length + 3) * 1000 && video.currentTime - begin < length) await wait(250);
    const wall = (Date.now() - started) / 1000, advanced = video.currentTime - begin;
    video.pause();
    const quality = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
    const total = quality && beginQuality ? quality.totalVideoFrames - beginQuality.totalVideoFrames : 0;
    const dropped = quality && beginQuality ? quality.droppedVideoFrames - beginQuality.droppedVideoFrames : 0;
    const share = total ? dropped / total : 0, keptUp = advanced / Math.max(.1, wall);
    (summary.p = summary.p || []).push([src.split('/').pop().replace('.mp4', '').replace(/^loop-/, '').slice(0, 12), dropped, total, Math.round(keptUp * 100)]);
    const detail = video.videoWidth + 'x' + video.videoHeight + ': ' + dropped + ' of ' + total + ' frames dropped, ' + Math.round(keptUp * 100) + '% real-time speed.';
    if (!total) report(name, 'warn', detail + ' (this browser does not report frame counts).', 'Watch the preview: it should move smoothly.');
    else if (share <= .01 && keptUp >= .9) report(name, 'pass', detail);
    else if (share <= .05 && keptUp >= .8) report(name, 'warn', detail, 'Close other apps; lower the brightness only if the device is hot.');
    else report(name, 'fail', detail, 'This device cannot play the film smoothly; use the stock player for the loops.');
  }

  function touchCheck() {
    const points = navigator.maxTouchPoints || 0;
    summary.t = points;
    // Stays a warning until a real finger tap arrives: a dead or covered touchscreen must not pass.
    report('Touch', 'warn', points + ' touch point(s) reported; no finger tap yet.',
      points > 0 ? 'Tap the button above with a finger (through the cover, if fitted).' : 'The screen may not be a touchscreen in this mode; the loops still play.');
  }
  $('.kiosk-check-tap').addEventListener('pointerdown', (/** @type {PointerEvent} */ event) => {
    summary.t = String(navigator.maxTouchPoints || 0) + event.pointerType.slice(0, 1);
    report('Touch', event.pointerType === 'touch' ? 'pass' : 'warn', 'Tap received as ' + event.pointerType + '.',
      event.pointerType === 'touch' ? '' : 'Try again with a finger (through the cover, if fitted).');
    if (!$('.kiosk-check-result').hidden) finish();
  });

  async function storageCheck() {
    const need = Number(data && data.bytes) || 0;
    const storage = /** @type {any} */ (navigator).storage;
    if (!storage || !storage.estimate) { report('Storage', 'info', 'This browser does not report storage.'); return; }
    const est = await storage.estimate(), free = (est.quota || 0) - (est.usage || 0);
    summary.q = Math.round(free / 1e6);
    const detail = Math.round(free / 1e6) + ' MB free for the kiosk; the build needs ' + Math.round(need / 1e6) + ' MB.';
    report('Storage', !need || free > 2 * need ? 'pass' : 'warn', detail, free > 2 * need ? '' : 'Free up space on the device.');
  }

  async function offlineCheck() {
    if (location.protocol === 'file:') { summary.o = 'file'; report('Works offline', 'pass', 'Running from files on this device: no network needed.'); return; }
    const sw = navigator.serviceWorker;
    if (!sw) { summary.o = 'none'; report('Works offline', 'fail', 'This browser cannot keep an offline copy.', 'Copy the kiosk folder to the device and open index.html instead.'); return; }
    const keys = window.caches ? await caches.keys() : [];
    const mine = keys.filter((k) => k === 'packos-kiosk-' + (data && data.build));
    let cached = 0;
    if (mine.length) cached = (await (await caches.open(mine[0])).keys()).length;
    const want = data && data.files ? data.files.length : 0;
    summary.o = cached + '/' + want;
    if (sw.controller && cached >= want) report('Works offline', 'pass', 'All ' + want + ' files are cached on this device.');
    else report('Works offline', 'warn', cached + ' of ' + want + ' files cached.', 'Open the kiosk once while online and wait a minute, then run this check again.');
  }

  /** The phone remote's relay (kiosk opened with ?remote=): the live stream opens and the quota reads, without
   * publishing anything (ntfy.sh allows 250 messages a day per internet address). */
  async function remoteCheck() {
    const channel = new URLSearchParams(location.search).get('remote') || '';
    if (!channel) { summary.r = 'off'; report('Phone remote', 'info', 'Off: the start page has no ?remote= channel.'); return; }
    if (!/^[A-Za-z0-9_-]{12,58}$/.test(channel)) {
      summary.r = 'bad'; report('Phone remote', 'fail', 'The channel in the start page is not valid.', 'Copy the start page address from the phone remote\'s Setup again.'); return;
    }
    const back = /** @type {HTMLAnchorElement|null} */ (document.querySelector('a.kiosk-back'));
    if (back) back.href = 'index.html?remote=' + encodeURIComponent(channel);
    report('Phone remote', 'run', 'Connecting to the relay…');
    const opened = await new Promise((done) => {
      let source = /** @type {EventSource|null} */ (null);
      const timer = setTimeout(() => { if (source) source.close(); done(false); }, 10000);
      try {
        source = new EventSource('https://ntfy.sh/' + channel + '-check/sse');
        source.addEventListener('open', () => { clearTimeout(timer); if (source) source.close(); done(true); });
      } catch (e) { clearTimeout(timer); done(false); }
    });
    let left = -1;
    // Bounded, so a stalled relay can never hold up the rest of the check.
    const abort = typeof AbortController === 'function' ? new AbortController() : null;
    const limit = setTimeout(() => { if (abort) abort.abort(); }, 8000);
    try {
      const account = await (await fetch('https://ntfy.sh/v1/account', abort ? { signal: abort.signal } : {})).json();
      left = account.stats.messages_remaining;
    } catch (e) { /* the count is shown as unavailable below */ }
    clearTimeout(limit);
    summary.r = opened ? left : 'x';
    if (!opened) report('Phone remote', 'fail', 'The relay (ntfy.sh) could not be reached.', 'Connect the device to the phone hotspot with mobile data. If it is online, allow this kiosk browser to load web content from local files.');
    else if (left >= 0 && left < 40) report('Phone remote', 'warn', 'Relay reachable, but only ' + left + ' messages are left today on this connection.', 'Each tap uses about two; the count resets within 24 hours.');
    else report('Phone remote', 'pass', 'Relay reachable' + (left >= 0 ? ', ' + left + ' messages left today on this connection.' : '; today\'s message count is unavailable.'));
  }

  function infoChecks() {
    report('Network', 'info', navigator.onLine ? 'Online.' : 'Offline (fine: the kiosk needs no network).');
    report('Keep screen on', 'info', 'wakeLock' in navigator ? 'The page can ask the screen to stay on.' : 'Set "keep screen on" in the kiosk browser or display settings.');
    report('Clock', 'info', new Date().toString().slice(0, 33) + '. Build ' + (data ? data.build : 'missing') + ', recorded ' + (data ? String(data.recorded_at).slice(0, 10) : '?') + '.');
    summary.b = data ? data.build : 'missing';
  }

  /**
   * The whole result as one valid JSON payload that fits the code (at most 200 bytes): long fields are
   * shortened, never cut mid-way. @param {Record<string, any>} full
   */
  function fitted(full) {
    const prefix = 'packOS kiosk check ';
    const steps = [
      (/** @type {any} */ s) => s,
      (/** @type {any} */ s) => Object.assign({}, s, { b: String(s.b).slice(0, 8), c: typeof s.c === 'number' ? s.c : String(s.c).slice(0, 12) }),
      (/** @type {any} */ s) => Object.assign({}, s, { p: (s.p || []).map((/** @type {any[]} */ r) => [r[1], r[2], r[3]]) }),
      (/** @type {any} */ s) => ({ v: s.v, b: s.b, s: s.s, c: s.c, t: s.t, p: (s.p || []).map((/** @type {any[]} */ r) => r[0]) }),
      (/** @type {any} */ s) => ({ v: s.v, b: s.b })
    ];
    let current = full;
    for (const step of steps) {
      current = step(current);
      const text = prefix + JSON.stringify(current);
      if (unescape(encodeURIComponent(text)).length <= 200) return text;
    }
    return prefix + JSON.stringify({ v: full.v });
  }

  function finish() {
    const fails = results.filter((r) => r.status === 'fail').length, warns = results.filter((r) => r.status === 'warn').length;
    summary.v = fails ? 'fail' : warns ? 'warn' : 'pass';
    $('.kiosk-check-verdict').textContent = fails ? fails + ' problem(s) to fix' : warns ? warns + ' thing(s) to check' : 'Ready for the kiosk';
    const text = 'packOS kiosk check ' + JSON.stringify(summary);
    $('.kiosk-check-summary').textContent = text;
    const box = $('.kiosk-check-qr');
    while (box.firstChild) box.removeChild(box.firstChild);
    try {
      const doc = new DOMParser().parseFromString(QR.svg(fitted(summary)), 'image/svg+xml');
      box.appendChild(document.importNode(doc.documentElement, true));
    } catch (e) { box.textContent = 'QR unavailable'; }
    $('.kiosk-check-result').hidden = false;
    $('.kiosk-check-again').hidden = false;
    /** @type {any} */ (window).__kioskCheck = { summary: summary, results: results };
  }

  async function run() {
    summary = {}; results = [];
    while (list.firstChild) list.removeChild(list.firstChild);
    $('.kiosk-check-result').hidden = true; $('.kiosk-check-again').hidden = true;
    if (!data) { report('Kiosk data', 'fail', 'kiosk-data.js is missing.', 'Copy the whole kiosk folder again.'); finish(); return; }
    screenCheck(); engineCheck(); touchCheck(); infoChecks();
    await codecCheck();
    await storageCheck();
    await offlineCheck();
    await remoteCheck();
    const films = (typeof data.attract === 'string' ? [data.attract] : data.attract || []).slice();
    if (data.chapters && data.chapters[0]) films.push(data.chapters[0].clip);
    for (const src of films) await playback(src, 8);
    finish();
  }
  $('.kiosk-check-again').addEventListener('click', () => { run(); });
  run();
})();
