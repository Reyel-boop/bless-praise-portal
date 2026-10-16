// Activity design and search guidelines (Teachers' Month Culmination 2026 - BLESS Awarding), shown in the Guidelines tab.
// Text follows the school's activity design draft; edit here when the committee revises it.

const p = (t) => `<p class="text-sm text-slate-700 leading-relaxed">${t}</p>`;
const ul = (items) => `<ul class="list-disc pl-5 space-y-1 text-sm text-slate-700">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const h4 = (t) => `<h4 class="text-sm font-bold text-slate-900 mt-2">${t}</h4>`;
const note = (label, t) => `<p class="text-sm text-slate-700 leading-relaxed"><strong class="text-slate-900">${label}</strong> ${t}</p>`;
// Rows of plain cells (head null = no header row); a row whose first cell starts with "Total" is bolded.
function table(head, rows, opts = {}) {
  const num = opts.num || [];
  const cell = (c, i, tag) => `<${tag} class="px-3 py-2 align-top ${!head && i === 0 ? "w-36 font-semibold text-slate-900" : ""} ${num.includes(i) ? "text-right tabular" : ""}">${c}</${tag}>`;
  return `<div class="overflow-x-auto rounded-lg border border-slate-200"><table class="w-full min-w-[560px] text-sm">
    ${head ? `<thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 text-left"><tr>${head.map((h, i) => cell(h, i, "th")).join("")}</tr></thead>` : ""}
    <tbody class="divide-y divide-slate-100 text-slate-700">${rows.map((r) => `<tr class="${/^Total/.test(r[0]) ? "font-bold text-slate-900 bg-slate-50" : ""}">${r.map((c, i) => cell(c, i, "td")).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}
const criteria = (rows) => table(["Criterion", "Pts", "Scoring guide", "MOVs"], rows, { num: [1] });

export const GUIDE_TITLE = "Teachers' Month Culmination 2026 – BLESS Awarding";

export const GUIDE_SECTIONS = [
  { id: "about", title: "Activity design", body: `
    ${table(null, [
      ["Title", GUIDE_TITLE],
      ["Place", "San Vicente National High School"],
      ["Date", "October 2, 2026"],
      ["Participants", "BLESS Coordinator and Associates, Teachers, Non-Teaching Personnel, SSLG Officers, and Students"]
    ])}
    ${h4("Description")}
    ${p("The Teachers' Month Culmination 2026 – BLESS Awarding is the closing highlight of the Teachers' Month Celebration, dedicated to formally recognizing outstanding teachers and personnel of San Vicente National High School. Through the BLESS Awarding, employees who have shown exemplary service, innovation, and initiative are identified, selected, and honored on a monthly and termly basis. The activity also institutionalizes on-the-spot recognition and a formal awards ceremony, promoting a values-driven and learner-centered culture of work performance across the school.")}
    ${h4("Rationale")}
    ${p("The Teachers' Month Culmination marks the close of a month-long celebration honoring the vital role of educators in shaping the minds and futures of learners. Beyond imparting academic knowledge, teachers and school personnel model the values, commitment, and service that learners carry into their own lives. Recognizing this work in a meaningful and timely way is essential to sustaining their motivation.")}
    ${p("The BLESS Awarding provides a structured avenue for recognition. By identifying, selecting, and rewarding outstanding employees on a monthly and termly basis, the school ensures that exemplary performance, innovations, and initiatives do not go unnoticed. Awards are grounded in values-driven and learner-centered criteria, reinforcing the kind of service that directly benefits students.")}
    ${p("Through both on-the-spot recognition and a formal awards ceremony, the activity seeks to make appreciation a regular part of school culture rather than a once-a-year event. This helps teachers and personnel feel valued, encourages healthy excellence among colleagues, and strengthens the school's commitment to quality education.")}
    ${h4("Objectives")}
    ${ul([
      "Identify, select, and reward outstanding employees on a monthly and termly basis.",
      "Encourage and highlight innovations, initiatives, and exemplary service among personnel.",
      "Promote a values-driven and learner-centered approach to work performance.",
      "Institutionalize on-the-spot recognition and formal awards ceremonies."
    ])}` },

  { id: "bases", title: "A. Rationale and legal bases", body: `
    ${p("The school conducts an annual search for its Best Teacher, Best Non-Teaching Personnel, and Best Class Adviser to recognize employees whose performance, character and service go beyond the standard. The search is carried out through the BLESS program, and winners are awarded during the Teachers' Month Culmination – BLESS Awarding. Winners are also the school's nominees to division-level searches.")}
    ${p("These guidelines are anchored on:")}
    ${ul([
      "DepEd Order No. 78, s. 2007 — Strengthening the Program on Awards and Incentives for Service Excellence (PRAISE)",
      "CSC Memorandum Circular No. 1, s. 2001 — Revised Policies on Employee Suggestions and Incentive Awards System",
      "Philippine Professional Standards for Teachers (PPST) and the Results-Based Performance Management System (RPMS) for teachers",
      "Strategic Performance Management System (SPMS) / IPCR for non-teaching personnel",
      "Republic Act No. 6713 — Code of Conduct and Ethical Standards for Public Officials and Employees"
    ])}` },

  { id: "objectives", title: "B. Objectives of the search", body: `
    ${p("The search aims to:")}
    ${ul([
      "Recognize teaching and non-teaching personnel who show exemplary performance, integrity and service.",
      "Motivate all personnel to exceed their performance targets.",
      "Promote a culture of excellence, innovation and collaboration in the school.",
      "Identify the school's official nominees for division, regional and national searches.",
      "Provide a fair, transparent and evidence-based selection process."
    ])}` },

  { id: "categories", title: "C. Award categories and coverage period", body: `
    ${p("Three awards are given each school year, one winner per category. Performance is rated on the immediately preceding school year (e.g., SY 2025–2026 for the search conducted in SY 2026–2027).")}
    ${table(["Award", "Who is covered", "Winners"], [
      ["Best Teacher", "Kindergarten, elementary, JHS, SHS, SPED and ALS teachers; Master Teachers; teachers with ancillary designations (coordinators, advisers)", "1 (school may add Elementary/Secondary sub-categories if both levels exist)"],
      ["Best Non-Teaching Personnel", "Administrative Officers, Administrative Assistants/Aides, clerks, registrars, bookkeepers, disbursing officers, guidance staff, nurses, librarians, security and utility personnel", "1"],
      ["Best Class Adviser", "Teachers with an official class advisory for the whole rating period", "1"]
    ])}
    ${p("The School Head is not a candidate. Job-order and contract-of-service workers may be given a separate Special Recognition at the committee's discretion, since PRAISE covers plantilla personnel.")}` },

  { id: "committee", title: "D. School PRAISE / Search Committee", body: `
    ${p("The School Head constitutes the committee through a school memorandum at least one month before the search. The BLESS Coordinator and Associates assist the committee in the preparation and conduct of the awarding.")}
    ${table(["Role", "Member"], [
      ["Chairperson", "Assistant School Principal or most senior Head Teacher / Master Teacher"],
      ["Vice-Chairperson", "Head Teacher / Department Head"],
      ["Members", "1 Master Teacher; 1 teacher representative elected by the faculty; 1 non-teaching representative elected by the staff; Faculty Club / union president; PTA representative"],
      ["Secretariat", "Administrative Officer or designated staff"]
    ])}
    ${h4("Functions")}
    ${ul([
      "Disseminate these guidelines and the call for nominations.",
      "Receive, screen and validate nominations and MOV portfolios.",
      "Conduct classroom observation, office observation, interview and stakeholder feedback.",
      "Rate candidates using the rating sheets and deliberate on results.",
      "Recommend the winners to the School Head for approval.",
      "Keep all rating sheets and minutes on file for at least one year."
    ])}
    ${note("Conflict of interest.", "A member who is a nominee, or is related to a nominee within the fourth degree of consanguinity or affinity, inhibits from rating that category and is replaced by an alternate named by the School Head.")}` },

  { id: "eligibility", title: "E. Eligibility and disqualification", body: `
    ${p("A nominee must meet all of the following (nominees for Best Class Adviser follow the Best Teacher requirements):")}
    ${table(["Requirement", "Best Teacher", "Best Non-Teaching Personnel"], [
      ["Employment status", "Permanent, plantilla position", "Permanent, plantilla position"],
      ["Length of service in the school", "At least 3 continuous years", "At least 3 continuous years"],
      ["Latest performance rating", "Outstanding in RPMS/IPCRF (4.500–5.000) for the rating period", "Outstanding in SPMS/IPCR for the rating period"],
      ["Attendance", "No unauthorized absences or habitual tardiness in the rating period", "Same"],
      ["Administrative record", "No pending or decided administrative or criminal case", "Same"],
      ["Previous win", "Not a Best Teacher winner in the last 2 school years", "Not a Best Non-Teaching winner in the last 2 school years"]
    ])}
    ${h4("Grounds for disqualification (at any stage)")}
    ${ul([
      "Submitting falsified, borrowed or tampered MOVs",
      "Campaigning, lobbying or pressuring committee members or raters",
      "A formal complaint found to have basis during the search period",
      "Failure to submit the complete portfolio by the deadline"
    ])}
    ${note("Nomination.", "A candidate may be nominated by the School Head, a Head Teacher/Department Head, co-employees (at least 5 signatures), or the PTA. Self-nomination is allowed with the endorsement of the immediate supervisor.")}` },

  { id: "teacher", title: "F. Best Teacher — criteria, points and MOVs", body: `
    ${p("Candidates are rated on 7 criteria worth 100 points. Only MOVs dated within the rating period are counted.")}
    ${criteria([
      ["A. Classroom observation", "20", "Based on classroom observation percentage (e.g., 90% = 18 pts)", "Classroom observation rating sheet; classroom setting"],
      ["B. Learner outcomes", "25", "MPS: 90% and above 25, 85–89% 21, 80–84% 17, 75–79% 13, below 75% 9", "MPS (from MTs)"],
      ["C. Innovation", "15", "School 5, Division 10, Region and higher 15", "Proposal, implementation report, photos (Ma'am Junnite)"],
      ["D. Action research", "10", "Completed 5, Presented 8, Funded/used 10", "Research paper, certificate (Ma'am Junnite)"],
      ["E. Trainings", "10", "School 1, Division 2, Region 3, National 4; double if speaker (max 10)", "Certificates"],
      ["F. Special assignments", "10", "2 points each (max 10)", "Designation orders / memos"],
      ["G. Lesson material", "10", "Complete and updated 10, mostly complete 7, incomplete 4", "Lesson plan"],
      ["Total", "100", "", ""]
    ])}
    ${note("Notes on MOVs.", "The same document is counted only once, under the criterion where it gives the most points. A certificate without a date or signatory is not counted.")}` },

  { id: "nonteaching", title: "G. Best Non-Teaching Personnel — criteria, points and MOVs", body: `
    ${p("Candidates are rated on 7 criteria worth 100 points, weighted toward quality of service to learners, teachers and the public.")}
    ${criteria([
      ["A. Work observation", "20", "Based on work observation percentage (e.g., 90% = 18 pts)", "Observation rating sheet"],
      ["B. Client satisfaction", "20", "Outstanding 20, Very Satisfactory 16, Satisfactory 12", "CSM forms and summary"],
      ["C. Timely reports", "10", "On time 10, minor delays 6, frequent delays 3", "Receiving copies of reports"],
      ["D. Initiatives", "15", "School 5, Division 10, Region and higher 15", "Proposal, photos, certification"],
      ["E. Trainings", "10", "School 1, Division 2, Region 3, National 4; double if speaker (max 10)", "Certificates"],
      ["F. Support to school programs", "15", "3 points each (max 15)", "Designation orders / memos, photos"],
      ["G. Attendance", "10", "No tardiness 10, up to 3 tardy 7, 4–10 tardy 4", "DTR"],
      ["Total", "100", "", ""]
    ])}
    ${note("Adjustment by position.", "For security and utility personnel, B and C may be rated from teacher and School Head feedback and from logbooks, maintenance records or incident reports instead of CSM forms and reports.")}` },

  { id: "adviser", title: "H. Best Class Adviser — criteria, points and MOVs", body: `
    ${p("Candidates are rated on 6 criteria worth 100 points. The nominee must have handled the same class for the whole rating period.")}
    ${criteria([
      ["A. Class records and school forms", "20", "Complete and on time 20, complete but late 15, incomplete 10", "SF1, SF2, SF9 (report cards), SF10; certification from School Head"],
      ["B. Parent–adviser meetings", "20", "2 or more meetings held 20, 1 meeting 10", "Minutes of the meeting (2 meetings), attendance sheets, photos"],
      ["C. Learner attendance and retention", "15", "No dropout 15, 1 dropout 10, 2 or more 5", "SF2, SF4"],
      ["D. Learner welfare and guidance", "15", "3 points per home visit, intervention or referral (max 15)", "Anecdotal records, home visitation forms, referral forms"],
      ["E. Most Clean Classroom", "15", "Average of cleanliness inspections: Most clean (rank 1) 15, Very clean 12, Clean 9", "Cleanliness inspection rating sheets, certificate as Most Clean Classroom, photos"],
      ["F. Class achievements", "15", "3 points per class or learner award (max 15)", "Certificates, school memos"],
      ["Total", "100", "", ""]
    ])}` },

  { id: "process", title: "I. Selection process, timeline and tie-breaking", body: `
    ${p("The search runs about 8 weeks, from the call for nominations to the awarding at the Teachers' Month Culmination – BLESS Awarding on October 2, 2026. The detailed schedule of activities is in the Activity Matrix.")}
    ${table(["Activity", "Suggested schedule", "Responsible"], [
      ["Issue school memo, orient personnel on guidelines", "Week 1", "School Head, Committee"],
      ["Nomination period", "Weeks 1–2", "Nominators"],
      ["Submission of MOV portfolios", "End of Week 3", "Nominees"],
      ["Screening; posting of qualified nominees", "Week 4", "Committee, Secretariat"],
      ["Classroom/work observation, interview, stakeholder feedback", "Weeks 5–6", "Committee"],
      ["Rating, deliberation, recommendation", "Week 7", "Committee"],
      ["Posting of results; appeals window (3 working days)", "Week 7", "Secretariat"],
      ["Awarding at the Teachers' Month Culmination – BLESS Awarding (October 2, 2026)", "Week 8", "School Head, BLESS Coordinator and Associates"]
    ])}
    ${h4("Rating rules")}
    ${ul([
      "Each committee member rates independently. The final score is the average of all members' ratings, to two decimal places.",
      "A candidate needs at least 85 points to be declared winner. If no one reaches 85, no award is given for that category.",
      "Results of deliberation are recorded in minutes signed by all members."
    ])}
    ${note("Tie-breaking, in order:", "(1) higher score in Criterion A; (2) higher score in Criterion B; (3) majority vote of the committee.")}` },

  { id: "portfolio", title: "J. MOV portfolio submission rules", body: `
    ${p("Each nominee submits one portfolio (printed in a plain folder, or one PDF/Google Drive folder if the committee allows) arranged in this order:")}
    ${ul([
      "Cover page — name, position, award category, school year",
      "Nomination form (Annex A) with endorsement",
      "Personal Data Sheet (CSC Form 212) and service record",
      "Certification of no pending administrative case (from the School Head / SDO)",
      "Self-rating summary sheet (Annex B) showing claimed points per criterion",
      "Tabbed dividers per criterion (A to G for Best Teacher, A to G for Best Non-Teaching Personnel, A to F for Best Class Adviser), with MOVs in the order of the scoring table"
    ])}
    ${h4("MOV standards")}
    ${ul([
      "Photocopies are marked “Certified True Copy” and signed by the School Head or custodian; originals are presented on request.",
      "Photos have a caption stating the activity, date and place, with at most 4 photos per page.",
      "Each MOV is labeled with the criterion it supports (e.g., “C1-a”).",
      "Documents outside the rating period, undated, or unsigned are not counted.",
      "The committee may validate any MOV by calling the issuing office or inspecting the original.",
      "Late or incomplete portfolios are not accepted."
    ])}
    ${p("Portfolios are returned after the awarding, except copies kept on file by the Secretariat.")}` },

  { id: "awards", title: "K. Awards, appeals and annexes", body: `
    ${note("Awards.", "Each winner receives a token and a Certificate of Recognition in a certificate holder, signed by the School Head, during the Teachers' Month Culmination – BLESS Awarding, and is endorsed as the school's nominee to the division search. Other finalists receive a Certificate of Merit. Personnel given on-the-spot recognition during Teachers' Month also receive a certificate. Awards are charged against the approved budget in the Estimated Expenditures and follow accounting and auditing rules.")}
    ${note("Appeals.", "A nominee may file a written appeal with the Chairperson within 3 working days after results are posted, stating the specific criterion and the MOV in question. The committee resolves it within 5 working days; its decision, approved by the School Head, is final at school level.")}
    ${note("Effectivity.", "These guidelines take effect upon issuance of the school memorandum and remain in force until revised.")}
    ${h4("Annex A — Nomination Form")}
    ${table(["Field", "Entry"], [
      ["Name of nominee", ""], ["Position / Designation", ""],
      ["Award category", "Best Teacher / Best Non-Teaching Personnel / Best Class Adviser"],
      ["Years in the school", ""], ["Latest performance rating", ""], ["Reason for nomination (max 150 words)", ""],
      ["Nominated by (name and signature)", ""], ["Endorsed by immediate supervisor", ""]
    ])}
    ${h4("Annex B — Rating Summary Sheet")}
    ${table(["Criterion", "Max points", "Self-rating", "Committee rating", "Remarks"], [..."ABCDEFG".split("").map((c) => [c, "", "", "", ""]), ["Total", "100", "", "", ""]])}
    ${h4("Annex C — Stakeholder Feedback Form (5 = Always, 1 = Never)")}
    ${table(["Statement", "5", "4", "3", "2", "1"], ["Is courteous and approachable", "Is punctual and reliable in duties", "Delivers quality work / teaching",
      "Works well with others", "Shows honesty and integrity", "Goes beyond what is required"].map((s) => [s, "", "", "", "", ""]))}` },

  { id: "matrix", title: "Activity matrix", body: table(["Activity", "Time frame", "Persons involved", "Resources needed", "Expected output"], [
    ["Issuance of school memo creating the School PRAISE / Search Committee; orientation of personnel on the guidelines", "Week 1", "School Head, Search Committee, BLESS Coordinator and Associates", "School memo, copies of the guidelines", "Personnel oriented on the search"],
    ["Call for and submission of nominations", "Weeks 1–2", "School Head, Head Teachers / Department Heads, co-employees, PTA", "Nomination Form (Annex A)", "Nominations received for the three award categories"],
    ["Submission of MOV portfolios", "End of Week 3", "Nominees", "Portfolio, Rating Summary Sheet (Annex B)", "Complete MOV portfolios"],
    ["Screening for eligibility; posting of qualified nominees", "Week 4", "Search Committee, Secretariat", "Eligibility requirements, nomination forms", "List of qualified nominees posted"],
    ["Validation: classroom / work observation, interview, stakeholder feedback", "Weeks 5–6", "Search Committee", "Observation rating sheets, Stakeholder Feedback Form (Annex C)", "Validated MOVs and observation results"],
    ["Rating, deliberation and recommendation of winners", "Week 7", "Search Committee", "Scoring guides, rating sheets", "Minutes of deliberation; winners recommended to the School Head"],
    ["Posting of results; appeals window (3 working days)", "Week 7", "Secretariat, Search Committee, School Head", "Posted results, appeal forms", "Final results approved by the School Head"],
    ["On-the-spot recognition of exemplary service, innovations and initiatives", "Throughout Teachers' Month", "BLESS Coordinator and Associates, School Administration", "Certificates, tokens", "Timely recognition of deserving personnel"],
    ["Preparation of certificates, tokens and certificate holders", "Weeks 7–8", "BLESS Coordinator and Associates", "Certificates, tokens, certificate holders", "Awards ready for the ceremony"],
    ["Teachers' Month Culmination – BLESS Awarding Ceremony", "Week 8 (October 2, 2026)", "School Head, Search Committee, BLESS Coordinator and Associates, Teachers, Non-Teaching Personnel, SSLG Officers, Students", "Venue, program, awards", "Best Teacher, Best Non-Teaching Personnel and Best Class Adviser awarded; finalists given Certificates of Merit"]
  ]) },

  { id: "budget", title: "Estimated expenditures", body: `
    ${p("Source of funds: Local Funds")}
    ${table(["Item of expenditure", "Unit cost", "# Required", "Sub-total"], [
      ["Certificates", "20", "50", "1,000"],
      ["Tokens", "40", "50", "3,000"],
      ["Certificate holders", "40", "50", "2,000"],
      ["Transportation", "", "", "200"],
      ["Total", "", "", "6,200"]
    ], { num: [1, 2, 3] })}` },

  { id: "signatories", title: "Signatories", body: table(["", "Name", "Position"], [
    ["Prepared by", "ANGELIKA Q. ENAGA", "BLESS Coordinator"],
    ["", "JHON REYEL E. JIMENEZ", "BLESS Associate"],
    ["", "AUBREY ANNE S. JALIQUE", "BLESS Associate"],
    ["Recommending approval", "GLENDA ABELLANA", "PTA President"],
    ["", "MA. ADELAINE PED", "PTA Treasurer"],
    ["Noted by", "EMELI P. INFIESTO", "JHS Academic Head/Member"],
    ["", "ALMA B. PICOT", "SHS Academic Head/Member"],
    ["Approved by", "MICHAEL S. RUBINO", "Assistant to the School Principal"],
    ["", "BEHNJO S. MARTIN", "Principal I"]
  ]) }
];
