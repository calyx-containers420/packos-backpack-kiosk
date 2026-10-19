// @ts-check
/**
 * QR codes in the kiosk (device-check results): byte mode, level M, versions 1-10.
 * A line-for-line port of automation/qr.py; test_signage.py checks both produce identical modules.
 * Plain script (no modules) for old Android WebViews; exposes self.PACKOS_QR = {matrix, svg}.
 */
(function (root) {
  'use strict';
  /** Level M: [EC codewords per block, [[block count, data codewords per block], ...]] */
  var BLOCKS = {
    1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]],
    6: [16, [[4, 27]]], 7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]], 10: [26, [[4, 43], [1, 44]]]
  };
  var ALIGNMENT = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
  var QUIET = 4;
  var EXP = new Array(512), LOG = new Array(256), x = 1, i;
  for (i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
  for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

  /** @param {number} a @param {number} b */
  function mul(a, b) { return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]; }
  /** @param {number} degree */
  function generator(degree) {
    var poly = [1];
    for (var k = 0; k < degree; k++) {
      var next = [];
      for (var j = 0; j <= poly.length; j++) next.push((j < poly.length ? poly[j] : 0) ^ (j > 0 ? mul(poly[j - 1], EXP[k]) : 0));
      poly = next;
    }
    return poly;
  }
  /** @param {number[]} data @param {number} degree */
  function remainder(data, degree) {
    var gen = generator(degree), rem = new Array(degree).fill(0);
    data.forEach(function (byte) {
      var factor = byte ^ rem[0];
      rem = rem.slice(1).concat([0]);
      for (var k = 0; k < degree; k++) rem[k] ^= mul(gen[k + 1], factor);
    });
    return rem;
  }
  /** @param {number} version */
  function capacity(version) { return BLOCKS[version][1].reduce(function (sum, g) { return sum + g[0] * g[1]; }, 0); }
  /** @param {string} text */
  function utf8(text) {
    var out = [], encoded = unescape(encodeURIComponent(text));
    for (var k = 0; k < encoded.length; k++) out.push(encoded.charCodeAt(k));
    return out;
  }
  /** @param {number[]} data */
  function codewords(data) {
    var version = 0, countBits = 8;
    for (var v = 1; v <= 10; v++) {
      countBits = v < 10 ? 8 : 16;
      if (4 + countBits + 8 * data.length <= 8 * capacity(v)) { version = v; break; }
    }
    if (!version) throw new Error('QR content is too long.');
    var bits = [0, 1, 0, 0], k;
    for (k = countBits - 1; k >= 0; k--) bits.push((data.length >> k) & 1);
    data.forEach(function (byte) { for (var b = 7; b >= 0; b--) bits.push((byte >> b) & 1); });
    var room = 8 * capacity(version);
    for (k = 0; k < Math.min(4, room - bits.length); k++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var stream = [];
    for (k = 0; k < bits.length; k += 8) stream.push(parseInt(bits.slice(k, k + 8).join(''), 2));
    var pad = 0xEC;
    while (stream.length < capacity(version)) { stream.push(pad); pad ^= 0xEC ^ 0x11; }
    var ec = BLOCKS[version][0], blocks = [], at = 0;
    BLOCKS[version][1].forEach(function (g) { for (var n = 0; n < g[0]; n++) { blocks.push(stream.slice(at, at + g[1])); at += g[1]; } });
    var out = [], longest = Math.max.apply(null, blocks.map(function (b) { return b.length; }));
    for (k = 0; k < longest; k++) blocks.forEach(function (b) { if (k < b.length) out.push(b[k]); });
    var checks = blocks.map(function (b) { return remainder(b, ec); });
    for (k = 0; k < ec; k++) checks.forEach(function (c) { out.push(c[k]); });
    return { version: version, data: out };
  }
  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; }, function (x, y) { return y % 2 === 0; }, function (x) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; }, function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return x * y % 2 + x * y % 3 === 0; }, function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
    function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }
  ];
  /** @param {number} version */
  function Symbol(version) {
    var n = 17 + 4 * version, self = this;
    this.size = n;
    this.dark = []; this.fn = [];
    for (var y = 0; y < n; y++) { this.dark.push(new Array(n).fill(false)); this.fn.push(new Array(n).fill(false)); }
    /** @param {number} x @param {number} y @param {any} on */
    this.put = function (x, y, on) { self.dark[y][x] = !!on; self.fn[y][x] = true; };
    this.format = function (/** @type {number} */ mask) {
      var data = mask, rem = data, k;
      for (k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
      var bits = ((data << 10) | rem) ^ 0x5412, bit = function (/** @type {number} */ j) { return (bits >> j) & 1; };
      for (k = 0; k < 6; k++) self.put(8, k, bit(k));
      self.put(8, 7, bit(6)); self.put(8, 8, bit(7)); self.put(7, 8, bit(8));
      for (k = 9; k < 15; k++) self.put(14 - k, 8, bit(k));
      for (k = 0; k < 8; k++) self.put(n - 1 - k, 8, bit(k));
      for (k = 8; k < 15; k++) self.put(8, n - 15 + k, bit(k));
      self.put(8, n - 8, 1);
    };
    var k, dx, dy;
    for (k = 0; k < n; k++) { this.put(6, k, k % 2 === 0); this.put(k, 6, k % 2 === 0); }
    [[3, 3], [n - 4, 3], [3, n - 4]].forEach(function (c) {
      for (dy = -4; dy <= 4; dy++) for (dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy));
        if (c[0] + dx >= 0 && c[0] + dx < n && c[1] + dy >= 0 && c[1] + dy < n) self.put(c[0] + dx, c[1] + dy, d !== 2 && d !== 4);
      }
    });
    var spots = ALIGNMENT[version], last = spots.length - 1;
    spots.forEach(function (ay, a) {
      spots.forEach(function (ax, b) {
        if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) return;
        for (dy = -2; dy <= 2; dy++) for (dx = -2; dx <= 2; dx++) self.put(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      });
    });
    this.format(0);
    if (version >= 7) {
      var rem = version;
      for (k = 0; k < 12; k++) rem = (rem << 1) ^ ((rem >> 11) * 0x1F25);
      var vbits = (version << 12) | rem;
      for (k = 0; k < 18; k++) { var on = (vbits >> k) & 1; this.put(n - 11 + k % 3, Math.floor(k / 3), on); this.put(Math.floor(k / 3), n - 11 + k % 3, on); }
    }
  }
  /** @param {number[]} data */
  Symbol.prototype.place = function (data) {
    var n = this.size, idx = 0, total = data.length * 8, right = n - 1;
    while (right >= 1) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < n; vert++) for (var j = 0; j < 2; j++) {
        var x = right - j, y = ((right + 1) & 2) === 0 ? n - 1 - vert : vert;
        if (!this.fn[y][x] && idx < total) { this.dark[y][x] = ((data[idx >> 3] >> (7 - (idx & 7))) & 1) === 1; idx++; }
      }
      right -= 2;
    }
  };
  /** @param {number} mask */
  Symbol.prototype.masked = function (mask) {
    var test = MASKS[mask], fn = this.fn;
    return this.dark.map(function (row, y) { return row.map(function (on, x) { return !fn[y][x] && test(x, y) ? !on : on; }); });
  };
  /** @param {boolean[][]} grid */
  function penalty(grid) {
    var n = grid.length, score = 0, k, y, x;
    var lines = grid.slice();
    for (x = 0; x < n; x++) lines.push(grid.map(function (row) { return row[x]; }));
    var finders = ['10111010000', '00001011101'];
    lines.forEach(function (line) {
      var run = 1;
      for (k = 1; k < line.length; k++) {
        if (line[k] === line[k - 1]) run++;
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      if (run >= 5) score += run - 2;
      var text = line.map(function (v) { return v ? '1' : '0'; }).join('');
      for (k = 0; k + 11 <= n; k++) if (finders.indexOf(text.slice(k, k + 11)) >= 0) score += 40;
    });
    for (y = 0; y < n - 1; y++) for (x = 0; x < n - 1; x++)
      if (grid[y][x] === grid[y][x + 1] && grid[y][x] === grid[y + 1][x] && grid[y][x] === grid[y + 1][x + 1]) score += 3;
    var dark = 0;
    grid.forEach(function (row) { row.forEach(function (v) { if (v) dark++; }); });
    score += 10 * Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n));
    return score;
  }
  /** Module grid (true = dark), without the quiet zone. @param {string} text @returns {boolean[][]} */
  function matrix(text) {
    var cw = codewords(utf8(text)), best = null, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      var symbol = new Symbol(cw.version);
      symbol.place(cw.data); symbol.format(mask);
      var grid = symbol.masked(mask), score = penalty(grid);
      if (score < bestScore) { bestScore = score; best = grid; }
    }
    return /** @type {boolean[][]} */ (best);
  }
  /** @param {string} text @param {string} [dark] */
  function svg(text, dark) {
    var grid = matrix(text), n = grid.length + 2 * QUIET, path = '';
    grid.forEach(function (row, y) { row.forEach(function (on, x) { if (on) path += 'M' + (x + QUIET) + ' ' + (y + QUIET) + 'h1v1h-1z'; }); });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges"><rect width="' + n + '" height="' + n +
      '" fill="#fff"/><path fill="' + (dark || '#16181d') + '" d="' + path + '"/></svg>';
  }
  root.PACKOS_QR = { matrix: matrix, svg: svg };
})(typeof self !== 'undefined' ? self : globalThis);
