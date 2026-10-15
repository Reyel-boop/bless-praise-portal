# BLESS PRAISE Portal — San Vicente NHS

Teachers sign in, choose **one award**, tick the required MOVs and paste a Google Drive link for each.
Admins (the PRAISE Committee) see every applicant, mark MOVs **Verified**, and record a decision.

| File | What it is |
|---|---|
| `index.html` | The page (GitHub Pages opens this) |
| `app.js` | Login, award picker, checklist, admin review |
| `data.js` | MOVs list per award. Edit here to change requirements |
| `firebase-config.js` | Your Firebase keys (step 4) |
| `firestore.rules` | Who can read/write what (step 3) |
| `logo.png` | BLESS seal |

---

## One-time setup (about 15 minutes)

### 1. Create a Firebase project
1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. **Add project**, name it e.g. `bless-praise-svnhs`. Google Analytics can be off.

### 2. Turn on email login
**Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save.**

### 3. Create the database and paste the rules
1. **Build → Firestore Database → Create database.** Pick location `asia-southeast1 (Singapore)`, start in **production mode**.
2. Open the **Rules** tab, delete what's there, paste everything from `firestore.rules`, then **Publish**.

### 4. Connect the website
1. **Project settings** (gear icon) → **Your apps** → click the **`</>`** (Web) icon → register the app (no hosting needed).
2. Copy the values from the `firebaseConfig` block into `firebase-config.js`, replacing every `PASTE_...`.

### 5. Add the admins
1. **Firestore Database → Data → Start collection**, collection ID: `admins`.
2. **Document ID** = the admin's email in **lowercase** (e.g. `juan.delacruz@deped.gov.ph`). Add any field, e.g. `role` = `admin`. Save.
3. Repeat **Add document** for each committee member.

Admins sign up on the site like everyone else. Their email must be **verified** before admin access works.
To remove an admin, delete their document.

### 6. Publish on GitHub Pages
1. Create a repo (e.g. `bless-praise-portal`) and upload **all files in this folder** to the root.
2. Repo **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save.**
3. After a minute the site is at `https://<your-username>.github.io/bless-praise-portal/`.

### 7. Allow your GitHub address to log in
Firebase → **Authentication → Settings → Authorized domains → Add domain** → `<your-username>.github.io`.

---

## How people use it

**Teachers (awardees)**
1. **Create account** → open the verification email (check Spam) → **Continue**.
2. **Choose your award.** General MOVs are added automatically.
3. Tick each MOV and paste its Drive link. Set Drive files to *Anyone with the link can view*.
4. **Submit for review.** The award is locked after this. Links can still be added.
5. Watch for green **Verified** badges, the status, and committee remarks.

**Admins**
- **Applicants** tab: totals, search, filter by award or status.
- Click an applicant → open each link → tick **Verified** (or **Verify all ticked**).
- Pick a **decision** (Complete / Incomplete / For compliance / Qualified / Disqualified), add remarks, **Save decision**.
  *Complete, Qualified* and *Disqualified* lock the teacher's checklist.

## Monitoring and Reports
The **Monitoring** and **Reports** tabs appear only for admins and for staff an admin has given access.

| Who | Monitoring | Reports |
|---|---|---|
| **Human Resource (HR)** | **Attendance**: record absences (date or date range, kind of absence, whole/half day, remarks) and tardiness (time in, minutes late, remarks) for teaching and non-teaching personnel. **Personnel** list. | Attendance and Punctuality |
| **School Clinic** | **AOR**: rate the cleanest classroom each week (1st, 2nd, 3rd) with an overall standing. | AOR · Cleanest Classroom |
| **Head / Master Teachers** | **Daily Lesson Log**: each week, mark every teacher in their subject areas *On time*, *Late* or *Not submitted*, with remarks. | Daily Lesson Log |
| **Admins** | Everything above, plus **Staff access**. | All three |

**Getting access:** when creating an account, pick **Sign up as** Human Resource, School Clinic or Head / Master Teacher
(existing users click **Request Monitoring access** on Home). An admin approves it under **Monitoring → Staff access → Waiting for approval**,
and the Monitoring tab appears for that person right away. Admins can also **Add staff** directly by email.

**Attendance (HR):** the **Daily sheet** lists every teaching and non-teaching personnel for a day. Everyone is *Present* unless tagged;
tap **Absent** (kind of absence, whole/half day, remarks) or **Late** (time in, minutes late, remarks). **Month view** shows the whole month
per person (A = absent, ½ = half day, L = late); click any day to tag or edit it.

**Personnel list:** everyone who creates an account is on it automatically. When signing up they choose their **Position** from a list
(Teacher I–VII, Master Teacher, Head Teacher, Administrative Officer/Assistant/Aide, Nurse, Guard…) and their **Subject area** (teaching)
or **Office** (non-teaching). Teaching vs non-teaching follows from the position, and the Daily Lesson Log lists teachers by subject area.
Older accounts are asked to choose their position once; anyone can change it by clicking their name in the header. HR can correct entries
under **Monitoring → Personnel**. Positions and offices are listed in `data.js`.

Subject areas and kinds of absence are listed in `data.js`. If you change the subject areas, also change `subjects()` in `firestore.rules` and publish the rules.

## Changing MOVs
Edit the lists in `data.js` and upload it again. Items are matched by position, so add new items **at the end** of a list
to keep existing ticks lined up. If you add a new award, also add its key to `awardKeys()` in `firestore.rules` and publish the rules.

## Free plan limits
Firebase's free Spark plan covers 50,000 reads and 20,000 writes per day. That's far more than one school needs.
