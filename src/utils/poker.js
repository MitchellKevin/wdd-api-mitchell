// src/utils/poker.js - Poker game logic for Deck of Cards API (Texas Hold'em, 1 player + 3 bots)

// Card parsing
function parseCard(card) {
  const values = {'A':14, 'K':13, 'Q':12, 'J':11, 'T':10, '9':9, '8':8, '7':7, '6':6, '5':5, '4':4, '3':3, '2':2};
  const suits = {'S':'s', 'H':'h', 'D':'d', 'C':'c'};
  return {
    value: values[card.value] || card.value,
    suit: suits[card.suit] || card.suit,
    code: card.code,
    image: `https://deckofcardsapi.com/static/img/${card.code}P.png`
  };
}

// Fetch new shuffled deck
async function fetchDeck() {
  const res = await fetch('https://deckofcardsapi.com/api/deck/new/shuffle/?deck_count=1');
  const data = await res.json();
  return data.deck_id;
}

// Draw N cards
async function drawCards(deckId, count) {
  const res = await fetch(`https://deckofcardsapi.com/api/deck/${deckId}/draw/?count=${count}`);
  const data = await res.json();
  return data.cards.map(parseCard);
}

// Hand strength evaluator (simplified ranks: high card to royal flush)
// Returns rank score (higher better), hand type string
function evaluateHand(hole, community = []) {
  const hand = [...hole, ...community].sort((a,b) => b.value - a.value);
  const values = hand.map(c => c.value);
  const suits = hand.map(c => c.suit);
  const counts = {};
  values.forEach(v => counts[v] = (counts[v] || 0) + 1);
  const countsArr = Object.values(counts).sort((a,b)=>b-a);

  // Flush check
  const suitCounts = {};
  suits.forEach(s => suitCounts[s] = (suitCounts[s] || 0) + 1);
  const hasFlush = Object.values(suitCounts).some(c => c >= 5);

  // Straight check (simplified, handles wheel)
  const uniqueVals = [...new Set(values)].sort((a,b)=>a-b);
  let isStraight = uniqueVals.length >= 5 && uniqueVals.slice(-5).every((v,i) => v === uniqueVals[uniqueVals.length-5] + i);
  if (uniqueVals.includes(14) && uniqueVals.includes(2)) { // Wheel straight
    isStraight = true;
  }

  // Hand rankings (9 = royal flush > 8 straight flush > ... > 0 high card)
  if (isStraight && hasFlush && hand[0].value === 14) return {rank: 9, type: 'Royal Flush', score: hand[0].value};
  if (isStraight && hasFlush) return {rank: 8, type: 'Straight Flush', score: hand[0].value};
  if (countsArr[0] === 4) return {rank: 7, type: 'Four of a Kind', score: Object.keys(counts).find(k=>counts[k]===4)};
  if (countsArr[0] === 3 && countsArr[1] === 2) return {rank: 6, type: 'Full House', score: Object.keys(counts).find(k=>counts[k]===3)};
  if (hasFlush) return {rank: 5, type: 'Flush', score: values.slice(0,5).reduce((a,b)=>a+b,0)};
  if (isStraight) return {rank: 4, type: 'Straight', score: hand[0].value};
  if (countsArr[0] === 3) return {rank: 3, type: 'Three of a Kind', score: Object.keys(counts).find(k=>counts[k]===3)};
  if (countsArr[0] === 2 && countsArr[1] === 2) return {rank: 2, type: 'Two Pair', score: Object.keys(counts).filter(k=>counts[k]===2).reduce((a,b)=>a+b,0)};
  if (countsArr[0] === 2) return {rank: 1, type: 'Pair', score: Object.keys(counts).find(k=>counts[k]===2)};
  return {rank: 0, type: 'High Card', score: values.slice(0,5).reduce((a,b)=>a+b,0)};
}

// Compare two hands
function compareHands(hand1, hand2) {
  if (hand1.rank > hand2.rank) return 1;
  if (hand1.rank < hand2.rank) return -1;
  if (hand1.score > hand2.score) return 1;
  if (hand1.score < hand2.score) return -1;
  return 0;
}

// Player object
function createPlayer(name, isBot = false, chips = 1000) {
  return { name, isBot, chips, bet: 0, folded: false, playing: true, holeCards: [], handRank: null };
}

