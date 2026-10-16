// ILAW lesson plan (San Vicente NHS "Daily Lesson Logs | ILAW Format"): the template's parts and rows,
// a built-in draft generator (template-based, no AI), and the printable page.

export const ILAW_HEAD = [
  ["title", "Lesson Title"],
  ["area", "Learning Area/s"],
  ["teachers", "Name of Teacher/s"],
  ["gradeSection", "Grade Level and Section"],
  ["references", "References (books, websites, toolkits, etc.)"],
  ["aiUse", "Declaration of AI use", "Cite how AI was used in the formulation of the lesson plan."]
];

export const ILAW_PARTS = [
  {
    key: "intentions", title: "Intentions.",
    intro: "Meaningful learning experiences are anchored in how we frame them. Start by deciding what you want learners to master by the end of the lesson – keep it clear and simple.\nRemember: Understanding your learners' evolving context and designing around it ensure that your lessons connect with and are relevant to them.",
    rows: [
      ["competency", "Learning Competency and Curriculum Standards:", "Write the competency/ies from the curriculum that we are targeting, and the content or performance standards applicable to the sessions."],
      ["objectives", "Learning Objectives:", "Write the smaller knowledge, skills, or tasks from the competency that the learners will work on and be able to show by the end of the sessions."],
      ["context", "Learner Context:", "Write your observations of your learners, and how they have been performing or responding to learning experiences recently. Include strengths, interests, and possible barriers to learning."]
    ]
  },
  {
    key: "experience", title: "Learning Experience.",
    intro: "A learning experience is like a thoughtfully designed journey. Each activity and interaction builds towards meaningful understanding and growth. Identify activities and interactions to help learners gain knowledge, skills, or understanding in a purposeful way.",
    rows: [
      ["prelesson", "Pre-Lesson:", "Describe how you will help the learners get ready for the lesson."],
      ["flow", "Flow:", "Describe the activities that you can implement in 1 or more sessions to meet the learning objectives.\nApply the Learning Design Principles by thinking about how to:\n• make the objectives clear for the learners\n• guide learners before letting them try the task on their own\n• check the state of the learners' well-being, understanding, and mastery over the lesson\n• connect today's new concepts to past competencies\n• encourage collaboration among learners\n• invite learners to reflect on why this matters to them\n• ensure inclusion for learners' varied abilities, learning styles, and contexts"],
      ["resources", "Learning Resources:", "List down the learning resources that will help you reach your objectives. Ensure that they are available and inclusive.\nInclude options and alternatives in case of emergencies."],
      ["integration", "Opportunities for integration:", "Write down any possibilities to meaningfully integrate another learning area, special topic, or technology. Write N/A if none."]
    ]
  },
  {
    key: "assessment", title: "Assessment.",
    intro: "Assessments reveal what learners have gained and what they still need help with. These are helpful in providing you with information to guide your future instruction throughout the entire session.",
    rows: [
      ["formative", "Formative Assessment:", "Create a task, activity or questions to evaluate learning and provide feedback every now and then. Include ways for learners to ask for guidance or support throughout each session.\nRemember to provide appropriate accommodations so all learners can demonstrate their understanding (e.g., varied response formats, small group options, visual or auditory supports)."]
    ]
  },
  {
    key: "forward", title: "Ways Forward.",
    intro: "Meaningful learning can also happen beyond the classroom – for both the learners and the teacher.\nPause and reflect on what happened today.",
    rows: [
      ["extended", "Extended learning opportunities:", "Suggest other learning experiences outside the classroom/class hours that learners may want to access to reinforce what they have learned, to spark their curiosities further, or that may provide them support in their areas of difficulty."],
      ["reflections", "Reflections:", "Think about what you need to change for the next session based on what happened today. Is there something the learners are interested in exploring?\nAre there some things you would like to share with your co-teachers, parents, or school leaders about your classroom experience? What would you like your instructional coach to help you with?"]
    ]
  }
];

// Every row of a plan: the template's rows, plus the teacher's own rows (custom: [{ id, part, label }]).
export function planRows(plan) {
  return ILAW_PARTS.map((part) => ({
    ...part,
    rows: [
      ...part.rows.map(([key, label, help]) => ({ key, label, help })),
      ...(plan.custom || []).filter((c) => c.part === part.key).map((c) => ({ key: c.id, label: c.label, help: "", custom: true }))
    ]
  }));
}

export function blankPlan() {
  return { title: "", area: "", teachers: "", gradeSection: "", references: "", aiUse: "", sessions: ["Session 1"], cells: {}, custom: [] };
}

