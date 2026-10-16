// Awardee showcase (sign-in page): circular photos on an accent disc, grayscale at rest; hovering (or tapping)
// reveals the colour photo with an expanding circle, after the "Meet the team" section of lightdrop.com.
// Data: awardees/{id} { name, award, year, line, photo, photo2, cutout, cutout2, order, demo, consent }.

const escH = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const AWARD_NAMES = ["Best Teacher", "Best Non-Teaching Personnel", "Best Class Adviser", "Perfect Attendance"];

// Illustrated stand-ins (transparent background, like the cut-out photos on lightdrop.com) shown until real photos are added.
function face({ skin, hair, shirt, style, smile = true }) {
  const hairBack = style === "long" ? `<path d="M52 92c-4 40 2 70 10 86h76c8-16 14-46 10-86-6-30-90-30-96 0z" fill="${hair}"/>`
    : style === "bun" ? `<circle cx="100" cy="40" r="18" fill="${hair}"/>` : "";
  const hairTop = style === "short" ? `<path d="M62 84c0-30 18-44 38-44s38 14 38 44c-6-12-20-20-38-20s-32 8-38 20z" fill="${hair}"/>`
    : style === "cap" ? `<path d="M60 82c0-28 18-42 40-42s40 14 40 42c-10-8-24-12-40-12s-30 4-40 12z" fill="${hair}"/><rect x="58" y="76" width="84" height="8" rx="4" fill="${hair}"/>`
    : `<path d="M60 92c0-34 18-50 40-50s40 16 40 50c-8-18-22-28-40-28s-32 10-40 28z" fill="${hair}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${hairBack}
    <path d="M30 200c4-34 30-52 70-52s66 18 70 52z" fill="${shirt}"/>
    <path d="M86 132h28v22c-6 6-22 6-28 0z" fill="${skin}" opacity=".92"/>
    <path d="M84 150l16 16 16-16" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="4"/>
    <ellipse cx="100" cy="98" rx="36" ry="42" fill="${skin}"/>
    <ellipse cx="64" cy="100" rx="6" ry="9" fill="${skin}"/><ellipse cx="136" cy="100" rx="6" ry="9" fill="${skin}"/>
    ${hairTop}
    <ellipse cx="86" cy="100" rx="3.6" ry="4.2" fill="#2a1d17"/><ellipse cx="114" cy="100" rx="3.6" ry="4.2" fill="#2a1d17"/>
    <path d="M80 90q6-4 12 0M108 90q6-4 12 0" fill="none" stroke="#2a1d17" stroke-width="2.4" stroke-linecap="round"/>
    <path d="${smile ? "M88 118q12 10 24 0" : "M90 120h20"}" fill="none" stroke="#9c3f33" stroke-width="3" stroke-linecap="round"/>
    <ellipse cx="78" cy="112" rx="6" ry="3.5" fill="#f08a7a" opacity=".35"/><ellipse cx="122" cy="112" rx="6" ry="3.5" fill="#f08a7a" opacity=".35"/>
  </svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace(/\s+/g, " "));
}
export const SAMPLE_AWARDEES = [
  { name: "Rose Aquino", award: "Best Teacher", line: "Learner-centered lessons, early mornings.", look: { skin: "#e0ac85", hair: "#2b1a12", shirt: "#1c5cab", style: "long" } },
  { name: "Jhon Reyes", award: "Best Class Adviser", line: "Home visits, class records, zero dropouts.", look: { skin: "#c98e66", hair: "#1b1410", shirt: "#2bd47a", style: "short" } },
  { name: "Maria Santos", award: "Best Non-Teaching Personnel", line: "Reports on time, smiles all the time.", look: { skin: "#d9a07a", hair: "#3a2418", shirt: "#e8a23a", style: "bun" } },
  { name: "Carmen Lopez", award: "Perfect Attendance", line: "Never late, never absent.", look: { skin: "#f0c09a", hair: "#4a2c1d", shirt: "#c2410c", style: "long" } },
  { name: "Ana Lim", award: "Best Non-Teaching Personnel", line: "Records, receipts, ready answers.", look: { skin: "#eab48e", hair: "#120d0b", shirt: "#7c3aed", style: "short" } },
  { name: "Mark Villanueva", award: "Best Teacher", line: "Action research and robotics club.", look: { skin: "#b9805b", hair: "#22160f", shirt: "#0f766e", style: "cap" } }
].map((a, i) => ({ ...a, id: "sample-" + i, photo: face(a.look), cutout: true, sample: true }));

// One card. Rest layer: grayscale (multiplied onto the disc for ordinary photos); hover layer: colour, revealed by clip-path.
function card(a, i) {
  const hover = a.photo2 || a.photo;
  const cut2 = a.photo2 ? a.cutout2 : a.cutout;
  return `<figure class="aw-card w-full sm:w-[300px] lg:w-[330px]" tabindex="0" data-act="aw-tap" data-reveal="aw-${escH(a.id)}" style="transition-delay:${(i % 3) * 110}ms">
    <div class="aw-disc">
      <img class="aw-rest ${a.cutout ? "" : "aw-blend"}" src="${escH(a.photo)}" alt="" loading="lazy" decoding="async">
      <img class="aw-hover ${cut2 ? "aw-cut" : ""}" src="${escH(hover)}" alt="${escH(a.name)}" loading="lazy" decoding="async">
    </div>
    <figcaption class="mt-7 text-center">
      <div class="aw-name">${escH(a.name)}<span class="aw-dot" aria-hidden="true"></span></div>
      <div class="aw-pill">${escH(a.award)}</div>
      ${a.line ? `<p class="aw-line">${escH(a.line)}</p>` : ""}
    </figcaption>
  </figure>`;
}

// The whole section. `list` is already sorted; `sample` marks the stand-in cards.
export function showcaseHTML(list, { sample = false, title = "Meet last year's awardees.", sub = "" } = {}) {
  if (!list.length) return "";
  return `<section class="aw-section relative px-4 sm:px-[6vw] py-20 sm:py-28 text-[#e9eef6]">
    <div class="max-w-[1180px] mx-auto">
      <div class="text-center">
        <div class="ld-kicker text-[#fc8a63]">BLESS Awarding</div>
        <h2 class="mt-3 font-medium tracking-[-0.02em] text-white text-[clamp(1.9rem,4.4vw,3.4rem)] leading-[1.08]">${escH(title)}</h2>
        ${sub ? `<p class="mt-3 text-sm sm:text-base text-[#9aa3b2]">${escH(sub)}</p>` : ""}
        ${sample ? `<p class="mt-3 inline-flex items-center gap-2 text-xs text-[#9aa3b2]"><span class="aw-sample">Sample</span>Illustrations for now; last year's awardees' photos go here.</p>` : ""}
      </div>
      <div class="mt-14 sm:mt-20 flex flex-wrap justify-center gap-x-10 gap-y-16 sm:gap-y-20">${list.map(card).join("")}</div>
    </div>
  </section>`;
}

// Reads an image file into a square JPEG/WebP data URL (cover crop), small enough for a Firestore document.
// Keeps transparency (WebP) for cut-out photos and reports whether the image has a transparent background.
export function resizePhoto(file, size = 520) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error("Choose an image file (JPG, PNG or WebP)."));
    if (file.size > 15 * 1024 * 1024) return reject(new Error("That image is over 15 MB."));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      // Faces sit in the upper part of portraits, so crop tall images from near the top.
      const sx = (img.naturalWidth - s) / 2, sy = img.naturalHeight > img.naturalWidth ? (img.naturalHeight - s) * 0.18 : 0;
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const g = c.getContext("2d");
      g.drawImage(img, sx, sy, s, s, 0, 0, size, size);
      let cutout = false;
      if (file.type !== "image/jpeg") {
        const d = g.getImageData(0, 0, size, size).data;
        for (const [x, y] of [[2, 2], [size - 3, 2], [2, size / 2], [size - 3, size / 2]]) if (d[(y * size + x) * 4 + 3] < 200) cutout = true;
      }
      let out = cutout ? c.toDataURL("image/webp", 0.86) : "";
      if (!out.startsWith("data:image/webp")) {
        if (cutout) out = c.toDataURL("image/png");
        if (!cutout || out.length > 340000) { // no WebP encoder (older Safari) and too big as PNG: flatten
          const f = document.createElement("canvas"); f.width = f.height = size;
          const fg = f.getContext("2d"); fg.fillStyle = "#ffffff"; fg.fillRect(0, 0, size, size); fg.drawImage(c, 0, 0);
          out = f.toDataURL("image/jpeg", 0.85); cutout = false;
        }
      }
      resolve({ data: out, cutout });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image.")); };
    img.src = url;
  });
}
