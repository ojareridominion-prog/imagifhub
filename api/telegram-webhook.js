export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Reject everything except POST
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    // 👇 YOUR EXISTING TELEGRAM LOGIC GOES HERE
    console.log("Webhook received:", req.body);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}


import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  console.log("TELEGRAM UPDATE:", JSON.stringify(req.body, null, 2));
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const update = req.body;

  // Telegram pre-checkout (required)
  if (update.pre_checkout_query) {
    return res.status(200).json({ ok: true });
  }

  // Successful payment
  if (update.message?.successful_payment) {
    const telegramId = update.message.from.id;

    const expires = new Date();
    expires.setDate(expires.getDate() + 30);

    await supabase.from("users").upsert({
      telegram_id: telegramId,
      is_premium: true,
      subscription_status: "active",
      subscription_expires: expires.toISOString()
    });

    return res.status(200).json({ success: true });
  }

  return res.status(200).json({ received: true });
                               }