// Game state class
class PokerGame {
  constructor() {
    this.players = [
      createPlayer('You'),
      createPlayer('Bot1', true),
      createPlayer('Bot2', true),
      createPlayer('Bot3', true)
    ];
    this.deckId = null;
    this.community = [];
    this.pot = 0;
    this.phase = 'waiting'; // waiting, preflop, flop, turn, river, showdown
    this.currentPlayer = 0;
    this.smallBlind = 10;
    this.bigBlind = 20;
    this.minBet = this.bigBlind;
  }

  async newGame() {
    this.deckId = await fetchDeck();
    this.resetRound();
    // Post blinds
    this.players[0].bet = this.smallBlind; // You SB
    this.players[1].bet = this.bigBlind;
    this.pot = this.smallBlind + this.bigBlind;
    this.phase = 'preflop';
    await this.dealHoleCards();
  }

  resetRound() {
    this.players.forEach(p => {
      p.chips -= p.bet;
      p.bet = 0;
      p.folded = false;
      p.holeCards = [];
      p.handRank = null;
    });
    this.community = [];
    this.pot = 0;
    this.phase = 'waiting';
    this.currentPlayer = 0;
    this.minBet = this.bigBlind;
  }

  async dealHoleCards() {
    const cards = await drawCards(this.deckId, 8); // 2*4
    this.players.forEach((p, i) => p.holeCards = [cards[i*2], cards[i*2+1]]);
  }

  async nextCommunity() {
    const burn = 1;
    const drawCount = this.phase === 'preflop' ? 3 : 1;
    await drawCards(this.deckId, burn); // Burn
    const newCards = await drawCards(this.deckId, drawCount);
    this.community.push(...newCards);
    this.phase = this.phase === 'preflop' ? 'flop' : this.phase === 'flop' ? 'turn' : 'river';
  }

  // Bot decision: fold/call/raise based on hand strength percentile (simple)
  botDecision(player) {
    const strength = player.holeCards.length ? evaluateHand(player.holeCards, this.community).rank / 9 : 0;
    const rand = Math.random();
    if (strength < 0.2 || rand < 0.3) return {action: 'fold'};
    if (strength > 0.6 || rand < 0.5) {
      const raiseAmt = Math.max(this.minBet * 2, player.chips * 0.1);
      return {action: 'raise', amount: raiseAmt};
    }
    return {action: 'call'};
  }

  playerAction(action, amount = 0) {
    const player = this.players[this.currentPlayer];
    if (action === 'fold') {
      player.folded = true;
      player.playing = false;
    }
    else {
      const toCall = this.minBet - player.bet;
      const betAmt = action === 'call' ? toCall : Math.max(toCall + amount, this.minBet);
      player.bet += Math.min(betAmt, player.chips);
      player.chips -= Math.min(betAmt, player.chips);
      this.pot += Math.min(betAmt, player.chips);
      if (betAmt > this.minBet) this.minBet = betAmt;
    }
    this.nextPlayer();
  }

  nextPlayer() {
    do {
      this.currentPlayer = (this.currentPlayer + 1) % this.players.length;
    } while (this.players[this.currentPlayer].folded && this.activePlayers() > 1);
    if (this.isRoundComplete()) {
      this.handleRoundEnd();
    }
  }

  activePlayers() {
    return this.players.filter(p => p.playing).length;
  }

  isRoundComplete() {
    const active = this.players.filter(p => p.playing);
    if (active.length <= 1) return true;
    const maxBet = Math.max(...active.map(p => p.bet));
    return active.every(p => p.bet === maxBet || p.chips === 0);
  }

  async handleRoundEnd() {
    if (this.activePlayers() === 1) {
      const winner = this.players.find(p => !p.folded);
      winner.chips += this.pot;
      this.phase = 'waiting';
      return;
    }
    if (this.phase === 'river') {
      await this.showdown();
    } else {
      await this.nextCommunity();
      this.currentPlayer = 0; // Restart betting
    }
  }

  async showdown() {
    this.players.forEach(p => {
      if (!p.folded) p.handRank = evaluateHand(p.holeCards, this.community);
    });
    const active = this.players.filter(p => !p.folded);
    const winner = active.reduce((best, p) => compareHands(p.handRank, best.handRank) > 0 ? p : best);
    winner.chips += this.pot;
    this.phase = 'waiting';
  }

  getStatus() {
    return `Phase: ${this.phase}, Pot: $${this.pot}, Current: ${this.players[this.currentPlayer].name}`;
  }
}

// Global game instance
export let game = new PokerGame();

