/*
  monkey-ui.js — the monkey builder widget.
  MonkeyUI.mount(container, { initial?, onChange? }) renders hair-style
  buttons, three swatch rows (fur, hair, outfit) and a live preview of
  the three stages. Returns { getOptions, setOptions, getDataURL }.
*/
(function () {
  "use strict";
  var STYLE = [
    ".mk { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }",
    "@media (max-width: 760px) { .mk { grid-template-columns: 1fr; } }",
    ".mk .pv { display: flex; gap: 10px; justify-content: center; align-items: flex-end; background: #0c0b1d; border: 3px solid #000; box-shadow: 4px 4px 0 #000; padding: 12px; }",
    ".mk .pv figure { margin: 0; text-align: center; }",
    ".mk .pv canvas { display: block; image-rendering: pixelated; image-rendering: crisp-edges; width: 96px; height: 96px; }",
    ".mk .pv figure.big canvas { width: 150px; height: 150px; }",
    ".mk .pv figcaption { font-family: 'Press Start 2P', monospace; font-size: 7px; color: var(--muted, #b7b0e0); margin-top: 6px; }",
    ".mk .pv figure.big figcaption { color: var(--gold, #ffd23f); font-size: 8px; }",
    ".mk .lbl { font-family: 'Press Start 2P', monospace; font-size: 9px; color: var(--muted, #b7b0e0); margin: 14px 0 8px; display: block; }",
    ".mk .lbl:first-child { margin-top: 0; }",
    ".mk .hairs { display: flex; gap: 8px; flex-wrap: wrap; }",
    ".mk .hairs button { font-family: 'Press Start 2P', monospace; font-size: 8px; padding: 10px 12px; border: 3px solid var(--border, #3a3575); background: var(--panel, #1f1c42); color: var(--ink, #f4f1ff); cursor: pointer; }",
    ".mk .hairs button.on { background: var(--gold, #ffd23f); color: #000; border-color: #000; box-shadow: 3px 3px 0 #000; }",
    ".mk .sw { display: flex; gap: 8px; flex-wrap: wrap; }",
    ".mk .sw button { width: 34px; height: 34px; border: 3px solid #000; cursor: pointer; padding: 0; }",
    ".mk .sw button.on { outline: 3px solid var(--gold, #ffd23f); outline-offset: 1px; }",
    ".mk .rnd { margin-top: 16px; }"
  ].join("\n");

  function mount(container, cfg) {
    cfg = cfg || {};
    if (!document.getElementById("monkey-ui-style")) { var st = document.createElement("style"); st.id = "monkey-ui-style"; st.textContent = STYLE; document.head.appendChild(st); }
    var opts = Object.assign(Monkey.defaultOptions(), cfg.initial && Monkey.isMonkey(cfg.initial) ? cfg.initial : {});
    var goalTypes = cfg.goalTypes || [];
    container.innerHTML =
      '<div class="mk">' +
        '<div class="pv">' +
          '<figure><canvas data-stage="1"></canvas><figcaption>1 ' + Monkey.STAGES[0] + "</figcaption></figure>" +
          '<figure class="big"><canvas data-stage="2"></canvas><figcaption>2 ' + Monkey.STAGES[1] + "</figcaption></figure>" +
          '<figure><canvas data-stage="3"></canvas><figcaption>3 ' + Monkey.STAGES[2] + "</figcaption></figure>" +
        "</div>" +
        "<div>" +
          '<span class="lbl">HAIR</span><div class="hairs" data-hairs></div>' +
          '<span class="lbl">BODY</span><div class="sw" data-sw="fur"></div>' +
          '<span class="lbl">HAIR COLOUR</span><div class="sw" data-sw="hairColor"></div>' +
          '<span class="lbl">OUTFIT</span><div class="sw" data-sw="outfit"></div>' +
          '<div class="rnd"><button type="button" class="btn alt" data-random>🎲 RANDOM</button></div>' +
        "</div>" +
      "</div>";
    var hairs = container.querySelector("[data-hairs]");
    hairs.innerHTML = Monkey.HAIRS.map(function (h) { return '<button type="button" data-hair="' + h.id + '">' + h.label + "</button>"; }).join("");
    var lists = { fur: Monkey.FUR_COLORS, hairColor: Monkey.HAIR_COLORS, outfit: Monkey.OUTFIT_COLORS };
    Object.keys(lists).forEach(function (key) {
      container.querySelector('[data-sw="' + key + '"]').innerHTML = lists[key].map(function (c) {
        return '<button type="button" data-color="' + c + '" style="background:' + c + '" title="' + c + '"></button>';
      }).join("");
    });

    function sync() {
      hairs.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.hair === opts.hair); });
      Object.keys(lists).forEach(function (key) {
        container.querySelectorAll('[data-sw="' + key + '"] button').forEach(function (b) { b.classList.toggle("on", b.dataset.color.toLowerCase() === String(opts[key]).toLowerCase()); });
      });
      container.querySelectorAll("canvas[data-stage]").forEach(function (c) { Monkey.draw(c, opts, +c.dataset.stage, goalTypes); });
      if (cfg.onChange) cfg.onChange(opts);
    }
    container.addEventListener("click", function (e) {
      var h = e.target.closest("[data-hair]"); if (h) { opts.hair = h.dataset.hair; sync(); return; }
      var c = e.target.closest("[data-color]"); if (c) { opts[c.closest("[data-sw]").dataset.sw] = c.dataset.color; sync(); return; }
      if (e.target.closest("[data-random]")) { opts = Monkey.randomOptions(); sync(); }
    });
    sync();
    return {
      getOptions: function () { return Object.assign({}, opts); },
      setOptions: function (o) { opts = Object.assign(Monkey.defaultOptions(), o || {}); sync(); },
      setGoalTypes: function (t) { goalTypes = t || []; sync(); },
      getDataURL: function (px) { return Monkey.dataURL(opts, px || 96); }
    };
  }
  window.MonkeyUI = { mount: mount };
})();
