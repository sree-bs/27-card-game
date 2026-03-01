import React, { useState, useEffect } from 'react';
import { database } from '../firebase';
import { ref, onValue, set, update, remove } from 'firebase/database';
import { motion, AnimatePresence } from 'framer-motion';
import Confetti from 'react-confetti';
import './Game.css';
import {
  createDeck,
  shuffleDeck,
  getTrickWinner,
  canPlayCard,
  calculateBidValidity,
  canPlayerBid,
  getTotalPoints,
  getCardPoints,
  canAskForTrump,
  playerHasTrumpSuit,
  sortCards
} from '../gameLogic';

const Game = () => {
  const [gameState, setGameState] = useState('menu');
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [gameData, setGameData] = useState(null);
  const [selectedCard, setSelectedCard] = useState(null);
  const [bidAmount, setBidAmount] = useState(14);
  const [showConfetti, setShowConfetti] = useState(false);
  const [error, setError] = useState('');
  const [popupMessage, setPopupMessage] = useState('');

  useEffect(() => {
    if (!playerId) {
      setPlayerId(`player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
    }
  }, [playerId]);

  // Listen for game updates
  useEffect(() => {
    if (!roomCode) return;
    const gameRef = ref(database, `games/${roomCode}`);
    const unsubscribe = onValue(gameRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        // detect trump ask & show popup
        if (
          gameData?.trumpAskedBy !== data.trumpAskedBy &&
          data.trumpAskedBy &&
          data.trumpAskedBy !== playerId
        ) {
          // find player name
          if (data.trumpAskedBy !== playerId) {
            const askerName = data.players[data.trumpAskedBy]?.name ?? 'Someone';
            const trumpCard = data.trumpCard;
            const trumpText = trumpCard ? `${trumpCard.rank} of ${trumpCard.suit}` : 'Unknown';
            const msg = `${askerName} asked for trump and the trump is (${trumpText}).`;
            setPopupMessage(msg);
            // hide automatically
            setTimeout(() => setPopupMessage(''), 3000);
          }

        }
        setGameData(data);
        // state mapping
        if (data.phase === 'bidding' || data.phase === 'trumpSelection') {
          setGameState('bidding');
        } else if (data.phase === 'playing') {
          setGameState('playing');
        } else if (data.phase === 'gameOver') {
          setGameState('gameOver');
        }
      }
    });
    return () => unsubscribe();
  }, [roomCode, playerId, gameData]);

  const createRoom = async () => {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }

    const newRoomCode = Math.random().toString(36).substr(2, 4).toUpperCase();
    const gameRef = ref(database, `games/${newRoomCode}`);

    const initialGameState = {
      roomCode: newRoomCode,
      phase: 'lobby',
      players: {
        [playerId]: {
          name: playerName,
          position: 0,
          ready: true
        }
      },
      createdAt: Date.now()
    };

    await set(gameRef, initialGameState);
    setRoomCode(newRoomCode);
    setGameState('lobby');
    setError('');
  };

  const joinRoom = async () => {
    if (!playerName.trim() || !roomCode.trim()) {
      setError('Please enter your name and room code');
      return;
    }

    const gameRef = ref(database, `games/${roomCode.toUpperCase()}`);

    onValue(gameRef, async (snapshot) => {
      const data = snapshot.val();

      if (!data) {
        setError('Room not found');
        return;
      }

      const playerCount = Object.keys(data.players || {}).length;

      if (playerCount >= 4) {
        setError('Room is full');
        return;
      }

      const playerRef = ref(database, `games/${roomCode.toUpperCase()}/players/${playerId}`);
      await set(playerRef, {
        name: playerName,
        position: playerCount,
        ready: false
      });

      setRoomCode(roomCode.toUpperCase());
      setGameState('lobby');
      setError('');
    }, { onlyOnce: true });
  };

  const startGame = async () => {
    if (!gameData || Object.keys(gameData.players).length !== 4) {
      setError('Need exactly 4 players to start');
      return;
    }

    const deck = shuffleDeck(createDeck());
    const players = Object.keys(gameData.players);

    // Determine dealer (if already set, use next; if first game, player 1)
    let dealerPosition = gameData.dealerPosition ?? 0;
    const dealerId = players.find(pid => gameData.players[pid].position === dealerPosition);

    // Deal initial 4 cards
    const initialHands = {};
    players.forEach((pid, i) => {
      const cards = deck.slice(i * 4, i * 4 + 4);
      initialHands[pid] = sortCards(cards);  // ← SORT HERE
    });

    // Remaining 4 cards
    const remainingCards = {};
    players.forEach((pid, i) => {
      const cards = deck.slice(16 + i * 4, 20 + i * 4);
      remainingCards[pid] = sortCards(cards);  // ← SORT HERE
    });

    const gameRef = ref(database, `games/${roomCode}`);
    await update(gameRef, {
      phase: 'bidding',
      hands: initialHands,
      remainingCards: remainingCards,
      currentBidder: (dealerPosition + 1) % 4, // first bidder is next to the dealer
      highestBid: 0,
      bidWinner: null,
      bids: {},
      passCount: 0,
      trumpCard: null,
      trumpRevealed: false,
      currentTrick: [],
      tricks: [],
      currentPlayer: null,
      team1Score: 0,
      team2Score: 0,
      team1Tricks: [],
      team2Tricks: [],
      trumpAskedBy: null,
      trickCompletedAt: null,
      dealerPosition, // store dealer
      dealerId: dealerId
    });
  };


  const placeBid = async (bid) => {
    if (!gameData) return;

    const currentPlayerPosition = gameData.players[playerId].position;

    if (currentPlayerPosition !== gameData.currentBidder) {
      setError("Not your turn to bid");
      return;
    }

    // Rule 2: Check if player can bid (team restriction)
    if (bid !== 'pass' && !canPlayerBid(playerId, gameData.players, gameData)) {
      setError("Your teammate has the highest bid. You can only bid after an opponent raises.");
      return;
    }

    if (bid !== 'pass' && !calculateBidValidity(bid, gameData.highestBid)) {
      setError(`Bid must be between 14-28 and higher than ${gameData.highestBid || 13}`);
      return;
    }

    const gameRef = ref(database, `games/${roomCode}`);
    const updates = {
      [`bids/${playerId}`]: bid
    };

    if (bid === 'pass') {
      const newPassCount = (gameData.passCount || 0) + 1;
      updates.passCount = newPassCount;

      if (newPassCount === 3 && gameData.bidWinner) {
        updates.phase = 'trumpSelection';
      } else {
        updates.currentBidder = (gameData.currentBidder + 1) % 4;
      }
    } else {
      updates.highestBid = bid;
      updates.bidWinner = playerId;
      updates.passCount = 0;
      updates.currentBidder = (gameData.currentBidder + 1) % 4;
    }

    await update(gameRef, updates);
    setError('');
  };

  const selectTrumpCard = async (card) => {
    if (!gameData || gameData.bidWinner !== playerId) {
      setError("Only the bid winner can select trump");
      return;
    }

    const gameRef = ref(database, `games/${roomCode}`);
    const dealerPosition = gameData.dealerPosition ?? 0;

    const firstPlayer = (dealerPosition + 1) % 4; // person next to dealer always starts

    // Merge and SORT full hands
    const fullHands = {};
    Object.keys(gameData.players).forEach(pid => {
      const merged = [
        ...(gameData.hands[pid] || []),
        ...(gameData.remainingCards[pid] || [])
      ];
      fullHands[pid] = sortCards(merged);
    });

    await update(gameRef, {
      trumpCard: card,
      trumpRevealed: false,
      phase: 'playing',
      currentPlayer: firstPlayer,
      currentTrick: [],
      hands: fullHands,
      remainingCards: null
    });
  };


  const askForTrump = async () => {
    if (!gameData) return;

    const myHand = gameData.hands[playerId];
    const currentTrick = gameData.currentTrick || [];

    if (!canAskForTrump(myHand, currentTrick, gameData.trumpCard, gameData.trumpRevealed)) {
      setError("You can't ask for trump now");
      return;
    }

    const gameRef = ref(database, `games/${roomCode}`);
    await update(gameRef, {
      trumpAskedBy: playerId,
      trumpRevealed: true
    });

    setError('');
  };

  const playCard = async (card) => {
    if (!gameData) return;

    const currentPlayerPosition = gameData.players[playerId].position;

    if (currentPlayerPosition !== gameData.currentPlayer) {
      setError("Not your turn");
      return;
    }

    // Check if trick is being displayed (2 second delay)
    if (gameData.trickCompletedAt) {
      const timeSinceComplete = Date.now() - gameData.trickCompletedAt;
      if (timeSinceComplete < 5000) {
        setError("Please wait while the trick is being displayed");
        return;
      }
    }

    const playerHand = gameData.hands[playerId];
    const currentTrick = gameData.currentTrick || [];
    const isBidWinner = gameData.bidWinner === playerId;

    // Check if player asked for trump and must play trump suit
    if (gameData.trumpAskedBy === playerId && !gameData.trumpPlayedAfterAsk) {
      const hasTrumpSuit = playerHasTrumpSuit(playerHand, gameData.trumpCard);
      if (hasTrumpSuit && card.suit !== gameData.trumpCard.suit) {
        setError("You must play a trump suit card since you asked for trump");
        return;
      }
    }

    if (!canPlayCard(card, playerHand, currentTrick, gameData.trumpCard, gameData.trumpRevealed, isBidWinner)) {
      if (isBidWinner && currentTrick.length === 0 && card.suit === gameData.trumpCard?.suit && !gameData.trumpRevealed) {
        setError("You cannot lead with trump suit until trump is revealed");
      } else {
        setError("Can't play this card. Must follow suit or trump rules apply.");
      }
      return;
    }

    const newHand = playerHand.filter(c => c.id !== card.id);
    const sortedHand = sortCards(newHand);
    const newTrick = [...currentTrick, { playerId, card, position: currentPlayerPosition }];

    const gameRef = ref(database, `games/${roomCode}`);
    const updates = {
      [`hands/${playerId}`]: sortedHand,
      currentTrick: newTrick
    };

    // If player asked for trump and played a trump suit card, mark it
    if (gameData.trumpAskedBy === playerId && card.suit === gameData.trumpCard?.suit) {
      updates.trumpPlayedAfterAsk = true;
    }

    if (newTrick.length === 4) {
      const leadSuit = newTrick[0].card.suit;
      const winnerIndex = getTrickWinner(newTrick, leadSuit, gameData.trumpCard);
      const winnerId = newTrick[winnerIndex].playerId;
      const winnerPosition = gameData.players[winnerId].position;

      let trickPoints = 0;
      newTrick.forEach(play => {
        trickPoints += getCardPoints(play.card);
      });

      const winningTeam = winnerPosition % 2 === 0 ? 'team1' : 'team2';
      const allTricks = [...(gameData.tricks || []), newTrick];
      const teamTricks = [...(gameData[`${winningTeam}Tricks`] || []), newTrick];

      updates.tricks = allTricks;
      updates[`${winningTeam}Tricks`] = teamTricks;
      updates.trumpAskedBy = null;
      updates.trumpPlayedAfterAsk = false;

      // Set trick completed timestamp for 10 second display
      updates.trickCompletedAt = Date.now();
      updates.nextPlayer = winnerPosition;

      // Don't clear the trick or update current player yet
      // This will be done after 10 seconds

      if (allTricks.length === 8) {
        const team1Points = getTotalPoints(gameData.team1Tricks || []);
        const team2Points = getTotalPoints(gameData.team2Tricks || []);

        const finalTeam1Points = winningTeam === 'team1' ? team1Points + trickPoints : team1Points;
        const finalTeam2Points = winningTeam === 'team2' ? team2Points + trickPoints : team2Points;

        const bidWinnerPosition = gameData.players[gameData.bidWinner].position;
        const biddingTeam = bidWinnerPosition % 2 === 0 ? 'team1' : 'team2';
        const biddingTeamPoints = biddingTeam === 'team1' ? finalTeam1Points : finalTeam2Points;

        updates.phase = 'gameOver';
        updates.team1Score = finalTeam1Points;
        updates.team2Score = finalTeam2Points;
        updates.bidMade = biddingTeamPoints >= gameData.highestBid;
        updates.trickCompletedAt = null;
      } else {
        // Schedule clearing the trick after 10 seconds
        setTimeout(async () => {
          const clearRef = ref(database, `games/${roomCode}`);
          await update(clearRef, {
            currentTrick: [],
            currentPlayer: winnerPosition,
            trickCompletedAt: null
          });
        }, 10000);
      }
    } else {
      updates.currentPlayer = (gameData.currentPlayer + 1) % 4;
    }

    await update(gameRef, updates);
    setSelectedCard(null);
    setError('');
  };

  const resetGame = async () => {
    const nextDealerPosition = ((gameData.dealerPosition ?? 0) + 1) % 4;

    const gameRef = ref(database, `games/${roomCode}`);
    await update(gameRef, {
      phase: 'lobby',
      hands: null,
      remainingCards: null,
      currentBidder: null,
      highestBid: null,
      bidWinner: null,
      bids: null,
      passCount: null,
      trumpCard: null,
      trumpRevealed: false,
      currentTrick: null,
      tricks: null,
      currentPlayer: null,
      team1Score: 0,
      team2Score: 0,
      team1Tricks: [],
      team2Tricks: [],
      trumpAskedBy: null,
      trumpPlayedAfterAsk: false,
      trickCompletedAt: null,
      nextPlayer: null,
      dealerPosition: nextDealerPosition
    });

    setShowConfetti(false);
    setGameState('lobby');
  };


  const leaveRoom = async () => {
    if (roomCode && playerId) {
      const playerRef = ref(database, `games/${roomCode}/players/${playerId}`);
      await remove(playerRef);
    }
    setGameState('menu');
    setRoomCode('');
    setGameData(null);
  };

  const renderMenu = () => (
    <div className="menu-container">
      <motion.div
        className="menu-card"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <h1 className="game-title">28 Card Game</h1>
        <p className="game-subtitle">Classic Indian Trump Card Game</p>

        <div className="input-group">
          <input
            type="text"
            placeholder="Enter your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="input-field"
          />
        </div>

        <button onClick={createRoom} className="btn btn-primary">
          Create New Room
        </button>

        <div className="divider">OR</div>

        <div className="input-group">
          <input
            type="text"
            placeholder="Enter room code"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            className="input-field"
          />
        </div>

        <button onClick={joinRoom} className="btn btn-secondary">
          Join Room
        </button>

        {error && <div className="error-message">{error}</div>}
      </motion.div>
    </div>
  );

  const renderLobby = () => {
    const players = gameData?.players || {};
    const playerCount = Object.keys(players).length;
    const isHost = Object.keys(players)[0] === playerId;

    return (
      <div className="lobby-container">
        <motion.div
          className="lobby-card"
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
        >
          <h2>Game Lobby</h2>
          <div className="room-code-display">
            Room Code: <span className="code">{roomCode}</span>
          </div>

          <div className="players-grid">
            {[0, 1, 2, 3].map(position => {
              const player = Object.entries(players).find(
                ([_, p]) => p.position === position
              );

              return (
                <div key={position} className={`player-slot ${player ? 'filled' : 'empty'}`}>
                  {player ? (
                    <>
                      <div className="player-avatar">{player[1].name[0].toUpperCase()}</div>
                      <div className="player-name">
                        {player[1].name}
                        {gameData?.dealerPosition === player[1].position && <span className="dealer-tag"> (Dealer)</span>}
                      </div>

                      <div className="team-label">Team {position % 2 + 1}</div>
                    </>
                  ) : (
                    <>
                      <div className="player-avatar empty-avatar">?</div>
                      <div className="player-name">Waiting...</div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="lobby-info">
            <p>Players: {playerCount}/4</p>
            <p className="team-info">Teams: Players 1 & 3 vs Players 2 & 4</p>
          </div>

          {isHost && playerCount === 4 && (
            <button onClick={startGame} className="btn btn-primary">
              Start Game
            </button>
          )}

          {(!isHost || playerCount < 4) && (
            <p className="waiting-message">
              {playerCount < 4 ? 'Waiting for players...' : 'Waiting for host to start...'}
            </p>
          )}

          <button onClick={leaveRoom} className="btn btn-ghost">
            Leave Room
          </button>

          {error && <div className="error-message">{error}</div>}
        </motion.div>
      </div>
    );
  };

  const renderBidding = () => {
    const players = gameData?.players || {};
    const currentBidderPos = gameData?.currentBidder;
    const myPosition = players[playerId]?.position;
    const isMyTurn = currentBidderPos === myPosition;
    const myInitialHand = gameData?.hands?.[playerId] || [];

    // Check if current player can bid (for UI feedback)
    const canBid = isMyTurn && canPlayerBid(playerId, gameData.players, gameData);

    if (gameData?.phase === 'trumpSelection') {
      const isBidWinner = gameData.bidWinner === playerId;

      return (
        <div className="trump-selection-container">
          <motion.div
            className="trump-selection-card"
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
          >
            <h2>Trump Card Selection</h2>

            {isBidWinner ? (
              <>
                <p className="bid-info">🏆 Congratulations! Your bid: <strong>{gameData.highestBid} points</strong></p>
                <p className="trump-instruction">Select any card from your hand as the trump card</p>

                <div className="initial-cards-display">
                  <h4>Select Your Trump Card:</h4>
                  <div className="cards-row">
                    {myInitialHand.map(card => (
                      <motion.div
                        key={card.id}
                        className="card-small selectable"
                        onClick={() => selectTrumpCard(card)}
                        whileHover={{ scale: 1.1, y: -10 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        {renderCard(card, false)}
                      </motion.div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="bid-info">
                  Winner: <strong>{players[gameData.bidWinner]?.name}</strong> with bid of <strong>{gameData.highestBid}</strong>
                </p>

                <div className="initial-cards-display">
                  <h4>Your Cards:</h4>
                  <div className="cards-row">
                    {myInitialHand.map(card => (
                      <div key={card.id} className="card-small">
                        {renderCard(card, false)}
                      </div>
                    ))}
                  </div>
                </div>

                <p className="waiting-message">Waiting for {players[gameData.bidWinner]?.name} to select trump card...</p>
              </>
            )}
          </motion.div>
        </div>
      );
    }

    return (
      <div className="bidding-container">
        <motion.div
          className="bidding-card"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <h2>Bidding Phase</h2>

          <div className="bidding-info">
            <p>Current Highest Bid: <strong>{gameData?.highestBid || 'None'}</strong></p>
            {gameData?.bidWinner && (
              <p>Leading Bidder: <strong>{players[gameData.bidWinner]?.name}</strong> (Team {(players[gameData.bidWinner]?.position % 2) + 1})</p>
            )}
          </div>

          <div className="initial-cards-display">
            <h4>Your Cards:</h4>
            <div className="cards-row">
              {myInitialHand.map(card => (
                <div key={card.id} className="card-small">
                  {renderCard(card, false)}
                </div>
              ))}
            </div>
          </div>

          <div className="players-bidding">
            {Object.entries(players)
              .sort((a, b) => a[1].position - b[1].position)
              .map(([pid, player]) => (
                <div
                  key={pid}
                  className={`player-bid-status ${player.position === currentBidderPos ? 'active' : ''}`}
                >
                  <span className="player-name-bid">
                    {player.name} <span className="team-tag">(Team {(player.position % 2) + 1})</span>
                  </span>
                  <span className="bid-value">
                    {gameData?.bids?.[pid] === 'pass' ? 'Pass' : (gameData?.bids?.[pid] || '...')}
                  </span>
                </div>
              ))}
          </div>

          {isMyTurn && (
            <div className="bid-controls">
              {!canBid && gameData?.bidWinner && (
                <div className="team-restriction-notice">
                  ⚠️ Your teammate holds the highest bid. Wait for an opponent to raise before you can bid.
                </div>
              )}

              <div className="bid-input-group">
                <input
                  type="range"
                  min="14"
                  max="28"
                  value={bidAmount}
                  onChange={(e) => setBidAmount(parseInt(e.target.value))}
                  className="bid-slider"
                  disabled={!canBid}
                />
                <span className="bid-amount-display">{bidAmount}</span>
              </div>

              <div className="bid-buttons">
                <button
                  onClick={() => placeBid(bidAmount)}
                  className="btn btn-primary"
                  disabled={!canBid || !calculateBidValidity(bidAmount, gameData?.highestBid)}
                >
                  Bid {bidAmount}
                </button>
                <button onClick={() => placeBid('pass')} className="btn btn-secondary">
                  Pass
                </button>
              </div>
            </div>
          )}

          {!isMyTurn && (
            <p className="waiting-message">
              Waiting for {Object.entries(players).find(([_, p]) => p.position === currentBidderPos)?.[1]?.name} to bid...
            </p>
          )}

          {error && <div className="error-message">{error}</div>}
        </motion.div>
      </div>
    );
  };

  const renderPlaying = () => {
    const players = gameData?.players || {};
    const myHand = gameData?.hands?.[playerId] || [];
    const currentTrick = gameData?.currentTrick || [];
    const myPosition = players[playerId]?.position;
    const isMyTurn = gameData?.currentPlayer === myPosition;
    const isBidWinner = gameData?.bidWinner === playerId;
    const trumpCard = gameData?.trumpCard;
    const trumpRevealed = gameData?.trumpRevealed;

    const canAskTrump = isMyTurn && canAskForTrump(myHand, currentTrick, trumpCard, trumpRevealed);
    const mustPlayTrump = gameData?.trumpAskedBy === playerId && !gameData?.trumpPlayedAfterAsk;

    // Check if trick is being displayed
    const trickDisplaying = gameData?.trickCompletedAt &&
      (Date.now() - gameData.trickCompletedAt < 5000) &&
      currentTrick.length === 4;

    return (
      <div className="playing-container">
        <div className="game-header">
          <div className="game-info-bar">
            <div className="trump-display">
              {trumpRevealed ? (
                <>
                  Trump: <span className="trump-card-badge">
                    {renderMiniCard(trumpCard)}
                  </span>
                </>
              ) : (
                <>
                  Trump: <span className="trump-hidden">🔒 Hidden</span>
                  {isBidWinner && (
                    <span className="trump-owner"> (Your trump: {renderMiniCard(trumpCard)})</span>
                  )}
                </>
              )}
            </div>
            <div className="bid-display">
              Bid: {gameData?.highestBid} by {players[gameData?.bidWinner]?.name}
            </div>
            <div className="tricks-display">
              Tricks: {gameData?.tricks?.length || 0}/8
            </div>
          </div>
        </div>

        {trickDisplaying && (
          <div className="trick-display-notice">
            ⏳ Displaying completed trick... Next player: {players[Object.entries(players).find(([_, p]) => p.position === gameData.nextPlayer)?.[0]]?.name}
          </div>
        )}

        {mustPlayTrump && !trickDisplaying && (
          <div className="trump-warning">
            ⚠️ You must play a trump suit card ({getSuitSymbol(trumpCard.suit)}) because you asked for trump!
          </div>
        )}

        {isBidWinner && !trumpRevealed && currentTrick.length === 0 && !trickDisplaying && (
          <div className="trump-lead-restriction">
            ℹ️ You cannot lead with trump suit ({getSuitSymbol(trumpCard.suit)}) cards until trump is revealed.
          </div>
        )}

        <div className="trick-area">
          <div className="trick-cards">
            {[0, 1, 2, 3].map(position => {
              const play = currentTrick.find(
                p => players[p.playerId]?.position === position
              );
              const player = Object.entries(players).find(
                ([_, p]) => p.position === position
              );

              return (
                <div key={position} className={`trick-position pos-${position}`}>
                  <div className="trick-player-name">{player?.[1]?.name || ''}</div>
                  {play ? (
                    <motion.div
                      initial={{ scale: 0, rotate: -180 }}
                      animate={{ scale: 1, rotate: 0 }}
                      className="trick-card"
                    >
                      {renderCard(play.card, false)}
                    </motion.div>
                  ) : (
                    <div className="trick-card-placeholder">
                      {position === gameData?.currentPlayer && !trickDisplaying && <div className="active-indicator">▼</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="hand-container">
          <h3>
            Your Hand
            {isMyTurn && !trickDisplaying && <span className="your-turn-indicator">● Your Turn</span>}
          </h3>
          <div className="hand-cards">
            <AnimatePresence>
              {myHand.map((card, index) => {
                const isTrumpCard = isBidWinner && trumpCard && card.id === trumpCard.id;
                const canPlay = isMyTurn && !trickDisplaying && canPlayCard(card, myHand, currentTrick, trumpCard, trumpRevealed, isBidWinner);

                return (
                  <motion.div
                    key={card.id}
                    initial={{ y: 100, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -100, opacity: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className={`hand-card ${selectedCard?.id === card.id ? 'selected' : ''} ${!isMyTurn || !canPlay || trickDisplaying ? 'disabled' : ''} ${isTrumpCard && !trumpRevealed ? 'trump-card-highlight' : ''}`}
                    onClick={() => isMyTurn && canPlay && !trickDisplaying && setSelectedCard(card)}
                  >
                    {renderCard(card, true)}
                    {isTrumpCard && !trumpRevealed && (
                      <div className="trump-badge">👑</div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          <div className="play-controls">
            {isMyTurn && selectedCard && !trickDisplaying && (
              <motion.button
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                onClick={() => playCard(selectedCard)}
                className="btn btn-primary play-card-btn"
              >
                Play {selectedCard.rank} of {selectedCard.suit}
              </motion.button>
            )}

            {canAskTrump && !trickDisplaying && (
              <motion.button
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                onClick={askForTrump}
                className="btn btn-warning ask-trump-btn"
              >
                🔓 Ask for Trump Reveal
              </motion.button>
            )}
          </div>

          {error && <div className="error-message">{error}</div>}
        </div>

        <div className="score-panel">
          <div className="team-score">
            <h4>Team 1 (Players 1 & 3)</h4>
            <p>Tricks Won: {gameData?.team1Tricks?.length || 0}</p>
            <p>Points: {getTotalPoints(gameData?.team1Tricks || [])}</p>
          </div>
          <div className="team-score">
            <h4>Team 2 (Players 2 & 4)</h4>
            <p>Tricks Won: {gameData?.team2Tricks?.length || 0}</p>
            <p>Points: {getTotalPoints(gameData?.team2Tricks || [])}</p>
          </div>
        </div>
      </div>
    );
  };

  const renderGameOver = () => {
    const players = gameData?.players || {};
    const bidWinnerPosition = players[gameData?.bidWinner]?.position;
    const biddingTeam = bidWinnerPosition % 2 === 0 ? 1 : 2;
    const bidMade = gameData?.bidMade;

    const team1Score = gameData?.team1Score || 0;
    const team2Score = gameData?.team2Score || 0;

    const winningTeam = biddingTeam === 1
      ? (bidMade ? 1 : 2)
      : (bidMade ? 2 : 1);

    return (
      <div className="game-over-container">
        {showConfetti && <Confetti recycle={false} numberOfPieces={500} />}

        <motion.div
          className="game-over-card"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          <h1 className="game-over-title">Game Over!</h1>

          <div className="trump-reveal-final">
            <p>Trump Card was: {renderMiniCard(gameData?.trumpCard)}</p>
          </div>

          <div className="final-scores">
            <div className={`team-final-score ${winningTeam === 1 ? 'winner' : ''}`}>
              <h3>Team 1</h3>
              <p className="score-number">{team1Score}</p>
              {winningTeam === 1 && <p className="winner-badge">🏆 Winners!</p>}
            </div>

            <div className={`team-final-score ${winningTeam === 2 ? 'winner' : ''}`}>
              <h3>Team 2</h3>
              <p className="score-number">{team2Score}</p>
              {winningTeam === 2 && <p className="winner-badge">🏆 Winners!</p>}
            </div>
          </div>

          <div className="bid-result">
            <p>
              {players[gameData?.bidWinner]?.name} bid {gameData?.highestBid} points
            </p>
            <p className={bidMade ? 'bid-made' : 'bid-failed'}>
              {bidMade ? '✓ Bid Made!' : '✗ Bid Failed'}
            </p>
          </div>

          <div className="game-over-actions">
            <button onClick={resetGame} className="btn btn-primary">
              Play Again
            </button>
            <button onClick={leaveRoom} className="btn btn-secondary">
              Leave Room
            </button>
          </div>
        </motion.div>
      </div>
    );
  };

  const renderCard = (card, isInHand) => {
    const suitColors = {
      hearts: '#e74c3c',
      diamonds: '#e74c3c',
      clubs: '#2c3e50',
      spades: '#2c3e50'
    };

    return (
      <div
        className="card"
        style={{
          color: suitColors[card.suit],
          cursor: isInHand ? 'pointer' : 'default'
        }}
      >
        <div className="card-corner top-left">
          <div className="card-rank">{card.rank}</div>
          <div className="card-suit">{getSuitSymbol(card.suit)}</div>
        </div>
        <div className="card-center">
          <span className="card-suit-large">{getSuitSymbol(card.suit)}</span>
        </div>
        <div className="card-corner bottom-right">
          <div className="card-rank">{card.rank}</div>
          <div className="card-suit">{getSuitSymbol(card.suit)}</div>
        </div>
      </div>
    );
  };

  const renderMiniCard = (card) => {
    if (!card) return null;

    const suitColors = {
      hearts: '#e74c3c',
      diamonds: '#e74c3c',
      clubs: '#2c3e50',
      spades: '#2c3e50'
    };

    return (
      <span className="mini-card" style={{ color: suitColors[card.suit] }}>
        {card.rank}{getSuitSymbol(card.suit)}
      </span>
    );
  };

  const renderPopup = () =>
    popupMessage && (
      <div className="popup-overlay">
        <div className="popup-message">
          {popupMessage}
        </div>
      </div>
    );

  const getSuitSymbol = (suit) => {
    const symbols = {
      hearts: '♥',
      diamonds: '♦',
      clubs: '♣',
      spades: '♠'
    };
    return symbols[suit] || suit;
  };

  return (
    <div className="game-container">
      {renderPopup()}
      {gameState === 'menu' && renderMenu()}
      {gameState === 'lobby' && renderLobby()}
      {gameState === 'bidding' && renderBidding()}
      {gameState === 'playing' && renderPlaying()}
      {gameState === 'gameOver' && renderGameOver()}
    </div>
  );
};

export default Game;