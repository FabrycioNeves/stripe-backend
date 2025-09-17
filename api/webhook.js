// api/webhook.js
import Stripe from "stripe";
import { buffer } from "micro";
import admin from "firebase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

// Inicializa Firebase Admin apenas uma vez
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
    switch (event.type) {
      // 👉 Assinatura criada ou atualizada (mas ainda pode estar incomplete)
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId || null;

        if (userId) {
          await admin.firestore().collection("users").doc(userId).set(
            {
              subscriptionId: subscription.id,
              subscriptionStatus: subscription.status,
              customerId: subscription.customer,
            },
            { merge: true }
          );
          console.log(
            `🔁 Subscription created/updated for ${userId}: ${subscription.status}`
          );
        }
        break;
      }

      // 👉 Pagamento da fatura bem-sucedido (marcar premium)
      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        if (!subscriptionId) break;

        // Busca a assinatura para pegar o userId
        const subscription = await stripe.subscriptions.retrieve(
          subscriptionId
        );
        const userId = subscription.metadata?.userId;

        if (userId) {
          await admin.firestore().collection("users").doc(userId).set(
            {
              premium: true,
              subscriptionStatus: subscription.status,
              premiumSince: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          console.log(
            `✅ Usuário ${userId} marcado como premium (pagamento da assinatura)`
          );
        }
        break;
      }

      // 👉 Assinatura cancelada ou falha no pagamento
      case "customer.subscription.deleted":
      case "invoice.payment_failed": {
        const obj = event.data.object;
        const subscriptionId = obj.subscription || obj.id;
        const subscription = await stripe.subscriptions
          .retrieve(subscriptionId)
          .catch(() => null);
        const userId = subscription?.metadata?.userId || null;

        if (userId) {
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
