import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
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
