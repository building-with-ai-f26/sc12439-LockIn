/*
  character-ui.js — the character builder widget.
  CharacterUI.mount(container, { onChange }) draws the pickers and a live
  preview, and returns { getOptions, setOptions, getDataURL, randomize,
  suggestFromFile }. Used by character.html and the game intake.
*/
(function (root) {
  "use strict";
  var S = root.Sprite;

  var CSS = [
    ".cb { display: grid; grid-template-columns: 150px 1fr; gap: 18px; align-items: start; }",
    "@media (max-width: 560px) { .cb { grid-template-columns: 1fr; } .cb-preview { margin: 0 auto; } }",
    ".cb-preview { width: 150px; height: 240px; image-rendering: pixelated; image-rendering: crisp-edges; background: #0c0b1d; border: 3px solid #000; box-shadow: 6px 6px 0 #000; display: block; }",
    ".cb-row { margin-bottom: 12px; }",
    ".cb-row .cb-label { font-family: 'Press Start 2P', monospace; font-size: 8px; color: var(--muted, #b7b0e0); margin-bottom: 6px; display: block; letter-spacing: 1px; }",
    ".cb-opts { display: flex; flex-wrap: wrap; gap: 6px; }",
    ".cb-opt { font-family: 'Press Start 2P', monospace; font-size: 8px; padding: 8px 9px; border: 2px solid var(--border, #3a3575); background: #0c0b1d; color: var(--ink, #f4f1ff); cursor: pointer; line-height: 1; }",
    ".cb-opt.on { border-color: var(--gold, #ffd23f); color: var(--gold, #ffd23f); }",
    ".cb-sw { width: 26px; height: 26px; border: 2px solid #000; cursor: pointer; padding: 0; }",
    ".cb-sw.on { outline: 3px solid var(--gold, #ffd23f); outline-offset: 1px; }",
    ".cb-tools { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 4px; }",
    ".cb-file { font-size: 12px; color: var(--muted, #b7b0e0); max-width: 220px; }"
  ].join("\n");

  var LABELS = {
    hair: { short: "SHORT", pompadour: "POMPADOUR", long: "LONG", afro: "AFRO", bun: "BUN", sidepart: "SIDE PART", buzz: "BUZZ", bald: "BALD" },
    facial: { none: "CLEAN", mustache: "MUSTACHE", beard: "BEARD", goatee: "GOATEE" },
    top: { tee: "TEE", jacket: "JACKET", hoodie: "HOODIE", suit: "SUIT", tank: "TANK" },
    bottom: { pants: "PANTS", shorts: "SHORTS", skirt: "SKIRT" }
  };

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function ensureCSS() {
    if (document.getElementById("cb-css")) return;
    var st = el("style"); st.id = "cb-css"; st.textContent = CSS; document.head.appendChild(st);
  }

  // Draw the sprite onto a canvas at integer scale, optionally centred in a square.
  // stage (1-3, optional) draws the evolved look from Sprite.STAGES.
  function draw(canvas, opts, scale, square, stage) {
    var w = S.WIDTH * scale, h = S.HEIGHT * scale;
    var size = square ? Math.max(w, h) : null;
    canvas.width = square ? size : w; canvas.height = square ? size : h;
    var ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var small = document.createElement("canvas"); small.width = S.WIDTH; small.height = S.HEIGHT;
    var id = small.getContext("2d").createImageData(S.WIDTH, S.HEIGHT);
    id.data.set(S.renderRGBA(opts, stage || 1));
    small.getContext("2d").putImageData(id, 0, 0);
    var ox = square ? Math.floor((size - w) / 2) : 0, oy = square ? size - h : 0;
    ctx.drawImage(small, ox, oy, w, h);
  }

  function mount(container, cfg) {
    ensureCSS();
    cfg = cfg || {};
    var opts = S.normalize(cfg.initial || {});
    var stage = cfg.stage || 1;   // preview only; never saved with the options
    var root = el("div", "cb");
    var preview = el("canvas", "cb-preview");
    var side = el("div");
    root.appendChild(preview); root.appendChild(side);
    container.appendChild(root);

    function choiceRow(label, key, set) {
      var row = el("div", "cb-row"); row.appendChild(el("span", "cb-label", label));
      var wrap = el("div", "cb-opts");
      Object.keys(set).forEach(function (k) {
        var b = el("button", "cb-opt", LABELS[key][k] || k.toUpperCase()); b.type = "button"; b.dataset.key = key; b.dataset.val = k;
        b.addEventListener("click", function () { opts[key] = k; update(); });
        wrap.appendChild(b);
      });
      row.appendChild(wrap); side.appendChild(row); return row;
    }
    function colorRow(label, key, list) {
      var row = el("div", "cb-row"); row.appendChild(el("span", "cb-label", label));
      var wrap = el("div", "cb-opts");
      list.forEach(function (hex) {
        var b = el("button", "cb-sw"); b.type = "button"; b.style.background = hex; b.title = hex; b.dataset.key = key; b.dataset.val = hex;
        b.addEventListener("click", function () { opts[key] = hex; update(); });
        wrap.appendChild(b);
      });
      row.appendChild(wrap); side.appendChild(row); return row;
    }

    // Tools: photo suggestion + random.
    var tools = el("div", "cb-tools");
    var file = el("input", "cb-file"); file.type = "file"; file.accept = "image/*"; file.title = "Pick skin and hair colour from a photo";
    var rand = el("button", "cb-opt", "RANDOM"); rand.type = "button";
    tools.appendChild(file); tools.appendChild(rand);
    var toolsRow = el("div", "cb-row"); toolsRow.appendChild(el("span", "cb-label", "PHOTO → COLOURS (OPTIONAL)")); toolsRow.appendChild(tools);
    side.appendChild(toolsRow);

    colorRow("SKIN", "skin", S.COLORS.skin);
    choiceRow("HAIR", "hair", S.HAIR);
    colorRow("HAIR COLOUR", "hairColor", S.COLORS.hair);
    choiceRow("FACE", "facial", S.FACIAL);
    var glassesRow = el("div", "cb-row"); glassesRow.appendChild(el("span", "cb-label", "GLASSES"));
    var gw = el("div", "cb-opts");
    [["OFF", false], ["ON", true]].forEach(function (p) {
      var b = el("button", "cb-opt", p[0]); b.type = "button"; b.dataset.key = "glasses"; b.dataset.val = String(p[1]);
      b.addEventListener("click", function () { opts.glasses = p[1]; update(); }); gw.appendChild(b);
    });
    glassesRow.appendChild(gw); side.appendChild(glassesRow);
    choiceRow("TOP", "top", S.TOPS);
    colorRow("TOP COLOUR", "topColor", S.COLORS.top);
    var shirtRow = colorRow("SHIRT COLOUR", "shirtColor", S.COLORS.shirt);
    var accentRow = colorRow("TIE COLOUR", "accentColor", S.COLORS.accent);
    choiceRow("BOTTOMS", "bottom", S.BOTTOMS);
    colorRow("BOTTOMS COLOUR", "bottomColor", S.COLORS.bottom);
    colorRow("SHOES", "shoesColor", S.COLORS.shoes);

    function update() {
      draw(preview, opts, 10, false, stage);
      side.querySelectorAll("[data-key]").forEach(function (b) {
        var v = opts[b.dataset.key]; b.classList.toggle("on", String(v) === b.dataset.val);
      });
      var hasShirt = opts.top === "jacket" || opts.top === "suit" || opts.top === "hoodie";
      shirtRow.style.display = hasShirt ? "" : "none";
      accentRow.style.display = opts.top === "suit" ? "" : "none";
      if (cfg.onChange) cfg.onChange(api.getOptions());
    }

    function suggestFromFile(f) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function (e) {
          var img = new Image();
          img.onload = function () {
            var c = document.createElement("canvas"); var n = 64; c.width = c.height = n;
            var side_ = Math.min(img.naturalWidth, img.naturalHeight);
            c.getContext("2d").drawImage(img, (img.naturalWidth - side_) / 2, (img.naturalHeight - side_) / 2, side_, side_, 0, 0, n, n);
            var data;
            try { data = c.getContext("2d").getImageData(0, 0, n, n).data; } catch (err) { reject(err); return; }
            var sug = S.suggestColors(data, n, n);
            opts.skin = sug.skin; opts.hairColor = sug.hairColor; update(); resolve(sug);
          };
          img.onerror = reject; img.src = e.target.result;
        };
        reader.onerror = reject; reader.readAsDataURL(f);
      });
    }
    file.addEventListener("change", function (e) { if (e.target.files[0]) suggestFromFile(e.target.files[0]).catch(function () {}); });
    rand.addEventListener("click", function () { opts = S.normalize(S.randomOptions()); update(); });

    var api = {
      getOptions: function () { return JSON.parse(JSON.stringify(opts)); },
      setOptions: function (o) { opts = S.normalize(o); update(); },
      setStage: function (n) { stage = n; update(); },
      randomize: function () { opts = S.normalize(S.randomOptions()); update(); },
      suggestFromFile: suggestFromFile,
      // PNG data URL. scale 1 → 24×24 square with the 15×24 sprite centred (game piece); bigger for downloads.
      getDataURL: function (scale, square) { var c = document.createElement("canvas"); draw(c, opts, scale || 1, square !== false); return c.toDataURL("image/png"); }
    };
    update();
    return api;
  }

  root.CharacterUI = { mount: mount, draw: draw };
})(typeof self !== "undefined" ? self : this);
