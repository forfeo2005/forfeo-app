const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const { OpenAI } = require("openai");
const PDFDocument = require('pdfkit'); // Nouvelle dépendance installée
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// Configuration des services
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// --- RÉPARATION AUTO DE LA BASE DE DONNÉES ---
async function initialiserDB() {
    try {
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS ambassadeur_id INTEGER");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS rapport_final TEXT");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS statut VARCHAR(20) DEFAULT 'actif'");
        console.log("✅ Base de données synchronisée.");
    } catch (e) { console.log("DB déjà à jour."); }
}
initialiserDB();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'forfeo_secret', resave: false, saveUninitialized: false }));
app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION PRINCIPALE (Fix Cannot GET) ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));
app.get('/ambassadeurs', (req, res) => res.render('ambassadeurs', { userName: req.session.userName || null }));
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

// --- AUTHENTIFICATION ---
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

// --- DASHBOARDS ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1", [req.session.userId]);
    res.render('entreprise-dashboard', { missions: missions.rows, userName: req.session.userName });
});

app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const disponibles = await pool.query("SELECT * FROM missions WHERE statut = 'actif'");
    res.render('ambassadeur-dashboard', { missions: disponibles.rows, userName: req.session.userName });
});

app.get('/ambassadeur/mes-missions', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const mesMissions = await pool.query("SELECT * FROM missions WHERE ambassadeur_id = $1", [req.session.userId]);
    res.render('ambassadeur-missions', { missions: mesMissions.rows, userName: req.session.userName });
});

app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const entreprises = await pool.query("SELECT * FROM users WHERE role = 'entreprise'");
    const rapports = await pool.query(`
        SELECT m.*, u.nom as entreprise_nom 
        FROM missions m 
        JOIN users u ON m.entreprise_id = u.id 
        ORDER BY m.id DESC`);
    res.render('admin-dashboard', { 
        entreprises: entreprises.rows, 
        rapports: rapports.rows, 
        userName: req.session.userName 
    });
});

// --- ACTIONS MISSIONS (Fix Cannot POST) ---
app.post('/creer-mission', async (req, res) => {
    const { titre, description, recompense } = req.body;
    try {
        await pool.query("INSERT INTO missions (entreprise_id, titre, description, recompense, statut) VALUES ($1, $2, $3, $4, 'actif')", 
        [req.session.userId, titre, description, recompense]);
        res.redirect('/entreprise/dashboard');
    } catch (err) { res.status(500).send("Erreur de création"); }
});

app.post('/postuler-mission', async (req, res) => {
    const { id_mission } = req.body;
    try {
        await pool.query("UPDATE missions SET statut = 'reserve', ambassadeur_id = $1 WHERE id = $2", [req.session.userId, id_mission]);
        res.redirect('/ambassadeur/mes-missions');
    } catch (err) { res.status(500).send("Erreur de réservation"); }
});

app.post('/envoyer-rapport', async (req, res) => {
    const { id_mission, rapport } = req.body;
    try {
        await pool.query("UPDATE missions SET rapport_final = $1, statut = 'termine' WHERE id = $2", [rapport, id_mission]);
        res.redirect('/ambassadeur/mes-missions');
    } catch (err) { res.status(500).send("Erreur d'envoi"); }
});

// --- ACTIONS ADMIN ---
app.post('/admin/approuver-audit', async (req, res) => {
    const { id_mission } = req.body;
    await pool.query("UPDATE missions SET statut = 'approuve' WHERE id = $1", [id_mission]);
    res.redirect('/admin/dashboard');
});

app.post('/admin/supprimer-audit', async (req, res) => {
    const { id_mission } = req.body;
    await pool.query("DELETE FROM missions WHERE id = $1", [id_mission]);
    res.redirect('/admin/dashboard');
});

// --- GÉNÉRATION DU RAPPORT PDF (Étape Finale) ---
app.get('/entreprise/telecharger-rapport/:id', async (req, res) => {
    if (!req.session.userId || (req.session.userRole !== 'entreprise' && req.session.userRole !== 'admin')) {
        return res.redirect('/login');
    }
    try {
        const missionId = req.params.id;
        const result = await pool.query(
            "SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id WHERE m.id = $1", 
            [missionId]
        );
        const mission = result.rows[0];

        if (!mission || !mission.rapport_final) {
            return res.send("<script>alert('Rapport non disponible'); window.history.back();</script>");
        }

        const doc = new PDFDocument({ margin: 50 });
        res.setHeader('Content-disposition', `attachment; filename="Rapport_Forfeo_${missionId}.pdf"`);
        res.setHeader('Content-type', 'application/pdf');

        // Design PDF Forfeo Lab
        doc.fillColor('#007bff').fontSize(26).text('FORFEO LAB', { align: 'right' });
        doc.fillColor('#666').fontSize(10).text('Laboratoire d\'Excellence Client - Québec', { align: 'right' });
        doc.moveDown(2);
        doc.fillColor('#333').fontSize(18).text(`RAPPORT D'AUDIT : ${mission.titre.toUpperCase()}`, { underline: true });
        doc.moveDown(1);
        doc.fontSize(12).fillColor('#000').text(`Entreprise : ${mission.entreprise_nom}`);
        doc.text(`Date : ${new Date().toLocaleDateString('fr-CA')}`);
        doc.moveDown(2);
        doc.rect(doc.x, doc.y, 500, 20).fill('#f8f9fa');
        doc.fillColor('#007bff').text('OBSERVATIONS DE L\'AMBASSADEUR', doc.x + 10, doc.y + 5);
        doc.moveDown(2);
        doc.fillColor('#333').fontSize(11).text(mission.rapport_final, { align: 'justify', lineGap: 5 });

        doc.pipe(res);
        doc.end();
    } catch (err) { res.status(500).send("Erreur PDF"); }
});

// --- FORFY CHAT ---
app.post('/forfy/chat', async (req, res) => {
    try {
        const { message } = req.body;
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "system", content: "Tu es Forfy, l'IA de FORFEO LAB." }, { role: "user", content: message }],
        });
        res.json({ answer: response.choices[0].message.content });
    } catch (err) { res.status(500).json({ answer: "Erreur Forfy." }); }
});

app.listen(port, () => console.log(`🚀 FORFEO LAB actif sur le port ${port}`));
