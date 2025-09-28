import Stripe from "stripe";
import { buffer } from "micro";
import admin from "firebase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  let event;
  try {
    const buf = await buffer(req);
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    console.log("💡 Webhook recebido:", event.type);
  } catch (err) {
    console.error("❌ Webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "invoice.payment_succeeded":
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId;
        if (!userId) break;

        const ref = admin.firestore().collection("users").doc(userId);
        const snap = await ref.get();

        // Ignora webhook se o usuário não existe no Firestore
        if (!snap.exists) {
          console.log(`⚠️ Ignorando webhook: userId ${userId} não existe`);
          break;
        }

        let updates = {
          subscriptionStatus: subscription.status,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        // Premium = true se assinatura ativa ou em trial
        if (
          subscription.status === "active" ||
          subscription.status === "trialing"
        ) {
          updates.premium = true;
        }
        // Premium = false se cancelada ou pagamento falhou de forma definitiva
        else if (
          ["canceled", "unpaid", "payment_failed"].includes(subscription.status)
        ) {
          updates.premium = false;
        }
        // Status intermediário → mantém o valor atual do Firestore
        else {
          updates.premium = snap.data().premium;
        }

        await ref.set(updates, { merge: true });
        console.log(`✅ Subscription processada (user: ${userId}):`, updates);
        break;
      }

      case "customer.subscription.deleted":
      case "invoice.payment_failed": {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId;
        if (!userId) break;

        const ref = admin.firestore().collection("users").doc(userId);
        const snap = await ref.get();

        if (!snap.exists) {
          console.log(`⚠️ Ignorando webhook: userId ${userId} não existe`);
          break;
        }

        const updates = {
          subscriptionStatus: "canceled",
          premium: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await ref.set(updates, { merge: true });
        console.log(`⚠️ Subscription cancelada ou falha (user: ${userId})`);
        break;
      }

      default:
        console.log("ℹ️ Evento ignorado:", event.type);
    }

    res.json({ received: true });
  } catch (err) {
    console.error("❌ Erro processando webhook:", err);
    res.status(500).send("Webhook handler failed");
  }
}
