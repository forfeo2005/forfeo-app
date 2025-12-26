const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

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

// --- ROUTE ADMIN (SÉCURISÉE) ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') {
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
        console.error(err);
        res.send("Erreur lors du chargement du dashboard admin.");
    }
});

// --- LOGIN AVEC REDIRECTION PAR RÔLE ---
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
                if (user.role === 'admin') res.redirect('/admin/dashboard');
                else if (user.role === 'entreprise') res.redirect('/entreprise/dashboard');
                else res.redirect('/ambassadeur/dashboard');
            } else { res.send("Mot de passe incorrect."); }
        } else { res.send("Utilisateur non trouvé."); }
    } catch (err) { res.send("Erreur de connexion."); }
});

app.listen(port, () => console.log(`🚀 Forfeo sur port ${port}`));
