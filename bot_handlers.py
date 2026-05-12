import base64
import logging
import requests
import aiohttp
import json
from datetime import datetime, timedelta
from aiogram import F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton, PreCheckoutQuery, ContentType, LabeledPrice
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from config import bot, dp, supabase, ADMIN_IDS, ADMIN_TOKEN, IMGBB_API_KEY, BOT_TOKEN, CATEGORIES   # <-- import ADMIN_IDS
from ad_utils import send_banner_ad
from gifts_data import GIFTS

# Warn if ImgBB API key is missing (for debugging)
if not IMGBB_API_KEY:
    logging.warning("⚠️ IMGBB_API_KEY is not set in environment. Admin uploads will fail with 'forbidden' errors.")

# Define states
class AdminUpload(StatesGroup):
    waiting_media = State()
    waiting_category = State()
    waiting_keywords = State()

# ==================== PAYMENT HANDLERS (UNIFIED) ====================

@dp.pre_checkout_query()
async def on_pre_checkout_query(pre_checkout_query: PreCheckoutQuery):
    """Required handler – answer within 10 seconds"""
    try:
        logging.info(f"📦 Pre-checkout query: id={pre_checkout_query.id}, user={pre_checkout_query.from_user.id}")
        await bot.answer_pre_checkout_query(pre_checkout_query.id, ok=True)
    except Exception as e:
        logging.error(f"🔥 Failed to answer pre_checkout_query: {e}", exc_info=True)

@dp.message(F.content_type == ContentType.SUCCESSFUL_PAYMENT)
async def on_successful_payment(message: Message):
    """Handle successful payment – gifts or premium."""
    try:
        payment = message.successful_payment
        telegram_id = message.from_user.id
        payload = payment.invoice_payload
        now = datetime.utcnow()

        # --- Check if this is a GIFT payment ---
        if payload.startswith("gift_"):
            # Format: gift_{gift_id}_{user_id}
            parts = payload.split("_")
            if len(parts) >= 3:
                gift_id = parts[1]
                buyer_id = int(parts[2])
                gift = next((g for g in GIFTS if g["id"] == gift_id), None)
                if not gift:
                    logging.error(f"Unknown gift_id in payload: {gift_id}")
                    await message.answer("❌ Gift not recognized. Please contact support.")
                    return

                # Record gift purchase
                gift_record = {
                    "user_id": buyer_id,
                    "gift_id": gift["id"],
                    "gift_name": gift["name"],
                    "gift_emoji": gift["emoji"],
                    "gift_price": gift["price"],
                    "created_at": now.isoformat()
                }
                supabase.table("gift_purchases").insert(gift_record).execute()
                logging.info(f"🎁 Gift purchase recorded: {gift['name']} for user {buyer_id}")

                # If overpriced category → grant 30 days premium
                if gift["category"] == "overpriced":
                    # Get existing expiry
                    user_result = supabase.table("users").select("premium_expires_at").eq("telegram_id", buyer_id).execute()
                    new_expiry = now + timedelta(days=30)
                    if user_result.data and user_result.data[0].get("premium_expires_at"):
                        current_expiry_str = user_result.data[0]["premium_expires_at"]
                        try:
                            if current_expiry_str.endswith('Z'):
                                current_expiry_str = current_expiry_str.replace('Z', '+00:00')
                            current_expiry = datetime.fromisoformat(current_expiry_str)
                            if current_expiry.tzinfo:
                                current_expiry = current_expiry.replace(tzinfo=None)
                            if current_expiry > now and current_expiry > new_expiry:
                                new_expiry = current_expiry + timedelta(days=30)
                        except Exception:
                            pass
                    supabase.table("users").upsert({
                        "telegram_id": buyer_id,
                        "is_premium": True,
                        "premium_expires_at": new_expiry.isoformat(),
                        "updated_at": now.isoformat()
                    }).execute()
                    logging.info(f"✨ Granted 30-day premium to user {buyer_id} for overpriced gift")
                    await message.answer(
                        f"🎁 Thank you for the {gift['emoji']} {gift['name']}!\n"
                        f"✨ As a bonus, you've received <b>30 days of IMAGIFHUB Premium</b>! ✨\n\n"
                        f"Refresh your mini app to enjoy ad-free experience.",
                        parse_mode="HTML"
                    )
                else:
                    await message.answer(
                        f"🎁 Thank you for sending {gift['emoji']} {gift['name']}!\n"
                        f"Your gift has been received.!"
                    )
                return

        # --- Else it's a PREMIUM payment (original logic) ---
        logging.info(f"💰 Successful premium payment from user {telegram_id}, amount={payment.total_amount} {payment.currency}")

        # Get existing user (if any)
        user_result = supabase.table("users").select("premium_expires_at").eq("telegram_id", telegram_id).execute()
        new_expiry = now + timedelta(days=30)
        if user_result.data:
            current_expiry_str = user_result.data[0].get("premium_expires_at")
            if current_expiry_str:
                try:
                    if current_expiry_str.endswith('Z'):
                        current_expiry_str = current_expiry_str.replace('Z', '+00:00')
                    current_expiry = datetime.fromisoformat(current_expiry_str)
                    if current_expiry.tzinfo:
                        current_expiry = current_expiry.replace(tzinfo=None)
                    if current_expiry > now:
                        new_expiry = current_expiry + timedelta(days=30)
                        logging.info(f"Extending premium for user {telegram_id} from {current_expiry} to {new_expiry}")
                except Exception as e:
                    logging.warning(f"Could not parse existing expiry, using 30 days from now: {e}")

        # Upsert user
        user_data = {
            "telegram_id": telegram_id,
            "is_premium": True,
            "premium_expires_at": new_expiry.isoformat(),
            "updated_at": now.isoformat()
        }
        supabase.table("users").upsert(user_data).execute()
        logging.info(f"✅ User {telegram_id} premium activated/updated until {new_expiry.isoformat()}")

        # Insert payment record
        payment_record = {
            "telegram_id": telegram_id,
            "provider": "telegram_stars",
            "amount": payment.total_amount,
            "currency": payment.currency,
            "payload": payment.invoice_payload,
            "transaction_id": payment.telegram_payment_charge_id,
            "status": "completed"
        }
        supabase.table("payments").insert(payment_record).execute()
        logging.info(f"✅ Payment record inserted for user {telegram_id}")

        # Notify user
        await message.answer(
            "🎉 Payment successful! You are now an IMAGIFHUB Premium member!\n\n"
            f"✅ Your premium access is active until {new_expiry.strftime('%Y-%m-%d')}.\n"
            "✅ Ads have been removed from your experience.\n\n"
            "To refresh your premium status in the app:\n"
            "1. Close and reopen the IMAGIFHUB Mini App\n"
            "2. Or tap 'Check Premium Status' button\n\n"
            "Use /premium anytime to check your status."
        )

        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔄 Refresh Mini App", web_app={"url": "https://ojareridominion-prog.github.io/imagifhub/"})],
            [InlineKeyboardButton(text="🚀 Open IMAGIFHUB", web_app={"url": "https://ojareridominion-prog.github.io/imagifhub/"})]
        ])

        await message.answer(
            "Click below to open the refreshed app with premium activated:",
            reply_markup=keyboard
        )

    except Exception as e:
        logging.error(f"🔥 Payment DB Error: {e}", exc_info=True)
        await message.answer(
            f"⚠️ Payment received, but there was an error activating premium. "
            f"Please contact support and provide your user ID: {message.from_user.id}"
        )

