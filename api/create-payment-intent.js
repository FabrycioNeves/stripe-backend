// api/create-payment-intent.js
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error("❌ STRIPE_SECRET_KEY não encontrada");
      return res.status(500).json({ error: "Stripe key missing" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { amount } = body;

    if (!amount) return res.status(400).json({ error: "Amount is required" });

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "brl", // ou "usd"
    });

    return res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("❌ Erro no endpoint:", err);
    return res.status(500).json({ error: err.message });
  }
}
