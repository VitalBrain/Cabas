// Clé publique VAPID (Firebase › Paramètres du projet › Cloud Messaging › Certificats Web Push).
export default async () =>
  new Response(JSON.stringify({ vapidKey: process.env.FIREBASE_VAPID_KEY || null }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" }
  });

export const config = { path: "/api/push-config" };
