// Card suits and ranks for 28 card game (32 cards total)
export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
export const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Card values in 28 game
export const CARD_VALUES = {
  'J': 3,
  '9': 2,
  'A': 1,
  '10': 1,
  'K': 0,
  'Q': 0,
  '8': 0,
  '7': 0
};

// Points per card
export const CARD_POINTS = {
  'J': 3,
  '9': 2,
  'A': 1,
  '10': 1,
  'K': 0,
  'Q': 0,
  '8': 0,
  '7': 0
};

export const createDeck = () => {
  const deck = [];
  SUITS.forEach(suit => {
    RANKS.forEach(rank => {
      deck.push({ suit, rank, id: `${suit}-${rank}` });
    });
  });
  return deck;
};

export const shuffleDeck = (deck) => {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export const getCardValue = (card, trumpCard) => {
  const baseValue = CARD_VALUES[card.rank];
  // Trump suit cards are more valuable
  if (trumpCard && card.suit === trumpCard.suit) {
    return baseValue + 100;
  }
  return baseValue;
};

export const getCardPoints = (card) => {
  return CARD_POINTS[card.rank];
};

export const getTrickWinner = (trick, leadSuit, trumpCard) => {
  let winningIndex = 0;
  let highestValue = -1;

  const trumpSuit = trumpCard ? trumpCard.suit : null;

  trick.forEach((play, index) => {
    if (!play || !play.card) return;
    
    const card = play.card;
    let value = 0;

    // Trump suit beats everything
    if (trumpSuit && card.suit === trumpSuit) {
      value = 1000 + CARD_VALUES[card.rank];
    }
    // Lead suit beats other suits
    else if (card.suit === leadSuit) {
      value = 100 + CARD_VALUES[card.rank];
    }
    // Other suits have no value
    else {
      value = 0;
    }

    if (value > highestValue) {
      highestValue = value;
      winningIndex = index;
    }
  });

  return winningIndex;
};

export const canPlayCard = (card, hand, trick, trumpCard, trumpRevealed, isBidWinner) => {
  // First card of trick can be anything
  if (trick.length === 0 || !trick[0]) {
    // If you're the bid winner and trump is not revealed
    if (isBidWinner && trumpCard && !trumpRevealed) {
      // Can't play the trump card unless it's the only card of that suit
      if (card.id === trumpCard.id) {
        const sameColorCards = hand.filter(c => c.suit === trumpCard.suit);
        // Can only play trump card if no other cards of that suit
        return sameColorCards.length === 1;
      }
    }
    return true;
  }

  const leadSuit = trick[0].card.suit;
  const hasSuit = hand.some(c => c.suit === leadSuit);

  // Must follow suit if possible
  if (hasSuit && card.suit !== leadSuit) {
    // Exception: if trump card and trump not revealed and you're bid winner
    if (isBidWinner && trumpCard && !trumpRevealed && card.id === trumpCard.id) {
      return false;
    }
    return false;
  }

  // If you're the bid winner and trump is not revealed
  if (isBidWinner && trumpCard && !trumpRevealed && card.id === trumpCard.id) {
    // Can only play if you don't have the lead suit
    return !hasSuit;
  }

  return true;
};

export const calculateBidValidity = (bid, currentHighestBid) => {
  if (bid < 14 || bid > 28) return false;
  if (currentHighestBid && bid <= currentHighestBid) return false;
  return true;
};

export const getTotalPoints = (tricks) => {
  let points = 0;
  tricks.forEach(trick => {
    trick.forEach(play => {
      if (play && play.card) {
        points += getCardPoints(play.card);
      }
    });
  });
  return points;
};

export const canAskForTrump = (hand, trick, trumpCard, trumpRevealed) => {
  // Can't ask if trump is already revealed
  if (trumpRevealed || !trumpCard) return false;
  
  // Can't ask if it's the first card of the trick
  if (trick.length === 0 || !trick[0]) return false;

  const leadSuit = trick[0].card.suit;
  const hasSuit = hand.some(c => c.suit === leadSuit);

  // Can only ask for trump if you don't have the lead suit
  return !hasSuit;
};

export const playerHasTrumpSuit = (hand, trumpCard) => {
  if (!trumpCard) return false;
  return hand.some(c => c.suit === trumpCard.suit);
};
