const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let players = []; 
let currentTurnIndex = 0;
let pickedNumbers = [];
let gameStarted = false;
let pauseTimer = null;
let countdown = null;

app.use(express.static(path.join(__dirname)));

function generateBoard() {
    return Array.from({length: 25}, (_, i) => i + 1).sort(() => Math.random() - 0.5);
}

io.on('connection', (socket) => {
    socket.on('joinGame', (name) => {
        if (gameStarted) {
            // 檢查是否是斷線重連
            let p = players.find(p => p.name === name);
            if (p) {
                p.id = socket.id;
                p.isOnline = true;
                socket.emit('initBoard', p.board);
                socket.emit('rejoinSuccess', { pickedNumbers });
                updateGameState();
                return;
            }
            socket.emit('gameStatus', '遊戲進行中，請稍候...');
            return;
        }

        // 正常加入或重連
        let existingPlayer = players.find(p => p.name === name);
        if (existingPlayer) {
            existingPlayer.id = socket.id;
            existingPlayer.isOnline = true;
            socket.emit('initBoard', existingPlayer.board);
        } else {
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
    });

    socket.on('requestStart', () => {
        if (players.length >= 2) {
            gameStarted = true;
            currentTurnIndex = 0; 
            pickedNumbers = [];
            io.emit('gameStatus', '遊戲正式開始！');
            updateGameState(); 
            const firstPlayer = players[currentTurnIndex];
            if (firstPlayer) startAutoPickTimer(firstPlayer); 
        } else {
            socket.emit('gameStatus', `人數不足 (目前: ${players.length}/2)`);
        }
    });

    socket.on('pickNumber', (num) => {
        if (!gameStarted) return;
        if (players[currentTurnIndex]?.id !== socket.id) return;
        executePick(num);
    });

    socket.on('requestNewBoard', () => {
        const player = players.find(p => p.id === socket.id);
        if (player) {
            player.board = generateBoard();
            socket.emit('initBoard', player.board);
        }
    });

    socket.on('disconnect', () => {
        const player = players.find(p => p.id === socket.id);
        if (player) player.isOnline = false;
        // 如果全員離線超過 30 秒才清空 (選配邏輯，這裡簡化為不自動清空以方便重連)
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
            resetGameState();
            return;
        }
        nextTurn(); 
    }
}

function nextTurn() {
    if (!gameStarted) return;
    currentTurnIndex = (currentTurnIndex + 1) % players.length;
    startAutoPickTimer(players[currentTurnIndex]);
    updateGameState();
}

function startAutoPickTimer(player) {
    if (!player || !gameStarted) return;
    if (pauseTimer) clearTimeout(pauseTimer);
    if (countdown) clearInterval(countdown);

    let timeLeft = 10;
    io.emit('timerUpdate', timeLeft);
    countdown = setInterval(() => {
        timeLeft--;
        io.emit('timerUpdate', timeLeft);
        if (timeLeft <= 0) clearInterval(countdown);
    }, 1000);

    pauseTimer = setTimeout(() => {
        if (!gameStarted) return;
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

function resetGameState() {
    gameStarted = false;
    pickedNumbers = [];
    if (pauseTimer) clearTimeout(pauseTimer);
    if (countdown) clearInterval(countdown);
    updateGameState();
}

function updateGameState() {
    io.emit('stateUpdate', {
        gameStarted: gameStarted,
        turnId: players[currentTurnIndex]?.id,
        playerCount: players.filter(p => p.isOnline).length
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server is running!`));