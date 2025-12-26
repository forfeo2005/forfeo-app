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

// --- INITIALISATION AUTOMATIQUE (INDISPENSABLE POUR VERSION FREE) ---
const initDb = async () => {
    try {
        // Création des tables si elles n'existent pas
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
                entreprise_id INTEGER REFERENCES users(id),
                titre TEXT NOT NULL,
                description TEXT,
                recompense TEXT,
                statut TEXT DEFAULT 'disponible',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // AUTO-PROMOTION ADMIN POUR VOTRE COMPTE
        const monEmailAdmin = 'forfeo2005@gmail.com'; 
        await pool.query("UPDATE users SET role = 'admin' WHERE email = $1", [monEmailAdmin]);
        
        console.log("✅ Système Forfeo initialisé. Admin reconnu :", monEmailAdmin);
    } catch (err) {
        console.error("❌ Erreur d'initialisation :", err);
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

// --- ROUTES DE NAVIGATION ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/ambassadeur/inscription', (req, res) => res.render('espace-ambassadeur'));
app.get('/entreprise/inscription', (req, res) => res.render('inscription-entreprise'));

// --- PORTAIL ADMIN (SÉCURISÉ) ---
app.get('/admin/dashboard', async (req, res) => {
    if (!req.session.userId || req.session.userRole !== 'admin') {
        return res.redirect('/login');
    }
    try {
        const entreprises = await pool.query("SELECT id, nom, email, ville FROM users WHERE role = 'entreprise'");
        const ambassadeurs = await pool.query("SELECT id, nom, email, ville FROM users WHERE role = 'ambassadeur'");
        res.render('admin-dashboard', { 
            entreprises: entreprises.rows, 
            ambassadeurs: ambassadeurs.rows 
        });
    } catch (err) {
        res.status(500).send("Erreur de chargement du dashboard admin.");
    }
});

// --- PORTAIL ENTREPRISE (À VENIR) ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (!req.session.userId || req.session.userRole !== 'entreprise') {
        return res.redirect('/login');
    }
    res.render('entreprise-dashboard'); 
});

// --- LOGIQUE D'INSCRIPTION ---
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
        res.send("Erreur lors de l'inscription.");
    }
});

// --- LOGIQUE DE CONNEXION ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            const isMatch = await bcrypt.compare(password, user.password);
            if (isMatch) {
                req.session.userId = user.id;
                req.session.userRole = user.role;
                
                // Redirection intelligente selon le rôle
                if (user.role === 'admin') res.redirect('/admin/dashboard');
                else if (user.role === 'entreprise') res.redirect('/entreprise/dashboard');
                else res.redirect('/ambassadeur/dashboard');
            } else { res.send("Mot de passe incorrect."); }
        } else { res.send("Utilisateur non trouvé."); }
    } catch (err) { res.send("Erreur de connexion."); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.listen(port, () => console.log(`🚀 Serveur actif sur port ${port}`));
