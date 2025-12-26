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
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000 
});

// INITIALISATION ET RÉPARATION DE LA BASE DE DONNÉES
const initDb = async () => {
    try {
        // 1. Création des tables de base si elles n'existent pas
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY, nom TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
                ville TEXT, password TEXT NOT NULL, role TEXT DEFAULT 'ambassadeur'
            );
            CREATE TABLE IF NOT EXISTS missions (
                id SERIAL PRIMARY KEY, titre TEXT NOT NULL, description TEXT, 
                recompense TEXT, statut TEXT DEFAULT 'disponible'
            );
            CREATE TABLE IF NOT EXISTS candidatures (
                id SERIAL PRIMARY KEY, mission_id INTEGER REFERENCES missions(id),
                ambassadeur_id INTEGER REFERENCES users(id), statut TEXT DEFAULT 'en_attente'
            );
            CREATE TABLE IF NOT EXISTS rapports (
                id SERIAL PRIMARY KEY, mission_id INTEGER REFERENCES missions(id),
                ambassadeur_id INTEGER REFERENCES users(id), contenu TEXT, note INTEGER, 
                date_envoi TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. RÉPARATION : Ajout de la colonne manquante entreprise_id si nécessaire
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                               WHERE table_name='missions' AND column_name='entreprise_id') THEN
                    ALTER TABLE missions ADD COLUMN entreprise_id INTEGER REFERENCES users(id);
                END IF;
            END $$;
        `);

        // 3. RÉINITIALISATION ADMIN (Accès : forfeo2005@gmail.com / admin123)
        const tempPass = await bcrypt.hash('admin123', 10);
        await pool.query(`
            INSERT INTO users (nom, email, ville, password, role) 
            VALUES ('Admin Forfeo', 'forfeo2005@gmail.com', 'Montréal', $1, 'admin')
            ON CONFLICT (email) DO UPDATE SET role = 'admin', password = $1
        `, [tempPass]);

        console.log("✅ Base de données réparée. Admin prêt avec le mot de passe : admin123");
    } catch (err) { console.error("❌ Erreur d'initialisation :", err); }
};
initDb();

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'forfeo_secret_2025',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// --- ROUTES DE NAVIGATION ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/ambassadeur/inscription', (req, res) => res.render('espace-ambassadeur'));
app.get('/entreprise/inscription', (req, res) => res.render('inscription-entreprise'));

// --- LOGIQUE D'INSCRIPTION ---
app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (nom, email, ville, password, role) VALUES ($1, $2, $3, $4, $5)', [nom, email, ville, hash, 'ambassadeur']);
        res.redirect('/login');
    } catch (err) { res.status(500).send("Erreur d'inscription."); }
});

app.post('/signup-entreprise', async (req, res) => {
    const { nom_entreprise, email, ville, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (nom, email, ville, password, role) VALUES ($1, $2, $3, $4, $5)', [nom_entreprise, email, ville, hash, 'entreprise']);
        res.redirect('/login');
    } catch (err) { res.status(500).send("Erreur d'inscription entreprise."); }
});

// --- CONNEXION ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
            const user = result.rows[0];
            req.session.userId = user.id;
            req.session.userRole = user.role;
            if (user.role === 'admin') return res.redirect('/admin/dashboard');
            if (user.role === 'entreprise') return res.redirect('/entreprise/dashboard');
            return res.redirect('/ambassadeur/dashboard');
        }
        res.send("Email ou mot de passe incorrect.");
    } catch (err) { res.status(500).send("Erreur serveur."); }
});

// --- DASHBOARDS ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (!req.session.userId || req.session.userRole !== 'entreprise') return res.redirect('/login');
    try {
        const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1", [req.session.userId]);
        const rapports = await pool.query(`SELECT r.*, m.titre, u.nom as ambassadeur FROM rapports r JOIN missions m ON r.mission_id = m.id JOIN users u ON r.ambassadeur_id = u.id WHERE m.entreprise_id = $1`, [req.session.userId]);
        res.render('entreprise-dashboard', { missions: missions.rows, rapports: rapports.rows });
    } catch (err) { res.status(500).send("Erreur lors du chargement du tableau de bord."); }
});

app.post('/creer-mission', async (req, res) => {
    if (!req.session.userId || req.session.userRole !== 'entreprise') return res.status(403).send("Non autorisé");
    const { titre, description, recompense } = req.body;
    try {
        await pool.query("INSERT INTO missions (entreprise_id, titre, description, recompense) VALUES ($1, $2, $3, $4)", [req.session.userId, titre, description, recompense]);
        res.redirect('/entreprise/dashboard');
    } catch (err) { res.status(500).send("Erreur création mission"); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.listen(port, () => console.log(`🚀 Serveur actif`));
