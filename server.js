const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const messageLogFile = 'messages.log'; // Nombre del archivo de registro de mensajes
const bannedIPs = ['192.168.13.52', '192.168.11.88', '192.168.12.139']; // Lista de IP baneadas

// Generar un ID de sesión único al iniciar el servidor
const sessionId = uuidv4();
console.log(`ID de sesión generado: ${sessionId}`);

function loadMessages() {
    try {
        const data = fs.readFileSync(messageLogFile, 'utf8');
        return data.split('\n').filter(msg => msg.trim() !== '');
    } catch (err) {
        console.error('Error al cargar los mensajes:', err);
        return [];
    }
}

function saveMessage(message) {
    fs.appendFileSync(messageLogFile, message + '\n');
}

function clearMessages(sessionId) {
    const logFolder = 'logsmensajes';
    const sessionLogFilename = `session_${sessionId}_messages.log`;
    const sessionLogPath = path.join(__dirname, logFolder, sessionLogFilename);

    try {
        // Guardar los mensajes en el nuevo archivo de registro
        fs.writeFileSync(sessionLogPath, fs.readFileSync(messageLogFile, 'utf8'));
        console.log(`Mensajes guardados en el archivo de registro de la sesión: ${sessionLogFilename}`);
    } catch (err) {
        console.error('Error al guardar los mensajes en el archivo de registro de la sesión:', err);
    }

    // Borra el contenido del archivo de registro de mensajes original
    fs.writeFileSync(messageLogFile, '');
}

// Servir archivos estáticos desde la carpeta 'public'
app.use(express.static('public'));

// Analizar el cuerpo de las solicitudes POST como JSON
app.use(express.json());

// Ruta de inicio, redirige a la página de inicio de sesión
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Ruta para manejar el envío del formulario de inicio de sesión
app.post('/login', (req, res) => {
    const { password } = req.body;

    const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    console.log(`Solicitud POST recibida desde IP: ${clientIP}, Contraseña: ${password}`); // Registro adicional

    console.log(req.body); // Registro adicional para ver los datos de la solicitud POST

    if (password === 'habibi') { // Cambia 'habibi' por tu contraseña real
        // Si la contraseña es correcta, redirecciona al chat
        res.redirect('/chat');
    } else {
        // Si la contraseña es incorrecta, mostrar mensaje de error
        res.send('Acceso denegado');
    }
});

// Ruta para servir el archivo chat.html
app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

io.on('connection', (socket) => {
    const clientIP = socket.handshake.address;

    console.log(`Nuevo cliente conectado desde la IP: ${clientIP}`); // Registro adicional

    // Verificar si la IP está baneada
    if (bannedIPs.includes(clientIP)) {
        console.log(`Intento de conexión desde IP baneada: ${clientIP}`);
        socket.disconnect(true); // Desconectar el socket
        return;
    }

    console.log(`Usuario conectado - IP: ${clientIP}`);

    const previousMessages = loadMessages();
    previousMessages.forEach(msg => {
        socket.emit('chat message', msg);
    });

    socket.on('chat message', (msg) => {
        console.log(`Mensaje recibido de ${clientIP} - ${msg}`);
        io.emit('chat message', msg); // Emitir el mensaje a todos los clientes
        saveMessage(msg);
    });

    // Manejar la señal 'typing'
    socket.on('typing', (isTyping) => {
        if (isTyping) {
            // Si está escribiendo, emitir la señal a todos los clientes
            io.emit('typing', socket.handshake.query.username + ' está escribiendo...');
        } else {
            // Si deja de escribir, emitir la señal vacía a todos los clientes
            io.emit('typing', '');
        }
    });

    socket.on('disconnect', () => {
        console.log(`Usuario desconectado - IP: ${clientIP}`);
    });
});

// Manejar el evento 'SIGINT' para limpiar los mensajes cuando se detiene el servidor
process.on('SIGINT', () => {
    console.log('Deteniendo el servidor... Limpiando mensajes...');
    clearMessages(sessionId);
    process.exit(0);
});

server.listen(3000, () => {
    console.log('Servidor de chat escuchando en el puerto 3000');
});
