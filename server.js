const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const PDFDocument = require('pdfkit');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// Config OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- BANQUE DE QUESTIONS ROBUSTE (POUR ÉVITER L'ERREUR D'AFFICHAGE) ---
const QUESTIONS_DATA = [
    {
        titre: "Excellence du Service Client", description: "Créer un effet WOW.", icon: "bi-emoji-smile", duree: "30 min",
        questions: [
            { q: "Un client entre pendant que vous êtes au téléphone.", sit: "Situation : Vous êtes occupé au téléphone.", a: "L'ignorer", b: "Signe de main et sourire", c: "Raccrocher", rep: "B", expl: "Le contact visuel valide la présence." },
            { q: "Un client régulier arrive.", sit: "Situation : Vous connaissez son nom.", a: "Bonjour", b: "Bonjour M. Tremblay !", c: "Suivant", rep: "B", expl: "La personnalisation fidélise." },
            { q: "Incapable de répondre à une question technique.", sit: "Situation : Produit complexe.", a: "Je sais pas", b: "Je vérifie pour vous", c: "Demandez ailleurs", rep: "B", expl: "Être proactif rassure." },
            { q: "Le magasin ferme dans 5 min.", sit: "Situation : Client entre.", a: "Dehors!", b: "Accueillir poliment mais informer", c: "Éteindre les lumières", rep: "B", expl: "Service jusqu'au bout." },
            { q: "Erreur sur la facture.", sit: "Situation : Le client le remarque.", a: "Cacher", b: "S'excuser et corriger", c: "Nier", rep: "B", expl: "L'honnêteté prime." }
        ]
    },
    {
        titre: "Gestion des Situations Difficiles", description: "Calmer le jeu.", icon: "bi-shield-check", duree: "45 min",
        questions: [
            { q: "Client en colère crie.", sit: "Situation : Conflit au comptoir.", a: "Crier aussi", b: "Rester calme et écouter", c: "Partir", rep: "B", expl: "Le calme est contagieux." },
            { q: "Refus de remboursement.", sit: "Situation : Politique stricte.", a: "Non.", b: "Expliquer + Alternative", c: "Impossible", rep: "B", expl: "Le 'Non, mais...'." },
            { q: "Insulte personnelle.", sit: "Situation : Client dépasse les bornes.", a: "Insulter", b: "Refuser le langage calmement", c: "Pleurer", rep: "B", expl: "Respect professionnel." },
            { q: "Service très lent.", sit: "Situation : Manque de staff.", a: "Cacher", b: "Informer et offrir une attention", c: "Se plaindre", rep: "B", expl: "Transparence." },
            { q: "Menace d'avis Google.", sit: "Situation : Client insatisfait.", a: "S'en foutre", b: "Tenter de corriger sur place", c: "Payer", rep: "B", expl: "Récupération de service." }
        ]
    }
];

const knowledgeBase = `Tu es Forfy, IA de Forfeo Lab (Division de FORFEO INC). Tu aides Ambassadeurs, Entreprises et Admins.`;

const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

app.use(express.static('public'));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: 'forfeo_v16_final_fix',
    resave: false, 
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');

