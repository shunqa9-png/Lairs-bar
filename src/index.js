require("dotenv").config();
const express = require("express");
const { Telegraf, Markup } = require("telegraf");
const db = require("./db");
const {languages,t}=require("./i18n");
const G = require("./game");

const required=["BOT_TOKEN","BOT_USERNAME","DATABASE_URL","PUBLIC_URL","WEBHOOK_SECRET"];
for(const k of required) if(!process.env[k]) { console.error(`Missing env: ${k}`); process.exit(1); }
const bot=new Telegraf(process.env.BOT_TOKEN);
const app=express();
const PORT=process.env.PORT||3000;
const admins=(process.env.ADMIN_IDS||"").split(",").map(x=>x.trim()).filter(Boolean);
const games=new Map();
const pendingLang=new Map();
const pendingMedia=new Map();
const userLang=new Map();
const groupLang=new Map();
const langKeys=["uz","ru","en","tr"];
const isAdmin=id=>admins.includes(String(id));
const esc=s=>String(s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const mention=p=>`<a href="tg://user?id=${p.id}">${esc(p.name)}</a>`;
const langKeyboard=(prefix)=>Markup.inlineKeyboard([
  [Markup.button.callback("🇺🇿 O‘zbekcha",`${prefix}:uz`),Markup.button.callback("🇷🇺 Русский",`${prefix}:ru`)],
  [Markup.button.callback("🇬🇧 English",`${prefix}:en`),Markup.button.callback("🇹🇷 Türkçe",`${prefix}:tr`)]
]);
const getUL=async id=>userLang.get(String(id))||(await db.getUser(id))?.language||"uz";
const getGL=async id=>groupLang.get(String(id))||(await db.getGroup(id))?.language||"uz";
const tUser=async(id,key)=>t(await getUL(id),key);
const tGroup=async(id,key)=>t(await getGL(id),key);
async function save(game){games.set(String(game.chatId),game);await db.saveGame(game);}
async function botAdmin(chatId){
  try{const m=await bot.telegram.getChatMember(chatId,bot.botInfo.id);return ["administrator","creator"].includes(m.status)&&!!m.can_delete_messages;}
  catch{return false;}
}
async function safeDelete(chatId,messageId){try{await bot.telegram.deleteMessage(chatId,messageId);}catch{}}
async function cleanGroupMessage(ctx,game){
  if(game?.status==="playing" && ctx.message?.message_id) await safeDelete(ctx.chat.id,ctx.message.message_id);
}
function lobbyText(game,lang){
  const rows=game.players.map((p,i)=>`${i+1}. ${mention(p)}`).join("\n")||"—";
  return `🎴 <b>${t(lang,"registration")}</b>\n\n<b>${t(lang,"registered")}</b>\n${rows}\n\n${t(lang,"total")}: <b>${game.players.length}</b> ${t(lang,"players")}`;
}
async function renderLobby(game){
  const text=lobbyText(game,game.language);
  const keyboard=Markup.inlineKeyboard([[Markup.button.url(t(game.language,"join"),`https://t.me/${process.env.BOT_USERNAME}?start=join_${game.id}`)]]);
  if(game.messageId){try{await bot.telegram.editMessageText(game.chatId,game.messageId,undefined,text,{parse_mode:"HTML",...keyboard});return;}catch{}}
  const m=await bot.telegram.sendMessage(game.chatId,text,{parse_mode:"HTML",...keyboard});
  game.messageId=m.message_id;
}
async function groupRoundMessage(game,extra=""){
  const p=G.currentPlayer(game);
  const lang=game.language;
  const media=await db.getSetting("round_media");
  const text=`🎴 <b>${game.round} ${t(lang,"round")}</b>\n${t(lang,"rank")}: <b>${game.target}</b>\n\n${p?`${mention(p)} — ${t(lang,"turn")}`:""}${extra?`\n\n${extra}`:""}`;
  const kb=Markup.inlineKeyboard([[Markup.button.callback(t(lang,"viewCards"),`view:${game.id}:${p?.id||0}`)]]);
  if(media){try{
    const obj=JSON.parse(media);
    if(obj.type==="animation") await bot.telegram.sendAnimation(game.chatId,obj.file_id,{caption:text,parse_mode:"HTML",...kb});
    else await bot.telegram.sendPhoto(game.chatId,obj.file_id,{caption:text,parse_mode:"HTML",...kb});
    return;
  }catch{}}
  await bot.telegram.sendMessage(game.chatId,text,{parse_mode:"HTML",...kb});
}
async function privateHand(game,player){
  const lang=game.language;
  const media=await db.getSetting("hand_media");
  const hand=player.cards.map((c,i)=>`${i+1}. ${c}`).join("\n")||"—";
  const text=`🃏 <b>${t(lang,"profileText")}</b>\n\n${hand}\n\n${t(lang,"playPrompt")}`;
  if(media){try{const obj=JSON.parse(media);if(obj.type==="animation")await bot.telegram.sendAnimation(player.id,obj.file_id,{caption:text,parse_mode:"HTML"});else await bot.telegram.sendPhoto(player.id,obj.file_id,{caption:text,parse_mode:"HTML"});}catch{}}
  const buttons=player.cards.map((c,i)=>[Markup.button.callback(`${c} ${player.selected?.includes(i)?"☑️":" "}`,`pick:${game.id}:${player.id}:${i}`)]);
  buttons.push([Markup.button.callback(t(lang,"random"),`random:${game.id}:${player.id}`)]);
  buttons.push([Markup.button.callback(t(lang,"throw"),`throw:${game.id}:${player.id}`)]);
  await bot.telegram.sendMessage(player.id,text,{parse_mode:"HTML",...Markup.inlineKeyboard(buttons)});
}
async function beginGame(game){
  G.startGame(game); await save(game);
  await bot.telegram.sendMessage(game.chatId,`🎉 <b>${t(game.language,"started")}</b>`,{parse_mode:"HTML"});
  setTimeout(async()=>{try{await groupRoundMessage(game);const p=G.currentPlayer(game);if(p)await bot.telegram.sendMessage(p.id,`🎴 ${t(game.language,"playPrompt")}`,{reply_markup:Markup.inlineKeyboard([[Markup.button.callback(t(game.language,"viewCards"),`view:${game.id}:${p.id}`)]])});}catch(e){console.error(e.message);}},1000);
}
async function advance(game,extra=""){
  const result=G.nextTurn(game);
  if(result.winner){await endGame(game,result.winner);return;}
  await save(game);
  await groupRoundMessage(game,extra);
}
async function endGame(game,winner){
  game.status="finished";await db.finishGame(game);
  await db.recordResult(game.players,winner?.id);
  await bot.telegram.sendMessage(game.chatId,`🏆 <b>${t(game.language,"winner")}: ${winner?mention(winner):"—"}</b>`,{parse_mode:"HTML"});
}
async function startRegistration(ctx){
  const chat=ctx.chat;
  if(!["group","supergroup"].includes(chat.type)){return ctx.reply("Use /game in a group.");}
  const ok=await botAdmin(chat.id);
  if(!ok){return ctx.reply(await tGroup(chat.id,"adminNeeded"));}
  const old=games.get(String(chat.id))||await db.getActiveGame(chat.id);
  if(old && ["lobby","playing"].includes(old.status))return ctx.reply(t(await getGL(chat.id),"gameExists"));
  const lang=await getGL(chat.id);
  const game=G.createGame(chat.id,lang,ctx.from);
  await save(game);
  const m=await ctx.reply(lobbyText(game,lang),{parse_mode:"HTML",...Markup.inlineKeyboard([[Markup.button.url(t(lang,"join"),`https://t.me/${process.env.BOT_USERNAME}?start=join_${game.id}`)]])});
  game.messageId=m.message_id;await save(game);
}
async function joinGame(ctx,gameId){
  const game=[...games.values()].find(g=>g.id===gameId)||null;
  if(!game || game.status!=="lobby")return ctx.reply("This registration is closed.");
  const result=G.addPlayer(game,ctx.from);
  if(!result.ok)return ctx.reply(t(game.language,result.reason==="exists"?"alreadyJoined":"noGame"));
  await db.upsertUser(ctx.from);
  await save(game);await ctx.reply(t(game.language,"joined"),{...Markup.inlineKeyboard([[Markup.button.url(t(game.language,"back"),`https://t.me/${process.env.BOT_USERNAME}?start=return_${game.id}`)]])});
  await renderLobby(game);
  if(game.players.length>=4) await beginGame(game);
}
bot.start(async ctx=>{
  const payload=ctx.startPayload;
  await db.upsertUser(ctx.from);
  if(payload?.startsWith("join_")) return joinGame(ctx,payload.slice(5));
  if(payload?.startsWith("return_")) return ctx.reply(await tUser(ctx.from.id,"hello"),privateMenu(await getUL(ctx.from.id)));
  const user=await db.getUser(ctx.from.id);
  if(!user){pendingLang.set(String(ctx.from.id),true);return ctx.reply(t("uz","choose"),langKeyboard("ulang"));}
  return ctx.reply(t(user.language,"hello"),privateMenu(user.language));
});
function privateMenu(lang){
  return Markup.inlineKeyboard([
    [Markup.button.url(t(lang,"add"),`https://t.me/${process.env.BOT_USERNAME}?startgroup=true`)],
    [Markup.button.callback(t(lang,"groups"),"groups"),Markup.button.callback(t(lang,"news"),"news")],
    [Markup.button.callback(t(lang,"help"),"help"),Markup.button.callback(t(lang,"profile"),"profile")],
    [Markup.button.callback(t(lang,"lang"),"change_lang")]
  ]);
}
bot.command("lang",async ctx=>ctx.reply(t(await getUL(ctx.from.id),"choose"),langKeyboard("ulang")));
bot.command("profile",async ctx=>{
  const lang=await getUL(ctx.from.id),u=await db.getUser(ctx.from.id);
  ctx.reply(`👤 <b>${t(lang,"profileText")}</b>\n\n${esc(u?.first_name||ctx.from.first_name)}\n${t(lang,"games")}: ${u?.games_played||0}\n${t(lang,"wins")}: ${u?.wins||0}`,{parse_mode:"HTML"});
});
bot.command("game",startRegistration);
bot.command("language",async ctx=>{
  if(!["group","supergroup"].includes(ctx.chat.type))return;
  const member=await ctx.getChatMember(ctx.from.id);
  if(!["administrator","creator"].includes(member.status))return ctx.reply("Only group admins can change the language.");
  await ctx.reply(t(await getGL(ctx.chat.id),"selectGroupLang"),langKeyboard("glang"));
});
bot.command("cancelgame",async ctx=>{
  const member=await ctx.getChatMember(ctx.from.id);
  if(!["administrator","creator"].includes(member.status))return;
  const game=games.get(String(ctx.chat.id));
  if(game){game.status="cancelled";await db.finishGame(game);games.delete(String(ctx.chat.id));}
  ctx.reply(t(await getGL(ctx.chat.id),"cancelled"));
});
bot.command("admin",ctx=>{if(isAdmin(ctx.from.id))ctx.reply(t("uz","adminMenu"));});
bot.command("stats",async ctx=>{if(!isAdmin(ctx.from.id))return;const s=await db.stats();ctx.reply(`Users: ${s.users}\nGroups: ${s.groups}\nGames: ${s.games}`);});
bot.command("broadcast",async ctx=>{
  if(!isAdmin(ctx.from.id))return;
  const message=ctx.message.text.replace(/^\/broadcast(@\w+)?\s*/,"");
  if(!message)return ctx.reply("Usage: /broadcast Your message");
  const ids=await db.allUserIds();let sent=0;
  for(const id of ids){try{await bot.telegram.sendMessage(id,message);sent++;}catch{}}
  ctx.reply(`Broadcast sent: ${sent}/${ids.length}`);
});
bot.on("my_chat_member",async ctx=>{
  const chat=ctx.chat, status=ctx.update.my_chat_member.new_chat_member.status;
  if(["group","supergroup"].includes(chat.type)){
    const admin=["administrator","creator"].includes(status);
    await db.upsertGroup(chat,admin);
    if(admin){pendingLang.set(`g:${chat.id}`,true);await ctx.telegram.sendMessage(chat.id,t("uz","groupAdded"),langKeyboard("glang"));}
  }
});
bot.on("message",async ctx=>{
  if(!["group","supergroup"].includes(ctx.chat.type))return;
  const game=games.get(String(ctx.chat.id));
  if(game?.status==="playing" && ctx.message.text?.startsWith("/")!==true) await cleanGroupMessage(ctx,game);
  if(ctx.message.reply_to_message && isAdmin(ctx.from.id)){
    const text=ctx.message.text||"";
    if(text.startsWith("/setroundmedia")||text.startsWith("/sethandmedia")){
      const m=ctx.message.reply_to_message;
      const media=m.animation?{type:"animation",file_id:m.animation.file_id}:m.photo?{type:"photo",file_id:m.photo.at(-1).file_id}:null;
      if(!media)return ctx.reply("Reply to a photo or GIF.");
      const key=text.startsWith("/setroundmedia")?"round_media":"hand_media";
      await db.setSetting(key,JSON.stringify(media));return ctx.reply("Media saved.");
    }
  }
});
bot.on("callback_query",async ctx=>{
  const data=ctx.callbackQuery.data||"";
  try{
    if(data.startsWith("ulang:")){
      const lang=data.split(":")[1];if(!langKeys.includes(lang))return;
      await db.setUserLanguage(ctx.from.id,lang);userLang.set(String(ctx.from.id),lang);
      await ctx.answerCbQuery();return ctx.editMessageText(t(lang,"hello"),privateMenu(lang));
    }
    if(data.startsWith("glang:")){
      const lang=data.split(":")[1];if(!langKeys.includes(lang))return;
      const chatId=ctx.chat?.id;
      if(!chatId)return ctx.answerCbQuery();
      const member=await ctx.telegram.getChatMember(chatId,ctx.from.id);
      if(!["administrator","creator"].includes(member.status))return ctx.answerCbQuery("Group admins only");
      await db.upsertGroup(ctx.chat);await db.setGroupLanguage(chatId,lang);groupLang.set(String(chatId),lang);
      await ctx.answerCbQuery();return ctx.editMessageText(t(lang,"adminThanks"));
    }
    if(data==="change_lang")return ctx.editMessageText(t(await getUL(ctx.from.id),"choose"),langKeyboard("ulang"));
    if(data==="profile"){const u=await db.getUser(ctx.from.id);const l=await getUL(ctx.from.id);return ctx.editMessageText(`${t(l,"profileText")}\n${t(l,"games")}: ${u?.games_played||0}\n${t(l,"wins")}: ${u?.wins||0}`);}
    if(data==="help")return ctx.answerCbQuery(t(await getUL(ctx.from.id),"helpText"),{show_alert:true});
    if(data==="news")return ctx.answerCbQuery("LIARS BAR — news coming soon.",{show_alert:true});
    if(data==="groups")return ctx.answerCbQuery("Add the bot to a group to play.",{show_alert:true});
    const [action,gid,uid,arg]=data.split(":");
    const game=[...games.values()].find(g=>g.id===gid);
    if(!game)return ctx.answerCbQuery("Game not found.");
    if(action==="view"){
      const player=game.players.find(p=>p.id===ctx.from.id);
      if(!player)return ctx.answerCbQuery(t(game.language,"notYourGame"),{show_alert:true});
      if(G.currentPlayer(game)?.id!==ctx.from.id)return ctx.answerCbQuery(t(game.language,"notYourTurn"),{show_alert:true});
      player.selected=[];await save(game);await ctx.answerCbQuery();return privateHand(game,player);
    }
    if(action==="pick"){
      if(Number(uid)!==ctx.from.id)return ctx.answerCbQuery();
      const p=game.players.find(x=>x.id===ctx.from.id);
      if(!p || G.currentPlayer(game)?.id!==p.id)return ctx.answerCbQuery(t(game.language,"notYourTurn"),{show_alert:true});
      p.selected=p.selected||[];
      const i=Number(arg);p.selected=p.selected.includes(i)?p.selected.filter(x=>x!==i):[...p.selected,i];
      await save(game);await ctx.answerCbQuery("✓");return ctx.editMessageReplyMarkup(Markup.inlineKeyboard([
        ...p.cards.map((c,j)=>[Markup.button.callback(`${c} ${p.selected.includes(j)?"☑️":" "}`,`pick:${gid}:${p.id}:${j}`)]),
        [Markup.button.callback(t(game.language,"random"),`random:${gid}:${p.id}`)],
        [Markup.button.callback(t(game.language,"throw"),`throw:${gid}:${p.id}`)]
      ]).reply_markup);
    }
    if(action==="random"){
      const p=game.players.find(x=>x.id===ctx.from.id);
      if(!p||G.currentPlayer(game)?.id!==p.id)return ctx.answerCbQuery(t(game.language,"notYourTurn"),{show_alert:true});
      const count=Math.min(p.cards.length,1+Math.floor(Math.random()*2));
      p.selected=[];while(p.selected.length<count){const i=Math.floor(Math.random()*p.cards.length);if(!p.selected.includes(i))p.selected.push(i);}
      await save(game);await ctx.answerCbQuery("Random selected");
      return ctx.editMessageReplyMarkup(Markup.inlineKeyboard([
        ...p.cards.map((c,j)=>[Markup.button.callback(`${c} ${p.selected.includes(j)?"☑️":" "}`,`pick:${gid}:${p.id}:${j}`)]),
        [Markup.button.callback(t(game.language,"throw"),`throw:${gid}:${p.id}`)]
      ]).reply_markup);
    }
    if(action==="throw"){
      const p=game.players.find(x=>x.id===ctx.from.id);
      if(!p||G.currentPlayer(game)?.id!==p.id)return ctx.answerCbQuery(t(game.language,"notYourTurn"),{show_alert:true});
      const indexes=p.selected||[];
      if(!indexes.length)return ctx.answerCbQuery(t(game.language,"chooseCards"),{show_alert:true});
      const res=G.playCards(game,p.id,indexes);
      if(!res.ok)return ctx.answerCbQuery("Cannot play those cards.");
      await save(game);await ctx.answerCbQuery(t(game.language,"sent"));
      await bot.telegram.sendMessage(game.chatId,`🃏 <b>${mention(p)}</b> ${res.played.length} ${t(game.language,"sent")}`,{parse_mode:"HTML"});
      const active=G.activePlayers(game);
      const next=G.nextActiveAfter(game,p.id);
      if(next)await bot.telegram.sendMessage(game.chatId,t(game.language,"believe"),{reply_markup:Markup.inlineKeyboard([
        [Markup.button.callback(t(game.language,"believeBtn"),`believe:${gid}:${next.id}`)],
        [Markup.button.callback(t(game.language,"doubt"),`doubt:${gid}:${next.id}`)]
      ])});
      return;
    }
    if(action==="believe"){
      if(Number(uid)!==ctx.from.id)return ctx.answerCbQuery();
      if(!game.pending)return ctx.answerCbQuery("No pending cards.");
      const expected=G.nextActiveAfter(game,game.pending.playerId);
      if(expected?.id!==ctx.from.id)return ctx.answerCbQuery(t(game.language,"notYourTurn"),{show_alert:true});
      await ctx.answerCbQuery();
      await bot.telegram.sendMessage(game.chatId,`${mention(ctx.from)} ${t(game.language,"believeBtn")}`,{parse_mode:"HTML"});
      return advance(game);
    }
    if(action==="doubt"){
      if(Number(uid)!==ctx.from.id)return ctx.answerCbQuery();
      if(!game.pending)return ctx.answerCbQuery("No pending cards.");
      const expected=G.nextActiveAfter(game,game.pending.playerId);
      if(expected?.id!==ctx.from.id)return ctx.answerCbQuery(t(game.language,"notYourTurn"),{show_alert:true});
      const result=G.resolveChallenge(game,ctx.from.id);
      await save(game);await ctx.answerCbQuery();
      const cards=result.played.join(", ");
      const msg=`🔎 <b>${t(game.language,"reveal")}</b>\n${cards}\n\n${result.liar?t(game.language,"lie"):t(game.language,"truth")}\n${t(game.language,"shot")}: ${result.hit?"💥 HIT":"🟢 SAFE"}\n${mention(game.players.find(p=>p.id===result.targetId))}: ${result.hit?(game.players.find(p=>p.id===result.targetId)?.lives??"—"):"—"} ${result.hit?"❤️":""}`;
      await bot.telegram.sendMessage(game.chatId,msg,{parse_mode:"HTML"});
      if(result.winner)return endGame(game,result.winner);
      return groupRoundMessage(game);
    }
  }catch(e){console.error("callback error",e);try{await ctx.answerCbQuery("Error. Try again.");}catch{}}
});
async function boot(){
  await db.initDb();
  const restored=await db.loadActiveGames();
  for(const game of restored){games.set(String(game.chatId),game);}
  const secret=process.env.WEBHOOK_SECRET;
  app.get("/health",(_,res)=>res.json({ok:true,service:"liars-bar",games:games.size}));
  app.use(express.json());
  app.post(`/telegram/${secret}`,async(req,res)=>{
    try{await bot.handleUpdate(req.body);res.sendStatus(200);}catch(e){console.error(e);res.sendStatus(500);}
  });
  const server=app.listen(PORT,async()=>{
    const url=`${process.env.PUBLIC_URL}/telegram/${secret}`;
    try{await bot.telegram.setWebhook(url,{allowed_updates:["message","callback_query","my_chat_member"]});console.log("Webhook set:",url);}
    catch(e){console.error("Webhook error:",e.message);}
    console.log(`LIARS BAR listening on ${PORT}`);
  });
}
boot().catch(e=>{console.error(e);process.exit(1);});
