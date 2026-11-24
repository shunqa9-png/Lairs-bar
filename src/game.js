const crypto = require("crypto");
const RANKS = ["Ace","King","Queen","Joker"];
const START_LIVES = 6;
const CHAMBERS = 6;
const id = () => crypto.randomBytes(5).toString("hex");

function createGame(chatId, language, creator) {
  return { id:id(), chatId, language, status:"lobby", creatorId:creator.id,
    players:[], round:0, target:null, turnIndex:0, pending:null, messageId:null,
    createdAt:Date.now(), lastActionAt:Date.now() };
}
function addPlayer(game, user) {
  if (game.status !== "lobby") return {ok:false, reason:"closed"};
  if (game.players.some(p=>p.id===user.id)) return {ok:false,reason:"exists"};
  game.players.push({id:user.id, username:user.username||null, name:user.first_name||"Player",
    cards:[], lives:START_LIVES, eliminated:false, shots:0});
  return {ok:true};
}
function shuffle(a) {
  const x=[...a];
  for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];}
  return x;
}
function startGame(game) {
  if(game.players.length<4) return false;
  game.status="playing";
  game.players.forEach(p=>{p.cards=shuffle([...RANKS,...RANKS,...RANKS]).slice(0,5);});
  game.turnIndex=0;
  startRound(game);
  return true;
}
function activePlayers(game){return game.players.filter(p=>!p.eliminated);}
function currentPlayer(game){const a=activePlayers(game); if(!a.length)return null; return a[game.turnIndex%a.length];}
function startRound(game) {
  game.round++;
  game.target=RANKS[Math.floor(Math.random()*RANKS.length)];
  game.pending=null;
  game.players.forEach(p=>{if(!p.eliminated && p.cards.length===0)p.cards=shuffle([...RANKS,...RANKS,...RANKS]).slice(0,5);});
}
function playCards(game, playerId, indexes) {
  const p=game.players.find(x=>x.id===playerId);
  if(!p || p.eliminated || currentPlayer(game)?.id!==playerId || game.pending || !indexes.length) return {ok:false};
  const unique=[...new Set(indexes)].sort((a,b)=>b-a);
  if(unique.some(i=>i<0||i>=p.cards.length))return {ok:false};
  const played=unique.map(i=>p.cards[i]);
  unique.forEach(i=>p.cards.splice(i,1));
  game.pending={playerId,playerName:p.name,cards:played,claim:game.target,createdAt:Date.now()};
  return {ok:true,played};
}
function nextTurn(game) {
  const a=activePlayers(game);
  if(a.length<=1){game.status="finished";return {winner:a[0]||null};}
  game.turnIndex=(game.turnIndex+1)%a.length;
  if(game.turnIndex===0) startRound(game);
  return {winner:null};
}
function resolveChallenge(game, challengerId) {
  const pending=game.pending;
  if(!pending || pending.playerId===challengerId) return null;
  const liar=pending.cards.some(c=>c!==pending.claim);
  const targetId=liar?pending.playerId:challengerId;
  const target=game.players.find(p=>p.id===targetId);
  const chamber=Math.floor(Math.random()*CHAMBERS);
  const hit=chamber===0;
  let eliminated=false;
  if(hit){target.lives--;target.shots++;if(target.lives<=0){target.eliminated=true;eliminated=true;}}
  const result={liar,hit,eliminated,targetId,targetName:target.name,played:pending.cards,claim:pending.claim};
  game.pending=null;
  const active=activePlayers(game);
  if(active.length<=1){game.status="finished";result.winner=active[0]||null;return result;}
  // The challenged player / challenger who received the consequence gets the next turn.
  const idx=active.findIndex(p=>p.id===targetId);
  game.turnIndex=idx>=0?idx:game.turnIndex%active.length;
  return result;
}
function passPending(game, playerId) {
  if(!game.pending || currentPlayer(game)?.id===game.pending.playerId) return false;
  // Only the next active player can decide; group callback enforces the current turn.
  return true;
}
module.exports={RANKS,START_LIVES,createGame,addPlayer,startGame,currentPlayer,activePlayers,startRound,playCards,nextTurn,resolveChallenge,passPending,nextActiveAfter};
