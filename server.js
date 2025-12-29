const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// --- CONNEXION BASE DE DONNÉES ---
const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

// --- CONFIGURATION EMAIL ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// --- INITIALISATION DB ---
async function initDB() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS "session" ("sid" varchar NOT NULL PRIMARY KEY, "sess" json NOT NULL, "expire" timestamp(6) NOT NULL);`);
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS forfait VARCHAR(50) DEFAULT 'Freemium';");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS premiere_connexion BOOLEAN DEFAULT TRUE;");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS date_completion TIMESTAMP;");
        console.log("✅ Base de données synchronisée");
    } catch (e) { console.error("Erreur DB:", e); }
}
initDB();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: 'forfeo_top_secret_2025',
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');

// --- NAVIGATION ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/login', (req, res) => res.render('login', { msg: req.query.msg || null }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));

// --- PROFIL (Fix Cannot GET /profil) ---
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('profil', { user: result.rows[0], message: req.query.msg || null, userName: req.session.userName });
});

app.post('/update-profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const { nom, newPassword } = req.body;
    await pool.query("UPDATE users SET nom = $1 WHERE id = $2", [nom, req.session.userId]);
    if (newPassword && newPassword.trim() !== "") {
        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hash, req.session.userId]);
    }
    res.redirect('/profil?msg=Profil mis à jour');
});

// --- RÉSERVATION (Fix Cannot POST /postuler-mission) ---
app.post('/postuler-mission', async (req, res) => {
    if (!req.session.userId) return res.status(403).send("Non autorisé");
    const { id_mission } = req.body;
    try {
        const info = await pool.query(`
            SELECT m.titre, u.email, u.nom as entreprise_nom 
            FROM missions m JOIN users u ON m.entreprise_id = u.id WHERE m.id = $1`, [id_mission]);

        if (info.rows.length > 0) {
            await pool.query("UPDATE missions SET ambassadeur_id = $1, statut = 'reserve' WHERE id = $2", [req.session.userId, id_mission]);
            
            // Notification Email
            const mailOptions = {
                from: '"FORFEO LAB" <no-reply@forfeo.com>',
                to: info.rows[0].email,
                subject: `Mission réservée : ${info.rows[0].titre}`,
                html: `<h3>Bonjour ${info.rows[0].entreprise_nom}</h3><p>L'ambassadeur ${req.session.userName} a réservé votre mission.</p>`
            };
            transporter.sendMail(mailOptions);
        }
        res.redirect('/ambassadeur/mes-missions');
    } catch (err) { res.status(500).send("Erreur réservation"); }
});

// --- STATISTIQUES ENTREPRISE ---
app.get('/entreprise/statistiques', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    try {
        const statsQuery = await pool.query(`
            SELECT TO_CHAR(date_completion, 'Mon') as mois, COUNT(*) as total
            FROM missions 
            WHERE entreprise_id = $1 AND statut = 'approuve' AND date_completion IS NOT NULL
            GROUP BY mois ORDER BY MIN(date_completion)`, [req.session.userId]);
        
        res.render('entreprise-stats', { stats: statsQuery.rows, userName: req.session.userName });
    } catch (err) { res.status(500).send("Erreur Stats"); }
});

// --- DASHBOARDS ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const userRes = await pool.query("SELECT premiere_connexion FROM users WHERE id = $1", [req.session.userId]);
    const showWelcome = userRes.rows[0].premiere_connexion;
    if (showWelcome) await pool.query("UPDATE users SET premiere_connexion = FALSE WHERE id = $1", [req.session.userId]);
    
    const disponibles = await pool.query("SELECT * FROM missions WHERE statut = 'actif' ORDER BY id DESC");
    const gains = await pool.query(`SELECT SUM(COALESCE(CAST(NULLIF(REGEXP_REPLACE(recompense, '[^0-9.]', '', 'g'), '') AS NUMERIC), 0)) as total FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'`, [req.session.userId]);
    
    res.render('ambassadeur-dashboard', { missions: disponibles.rows, userName: req.session.userName, totalGains: gains.rows[0].total || 0, showWelcome });
});

app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const userRes = await pool.query("SELECT premiere_connexion, forfait FROM users WHERE id = $1", [req.session.userId]);
    const showWelcome = userRes.rows[0].premiere_connexion;
    const forfait = userRes.rows[0].forfait || 'Freemium';
    if (showWelcome) await pool.query("UPDATE users SET premiere_connexion = FALSE WHERE id = $1", [req.session.userId]);

    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    res.render('entreprise-dashboard', { missions: missions.rows, userName: req.session.userName, showWelcome, stats: { totale: missions.rows.length, forfait, canPublish: (forfait === 'Premium' || missions.rows.length < 1) } });
});

// --- AUTHENTIFICATION ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
        req.session.userId = result.rows[0].id;
        req.session.userName = result.rows[0].nom;
        req.session.userRole = result.rows[0].role;
        return res.redirect(`/${req.session.userRole}/dashboard`);
    }
    res.redirect('/login?msg=Erreur');
});

// --- SUPPRESSION ---
app.post('/admin/delete-user', async (req, res) => {
    const { id_a_supprimer } = req.body;
    await pool.query("DELETE FROM missions WHERE entreprise_id = $1 OR ambassadeur_id = $1", [id_a_supprimer]);
    await pool.query("DELETE FROM users WHERE id = $1", [id_a_supprimer]);
    if (id_a_supprimer == req.session.userId) req.session.destroy();
    res.redirect('/login?msg=Compte supprimé');
});

app.listen(port, () => console.log(`🚀 Serveur actif sur port ${port}`));
