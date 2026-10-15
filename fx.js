// Motion and visual effects: page entrances, fade-up reveals, and the sign-in network where points
// flow into one glowing light. Everything stays still for people who ask their device for reduced motion.
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

export function initFx() {}

// Page change: replay the staggered fade-up on <main> (only when the view changes, not on live updates).
let lastView = "";
export function enterView(main, key) {
  if (key === lastView || reduce.matches) return;
  lastView = key;
  main.classList.remove("ld-enter");
  void main.offsetWidth;
  main.classList.add("ld-enter");
  clearTimeout(enterView.t);
  enterView.t = setTimeout(() => main.classList.remove("ld-enter"), 1300);
}

// [data-reveal="key"] fades up when scrolled into view. Keys already shown stay shown after re-renders.
const shown = new Set();
const io = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add("is-in");
      shown.add(e.target.dataset.reveal);
      io.unobserve(e.target);
    }), { threshold: 0.12, rootMargin: "0px 0px -40px 0px" })
  : null;
export function reveal(root) {
  if (io) io.disconnect();
  root.querySelectorAll("[data-reveal]").forEach((el) => {
    if (!io || reduce.matches || shown.has(el.dataset.reveal)) el.classList.add("is-in", "no-anim");
    else io.observe(el);
  });
}

// ----- Constellation -----
// Points on the left, joined by faint curves that run into one glowing light; sparks travel
// along the curves. The layout is seeded so it stays put when the sign-in form re-renders, and the
// draw-in intro plays only once per visit.
let introStart = 0;
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const bez = (c, t) => {
  const u = 1 - t;
  return {
    x: u * u * u * c.a.x + 3 * u * u * t * c.c1.x + 3 * u * t * t * c.c2.x + t * t * t * c.b.x,
    y: u * u * u * c.a.y + 3 * u * u * t * c.c1.y + 3 * u * t * t * c.c2.y + t * t * t * c.b.y
  };
};

export function constellation(canvas) {
  const ctx = canvas.getContext("2d");
  let w = 0, h = 0, orb, nodes = [], curves = [], stars = [], sparks = [];
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  function layout() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = seeded(20260);
    const narrow = w < 900;
    orb = narrow ? { x: w * 0.82, y: h * 0.12 } : { x: w * 0.88, y: h * 0.38 };
    nodes = [];
    const cols = narrow ? 4 : 5, rows = narrow ? 6 : 5;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if (r() < 0.25) continue;
        nodes.push({
          x: w * (0.03 + (narrow ? 0.9 : 0.62) * (i + 0.2 + r() * 0.6) / cols),
          y: h * ((narrow ? 0.3 : 0.08) + (narrow ? 0.68 : 0.86) * (j + 0.2 + r() * 0.6) / rows),
          ph: r() * 6.28
        });
      }
    }
    curves = [];
    nodes.forEach((n) => {
      const k = r() < 0.4 ? 2 : 1;
      for (let m = 0; m < k; m++) {
        const c = {
          a: n, b: orb, hot: r() < 0.3,
          c1: { x: n.x + (orb.x - n.x) * (0.25 + r() * 0.3), y: n.y + (r() - 0.5) * h * 0.55 },
          c2: { x: n.x + (orb.x - n.x) * (0.65 + r() * 0.2), y: orb.y + (r() - 0.5) * h * 0.3 }
        };
        c.pts = Array.from({ length: 49 }, (_, i) => bez(c, i / 48));
        curves.push(c);
      }
    });
    stars = Array.from({ length: Math.round((w * h) / 9000) }, () => ({ x: r() * w, y: r() * h, s: r() * 1.2 + 0.2, ph: r() * 6.28 }));
    sparks = curves.flatMap((c) => Array.from({ length: c.hot ? 2 : 1 }, () => ({ c, t: r(), v: 0.0012 + r() * 0.0026 })));
  }

  function draw(now, still) {
    if (!w) return;
    const p = still ? 1 : Math.min(1, (now - introStart) / 2400);
    const e = 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    ctx.clearRect(0, 0, w, h);

    for (const s of stars) {
      ctx.globalAlpha = 0.12 + 0.22 * (0.5 + 0.5 * Math.sin(now * 0.0012 + s.ph));
      ctx.fillStyle = "#f5f1eb";
      ctx.fillRect(s.x + pointer.x * 4, s.y + pointer.y * 4, s.s, s.s);
    }
    ctx.globalAlpha = 1;

    // Curves draw in from the points toward the light.
    ctx.lineWidth = 1;
    for (const c of curves) {
      const n = Math.max(1, Math.floor(e * 48));
      ctx.beginPath();
      ctx.moveTo(c.pts[0].x, c.pts[0].y);
      for (let i = 1; i <= n; i++) ctx.lineTo(c.pts[i].x, c.pts[i].y);
      ctx.strokeStyle = c.hot ? "rgba(43,212,122,0.34)" : "rgba(201,206,214,0.11)";
      ctx.stroke();
    }

    for (const n of nodes) {
      const a = Math.min(1, e * 1.4);
      ctx.beginPath();
      ctx.arc(n.x, n.y, 4.5, 0, 6.283);
      ctx.fillStyle = `rgba(201,206,214,${0.08 * a})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(n.x, n.y, 2.2 + 0.4 * Math.sin(now * 0.002 + n.ph), 0, 6.283);
      ctx.fillStyle = `rgba(201,206,214,${0.85 * a})`;
      ctx.fill();
    }

    // Sparks travel along the curves once they have drawn in.
    if (p > 0.55) {
      const a = Math.min(1, (p - 0.55) / 0.3);
      for (const s of sparks) {
        if (!still) s.t += s.v;
        if (s.t > 1) s.t -= 1;
        for (let k = 0; k < 4; k++) {
          const q = bez(s.c, Math.max(0, s.t - k * 0.012));
          ctx.beginPath();
          ctx.arc(q.x, q.y, 1.8 - k * 0.35, 0, 6.283);
          ctx.fillStyle = s.c.hot ? `rgba(43,212,122,${a * (0.95 - k * 0.22)})` : `rgba(201,206,214,${a * (0.7 - k * 0.16)})`;
          ctx.fill();
        }
      }
    }

    // The light everything flows into.
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.0022);
    const glow = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, 70 + pulse * 14);
    glow.addColorStop(0, `rgba(85,152,231,${0.55 * e})`);
    glow.addColorStop(0.35, `rgba(85,152,231,${0.18 * e})`);
    glow.addColorStop(1, "rgba(85,152,231,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(orb.x, orb.y, 90, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(orb.x, orb.y, 8 * e, 0, 6.283); ctx.fillStyle = "#5598e7"; ctx.fill();
    ctx.beginPath(); ctx.arc(orb.x, orb.y, 3 * e, 0, 6.283); ctx.fillStyle = "#fff"; ctx.fill();
  }

  layout();
  new ResizeObserver(() => { layout(); if (reduce.matches) draw(0, true); }).observe(canvas);
  if (reduce.matches) return draw(0, true);
  canvas.parentElement.addEventListener("pointermove", (ev) => {
    const b = canvas.getBoundingClientRect();
    pointer.tx = (ev.clientX - b.left) / b.width - 0.5;
    pointer.ty = (ev.clientY - b.top) / b.height - 0.5;
  });
  if (!introStart) introStart = performance.now();
  const loop = (now) => {
    if (!canvas.isConnected) return; // the sign-in page was replaced
    draw(now, false);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
