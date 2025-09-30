// api/create-subscription.js
import Stripe from "stripe";
import admin from "firebase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const { userId, customerId, priceId } =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    if (!userId || !customerId || !priceId)
      return res
        .status(400)
        .json({ error: "userId, customerId e priceId são obrigatórios" });

    // 🔹 cria subscription incompleta
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      expand: ["latest_invoice.payment_intent"],
      metadata: { userId },
    });

    // 🔹 cria SetupIntent para coletar dados do cartão + billing info
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: "off_session", // futuro uso off-session
      payment_method_types: ["card"],
    });

    // 🔹 salva no Firestore
    await admin.firestore().collection("users").doc(userId).set(
      {
        subscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
        priceId,
        subscriptionCreatedAt: new Date(),
      },
      { merge: true }
    );

    res.status(200).json({
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      customerId,
      setupIntentClientSecret: setupIntent.client_secret, // 🔹 importante
    });
  } catch (err) {
    console.error("❌ Erro ao criar subscription:", err);
    res.status(500).json({ error: err.message });
  }
}
