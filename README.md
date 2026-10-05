# BLESS PRAISE Portal — San Vicente NHS

Teachers sign in, choose **one award**, and upload **one PDF per MOV** (max 5 MB).
Admins (the PRAISE Committee) see every applicant, mark MOVs **Verified**, and record a decision.

| File | What it is |
|---|---|
| `index.html` | The page (GitHub Pages opens this) |
| `app.js` | Login, award picker, checklist, admin review |
| `data.js` | MOVs list per award. Edit here to change requirements |
| `firebase-config.js` | Your Firebase keys (step 4) |
| `firestore.rules` | Who can read/write the database and PDFs (step 3) |
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
3. Click **Upload PDF** on each MOV (max 5 MB). Several pages? Combine them into one PDF first.
   Too big? Shrink it free at ilovepdf.com → Compress PDF.
4. **Submit for review.** The award is locked after this. PDFs can still be uploaded.
5. Watch for green **Verified** badges, the status, and committee remarks.

**Admins**
- **Applicants** tab: totals, search, filter by award or status.
- Click an applicant → **View PDF** on each MOV → tick **Verified** (or **Verify all uploaded**).
- Pick a **decision** (Complete / Incomplete / For compliance / Qualified / Disqualified), add remarks, **Save decision**.
  *Complete, Qualified* and *Disqualified* lock the teacher's checklist.

## Changing MOVs
Edit the lists in `data.js` and upload it again. Items are matched by position, so add new items **at the end** of a list
to keep existing ticks lined up. If you add a new award, also add its key to `awardKeys()` in `firestore.rules` and publish the rules.

## Cost: free
The project stays on Firebase's free **Spark** plan; no card needed. PDFs are stored inside the database
(split into ~900 KB pieces), so they share its free allowance:

- **1 GB total** stored (roughly 1,000+ typical PDFs)
- 50,000 reads and 20,000 writes per day (viewing one 5 MB PDF uses about 7 reads)

If the school ever outgrows this, move PDFs to Firebase Storage (requires the Blaze plan).

Deploy rule changes with: `npx firebase-tools deploy --only firestore:rules`
