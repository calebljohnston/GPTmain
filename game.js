const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const towers = [];
const enemies = [];
const bullets = [];
const enemySpawnInterval = 2000; // ms
let lastEnemySpawn = 0;
const pathY = canvas.height - 50;
let lastTime = performance.now();

canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    towers.push({ x, y, range: 100, cooldown: 0 });
});

function spawnEnemy() {
    enemies.push({ x: 0, y: pathY, speed: 50, hp: 3 });
}

function update(dt) {
    if (performance.now() - lastEnemySpawn > enemySpawnInterval) {
        spawnEnemy();
        lastEnemySpawn = performance.now();
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        enemy.x += enemy.speed * dt;
        if (enemy.x > canvas.width) {
            enemies.splice(i, 1);
        }
    }

    for (const tower of towers) {
        tower.cooldown -= dt;
        if (tower.cooldown <= 0) {
            const target = enemies.find((e) => {
                const dx = e.x - tower.x;
                const dy = e.y - tower.y;
                return Math.hypot(dx, dy) < tower.range;
            });
            if (target) {
                bullets.push({ x: tower.x, y: tower.y, target });
                tower.cooldown = 0.5;
            }
        }
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        const dx = bullet.target.x - bullet.x;
        const dy = bullet.target.y - bullet.y;
        const dist = Math.hypot(dx, dy);
        const speed = 200;
        bullet.x += (dx / dist) * speed * dt;
        bullet.y += (dy / dist) * speed * dt;
        if (dist < 5) {
            bullet.target.hp -= 1;
            if (bullet.target.hp <= 0) {
                const index = enemies.indexOf(bullet.target);
                if (index >= 0) enemies.splice(index, 1);
            }
            bullets.splice(i, 1);
        }
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#888';
    ctx.fillRect(0, pathY - 20, canvas.width, 40);

    ctx.fillStyle = 'blue';
    for (const tower of towers) {
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, 10, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.fillStyle = 'red';
    for (const enemy of enemies) {
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, 10, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.fillStyle = 'black';
    for (const bullet of bullets) {
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }
}

function gameLoop(timestamp) {
    const dt = (timestamp - lastTime) / 1000;
    update(dt);
    draw();
    lastTime = timestamp;
    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