# ==================== BOT COMMANDS ====================

@dp.message(F.text == "/start")
async def cmd_start(message: Message):
    # Optional: create user record on first start (so they exist in DB)
    telegram_id = message.from_user.id
    try:
        # Check if user exists
        result = supabase.table("users").select("telegram_id").eq("telegram_id", telegram_id).execute()
        if not result.data:
            # Create basic user record (non-premium)
            supabase.table("users").insert({
                "telegram_id": telegram_id,
                "is_premium": False,
                "created_at": datetime.utcnow().isoformat()
            }).execute()
            logging.info(f"👤 New user {telegram_id} created via /start")
    except Exception as e:
        logging.error(f"Error creating user on /start: {e}")

    # Send banner ad (only if not premium, with cooldown/daily limit)
    await send_banner_ad(message.chat.id, telegram_id)

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🚀 Let's Go!", web_app={"url": "https://ojareridominion-prog.github.io/imagifhub/"})],
        [InlineKeyboardButton(text="📢 Official Channel", url="https://t.me/imagifhub")]
    ])
    await message.answer(
        "IMAGIFHUB isn't just an app—it's your personal portal to a world of endless, breathtaking beauty.\n\n"
        "Don't wait, click let's go 🚀🚀 to continue",
        reply_markup=keyboard
    )

