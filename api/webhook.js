// api/webhook.js
import Stripe from "stripe";
import { buffer } from "micro";
import admin from "firebase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

// Inicializa Firebase Admin (uma vez)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const config = { api: { bodyParser: false } }; // necessário para webhooks

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const buf = await buffer(req);
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // Trate os eventos que você precisa
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object;
        const userId = pi.metadata?.userId;
        if (userId) {
          await admin.firestore().collection("users").doc(userId).set(
            {
              premium: true,
              premiumSince: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          console.log(
            `✅ Usuário ${userId} marcado como premium (payment_intent.succeeded)`
          );
        } else {
          console.warn("payment_intent.succeeded sem metadata.userId");
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        // se você gravou metadata na subscription com userId, use:
        const userId = subscription.metadata?.userId;
        if (userId) {
          const isActive = subscription.status === "active";
          await admin
            .firestore()
            .collection("users")
            .doc(userId)
            .set(
              {
                premium: isActive,
                subscriptionId: subscription.id,
                subscriptionStatus: subscription.status,
                premiumSince: isActive
                  ? admin.firestore.FieldValue.serverTimestamp()
                  : null,
              },
              { merge: true }
            );
          console.log(
            `🔁 Subscription update for ${userId}: ${subscription.status}`
          );
        }
        break;
      }

      case "customer.subscription.deleted":
      case "invoice.payment_failed": {
        // invoice.payment_failed: pode indicar cancelamento por falta de pagamento
        const obj = event.data.object;
        // invoice has customer etc; subscription has metadata etc.
        const userId =
          obj.metadata?.userId || obj.customer_metadata?.userId || obj.customer; // fallback
        if (userId) {
          await admin.firestore().collection("users").doc(userId).set(
            {
              premium: false,
              premiumCanceledAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          console.log(
            `⚠️ Premium removido do usuário ${userId} devido a ${event.type}`
          );
        } else {
          console.warn(`${event.type} sem metadata.userId`);
        }
        break;
      }

      default:
        console.log("Evento não tratado (ignorado):", event.type);
    }

    res.json({ received: true });
  } catch (err) {
    console.error("❌ Erro processando webhook:", err);
    res.status(500).send("Webhook handler failed");
  }
}
