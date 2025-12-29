const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const { OpenAI } = require("openai");
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// --- CONFIGURATION BASE DE DONNÉES ---
const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

// --- CONFIGURATION COURRIEL ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { 
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS 
    }
});

// --- INITIALISATION DE LA STRUCTURE DB ---
async function initialiserDB() {
    try {
        // Table pour les sessions (évite la déconnexion lors des redémarrages Render)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "session" (
              "sid" varchar NOT NULL COLLATE "default" PRIMARY KEY,
              "sess" json NOT NULL,
              "expire" timestamp(6) NOT NULL
            );
            CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
        `);
        
        // Mise à jour des colonnes de la table missions
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS ambassadeur_id INTEGER");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS rapport_final TEXT");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS photo_preuve TEXT");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS statut VARCHAR(20) DEFAULT 'actif'");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS date_approbation TIMESTAMP");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS note_audit INTEGER DEFAULT 0");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS forfait VARCHAR(50) DEFAULT 'Freemium'");
        
        console.log("✅ FORFEO LAB : Base de données et Sessions synchronisées.");
    } catch (e) { 
        console.error("Erreur Initialisation DB:", e); 
    }
}
initialiserDB();

// --- MIDDLEWARES ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CONFIGURATION SESSION (connect-pg-simple) ---
app.use(session({
    store: new pgSession({
        pool: pool,
        tableName: 'session'
    }),
    secret: 'forfeo_secret_qc_2025', 
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // Session persistante de 30 jours
}));

app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION (Fix Cannot GET) ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));
app.get('/ambassadeurs', (req, res) => res.render('ambassadeurs', { userName: req.session.userName || null }));
app.get('/register', (req, res) => res.render('register'));
app.get('/login', (req, res) => res.render('login'));

// --- AUTHENTIFICATION (Fix Cannot POST /login) ---
app.post('/register', async (req, res) => {
    const { nom, email, password, role } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query("INSERT INTO users (nom, email, password, role) VALUES ($1, $2, $3, $4)", [nom, email, hash, role]);
        res.redirect('/login');
    } catch (err) { res.status(500).send("Erreur d'inscription"); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
            req.session.userId = result.rows[0].id;
            req.session.userName = result.rows[0].nom;
            req.session.userRole = result.rows[0].role;
            return res.redirect(`/${req.session.userRole}/dashboard`);
        }
        res.send("<script>alert('Identifiants incorrects'); window.location.href='/login';</script>");
    } catch (err) { res.status(500).send("Erreur serveur"); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- DASHBOARD ADMIN (FUTURISTE) ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    try {
        const entreprises = await pool.query("SELECT * FROM users WHERE role = 'entreprise'");
        const rapports = await pool.query(`
            SELECT m.*, u.nom as entreprise_nom 
            FROM missions m 
            JOIN users u ON m.entreprise_id = u.id 
            ORDER BY m.id DESC`);
        
        const revenusData = await pool.query(`
            SELECT TO_CHAR(date_approbation, 'Mon YYYY') as mois, 
                   SUM(recompense::numeric) as total 
            FROM missions WHERE statut = 'approuve' 
            GROUP BY mois, date_approbation ORDER BY date_approbation ASC LIMIT 6`);

        res.render('admin-dashboard', { 
            entreprises: entreprises.rows, 
            rapports: rapports.rows, 
            userName: req.session.userName,
            chartData: revenusData.rows
        });
    } catch (err) { res.status(500).send("Erreur Admin"); }
});

// --- ACTIONS ADMIN (APPROBATION & EMAIL & NOTE) ---
app.post('/admin/approuver-audit', async (req, res) => {
    const { id_mission, note_audit } = req.body;
    try {
        const missionResult = await pool.query(`
            SELECT m.*, u.email, u.nom FROM missions m 
            JOIN users u ON m.ambassadeur_id = u.id WHERE m.id = $1`, [id_mission]);
        
        if (missionResult.rows.length > 0) {
            const mission = missionResult.rows[0];
            await pool.query("UPDATE missions SET statut = 'approuve', date_approbation = NOW(), note_audit = $1 WHERE id = $2", [note_audit, id_mission]);
            
            await transporter.sendMail({
                from: `"FORFEO LAB" <${process.env.EMAIL_USER}>`,
                to: mission.email,
                subject: 'Mission Approuvée ! 💰',
                text: `Bonjour ${mission.nom}, votre rapport pour la mission "${mission.titre}" a été validé avec une note de ${note_audit}/5. Votre récompense de ${mission.recompense}$ a été confirmée.`
            });
        }
        res.redirect('/admin/dashboard');
    } catch (err) { res.status(500).send("Erreur"); }
});

// --- DASHBOARD ENTREPRISE ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    try {
        const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
        const user = await pool.query("SELECT forfait FROM users WHERE id = $1", [req.session.userId]);
        
        const stats = {
            totale: missions.rows.length,
            enCours: missions.rows.filter(m => m.statut === 'actif' || m.statut === 'reserve').length,
            termine: missions.rows.filter(m => m.statut === 'termine' || m.statut === 'approuve').length,
            totalInvesti: missions.rows.reduce((acc, m) => acc + (parseFloat(m.recompense) || 0), 0),
            forfait: user.rows[0]?.forfait || 'Freemium'
        };

        res.render('entreprise-dashboard', { 
            missions: missions.rows, 
            userName: req.session.userName,
            stats: stats
        });
    } catch (err) { res.status(500).send("Erreur Dashboard"); }
});

// --- CRÉATION DE MISSION ---
app.post('/creer-mission', async (req, res) => {
    const { titre, description, recompense, type_mission, criteres } = req.body;
    const descCompilee = `TYPE : ${type_mission}\nCRITÈRES : ${Array.isArray(criteres) ? criteres.join('|') : criteres}\n---\n${description}`;
    try {
        await pool.query("INSERT INTO missions (entreprise_id, titre, description, recompense, statut) VALUES ($1, $2, $3, $4, 'actif')", 
        [req.session.userId, titre, descCompilee, recompense]);
        res.redirect('/entreprise/dashboard');
    } catch (err) { res.status(500).send("Erreur"); }
});

// --- GÉNÉRATION RAPPORT PDF ---
app.get('/entreprise/telecharger-rapport/:id', async (req, res) => {
    try {
        const result = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id WHERE m.id = $1", [req.params.id]);
        const mission = result.rows[0];
        
        const doc = new PDFDocument({ margin: 50 });
        res.setHeader('Content-disposition', `attachment; filename="Rapport_Forfeo_${req.params.id}.pdf"`);
        res.setHeader('Content-type', 'application/pdf');

        doc.fillColor('#007bff').fontSize(25).text('FORFEO LAB', { align: 'right' });
        doc.moveDown().fillColor('#333').fontSize(18).text(`RAPPORT D'AUDIT : ${mission.titre.toUpperCase()}`, { underline: true });
        doc.moveDown().fontSize(12).fillColor('#000').text(`Entreprise : ${mission.entreprise_nom}`);
        doc.text(`Note de l'Audit : ${mission.note_audit}/5`);
        doc.moveDown().text(mission.rapport_final, { align: 'justify' });

        doc.pipe(res);
        doc.end();
    } catch (err) { res.status(500).send("Erreur PDF"); }
});

// --- DASHBOARD AMBASSADEUR ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    try {
        const disponibles = await pool.query("SELECT * FROM missions WHERE statut = 'actif' ORDER BY id DESC");
        const gains = await pool.query("SELECT SUM(recompense::numeric) as total FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'", [req.session.userId]);
        res.render('ambassadeur-dashboard', { 
            missions: disponibles.rows, 
            userName: req.session.userName, 
            totalGains: gains.rows[0].total || 0 
        });
    } catch (err) { res.status(500).send("Erreur"); }
});

app.listen(port, () => console.log(`🚀 FORFEO LAB actif sur port ${port}`));