@dp.message(F.text == "/premium")
async def cmd_premium(message: Message):
    telegram_id = message.from_user.id
    logging.info(f"Checking premium for user ID: {telegram_id}")

    try:
        user_result = supabase.table("users") \
            .select("is_premium, premium_expires_at") \
            .eq("telegram_id", telegram_id) \
            .execute()

        if not user_result.data or len(user_result.data) == 0:
            # User not in DB – create them as free user
            supabase.table("users").insert({
                "telegram_id": telegram_id,
                "is_premium": False
            }).execute()
            user_data = {"is_premium": False, "premium_expires_at": None}
        else:
            user_data = user_result.data[0]

        is_premium = user_data.get("is_premium", False)
        premium_expires_at = user_data.get("premium_expires_at")

        # Convert boolean/string to bool
        is_premium_bool = False
        if isinstance(is_premium, bool):
            is_premium_bool = is_premium
        elif isinstance(is_premium, str):
            is_premium_bool = is_premium.lower() == 'true'
        elif isinstance(is_premium, int):
            is_premium_bool = bool(is_premium)

        if is_premium_bool and premium_expires_at:
            try:
                expires_at_str = premium_expires_at
                if expires_at_str.endswith('Z'):
                    expires_at_str = expires_at_str.replace('Z', '+00:00')
                expires_at = datetime.fromisoformat(expires_at_str)
                now = datetime.utcnow().replace(tzinfo=None)
                if expires_at.tzinfo is not None:
                    expires_at = expires_at.replace(tzinfo=None)
                if expires_at > now:
                    days_left = (expires_at - now).days
                    await message.answer(
                        f"✨ <b>Premium Status</b>\n\n"
                        f"✅ You are a <b>Premium Member</b>!\n"
                        f"⏳ Days remaining: <b>{days_left}</b> day(s)\n"
                        f"📅 Expires on: {expires_at.strftime('%Y-%m-%d')}\n\n"
                        f"Enjoy your ad-free experience! 🎉",
                        parse_mode="HTML"
                    )
                    return
            except Exception as e:
                logging.error(f"Date parsing error: {e}")

        # Not premium or expired
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⭐ Get Premium", callback_data="get_premium")],
            [InlineKeyboardButton(text="🚀 Open IMAGIFHUB", web_app={"url": "https://ojareridominion-prog.github.io/imagifhub/"})]
        ])
        await message.answer(
            "✨ <b>IMAGIFHUB Premium</b>\n\n"
            "🔓 You are currently on the free plan.\n\n"
            "✨ <b>Upgrade to Premium for:</b>\n"
            "• 🚫 No ads\n"
            "• 😁 Support the project\n\n"
            "💫 <b>Price:</b> 99 Stars (30 days)\n\n"
            "Click 'Get Premium' to upgrade!",
            parse_mode="HTML",
            reply_markup=keyboard
        )
    except Exception as e:
        logging.error(f"Premium check error: {e}", exc_info=True)
        await message.answer("❌ There was an error checking your premium status.\n\nPlease try again in a few moments.")

    # Send banner ad after responding (only if user is not premium)
    await send_banner_ad(message.chat.id, telegram_id)

@dp.callback_query(F.data == "get_premium")
async def get_premium_callback(call: CallbackQuery):
    await call.answer()
    invoice_link = await bot.create_invoice_link(
        title="IMAGIFHUB Premium",
        description="30 days of ad-free experience",
        payload=f"premium_{call.from_user.id}",
        provider_token="",
        currency="XTR",
        prices=[LabeledPrice(label="Premium Access", amount=99)]
    )
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="💳 Pay Now", url=invoice_link)],
        [InlineKeyboardButton(text="🔙 Back", callback_data="back_to_premium")]
    ])
    await call.message.edit_text(
        "✨ <b>Upgrade to IMAGIFHUB Premium</b>\n\n"
        "💫 <b>Price:</b> 99 Stars (30 days)\n\n"
        "<b>Benefits:</b>\n"
        "• 🚫 No ads\n"
        "• 😁 Support the project\n\n"
        "Click 'Pay Now' to complete your purchase.",
        parse_mode="HTML",
        reply_markup=keyboard
    )
    # Send ad after callback
    await send_banner_ad(call.message.chat.id, call.from_user.id)

@dp.callback_query(F.data == "back_to_premium")
async def back_to_premium_callback(call: CallbackQuery):
    await call.answer()
    await cmd_premium(call.message)
    # Send ad after returning to premium menu
    await send_banner_ad(call.message.chat.id, call.from_user.id)

@dp.callback_query(F.data == "renew_premium")
async def renew_premium_callback(call: CallbackQuery):
    await get_premium_callback(call)
    await send_banner_ad(call.message.chat.id, call.from_user.id)

