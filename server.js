const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const PDFDocument = require('pdfkit');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const multer = require('multer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// Multer (Mémoire pour stockage DB)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    tls: { rejectUnauthorized: false, ciphers: 'SSLv3' }
});

const ACADEMY_DATA = [ { id: 1, titre: "Excellence Client", description: "Effet WOW", icon: "bi-emoji-smile", duree: "20 min", questions: [{q:"Tel sonne", a:"Ignorer", b:"Signe", c:"Raccrocher", rep:"B", sit:"Conflit"}] } ]; // (Raccourci pour lisibilité, gardez votre contenu complet)

const SURVEY_TEMPLATES = {
    "Restaurant": [{id:"accueil", text:"Accueil ?", type:"stars"}, {id:"qualite", text:"Plats ?", type:"stars"}, {id:"service", text:"Service ?", type:"yesno"}, {id:"comment_gen", text:"Avis général", type:"text"}],
    "Hôtel": [{id:"proprete", text:"Propreté ?", type:"stars"}, {id:"confort", text:"Literie ?", type:"stars"}, {id:"personnel", text:"Staff ?", type:"stars"}, {id:"comment_gen", text:"Avis général", type:"text"}],
    "Magasin": [{id:"trouve", text:"Produits trouvés ?", type:"yesno"}, {id:"conseil", text:"Conseil ?", type:"stars"}, {id:"prix", text:"Prix ?", type:"stars"}, {id:"comment_gen", text:"Avis général", type:"text"}],
    "Général": [{id:"global", text:"Satisfaction ?", type:"stars"}, {id:"recommandation", text:"Recommander ?", type:"yesno"}, {id:"comment_gen", text:"Avis général", type:"text"}]
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: 'forfeo_v40_logo_fix',
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');

// DB SETUP
async function setupDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, nom VARCHAR(255), email VARCHAR(255) UNIQUE, password VARCHAR(255), role VARCHAR(50), entreprise_id INTEGER, forfait VARCHAR(50) DEFAULT 'Freemium', telephone VARCHAR(50), adresse TEXT, logo_data TEXT);
            CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, entreprise_id INTEGER, ambassadeur_id INTEGER, titre VARCHAR(255), type_audit VARCHAR(100), description TEXT, recompense VARCHAR(50), statut VARCHAR(50) DEFAULT 'en_attente', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, client_nom VARCHAR(255), client_email VARCHAR(255), adresse VARCHAR(255), google_map_link TEXT, statut_paiement VARCHAR(50) DEFAULT 'non_paye', date_paiement TIMESTAMP);
            CREATE TABLE IF NOT EXISTS sondages_publics (id SERIAL PRIMARY KEY, entreprise_id INTEGER, type_activite VARCHAR(50), reponses JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS formations_scores (id SERIAL PRIMARY KEY, user_id INTEGER, module_id INTEGER, meilleur_score INTEGER DEFAULT 0, tentatives INTEGER DEFAULT 0, statut VARCHAR(50), code_verif VARCHAR(12) UNIQUE, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS formations_modules (id SERIAL PRIMARY KEY, titre VARCHAR(255), description TEXT, image_icon VARCHAR(50), duree VARCHAR(50));
            CREATE TABLE IF NOT EXISTS formations_questions (id SERIAL PRIMARY KEY, module_id INTEGER, question TEXT, option_a TEXT, option_b TEXT, option_c TEXT, reponse_correcte CHAR(1), mise_en_situation TEXT, explication TEXT);
            CREATE TABLE IF NOT EXISTS audit_reports (id SERIAL PRIMARY KEY, mission_id INTEGER UNIQUE, ambassadeur_id INTEGER, details JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        `);
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS logo_data TEXT");
    } catch (err) { console.error("Erreur DB:", err); }
}
setupDatabase();

// ROUTES AUTH
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/login', (req, res) => res.render('login', { error: null, msg: req.query.msg || null, userName: null }));
app.post('/login', async (req, res) => {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [req.body.email]);
    if (result.rows.length > 0 && await bcrypt.compare(req.body.password, result.rows[0].password)) {
        req.session.userId = result.rows[0].id;
        req.session.userName = result.rows[0].nom;
        req.session.userRole = result.rows[0].role;
        return res.redirect(`/${req.session.userRole}/dashboard`);
    }
    res.redirect('/login?error=1');
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// PROFIL (CORRIGÉ : Logo + Retour Dashboard)
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('profil', { user: user.rows[0], userName: req.session.userName, userRole: req.session.userRole, message: req.query.msg || null });
});
app.post('/profil/update', async (req, res) => {
    await pool.query("UPDATE users SET nom = $1, email = $2, telephone = $3, adresse = $4 WHERE id = $5", [req.body.nom, req.body.email, req.body.telephone, req.body.adresse, req.session.userId]);
    if(req.body.new_password) {
        const hash = await bcrypt.hash(req.body.new_password, 10);
        await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hash, req.session.userId]);
    }
    res.redirect('/profil?msg=updated');
});

// ENTREPRISE (CORRIGÉ : Logo injecté dans le dashboard)
app.get('/entreprise/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY created_at DESC", [req.session.userId]);
    const scores = await pool.query(`SELECT u.nom as employe_nom, m.titre as module_titre, s.meilleur_score, s.statut, s.updated_at FROM formations_scores s JOIN users u ON s.user_id = u.id JOIN formations_modules m ON s.module_id = m.id WHERE u.entreprise_id = $1 ORDER BY s.updated_at DESC`, [req.session.userId]);
    const sondages = await pool.query("SELECT * FROM sondages_publics WHERE entreprise_id = $1 ORDER BY created_at DESC", [req.session.userId]);

    const protocol = req.protocol;
    const host = req.get('host');
    const surveyBaseLink = `${protocol}://${host}/sondage-client/${user.rows[0].id}`;

    res.render('entreprise-dashboard', { 
        user: user.rows[0], // Contient maintenant logo_data
        missions: missions.rows, 
        scores: scores.rows, 
        sondages: sondages.rows,
        userName: req.session.userName, 
        error: req.query.error, 
        msg: req.query.msg,
        surveyBaseLink: surveyBaseLink
    });
});

app.post('/entreprise/upload-logo', upload.single('logo'), async (req, res) => {
    if(req.file) {
        const logoBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        await pool.query("UPDATE users SET logo_data = $1 WHERE id = $2", [logoBase64, req.session.userId]);
    }
    res.redirect('/entreprise/dashboard');
});

app.post('/entreprise/envoyer-campagne', async (req, res) => {
    const emailList = req.body.emails.split(/[\n,;]+/).map(e => e.trim()).filter(e => e);
    const type = req.body.type_activite;
    const protocol = req.protocol;
    const host = req.get('host');
    const fullLink = `${protocol}://${host}/sondage-client/${req.session.userId}?type=${encodeURIComponent(type)}`;

    try {
        for(const email of emailList) {
            await transporter.sendMail({
                from: `"Forfeo Lab" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: `Votre avis compte - ${req.session.userName}`,
                html: `<div style="text-align:center; font-family:Arial;"><h2>Bonjour !</h2><p>Merci de votre visite chez <strong>${req.session.userName}</strong>.</p><br><a href="${fullLink}" style="background:#0061ff; color:white; padding:12px 24px; text-decoration:none; border-radius:25px;">Répondre au sondage</a></div>`
            });
        }
        res.redirect('/entreprise/dashboard?msg=campagne_envoyee');
    } catch (error) {
        console.error("Email Error:", error);
        res.redirect('/entreprise/dashboard?error=email_fail');
    }
});

// SONDAGE PUBLIC (CORRIGÉ : Utilise logo_data)
app.get('/sondage-client/:entrepriseId', async (req, res) => {
    const ent = await pool.query("SELECT nom, id, logo_data FROM users WHERE id=$1", [req.params.entrepriseId]);
    if(ent.rows.length === 0) return res.send("Entreprise introuvable");
    
    const type = req.query.type || 'Général';
    const questions = SURVEY_TEMPLATES[type] || SURVEY_TEMPLATES['Général'];

    res.render('sondage-public', { entreprise: ent.rows[0], questions: questions, type: type });
});

app.post('/sondage-client/submit', async (req, res) => {
    await pool.query("INSERT INTO sondages_publics (entreprise_id, type_activite, reponses) VALUES ($1, $2, $3)", 
        [req.body.entreprise_id, req.body.type_activite, JSON.stringify(req.body)]);
    res.send(`<div style="text-align:center; padding:50px; font-family:sans-serif;"><h1 style="color:#0061ff;">Merci !</h1><p>Votre avis a été transmis.</p></div>`);
});

// AUTRES ROUTES (Admin, Ambassadeur, Employé - Inchangées mais nécessaires)
app.get('/admin/dashboard', async (req, res) => { if(req.session.userRole !== 'admin') return res.redirect('/login'); const m = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id=u.id ORDER BY m.id DESC"); const u = await pool.query("SELECT * FROM users ORDER BY id DESC"); const p = await pool.query("SELECT m.*, u.nom as ambassadeur_nom FROM missions m LEFT JOIN users u ON m.ambassadeur_id=u.id WHERE m.statut_paiement='paye' ORDER BY m.date_paiement DESC"); const f = await pool.query("SELECT u.nom as employe, m.titre, s.meilleur_score, s.statut FROM formations_scores s JOIN users u ON s.user_id=u.id JOIN formations_modules m ON s.module_id=m.id ORDER BY s.updated_at DESC LIMIT 20"); let brut=0; p.rows.forEach(x=>brut+=parseFloat(x.recompense)||0); const ap = await pool.query("SELECT SUM(CASE WHEN recompense ~ '^[0-9.]+$' THEN CAST(recompense AS NUMERIC) ELSE 0 END) as total FROM missions WHERE statut='approuve' AND statut_paiement='non_paye'"); res.render('admin-dashboard', {missions:m.rows, users:u.rows, paiements:p.rows, formations:f.rows, finance:{brut:brut.toFixed(2), total:(brut*1.14975).toFixed(2)}, totalAPayer:ap.rows[0].total||0, userName:req.session.userName}); });
app.get('/ambassadeur/dashboard', async (req, res) => { const m = await pool.query("SELECT * FROM missions WHERE statut='approuve'"); const h = await pool.query("SELECT * FROM missions WHERE ambassadeur_id=$1", [req.session.userId]); res.render('ambassadeur-dashboard', { missions: m.rows, historique: h.rows, totalGains: 0, userName: req.session.userName }); });
app.get('/employe/dashboard', async (req, res) => { const mod = await pool.query("SELECT * FROM formations_modules ORDER BY id ASC"); const s = await pool.query("SELECT * FROM formations_scores WHERE user_id=$1", [req.session.userId]); res.render('employe-dashboard', { modules: mod.rows, scores: s.rows, userName: req.session.userName }); });
// (Autres routes POST inchangées pour la brièveté, elles fonctionnent déjà)

app.listen(port, () => console.log('🚀 LIVE'));
