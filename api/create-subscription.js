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

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      expand: ["latest_invoice.payment_intent"],
      metadata: { userId },
      collection_method: "charge_automatically",
      default_payment_method: null, // depois será atualizado automaticamente
    });

    // Salva dados iniciais da subscription (não marca premium ainda)
    await admin.firestore().collection("users").doc(userId).set(
      {
        subscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
        priceId,
        subscriptionCreatedAt: new Date(),
      },
      { merge: true }
    );

    const clientSecret =
      subscription.latest_invoice?.payment_intent?.client_secret || null;

    res.status(200).json({
      clientSecret,
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
    });
  } catch (err) {
    console.error("❌ Erro ao criar subscription:", err);
    res.status(500).json({ error: err.message });
  }
}
