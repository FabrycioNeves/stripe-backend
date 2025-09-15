// api/create-subscription.js
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { userId, email, priceId } = body;
    // priceId = ID do preço recorrente criado no Stripe Dashboard (ex: price_12345)

    if (!userId) return res.status(400).json({ error: "User ID is required" });
    if (!priceId)
      return res.status(400).json({ error: "Price ID is required" });

    // 1. Verifica ou cria Customer no Stripe
    let customers = await stripe.customers.list({ email, limit: 1 });
    let customer = customers.data[0];

    if (!customer) {
      customer = await stripe.customers.create({
        email,
        metadata: { userId },
      });
    }

    // 2. Cria a assinatura
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      expand: ["latest_invoice.payment_intent"],
      metadata: { userId }, // 👈 ESSENCIAL
    });

    return res.status(200).json({
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret,
    });
  } catch (err) {
    console.error("❌ Erro ao criar assinatura:", err);
    return res.status(500).json({ error: err.message });
  }
}
