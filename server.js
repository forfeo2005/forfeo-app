require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const session = require('express-session');
const app = express();

// Connexion PostgreSQL Railway
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- CONFIGURATION ---
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sécurité des sessions
app.use(session({
    secret: 'forfeo-corporate-security-2025',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Mettre à true si vous passez en HTTPS complet
}));

// --- MIDDLEWARE DE PROTECTION ---
const authGuard = (req, res, next) => {
    if (req.session.adminLoggedIn) return next();
    res.redirect('/login');
};

// --- ROUTES PUBLIQUES ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/ambassadeur/inscription', (req, res) => res.render('espace-ambassadeur'));

// --- AUTHENTIFICATION ---
app.post('/auth', (req, res) => {
    const { username, password } = req.body;
    // Identifiants administrateur
    if (username === 'admin' && password === 'forfeo2025') {
        req.session.adminLoggedIn = true;
        res.redirect('/admin');
    } else {
        res.send('Identifiants incorrects. Veuillez réessayer.');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// --- PORTAIL AMBASSADEUR (LOGIQUE) ---
app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body;
    try {
        await pool.query(
            'INSERT INTO ambassadeurs (nom, email, ville, password, statut) VALUES ($1, $2, $3, $4, $5)', 
            [nom, email, ville, password, 'En attente']
        );
        res.render('confirmation-ambassadeur', { nom });
    } catch (err) {
        console.error(err);
        res.status(500).send("Erreur lors de l'inscription.");
    }
});

// --- PORTAIL ADMIN PROTEGE ---
app.get('/admin', authGuard, async (req, res) => {
    try {
        const ambassadeurs = (await pool.query('SELECT * FROM ambassadeurs ORDER BY id DESC')).rows;
        const missions = (await pool.query('SELECT * FROM missions ORDER BY id DESC')).rows;
        res.render('admin', { ambassadeurs, missions });
    } catch (err) {
        res.status(500).send("Erreur de chargement des données admin.");
    }
});

// Validation Ambassadeur
app.get('/admin/approuver/:id', authGuard, async (req, res) => {
    await pool.query("UPDATE ambassadeurs SET statut = 'Validé' WHERE id = $1", [req.params.id]);
    res.redirect('/admin');
});

// --- PORTAIL ENTREPRISE (DASHBOARD) ---
app.get('/entreprise/dashboard', async (req, res) => {
    const missions = (await pool.query('SELECT * FROM missions WHERE entreprise_id = 4')).rows;
    res.render('dashboard', { missions });
});

// --- DEMARRAGE ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Forfeo Corporate System Online on port ${PORT}`));
