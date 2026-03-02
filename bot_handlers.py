import logging
import requests
from datetime import datetime, timedelta
from aiogram import F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton, PreCheckoutQuery, ContentType
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from config import bot, dp, supabase, ADMIN_ID, IMGBB_API_KEY, BOT_TOKEN, CATEGORIES
from aiogram.types import LabeledPrice

# Define states
class AdminUpload(StatesGroup):
    waiting_media = State()
    waiting_category = State()
    waiting_keywords = State()

# Payment handlers
@dp.pre_checkout_query()
async def on_pre_checkout_query(pre_checkout_query: PreCheckoutQuery):
    await bot.answer_pre_checkout_query(pre_checkout_query.id, ok=True)

@dp.message(F.content_type == ContentType.SUCCESSFUL_PAYMENT)
async def on_successful_payment(message: Message):
    try:
        payment = message.successful_payment
        telegram_id = message.from_user.id
        expires_at = datetime.utcnow() + timedelta(days=30)
        
        supabase.table("payments").insert({
            "telegram_id": telegram_id,
            "provider": "telegram_stars",
            "amount": payment.total_amount,
            "currency": payment.currency,
            "payload": payment.invoice_payload,
            "transaction_id": payment.telegram_payment_charge_id,
            "status": "completed"
        }).execute()

        supabase.table("users").upsert({
            "telegram_id": telegram_id,
            "is_premium": True,
            "premium_expires_at": expires_at.isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }).execute()

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
        logging.error(f"Payment DB Error: {e}")
        await message.answer("Payment received, but there was an error activating premium. Please contact support.")

# Bot commands
@dp.message(F.text == "/start")
async def cmd_start(message: Message):
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
            return
        
        user_data = user_result.data[0]
        is_premium = user_data.get("is_premium", False)
        premium_expires_at = user_data.get("premium_expires_at")
        
        # Handle boolean
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
        
        # Not premium
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

# Admin commands
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
    file_id = message.photo[-1].file_id
    file = await bot.get_file(file_id)
    media_url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file.file_path}"
    
    resp = requests.post(
        "https://api.imgbb.com/1/upload",
        params={'key': IMGBB_API_KEY, 'image': media_url}
    )
    
    if resp.status_code == 200:
        final_url = resp.json()['data']['url']
        await state.update_data(url=final_url)
        btns = []
        for i in range(0, len(CATEGORIES), 2):
            row = [InlineKeyboardButton(text=c, callback_data=f"set_{c}") for c in CATEGORIES[i:i+2]]
            btns.append(row)
        await message.answer("Select the Category:", reply_markup=InlineKeyboardMarkup(inline_keyboard=btns))
        await state.set_state(AdminUpload.waiting_category)
    else:
        await message.answer("❌ Error uploading to ImgBB.")

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