// ---------- Draft generator ----------
const RESOURCES = {
  Science: "Science Learner's Material / textbook for the grade level\nLaboratory or improvised materials for the activity\nActivity sheets and a rubric\nTV/projector with slides or a short video",
  Math: "Mathematics Learner's Material / textbook\nManipulatives, grid or graphing paper, calculators\nActivity sheets with worked examples\nTV/projector with slides",
  English: "Reading text(s) and printed copies for every learner\nDictionary and a vocabulary chart\nAudio or video clip\nActivity sheets and a rubric",
  Filipino: "Babasahin o teksto at kopya para sa bawat mag-aaral\nDiksiyonaryo at talahuluganan\nLarawan, audio o video clip\nActivity sheets at rubrik",
  "Araling Panlipunan": "Araling Panlipunan textbook\nMaps, timelines, pictures or primary sources\nNews articles or short documentaries\nActivity sheets and a rubric",
  TLE: "Tools, equipment and materials for the task\nPersonal protective equipment and safety rules\nProcedure / job sheet and sample output\nScoring rubric",
  "Values Education": "Short story, case or video clip\nSituational cards and reflection sheets\nManila paper and markers for group work",
  MAPEH: "Audio player / speaker and music or video clips\nVisuals, art materials or sports equipment for the activity\nOpen space for movement\nRubric for the performance"
};
const INTEGRATION = {
  Science: "Mathematics (measuring, data and graphs), English (writing observations), ICT (online simulations), environmental awareness.",
  Math: "Science (data from experiments), Araling Panlipunan (statistics about the community), financial literacy, ICT (spreadsheets).",
  English: "Values Education (themes of the text), Araling Panlipunan (cultural context), ICT (online dictionaries, presentations).",
  Filipino: "Araling Panlipunan (kultura at kasaysayan), Values Education (aral ng akda), ICT (presentasyon).",
  "Araling Panlipunan": "English/Filipino (reading and writing), Mathematics (statistics, timelines), Values Education (citizenship).",
  TLE: "Mathematics (measurement, costing), Science (safety and materials), entrepreneurship.",
  "Values Education": "Araling Panlipunan (community issues), English/Filipino (reflection writing), DRRM and health topics.",
  MAPEH: "Science (the body and movement), Araling Panlipunan (culture and arts), Values Education (sportsmanship)."
};

function stageOf(i, n) {
  if (n === 1) return "full";
  if (i === 0) return "explore";
  if (i === n - 1) return "apply";
  return "deepen";
}

