import React, { useState, useEffect } from 'react';
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, collection, addDoc, updateDoc, serverTimestamp } from "firebase/firestore";

// 중요! 이 부분을 새로 만든 Firebase 프로젝트의 정보로 완전히 교체해야 합니다!
const firebaseConfig = {
  apiKey: "AIzaSyBG3iP8lLSnqSfY0HZFnscG0Bz9AOwlYbE",
  authDomain: "my-omok.firebaseapp.com",
  projectId: "my-omok",
  storageBucket: "my-omok.firebasestorage.app",
  messagingSenderId: "535420631031",
  appId: "1:535420631031:web:e2d6d205bb9e37a93020f2"
};

// Firebase 앱 초기화
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const BOARD_SIZE = 19;

// 4자리 숫자 게임 ID 생성 함수
const generateGameId = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

// 게임 ID 존재 여부 확인 함수
const checkGameIdExists = async (gameId) => {
  try {
    const gameDocRef = doc(db, 'games', gameId);
    const gameDoc = await getDoc(gameDocRef);
    return gameDoc.exists();
  } catch (e) {
    console.error("Error checking game ID:", e);
    return false;
  }
};

function App() {
  const [gameId, setGameId] = useState('');
  const [gameData, setGameData] = useState(null);
  const [playerId, setPlayerId] = useState('');
  const [inputGameId, setInputGameId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let storedPlayerId = localStorage.getItem('omokPlayerId');
    if (!storedPlayerId) {
      storedPlayerId = crypto.randomUUID();
      localStorage.setItem('omokPlayerId', storedPlayerId);
    }
    setPlayerId(storedPlayerId);
  }, []);

  useEffect(() => {
    if (!gameId) return;

    const gameDocRef = doc(db, 'games', gameId);
    const unsubscribe = onSnapshot(gameDocRef, (doc) => {
      if (doc.exists()) {
        const remoteData = doc.data();
        try {
          const parsedBoard = JSON.parse(remoteData.board);
          setGameData({ ...remoteData, board: parsedBoard });
        } catch (e) {
          console.error("Failed to parse board data:", e);
          setError("게임 데이터를 불러오는 데 실패했습니다.");
        }
      } else {
        setError('게임을 찾을 수 없습니다.');
        setGameId('');
        setGameData(null);
      }
    });

    return () => unsubscribe();
  }, [gameId]);

  const handleCreateGame = async () => {
    setLoading(true);
    setError('');
    try {
      const initialBoard = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
      const newGame = {
        board: JSON.stringify(initialBoard),
        currentPlayer: 'B',
        players: { 'B': playerId, 'W': null },
        winner: null,
        gameStatus: 'waiting',
        createdAt: serverTimestamp(),
      };

      // 4자리 숫자 ID 생성 및 중복 체크 (최대 10번 시도)
      let gameId = '';
      let attempts = 0;
      const maxAttempts = 10;

      while (attempts < maxAttempts) {
        gameId = generateGameId();
        const exists = await checkGameIdExists(gameId);
        if (!exists) {
          break; // 중복되지 않는 ID를 찾음
        }
        attempts++;
      }

      if (attempts >= maxAttempts) {
        throw new Error('사용 가능한 게임 ID를 생성할 수 없습니다. 잠시 후 다시 시도해주세요.');
      }

      // 생성된 4자리 ID로 문서 생성
      const gameDocRef = doc(db, 'games', gameId);
      await setDoc(gameDocRef, newGame);
      // 호스트 정보 저장 (게임 생성 시)
      localStorage.setItem(`game_${gameId}_host`, playerId);
      setGameId(gameId);
    } catch (e) {
      console.error("Error creating game: ", e);
      setError(e.message || '게임을 생성하는 데 실패했습니다. Firebase 설정을 확인하세요.');
    }
    setLoading(false);
  };

  const handleJoinGame = async () => {
    const gameId = inputGameId.trim();

    if (!gameId) {
      setError('게임 ID를 입력해주세요.');
      return;
    }

    // 4자리 숫자 검증
    if (!/^\d{4}$/.test(gameId)) {
      setError('게임 ID는 4자리 숫자여야 합니다.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const gameDocRef = doc(db, 'games', gameId);
      const gameDoc = await getDoc(gameDocRef);

      if (!gameDoc.exists()) {
        setError('존재하지 않는 게임 ID입니다.');
        setLoading(false);
        return;
      }

      const game = gameDoc.data();
      if (game.gameStatus === 'playing' && !Object.values(game.players).includes(playerId)) {
        setError('이미 꽉 찬 방입니다.');
        setLoading(false);
        return;
      }

      if(game.players.B !== playerId && game.players.W === null) {
        await updateDoc(gameDocRef, {
            'players.W': playerId,
            'gameStatus': 'playing'
        });
      }

      // 호스트 정보 저장 (게임 참가 시)
      localStorage.setItem(`game_${gameId}_host`, game.players.B);
      setGameId(gameId);
    } catch (e) {
      console.error("Error joining game: ", e);
      setError('게임에 참가하는 데 실패했습니다.');
    }
    setLoading(false);
  };

  const handleRestartGame = async () => {
    // 호스트 판별: localStorage에 저장된 호스트 정보로 확인
    const storedHostId = localStorage.getItem(`game_${gameId}_host`);
    const isHost = storedHostId === playerId || gameData?.players.B === playerId;

    if (!gameData || !isHost) {
      alert('방장만 게임을 재시작할 수 있습니다.');
      return;
    }

    try {
      const initialBoard = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
      const gameDocRef = doc(db, 'games', gameId);

      // 승패에 따라 플레이어 순서 변경
      let newPlayers = { ...gameData.players };
      let newCurrentPlayer = 'B';

      if (gameData.winner === 'B') {
        // 원래 흑돌이 이겼다면: 패자(백돌)가 흑돌이 되고 승자(흑돌)가 백돌이 됨
        newPlayers = {
          B: gameData.players.W, // 패자(원래 백돌)가 새로운 흑돌
          W: gameData.players.B  // 승자(원래 흑돌)가 새로운 백돌
        };
        newCurrentPlayer = 'B'; // 패자(새로운 흑돌)의 차례
      } else if (gameData.winner === 'W') {
        // 원래 백돌이 이겼다면: 패자(흑돌)가 흑돌이 되고 승자(백돌)가 백돌이 됨
        newPlayers = {
          B: gameData.players.B, // 패자(원래 흑돌)가 새로운 흑돌
          W: gameData.players.W  // 승자(원래 백돌)가 새로운 백돌
        };
        newCurrentPlayer = 'B'; // 패자(새로운 흑돌)의 차례
      } else {
        // 무승부 또는 기타 경우: 기본값 유지
        newPlayers = { ...gameData.players };
        newCurrentPlayer = 'B';
      }

      // 호스트 정보 업데이트 (localStorage)
      localStorage.setItem(`game_${gameId}_host`, newPlayers.B);

      await updateDoc(gameDocRef, {
        board: JSON.stringify(initialBoard),
        players: newPlayers,
        currentPlayer: newCurrentPlayer,
        winner: null,
        gameStatus: 'playing',
        createdAt: serverTimestamp(),
      });

      const winnerText = gameData.winner === 'B' ? '흑돌' : '백돌';
      alert(`게임이 재시작되었습니다! ${winnerText} 승리로 인해 패자가 흑돌부터 시작합니다.`);
    } catch (e) {
      console.error("Error restarting game: ", e);
      alert('게임 재시작에 실패했습니다.');
    }
  };

  const handleCellClick = async (row, col) => {
    if (!gameData || gameData.winner || gameData.board[row][col] || gameData.gameStatus !== 'playing') {
      return;
    }

    const currentPlayerSymbol = gameData.currentPlayer;
    if(gameData.players[currentPlayerSymbol] !== playerId){
      alert("상대방의 턴입니다.");
      return;
    }

    const newBoard = gameData.board.map(r => [...r]);
    newBoard[row][col] = currentPlayerSymbol;

    const winner = checkWinner(newBoard, row, col, currentPlayerSymbol);

    const nextPlayer = currentPlayerSymbol === 'B' ? 'W' : 'B';
    const gameDocRef = doc(db, 'games', gameId);

    await updateDoc(gameDocRef, {
        board: JSON.stringify(newBoard),
        currentPlayer: nextPlayer,
        winner: winner,
        gameStatus: winner ? 'finished' : 'playing',
    });
  };

  const checkWinner = (board, row, col, player) => {
    const directions = [
      { r: 0, c: 1 }, { r: 1, c: 0 }, { r: 1, c: 1 }, { r: 1, c: -1 }
    ];

    for (const dir of directions) {
      let count = 1;
      for (let i = 1; i < 5; i++) {
        const newRow = row + dir.r * i;
        const newCol = col + dir.c * i;
        if (newRow >= 0 && newRow < BOARD_SIZE && newCol >= 0 && newCol < BOARD_SIZE && board[newRow][newCol] === player) {
          count++;
        } else { break; }
      }
      for (let i = 1; i < 5; i++) {
        const newRow = row - dir.r * i;
        const newCol = col - dir.c * i;
        if (newRow >= 0 && newRow < BOARD_SIZE && newCol >= 0 && newCol < BOARD_SIZE && board[newRow][newCol] === player) {
          count++;
        } else { break; }
      }
      if (count >= 5) return player;
    }
    return null;
  };

  const handleGameSelect = () => {
    // 게임 선택 버튼 클릭 시 로비로 돌아감
    if (window.confirm('게임을 나가시겠습니까? 진행 중인 게임이 종료됩니다.')) {
      setGameId('');
      setGameData(null);
      setError('');
    }
  };

  const renderGame = () => {
    if (!gameData) {
      return <div>게임을 불러오는 중...</div>;
    }

    const mySymbol = gameData.players.B === playerId ? 'B' : 'W';

    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-800 text-white p-4 relative">
        {/* 게임선택 버튼 - 왼쪽 상단 고정 */}
        <button
          onClick={handleGameSelect}
          className="absolute top-4 left-4 game-select-btn"
          title="게임 선택으로 돌아가기"
        >
          <span>🎯</span>
          <span>게임선택</span>
        </button>

        <h1 className="text-4xl font-bold mb-2">온라인 오목 게임</h1>
        <div className="mb-4 text-center">
            <p>게임 코드: <span className="font-bold text-yellow-300 text-2xl">{gameId}</span></p>
            <p className="text-sm text-slate-300">(친구에게 이 4자리 코드를 알려주세요!)</p>
            <p>나의 돌: {mySymbol === 'B' ? '흑돌 ⚫' : '백돌 ⚪'}</p>
        </div>
        
        <div className="mb-4 text-lg">
          {gameData.winner ? (
            <div className="text-center">
              <p className="text-2xl text-green-400 mb-4">
                {gameData.winner === mySymbol ? '🎉 당신이 이겼습니다! 🎉' : '아쉽지만 패배했습니다...'}
              </p>
              {/* 호스트인 경우에만 재시작 버튼 표시 */}
              {gameData.players.B === playerId && (
                <button
                  onClick={handleRestartGame}
                  className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-lg transition duration-300 shadow-lg"
                >
                  🔄 게임 재시작
                </button>
              )}
            </div>
          ) : gameData.players.W === null ? (
            <div className="text-center">
              <p className="text-2xl text-blue-400 mb-2">⏳ 대기중</p>
              <p className="text-slate-300">상대방이 접속할 때까지 기다려주세요...</p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-2xl text-green-400 mb-2">🎮 게임 시작!</p>
              <p>현재 플레이어: {gameData.currentPlayer === 'B' ? '흑돌 ⚫' : '백돌 ⚪'}
              {gameData.currentPlayer === mySymbol && <span className="text-yellow-400"> (당신 차례)</span>}
              </p>
            </div>
          )}
        </div>

        <div className="bg-orange-300 p-2 rounded-md shadow-lg">
          {gameData.board.map((row, rowIndex) => (
            <div key={rowIndex} className="flex">
              {row.map((cell, colIndex) => (
                <div
                  key={colIndex}
                  onClick={() => handleCellClick(rowIndex, colIndex)}
                  className="w-8 h-8 md:w-10 md:h-10 border border-gray-600 flex justify-center items-center cursor-pointer bg-orange-200 relative"
                >
                  <div className="absolute w-full h-px bg-gray-600"></div>
                  <div className="absolute h-full w-px bg-gray-600"></div>
                  {cell && (
                    <div className={`w-6 h-6 md:w-8 md:h-8 rounded-full ${cell === 'B' ? 'bg-black' : 'bg-white'} shadow-md`}></div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  };
  
  const renderLobby = () => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-800 text-white p-4">
        <h1 className="text-5xl font-bold mb-8">온라인 오목</h1>
        <div className="bg-slate-700 p-8 rounded-lg shadow-xl w-full max-w-sm">
            <button
                onClick={handleCreateGame}
                disabled={loading}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-lg text-lg transition duration-300 disabled:bg-slate-500"
            >
                {loading ? '만드는 중...' : '새 게임 만들기'}
            </button>
            <div className="my-6 flex items-center">
                <hr className="flex-grow border-slate-500"/>
                <span className="mx-4 text-slate-400">또는</span>
                <hr className="flex-grow border-slate-500"/>
            </div>
            <div className="flex flex-col space-y-4">
                <input
                    type="text"
                    value={inputGameId}
                    onChange={(e) => setInputGameId(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="4자리 숫자 게임 ID 입력 (예: 1234)"
                    maxLength="4"
                    className="p-3 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                    onClick={handleJoinGame}
                    disabled={loading}
                    className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-4 rounded-lg text-lg transition duration-300 disabled:bg-slate-500"
                >
                    {loading ? '참가하는 중...' : '게임 참가하기'}
                </button>
            </div>
            {error && <p className="text-red-400 mt-4 text-center">{error}</p>}
        </div>
        <p className="mt-8 text-slate-400">내 플레이어 ID: {playerId}</p>
    </div>
  );

  return (
    <div>
        {gameId ? renderGame() : renderLobby()}
    </div>
  );
}

export default App;