// --- SETUP BDD & RE-SEEDING FORCE ---
async function setupDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, nom VARCHAR(255), email VARCHAR(255) UNIQUE, password VARCHAR(255), role VARCHAR(50), entreprise_id INTEGER, forfait VARCHAR(50) DEFAULT 'Freemium');
            CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, entreprise_id INTEGER, ambassadeur_id INTEGER, titre VARCHAR(255), type_audit VARCHAR(100), description TEXT, recompense VARCHAR(50), statut VARCHAR(50) DEFAULT 'en_attente', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, client_nom VARCHAR(255), client_email VARCHAR(255), adresse VARCHAR(255), google_map_link TEXT, statut_paiement VARCHAR(50) DEFAULT 'non_paye', date_paiement TIMESTAMP);
            CREATE TABLE IF NOT EXISTS formations_modules (id SERIAL PRIMARY KEY, titre VARCHAR(255), description TEXT, image_icon VARCHAR(50), duree VARCHAR(50));
            CREATE TABLE IF NOT EXISTS formations_questions (id SERIAL PRIMARY KEY, module_id INTEGER, question TEXT, option_a TEXT, option_b TEXT, option_c TEXT, reponse_correcte CHAR(1), mise_en_situation TEXT, explication TEXT);
            CREATE TABLE IF NOT EXISTS formations_scores (id SERIAL PRIMARY KEY, user_id INTEGER, module_id INTEGER, meilleur_score INTEGER DEFAULT 0, tentatives INTEGER DEFAULT 0, statut VARCHAR(50), code_verif VARCHAR(12) UNIQUE, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS audit_reports (id SERIAL PRIMARY KEY, mission_id INTEGER UNIQUE, ambassadeur_id INTEGER, details JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        `);

        // Force reload questions pour corriger l'affichage vide
        await pool.query("TRUNCATE formations_questions RESTART IDENTITY CASCADE"); 
        await pool.query("TRUNCATE formations_modules RESTART IDENTITY CASCADE");

        let modId = 1;
        for (const mod of QUESTIONS_DATA) {
            await pool.query(`INSERT INTO formations_modules (id, titre, description, image_icon, duree) VALUES ($1, $2, $3, $4, $5)`, [modId, mod.titre, mod.description, mod.icon, mod.duree]);
            for (const q of mod.questions) {
                await pool.query(`INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte, mise_en_situation, explication) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [modId, q.q, q.a, q.b, q.c, q.rep, q.sit, q.expl]);
            }
            modId++;
        }
        console.log("✅ Questions rechargées.");

    } catch (err) { console.error("Erreur DB:", err); }
}
setupDatabase();

// --- ROUTES ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/politique-confidentialite', (req, res) => res.render('politique-confidentialite', { userName: req.session.userName || null }));
app.get('/conditions-utilisation', (req, res) => res.render('conditions-utilisation', { userName: req.session.userName || null }));

// LOGIN/REGISTER
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
app.get('/register', (req, res) => res.render('register', { role: req.query.role || 'ambassadeur', error: null, userName: null }));
app.post('/register', async (req, res) => {
    const hash = await bcrypt.hash(req.body.password, 10);
    await pool.query("INSERT INTO users (nom, email, password, role, forfait) VALUES ($1, $2, $3, $4, 'Freemium')", [req.body.nom, req.body.email, hash, req.body.role]);
    res.redirect('/login?msg=created');
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- ADMIN (CALCULS TAXES + PDF) ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const missions = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id ORDER BY m.id DESC");
    const users = await pool.query("SELECT * FROM users ORDER BY id DESC");
    
    // Calculs
    const paiements = await pool.query(`SELECT m.*, u.nom as ambassadeur_nom FROM missions m LEFT JOIN users u ON m.ambassadeur_id = u.id WHERE m.statut_paiement = 'paye' ORDER BY m.date_paiement DESC`);
    let totalBrut = 0;
    paiements.rows.forEach(p => totalBrut += (parseFloat(p.recompense) || 0));
    const tps = totalBrut * 0.05;
    const tvq = totalBrut * 0.09975;
    const grandTotal = totalBrut + tps + tvq;

    const aPayer = await pool.query("SELECT SUM(CASE WHEN recompense ~ '^[0-9.]+$' THEN CAST(recompense AS NUMERIC) ELSE 0 END) as total FROM missions WHERE statut = 'approuve' AND statut_paiement = 'non_paye'");

    res.render('admin-dashboard', { 
        missions: missions.rows, 
        users: users.rows, 
        paiements: paiements.rows, 
        finance: { brut: totalBrut.toFixed(2), tps: tps.toFixed(2), tvq: tvq.toFixed(2), total: grandTotal.toFixed(2) },
        totalAPayer: aPayer.rows[0].total || 0, 
        userName: req.session.userName 
    });
});