@dp.message(F.text.startswith("/start premium"))
async def start_premium(message: Message):
    await cmd_premium(message)

# ==================== ADMIN COMMANDS ====================

# Use ADMIN_IDS instead of single ADMIN_ID
@dp.message(F.from_user.id.in_(ADMIN_IDS), F.text == "/admin")
async def admin_cmd(message: Message, state: FSMContext):
    await state.clear()
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📤 Upload New Media", callback_data="up")]
    ])
    await message.answer("<b>Admin Control Panel</b>", reply_markup=kb, parse_mode="HTML")

@dp.callback_query(F.data == "up")
async def up_step1(call: CallbackQuery, state: FSMContext):
    await call.message.edit_text("Please send the photo you want to add to the gallery.")
    await state.set_state(AdminUpload.waiting_media)

@dp.message(AdminUpload.waiting_media, F.photo)
async def up_step2(message: Message, state: FSMContext):
    try:
        # Get the largest photo (last in array)
        photo = message.photo[-1]
        file_id = photo.file_id

        # Download the file from Telegram
        file = await bot.get_file(file_id)
        file_path = file.file_path
        downloaded = await bot.download_file(file_path)

        # Read the bytes and encode to base64
        image_data = downloaded.getvalue() if hasattr(downloaded, 'getvalue') else downloaded.read()
        base64_image = base64.b64encode(image_data).decode('utf-8')

        # Validate API key is set
        if not IMGBB_API_KEY:
            await message.answer(
                "❌ **ImgBB API key is missing.**\n"
                "The bot administrator needs to set the `IMGBB_API_KEY` environment variable.\n"
                "Contact support to resolve this."
            )
            logging.error("Upload aborted: IMGBB_API_KEY is empty")
            return

        # Upload to ImgBB using base64
        payload = {
            'key': IMGBB_API_KEY,
            'image': base64_image,
        }
        resp = requests.post('https://api.imgbb.com/1/upload', data=payload, timeout=30)

        if resp.status_code == 200:
            data = resp.json()
            if data.get('success'):
                final_url = data['data']['url']
                await state.update_data(url=final_url)

                # Build category buttons
                btns = []
                for i in range(0, len(CATEGORIES), 2):
                    row = [InlineKeyboardButton(text=c, callback_data=f"set_{c}") for c in CATEGORIES[i:i+2]]
                    btns.append(row)
                await message.answer("Select the Category:", reply_markup=InlineKeyboardMarkup(inline_keyboard=btns))
                await state.set_state(AdminUpload.waiting_category)
                return
            else:
                error_msg = data.get('error', {}).get('message', 'Unknown error')
                logging.error(f"ImgBB API error: {error_msg}")
                await message.answer(f"❌ ImgBB upload failed: {error_msg}\n\nPlease check your API key.")
        else:
            # Detailed error reporting
            try:
                error_json = resp.json()
                error_msg = error_json.get('error', {}).get('message', 'Unknown error')
                error_code = error_json.get('error', {}).get('code', 'N/A')
                status_txt = error_json.get('status_txt', '')
                full_response = f"HTTP {resp.status_code} - {error_msg} (code {error_code})"
                logging.error(f"ImgBB HTTP {resp.status_code}: {resp.text[:500]}")
            except:
                error_msg = f"HTTP {resp.status_code}"
                full_response = resp.text[:500]
            await message.answer(
                f"❌ **Error uploading to ImgBB:**\n{full_response}\n\n"
                f"Possible reasons:\n"
                f"- Invalid API key\n"
                f"- API key disabled or expired\n"
                f"- ImgBB service issues\n\n"
                f"Check logs for more details."
            )
    except Exception as e:
        logging.error(f"Unexpected error during upload: {e}", exc_info=True)
        await message.answer("❌ An unexpected error occurred. Please try again.")

@dp.callback_query(F.data.startswith("set_"))
async def up_step3(call: CallbackQuery, state: FSMContext):
    category = call.data.split("_")[1]
    await state.update_data(category=category)
    await call.message.edit_text(f"Category set to: {category}\nNow type keywords:")
    await state.set_state(AdminUpload.waiting_keywords)

@dp.message(AdminUpload.waiting_keywords)
async def up_final(message: Message, state: FSMContext):
    user_data = await state.get_data()
    supabase.table('media_content').insert({
        "url": user_data['url'],
        "category": user_data['category'],
        "Keyword": message.text
    }).execute()
    await message.answer(f"✅ Successfully added to {user_data['category']}!")
    await state.clear()
    