// input: { title, area, gradeSection, competency, sessions (count), focus: [one line per session], context, teacher }
export function generatePlan(input) {
  const T = (input.title || "the lesson").trim();
  const C = (input.competency || "").trim();
  const area = (input.area || "").trim();
  const G = (input.gradeSection || "").trim();
  const n = Math.max(1, Math.min(10, Number(input.sessions) || 1));
  const focus = (input.focus || []).map((x) => String(x || "").trim());
  const grade = (G.match(/\d{1,2}/) || [""])[0];
  const learners = grade ? `Grade ${grade} learners` : "The learners";
  const sessions = Array.from({ length: n }, (_, i) => `Session ${i + 1}`);
  const cells = {};
  const put = (key, fn) => { cells[key] = sessions.map((_, i) => fn(i, stageOf(i, n), focus[i] ? `Focus: ${focus[i]}\n` : "")); };

  const standards = /standard/i.test(C) ? "" :
    `\nContent Standard: The learners demonstrate understanding of ${T}.\nPerformance Standard: The learners are able to apply their understanding of ${T} in meaningful, real-life situations.`;
  put("competency", () => `${C || `Most essential learning competency on ${T}.`}${standards}`);

  put("objectives", (i, st, f) => f + "At the end of the session, the learners are able to:\n" + {
    explore: `a. identify the key ideas and terms of ${T};\nb. describe examples of ${T} in their daily lives; and\nc. show curiosity by asking questions about ${T}.`,
    deepen: `a. explain the important concepts and processes of ${T};\nb. complete guided and independent tasks on ${T} accurately; and\nc. value accuracy and cooperation while working with others.`,
    apply: `a. apply ${T} to a real-life problem or situation;\nb. create an output (project, presentation or written work) that shows their understanding of ${T}; and\nc. reflect on why ${T} matters to them and their community.`,
    full: `a. explain the key ideas of ${T};\nb. apply ${T} to a real-life situation through a short task; and\nc. reflect on why ${T} matters to them.`
  }[st]);

  put("context", () => (input.context || "").trim() ||
    `${learners} are generally active and participative. Some need more time with reading and abstract ideas, while others are ready for more challenging tasks. Most enjoy group work, visuals and real-life examples. (Edit this with your own observations of the class.)`);

  put("prelesson", (i, st) => ({
    explore: `• Greet the learners, check attendance and their readiness (mood check).\n• Review the previous lesson with 3 quick questions.\n• Motivation: show a picture or short clip related to ${T} and ask, "What do you notice? What do you wonder?"\n• Present the session's objectives in simple words.`,
    deepen: `• Recall the key ideas of Session ${i} through a quick Think-Pair-Share.\n• Answer questions left from the previous session.\n• Present today's objectives and how they build on the last session.`,
    apply: `• Review the key concepts through a short game (e.g., "Pass the Question").\n• Introduce the real-life task and show its success criteria / rubric.`,
    full: `• Greet the learners and check attendance and readiness.\n• Quick review of prior knowledge related to ${T}.\n• Motivation: a picture, question or short clip about ${T}.\n• Present the objectives in simple words.`
  }[st]));

  put("flow", (i, st) => ({
    explore: `1. Activity (10 min): In small groups, learners explore ${T} using an activity sheet or hands-on materials.\n2. Analysis (10 min): Groups share what they found; guide questions help them notice patterns.\n3. Abstraction (15 min): The teacher discusses the key concepts of ${T} with examples and connects them to past lessons.\n4. Guided practice (10 min): Learners try 2–3 items with teacher support before working on their own.\n5. Wrap-up (5 min): Each learner shares one thing learned and one question they still have.`,
    deepen: `1. Modeling (10 min): The teacher works through an example on ${T}, thinking aloud.\n2. Guided practice (15 min): Pairs complete similar tasks while the teacher moves around to help.\n3. Independent practice (10 min): Differentiated tasks (basic, average, advanced) so every learner is challenged.\n4. Processing (10 min): Learners share answers; misconceptions are corrected together.\n5. Generalization (5 min): Learners state the big idea of the session in their own words.`,
    apply: `1. Task briefing (5 min): Present a real-life scenario that needs ${T}.\n2. Group work (20 min): Groups with assigned roles plan and produce their output; support is given to groups who need it.\n3. Presentation (15 min): Gallery walk or short reporting with peer feedback using the rubric.\n4. Synthesis (5 min): Connect ${T} to daily life and to the next lessons.\n5. Reflection (5 min): Exit journal: "Why does this matter to me?"`,
    full: `1. Activity (10 min): Group exploration of ${T} with an activity sheet.\n2. Discussion (15 min): Key concepts of ${T} with examples, linked to past lessons.\n3. Practice (10 min): Guided, then independent tasks.\n4. Application (10 min): A short real-life task in pairs or groups.\n5. Reflection (5 min): Learners share why ${T} matters to them.`
  }[st]));

  put("resources", () => `${RESOURCES[area] || "Learner's Material / textbook\nActivity sheets and a rubric\nTV/projector with slides or a short video"}\nAlternative: printed visuals, board work and manila paper in case of power interruption.`);
  put("integration", () => INTEGRATION[area] || "ICT (presentations or online resources) and values integration (cooperation, respect). Write N/A if none.");

  put("formative", (i, st) => ({
    explore: `• Quick check: a 3–5 item oral or written quiz on the key terms of ${T}.\n• Self-assessment: thumbs up / sideways / down.\n• Learners may raise a "help card" anytime to ask for support.\n• Accommodations: oral answers or drawings allowed; pair learners who need reading support.`,
    deepen: `• Exit ticket with 3 items (easy, average, challenging) on ${T}; feedback is given at the start of the next session.\n• Observation checklist during pair work.\n• Accommodations: fewer items or extra time, visual aids, small-group help.`,
    apply: `• Performance task on ${T} scored with a rubric (content 40%, creativity 30%, cooperation 30%).\n• Peer and self-assessment using the same rubric.\n• Accommodations: varied output formats (poster, oral, written) and a small-group option.`,
    full: `• Short quiz or exit ticket on ${T} with feedback.\n• Observation of group work using a checklist.\n• Accommodations: varied response formats, extra time, small-group support.`
  }[st]));

  put("extended", (i, st) => ({
    explore: `Read a page or watch a short video about ${T} at home and list two examples seen in daily life.`,
    deepen: `Answer 5 practice items on ${T}. Learners who need support may join a short remediation session before the next class.`,
    apply: `Share the output with family and write a short paragraph on how ${T} can help the community.`,
    full: `Find two real-life examples of ${T} at home or in the community and be ready to share them.`
  }[st]));

  put("reflections", (i) => `To be completed after Session ${i + 1}:\n• What worked well, and what should change for the next session?\n• How many learners reached the objectives? ___ of ___\n• What are the learners interested in exploring further?\n• What would I like to share with co-teachers, parents or my instructional coach?`);

  return {
    title: input.title || "",
    area,
    teachers: input.teacher || "",
    gradeSection: G,
    references: `Department of Education. ${area || "Learning area"} Learner's Material${grade ? ` (Grade ${grade})` : ""}.\nMost Essential Learning Competencies (MELCs) / Curriculum Guide in ${area || "the learning area"}.\n(Add the books, websites or toolkits you used.)`,
    aiUse: "First draft prepared with the BLESS PRAISE Portal's built-in ILAW draft generator (template-based, no generative AI), then reviewed and edited by the teacher.",
    sessions,
    cells,
    custom: []
  };
}

