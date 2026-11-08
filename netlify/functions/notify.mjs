// Envoie une notification push aux autres membres d'une liste quand des produits sont ajoutés ou retirés.
// Variables d'environnement Netlify :
//   FIREBASE_SERVICE_ACCOUNT : contenu du fichier JSON de clé privée du compte de service Firebase
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

function adminApp() {
  if (getApps().length) return getApps()[0];
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || "").trim();
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT manquant");
  const sa = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
  return initializeApp({ credential: cert(sa) });
}

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

const clean = a => (Array.isArray(a) ? a : []).slice(0, 20).map(x => String(x).slice(0, 60)).filter(Boolean);

function enumerate(names, total) {
  if (!names.length) return total + " article" + (total > 1 ? "s" : "");
  const shown = names.slice(0, 3).join(", ");
  const extra = total - Math.min(3, names.length);
  return extra > 0 ? `${shown} et ${extra} autre${extra > 1 ? "s" : ""}` : shown;
}

const DEAD = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument"
]);

export default async req => {
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let app;
  try { app = adminApp(); } catch (e) { console.error(e); return json({ error: "not-configured" }, 503); }

  const idToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  let user;
  try { user = await getAuth(app).verifyIdToken(idToken); } catch (e) { return json({ error: "auth" }, 401); }

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: "body" }, 400); }

  const listId = String(body.listId || "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(listId)) return json({ error: "list" }, 400);

  const db = getFirestore(app);
  const snap = await db.doc(`cabas_lists/${listId}`).get();
  if (!snap.exists) return json({ error: "list" }, 404);
  const list = snap.data();
  const email = (user.email || "").toLowerCase();
  const memberEmails = list.memberEmails || [];
  if (!memberEmails.includes(email)) return json({ error: "forbidden" }, 403);

  const added = clean(body.added), removed = clean(body.removed);
  const nA = Math.max(added.length, Math.min(500, parseInt(body.nAdded, 10) || 0));
  const nR = Math.max(removed.length, Math.min(500, parseInt(body.nRemoved, 10) || 0));
  if (!nA && !nR) return json({ sent: 0 });

  const members = list.members || {};
  const who = (members[user.uid] && members[user.uid].name) || user.name || email.split("@")[0];
  const parts = [];
  if (nA) parts.push("a ajouté " + enumerate(added, nA));
  if (nR) parts.push("a retiré " + enumerate(removed, nR));
  const title = `${list.icon || "🧺"} ${list.name || "Liste de courses"}`;
  const text = `${who} ${parts.join(" · ")}`.slice(0, 220);

  // Destinataires : les autres membres encore dans la liste
  const uids = Object.keys(members).filter(u =>
    u !== user.uid && memberEmails.includes(String((members[u] || {}).email || "").toLowerCase()));

  const targets = [];
  await Promise.all(uids.map(async u => {
    const p = await db.doc(`cabas_users/${u}/meta/push`).get();
    if (!p.exists) return;
    const d = p.data();
    if (d.muted && d.muted[listId]) return;
    Object.entries(d.tokens || {}).forEach(([k, v]) => { if (v && v.token) targets.push({ u, k, token: v.token }); });
  }));
  if (!targets.length) return json({ sent: 0 });

  const res = await getMessaging(app).sendEachForMulticast({
    tokens: targets.map(t => t.token),
    data: { title, body: text, listId },
    webpush: { headers: { Urgency: "high", TTL: "86400" } }
  });

  // Nettoyage des appareils désinstallés / jetons expirés
  const dead = [];
  res.responses.forEach((r, i) => { if (!r.success && r.error && DEAD.has(r.error.code)) dead.push(targets[i]); });
  await Promise.all(dead.map(t =>
    db.doc(`cabas_users/${t.u}/meta/push`).update({ [`tokens.${t.k}`]: FieldValue.delete() }).catch(() => {})));

  return json({ sent: res.successCount, failed: res.failureCount });
};

export const config = { path: "/api/notify" };
