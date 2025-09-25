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
      // Pagamento bem-sucedido ou assinatura atualizada
      case "invoice.payment_succeeded":
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId;
        if (!userId) break;

        const updates = {
          subscriptionStatus: subscription.status,
          premium: subscription.status === "active", // ✅ Premium ativo apenas se active
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await admin
          .firestore()
          .collection("users")
          .doc(userId)
          .set(updates, { merge: true });

        console.log(`✅ Subscription atualizada (user: ${userId}):`, updates);
        break;
      }

      // Pagamento falhou ou assinatura deletada
      case "customer.subscription.deleted":
      case "invoice.payment_failed": {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId;
        if (!userId) break;

        const updates = {
          subscriptionStatus: "canceled",
          premium: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await admin
          .firestore()
          .collection("users")
          .doc(userId)
          .set(updates, { merge: true });

        console.log(
          `⚠️ Subscription cancelada ou falha de pagamento (user: ${userId})`
        );
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
