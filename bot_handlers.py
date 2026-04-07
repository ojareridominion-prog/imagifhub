import base64
import logging
import requests
import urllib.parse
from datetime import datetime, timedelta
from aiogram import F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton, PreCheckoutQuery, ContentType
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from config import bot, dp, supabase, ADMIN_ID, IMGBB_API_KEY, BOT_TOKEN, CATEGORIES
from aiogram.types import LabeledPrice

# Warn if ImgBB API key is missing (for debugging)
if not IMGBB_API_KEY:
    logging.warning("⚠️ IMGBB_API_KEY is not set in environment. Admin uploads will fail with 'forbidden' errors.")

# ==================== ADSGRAM CONFIGURATION ====================
AD_BLOCK_ID = "bot-27158"
ADSGRAM_BASE_URL = "https://adsgram.ai/block"
REWARD_URL_BASE = "https://imagifhub.onrender.com/adsgram-reward"

# Rate limiting
AD_COOLDOWN_SECONDS = 120          # 2 minutes between ads
AD_MAX_PER_HOUR = 5                # Max 5 ads per hour
AD_COMMAND_INTERVAL = 3            # Show ad every 3 commands

# In-memory rate tracking (replace with Redis for multi-instance)
_user_ad_tracker = {}   # user_id -> {"last_ad": timestamp, "hour_count": int, "command_count": int}

def _can_send_ad(user_id: int) -> bool:
    """Check if a user is allowed to see an ad (premium & rate limits)."""
    now = datetime.utcnow().timestamp()
    tracker = _user_ad_tracker.get(user_id, {})
    
    # Premium users never see ads
    if is_user_premium_sync(user_id):
        return False
    
    # Cooldown
    last_ad = tracker.get("last_ad", 0)
    if now - last_ad < AD_COOLDOWN_SECONDS:
        return False
    
    # Hourly cap
    hour_count = tracker.get("hour_count", 0)
    if hour_count >= AD_MAX_PER_HOUR:
        return False
    
    return True

def _record_ad_sent(user_id: int):
    """Update counters after an ad is sent."""
    now = datetime.utcnow().timestamp()
    tracker = _user_ad_tracker.get(user_id, {})
    tracker["last_ad"] = now
    tracker["hour_count"] = tracker.get("hour_count", 0) + 1
    _user_ad_tracker[user_id] = tracker

def _increment_command_counter(user_id: int) -> int:
    """Increment the command counter and return the new count."""
    tracker = _user_ad_tracker.get(user_id, {})
    count = tracker.get("command_count", 0) + 1
    tracker["command_count"] = count
    _user_ad_tracker[user_id] = tracker
    return count

def _reset_command_counter(user_id: int):
    """Reset the command counter after an ad is shown."""
    if user_id in _user_ad_tracker:
        _user_ad_tracker[user_id]["command_count"] = 0

def is_user_premium_sync(user_id: int) -> bool:
    """
    Synchronous premium check (cached or direct DB lookup).
    Reuses your existing logic.
    """
    try:
        res = supabase.table("users").select("is_premium, premium_expires_at").eq("telegram_id", user_id).execute()
        if not res.data:
            return False
        data = res.data[0]
        is_premium = data.get("is_premium", False)
        expires = data.get("premium_expires_at")
        if is_premium and expires:
            try:
                exp_str = expires.replace('Z', '+00:00')
                exp = datetime.fromisoformat(exp_str)
                now = datetime.utcnow().replace(tzinfo=None)
                if exp.tzinfo is not None:
                    exp = exp.replace(tzinfo=None)
                if exp > now:
                    return True
            except:
                pass
        return False
    except:
        return False

async def maybe_send_ad(message: Message) -> bool:
    """
    Decide whether to send an ad to the user.
    Returns True if an ad was sent, False otherwise.
    """
    user_id = message.from_user.id
    
    # Increment command counter
    cmd_count = _increment_command_counter(user_id)
    
    # Check if it's time to show an ad (every N commands + rate limits)
    if cmd_count % AD_COMMAND_INTERVAL == 0 and _can_send_ad(user_id):
        # Build the AdsGram URL with reward callback
        reward_url = f"{REWARD_URL_BASE}?user_id={user_id}"
        encoded_reward = urllib.parse.quote(reward_url, safe='')
        ad_url = f"{ADSGRAM_BASE_URL}/{AD_BLOCK_ID}?user_id={user_id}&reward_url={encoded_reward}"
        
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="📢 Watch ad (supports us)", url=ad_url)],
            [InlineKeyboardButton(text="🚫 Skip", callback_data="skip_ad")]
        ])
        
        await message.answer(
            "✨ **Support IMAGIFHUB** ✨\n\n"
            "This bot is free thanks to our sponsors.\n"
            "Please watch a short ad to keep the service alive.\n\n"
            "*(Premium users never see ads – upgrade with /premium)*",
            reply_markup=keyboard,
            parse_mode="Markdown"
        )
        
        # Record that we sent an ad
        _record_ad_sent(user_id)
        _reset_command_counter(user_id)
        return True
    
    return False

@dp.callback_query(F.data == "skip_ad")
async def skip_ad_callback(call: CallbackQuery):
    await call.answer("You can upgrade to premium to remove all ads.", show_alert=False)
    await call.message.delete()

# ==================== DEFINE STATES ====================
class AdminUpload(StatesGroup):
    waiting_media = State()
    waiting_category = State()
    waiting_keywords = State()

# ==================== PAYMENT HANDLERS ====================

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
    """Handle successful payment – grant premium access"""
    try:
        payment = message.successful_payment
        telegram_id = message.from_user.id
        expires_at = datetime.utcnow() + timedelta(days=30)

        logging.info(f"💰 Successful payment from user {telegram_id}, amount={payment.total_amount} {payment.currency}")

        # --- STEP 1: Upsert user (create if not exists, set premium) ---
        user_data = {
            "telegram_id": telegram_id,
            "is_premium": True,
            "premium_expires_at": expires_at.isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }
        supabase.table("users").upsert(user_data).execute()
        logging.info(f"✅ User {telegram_id} upserted with premium until {expires_at.isoformat()}")

        # --- STEP 2: Insert payment record (now foreign key is satisfied) ---
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
            "✅ Your premium access is active for 30 days.\n"
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
    # Show ad if needed (returns True if ad was sent and we should stop further processing)
    if await maybe_send_ad(message):
        return   # ad message is already sent, don't show the usual start message

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
    # Show ad if needed (but premium users will be skipped by maybe_send_ad anyway)
    if await maybe_send_ad(message):
        return

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

@dp.callback_query(F.data == "back_to_premium")
async def back_to_premium_callback(call: CallbackQuery):
    await call.answer()
    await cmd_premium(call.message)

@dp.callback_query(F.data == "renew_premium")
async def renew_premium_callback(call: CallbackQuery):
    await get_premium_callback(call)

@dp.message(F.text.startswith("/start premium"))
async def start_premium(message: Message):
    await cmd_premium(message)

# ==================== ADMIN COMMANDS ====================

@dp.message(F.from_user.id == ADMIN_ID, F.text == "/admin")
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
    