// ---------- Printable page ----------
export function ilawPrint(plan, { esc, baseUrl, checkedBy }) {
  const p = (t) => esc(t || "").replace(/\n/g, "<br>");
  const n = (plan.sessions || []).length || 1;
  const head = `<table class="hd">${ILAW_HEAD.map(([k, label, help]) =>
    `<tr><th>${label}${help ? `<br><span class="g">${help}</span>` : ""}</th><td>${p(plan[k])}</td></tr>`).join("")}
    <tr><th>No. of Sessions</th><td>${n}</td></tr></table>`;
  const parts = planRows(plan).map((part) => `<table class="pt">
    <tr class="ph"><th>${part.title}</th><td colspan="${n}">${p(part.intro)}</td></tr>
    <tr class="sh"><th></th>${(plan.sessions || []).map((s) => `<th>${esc(s)}</th>`).join("")}</tr>
    ${part.rows.map((r) => `<tr><th class="rl">${esc(r.label)}${r.help ? `<br><span class="g">${p(r.help)}</span>` : ""}</th>
      ${(plan.sessions || []).map((_, i) => `<td>${p(((plan.cells || {})[r.key] || [])[i])}</td>`).join("")}</tr>`).join("")}
  </table>`).join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ILAW · ${esc(plan.title || "Lesson plan")}</title><link rel="icon" href="${baseUrl}logo.png">
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #e2e8f0; font: 12px Arial, Helvetica, sans-serif; color: #000; }
  .toolbar { position: sticky; top: 0; background: #0d2342; color: #fff; padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
  .toolbar button { font: 700 13px Arial; border: 0; border-radius: 8px; padding: 9px 16px; cursor: pointer; background: #f5b400; color: #0d2342; }
  .page { width: 273mm; max-width: 100%; margin: 16px auto; background: #fff; padding: 12mm; box-shadow: 0 4px 24px rgba(0,0,0,.15); }
  .gov { text-align: center; font-weight: 700; line-height: 1.35; border-bottom: 2px solid #000; padding-bottom: 6px; }
  .doc { text-align: center; font: 700 13px Georgia, serif; margin: 12px 0 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #555; padding: 6px 8px; vertical-align: top; text-align: left; }
  .hd th { width: 32%; }
  .pt { table-layout: fixed; }
  .pt th:first-child, .pt .rl { width: 26%; font-weight: 400; }
  .ph th, .ph td { background: #d9d9d9; }
  .pt .ph th { font-weight: 700; }
  .sh th { text-align: center; font-weight: 700; }
  .g { font-weight: 400; color: #333; }
  .rl { font-weight: 400; }
  .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 40mm; margin-top: 18mm; font-weight: 700; }
  .line { margin-top: 12mm; border-top: 1px solid #000; width: 60mm; padding-top: 2px; }
  .nm { margin-top: 10mm; text-transform: uppercase; }
  @media print { body { background: #fff; } .toolbar { display: none; } .page { margin: 0; box-shadow: none; width: auto; padding: 0; } }
</style></head><body>
<div class="toolbar"><span><b>ILAW</b> · ${esc(plan.title || "")}</span><button onclick="window.print()">Print / Save as PDF</button></div>
<main class="page">
  <div class="gov">Republic of the Philippines<br>Department of Education<br>Region XI<br>PANABO CITY DIVISION<br>SAN VICENTE NATIONAL HIGH SCHOOL</div>
  <div class="doc">DAILY LESSON LOGS | ILAW Format</div>
  ${head}
  ${parts}
  <div class="sigs">
    <div>Prepared by:<div class="nm">${esc(plan.name || plan.teachers || "")}</div><div class="line">Teacher</div></div>
    <div>Checked by:<div class="nm">${esc(checkedBy || "")}</div><div class="line">Master Teacher</div></div>
  </div>
</main></body></html>`;
}