app.get('/admin/rapport-comptable', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Rapport_Comptable_${Date.now()}.pdf`);
    doc.pipe(res);

    // Essayer de charger le logo (chemin relatif ou absolu)
    const logoPath = path.join(__dirname, 'images', 'logo-forfeo.png'); 
    if(fs.existsSync(logoPath)) {
        doc.image(logoPath, 50, 45, { width: 120 });
    }
    
    doc.moveDown(5);
    doc.fontSize(20).text('RAPPORT DES PAIEMENTS VERSÉS', { align: 'center' });
    doc.moveDown();
    
    const paiements = await pool.query(`SELECT m.*, u.nom as ambassadeur_nom FROM missions m LEFT JOIN users u ON m.ambassadeur_id = u.id WHERE m.statut_paiement = 'paye'`);
    let total = 0;
    
    paiements.rows.forEach(p => {
        doc.fontSize(12).text(`${new Date(p.date_paiement).toLocaleDateString()} - ${p.ambassadeur_nom} - ${p.titre} : ${p.recompense}$`);
        total += parseFloat(p.recompense) || 0;
    });
    
    doc.moveDown();
    doc.text(`------------------------------------------------`);
    doc.text(`Sous-total: ${total.toFixed(2)}$`);
    doc.text(`TPS (5%): ${(total * 0.05).toFixed(2)}$`);
    doc.text(`TVQ (9.975%): ${(total * 0.09975).toFixed(2)}$`);
    doc.font('Helvetica-Bold').text(`GRAND TOTAL: ${(total * 1.14975).toFixed(2)}$`);
    doc.end();
});

app.post('/admin/payer-ambassadeur', async (req, res) => {
    await pool.query("UPDATE missions SET statut_paiement = 'paye', date_paiement = NOW() WHERE id = $1", [req.body.id_mission]);
    res.redirect('/admin/dashboard');
});
app.post('/admin/approuver-mission', async (req, res) => {
    const mission = await pool.query("SELECT statut FROM missions WHERE id = $1", [req.body.id_mission]);
    let newStatut = mission.rows[0].statut === 'soumis' ? 'approuve' : 'actif';
    await pool.query("UPDATE missions SET statut = $1 WHERE id = $2", [newStatut, req.body.id_mission]);
    res.redirect('/admin/dashboard');
});
app.post('/admin/create-user', async (req, res) => {
    const hash = await bcrypt.hash(req.body.password, 10);
    await pool.query("INSERT INTO users (nom, email, password, role) VALUES ($1, $2, $3, $4)", [req.body.nom, req.body.email, hash, req.body.role]);
    res.redirect('/admin/dashboard');
});
app.post('/admin/delete-user', async (req, res) => {
    await pool.query("DELETE FROM users WHERE id = $1", [req.body.user_id]);
    res.redirect('/admin/dashboard');
});
app.get('/admin/rapport/:missionId', async (req, res) => {
    const data = await pool.query(`SELECT r.*, m.titre, m.type_audit, m.client_email, m.id as mission_id, u.nom as ambassadeur_nom FROM audit_reports r JOIN missions m ON r.mission_id = m.id LEFT JOIN users u ON r.ambassadeur_id = u.id WHERE m.id = $1`, [req.params.missionId]);
    if(data.rows.length === 0) return res.send("Aucun rapport.");
    res.render('admin-rapport-detail', { rapport: data.rows[0], details: data.rows[0].details, userName: req.session.userName });
});

// --- ENTREPRISE (AVEC PDF BRANDÉ & DISCLAIMER) ---
const checkLimit = async (req, res, next) => {
    const user = await pool.query("SELECT forfait FROM users WHERE id = $1", [req.session.userId]);
    if (user.rows[0].forfait === 'Freemium') {
        const count = await pool.query("SELECT COUNT(*) FROM missions WHERE entreprise_id = $1", [req.session.userId]);
        if (parseInt(count.rows[0].count) >= 1) return res.redirect('/entreprise/dashboard?error=limit_atteinte');
    }
    next();
};
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    const scores = await pool.query(`SELECT u.nom, m.titre, s.* FROM formations_scores s JOIN users u ON s.user_id = u.id JOIN formations_modules m ON s.module_id = m.id WHERE u.entreprise_id = $1`, [req.session.userId]);
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY created_at DESC", [req.session.userId]);
    res.render('entreprise-dashboard', { user: user.rows[0], employeesScores: scores.rows, missions: missions.rows, userName: req.session.userName, error: req.query.error });
});
app.post('/entreprise/creer-audit', checkLimit, async (req, res) => {
    const mapLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(req.body.adresse)}`;
    await pool.query("INSERT INTO missions (entreprise_id, titre, type_audit, description, recompense, statut, adresse, google_map_link) VALUES ($1, $2, $3, $4, $5, 'en_attente', $6, $7)", [req.session.userId, req.body.titre, req.body.type_audit, "Visite terrain.", req.body.recompense, req.body.adresse, mapLink]);
    res.redirect('/entreprise/dashboard');
});
app.post('/entreprise/commander-sondage', checkLimit, async (req, res) => {
    await pool.query("INSERT INTO missions (entreprise_id, titre, type_audit, description, recompense, statut, client_nom, client_email) VALUES ($1, $2, $3, $4, $5, 'en_attente', $6, $7)", [req.session.userId, "Sondage : " + req.body.client_nom, req.body.type_sondage, "Enquête client.", req.body.recompense, req.body.client_nom, req.body.client_email]);
    res.redirect('/entreprise/dashboard');
});
app.post('/entreprise/ajouter-employe', async (req, res) => {
    const hash = await bcrypt.hash(req.body.password, 10);
    await pool.query("INSERT INTO users (nom, email, password, role, entreprise_id) VALUES ($1, $2, $3, 'employe', $4)", [req.body.email.split('@')[0], req.body.email, hash, req.session.userId]);
    res.redirect('/entreprise/dashboard');
});
app.get('/entreprise/telecharger-rapport/:id', async (req, res) => {
    const report = await pool.query(`SELECT r.details, m.titre, m.type_audit, m.created_at, COALESCE(u.nom, 'Ambassadeur') as ambassadeur_nom FROM audit_reports r JOIN missions m ON r.mission_id = m.id LEFT JOIN users u ON r.ambassadeur_id = u.id WHERE m.id = $1 AND m.entreprise_id = $2`, [req.params.id, req.session.userId]);
    if(report.rows.length === 0) return res.send("Non dispo");
    
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Rapport_ForfeoLab.pdf`);
    doc.pipe(res);
    
    // Logo PDF
    const logoPath = path.join(__dirname, 'images', 'logo-forfeo.png');
    if(fs.existsSync(logoPath)) {
        doc.image(logoPath, 50, 45, { width: 100 });
    }
    
    doc.moveDown(5);
    doc.fontSize(22).fillColor('#0061ff').text('RAPPORT FORFEO LAB', { align: 'center' });
    doc.moveDown();
    
    // Texte de remerciement et disclaimer
    doc.fontSize(10).fillColor('black').text("Merci d'avoir choisi Forfeo Lab, une division de FORFEO INC.", { align: 'center' });
    doc.text("Ce rapport a été réalisé par un de nos ambassadeurs sélectionnés avec rigueur pour assurer l'objectivité.", { align: 'center' });
    doc.moveDown(2);
    
    doc.fontSize(12).text(`Mission : ${report.rows[0].titre}`);
    doc.text(`Type : ${report.rows[0].type_audit}`);
    doc.text(`Réalisé le : ${new Date(report.rows[0].created_at).toLocaleDateString()}`);
    doc.moveDown();
    
    const details = report.rows[0].details;
    if(details) { for(const [k,v] of Object.entries(details)) { doc.font('Helvetica-Bold').text(`${k} : `); doc.font('Helvetica').text(`${v}`); doc.moveDown(0.5); } }
    doc.end();
});

// --- AMBASSADEUR ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE statut = 'actif'");
    const historique = await pool.query("SELECT * FROM missions WHERE ambassadeur_id = $1 ORDER BY created_at DESC", [req.session.userId]);
    const gains = await pool.query("SELECT SUM(CASE WHEN recompense ~ '^[0-9.]+$' THEN CAST(recompense AS NUMERIC) ELSE 0 END) as total FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'", [req.session.userId]);
    res.render('ambassadeur-dashboard', { missions: missions.rows, historique: historique.rows, totalGains: gains.rows[0].total || 0, userName: req.session.userName });
});
app.post('/ambassadeur/postuler', async (req, res) => {
    await pool.query("UPDATE missions SET ambassadeur_id = $1, statut = 'reserve' WHERE id = $2", [req.session.userId, req.body.id_mission]);
    res.redirect('/ambassadeur/dashboard');
});
app.post('/ambassadeur/soumettre-rapport', async (req, res) => {
    const { mission_id, ...reponses } = req.body;
    await pool.query("INSERT INTO audit_reports (mission_id, ambassadeur_id, details) VALUES ($1, $2, $3) ON CONFLICT (mission_id) DO UPDATE SET details = $3", [mission_id, req.session.userId, JSON.stringify(reponses)]);
    await pool.query("UPDATE missions SET statut = 'soumis' WHERE id = $1", [mission_id]);
    res.redirect('/ambassadeur/dashboard');
});

// --- ACADEMIE ---
app.get('/employe/dashboard', async (req, res) => {
    if (req.session.userRole !== 'employe') return res.redirect('/login');
    const modules = await pool.query("SELECT * FROM formations_modules ORDER BY id ASC");
    const scores = await pool.query("SELECT * FROM formations_scores WHERE user_id = $1", [req.session.userId]);
    res.render('employe-dashboard', { modules: modules.rows, scores: scores.rows, userName: req.session.userName });
});
app.get('/formations/module/:id', async (req, res) => {
    const module = await pool.query("SELECT * FROM formations_modules WHERE id = $1", [req.params.id]);
    const questions = await pool.query("SELECT * FROM formations_questions WHERE module_id = $1 ORDER BY id ASC", [req.params.id]);
    res.render('formation-detail', { module: module.rows[0], questions: questions.rows, userName: req.session.userName });
});
app.post('/formations/soumettre-quizz', async (req, res) => {
    const questions = await pool.query("SELECT id, reponse_correcte FROM formations_questions WHERE module_id = $1", [req.body.module_id]);
    let score = 0;
    questions.rows.forEach(q => { if (req.body['q_' + q.id] === q.reponse_correcte) score++; });
    const statut = score >= 3 ? 'reussi' : 'echec';
    const code = Math.random().toString(36).substring(2, 12).toUpperCase();
    await pool.query(`INSERT INTO formations_scores (user_id, module_id, meilleur_score, tentatives, statut, code_verif) VALUES ($1, $2, $3, 1, $4, $5) ON CONFLICT (user_id, module_id) DO UPDATE SET meilleur_score = GREATEST(formations_scores.meilleur_score, EXCLUDED.meilleur_score), tentatives = formations_scores.tentatives + 1, statut = EXCLUDED.statut`, [req.session.userId, req.body.module_id, score, statut, code]);
    res.redirect('/employe/dashboard');
});
app.get('/certificat/:code', async (req, res) => {
    const data = await pool.query("SELECT s.*, u.nom, m.titre FROM formations_scores s JOIN users u ON s.user_id = u.id JOIN formations_modules m ON s.module_id = m.id WHERE s.code_verif = $1", [req.params.code]);
    if(data.rows.length === 0) return res.send("Non trouvé");
    const doc = new PDFDocument({ layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    doc.fontSize(30).text('CERTIFICAT FORFEO ACADÉMIE', {align:'center'});
    doc.fontSize(20).text(`Décerné à ${data.rows[0].nom}`, {align:'center'});
    doc.text(`Module : ${data.rows[0].titre}`, {align:'center'});
    doc.end();
});

// --- API IA ---
app.post('/api/chat', async (req, res) => {
    try {
        const userMsg = req.body.message;
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: knowledgeBase }, { role: "user", content: userMsg }],
        });
        res.json({ reply: completion.choices[0].message.content });
    } catch (err) { res.json({ reply: "Je suis temporairement indisponible." }); }
});

app.listen(port, () => console.log(`🚀 LIVE`));
