require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const session = require('express-session');
const app = express();

// --- CONFIGURATION DE LA BASE DE DONNÉES ---
// Connexion sécurisée à votre base Railway
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- CONFIGURATION DE L'APPLICATION ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuration de la session pour sécuriser le portail Admin
app.use(session({
    secret: 'forfeo-lab-ultra-secret-2025',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // À mettre sur true si vous utilisez HTTPS
}));

// --- MIDDLEWARE DE PROTECTION ---
// Empêche l'accès aux pages sensibles sans connexion
const authGuard = (req, res, next) => {
    if (req.session.adminLoggedIn) return next();
    res.redirect('/login');
};

// --- ROUTES PUBLIQUES (WANTED WOW EFFECT) ---
app.get('/', (req, res) => res.render('index'));

app.get('/login', (req, res) => res.render('login'));

app.get('/ambassadeur/inscription', (req, res) => res.render('espace-ambassadeur'));

// Route pour le message dynamique de Forfy
app.get('/api/forfy-message', (req, res) => {
    const page = req.query.page || '';
    let message = "Besoin d'aide ?";
    if (page.includes('admin')) message = "Prêt pour les approbations ?";
    if (page.includes('inscription')) message = "On crée ton profil ?";
    if (page.includes('dashboard')) message = "Analyse tes scores !";
    res.json({ message });
});

// --- AUTHENTIFICATION ---
app.post('/auth', (req, res) => {
    const { username, password } = req.body;
    // Identifiants par défaut
    if (username === 'admin' && password === 'forfeo2025') {
        req.session.adminLoggedIn = true;
        res.redirect('/admin');
    } else {
        res.send("Identifiants incorrects. <a href='/login'>Réessayer</a>");
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- PORTAIL AMBASSADEUR (INSCRIPTION) ---
app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body; // Récupère les données
    try {
        // Enregistre avec les colonnes ville et statut créées
        await pool.query(
            'INSERT INTO ambassadeurs (nom, email, ville, password, statut) VALUES ($1, $2, $3, $4, $5)',
            [nom, email, ville, password, 'En attente']
        );
        res.render('confirmation-ambassadeur', { nom, ville }); // Vue stylisée
    } catch (err) {
        console.error("Erreur Inscription:", err.message);
        res.status(500).send("Erreur lors de l'inscription. L'email est sans doute déjà utilisé.");
    }
});

// --- PORTAIL ADMIN (SÉCURISÉ) ---
app.get('/admin', authGuard, async (req, res) => {
    try {
        const ambassadeurs = (await pool.query('SELECT * FROM ambassadeurs ORDER BY id DESC')).rows;
        const missions = (await pool.query('SELECT * FROM missions ORDER BY date_creation DESC')).rows;
        res.render('admin', { ambassadeurs, missions });
    } catch (err) {
        res.status(500).send("Erreur de chargement de la console admin.");
    }
});

// Action d'approbation d'un ambassadeur
app.get('/admin/approuver/:id', authGuard, async (req, res) => {
    const id = req.params.id;
    try {
        await pool.query("UPDATE ambassadeurs SET statut = 'Validé' WHERE id = $1", [id]);
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send("Erreur de validation.");
    }
});

// --- DASHBOARD ENTREPRISE (PERFORMANCE) ---
app.get('/entreprise/dashboard', async (req, res) => {
    const entrepriseId = 4; // L'ID entreprise qui contient vos données
    try {
        const missions = (await pool.query('SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY date_creation DESC', [entrepriseId])).rows;
        res.render('dashboard', { missions });
    } catch (err) {
        res.status(500).send("Erreur de chargement du dashboard.");
    }
});

// --- DÉMARRAGE DU LABORATOIRE ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Système Forfeo Corporate opérationnel sur le port ${PORT}`);
});
