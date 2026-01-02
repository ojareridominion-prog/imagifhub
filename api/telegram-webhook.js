import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const update = req.body;

  if (update.message?.successful_payment) {
    const payment = update.message.successful_payment;
    const telegram_id = update.message.from.id;

    // 1️⃣ Save payment
    await supabase.from("payments").insert({
      telegram_id,
      provider: "telegram_stars",
      amount: payment.total_amount,
      currency: payment.currency,
      payload: payment.invoice_payload,
    });

    // 2️⃣ Grant premium for 30 days
    const expires_at = new Date();
    expires_at.setDate(expires_at.getDate() + 30);

    await supabase.from("users").upsert({
      telegram_id,
      is_premium: true,
      premium_expires_at: expires_at.toISOString(),
    });

    return res.status(200).json({ ok: true });
  }

  res.status(200).json({ ok: true });
}
