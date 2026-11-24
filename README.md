# LIARS BAR — Telegram multiplayer bot

Node.js + Telegraf + PostgreSQL + Render. Supports Uzbek, Russian, English and Turkish UI, isolated games per group, private registration, turn-based card play, bluff/challenge flow, profiles, and admin commands.

## 1. Create Telegram bot
1. Open `@BotFather`, run `/newbot`.
2. Copy the token. Do not share it in public or commit it to GitHub.
3. Set bot username in `BOT_USERNAME` (without `@`).

## 2. Configure
Copy `.env.example` to `.env` and fill:
- `BOT_TOKEN`
- `BOT_USERNAME`
- `DATABASE_URL`
- `ADMIN_IDS` (your numeric Telegram ID)
- `PUBLIC_URL`
- `WEBHOOK_SECRET`

For local testing, create a PostgreSQL database. `PG_SSL=false` can be used locally if your database does not require SSL.

## 3. Run locally
```bash
npm install
npm start
```
Open `http://localhost:3000/health`. For local Telegram webhook testing, expose the server with a secure HTTPS tunnel and set `PUBLIC_URL`.

## 4. Deploy on Render
1. Push this folder to a new GitHub repository.
2. In Render choose **New → Blueprint**, connect the repository and apply `render.yaml`.
3. Fill `BOT_TOKEN`, `BOT_USERNAME`, `ADMIN_IDS`, `PUBLIC_URL` in Render environment variables.
4. Wait for deploy. Check `/health`.
5. Add the bot to your Telegram group as administrator. Grant **Delete messages** permission. Group language is selected after the bot joins.

## 5. Telegram commands
Private:
- `/start` — choose language / open private menu
- `/lang` — change private language
- `/profile` — profile and stats

Group:
- `/game` — create registration lobby (bot must be admin)
- `/cancelgame` — cancel current lobby/game (group admins)
- `/language` — change this group's game language

Admin:
- `/admin` — admin commands
- `/stats` — global stats
- Reply to a photo or GIF with `/setroundmedia` to set round media.
- Reply to a photo or GIF with `/sethandmedia` to set private hand media.
- `/broadcast your message` — send a plain text announcement to users who started the bot.

## Gameplay notes
- A lobby opens with an invite button. Players must open the bot and press Start; Telegram does not allow bots to force-open a private chat.
- Each player receives five cards privately.
- The round rank is randomly selected from Ace, King, Queen, Joker.
- The active player selects one or more cards and submits them. Cards are not validated against the announced rank; bluffing is the point.
- Other players can challenge or accept. A challenge reveals the submitted cards. If the claim was false, the player who lied takes the Russian-roulette shot; if true, the challenger takes it.
- Roulette has one bullet in six chambers. A shot removes one life; surviving keeps the player in the game. The game ends when one player remains.
- This project uses a basic 6-life model as a practical default. Tune `CHAMBERS` and `START_LIVES` in `src/game.js` if you want a different rule.

## Important production notes
- The bot must be a group admin with Delete Messages permission to clean up group chat messages.
- Telegram bots cannot delete every message type in every situation; deletion is best-effort.
- The bot cannot message a user privately until the user has opened the bot at least once.
- Keep secrets in Render environment variables, never in GitHub.
