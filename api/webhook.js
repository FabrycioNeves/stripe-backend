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
    console.error("❌ Webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        if (!subscriptionId) break;

        const subscription = await stripe.subscriptions.retrieve(
          subscriptionId
        );
        const userId = subscription.metadata?.userId;
        if (!userId) break;

        await admin.firestore().collection("users").doc(userId).set(
          {
            premium: true,
            subscriptionStatus: subscription.status,
            premiumSince: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        console.log(`✅ Usuário ${userId} marcado como premium`);
        break;
      }

      case "invoice.payment_failed":
      case "customer.subscription.deleted": {
        const obj = event.data.object;
        const subscriptionId = obj.subscription || obj.id;
        const subscription = await stripe.subscriptions
          .retrieve(subscriptionId)
          .catch(() => null);
        const userId = subscription?.metadata?.userId;
        if (!userId) break;

        await admin.firestore().collection("users").doc(userId).set(
          {
            premium: false,
            subscriptionStatus: "canceled",
            premiumCanceledAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        console.log(
          `⚠️ Premium removido do usuário ${userId} devido a ${event.type}`
        );
        break;
      }

      default:
        console.log("Evento ignorado:", event.type);
    }

    res.json({ received: true });
  } catch (err) {
    console.error("❌ Erro processando webhook:", err);
    res.status(500).send("Webhook handler failed");
  }
}
