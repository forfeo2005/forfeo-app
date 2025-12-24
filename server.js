require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const session = require('express-session');
const app = express();

// --- CONFIGURATION BASE DE DONNÉES ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- CONFIGURATION EXPRESS ---
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuration de la session (Indispensable pour l'espace Admin)
app.use(session({
    secret: 'forfeo-secret-key-2025',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// --- MIDDLEWARE DE PROTECTION ---
const isAdmin = (req, res, next) => {
    if (req.session.adminLoggedIn) return next();
    res.redirect('/login');
};

// --- ROUTES PUBLIQUES ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/ambassadeur/inscription', (req, res) => res.render('espace-ambassadeur'));

// --- API FORFY (Bulle dynamique) ---
app.get('/api/forfy-message', (req, res) => {
    const page = req.query.page || '';
    let message = "Besoin d'aide ?";
    if (page.includes('confirmation')) message = "Candidature reçue ! À très vite. 🚀";
    if (page.includes('dashboard')) message = "Analyse tes scores de performance.";
    if (page.includes('inscription')) message = "Prêt à rejoindre l'élite ?";
    res.json({ message });
});

// --- INSCRIPTION AMBASSADEUR (CODE COMPLET CORRIGÉ) ---
app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body;
    try {
        // Enregistrement dans Railway
        await pool.query(
            'INSERT INTO ambassadeurs (nom, email, ville, password, statut) VALUES ($1, $2, $3, $4, $5)',
            [nom, email, ville, password, 'En attente']
        );
        
        // Succès : Transmission de nom ET ville pour éviter l'erreur EJS
        res.render('confirmation-ambassadeur', { nom, ville });
    } catch (err) {
        // Gestion de l'erreur email déjà existant (Code 23505)
        if (err.code === '23505') {
            return res.status(400).send(`
                <div style="font-family:sans-serif; text-align:center; padding:50px;">
                    <h2 style="color:#e74c3c;">Erreur : Cet email est déjà utilisé</h2>
                    <p>L'adresse <strong>${email}</strong> est déjà enregistrée.</p>
                    <a href="/ambassadeur/inscription">Retourner à l'inscription</a>
                </div>
            `);
        }
        console.error(err);
        res.status(500).send("Erreur serveur lors de l'inscription.");
    }
});

// --- ESPACE ADMIN SÉCURISÉ ---
app.post('/auth', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'forfeo2025') {
        req.session.adminLoggedIn = true;
        res.redirect('/admin');
    } else {
        res.send("Identifiants incorrects. <a href='/login'>Réessayer</a>");
    }
});

app.get('/admin', isAdmin, async (req, res) => {
    try {
        const ambassadeurs = (await pool.query('SELECT * FROM ambassadeurs ORDER BY id DESC')).rows;
        const missions = (await pool.query('SELECT * FROM missions ORDER BY id DESC')).rows;
        res.render('admin', { ambassadeurs, missions });
    } catch (err) {
        res.status(500).send("Erreur serveur Admin.");
    }
});

app.get('/admin/approuver/:id', isAdmin, async (req, res) => {
    try {
        await pool.query("UPDATE ambassadeurs SET statut = 'Validé' WHERE id = $1", [req.params.id]);
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send("Erreur validation.");
    }
});

// --- DASHBOARD ENTREPRISE (AVEC GRAPHIQUES) ---
app.get('/entreprise/dashboard', async (req, res) => {
    try {
        const missions = (await pool.query('SELECT * FROM missions WHERE entreprise_id = 4')).rows;
        
        // Récupération des scores de performance
        let stats = [];
        try {
            const resStats = await pool.query('SELECT * FROM feedback_metrics WHERE entreprise_id = 4 ORDER BY id ASC');
            stats = resStats.rows;
        } catch (dbErr) {
            console.warn("Table feedback_metrics absente ou incomplète.");
        }
        
        res.render('dashboard', { missions, stats });
    } catch (err) {
        console.error(err);
        res.status(500).send("Erreur lors du chargement du dashboard.");
    }
});

// --- DÉMARRAGE DU SERVEUR ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Forfeo Lab Corporate opérationnel sur le port ${PORT}`);
});
