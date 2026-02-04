const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { listenerCount } = require('cluster');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

let players = []; 
let currentTurnIndex = 0;
let pickedNumbers = [];
let gameStarted = false;
let pauseTimer = null;
let countdown = null;

app.use(express.static(path.join(__dirname)));

function generateBoard() {
    // 從 1 到 75 中隨機選出 25 個數字
    const pool = Array.from({length: 75}, (_, i) => i + 1);
    return pool.sort(() => Math.random() - 0.5).slice(0, 25);
}

io.on('connection', (socket) => {
    socket.on('joinGame', (name) => {
        let existingPlayer = players.find(p => p.name === name);

        if (existingPlayer) {
            existingPlayer.id = socket.id;
            existingPlayer.isOnline = true;
            socket.emit('initBoard', existingPlayer.board);
            if (gameStarted) {
                socket.emit('rejoinSuccess', { pickedNumbers });
            }
        } else {
            if (gameStarted) {
                socket.emit('gameStatus', '遊戲進行中，請等下一局');
                return;
            }
            const playerBoard = generateBoard();
            players.push({ 
                id: socket.id, 
                name: name || "無名氏", 
                board: playerBoard, 
                isOnline: true 
            });
            socket.emit('initBoard', playerBoard);
        }
        updateGameState();
     socket.on('leaveGame', () => {
        players = players.filter(p => p.id !== socket.id);
        updateGameState();
});

// 並確保斷線時，如果是還沒開始遊戲，就直接刪除
    socket.on('disconnect', () => {
        const player = players.find(p => p.id === socket.id);
        if (player && !gameStarted) {
            players = players.filter(p => p.id !== socket.id);
        } else if (player) {
            player.isOnline = false;
    }
    updateGameState();
});   
    });

    socket.on('requestStart', () => {
        if (players.length >= 2) {
            gameStarted = true;
            currentTurnIndex = 0; 
            pickedNumbers = [];
            io.emit('gameStatus', '遊戲正式開始！');
            updateGameState(); 
            startAutoPickTimer(players[currentTurnIndex]); 
        }
    });

    socket.on('pickNumber', (num) => {
        if (!gameStarted || players[currentTurnIndex]?.id !== socket.id) return;
        executePick(num);
    });

    socket.on('forceReset', () => {
        players = [];
        gameStarted = false;
        pickedNumbers = [];
        if (pauseTimer) clearTimeout(pauseTimer);
        if (countdown) clearInterval(countdown);
        io.emit('forceReload');
    });

    socket.on('disconnect', () => {
        const player = players.find(p => p.id === socket.id);
        if (player) {
            player.isOnline = false;
        }
        updateGameState();
    });
});

function executePick(num) {
    if (pauseTimer) clearTimeout(pauseTimer);
    if (countdown) clearInterval(countdown); 

    if (!pickedNumbers.includes(num)) {
        pickedNumbers.push(num);
        io.emit('updateBoard', num);

        let winners = [];
        players.forEach(p => {
            if (checkBingo(p.board, pickedNumbers) >= 5) winners.push(p);
        });

        if (winners.length > 0) {
            gameStarted = false;
            io.emit('gameOver', { winnerNames: winners.map(w => w.name) });
            return;
        }
        nextTurn(); 
    }
}

function nextTurn() {
    if (!gameStarted) return;
    currentTurnIndex = (currentTurnIndex + 1) % players.length;
    // 如果輪到的玩家斷線了，自動跳過他或幫他選
    startAutoPickTimer(players[currentTurnIndex]);
    updateGameState();
}

function startAutoPickTimer(player) {
    if (!player || !gameStarted) return;
    let timeLeft = 10;
    io.emit('timerUpdate', timeLeft);
    
    if (countdown) clearInterval(countdown);
    countdown = setInterval(() => {
        timeLeft--;
        io.emit('timerUpdate', timeLeft);
        if (timeLeft <= 0) clearInterval(countdown);
    }, 1000);

    if (pauseTimer) clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => {
        const available = player.board.filter(n => !pickedNumbers.includes(n));
        if (available.length > 0) {
            executePick(available[Math.floor(Math.random() * available.length)]);
        }
    }, 10000);
}

function checkBingo(board, picked) {
    let lines = 0;
    const marked = board.map(n => picked.includes(n));
    for (let i = 0; i < 5; i++) {
        if (marked.slice(i * 5, i * 5 + 5).every(v => v)) lines++;
        if ([0, 1, 2, 3, 4].every(j => marked[i + j * 5])) lines++;
    }
    if ([0, 6, 12, 18, 24].every(i => marked[i])) lines++;
    if ([4, 8, 12, 16, 20].every(i => marked[i])) lines++;
    return lines;
}

function updateGameState() {
    io.emit('stateUpdate', {
        gameStarted: gameStarted,
        turnId: players[currentTurnIndex]?.id,
        players: players.map(p => ({ name: p.name, isOnline: p.isOnline, id: p.id, lineCount: checkBingo(p.board, pickedNumbers) }))
    });
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => console.log(`Server is running!`));
