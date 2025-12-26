const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// Configuration de la base de données PostgreSQL Render
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- FONCTION D'AUTO-CRÉATION DES TABLES ---
// Cette fonction crée vos tables manuellement au démarrage du serveur
const initDb = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                nom TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                ville TEXT,
                password TEXT NOT NULL,
                role TEXT DEFAULT 'ambassadeur',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS missions (
                id SERIAL PRIMARY KEY,
                titre TEXT NOT NULL,
                description TEXT,
                statut TEXT DEFAULT 'disponible',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ Base de données initialisée avec succès.");
    } catch (err) {
        console.error("❌ Erreur lors de l'initialisation de la base :", err);
    }
};
initDb();

// Middleware
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'forfeo_secret_key_2025',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// --- ROUTES ---

app.get('/', (req, res) => {
    res.render('index');
});

app.get('/ambassadeur/inscription', (req, res) => {
    res.render('espace-ambassadeur');
});

app.get('/entreprise/inscription', (req, res) => {
    res.render('inscription-entreprise');
});

app.get('/login', (req, res) => {
    res.render('login');
});

// Inscription Ambassadeur
app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (nom, email, ville, password, role) VALUES ($1, $2, $3, $4, $5)',
            [nom, email, ville, hashedPassword, 'ambassadeur']
        );
        res.redirect('/login?success=account_created');
    } catch (err) {
        console.error(err);
        res.send("Erreur : l'email est peut-être déjà utilisé.");
    }
});

// Inscription Entreprise
app.post('/signup-entreprise', async (req, res) => {
    const { nom_entreprise, email, ville, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (nom, email, ville, password, role) VALUES ($1, $2, $3, $4, $5)',
            [nom_entreprise, email, ville, hashedPassword, 'entreprise']
        );
        res.redirect('/login?success=pro_account_created');
    } catch (err) {
        console.error(err);
        res.send("Erreur lors de l'inscription entreprise.");
    }
});

app.listen(port, () => {
    console.log(`🚀 Forfeo Canada opérationnel sur le port ${port}`);
});
