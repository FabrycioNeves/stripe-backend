// api/webhook.js
import Stripe from "stripe";
import { buffer } from "micro";
import admin from "firebase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

// Desabilita bodyParser porque precisamos do raw body
export const config = {
  api: { bodyParser: false },
};

// Inicializa Firebase Admin
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).end("Method Not Allowed");
  }

  let event;
  let buf;

  try {
    buf = await buffer(req);
    const sig = req.headers["stripe-signature"];

    event = stripe.webhooks.constructEvent(
      buf, // ⚡️ raw buffer
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook signature failed:", err.message, {
      sig: req.headers["stripe-signature"],
      secret: process.env.STRIPE_WEBHOOK_SECRET ? "definido" : "NÃO definido",
      bodyLength: buf ? buf.length : 0,
    });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const subscriptionEvents = [
      "invoice.payment_succeeded",
      "invoice.payment_failed",
      "customer.subscription.deleted",
      "customer.subscription.updated",
    ];

    switch (event.type) {
      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        if (!subscriptionId) break;

        const subscription = await stripe.subscriptions.retrieve(
          subscriptionId
        );
        const userId = subscription.metadata?.userId;

        if (!userId) {
          console.warn(
            "⚠️ Nenhum userId encontrado na subscription:",
            subscription
          );
          break;
        }

        await admin.firestore().collection("users").doc(userId).set(
          {
            subscriptionId: subscription.id,
            subscriptionStatus: subscription.status,
            lastInvoiceId: invoice.id,
            lastPayment: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        console.log(
          `✅ Subscription atualizada para ${subscription.status} (user: ${userId})`
        );
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        if (!subscriptionId) break;

        const subscription = await stripe.subscriptions.retrieve(
          subscriptionId
        );
        const userId = subscription.metadata?.userId;

        if (!userId) {
          console.warn(
            "⚠️ Nenhum userId encontrado na subscription:",
            subscription
          );
          break;
        }

        await admin.firestore().collection("users").doc(userId).set(
          {
            subscriptionStatus: "payment_failed",
            lastPaymentFailedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        console.log(`⚠️ Payment failed para user ${userId}`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId;

        if (!userId) {
          console.warn(
            "⚠️ Nenhum userId encontrado na subscription:",
            subscription
          );
          break;
        }

        await admin.firestore().collection("users").doc(userId).set(
          {
            subscriptionStatus: "canceled",
            canceledAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        console.log(`⚠️ Subscription cancelada para user ${userId}`);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId;

        if (!userId) {
          console.warn(
            "⚠️ Nenhum userId encontrado na subscription:",
            subscription
          );
          break;
        }

        await admin.firestore().collection("users").doc(userId).set(
          {
            subscriptionStatus: subscription.status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        console.log(
          `🔄 Subscription atualizada para ${subscription.status} (user: ${userId})`
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
