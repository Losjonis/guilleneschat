const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const messageLogFile = 'messages.log'; // Nombre del archivo de registro de mensajes
const bannedIPs = ['192.168.13.52', '192.168.11.88', '192.168.12.139']; // Lista de IP baneadas
const typingUsers = new Set(); // Conjunto para rastrear usuarios escribiendo

// Generar un ID de sesión único al iniciar el servidor
const sessionId = uuidv4();
console.log(`ID de sesión generado: ${sessionId}`);

// Configuración para subida de archivos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Generar nombre único para el archivo
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const fileExtension = path.extname(file.originalname);
        const fileName = file.originalname.replace(fileExtension, '') + '-' + uniqueSuffix + fileExtension;
        cb(null, fileName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB límite
    },
    fileFilter: function (req, file, cb) {
        // Lista de tipos de archivos permitidos
        const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|zip|rar|mp4|mp3|wav/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Tipo de archivo no permitido'));
        }
    }
});

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
        // Crear la carpeta si no existe
        if (!fs.existsSync(logFolder)) {
            fs.mkdirSync(logFolder, { recursive: true });
        }
        
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

// Servir archivos subidos desde la carpeta 'uploads'
app.use('/uploads', express.static('uploads'));

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
        res.redirect('./chat');
    } else {
        // Si la contraseña es incorrecta, mostrar mensaje de error
        res.send('Acceso denegado');
    }
});

// Ruta para servir el archivo chat.html
app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Ruta para subir archivos
app.post('/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se seleccionó ningún archivo' });
        }

        const fileInfo = {
            filename: req.file.filename,
            originalname: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype,
            path: req.file.path
        };

        console.log('Archivo subido:', fileInfo);

        res.json({
            success: true,
            file: fileInfo,
            url: `/uploads/${req.file.filename}`
        });
    } catch (error) {
        console.error('Error al subir archivo:', error);
        res.status(500).json({ error: 'Error al subir el archivo' });
    }
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

    // Manejar mensajes de archivos
    socket.on('file message', (fileData) => {
        console.log(`Archivo compartido de ${clientIP} - ${fileData.originalname}`);
        const fileMessage = `${fileData.username}: [ARCHIVO] ${fileData.originalname} (${Math.round(fileData.size / 1024)}KB) - ${fileData.url}`;
        io.emit('file message', fileData); // Emitir la información del archivo a todos los clientes
        saveMessage(fileMessage); // Guardar en el log
    });

    // Manejar la señal 'typing'
    socket.on('typing', (isTyping) => {
        const username = socket.handshake.query.username;
        
        if (isTyping) {
            // Agregar usuario al conjunto de usuarios escribiendo
            typingUsers.add(username);
        } else {
            // Quitar usuario del conjunto de usuarios escribiendo
            typingUsers.delete(username);
        }
        
        // Crear el mensaje basado en cuántos usuarios están escribiendo
        let typingMessage = '';
        if (typingUsers.size > 0) {
            const typingArray = Array.from(typingUsers);
            if (typingArray.length === 1) {
                typingMessage = `${typingArray[0]} está escribiendo...`;
            } else if (typingArray.length === 2) {
                typingMessage = `${typingArray[0]} y ${typingArray[1]} están escribiendo...`;
            } else {
                // Para 3 o más usuarios
                const lastUser = typingArray.pop();
                typingMessage = `${typingArray.join(', ')} y ${lastUser} están escribiendo...`;
            }
        }
        
        // Emitir el mensaje a todos los clientes
        io.emit('typing', typingMessage);
    });

    socket.on('disconnect', () => {
        const username = socket.handshake.query.username;
        // Limpiar el usuario del conjunto de typing cuando se desconecta
        typingUsers.delete(username);
        
        // Actualizar el mensaje de typing después de eliminar al usuario
        let typingMessage = '';
        if (typingUsers.size > 0) {
            const typingArray = Array.from(typingUsers);
            if (typingArray.length === 1) {
                typingMessage = `${typingArray[0]} está escribiendo...`;
            } else if (typingArray.length === 2) {
                typingMessage = `${typingArray[0]} y ${typingArray[1]} están escribiendo...`;
            } else {
                // Para 3 o más usuarios
                const lastUser = typingArray.pop();
                typingMessage = `${typingArray.join(', ')} y ${lastUser} están escribiendo...`;
            }
        }
        
        // Emitir el mensaje actualizado
        io.emit('typing', typingMessage);
        
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
    console.log('Chat server listening to 3000 port...');
});
