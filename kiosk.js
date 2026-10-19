// @ts-check
/**
 * packOS touch kiosk: attract loops -> menu (how it works + labels like yours) -> recorded clips,
 * recorded run-size prices and a QR hand-off. Everything shown comes from kiosk-data.js (built by
 * automation/signage.py from public-sample recordings); nothing is priced or computed here. The
 * visitor's own quote happens on their phone.
 *
 * Baseline: Chromium 83 (Android 11's original System WebView). No replaceChildren, Array#at,
 * replaceAll, logical assignment or structuredClone; test_signage.py enforces this.
 */
(() => {
  /** @typedef {{id:string,title:string,line:string,clip:string,poster:string,seconds:number,callout:null|{label:string,text:string}}} Chapter */
  /** @typedef {{quantity:number,per_label:string,total:string}} PriceRow */
  /** @typedef {null|{spec:{label:string,value:string}[],rows:PriceRow[],note:string}} Prices */
  /** @typedef {{value:string,label:string,description:string,name:string,per_label:string,per_label_60k:string|null,image:string,starting:boolean}} Option */
  /** @typedef {{key:string,title:string,options:Option[]}} OptionGroup */
  /** @typedef {{id:string,name:string,category:string,roll:string,spec:string,prices:Prices,recorded_at:string,chapters:Chapter[],options?:OptionGroup[]}} Sample */
  /** @typedef {{key:string,title:string,line:string,seconds:number|null}} LoopInfo */
  /** @typedef {{build:string,built_at:string,recorded_at:string,campaign:string,link:string,link_label:string,qr_svg:string,attract:string[]|string,
   *   loops?:LoopInfo[],chapters:Chapter[],samples?:Sample[],disclosure:string,idle_seconds:number}} KioskData */
  const data = /** @type {KioskData|undefined} */ (/** @type {any} */ (self).PACKOS_KIOSK);
  const root = /** @type {HTMLElement} */ (document.getElementById('kiosk'));
  if (!data || !root) {
    document.body.textContent = 'Kiosk data is missing. Rebuild with automation/signage.py.';
    return;
  }
  /** @param {string} selector @param {ParentNode} [scope] @returns {any} */
  const $ = (selector, scope) => (scope || root).querySelector(selector);
  /** @param {string} selector @returns {any[]} */
  const $$ = (selector) => Array.prototype.slice.call(root.querySelectorAll(selector));
  /** @param {Element} node */
  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };
  /** @param {string} tag @param {string} [cls] @param {string} [text] @returns {any} */
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const screens = /** @type {HTMLElement[]} */ ($$('[data-screen]'));
  const attractVideo = /** @type {HTMLVideoElement} */ ($('.kiosk-attract-video'));
  const chapterVideo = /** @type {HTMLVideoElement} */ ($('.kiosk-chapter-video'));
  const sampleVideo = /** @type {HTMLVideoElement} */ ($('.kiosk-sample-video'));
  const samples = data.samples || [];
  const loops = typeof data.attract === 'string' ? [data.attract] : data.attract;
  const fmt = new Intl.NumberFormat('en-US');
  /** @param {string} iso */
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');

  // ---------------------------------------------------------------- counts (per device; staff read them in the details panel)
  const KEY = 'packos-kiosk-counts';
  /** @returns {{wakes:number,chapters:Record<string,number>,samples:Record<string,number>,prices:number,options:number,idle:number,since:string}} */
  const readCounts = () => {
    const blank = { wakes: 0, chapters: {}, samples: {}, prices: 0, options: 0, idle: 0, since: new Date().toISOString() };
    try { return Object.assign(blank, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return blank; }
  };
  let counts = readCounts();
  /** True while the phone remote is moving the kiosk: staff moves are not visitor counts. */
  let quiet = false;
  /** @param {(c: ReturnType<typeof readCounts>) => void} change */
  const count = (change) => {
    if (quiet) return;
    change(counts);
    try { localStorage.setItem(KEY, JSON.stringify(counts)); } catch (e) { /* storage unavailable: counts stay in memory */ }
  };

  // ---------------------------------------------------------------- screens
  let current = 'attract';
  /** What is on screen, for the phone remote: the open label or step, and a loop the remote pinned (-1: loops in turn). */
  let shownSample = '', shownStep = '', pinned = -1;
  /** @type {ServiceWorker|null} a downloaded build waiting to take over */
  let waiting = null;
  /** Ask the waiting build to take over; the page reloads on controllerchange. Only ever from the attract loop. */
  const applyUpdate = () => { if (waiting && current === 'attract') waiting.postMessage('activate'); };
  /** @param {'attract'|'menu'|'chapter'|'sample'} name */
  const show = (name) => {
    current = name;
    screens.forEach((node) => { node.hidden = node.dataset.screen !== name; });
    [chapterVideo, sampleVideo].forEach((video) => { if (video) video.pause(); });
    if (name === 'attract') { playLoop(0); applyUpdate(); }   // a new build switches in only while nobody is using the kiosk
    else attractVideo.pause();
  };

  // ---------------------------------------------------------------- attract: the loops in turn (or the one the phone remote pinned)
  let loopIndex = 0;
  /** @param {number} index */
  const playLoop = (index) => {
    loopIndex = (pinned >= 0 ? pinned : index) % loops.length;
    attractVideo.loop = loops.length === 1 || pinned >= 0;
    if (attractVideo.getAttribute('src') !== loops[loopIndex]) attractVideo.src = loops[loopIndex];
    attractVideo.currentTime = 0;
    const playing = attractVideo.play();
    if (playing && playing.catch) playing.catch(() => {});
  };
  attractVideo.addEventListener('ended', () => { if (current === 'attract') playLoop(loopIndex + 1); });
  attractVideo.addEventListener('error', () => {
    if (loops.length > 1 && current === 'attract') setTimeout(() => playLoop(loopIndex + 1), 1000);
    else attractVideo.poster = (data.chapters[0] && data.chapters[0].poster) || '';
  });

  // ---------------------------------------------------------------- idle: back to the loop when nobody is touching
  let idleTimer = 0;
  const idleMs = Math.max(15, Number(data.idle_seconds) || 45) * 1000;
  /** A clip still playing keeps the screen; the idle clock restarts when it ends. */
  const busy = () => [chapterVideo, sampleVideo].some((video) => video && !video.paused && !video.ended);
  const touched = () => {
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      if (current === 'attract') return;
      if (busy()) { touched(); return; }
      count((c) => { c.idle += 1; });
      admin.hidden = true;
      show('attract');
    }, idleMs);
  };
  ['pointerdown', 'keydown'].forEach((type) => document.addEventListener(type, touched, { passive: true }));

  // ---------------------------------------------------------------- shared pieces
  /** @param {string} svg */
  const qrNode = (svg) => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const node = doc.documentElement;
    return node && node.nodeName === 'svg' && !doc.querySelector('script, foreignObject') ? document.importNode(node, true) : null;
  };
  $$('.kiosk-qr').forEach((box) => { const node = qrNode(data.qr_svg); if (node) { clear(box); box.appendChild(node); } });
  $$('.kiosk-link').forEach((node) => { node.textContent = data.link_label; });
  $('.kiosk-disclosure').textContent = data.disclosure;
  $('.kiosk-sample').textContent = 'Recorded on packos.ai with our sample labels' + (data.recorded_at ? ' · ' + day(data.recorded_at) : '');

  /** @param {string} src */
  const ratioImage = (src) => {
    const frame = el('span', 'kiosk-ratio');
    const img = el('img'); img.src = src; img.alt = ''; img.draggable = false;
    frame.appendChild(img);
    return frame;
  };

  /** Recorded run-size table: the page's own numbers at recording time, never recomputed.
   * @param {HTMLElement} box @param {Prices} prices @param {string} recordedAt */
  const renderPrices = (box, prices, recordedAt) => {
    box.hidden = !(prices && prices.rows.length);
    if (box.hidden || !prices) return;
    const runs = $('.kiosk-runs', box), detail = $('.kiosk-run-detail', box);
    clear(runs);
    $('.kiosk-note', box).textContent = [prices.note, 'Recorded on packos.ai' + (recordedAt ? ' ' + day(recordedAt) : '') + '. Illustrative: your label gets its own quote.']
      .filter(Boolean).join(' ');
    /** @param {number} index */
    const pick = (index) => {
      const row = prices.rows[index];
      $$('.kiosk-run').forEach((node) => { if (runs.contains(node)) node.setAttribute('aria-pressed', String(node === runs.children[index])); });
      clear(detail);
      detail.appendChild(document.createTextNode(fmt.format(row.quantity) + ' labels · '));
      detail.appendChild(el('span', 'kiosk-mono', row.per_label));
      detail.appendChild(document.createTextNode(' each · '));
      detail.appendChild(el('span', 'kiosk-mono', row.total));
      detail.appendChild(document.createTextNode(' total'));
    };
    prices.rows.forEach((row, index) => {
      const button = el('button', 'kiosk-run'); button.type = 'button'; button.setAttribute('aria-pressed', 'false');
      button.appendChild(el('span', 'kiosk-run-qty', row.quantity >= 1000 ? row.quantity / 1000 + 'k' : String(row.quantity)));
      button.appendChild(el('span', 'kiosk-run-price', row.per_label));
      runs.appendChild(button);
      button.addEventListener('click', () => { pick(index); count((c) => { c.prices += 1; }); });
    });
    pick(0);
  };

  // ---------------------------------------------------------------- menu: how it works
  const list = $('.kiosk-chapters');
  data.chapters.forEach((chapter, index) => {
    const item = el('li');
    const tile = el('button', 'kiosk-chapter-tile'); tile.type = 'button'; tile.dataset.chapter = chapter.id;
    const text = el('span', 'kiosk-tile-text');
    text.appendChild(el('span', 'kiosk-eyebrow', 'Step ' + (index + 1)));
    text.appendChild(el('span', 'kiosk-tile-title', chapter.title));
    text.appendChild(el('span', 'kiosk-tile-line', chapter.line));
    tile.appendChild(ratioImage(chapter.poster)); tile.appendChild(text);
    item.appendChild(tile); list.appendChild(item);
    tile.addEventListener('click', () => play(index));
  });

  // ---------------------------------------------------------------- menu: labels like yours
  if (samples.length) {
    $('.kiosk-samples-title').hidden = false;
    const grid = $('.kiosk-samples'); grid.hidden = false;
    samples.forEach((sample, index) => {
      const item = el('li');
      const tile = el('button', 'kiosk-sample-tile'); tile.type = 'button'; tile.dataset.sample = sample.id;
      tile.appendChild(ratioImage(sample.roll));
      tile.appendChild(el('span', 'kiosk-eyebrow', sample.category));
      tile.appendChild(el('span', 'kiosk-tile-title', sample.name));
      item.appendChild(tile); grid.appendChild(item);
      tile.addEventListener('click', () => openSample(index));
    });
  }

  // ---------------------------------------------------------------- how-it-works chapters
  let chapterIndex = 0;
  const end = $('.kiosk-end');
  /** @param {number} index */
  const play = (index) => {
    chapterIndex = index;
    const chapter = data.chapters[index];
    shownStep = chapter.id;
    count((c) => { c.chapters[chapter.id] = (c.chapters[chapter.id] || 0) + 1; });
    $('.kiosk-chapter-step').textContent = 'Step ' + (index + 1) + ' of ' + data.chapters.length;
    $('.kiosk-chapter-title').textContent = chapter.title;
    end.hidden = true;
    const callout = $('.kiosk-callout', end);
    callout.hidden = !chapter.callout;
    if (chapter.callout) {
      $('.kiosk-callout-label', end).textContent = chapter.callout.label;
      $('.kiosk-callout-text', end).textContent = chapter.callout.text;
    }
    const next = data.chapters[index + 1];
    $('.kiosk-next').textContent = next ? 'Next: ' + next.title : 'Back to all steps';
    show('chapter');
    chapterVideo.poster = chapter.poster;
    chapterVideo.src = chapter.clip;
    chapterVideo.currentTime = 0;
    const playing = chapterVideo.play();
    if (playing && playing.catch) playing.catch(() => { end.hidden = false; });
  };
  chapterVideo.addEventListener('ended', () => { end.hidden = false; touched(); });
  chapterVideo.addEventListener('error', () => { end.hidden = false; });
  $('.kiosk-again').addEventListener('click', () => play(chapterIndex));
  $('.kiosk-next').addEventListener('click', () => (data.chapters[chapterIndex + 1] ? play(chapterIndex + 1) : show('menu')));

  // ---------------------------------------------------------------- one sample label
  const sampleScreen = $('.kiosk-sample-screen');
  const roll = $('.kiosk-sample-roll');
  const buttons = $('.kiosk-clip-buttons');
  const sampleCallout = $('.kiosk-sample-callout');
  /** @param {number} index */
  const openSample = (index) => {
    const sample = samples[index];
    shownSample = sample.id;
    count((c) => { c.samples[sample.id] = (c.samples[sample.id] || 0) + 1; });
    $('.kiosk-sample-category').textContent = sample.category + ' · sample label';
    $('.kiosk-sample-name').textContent = sample.name;
    $('.kiosk-sample-spec').textContent = sample.spec;
    roll.src = sample.roll; roll.hidden = false;
    sampleVideo.hidden = true; sampleVideo.removeAttribute('src'); sampleCallout.hidden = true;
    clear(buttons);
    sample.chapters.forEach((chapter) => {
      const button = el('button', 'kiosk-button kiosk-button-quiet', chapter.title); button.type = 'button'; button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        Array.prototype.forEach.call(buttons.children, (/** @type {Element} */ b) => b.setAttribute('aria-pressed', String(b === button)));
        $$('.kiosk-option').forEach((node) => node.setAttribute('aria-pressed', 'false'));
        const detail = $('.kiosk-option-detail', sampleScreen);
        if (detail) detail.textContent = 'Tap an option to see this label in it, with its recorded price.';
        roll.hidden = true; sampleVideo.hidden = false; sampleCallout.hidden = true;
        sampleVideo.poster = chapter.poster; sampleVideo.src = chapter.clip; sampleVideo.currentTime = 0;
        const playing = sampleVideo.play();
        if (playing && playing.catch) playing.catch(() => {});
        sampleVideo.onended = () => {
          sampleCallout.hidden = !chapter.callout;
          if (chapter.callout) {
            $('.kiosk-callout-label', sampleCallout).textContent = chapter.callout.label;
            $('.kiosk-callout-text', sampleCallout).textContent = chapter.callout.text;
          }
          touched();
        };
      });
      buttons.appendChild(button);
    });
    renderOptions(sample);
    renderPrices($('.kiosk-prices', sampleScreen), sample.prices, sample.recorded_at);
    show('sample');
  };

  /** "Try it on this label": the page's own render and prices for each recorded finish and material.
   * @param {Sample} sample */
  const renderOptions = (sample) => {
    const panel = $('.kiosk-options', sampleScreen), groupsBox = $('.kiosk-option-groups', panel), detail = $('.kiosk-option-detail', panel);
    const groups = sample.options || [];
    panel.hidden = !groups.length;
    clear(groupsBox); clear(detail);
    if (!groups.length) return;
    /** @param {OptionGroup} group @param {Option} option @param {HTMLElement} chip */
    const choose = (group, option, chip) => {
      $$('.kiosk-option').forEach((node) => { if (groupsBox.contains(node)) node.setAttribute('aria-pressed', String(node === chip)); });
      roll.src = option.image; roll.hidden = false;
      sampleVideo.pause(); sampleVideo.hidden = true; sampleCallout.hidden = true;
      Array.prototype.forEach.call(buttons.children, (/** @type {Element} */ b) => b.setAttribute('aria-pressed', 'false'));
      clear(detail);
      detail.appendChild(el('strong', '', option.label + (option.starting ? ' (as quoted)' : '')));
      if (option.description) detail.appendChild(document.createTextNode(' · ' + option.description));
      detail.appendChild(el('br'));
      detail.appendChild(el('span', 'kiosk-mono', option.per_label));
      detail.appendChild(document.createTextNode(' per label at 10,000'));
      if (option.per_label_60k) {
        detail.appendChild(document.createTextNode(' · '));
        detail.appendChild(el('span', 'kiosk-mono', option.per_label_60k));
        detail.appendChild(document.createTextNode(' at 60,000'));
      }
      detail.appendChild(document.createTextNode('. Other choices as quoted.'));
    };
    groups.forEach((group) => {
      const row = el('div', 'kiosk-option-group');
      row.appendChild(el('p', 'kiosk-option-title', group.title));
      const chips = el('div', 'kiosk-option-chips'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', group.title);
      group.options.forEach((option) => {
        const chip = el('button', 'kiosk-option', option.label.replace(/ laminate$/i, '')); chip.type = 'button'; chip.setAttribute('aria-pressed', 'false');
        chip.dataset.option = group.key + ':' + option.value;
        chip.addEventListener('click', () => { choose(group, option, chip); count((c) => { c.options += 1; }); });
        chips.appendChild(chip);
      });
      row.appendChild(chips); groupsBox.appendChild(row);
    });
    detail.textContent = 'Tap an option to see this label in it, with its recorded price.';
  };

  $$('.kiosk-back').forEach((button) => button.addEventListener('click', () => show('menu')));

  // ---------------------------------------------------------------- wake from the loop
  $('.kiosk-attract').addEventListener('click', () => {
    count((c) => { c.wakes += 1; });
    const full = document.documentElement;
    if (!document.fullscreenElement && full.requestFullscreen) {
      const asked = full.requestFullscreen();
      if (asked && asked.catch) asked.catch(() => {});
    }
    show('menu');
  });

  // ---------------------------------------------------------------- staff details: hold the logo for 3 s
  const admin = $('.kiosk-admin');
  const openAdmin = () => {
    counts = readCounts();
    const facts = $('.kiosk-admin-facts'); clear(facts);
    const rows = [['Build', data.build], ['Built', data.built_at], ['Recorded', data.recorded_at], ['Campaign', data.campaign], ['QR link', data.link],
      ['Offline copy', navigator.serviceWorker && navigator.serviceWorker.controller ? 'cached on this device' : location.protocol === 'file:' ? 'local files' : 'not cached yet'],
      ['Phone remote', remoteStatus], ['Counting since', counts.since], ['Loop wakes', String(counts.wakes)], ['Run-size taps', String(counts.prices)], ['Option taps', String(counts.options || 0)], ['Idle returns', String(counts.idle)]];
    data.chapters.forEach((c) => rows.push(['Step: ' + c.title, String(counts.chapters[c.id] || 0)]));
    samples.forEach((s) => rows.push(['Label: ' + s.name, String(counts.samples[s.id] || 0)]));
    rows.forEach((pair) => { facts.appendChild(el('dt', '', pair[0])); facts.appendChild(el('dd', '', pair[1])); });
    admin.hidden = false;
  };
  let hold = 0;
  const logo = $('.kiosk-logo');
  logo.addEventListener('pointerdown', () => { hold = window.setTimeout(openAdmin, 3000); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => logo.addEventListener(type, () => clearTimeout(hold)));
  logo.addEventListener('contextmenu', (/** @type {Event} */ e) => e.preventDefault());
  $('.kiosk-close').addEventListener('click', () => { admin.hidden = true; });
  $('.kiosk-reload').addEventListener('click', () => location.reload());
  $('.kiosk-reset').addEventListener('click', () => {
    try { localStorage.removeItem(KEY); } catch (e) { /* nothing stored */ }
    counts = readCounts(); openAdmin();
  });

  // ---------------------------------------------------------------- phone remote (optional): index.html?remote=<channel>
  // Staff steer the screen from remote.html on their phone. Both pages talk through the public ntfy.sh relay on a
  // channel name only they know: commands arrive on <channel>, and the kiosk reports what it shows on <channel>-state.
  // Only moves the touch screen already offers are accepted (a loop, a label, a step, the menu, the loops, reload),
  // never a URL or code. Without ?remote= or a network, nothing here runs and the kiosk works as before.
  // ntfy.sh allows 250 messages a day per internet address, shared by the backpack and the phone on its hotspot, so the
  // kiosk reports only when asked (a command or a status check) and on connecting, never on a timer or a visitor's tap.
  const RELAY = 'https://ntfy.sh';
  const STALE_S = 150;   // just over a dead line's detection (100 s) plus a reconnect
  const channel = new URLSearchParams(location.search).get('remote') || '';
  // The device check carries the channel there and back, so running it never disconnects the remote.
  if (channel) $$('a[href="check.html"]').forEach((a) => { a.href = 'check.html?remote=' + encodeURIComponent(channel); });
  let remoteStatus = channel ? 'channel name is not valid' : 'off';
  /** @param {string} src */
  const loopKey = (src) => { const m = /loop-([a-z0-9-]+)\.mp4$/.exec(src); return m ? m[1] : src; };
  if (/^[A-Za-z0-9_-]{12,58}$/.test(channel) && typeof EventSource === 'function') {
    remoteStatus = 'connecting';
    let reportTimer = 0, serverNow = 0;
    /** @type {Record<string, boolean>} message ids already handled (a reconnect can deliver one again) */
    const seen = {};
    const state = () => ({
      v: 1, build: data.build, screen: current, loop: current === 'attract' ? loopKey(loops[loopIndex]) : '', pinned: pinned >= 0,
      label: current === 'sample' ? shownSample : '', step: current === 'chapter' ? shownStep : '',
      loops: loops.map(loopKey), labels: samples.map((s) => [s.id, s.name]), steps: data.chapters.map((c) => [c.id, c.title]),
      // What the phone shows on each video card: [key, title, line, seconds]. Older builds have no list; the phone then
      // falls back to its own names.
      info: (data.loops || []).map((l) => [l.key, l.title, l.line, Math.round(Number(l.seconds) || 0)]),
    });
    let lastReport = 0;
    /** @param {boolean} [unasked] a (re)connect, which a flaky hotspot can repeat: at most one report per 5 minutes */
    const report = (unasked) => {
      if (unasked && lastReport && Date.now() - lastReport < 5 * 60 * 1000) return;
      clearTimeout(reportTimer);
      reportTimer = window.setTimeout(() => {
        lastReport = Date.now();
        fetch(RELAY + '/' + channel + '-state', { method: 'POST', body: JSON.stringify(state()) }).catch(() => {});
      }, 600);
    };
    /** @param {string} cmd @param {string} arg */
    const run = (cmd, arg) => {
      if (cmd === 'reload') { location.reload(); return; }   // the reloaded page reports in when it reconnects
      if (cmd === 'status') { report(); return; }
      /** @param {{id:string}[]} list */
      const find = (list) => list.map((item) => item.id).indexOf(arg);
      const loop = loops.map(loopKey).indexOf(arg), sample = find(samples), step = find(data.chapters);
      quiet = true;
      try {
        admin.hidden = true;
        if (cmd === 'attract') { pinned = -1; show('attract'); }
        else if (cmd === 'loop' && loop >= 0) { pinned = loop; show('attract'); }
        else if (cmd === 'menu') show('menu');
        else if (cmd === 'label' && sample >= 0) openSample(sample);
        else if (cmd === 'step' && step >= 0) play(step);
      } finally { quiet = false; }
      touched();   // a screen the remote opened holds like one a visitor opened, then idles back to the loop
      report();
    };
    /** @param {MessageEvent} event @returns {any} */
    const parse = (event) => { try { return JSON.parse(event.data); } catch (e) { return null; } };
    // A hotspot can drop a connection without telling the browser, which then waits forever. The relay sends a
    // keepalive every 45 s, so 100 s of silence means the line is dead: reconnect, and ask for what was missed since
    // the last message. A command sent meanwhile still applies; one older than STALE_S is dropped.
    let lastId = '', heard = Date.now();
    // Retries back off (3 s doubling to 60 s) so a relay refusing us never meets a tight loop: ntfy.sh limits requests
    // per address (a burst of 60, then one per 5 s), shared with the phone. A connection open for 30 s resets it.
    let retryMs = 3000, steady = 0;
    /** @type {EventSource|null} */
    let source = null;
    const connect = () => {
      if (source) source.close();
      clearTimeout(steady);
      heard = Date.now();
      // Resume after the last message, or else from the relay's last known time; a first connect takes only new ones.
      const since = lastId || (serverNow ? String(serverNow) : '');
      const next = new EventSource(RELAY + '/' + channel + '/sse' + (since ? '?since=' + encodeURIComponent(since) : ''));
      source = next;
      /** @param {Event} event */
      const alive = (event) => {
        heard = Date.now();
        const msg = event instanceof MessageEvent ? parse(event) : null;
        if (msg && msg.time > serverNow) serverNow = msg.time;
      };
      next.addEventListener('open', (event) => {
        remoteStatus = 'connected · ' + channel.slice(0, 6) + '…';   // the panel is on a public screen: never the whole key
        if (!(event instanceof MessageEvent)) { clearTimeout(steady); steady = window.setTimeout(() => { retryMs = 3000; }, 30 * 1000); }
        alive(event);
        report(true);
      });
      next.addEventListener('keepalive', alive);
      next.addEventListener('error', () => {
        remoteStatus = navigator.onLine ? 'reconnecting' : 'offline';
        // ntfy's stream carries no event ids, so the browser's own retry would skip what was sent meanwhile:
        // reconnect ourselves, asking for everything since the last message.
        if (source !== next) return;
        next.close();
        clearTimeout(steady);
        window.setTimeout(() => { if (source === next) connect(); }, retryMs);
        retryMs = Math.min(retryMs * 2, 60 * 1000);
      });
      next.addEventListener('message', (event) => {
        heard = Date.now();
        const msg = parse(event);
        if (!msg || msg.event !== 'message' || typeof msg.message !== 'string' || seen[msg.id]) return;
        seen[msg.id] = true;
        lastId = msg.id;
        // A command replayed after a long outage is stale: the person who sent it has moved on.
        if (serverNow && msg.time < serverNow - STALE_S) return;
        if (msg.time > serverNow) serverNow = msg.time;
        let body = null;
        try { body = JSON.parse(msg.message); } catch (e) { return; }
        if (body && typeof body.cmd === 'string') run(body.cmd, typeof body.arg === 'string' ? body.arg : '');
      });
    };
    connect();
    setInterval(() => { if (Date.now() - heard > 100 * 1000) { remoteStatus = 'reconnecting'; connect(); } }, 10 * 1000);
  }

  // ---------------------------------------------------------------- offline cache, updates and screen on
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].indexOf(location.hostname) >= 0;
  if (secure && 'serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    // The new build took over (only ever asked from the attract loop): load its files.
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
    /** @param {ServiceWorker|null} worker */
    const ready = (worker) => { if (worker && navigator.serviceWorker.controller) { waiting = worker; applyUpdate(); } };
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((registration) => {
      ready(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (worker) worker.addEventListener('statechange', () => { if (worker.state === 'installed') ready(worker); });
      });
      setInterval(() => { if (navigator.onLine) registration.update().catch(() => {}); }, 30 * 60 * 1000);
    }).catch(() => {});
  }
  const keepAwake = () => {
    const lock = /** @type {any} */ (navigator).wakeLock;
    if (lock && document.visibilityState === 'visible') lock.request('screen').catch(() => {});
  };
  document.addEventListener('visibilitychange', keepAwake);
  keepAwake();

  show('attract');
})();
